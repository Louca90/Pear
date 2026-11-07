import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Database, HardDrive, Images, Trash2 } from 'lucide-react-native';

import { cacheSize, clearCache } from '../chat/cleanup';
import { deleteConversationMedia, deleteOldMedia, getContactProfile, getMediaUsage, getSetting, MediaUsage, setSetting } from '../chat/database';
import { formatSize } from '../chat/files';
import { chat } from '../chat/manager';
import { DB_NAME } from '../config';
import { showDialog } from '../components/dialog';
import { SegmentedControl } from '../components/SegmentedControl';
import { Avatar, Button, Header, Screen } from '../components/ui';
import { t } from '../i18n';
import { log } from '../log';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors } from '../theme';

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

type Usage = { media: number; messages: number; cache: number; byContact: MediaUsage[] };

function measure(): Usage {
  const byContact = getMediaUsage();
  return { media: byContact.reduce((total, row) => total + row.bytes, 0), messages: databaseSize(), cache: cacheSize(), byContact };
}

// La barre de répartition : chaque part s'étend en douceur à l'ouverture et après un nettoyage.
function UsageBar({ usage }: { usage: Usage }) {
  const colors = useColors();
  const styles = useStyles();
  const total = Math.max(1, usage.media + usage.messages + usage.cache);
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    grow.setValue(0);
    Animated.timing(grow, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [usage, grow]);
  const part = (bytes: number, color: string) => (
    <Animated.View style={{ backgroundColor: color, width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${(bytes / total) * 100}%`] }) }} />
  );
  return (
    <View style={styles.bar}>
      {part(usage.media, colors.text)}
      {part(usage.messages, colors.textMuted)}
      {part(usage.cache, colors.border)}
    </View>
  );
}

// Profil → Paramètres → Stockage : la place prise par Pear, par conversation, et de quoi la libérer.
export function StorageScreen({ contacts, onBack }: { contacts: Contact[]; onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [usage, setUsage] = useState<Usage>(measure);
  const [cleanup, setCleanup] = useState<CleanupChoice>(() => (getSetting(AUTO_CLEANUP_SETTING) ?? '0') as CleanupChoice);
  const refresh = () => setUsage(measure());
  const nameOf = (key: string) => contacts.find((contact) => contact.publicKey === key)?.name ?? t('app.contact');

  const emptyCache = () => {
    clearCache();
    refresh();
  };

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

  const legend = (icon: typeof Images, label: string, bytes: number, swatch: string) => {
    const Icon = icon;
    return (
      <View style={styles.legendRow}>
        <View style={[styles.swatch, { backgroundColor: swatch }]} />
        <Icon size={18} color={colors.text} strokeWidth={1.75} />
        <Text style={styles.legendLabel}>{label}</Text>
        <Text style={styles.legendSize}>{formatSize(bytes)}</Text>
      </View>
    );
  };

  return (
    <Screen>
      <Header title={t('stockage.titre')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.total}>{formatSize(usage.media + usage.messages + usage.cache)}</Text>
        <Text style={styles.totalLabel}>{t('stockage.utilise')}</Text>
        <UsageBar usage={usage} />
        <View style={styles.card}>
          {legend(Images, t('stockage.medias'), usage.media, colors.text)}
          {legend(Database, t('stockage.messages'), usage.messages, colors.textMuted)}
          {legend(HardDrive, t('stockage.cache'), usage.cache, colors.border)}
        </View>
        <View style={styles.actions}>
          <Button label={t('stockage.viderCache')} icon={Trash2} variant="secondary" onPress={emptyCache} />
        </View>

        <Text style={styles.sectionTitle}>{t('stockage.auto')}</Text>
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

        <Text style={styles.sectionTitle}>{t('stockage.parConversation')}</Text>
        {usage.byContact.length === 0 ? (
          <Text style={styles.hint}>{t('stockage.aucunMedia')}</Text>
        ) : (
          <View style={styles.card}>
            {usage.byContact.map((row) => (
              <Pressable key={row.contact} onPress={() => confirmDelete(row)} style={({ pressed }) => [styles.contactRow, pressed && styles.pressed]}>
                <Avatar uri={getContactProfile(row.contact).photo_uri} size={36} />
                <View style={styles.contactText}>
                  <Text style={styles.contactName} numberOfLines={1}>{nameOf(row.contact)}</Text>
                  <Text style={styles.contactMeta}>{t('stockage.nMedias', { n: row.count })}</Text>
                </View>
                <Text style={styles.legendSize}>{formatSize(row.bytes)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  total: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
  },
  totalLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  card: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  legendLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  legendSize: {
    fontSize: 15,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 56,
  },
  pressed: {
    opacity: 0.6,
  },
  contactText: {
    flex: 1,
  },
  contactName: {
    fontSize: 15,
    color: colors.text,
  },
  contactMeta: {
    fontSize: 13,
    color: colors.textMuted,
  },
}));
