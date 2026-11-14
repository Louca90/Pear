import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { haptics } from '../../haptics';

import type { WideLens } from '../../../modules/pear-native/camera';
import { t } from '../../i18n';
import { DURATION, timing } from '../../motion';
import { createMediaStyles, radius, useMediaColors } from '../../theme';

const PILL = 38;
// La pastille active grossit légèrement (sur le fil natif, sans toucher à la mise en page).
const ACTIVE_SCALE = 1.14;
// Fond des pastilles : le voile du thème, plus léger pour les inactives.
const IDLE_BACKDROP = 0.6;

export type ZoomLevel = { id: 'wide' | '1' | '2'; value: number; zoom: number; lens: string | null };

// 0,6 → « 0,6 » ; 1 → « 1 » ; 1,43 → « 1,4 ».
function format(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace('.', ',');
}

export function zoomLevels(wide: WideLens | null, maxZoom: number): ZoomLevel[] {
  const levels: ZoomLevel[] = [];
  if (wide) levels.push({ id: 'wide', value: wide.label, zoom: wide.zoom, lens: wide.cameraId });
  levels.push({ id: '1', value: 1, zoom: 1, lens: null });
  if (maxZoom >= 2) levels.push({ id: '2', value: 2, zoom: 2, lens: null });
  return levels;
}

// La pastille du niveau en cours : l'ultra grand-angle, ×1 jusqu'à ×2, puis ×2 et au-delà.
export function activeLevel(levels: ZoomLevel[], wide: WideLens | null, zoom: number, lens: string | null): ZoomLevel['id'] {
  if (wide && ((wide.cameraId && lens === wide.cameraId) || (!wide.cameraId && zoom <= wide.zoom + 0.05))) return 'wide';
  return zoom >= 1.95 && levels.some((level) => level.id === '2') ? '2' : '1';
}

// Active : elle grossit un peu, son fond fonce et son libellé passe en couleur signature claire.
function Pill({ level, active, zoom, lens, onPress }: { level: ZoomLevel; active: boolean; zoom: number; lens: string | null; onPress: () => void }) {
  const colors = useMediaColors();
  const styles = useStyles();
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.set(timing(active ? 1 : 0, DURATION.small));
  }, [active]);
  const idleText = colors.onMedia;
  const activeText = colors.signature;
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + on.get() * (ACTIVE_SCALE - 1) }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: IDLE_BACKDROP + on.get() * (1 - IDLE_BACKDROP) }));
  const labelStyle = useAnimatedStyle(() => ({ color: interpolateColor(on.get(), [0, 1], [idleText, activeText]) }));
  // Sur l'objectif ultra grand-angle séparé, le zoom de cet objectif multiplie son propre rapport.
  const shown = !active ? level.value : level.id === 'wide' && lens ? level.value * zoom : zoom;
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('camera.zoom', { valeur: format(level.value) })} accessibilityState={{ selected: active }}>
      <Reanimated.View style={[styles.pill, pillStyle]}>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <Reanimated.Text style={[styles.label, active && styles.labelActive, labelStyle]}>{active ? `${format(shown)}×` : format(level.value)}</Reanimated.Text>
      </Reanimated.View>
    </Pressable>
  );
}

type Props = { levels: ZoomLevel[]; active: ZoomLevel['id']; zoom: number; lens: string | null; bottom: number; onChoose: (level: ZoomLevel) => void };

export function ZoomBar({ levels, active, zoom, lens, bottom, onChoose }: Props) {
  const styles = useStyles();
  if (levels.length < 2) return null;
  return (
    <View pointerEvents="box-none" style={[styles.bar, { bottom }]}>
      <View style={styles.track}>
        {levels.map((level) => (
          <Pill
            key={level.id}
            level={level}
            active={level.id === active}
            zoom={zoom}
            lens={lens}
            onPress={() => {
              haptics.select();
              onChoose(level);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 4,
  },
  pill: {
    width: PILL,
    height: PILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  labelActive: {
    fontWeight: '700',
  },
}));
