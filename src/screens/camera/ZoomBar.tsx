import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import type { WideLens } from '../../../modules/pear-native/camera';
import { t } from '../../i18n';
import { log } from '../../log';
import { spacing } from '../../theme';

const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const PILL = 34;
const PILL_ACTIVE = 42;

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

function Pill({ level, active, zoom, lens, onPress }: { level: ZoomLevel; active: boolean; zoom: number; lens: string | null; onPress: () => void }) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: active ? 1 : 0, duration: 180, easing: EASING, useNativeDriver: false }).start();
  }, [active, progress]);
  const size = progress.interpolate({ inputRange: [0, 1], outputRange: [PILL, PILL_ACTIVE] });
  // Sur l'objectif ultra grand-angle séparé, le zoom de cet objectif multiplie son propre rapport.
  const shown = !active ? level.value : level.id === 'wide' && lens ? level.value * zoom : zoom;
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('camera.zoom', { valeur: format(level.value) })} accessibilityState={{ selected: active }}>
      <Animated.View style={[styles.pill, { width: size, height: size, borderRadius: PILL_ACTIVE / 2, backgroundColor: progress.interpolate({ inputRange: [0, 1], outputRange: ['rgba(0, 0, 0, 0.35)', 'rgba(0, 0, 0, 0.6)'] }) }]}>
        <Text style={[styles.label, active && styles.labelActive]}>{active ? `${format(shown)}×` : format(level.value)}</Text>
      </Animated.View>
    </Pressable>
  );
}

type Props = { levels: ZoomLevel[]; active: ZoomLevel['id']; zoom: number; lens: string | null; bottom: number; onChoose: (level: ZoomLevel) => void };

export function ZoomBar({ levels, active, zoom, lens, bottom, onChoose }: Props) {
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
              Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
              onChoose(level);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  labelActive: {
    fontSize: 13,
    fontWeight: '700',
  },
});
