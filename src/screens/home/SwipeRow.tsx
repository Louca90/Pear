import { ReactNode, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Reanimated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { CheckCheck, LucideIcon, Pin, PinOff } from 'lucide-react-native';

import { haptics } from '../../haptics';
import { createStyles, radius, spacing, useColors } from '../../theme';
import { SWIPE_THRESHOLD, swipeOutcome } from './listFormat';

const MAX_PULL = 112;
const BACK_MS = 200;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

type Props = {
  pinned: boolean;
  canMarkRead: boolean;
  onPin: () => void;
  onMarkRead: () => void;
  children: ReactNode;
};

// Une ligne qu'on glisse : vers la droite elle épingle, vers la gauche elle marque comme lue. Une vibration légère
// prévient quand le seuil de 72 points est franchi (dans les deux sens), puis la ligne revient sans rebond.
// gesture-handler + Reanimated : la ligne suit le doigt sur le fil de l'interface ; un glissement
// vertical laisse défiler la liste.
export function SwipeRow({ pinned, canMarkRead, onPin, onMarkRead, children }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const x = useSharedValue(0);
  const armed = useSharedValue(false);
  const live = useRef({ onPin, onMarkRead });
  live.current = { onPin, onMarkRead };
  const select = () => haptics.select();
  const finish = (outcome: 'pin' | 'read' | null) => {
    if (outcome === 'pin') live.current.onPin();
    else if (outcome === 'read') live.current.onMarkRead();
  };

  const gesture = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet';
      armed.set(false);
    },
    onUpdate: (event) => {
      'worklet';
      const limit = canMarkRead ? -MAX_PULL : 0;
      const dx = Math.min(MAX_PULL, Math.max(limit, event.translationX));
      x.set(dx);
      const past = swipeOutcome(dx, canMarkRead) !== null;
      if (past !== armed.get()) {
        armed.set(past);
        if (past) scheduleOnRN(select);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      if (!event.canceled) scheduleOnRN(finish, swipeOutcome(event.translationX, canMarkRead));
    },
    onFinalize: () => {
      'worklet';
      x.set(withTiming(0, { duration: BACK_MS, easing: EASING }));
    },
  });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const pinStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [0, SWIPE_THRESHOLD], [0, 1], 'clamp') }));
  const readStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [-SWIPE_THRESHOLD, 0], [1, 0], 'clamp') }));

  const action = (Icon: LucideIcon, sign: 1 | -1) => (
    <Reanimated.View style={[styles.action, sign === 1 ? styles.left : styles.right, sign === 1 ? pinStyle : readStyle]}>
      <Icon size={22} color={colors.text} strokeWidth={1.75} />
    </Reanimated.View>
  );

  return (
    <View>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {action(pinned ? PinOff : Pin, 1)}
        {canMarkRead && action(CheckCheck, -1)}
      </View>
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[{ backgroundColor: colors.background }, rowStyle]}>{children}</Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  action: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  left: {
    left: spacing.md,
  },
  right: {
    right: spacing.md,
  },
}));
