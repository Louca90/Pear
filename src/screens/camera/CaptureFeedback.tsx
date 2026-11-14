import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { RoundFiltered } from '../../components/editor/FilterStrip';
import type { FilterId } from '../../components/editor/filters';
import { t } from '../../i18n';
import { DURATION, EASE, timing } from '../../motion';
import { createMediaStyles, spacing, useMediaColors } from '../../theme';

const FLASH_OPACITY = 0.85;
const FLASH_MS = 260;
export const LAST_SHOT_SIZE = 48;
const LAST_SHOT_RADIUS = 12;
const LAND_MS = 300;
const LAND_SCALE = 3;

// L'éclair blanc bref sur l'aperçu, à chaque photo. Supprimé avec les animations (pas d'éclair du tout).
export function PhotoFlash({ shots }: { shots: number }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!shots || reduced) return;
    opacity.set(withSequence(withTiming(FLASH_OPACITY, { duration: 0 }), timing(0, FLASH_MS)));
  }, [shots]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, style]} />;
}

// Appelée depuis le fil natif (animation d'entrée) : c'est un worklet.
function land(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// La miniature part du milieu de l'écran, trois fois plus grande, et se pose dans son coin.
function landFrom(dx: number, dy: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateX: dx }, { translateY: dy }, { scale: LAND_SCALE }] },
      animations: {
        opacity: withTiming(1, land(LAND_MS * 0.3)),
        transform: [{ translateX: withTiming(0, land(LAND_MS)) }, { translateY: withTiming(0, land(LAND_MS)) }, { scale: withTiming(1, land(LAND_MS)) }],
      },
    };
  };
}

type Props = {
  uri: string;
  filter: FilterId;
  // Pendant une vidéo, la miniature s'efface.
  hidden: boolean;
  // Distance du bas et du bord gauche de l'écran.
  bottom: number;
  left: number;
  onPress: () => void;
};

// La dernière photo, posée en bas à gauche : un appui la rouvre. Elle se pose quand l'écran de
// relecture se ferme (montée à ce moment-là).
export function LastShot({ uri, filter, hidden, bottom, left, onPress }: Props) {
  const styles = useStyles();
  const window = useWindowDimensions();
  const visible = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    visible.set(timing(hidden ? 0 : 1, DURATION.small));
  }, [hidden]);
  const fade = useAnimatedStyle(() => ({ opacity: visible.get() }));
  const centerX = left + LAST_SHOT_SIZE / 2;
  const centerY = window.height - bottom - LAST_SHOT_SIZE / 2;
  return (
    <Reanimated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.corner, { bottom, left }, fade]}>
      <Reanimated.View key={uri} entering={landFrom(window.width / 2 - centerX, window.height / 2 - centerY)}>
        <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('camera.revoirDernierePhoto')} style={styles.thumb}>
          <RoundFiltered id={filter} radius={LAST_SHOT_RADIUS}>
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </RoundFiltered>
        </Pressable>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  flash: {
    backgroundColor: colors.background,
  },
  corner: {
    position: 'absolute',
  },
  thumb: {
    width: LAST_SHOT_SIZE,
    height: LAST_SHOT_SIZE,
    borderRadius: LAST_SHOT_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.text,
  },
}));
