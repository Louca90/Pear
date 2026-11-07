import { ComponentRef, useEffect, useRef } from 'react';
import { Animated, Easing, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { t } from '../../i18n';
import { log } from '../../log';
import { createMediaStyles, radius, spacing } from '../../theme';
import { lockTabSwipe } from '../tabSwipeLock';
import { FilteredView } from './FilteredView';
import { FILTERS, FilterId, NO_ADJUSTMENTS, presetOf, stepsOf } from './filters';
import type { StampKind } from './stamps';

// Tous les filtres, dans l'ordre de l'éditeur : Original, les marques, puis les couleurs.
export const CAMERA_FILTERS = FILTERS;

const ITEM_WIDTH = 66;
const SWATCH_SIZE = 52;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const HIDE_MS = 180;

// Un petit paysage en aplats (ciel, soleil, nuage, collines) : assez de couleurs différentes, et du
// blanc, pour que chaque filtre se voie (le noir et blanc grise, le chaud dore le ciel, le fané le voile…).
function Scene({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 52 52">
      <Rect width={52} height={52} fill="#7FBDF0" />
      <Circle cx={36} cy={16} r={7} fill="#FFC93C" />
      <Circle cx={14} cy={18} r={4.5} fill="#FFFFFF" />
      <Circle cx={19} cy={16} r={5.5} fill="#FFFFFF" />
      <Circle cx={24} cy={19} r={4} fill="#FFFFFF" />
      <Path d="M0 36 Q14 24 30 33 T52 30 V52 H0 Z" fill="#7CC36A" />
      <Path d="M0 44 Q20 34 52 42 V52 H0 Z" fill="#2E8B4A" />
      <Rect x={33} y={36} width={8} height={7} fill="#E5483B" />
    </Svg>
  );
}

// Les marques : un aperçu du texte lui-même, clair sur fond sombre (orange pour la pellicule).
function StampSample({ kind, size }: { kind: StampKind; size: number }) {
  const styles = useStyles();
  if (kind === 'time') return <Text style={[styles.stampText, styles.stampTime, { fontSize: size * 0.3 }]}>12:30</Text>;
  if (kind === 'date') return <Text style={[styles.stampText, styles.stampDate, { fontSize: size * 0.26 }]}>{`7
nov.`}</Text>;
  return <Text style={[styles.stampText, styles.stampFilm, { fontSize: size * 0.24 }]}>'26</Text>;
}

export function FilterSwatch({ id, size }: { id: FilterId; size: number }) {
  const styles = useStyles();
  const preset = presetOf(id);
  return (
    <View style={[styles.swatch, { width: size, height: size, borderRadius: size / 2 }, preset.stamp && styles.swatchStamp]}>
      {preset.stamp ? (
        <StampSample kind={preset.stamp} size={size} />
      ) : (
        <FilteredView steps={stepsOf(id, NO_ADJUSTMENTS)} style={StyleSheet.absoluteFill}>
          <Scene size={size} />
        </FilteredView>
      )}
    </View>
  );
}

type Props = { value: FilterId; hidden: boolean; onChange: (id: FilterId) => void };

// La bande des filtres, de part et d'autre du déclencheur, comme sur Snap : on la fait défiler, le
// filtre posé au milieu (sous le déclencheur) s'applique tout de suite à l'aperçu, et son nom
// apparaît un instant au-dessus.
export function FilterStrip({ value, hidden, onChange }: Props) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const current = useRef(Math.max(0, CAMERA_FILTERS.findIndex((preset) => preset.id === value)));
  const visible = useRef(new Animated.Value(hidden ? 0 : 1)).current;
  const name = useRef(new Animated.Value(0)).current;
  const nameText = useRef<string>(t(presetOf(value).label));

  useEffect(() => {
    Animated.timing(visible, { toValue: hidden ? 0 : 1, duration: HIDE_MS, easing: EASING, useNativeDriver: true }).start();
  }, [hidden, visible]);

  const showName = () => {
    name.stopAnimation();
    Animated.sequence([
      Animated.timing(name, { toValue: 1, duration: 140, easing: EASING, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(name, { toValue: 0, duration: 280, easing: EASING, useNativeDriver: true }),
    ]).start();
  };

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(CAMERA_FILTERS.length - 1, Math.round(nativeEvent.contentOffset.x / ITEM_WIDTH)));
    if (index === current.current) return;
    current.current = index;
    Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
    nameText.current = t(CAMERA_FILTERS[index].label);
    onChange(CAMERA_FILTERS[index].id);
    showName();
  };

  return (
    <Animated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.layer, { opacity: visible }]}>
      <Animated.Text pointerEvents="none" style={[styles.name, { opacity: name, transform: [{ translateY: name.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }]}>
        {nameText.current}
      </Animated.Text>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        contentOffset={{ x: current.current * ITEM_WIDTH, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: (width - ITEM_WIDTH) / 2 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onTouchStart={() => lockTabSwipe(true)}
        onTouchEnd={() => lockTabSwipe(false)}
        onTouchCancel={() => lockTabSwipe(false)}
        style={styles.strip}
      >
        {CAMERA_FILTERS.map((preset, index) => (
          <Pressable
            key={preset.id}
            onPress={() => scroll.current?.scrollTo({ x: index * ITEM_WIDTH, animated: true })}
            accessibilityRole="button"
            accessibilityLabel={t(preset.label)}
            accessibilityState={{ selected: preset.id === value }}
            style={styles.item}
          >
            <FilterSwatch id={preset.id} size={SWATCH_SIZE} />
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  layer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
  },
  strip: {
    flexGrow: 0,
    alignSelf: 'stretch',
  },
  item: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.35)',
  },
  swatchStamp: {
    backgroundColor: '#1C1C1E',
  },
  stampText: {
    color: colors.background,
    textAlign: 'center',
    includeFontPadding: false,
  },
  stampTime: {
    fontFamily: 'sans-serif-thin',
    letterSpacing: -0.5,
  },
  stampDate: {
    fontFamily: 'serif',
    lineHeight: 15,
  },
  stampFilm: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#FF8A1F',
  },
  name: {
    position: 'absolute',
    bottom: '100%',
    alignSelf: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
    backgroundColor: colors.overlay,
  },
}));
