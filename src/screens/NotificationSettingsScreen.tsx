import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronRight, File, Image, LucideIcon, MessageSquare, Mic, Settings, Video } from 'lucide-react-native';

import { getMutedKinds, MessageKind, setMutedKinds } from '../chat/database';
import { Header, Screen } from '../components/ui';
import { Toggle } from '../components/Toggle';
import { t } from '../i18n';
import { createStyles, spacing, useColors } from '../theme';

const KINDS: { kind: MessageKind; icon: LucideIcon; label: () => string }[] = [
  { kind: 'text', icon: MessageSquare, label: () => t('notifs.messages') },
  { kind: 'image', icon: Image, label: () => t('notifs.photos') },
  { kind: 'video', icon: Video, label: () => t('notifs.videos') },
  { kind: 'audio', icon: Mic, label: () => t('notifs.vocaux') },
  { kind: 'file', icon: File, label: () => t('notifs.fichiers') },
];

// Par conversation : de quoi être prévenu (un interrupteur par type, toute la ligne se touche), puis
// les autorisations du téléphone. Utilisé dans l'onglet « Notifications » des réglages de la conversation.
export function NotificationsPanel({ contactKey }: { contactKey: string }) {
  const colors = useColors();
  const styles = useStyles();
  const [muted, setMuted] = useState(() => getMutedKinds(contactKey));

  const toggle = (kind: MessageKind, notify: boolean) => {
    const next = notify ? muted.filter((item) => item !== kind) : [...muted, kind];
    setMutedKinds(contactKey, next);
    setMuted(next);
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('notifs.parType')}</Text>
      <View style={styles.card}>
        {KINDS.map(({ kind, icon: Icon, label }, index) => {
          const on = !muted.includes(kind);
          return (
            <Pressable
              key={kind}
              onPress={() => toggle(kind, !on)}
              accessibilityRole="switch"
              accessibilityLabel={label()}
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [styles.row, index > 0 && styles.separator, pressed && styles.pressed]}
            >
              <Icon size={20} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.rowLabel}>{label()}</Text>
              {/* L'interrupteur ne fait que montrer l'état : c'est la ligne entière qui se touche. */}
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
                <Toggle value={on} onChange={(notify) => toggle(kind, notify)} label={label()} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('notifs.parTypeAide')}</Text>
      <Text style={styles.hint}>{t('notifs.dechiffrement')}</Text>

      <Text style={[styles.sectionTitle, styles.spaced]}>{t('notifs.telephone')}</Text>
      <View style={styles.card}>
        <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Settings size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.rowLabel}>{t('notifs.reglagesTelephone')}</Text>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>
      </View>
    </View>
  );
}

// L'ancien écran séparé, gardé pour la route « notifications » : le même panneau en pleine page.
export function NotificationSettingsScreen({ contactKey, name, onBack }: { contactKey: string; name: string; onBack: () => void }) {
  const styles = useStyles();
  return (
    <Screen>
      <Header title={t('notifs.titre')} subtitle={name} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <NotificationsPanel contactKey={contactKey} />
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
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  spaced: {
    marginTop: spacing.lg,
  },
  card: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
  },
  separator: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginHorizontal: 4,
  },
  pressed: {
    backgroundColor: colors.elevatedActive,
  },
}));
