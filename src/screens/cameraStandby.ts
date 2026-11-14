import { useSyncExternalStore } from 'react';

import { markCameraRequested } from './cameraTiming';

// L'écran de l'appareil photo reste construit en permanence (caché, caméra éteinte) : l'ouvrir n'a plus
// qu'à allumer la caméra. Avant, chaque ouverture reconstruisait tout l'écran et relisait l'autorisation
// (0,8 à 1 s sur l'A33) avant même de commencer à ouvrir la caméra.
// La caméra est allumée quand l'onglet est affiché, pendant un moment après l'avoir quitté (y revenir
// est instantané), et dès que le doigt touche l'onglet ou glisse vers lui (« réveil »).

const WAKE_MS = 2500;

let shown = false;
// L'onglet est la page affichée (barres d'état claires) : pas seulement allumé en coulisse.
let visible = false;
let woken = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const isLive = () => shown || woken;
const emit = () => listeners.forEach((listener) => listener());

// Fixé par App : onglet affiché ou encore « chaud » (value), et onglet réellement à l'écran (onScreen).
export function setCameraShown(value: boolean, onScreen: boolean) {
  const before = isLive();
  const changed = visible !== onScreen;
  visible = onScreen;
  shown = value;
  if (value && wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
    woken = false;
  }
  if (changed || isLive() !== before) emit();
}

// Le doigt va vers l'appareil photo : la caméra commence à s'ouvrir sans attendre l'écran. Si l'onglet
// n'est finalement pas ouvert, elle se rééteint seule.
export function wakeCamera() {
  if (shown) return;
  const before = isLive();
  // La mesure du démarrage part du doigt posé.
  if (!before) markCameraRequested();
  woken = true;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    woken = false;
    if (!shown) emit();
  }, WAKE_MS);
  if (isLive() !== before) emit();
}

export const isCameraLive = isLive;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useCameraLive() {
  return useSyncExternalStore(subscribe, isLive);
}

export function useCameraVisible() {
  return useSyncExternalStore(subscribe, () => visible);
}
