import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';

import { getBlockedKeys, unblockKey } from '../chat/database';
import { Header, Screen } from '../components/ui';
import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

const FADE_MS = 220;

// Les clés bloquées : leurs demandes d'ajout sont ignorées. Débloquer permet de recevoir à nouveau
// une demande de cette personne.
export function BlockedScreen({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [blocked, setBlocked] = useState(getBlockedKeys);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [opacity]);

  const unblock = (key: string) => {
    unblockKey(key);
    setBlocked(getBlockedKeys());
  };

  return (
    <Screen>
      <Header title={t('reglages.bloques')} onBack={onBack} />
      <Animated.View style={[styles.flex, { opacity }]}>
        {blocked.length === 0 ? (
          <View style={styles.empty}>
            <ShieldCheck size={28} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.emptyText}>{t('reglages.aucunBloque')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {blocked.map((entry) => (
              <View key={entry.key} style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1}>
                    {entry.name || t('demandes.quelquun')}
                  </Text>
                  <Text style={styles.key} numberOfLines={1}>
                    {entry.key.slice(0, 12)}…
                  </Text>
                </View>
                <Pressable onPress={() => unblock(entry.key)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
                  <Text style={styles.buttonLabel}>{t('reglages.debloquer')}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  name: {
    fontSize: 16,
    color: colors.text,
  },
  key: {
    fontSize: 12,
    color: colors.textMuted,
  },
  button: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textMuted,
  },
}));
