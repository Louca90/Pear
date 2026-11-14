import { ComponentRef, memo, useEffect, useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { haptics } from '../../haptics';

import { t } from '../../i18n';
import { DURATION, enterUp, exitFade, timing } from '../../motion';
import { createMediaStyles, fixed, spacing, useMediaColors } from '../../theme';
import { RoundFiltered } from './FilterStrip';
import { Adjustments, FILTERS, FilterId } from './filters';
import type { Stamp, StampKind } from './stamps';

// Les vignettes : 62 × 80, coins arrondis. L'anneau de sélection est dessiné autour (marge + bordure),
// dans la place de la vignette : la bande ne peut pas le rogner.
const THUMB_WIDTH = 62;
const THUMB_HEIGHT = 80;
const THUMB_RADIUS = 14;
const RING_GAP = 3;
const RING_WIDTH = 2;
const ITEM_WIDTH = THUMB_WIDTH + (RING_GAP + RING_WIDTH) * 2;
const ITEM_GAP = 10;
// Le panneau entre en fondu et glisse de 14 points.
const ENTER_SHIFT = 14;
const ENTER_MS = 240;
const RING_MS = 200;

// Le texte que chaque marque montre sur sa vignette (19:04, VEN., Annecy, 84 %, ’26).
function stampLabel(kind: StampKind, stamp: Stamp): string | null {
  if (kind === 'time') return stamp.time;
  if (kind === 'date') return `${stamp.dayNumber} ${stamp.month.slice(0, 3)}.`;
  if (kind === 'weekday') return `${stamp.weekday.slice(0, 3)}.`;
  if (kind === 'place') return stamp.place;
  if (kind === 'battery') return stamp.battery ? `${stamp.battery.level} %` : null;
  return `’${stamp.film.slice(1, 3)}`;
}

// Lieu ou batterie encore inconnus (position non permise) : une petite icône à la place du texte.
function StampGlyph({ kind }: { kind: StampKind }) {
  const line = { stroke: fixed.white, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  if (kind === 'battery') {
    return (
      <Svg width={26} height={26} viewBox="0 0 24 24">
        <Rect x={2} y={7} width={18} height={10} rx={2.6} {...line} />
        <Path d="M22.2 10.5v3" {...line} />
      </Svg>
    );
  }
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Path d="M12 21.5s-7-6.2-7-11.5a7 7 0 0 1 14 0c0 5.3-7 11.5-7 11.5z" {...line} />
      <Circle cx={12} cy={10} r={2.6} {...line} />
    </Svg>
  );
}

type ThumbProps = { id: FilterId; label: string; kind: StampKind | undefined; text: string | null; poster: string | null; adjustments: Adjustments; selected: boolean; onPick: (id: FilterId) => void };

const Thumb = memo(function Thumb({ id, label, kind, text, poster, adjustments, selected, onPick }: ThumbProps) {
  const colors = useMediaColors();
  const styles = useStyles();
  const ring = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    ring.set(timing(selected ? 1 : 0, RING_MS));
  }, [selected, ring]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }));

  return (
    <Pressable onPress={() => onPick(id)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={styles.item}>
      <View style={styles.frame}>
        <Reanimated.View pointerEvents="none" style={[styles.ring, ringStyle]} />
        {/* La photo filtrée, découpée dans la vignette arrondie. */}
        <View style={styles.thumb}>
          <RoundFiltered id={id} radius={THUMB_RADIUS} adjustments={adjustments}>
            {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, styles.empty]} />}
          </RoundFiltered>
          {kind && (
            <View pointerEvents="none" style={styles.stamp}>
              {text ? (
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.stampText, text.length > 5 && styles.stampSmall, kind === 'film' && styles.stampFilm]}>
                  {text}
                </Text>
              ) : (
                <StampGlyph kind={kind} />
              )}
            </View>
          )}
        </View>
      </View>
      <Text numberOfLines={1} style={[styles.name, { color: selected ? colors.signature : colors.onDarkMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
});

type Props = {
  value: FilterId;
  // L'image des vignettes : la photo, ou la première image de la vidéo.
  poster: string | null;
  adjustments: Adjustments;
  stamp: Stamp;
  bottom: number;
  onChange: (id: FilterId) => void;
};

// La rangée Ambiance : un filtre par vignette, l'aperçu fait avec la photo elle-même. Choisir ici ou
// glisser sur l'image revient au même : la bande suit et remet le filtre choisi au milieu.
export function AmbiancePanel({ value, poster, adjustments, stamp, bottom, onChange }: Props) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const indexOf = (id: FilterId) => Math.max(0, FILTERS.findIndex((preset) => preset.id === id));
  // La bande est dans une pastille (marge spacing.sm de chaque côté) : le milieu se calcule sur sa largeur.
  const viewport = width - spacing.sm * 2;
  const offsetOf = (index: number) => Math.max(0, spacing.md + index * (ITEM_WIDTH + ITEM_GAP) + ITEM_WIDTH / 2 - viewport / 2);
  const first = useRef(offsetOf(indexOf(value)));

  useEffect(() => {
    scroll.current?.scrollTo({ x: offsetOf(indexOf(value)), animated: true });
  }, [value, width]);

  const pick = (id: FilterId) => {
    if (id === value) return;
    haptics.select();
    onChange(id);
  };

  return (
    <Reanimated.View entering={enterUp(ENTER_SHIFT, ENTER_MS)} exiting={exitFade(DURATION.small)} style={[styles.panel, { bottom }]}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: first.current, y: 0 }}
        // Le retrait à gauche et à droite : la première et la dernière vignette ne sont jamais coupées.
        contentContainerStyle={styles.strip}
      >
        {FILTERS.map((preset) => (
          <Thumb
            key={preset.id}
            id={preset.id}
            label={t(preset.label)}
            kind={preset.stamp}
            text={preset.stamp ? stampLabel(preset.stamp, stamp) : null}
            poster={poster}
            adjustments={adjustments}
            selected={preset.id === value}
            onPick={pick}
          />
        ))}
      </ScrollView>
    </Reanimated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  // Une pastille sombre sous la bande : les noms restent lisibles sur une photo claire.
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.overlay,
  },
  strip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: ITEM_GAP,
  },
  item: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    gap: 5,
  },
  frame: {
    padding: RING_GAP + RING_WIDTH,
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: THUMB_RADIUS + RING_GAP + RING_WIDTH,
    borderWidth: RING_WIDTH,
    borderColor: colors.signature,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: THUMB_RADIUS,
    overflow: 'hidden',
    backgroundColor: fixed.filterStripBackground,
  },
  empty: {
    backgroundColor: fixed.filterStripBackground,
  },
  stamp: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  stampText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: colors.background,
    textShadowColor: colors.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    includeFontPadding: false,
  },
  stampSmall: {
    fontSize: 11,
  },
  stampFilm: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: fixed.filmOrange,
  },
  name: {
    fontSize: 12,
    fontWeight: '500',
    textShadowColor: colors.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
}));
