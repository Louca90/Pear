import { useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { usePullGesture } from '../../components/pull';

// Tirer pour actualiser (accueil) : la liste suit le doigt vers le bas depuis le haut, la poire se fait
// croquer, puis cherche pendant 900 ms. Voir components/pull.tsx.
export function usePullRefresh(onRefresh: () => void) {
  const top = useRef(true);
  const pull = usePullGesture({ dir: 1, canPull: () => top.current, onTrigger: onRefresh, hold: { distance: 60, ms: 900 } });
  return {
    ...pull,
    listProps: {
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        top.current = event.nativeEvent.contentOffset.y <= 2;
      },
      scrollEventThrottle: 16,
    },
  };
}
