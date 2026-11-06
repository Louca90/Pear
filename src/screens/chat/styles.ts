import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '../../theme';

// Styles utilisés par plusieurs composants de la conversation.
export const sharedStyles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  metaPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  hidden: {
    opacity: 0,
  },
  playButton: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: {
    fontSize: 12,
  },
});
