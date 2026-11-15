import { ReactNode, useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';

import { timing } from '../../motion';

// Un élément qu'on déplace au doigt et qui, lâché, glisse vers la place la plus proche parmi `slots`
// (coins de l'écran pour la vignette vidéo, haut ou bas pour la pastille d'appel). L'élan du geste
// compte : un lancer vers un coin l'y envoie. Courbe douce, sans rebond. Un simple appui appelle onTap.

export type Slot = { x: number; y: number };

const SNAP_MS = 260;
// Combien de temps d'élan on projette pour choisir la place (secondes).
const THROW = 0.18;

export function SnapDraggable({
  slots,
  initial = 0,
  onTap,
  style,
  children,
}: {
  slots: Slot[];
  initial?: number;
  onTap?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const start = slots[Math.min(initial, slots.length - 1)] ?? { x: 0, y: 0 };
  const x = useSharedValue(start.x);
  const y = useSharedValue(start.y);
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const targets = useSharedValue(slots);
  const current = useSharedValue(initial);

  // L'écran change de taille (fenêtre flottante, rotation) : on reste à la même place relative.
  useEffect(() => {
    targets.set(slots);
    const slot = slots[Math.min(current.get(), slots.length - 1)];
    if (slot) {
      x.set(timing(slot.x, SNAP_MS));
      y.set(timing(slot.y, SNAP_MS));
    }
  }, [slots, targets, current, x, y]);

  const pan = usePanGesture({
    minDistance: 4,
    onBegin: () => {
      'worklet';
      fromX.set(x.get());
      fromY.set(y.get());
    },
    onActivate: () => {
      'worklet';
      lifted.set(timing(1, 120));
    },
    onUpdate: (event) => {
      'worklet';
      x.set(fromX.get() + event.translationX);
      y.set(fromY.get() + event.translationY);
    },
    onDeactivate: (event) => {
      'worklet';
      const aimX = x.get() + event.velocityX * THROW;
      const aimY = y.get() + event.velocityY * THROW;
      const list = targets.get();
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < list.length; i += 1) {
        const distance = (list[i].x - aimX) ** 2 + (list[i].y - aimY) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      current.set(best);
      x.set(timing(list[best].x, SNAP_MS));
      y.set(timing(list[best].y, SNAP_MS));
    },
    onFinalize: () => {
      'worklet';
      lifted.set(timing(0, 160));
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: () => onTap?.(),
  });
  const gesture = useCompetingGestures(pan, tap);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: 1 + 0.04 * lifted.get() }],
    shadowOpacity: 0.25 * lifted.get(),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View collapsable={false} style={[{ position: 'absolute', left: 0, top: 0 }, style, animated]}>
        {children}
      </Reanimated.View>
    </GestureDetector>
  );
}
