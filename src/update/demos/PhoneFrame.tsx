import { ReactNode } from 'react';
import { View } from 'react-native';

import { createStyles, radius, spacing } from '../../theme';

// Cadre de téléphone réduit : les démos y rejouent de vrais composants de l'app, en boucle.
export function PhoneFrame({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.frame}>
      <View style={styles.notch} />
      <View style={styles.screen}>{children}</View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  frame: {
    width: 220,
    height: 190,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
    alignItems: 'center',
  },
  notch: {
    width: 44,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  screen: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
}));
