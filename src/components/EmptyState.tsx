import { useEffect, useRef } from 'react';
import { Text } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { enterUp } from '../motion';

import { createStyles, motion, spacing, useColors } from '../theme';
import { Pear } from './Pear';

// Une liste vide : la poire au repos (elle respire à peine) et une phrase, qui arrivent en fondu.
export function EmptyState({ label }: { label: string }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Reanimated.View entering={enterUp(8, motion.small)} style={styles.empty}>
      <Pear height={56} color={colors.textMuted} state="resting" />
      <Text style={styles.label}>{label}</Text>
    </Reanimated.View>
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
