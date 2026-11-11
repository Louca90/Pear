import { useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';

import { createStyles, motion, spacing, useColors } from '../theme';
import { Pear } from './Pear';

// Une liste vide : la poire au repos (elle respire à peine) et une phrase, qui arrivent en fondu.
export function EmptyState({ label }: { label: string }) {
  const colors = useColors();
  const styles = useStyles();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [appear]);
  return (
    <Animated.View style={[styles.empty, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      <Pear height={56} color={colors.textMuted} state="resting" />
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg * 2,
  },
  label: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
}));
