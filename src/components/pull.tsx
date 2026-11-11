import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';

import { PULL_MAX, PULL_THRESHOLD } from '../chat/ephemeral';
import { haptics } from '../haptics';
import { createStyles, motion, spacing, useColors } from '../theme';
import { Pear, PearState } from './Pear';

// Geste « tirer » commun à l'accueil (vers le bas) et à la conversation (vers le haut). Il passe par
// react-native-gesture-handler : une liste défilante prend les glissés avant les gestes de React Native
// (elle les garde même quand elle n'a plus rien à défiler dans ce sens), alors que le geste de
// gesture-handler s'active en même temps qu'elle. Le geste ne part que si `canPull` était vrai au
// moment où le doigt s'est posé.
// dir : 1 = vers le bas, -1 = vers le haut. `offset` vaut dir × distance (0 à 96 points).
type Options = {
  dir: 1 | -1;
  canPull: () => boolean;
  // Appelé au relâchement au-delà de 72 points.
  onTrigger: () => void;
  // Si fourni : l'actualisation garde la liste décalée de `distance` points pendant `ms`.
  hold?: { distance: number; ms: number };
};

export function usePullGesture({ dir, canPull, onTrigger, hold }: Options) {
  const offset = useRef(new Animated.Value(0)).current;
  const allowed = useRef(false);
  const armed = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ canPull, onTrigger, hold });
  latest.current = { canPull, onTrigger, hold };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const settle = () => {
    armed.current = false;
    Animated.timing(offset, { toValue: 0, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  };

  const gesture = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    maxPointers: 1,
    activeOffsetY: dir === 1 ? [-10000, 8] : [-8, 10000],
    failOffsetX: [-24, 24],
    onBegin: () => {
      allowed.current = !busyRef.current && latest.current.canPull();
    },
    onUpdate: (event) => {
      if (!allowed.current) return;
      const pulled = Math.max(0, Math.min(PULL_MAX, dir * event.translationY));
      offset.setValue(dir * pulled);
      const over = pulled >= PULL_THRESHOLD;
      if (over !== armed.current) {
        armed.current = over;
        haptics.select();
      }
    },
    onDeactivate: (event) => {
      if (!allowed.current) return;
      allowed.current = false;
      if (dir * event.translationY < PULL_THRESHOLD) return settle();
      armed.current = false;
      haptics.action();
      latest.current.onTrigger();
      const holding = latest.current.hold;
      if (!holding) return settle();
      busyRef.current = true;
      setBusy(true);
      Animated.timing(offset, { toValue: dir * holding.distance, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        busyRef.current = false;
        setBusy(false);
        settle();
      }, holding.ms);
    },
    onFinalize: () => {
      if (!busyRef.current) settle();
    },
  });

  return { offset, gesture, busy };
}

type PullViewProps = {
  gesture: ReturnType<typeof usePanGesture>;
  offset: Animated.Value;
  // L'indicateur, posé dans l'espace que la liste découvre en se décalant.
  indicator: ReactNode;
  children: ReactNode;
};

// La zone qui se décale avec le doigt, et l'indicateur caché derrière elle.
export function PullView({ gesture, offset, indicator, children }: PullViewProps) {
  return (
    <GestureHandlerRootView style={styles.flex}>
      {indicator}
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.flex, { transform: [{ translateY: offset }] }]}>{children}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

type PullPearProps = {
  offset: Animated.Value;
  dir: 1 | -1;
  // `ripening` : se remplit (éphémères). `bitten` : se fait croquer (actualiser).
  kind: 'ripening' | 'bitten';
  busy?: boolean;
  label?: (full: boolean) => string;
};

// La poire qui grandit avec la distance, dans l'espace ouvert par le décalage.
export function PullPear({ offset, dir, kind, busy, label }: PullPearProps) {
  const styles2 = useStyles();
  const colors = useColors();
  const [progress, setProgress] = useState(0);
  const distance: Animated.AnimatedInterpolation<number> = offset.interpolate({ inputRange: [-PULL_MAX, PULL_MAX], outputRange: dir === 1 ? [-PULL_MAX, PULL_MAX] : [PULL_MAX, -PULL_MAX] });

  useEffect(() => {
    // Par pas de 5 % : la poire ne se redessine pas à chaque point parcouru.
    const id = offset.addListener(({ value }) => {
      const next = Math.round(Math.max(0, Math.min(1, (dir * value) / PULL_THRESHOLD)) * 20) / 20;
      setProgress((current) => (current === next ? current : next));
    });
    return () => offset.removeListener(id);
  }, [offset, dir]);

  const state: PearState = busy ? 'searching' : kind === 'ripening' ? 'ripening' : progress > 0 ? 'bitten' : 'idle';
  const full = progress >= 1;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles2.pull, dir === 1 ? styles2.top : styles2.bottom, { opacity: distance.interpolate({ inputRange: [6, 36], outputRange: [0, 1], extrapolate: 'clamp' }) }]}
    >
      <Animated.View style={{ transform: [{ scale: distance.interpolate({ inputRange: [0, PULL_THRESHOLD], outputRange: [0.7, 1], extrapolate: 'clamp' }) }] }}>
        <Pear height={36} color={full && kind === 'ripening' ? colors.signatureStrong : colors.text} state={state} progress={progress} />
      </Animated.View>
      {label && !busy ? <Text style={styles2.label}>{label(full)}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });

const useStyles = createStyles((colors) => ({
  pull: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 80,
    alignItems: 'center',
    gap: 6,
  },
  top: {
    top: spacing.sm,
    justifyContent: 'flex-start',
  },
  bottom: {
    bottom: spacing.sm,
    justifyContent: 'flex-end',
  },
  label: {
    fontSize: 12,
    color: colors.textMuted,
  },
}));
