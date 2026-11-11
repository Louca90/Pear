import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { haptics } from '../../haptics';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { t } from '../../i18n';
import { log } from '../../log';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';
import { clamp } from './layers';

const OPEN_MS = 220;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const FRAMES = 8;
const STRIP_HEIGHT = 56;
const HANDLE_WIDTH = 14;
const HANDLE_REACH = 36;
// Une vidéo découpée garde au moins une seconde.
export const MIN_TRIM = 1;

export type Trim = { start: number; end: number | null };

function formatTime(seconds: number) {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

type Props = {
  uri: string;
  duration: number;
  trim: Trim;
  // Le temps lu en ce moment (secondes), pour la tête de lecture.
  playhead: Animated.Value;
  bottom: number;
  onChange: (trim: Trim) => void;
  // Pendant qu'on tire une poignée : la vidéo s'arrête sur ce moment. null : elle repart du début gardé.
  onScrub: (time: number | null) => void;
  onClose: () => void;
};

// Découper le début et la fin d'une vidéo sur une frise d'images, comme sur Snap ou Instagram.
export function TrimPanel({ uri, duration, trim, playhead, bottom, onChange, onScrub, onClose }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { width: screenWidth } = useWindowDimensions();
  const [frames, setFrames] = useState<string[]>([]);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const stripWidth = screenWidth - spacing.lg * 2;
  const end = trim.end ?? duration;
  const toX = (time: number) => (time / duration) * stripWidth;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  // Les images de la frise, réparties sur toute la vidéo, chargées une seule fois.
  useEffect(() => {
    let cancelled = false;
    const times = Array.from({ length: FRAMES }, (_, index) => ((index + 0.5) / FRAMES) * duration * 1000);
    Promise.all(times.map((time) => getThumbnailAsync(uri, { time, quality: 0.4 }).then((frame) => frame.uri)))
      .then((uris) => !cancelled && setFrames(uris))
      .catch((e) => log.warn('frise', e));
    return () => {
      cancelled = true;
    };
  }, [uri, duration]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: OPEN_MS * 0.8, easing: EASING, useNativeDriver: true }).start(onClose);
  };

  // Le doigt prend la poignée la plus proche (début ou fin), qui suit sans croiser l'autre.
  const drag = useRef<{ handle: 'start' | 'end' | null; origin: number }>({ handle: null, origin: 0 });
  const latest = {
    begin: (x: number) => {
      const fromStart = Math.abs(x - toX(trim.start));
      const fromEnd = Math.abs(x - toX(end));
      const handle = Math.min(fromStart, fromEnd) > HANDLE_REACH ? null : fromStart <= fromEnd ? 'start' : 'end';
      drag.current = { handle, origin: handle === 'start' ? trim.start : end };
      if (handle) haptics.select();
    },
    update: (dx: number) => {
      const { handle, origin } = drag.current;
      if (!handle) return;
      const time = origin + (dx / stripWidth) * duration;
      if (handle === 'start') {
        const start = clamp(time, 0, end - MIN_TRIM);
        onChange({ ...trim, start });
        onScrub(start);
      } else {
        const next = clamp(time, trim.start + MIN_TRIM, duration);
        onChange({ ...trim, end: next >= duration - 0.05 ? null : next });
        onScrub(next);
      }
    },
    end: () => {
      if (drag.current.handle) onScrub(null);
      drag.current.handle = null;
    },
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    minDistance: 0,
    maxPointers: 1,
    onBegin: (event) => latestRef.current.begin(event.x),
    onUpdate: (event) => latestRef.current.update(event.translationX),
    onFinalize: () => latestRef.current.end(),
  });

  const startX = toX(trim.start);
  const endX = toX(end);
  const kept = end - trim.start;

  return (
    <Animated.View
      style={[styles.panel, { paddingBottom: bottom + spacing.md, opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}
    >
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(trim.start)}</Text>
        <Text style={styles.length}>{t('editeur.dureeGardee', { secondes: kept.toFixed(1) })}</Text>
        <Text style={styles.time}>{formatTime(end)}</Text>
      </View>

      <GestureDetector gesture={pan}>
        <View collapsable={false} style={[styles.strip, { width: stripWidth }]} accessibilityLabel={t('editeur.decouper')}>
          <View style={styles.frames}>
            {frames.map((frame, index) => (
              <Image key={index} source={{ uri: frame }} style={styles.frame} resizeMode="cover" />
            ))}
          </View>
          {/* Le début et la fin coupés, assombris. */}
          <View pointerEvents="none" style={[styles.cut, { left: 0, width: startX }]} />
          <View pointerEvents="none" style={[styles.cut, { left: endX, right: 0 }]} />
          <View pointerEvents="none" style={[styles.window, { left: startX, width: endX - startX }]}>
            <View style={[styles.handle, styles.handleStart]}>
              <View style={styles.grip} />
            </View>
            <View style={[styles.handle, styles.handleEnd]}>
              <View style={styles.grip} />
            </View>
          </View>
          <Animated.View
            pointerEvents="none"
            style={[styles.playhead, { transform: [{ translateX: playhead.interpolate({ inputRange: [0, duration], outputRange: [0, stripWidth], extrapolate: 'clamp' }) }] }]}
          />
        </View>
      </GestureDetector>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('editeur.reinitialiser')} onPress={() => onChange({ start: 0, end: null })} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionLabel}>{t('editeur.reinitialiser')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('editeur.termine')} onPress={close} style={({ pressed }) => [styles.action, styles.done, pressed && styles.pressed]}>
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
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  time: {
    fontSize: 13,
    color: colors.onDarkMuted,
    fontVariant: ['tabular-nums'],
  },
  length: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
  },
  strip: {
    height: STRIP_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  frames: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  frame: {
    flex: 1,
    height: STRIP_HEIGHT,
  },
  cut: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  window: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: colors.background,
    borderRadius: 10,
  },
  handle: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: HANDLE_WIDTH,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleStart: {
    left: 0,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
  },
  handleEnd: {
    right: 0,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
  },
  grip: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  playhead: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.background,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
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
