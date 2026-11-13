import { useEffect } from 'react';
import { cancelAnimation, Easing, useSharedValue, withTiming } from 'react-native-reanimated';

// Le lecteur ne donne sa position que toutes les 200 à 250 ms : affichée telle quelle, la barre avance
// par sauts. Entre deux nouvelles, la position continue d'avancer sur le fil natif, à la vitesse de
// lecture, jusqu'à là où elle sera à la prochaine nouvelle. Chaque nouvelle recale la course.
// position : 0 à 1. speed : part de la durée parcourue par seconde (0 en pause). dragging : position
// sous le doigt, qui prime.
const AHEAD_MS = 300;

export function useSmoothProgress(position: number, speed: number, dragging: number | null) {
  const shown = useSharedValue(position);
  useEffect(() => {
    cancelAnimation(shown);
    if (dragging !== null) {
      shown.set(dragging);
      return;
    }
    // Un vrai saut (déplacement, début, fin) : on s'y place directement, sans glisser à rebours.
    const drift = Math.abs(shown.get() - position);
    if (speed <= 0 || drift > Math.max(0.02, speed * 0.6)) shown.set(position);
    if (speed > 0) {
      const target = Math.min(1, position + (speed * AHEAD_MS) / 1000);
      shown.set(withTiming(target, { duration: AHEAD_MS, easing: Easing.linear }));
    }
  }, [position, speed, dragging]);
  return shown;
}
