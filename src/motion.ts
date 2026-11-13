import {
  Easing,
  LinearTransition,
  ReduceMotion,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

// Les animations sur le fil natif (Reanimated) : mêmes valeurs que `motion` dans theme.ts.
// Une seule courbe, jamais de rebond. Si Android a « supprimer les animations », chaque animation
// saute directement à sa fin (ReduceMotion.System).

export const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

export const DURATION = {
  press: 110,
  small: 180,
  screen: 180,
  mascot: 420,
} as const;

// Appelée depuis le fil natif (animations d'entrée et de sortie) : c'est un worklet.
function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// Une valeur qui va vers `toValue` avec la courbe de Pear.
export function timing(toValue: number, duration: number = DURATION.small) {
  'worklet';
  return withTiming(toValue, config(duration));
}

// Apparition : fondu et léger glissement (8 points par défaut, vers le haut si distance > 0).
export function enterUp(distance = 8, duration: number = DURATION.small, delay = 0): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const run = (value: number) => (delay > 0 ? withDelay(delay, withTiming(value, config(duration))) : withTiming(value, config(duration)));
    return {
      initialValues: { opacity: 0, transform: [{ translateY: distance }] },
      animations: { opacity: run(1), transform: [{ translateY: run(0) }] },
    };
  };
}

// Disparition : fondu et léger tassement, sans jamais descendre à une échelle nulle.
export function exitFade(duration: number = DURATION.small): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: { opacity: withTiming(0, config(duration)), transform: [{ scale: withTiming(0.96, config(duration)) }] },
    };
  };
}

// Apparition d'une pastille (badge non lu) : fondu et échelle 0,8 → 1.
export function popIn(duration: number = DURATION.small): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.8 }] },
      animations: { opacity: withTiming(1, config(duration)), transform: [{ scale: withTiming(1, config(duration)) }] },
    };
  };
}

export function popOut(duration: number = DURATION.small): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: { opacity: withTiming(0, config(duration)), transform: [{ scale: withTiming(0.8, config(duration)) }] },
    };
  };
}

// Une liste qui se réordonne : les éléments glissent à leur nouvelle place.
export const reflow = LinearTransition.duration(220).easing(EASE).reduceMotion(ReduceMotion.System);
