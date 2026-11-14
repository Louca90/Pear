import { useRef } from 'react';
import { usePanGesture } from 'react-native-gesture-handler';
import { Easing, ReduceMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Message } from '../../../chat/database';
import { haptics } from '../../../haptics';

import { SWIPE_MAX, SWIPE_REPLY, SWIPE_START } from '../constants';

const BACK = { duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1), reduceMotion: ReduceMotion.System };
// Hors d'atteinte : le geste ne démarre jamais dans ce sens.
const NEVER = 10000;

// Glisser une bulle sur le côté pour y répondre (gesture-handler + Reanimated : la bulle suit le doigt
// sur le fil de l'interface). Mon message glisse vers la gauche, celui de l'autre vers la droite ; un
// glissement vertical laisse défiler la conversation.
export function useSwipeReply(message: Message, mine: boolean, onReply?: (message: Message) => void) {
  const swipe = useSharedValue(0);
  const armed = useSharedValue(false);
  // Les rappels lisent le message et la fonction du dernier rendu.
  const latest = useRef({ message, onReply });
  latest.current = { message, onReply };
  const direction = mine ? -1 : 1;
  const select = () => haptics.select();
  const reply = () => latest.current.onReply?.(latest.current.message);

  const gesture = usePanGesture({
    enabled: !!onReply,
    activeOffsetX: direction === 1 ? [-NEVER, SWIPE_START] : [-SWIPE_START, NEVER],
    failOffsetY: [-SWIPE_START, SWIPE_START],
    onUpdate: (event) => {
      'worklet';
      // Libre jusqu'au seuil, puis freiné : la bulle résiste de plus en plus jusqu'au maximum.
      const raw = Math.max(0, event.translationX * direction);
      const distance = raw <= SWIPE_REPLY ? raw : Math.min(SWIPE_MAX, SWIPE_REPLY + (raw - SWIPE_REPLY) * 0.35);
      swipe.set(distance * direction);
      const reached = distance >= SWIPE_REPLY;
      if (reached !== armed.get()) {
        armed.set(reached);
        if (reached) scheduleOnRN(select);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      // Geste repris par le défilement ou interrompu : pas de réponse.
      if (armed.get() && !event.canceled) scheduleOnRN(reply);
    },
    onFinalize: () => {
      'worklet';
      armed.set(false);
      swipe.set(withTiming(0, BACK));
    },
  });

  return { swipe, gesture };
}
