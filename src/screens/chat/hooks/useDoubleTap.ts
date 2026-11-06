import { useEffect, useRef } from 'react';

import { DOUBLE_TAP_MS } from '../constants';

// Renvoie le gestionnaire d'appui : deux appuis rapprochés appellent onDoubleTap. Avec onSingleTap,
// un appui seul n'est confirmé qu'une fois la fenêtre du double appui passée.
export function useDoubleTap(onDoubleTap?: () => void, onSingleTap?: () => void) {
  const lastTap = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ onDoubleTap, onSingleTap });
  latest.current = { onDoubleTap, onSingleTap };

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  return () => {
    const { onDoubleTap: double, onSingleTap: single } = latest.current;
    const now = Date.now();
    if (double && now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      double();
      return;
    }
    lastTap.current = now;
    if (!single) return;
    if (!double) {
      single();
      return;
    }
    pending.current = setTimeout(() => {
      pending.current = null;
      latest.current.onSingleTap?.();
    }, DOUBLE_TAP_MS);
  };
}
