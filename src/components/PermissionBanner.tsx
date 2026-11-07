import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text } from 'react-native';
import { CircleAlert } from 'lucide-react-native';

import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

const FADE_MS = 240;

// Une autorisation a été retirée depuis la prise en main : un bandeau discret propose de la rétablir.
export function PermissionBanner({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: visible ? 1 : 0, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, progress]);

  if (!visible) return null;
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
        <CircleAlert size={18} color={colors.danger} strokeWidth={1.75} />
        <Text style={styles.text}>{t('priseEnMain.manque')}</Text>
      </Pressable>
    </Animated.View>
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
