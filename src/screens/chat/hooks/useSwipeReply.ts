import { useRef } from 'react';
import { Animated, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Message } from '../../../chat/database';

import { SWIPE_MAX, SWIPE_REPLY, SWIPE_START } from '../constants';

// Glisser une bulle sur le côté pour y répondre.
export function useSwipeReply(message: Message, mine: boolean, onReply?: (message: Message) => void) {
  // Mon message glisse vers la gauche, celui de l'autre vers la droite.
  const direction = mine ? -1 : 1;
  const swipe = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const reply = useRef(onReply);
  reply.current = onReply;
  const reset = () => {
    armed.current = false;
    Animated.spring(swipe, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start();
  };
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx * direction > SWIPE_START && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        const distance = Math.max(0, Math.min(SWIPE_MAX, gesture.dx * direction));
        swipe.setValue(distance * direction);
        const reached = distance >= SWIPE_REPLY;
        if (reached !== armed.current) {
          armed.current = reached;
          if (reached) Haptics.selectionAsync().catch((e) => console.warn('Pear vibration :', e));
        }
      },
      onPanResponderRelease: () => {
        if (armed.current) reply.current?.(message);
        reset();
      },
      onPanResponderTerminate: reset,
    }),
  ).current;

  return { swipe, panHandlers: swipeResponder.panHandlers };
}
