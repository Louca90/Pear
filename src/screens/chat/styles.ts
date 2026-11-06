import { useMemo } from 'react';

import { createStyles, radius, spacing } from '../../theme';

// Styles utilisés par plusieurs composants de la conversation.
export const useSharedStyles = createStyles((colors) => ({
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
}));

// Styles partagés + styles propres au composant. `local` doit être stable (créé par createStyles ou StyleSheet).
export function useChatStyles<T extends object>(local: T) {
  const sharedStyles = useSharedStyles();
  return useMemo(() => ({ ...sharedStyles, ...local }), [sharedStyles, local]);
}
