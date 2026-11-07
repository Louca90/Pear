import { useSyncExternalStore } from 'react';

// La conversation visée par la dernière notification touchée. L'appui peut arriver avant que l'écran
// soit prêt (app fermée ou en arrière-plan) : il est mémorisé ici, puis App l'ouvre dès qu'elle peut.
let target: string | null = null;
// Cible particulière : la page des demandes d'ajout.
export const REQUESTS_TARGET = '#requests';
const listeners = new Set<() => void>();

export function setNotificationTarget(contact: unknown) {
  if (typeof contact !== 'string') return;
  target = contact;
  listeners.forEach((listener) => listener());
}

export function clearNotificationTarget() {
  target = null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationTarget() {
  return useSyncExternalStore(subscribe, () => target);
}
