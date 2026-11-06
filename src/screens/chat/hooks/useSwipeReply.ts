import { useRef } from 'react';
import { Animated, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Message } from '../../../chat/database';

import { SWIPE_MAX, SWIPE_REPLY, SWIPE_START } from '../constants';
import { log } from '../../../log';

// Glisser une bulle sur le côté pour y répondre.
export function useSwipeReply(message: Message, mine: boolean, onReply?: (message: Message) => void) {
  const swipe = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  // Le PanResponder est créé une seule fois : il lit toujours les valeurs du dernier rendu, jamais
  // celles du premier (ouverture depuis une notification, message mis à jour, etc.).
  const latest = useRef({ message, onReply, direction: mine ? -1 : 1 });
  // Mon message glisse vers la gauche, celui de l'autre vers la droite.
  latest.current = { message, onReply, direction: mine ? -1 : 1 };
  const reset = () => {
    armed.current = false;
    Animated.spring(swipe, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start();
  };
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !!latest.current.onReply && gesture.dx * latest.current.direction > SWIPE_START && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        const { direction } = latest.current;
        const distance = Math.max(0, Math.min(SWIPE_MAX, gesture.dx * direction));
        swipe.setValue(distance * direction);
        const reached = distance >= SWIPE_REPLY;
        if (reached !== armed.current) {
          armed.current = reached;
          if (reached) Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
        }
      },
      onPanResponderRelease: () => {
        if (armed.current) latest.current.onReply?.(latest.current.message);
        reset();
      },
      onPanResponderTerminate: reset,
    }),
  ).current;

  return { swipe, panHandlers: swipeResponder.panHandlers };
}
