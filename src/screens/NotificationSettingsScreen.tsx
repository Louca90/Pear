import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronRight, File, Image, LucideIcon, MessageSquare, Mic, Settings, Video } from 'lucide-react-native';

import { getMutedKinds, MessageKind, setMutedKinds } from '../chat/database';
import { Header, Screen } from '../components/ui';
import { Toggle } from '../components/Toggle';
import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

const KINDS: { kind: MessageKind; icon: LucideIcon; label: string }[] = [
  { kind: 'text', icon: MessageSquare, label: t('notifs.messages') },
  { kind: 'image', icon: Image, label: t('notifs.photos') },
  { kind: 'video', icon: Video, label: t('notifs.videos') },
  { kind: 'audio', icon: Mic, label: t('notifs.vocaux') },
  { kind: 'file', icon: File, label: t('notifs.fichiers') },
];

// Par conversation : de quoi être prévenu. Les autorisations du téléphone restent accessibles en bas.
export function NotificationSettingsScreen({ contactKey, name, onBack }: { contactKey: string; name: string; onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [muted, setMuted] = useState(() => getMutedKinds(contactKey));

  const toggle = (kind: MessageKind, notify: boolean) => {
    const next = notify ? muted.filter((item) => item !== kind) : [...muted, kind];
    setMutedKinds(contactKey, next);
    setMuted(next);
  };

  return (
    <Screen>
      <Header title={t('notifs.titre')} subtitle={name} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>{t('notifs.parType')}</Text>
        <View style={styles.card}>
          {KINDS.map(({ kind, icon: Icon, label }) => (
            <View key={kind} style={styles.row}>
              <Icon size={20} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.rowLabel}>{label}</Text>
              <Toggle value={!muted.includes(kind)} onChange={(notify) => toggle(kind, notify)} label={label} />
            </View>
          ))}
        </View>
        <Text style={styles.hint}>{t('notifs.parTypeAide')}</Text>

        <Text style={styles.sectionTitle}>{t('notifs.telephone')}</Text>
        <View style={styles.card}>
          <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <Settings size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.rowLabel}>{t('notifs.reglagesTelephone')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  card: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 52,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  pressed: {
    opacity: 0.6,
  },
}));
