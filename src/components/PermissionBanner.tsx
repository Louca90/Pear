import { useEffect, useRef } from 'react';
import { Pressable, Text } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { CircleAlert } from 'lucide-react-native';

import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

const FADE_MS = 240;

// Une autorisation a été retirée depuis la prise en main : un bandeau discret propose de la rétablir.
export function PermissionBanner({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useSharedValue(visible ? 1 : 0);
  const style = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ translateY: -8 * (1 - progress.get()) }] }));

  useEffect(() => {
    progress.set(withTiming(visible ? 1 : 0, { duration: FADE_MS, easing: Easing.out(Easing.cubic) }));
  }, [visible, progress]);

  if (!visible) return null;
  return (
    <Reanimated.View style={style}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
        <CircleAlert size={18} color={colors.danger} strokeWidth={1.75} />
        <Text style={styles.text}>{t('priseEnMain.manque')}</Text>
      </Pressable>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  text: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
}));
