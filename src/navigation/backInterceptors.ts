import { useEffect, useRef } from 'react';

// Ce qui est ouvert dans une page (sélection de messages…) et se ferme au retour avant de quitter la
// page. Le dernier ouvert passe en premier.
const interceptors: (() => void)[] = [];

export function hasBackInterceptor() {
  return interceptors.length > 0;
}

// Ferme le dernier élément ouvert ; false s'il n'y en a aucun (le retour quitte alors la page).
export function interceptBack() {
  const close = interceptors[interceptors.length - 1];
  if (!close) return false;
  close();
  return true;
}

export function useBackInterceptor(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!active) return;
    const close = () => latest.current();
    interceptors.push(close);
    return () => {
      const index = interceptors.lastIndexOf(close);
      if (index >= 0) interceptors.splice(index, 1);
    };
  }, [active]);
}
