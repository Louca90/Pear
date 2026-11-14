import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Reanimated, { interpolate, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { EASE } from '../motion';
import { GestureDetector, GestureHandlerRootView, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';

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
  const offset = useSharedValue(0);
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
    offset.set(withTiming(0, { duration: motion.small, easing: EASE }));
  };

  const gesture = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    maxPointers: 1,
    activeOffsetY: dir === 1 ? [-10000, 8] : [-8, 10000],
    failOffsetX: [-24, 24],
    // Pas permis au moment où le doigt se pose (pas en bas de la conversation, clavier ouvert…) : le
    // geste échoue tout de suite. Sinon il s'activait quand même au bout de 8 points et coupait le
    // défilement de la liste (reprendre le défilement après s'être arrêté devenait difficile).
    onTouchesDown: (event) => {
      allowed.current = !busyRef.current && latest.current.canPull();
      if (!allowed.current) GestureStateManager.fail(event.handlerTag);
    },
    onBegin: () => {
      allowed.current = !busyRef.current && latest.current.canPull();
    },
    onUpdate: (event) => {
      if (!allowed.current) return;
      const pulled = Math.max(0, Math.min(PULL_MAX, dir * event.translationY));
      offset.set(dir * pulled);
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
      offset.set(withTiming(dir * holding.distance, { duration: motion.small, easing: EASE }));
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
  offset: SharedValue<number>;
  // L'indicateur, posé dans l'espace que la liste découvre en se décalant.
  indicator: ReactNode;
  children: ReactNode;
};

// La zone qui se décale avec le doigt, et l'indicateur caché derrière elle.
export function PullView({ gesture, offset, indicator, children }: PullViewProps) {
  const shifted = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  return (
    <GestureHandlerRootView style={styles.flex}>
      {indicator}
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[styles.flex, shifted]}>{children}</Reanimated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

type PullPearProps = {
  offset: SharedValue<number>;
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
  // Par pas de 5 % : la poire ne se redessine pas à chaque point parcouru.
  useAnimatedReaction(
    () => Math.round(Math.max(0, Math.min(1, (dir * offset.get()) / PULL_THRESHOLD)) * 20) / 20,
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setProgress, next);
    },
  );
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(dir * offset.get(), [6, 36], [0, 1], 'clamp') }));
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(dir * offset.get(), [0, PULL_THRESHOLD], [0.7, 1], 'clamp') }] }));

  const state: PearState = busy ? 'searching' : kind === 'ripening' ? 'ripening' : progress > 0 ? 'bitten' : 'idle';
  const full = progress >= 1;
  return (
    <Reanimated.View pointerEvents="none" style={[styles2.pull, dir === 1 ? styles2.top : styles2.bottom, fade]}>
      <Reanimated.View style={grow}>
        <Pear height={36} color={full && kind === 'ripening' ? colors.signatureStrong : colors.text} state={state} progress={progress} />
      </Reanimated.View>
      {label && !busy ? <Text style={styles2.label}>{label(full)}</Text> : null}
    </Reanimated.View>
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
