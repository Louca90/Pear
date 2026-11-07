import { getDatabase, onValue, ref } from '@react-native-firebase/database';

import { log } from './log';

// L'heure de référence de Pear (lot 8.9) : celle du serveur Firebase, pas l'horloge du téléphone, pour
// qu'un téléphone mal réglé n'affiche pas des durées fausses. Firebase donne l'écart entre les deux
// (.info/serverTimeOffset) ; on le garde en mémoire et il se met à jour tout seul.
let offset = 0;
let watching = false;

function watch() {
  if (watching) return;
  watching = true;
  try {
    onValue(ref(getDatabase(), '.info/serverTimeOffset'), (snapshot) => {
      const value = snapshot.val();
      if (typeof value === 'number' && Number.isFinite(value)) offset = value;
    });
  } catch (e) {
    log.warn('heure du serveur', e);
  }
}

// Millisecondes UTC, corrigées de l'écart avec le serveur. L'affichage se fait en fuseau Europe/Paris.
export function parisNow(): number {
  watch();
  return Date.now() + offset;
}
