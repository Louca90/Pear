import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, FadeIn, FadeOut, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Ban } from 'lucide-react-native';

import { haptics } from '../../haptics';
import { t } from '../../i18n';
import { createMediaStyles, fixed, radius } from '../../theme';
import { LENS_CATEGORIES, Lens, LensCategory } from './lenses';

// Planche « Appareil photo · lentilles et filtres fun » : catégories en pilules au bas de l'aperçu,
// anneau du milieu qui se trace en vert quand un effet est posé, conseil des lentilles qui réagissent.

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const RING = 64;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
// Le vert de la planche, sur l'aperçu sombre quel que soit le thème.
const LIME = '#B4CC68';

function CategoryPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: 220, easing: EASE }));
  }, [selected, on]);
  const pill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.get(), [0, 1], ['rgba(0,0,0,0.4)', fixed.white]) }));
  const text = useAnimatedStyle(() => ({ color: interpolateColor(on.get(), [0, 1], [fixed.white, fixed.black]) }));
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected }} hitSlop={4}>
      <Reanimated.View style={[styles.pill, pill]}>
        <Reanimated.Text style={[styles.pillLabel, text]}>{label}</Reanimated.Text>
      </Reanimated.View>
    </Pressable>
  );
}

export function LensCategories({ value, hidden, bottom, onChange }: { value: LensCategory; hidden: boolean; bottom: number; onChange: (category: LensCategory) => void }) {
  const styles = useStyles();
  const visible = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    visible.set(withTiming(hidden ? 0 : 1, { duration: 180, easing: EASE }));
  }, [hidden, visible]);
  const fade = useAnimatedStyle(() => ({ opacity: visible.get() }));
  return (
    <Reanimated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.categories, { bottom }, fade]} accessibilityRole="tablist">
      {LENS_CATEGORIES.map(({ id, label }) => (
        <CategoryPill
          key={id}
          label={t(label)}
          selected={id === value}
          onPress={() => {
            if (id === value) return;
            haptics.select();
            onChange(id);
          }}
        />
      ))}
    </Reanimated.View>
  );
}

// L'anneau fixe du milieu : blanc, et un trait vert qui en fait le tour quand un effet y est posé.
export function LensRing({ chosen, hidden, token }: { chosen: boolean; hidden: boolean; token: string }) {
  const styles = useStyles();
  const trace = useSharedValue(chosen ? 1 : 0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Chaque nouvel effet retrace l'anneau ; « aucun » l'efface.
    trace.set(0);
    if (chosen) trace.set(withTiming(1, { duration: 420, easing: EASE }));
  }, [chosen, token, trace]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - trace.get()) }));
  return (
    <View pointerEvents="none" style={[styles.ring, hidden && styles.hidden]}>
      <Svg width={RING} height={RING}>
        <Circle cx={RING / 2} cy={RING / 2} r={RING_RADIUS} stroke={fixed.white} strokeWidth={RING_STROKE} fill="none" />
        <AnimatedCircle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_RADIUS}
          stroke={LIME}
          strokeWidth={RING_STROKE + 0.5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={RING_LENGTH}
          animatedProps={props}
          rotation={-90}
          originX={RING / 2}
          originY={RING / 2}
        />
      </Svg>
    </View>
  );
}

// Le conseil d'une lentille qui réagit (« Ouvre la bouche »), au-dessus des catégories.
export function LensHint({ text, bottom }: { text: string | null; bottom: number }) {
  const styles = useStyles();
  if (!text) return null;
  return (
    <Reanimated.View key={text} entering={FadeIn.duration(260).delay(300)} exiting={FadeOut.duration(160)} pointerEvents="none" style={[styles.hintPlace, { bottom }]}>
      <Text style={styles.hint}>{text}</Text>
    </Reanimated.View>
  );
}

// La pastille d'une lentille : l'émoji dans un rond translucide ; « aucune » : un rond barré.
export function LensPastille({ lens, size }: { lens: Lens; size: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.pastille, { width: size, height: size, borderRadius: size / 2 }]}>
      {lens.glyph ? <Text style={[styles.glyph, { fontSize: size * 0.52 }]}>{lens.glyph}</Text> : <Ban size={size * 0.42} color={fixed.white} strokeWidth={1.8} />}
    </View>
  );
}

const useStyles = createMediaStyles(() => ({
  categories: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  pill: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
  },
  hidden: {
    opacity: 0,
  },
  hintPlace: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
    color: fixed.white,
    fontSize: 13,
    fontWeight: '600',
  },
  pastille: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  glyph: {
    includeFontPadding: false,
    textAlign: 'center',
  },
}));
