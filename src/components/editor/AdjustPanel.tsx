import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { t } from '../../i18n';
import { log } from '../../log';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';
import { ADJUSTMENTS, Adjustments, NO_ADJUSTMENTS } from './filters';

const OPEN_MS = 220;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const THUMB = 22;
// Près du milieu, le curseur se pose sur 0 (avec une petite vibration).
const SNAP = 0.06;

// Un curseur de -1 à 1, rempli depuis le milieu. Le doigt peut partir de n'importe où sur la piste.
function CenteredSlider({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const latest = useRef({ width, value, onChange });
  latest.current = { width, value, onChange };

  const fromX = (x: number) => {
    const { width: track, value: previous, onChange: change } = latest.current;
    if (track <= 0) return;
    let next = Math.max(-1, Math.min(1, (x / track) * 2 - 1));
    if (Math.abs(next) < SNAP) next = 0;
    if (next === 0 && previous !== 0) Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
    change(Math.round(next * 100) / 100);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: ({ nativeEvent }) => fromX(nativeEvent.locationX),
      onPanResponderMove: ({ nativeEvent }) => fromX(nativeEvent.locationX),
    }),
  ).current;

  const half = width / 2;
  const fillLeft = value < 0 ? half + value * half : half;
  const fillWidth = Math.abs(value) * half;

  return (
    <View
      style={styles.track}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: -100, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => onChange(Math.max(-1, Math.min(1, value + (nativeEvent.actionName === 'increment' ? 0.1 : -0.1))))}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.rail} />
      <View pointerEvents="none" style={[styles.middle, { left: half - 1 }]} />
      <View pointerEvents="none" style={[styles.fill, { left: fillLeft, width: fillWidth }]} />
      <View pointerEvents="none" style={[styles.thumb, { left: half + value * half - THUMB / 2 }]} />
    </View>
  );
}

type Props = { value: Adjustments; bottom: number; onChange: (value: Adjustments) => void; onClose: () => void };

// Luminosité, contraste, saturation, température : chaque curseur se voit tout de suite sur l'image.
export function AdjustPanel({ value, bottom, onChange, onClose }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: OPEN_MS * 0.8, easing: EASING, useNativeDriver: true }).start(onClose);
  };

  return (
    <Animated.View
      style={[
        styles.panel,
        { paddingBottom: bottom + spacing.md, opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] },
      ]}
    >
      {ADJUSTMENTS.map(({ key, label }) => (
        <View key={key} style={styles.row}>
          <View style={styles.labels}>
            <Text style={styles.label}>{t(label)}</Text>
            <Text style={styles.number}>{value[key] > 0 ? `+${Math.round(value[key] * 100)}` : Math.round(value[key] * 100)}</Text>
          </View>
          <CenteredSlider value={value[key]} label={t(label)} onChange={(next) => onChange({ ...value, [key]: next })} />
        </View>
      ))}
      <View style={styles.actions}>
        <Pressable onPress={() => onChange(NO_ADJUSTMENTS)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionLabel}>{t('editeur.reinitialiser')}</Text>
        </Pressable>
        <Pressable onPress={close} style={({ pressed }) => [styles.action, styles.done, pressed && styles.pressed]}>
          <Text style={[styles.actionLabel, { color: colors.text }]}>{t('editeur.termine')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.overlay,
  },
  row: {
    gap: 6,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.background,
  },
  number: {
    fontSize: 13,
    color: colors.onDarkMuted,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 32,
    justifyContent: 'center',
  },
  rail: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.onDarkTrack,
  },
  middle: {
    position: 'absolute',
    width: 2,
    height: 12,
    borderRadius: 1,
    backgroundColor: colors.onDarkMuted,
  },
  fill: {
    position: 'absolute',
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.background,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.background,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  action: {
    flex: 1,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  done: {
    backgroundColor: colors.background,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
  },
  pressed: {
    opacity: 0.6,
  },
}));
