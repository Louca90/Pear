import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronRight, CircleAlert, CircleCheck, FileText } from 'lucide-react-native';

import { chat } from '../chat/manager';
import { shareLog } from '../components/ErrorBoundary';
import { Header, Screen } from '../components/ui';
import {
  collectDiagnostics,
  Diagnostics,
  needsManufacturerAdvice,
  openBatterySettings,
  openNotificationSettings,
  openPowerManagerSettings,
} from '../diagnostics';
import { t } from '../i18n';
import { log } from '../log';
import { createStyles, radius, spacing, useColors } from '../theme';

const FADE_MS = 220;

type Row = { ok: boolean; label: string; detail?: string; onPress?: () => void };

function formatAgo(at: number) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return t('diag.aLinstant');
  if (minutes < 60) return t('diag.ilYaMinutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 48 ? t('diag.ilYaHeures', { n: hours }) : t('diag.ilYaJours', { n: Math.round(hours / 24) });
}

// Pour comprendre pourquoi une notification n'arrive pas : chaque ligne dit ce qui va, ce qui ne va
// pas, et ouvre le bon réglage d'Android quand c'est possible.
export function DiagnosticScreen({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [data, setData] = useState<Diagnostics | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  const refresh = useCallback(() => {
    collectDiagnostics()
      .then(setData)
      .catch((e) => log.warn('diagnostic', e));
  }, []);

  // Au retour des réglages d'Android, les valeurs ont pu changer.
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (data) Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [data, opacity]);

  const rows: Row[] = data
    ? [
        { ok: data.notificationsAllowed && !data.channelBlocked, label: t('diag.notifications'), detail: data.notificationsAllowed && !data.channelBlocked ? t('diag.autorisees') : t('diag.bloquees'), onPress: openNotificationSettings },
        { ok: !data.batteryRestricted, label: t('diag.batterie'), detail: data.batteryRestricted ? t('diag.batterieRestreinte') : t('diag.batterieLibre'), onPress: openBatterySettings },
        ...(data.powerManager || needsManufacturerAdvice(data.manufacturer)
          ? [{ ok: false, label: t('diag.constructeur', { marque: data.manufacturer }), detail: t('diag.constructeurAide'), onPress: data.powerManager ? openPowerManagerSettings : openBatterySettings }]
          : []),
        { ok: chat.getMyToken() !== null, label: t('diag.tokenFcm'), detail: chat.getMyToken() ? t('diag.present') : t('diag.absent') },
        { ok: data.inboxRegistered && data.tokenPublished, label: t('diag.tokenPublie'), detail: data.tokenPublished ? t('diag.oui') : t('diag.pasEncore') },
        { ok: data.lastPush !== null, label: t('diag.dernierPush'), detail: data.lastPush ? `${formatAgo(data.lastPush.at)} · ${data.lastPush.type}` : t('diag.aucun') },
        { ok: true, label: t('diag.connexions'), detail: t('diag.connexionsDetail', { n: chat.countConnected() }) },
      ]
    : [];

  return (
    <Screen>
      <Header title={t('diag.titre')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View style={[styles.rows, { opacity }]}>
          {rows.map((row) => {
            const Icon = row.ok ? CircleCheck : CircleAlert;
            const content = (
              <>
                <Icon size={20} color={row.ok ? colors.text : colors.danger} strokeWidth={1.75} />
                <View style={styles.text}>
                  <Text style={styles.label}>{row.label}</Text>
                  {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
                </View>
                {row.onPress ? <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} /> : null}
              </>
            );
            return row.onPress ? (
              <Pressable key={row.label} onPress={row.onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                {content}
              </Pressable>
            ) : (
              <View key={row.label} style={styles.row}>
                {content}
              </View>
            );
          })}
          <Text style={styles.note}>{t('diag.sansRelais')}</Text>
          <Pressable onPress={shareLog} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <FileText size={20} color={colors.text} strokeWidth={1.75} />
            <View style={styles.text}>
              <Text style={styles.label}>{t('erreur.exporterJournal')}</Text>
              <Text style={styles.detail}>{t('diag.journalAide')}</Text>
            </View>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    color: colors.text,
  },
  detail: {
    fontSize: 13,
    color: colors.textMuted,
  },
  note: {
    fontSize: 13,
    color: colors.textMuted,
    marginVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
}));
