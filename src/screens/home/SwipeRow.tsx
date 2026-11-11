import { ReactNode, useRef } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View } from 'react-native';
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
export function SwipeRow({ pinned, canMarkRead, onPin, onMarkRead, children }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const x = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  // Le PanResponder n'est créé qu'une fois : il lit les valeurs courantes par cette référence.
  const live = useRef({ canMarkRead, onPin, onMarkRead });
  live.current = { canMarkRead, onPin, onMarkRead };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderGrant: () => {
        armed.current = false;
      },
      onPanResponderMove: (_, g) => {
        const limit = live.current.canMarkRead ? -MAX_PULL : 0;
        const dx = Math.min(MAX_PULL, Math.max(limit, g.dx));
        x.setValue(dx);
        const past = swipeOutcome(dx, live.current.canMarkRead) !== null;
        if (past !== armed.current) {
          armed.current = past;
          if (past) haptics.select();
        }
      },
      onPanResponderRelease: (_, g) => {
        const outcome = swipeOutcome(g.dx, live.current.canMarkRead);
        Animated.timing(x, { toValue: 0, duration: BACK_MS, easing: EASING, useNativeDriver: true }).start();
        if (outcome === 'pin') live.current.onPin();
        else if (outcome === 'read') live.current.onMarkRead();
      },
      onPanResponderTerminate: () => {
        Animated.timing(x, { toValue: 0, duration: BACK_MS, easing: EASING, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const reveal = (sign: 1 | -1) =>
    x.interpolate({ inputRange: sign === 1 ? [0, SWIPE_THRESHOLD] : [-SWIPE_THRESHOLD, 0], outputRange: sign === 1 ? [0, 1] : [1, 0], extrapolate: 'clamp' });

  const action = (Icon: LucideIcon, sign: 1 | -1) => (
    <Animated.View style={[styles.action, sign === 1 ? styles.left : styles.right, { opacity: reveal(sign) }]}>
      <Icon size={22} color={colors.text} strokeWidth={1.75} />
    </Animated.View>
  );

  return (
    <View>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {action(pinned ? PinOff : Pin, 1)}
        {canMarkRead && action(CheckCheck, -1)}
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: colors.background }} {...responder.panHandlers}>
        {children}
      </Animated.View>
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
