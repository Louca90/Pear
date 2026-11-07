import { ComponentRef, useEffect, useRef } from 'react';
import { Animated, Easing, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { t } from '../../i18n';
import { log } from '../../log';
import { createMediaStyles, radius, spacing } from '../../theme';
import { lockTabSwipe } from '../tabSwipeLock';
import { FilteredView } from './FilteredView';
import { FILTERS, FilterId, NO_ADJUSTMENTS, presetOf, stepsOf } from './filters';

// Dans l'appareil photo, seulement les filtres de couleur : l'heure et la date se posent après la prise.
export const CAMERA_FILTERS = FILTERS.filter((preset) => !preset.stamp);

const ITEM_WIDTH = 64;
const SWATCH_SIZE = 46;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const HIDE_MS = 180;

// Quatre aplats qui montrent ce que fait le filtre (le noir et blanc les grise, le sépia les brunit…).
const SAMPLE = ['#E5483B', '#F4B400', '#2E9E5B', '#2D6CDF'];

export function FilterSwatch({ id, size }: { id: FilterId; size: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.swatch, { width: size, height: size, borderRadius: size / 2 }]}>
      <FilteredView steps={stepsOf(id, NO_ADJUSTMENTS)} style={StyleSheet.absoluteFill}>
        <View style={styles.sampleRow}>
          <View style={[styles.sample, { backgroundColor: SAMPLE[0] }]} />
          <View style={[styles.sample, { backgroundColor: SAMPLE[1] }]} />
        </View>
        <View style={styles.sampleRow}>
          <View style={[styles.sample, { backgroundColor: SAMPLE[2] }]} />
          <View style={[styles.sample, { backgroundColor: SAMPLE[3] }]} />
        </View>
      </FilteredView>
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
    borderWidth: 2,
    borderColor: colors.background,
  },
  sampleRow: {
    flex: 1,
    flexDirection: 'row',
  },
  sample: {
    flex: 1,
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
