import { log } from '../log';

// Mesure de l'ouverture de l'appareil photo (lot 11) : de la demande d'ouverture (onglet choisi) à la
// première image. Écrit dans le journal, lisible aussi dans le Diagnostic.
let requestedAt = 0;

export function markCameraRequested() {
  requestedAt = Date.now();
}

export function logCameraStep(step: string) {
  if (!requestedAt) return;
  log.info('caméra', `${step} après ${Date.now() - requestedAt} ms`);
}
