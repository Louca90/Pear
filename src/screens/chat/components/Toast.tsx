import { useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';
import { Check } from 'lucide-react-native';

import { createStyles, radius, spacing, useColors } from '../../../theme';

import { TOAST_VISIBLE_MS } from '../constants';

// Une petite annonce sous la barre du haut : elle descend, reste un instant, puis repart.
export function Toast({ text, token }: { text: string; token: number }) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.sequence([
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 240 }),
      Animated.delay(TOAST_VISIBLE_MS),
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [token, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}
    >
      <Check size={16} color={colors.onAccent} strokeWidth={2} />
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  toast: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.onAccent,
  },
}));
