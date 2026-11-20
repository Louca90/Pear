import { useSyncExternalStore } from 'react';

// Il manque une autorisation recommandée ? Pas d'alerte : seulement un petit point discret sur
// l'onglet Profil et sur la ligne « Autorisations ».
let missing = false;
const listeners = new Set<() => void>();

export function setPermissionsMissing(value: boolean) {
  if (value === missing) return;
  missing = value;
  listeners.forEach((listener) => listener());
}

export function usePermissionsMissing() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => missing,
  );
}
