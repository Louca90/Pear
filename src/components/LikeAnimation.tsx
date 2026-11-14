import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Reanimated, { Easing, interpolate, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Heart } from 'lucide-react-native';
import { fixed } from '../theme';

const HEART_MS = 700;
const MAX_HEARTS = 3;
const HEART_COLOR = fixed.heart;
const RISE = Easing.in(Easing.quad);
const GROW = Easing.out(Easing.cubic);

// Un cœur : il grandit en douceur (sans dépasser sa taille), légèrement penché, puis monte en s'effaçant.
// « Réduire les animations » du système : un simple fondu, sans mouvement.
function FloatingHeart({ size, onDone }: { size: number; onDone: () => void }) {
  const progress = useSharedValue(0);
  const tilt = useRef(`${Math.round(Math.random() * 24 - 12)}deg`).current;
  const still = useReducedMotion();

  useEffect(() => {
    progress.set(
      withTiming(1, { duration: HEART_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
  }, [progress, onDone]);

  const style = useAnimatedStyle(() => {
    const p = progress.get();
    const opacity = interpolate(p, [0, 0.15, 0.6, 1], [0, 1, 1, 0], 'clamp');
    if (still) return { opacity };
    const translateY = p < 0.55 ? 0 : -size * 0.9 * RISE((p - 0.55) / 0.45);
    const scale = p < 0.3 ? 0.3 + 0.7 * GROW(p / 0.3) : 1;
    return { opacity, transform: [{ translateY }, { scale }, { rotate: tilt }] };
  });

  return (
    <Reanimated.View pointerEvents="none" style={[styles.heart, style]}>
      <Heart size={size} color={HEART_COLOR} fill={HEART_COLOR} strokeWidth={1.5} />
    </Reanimated.View>
  );
}

// Les cœurs d'un like : chaque nouveau `token` en lance un (3 au plus en même temps).
export function LikeBurst({ token, size = 22, style }: { token: number; size?: number; style?: ViewStyle }) {
  const [hearts, setHearts] = useState<number[]>([]);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!token) return;
    setHearts((current) => [...current, token].slice(-MAX_HEARTS));
  }, [token]);

  if (hearts.length === 0) return null;
  return (
    <View pointerEvents="none" style={[styles.burst, style]}>
      {hearts.map((id) => (
        <FloatingHeart key={id} size={size} onDone={() => setHearts((current) => current.filter((value) => value !== id))} />
      ))}
    </View>
  );
}

// Badge de réaction : apparaît en fondu en grandissant un peu (sans rebond), disparaît en rétrécissant.
// Rien ne s'anime à l'apparition d'une bulle : seulement quand une réaction arrive ou s'en va.
export function useReactionAppear(visible: boolean) {
  const appear = useSharedValue(visible ? 1 : 0);
  const [shown, setShown] = useState(visible);
  const still = useReducedMotion();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (visible) setShown(true);
    const hide = () => setShown(false);
    appear.set(
      withTiming(visible ? 1 : 0, { duration: 220, easing: GROW }, (finished) => {
        if (finished && !visible) scheduleOnRN(hide);
      }),
    );
  }, [visible, appear]);
  const style = useAnimatedStyle(() => ({ opacity: appear.get(), transform: still ? [] : [{ scale: 0.6 + 0.4 * appear.get() }] }));
  return { shown, style };
}

const styles = StyleSheet.create({
  burst: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    position: 'absolute',
  },
});
