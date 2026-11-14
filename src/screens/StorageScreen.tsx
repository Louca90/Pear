import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import { File, Paths } from 'expo-file-system';
import { Clock, Trash2 } from 'lucide-react-native';
import { isSelf } from '../chat/self';

import { cacheSize, clearCache } from '../chat/cleanup';
import { deleteConversationMedia, deleteOldMedia, getContactProfile, getMediaUsage, getMediaUsageByKind, getSetting, MediaUsage, setSetting } from '../chat/database';
import { formatSize } from '../chat/files';
import { clearOpenedMedia } from '../chat/media';
import { chat } from '../chat/manager';
import { DB_NAME } from '../config';
import { showDialog } from '../components/dialog';
import { SegmentedControl } from '../components/SegmentedControl';
import { Avatar, Header, Screen } from '../components/ui';
import { haptics } from '../haptics';
import { enterUp, timing } from '../motion';
import { t } from '../i18n';
import { log } from '../log';
import { Contact } from '../storage';
import { createStyles, fixed, radius, spacing, useColors } from '../theme';

export const AUTO_CLEANUP_SETTING = 'auto_cleanup_days';
type CleanupChoice = '0' | '30' | '90' | '180';

// Au lancement : si le nettoyage automatique est choisi, les médias trop anciens sont supprimés.
export function runAutoCleanup() {
  const days = Number(getSetting(AUTO_CLEANUP_SETTING) ?? 0);
  if (days <= 0) return;
  const removed = deleteOldMedia(days);
  if (removed > 0) log.info('nettoyage automatique', `${removed} médias de plus de ${days} jours`);
}

function databaseSize() {
  return ['', '-wal'].reduce((total, suffix) => {
    try {
      return total + (new File(Paths.document, 'SQLite', DB_NAME + suffix).size ?? 0);
    } catch {
      return total;
    }
  }, 0);
}

type Usage = { byKind: Record<'image' | 'video' | 'audio' | 'file', number>; messages: number; cache: number; byContact: MediaUsage[] };

function measure(): Usage {
  const byKind = { image: 0, video: 0, audio: 0, file: 0 };
  for (const row of getMediaUsageByKind()) if (row.kind in byKind) byKind[row.kind as keyof typeof byKind] += row.bytes;
  return { byKind, messages: databaseSize(), cache: cacheSize(), byContact: getMediaUsage() };
}

const totalOf = (usage: Usage) => usage.byKind.image + usage.byKind.video + usage.byKind.audio + usage.byKind.file + usage.messages + usage.cache;

// Une part de la barre : elle s'étend en douceur, l'une après l'autre, à l'ouverture et après un nettoyage.
function Part({ bytes, total, color, index }: { bytes: number; total: number; color: string; index: number }) {
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.set(0);
    grow.set(withDelay(index * 60, timing(1, 520)));
  }, [bytes, total, index, grow]);
  const style = useAnimatedStyle(() => ({ width: `${(bytes / Math.max(1, total)) * 100 * grow.get()}%` }));
  return <Reanimated.View style={[{ backgroundColor: color, height: '100%' }, style]} />;
}

// Une conversation : son avatar, une fine barre relative à la plus lourde, et sa taille.
function ContactBar({ fraction, index }: { fraction: number; index: number }) {
  const styles = useStyles();
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.set(withDelay(120 + index * 50, timing(1, 520)));
  }, [grow, index]);
  const style = useAnimatedStyle(() => ({ width: `${fraction * 100 * grow.get()}%` }));
  return (
    <View style={styles.contactTrack}>
      <Reanimated.View style={[styles.contactFill, style]} />
    </View>
  );
}

