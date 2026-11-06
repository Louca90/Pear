import { useRef } from 'react';

import { DOUBLE_TAP_MS } from '../constants';

// Renvoie le gestionnaire d'appui : deux appuis rapprochés appellent onDoubleTap.
export function useDoubleTap(onDoubleTap?: () => void) {
  const lastTap = useRef(0);

  return () => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDoubleTap();
    } else {
      lastTap.current = now;
    }
  };
}
