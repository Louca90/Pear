import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { FilterSwatch } from '../../components/editor/FilterStrip';
import type { FilterId } from '../../components/editor/filters';
import { DURATION, popIn, popOut, timing } from '../../motion';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';

// Le dessin du déclencheur (les gestes restent dans CameraScreen) : un anneau blanc et un cœur.
// Photo : cœur blanc (ou le filtre choisi), qui se tasse puis revient à chaque prise.
// Vidéo : le cœur rougit dès le maintien, devient un carré arrondi pendant l'enregistrement, et un
// anneau rouge trace la durée autour (un tour par minute).
export const SHUTTER_SIZE = 84;
const RING_RADIUS = 38;
const RING_STROKE = 4;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CORE = 66;
const RECORD_CORE = 30;
const RECORD_RADIUS = 8;
// Le cœur se transforme par une échelle (fil natif, sans mise en page) : son arrondi est compté avant
// l'échelle, d'où la conversion.
const RECORD_SCALE = RECORD_CORE / CORE;
const RECORD_CORNER = RECORD_RADIUS / RECORD_SCALE;
const SHAPE_MS = 260;
const LAP_MS = 60_000;
// Tassement à la prise d'une photo : 260 ms en tout.
const SQUASH = 0.82;
const SQUASH_IN_MS = 90;
const SQUASH_OUT_MS = 170;

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

type Props = {
  filming: boolean;
  recording: boolean;
  // Secondes écoulées : seulement pour l'anneau quand les animations sont supprimées.
  elapsed: number;
  filter: FilterId;
  // Augmente à chaque photo : le cœur se tasse.
  shots: number;
};

export function ShutterFace({ filming, recording, elapsed, filter, shots }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const tint = useSharedValue(filming ? 1 : 0);
  const shape = useSharedValue(recording ? 1 : 0);
  const squash = useSharedValue(1);
  const lap = useSharedValue(0);

  useEffect(() => {
    tint.set(timing(filming ? 1 : 0, DURATION.small));
  }, [filming]);

  useEffect(() => {
    shape.set(timing(recording ? 1 : 0, SHAPE_MS));
    cancelAnimation(lap);
    if (!recording) return;
    lap.set(0);
    if (!reduced) lap.set(withRepeat(withTiming(1, { duration: LAP_MS, easing: Easing.linear }), -1, false));
  }, [recording, reduced]);

  // Animations supprimées : l'anneau avance seconde par seconde, sans glisser.
  useEffect(() => {
    if (recording && reduced) lap.set((elapsed % 60) / 60);
  }, [elapsed, recording, reduced]);

  useEffect(() => {
    if (!shots || reduced) return;
    squash.set(withSequence(timing(SQUASH, SQUASH_IN_MS), timing(1, SQUASH_OUT_MS)));
  }, [shots]);

  const light = colors.background;
  const red = colors.danger;
  const coreStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(tint.get(), [0, 1], [light, red]),
    borderRadius: interpolate(shape.get(), [0, 1], [CORE / 2, RECORD_CORNER]),
    transform: [{ scale: interpolate(shape.get(), [0, 1], [1, RECORD_SCALE]) * squash.get() }],
  }));
  const swatchStyle = useAnimatedStyle(() => ({ opacity: 1 - tint.get() }));
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - lap.get()),
    strokeOpacity: shape.get(),
  }));

  const center = SHUTTER_SIZE / 2;
  return (
    <>
      <Svg pointerEvents="none" width={SHUTTER_SIZE} height={SHUTTER_SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={center} cy={center} r={RING_RADIUS} fill="none" stroke={light} strokeWidth={RING_STROKE} />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={RING_RADIUS}
          fill="none"
          stroke={red}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          rotation={-90}
          origin={`${center}, ${center}`}
          animatedProps={ringProps}
        />
      </Svg>
      <Reanimated.View pointerEvents="none" style={[styles.core, coreStyle]}>
        {/* Le filtre choisi se voit au cœur du déclencheur, comme une lentille sur Snap. */}
        {filter !== 'none' && (
          <Reanimated.View style={swatchStyle}>
            <FilterSwatch id={filter} size={CORE} flat />
          </Reanimated.View>
        )}
      </Reanimated.View>
    </>
  );
}

// Le chrono de la vidéo : un point rouge qui clignote et la durée.
export function RecordingTimer({ label, top }: { label: string; top: number }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const blink = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    blink.set(withRepeat(withTiming(0.25, { duration: 500, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(blink);
  }, [reduced]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.get() }));
  return (
    <Reanimated.View entering={popIn()} exiting={popOut()} style={[styles.timer, { top }]}>
      <Reanimated.View style={[styles.timerDot, dotStyle]} />
      <Text style={styles.timerText}>{label}</Text>
    </Reanimated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  core: {
    width: CORE,
    height: CORE,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.onMedia,
  },
}));