// Profil → Stockage (planche « Réglages · Stockage ») : la place prise par Pear, par type et par
// conversation, et de quoi la libérer.
export function StorageScreen({ contacts, onBack }: { contacts: Contact[]; onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [usage, setUsage] = useState<Usage>(measure);
  const [cleared, setCleared] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupChoice>(() => (getSetting(AUTO_CLEANUP_SETTING) ?? '0') as CleanupChoice);
  const refresh = () => setUsage(measure());
  const nameOf = (key: string) => (isSelf(key) ? t('notes.titre') : contacts.find((contact) => contact.publicKey === key)?.name ?? t('app.contact'));
  const total = totalOf(usage);
  const heaviest = Math.max(1, ...usage.byContact.map((row) => row.bytes));

  const parts = [
    { key: 'image', label: t('stockage.photos'), bytes: usage.byKind.image, color: fixed.storage.image },
    { key: 'video', label: t('stockage.videos'), bytes: usage.byKind.video, color: fixed.storage.video },
    { key: 'audio', label: t('stockage.vocaux'), bytes: usage.byKind.audio, color: fixed.storage.audio },
    { key: 'file', label: t('stockage.fichiers'), bytes: usage.byKind.file, color: fixed.storage.file },
    { key: 'messages', label: t('stockage.messages'), bytes: usage.messages, color: colors.textMuted },
    { key: 'cache', label: t('stockage.cache'), bytes: usage.cache, color: colors.border },
  ];

  const emptyCache = () => {
    clearCache();
    clearOpenedMedia('all');
    haptics.success();
    setCleared(true);
    refresh();
  };

  const deleteYearOld = () =>
    showDialog(t('stockage.unAnQuestion'), t('stockage.autoAide'), [
      {
        label: t('commun.supprimer'),
        style: 'danger',
        onPress: () => {
          deleteOldMedia(365);
          chat.refresh();
          refresh();
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);

  const chooseCleanup = (choice: CleanupChoice) => {
    setCleanup(choice);
    setSetting(AUTO_CLEANUP_SETTING, choice === '0' ? null : choice);
    if (choice === '0') return;
    showDialog(t('stockage.autoQuestion', { n: choice }), t('stockage.autoAide'), [
      {
        label: t('stockage.nettoyerMaintenant'),
        onPress: () => {
          deleteOldMedia(Number(choice));
          chat.refresh();
          refresh();
        },
      },
      { label: t('stockage.plusTard'), style: 'cancel' },
    ]);
  };

  const confirmDelete = (row: MediaUsage) => {
    showDialog(t('stockage.supprimerQuestion', { nom: nameOf(row.contact) }), t('stockage.supprimerAide', { taille: formatSize(row.bytes) }), [
      {
        label: t('commun.supprimer'),
        style: 'danger',
        onPress: () => {
          deleteConversationMedia(row.contact);
          chat.refresh();
          refresh();
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <Header title={t('stockage.titre')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Reanimated.View entering={enterUp(10, 260)} style={styles.hero}>
          <View style={styles.totalRow}>
            <Text style={styles.total}>{formatSize(total)}</Text>
            <Text style={styles.totalLabel}>{t('stockage.utilise')}</Text>
          </View>
          <View style={styles.bar} accessibilityRole="image" accessibilityLabel={t('stockage.repartition')}>
            {parts.map((part, index) => (
              <Part key={part.key} bytes={part.bytes} total={total} color={part.color} index={index} />
            ))}
          </View>
          <View style={styles.legend}>
            {parts.map((part) => (
              <View key={part.key} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: part.color }]} />
                <Text style={styles.legendLabel} numberOfLines={1}>
                  {part.label}
                </Text>
                <Text style={styles.legendSize}>{formatSize(part.bytes)}</Text>
              </View>
            ))}
          </View>
        </Reanimated.View>

        <Reanimated.View entering={enterUp(10, 260, 40)} style={styles.group}>
          <Text style={styles.groupTitle}>{t('stockage.parConversation')}</Text>
          {usage.byContact.length === 0 ? (
            <Text style={styles.hint}>{t('stockage.aucunMedia')}</Text>
          ) : (
            <View style={styles.card}>
              {usage.byContact.map((row, index) => (
                <Pressable
                  key={row.contact}
                  onPress={() => confirmDelete(row)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.contactRow, index > 0 && styles.divider, pressed && styles.pressed]}
                >
                  <Avatar uri={getContactProfile(row.contact).photo_uri} size={38} notes={isSelf(row.contact)} />
                  <View style={styles.contactText}>
                    <Text style={styles.contactName} numberOfLines={1}>
                      {nameOf(row.contact)}
                    </Text>
                    <ContactBar fraction={row.bytes / heaviest} index={index} />
                  </View>
                  <Text style={styles.legendSize}>{formatSize(row.bytes)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Reanimated.View>

        <Reanimated.View entering={enterUp(10, 260, 80)} style={styles.group}>
          <Text style={styles.groupTitle}>{t('stockage.fairePlace')}</Text>
          <View style={styles.buttons}>
            <Pressable onPress={emptyCache} accessibilityRole="button" style={({ pressed }) => [styles.tile, cleared && styles.tileDone, pressed && styles.pressed]}>
              <Trash2 size={20} color={cleared ? colors.onSignature : colors.text} strokeWidth={1.8} />
              <Text style={[styles.tileLabel, cleared && { color: colors.onSignature }]} numberOfLines={2}>
                {cleared ? t('stockage.cacheVide') : t('stockage.viderCacheTaille', { taille: formatSize(usage.cache) })}
              </Text>
            </Pressable>
            <Pressable onPress={deleteYearOld} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
              <Clock size={20} color={colors.text} strokeWidth={1.8} />
              <Text style={styles.tileLabel} numberOfLines={2}>
                {t('stockage.unAn')}
              </Text>
            </Pressable>
          </View>
        </Reanimated.View>

        <Reanimated.View entering={enterUp(10, 260, 120)} style={styles.group}>
          <Text style={styles.groupTitle}>{t('stockage.auto')}</Text>
          <SegmentedControl
            options={[
              { value: '0', label: t('stockage.jamais') },
              { value: '30', label: t('stockage.jours', { n: 30 }) },
              { value: '90', label: t('stockage.jours', { n: 90 }) },
              { value: '180', label: t('stockage.jours', { n: 180 }) },
            ]}
            value={cleanup}
            onChange={chooseCleanup}
          />
          <Text style={styles.hint}>{t('stockage.autoAide')}</Text>
        </Reanimated.View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: 20 },
  hero: { gap: 14, padding: 18, borderRadius: 22, backgroundColor: colors.surface },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  total: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, color: colors.text },
  totalLabel: { fontSize: 13, color: colors.textMuted },
  bar: { flexDirection: 'row', height: 12, gap: 2, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.elevated },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 14 },
  legendItem: { width: '46%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 8, height: 8, borderRadius: radius.full },
  legendLabel: { flex: 1, fontSize: 13, color: colors.text },
  legendSize: { fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  group: { gap: spacing.sm },
  groupTitle: { marginHorizontal: 4, fontSize: 12, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.textMuted },
  card: { borderRadius: 18, backgroundColor: colors.surface, overflow: 'hidden' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  contactText: { flex: 1, gap: 7 },
  contactName: { fontSize: 15, color: colors.text },
  contactTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.elevated },
  contactFill: { height: '100%', borderRadius: 2, backgroundColor: colors.signatureStrong },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minHeight: 72,
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  tileDone: { backgroundColor: colors.signature },
  tileLabel: { fontSize: 13, textAlign: 'center', color: colors.text },
  hint: { marginHorizontal: 4, fontSize: 12, lineHeight: 18, color: colors.textMuted },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));