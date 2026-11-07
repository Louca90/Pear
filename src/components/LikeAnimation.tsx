import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { Heart } from 'lucide-react-native';

const HEART_MS = 700;
const MAX_HEARTS = 3;
const HEART_COLOR = '#FF3B5C';

// « Réduire les animations » du système : un simple fondu, sans mouvement.
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

// Un cœur : il grandit en douceur (sans dépasser sa taille), légèrement penché, puis monte en s'effaçant.
function FloatingHeart({ size, onDone }: { size: number; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const tilt = useRef(`${Math.round(Math.random() * 24 - 12)}deg`).current;
  const still = useRef(reduceMotion).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: HEART_MS, easing: Easing.linear, useNativeDriver: true }).start(onDone);
  }, [progress, onDone]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.heart,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0, 1, 1, 0] }),
          transform: still
            ? []
            : [
                { translateY: progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, -size * 0.9], easing: Easing.in(Easing.quad) }) },
                { scale: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1, 1], easing: Easing.out(Easing.cubic) }) },
                { rotate: tilt },
              ],
        },
      ]}
    >
      <Heart size={size} color={HEART_COLOR} fill={HEART_COLOR} strokeWidth={1.5} />
    </Animated.View>
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
export function useReactionAppear(visible: boolean) {
  const appear = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) setShown(true);
    Animated.timing(appear, { toValue: visible ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && !visible) setShown(false);
    });
  }, [visible, appear]);
  const style = {
    opacity: appear,
    transform: reduceMotion ? [] : [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  };
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
