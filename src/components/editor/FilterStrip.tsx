import { ComponentRef, ReactNode, useEffect, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming, cancelAnimation, withDelay, withSequence } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { haptics } from '../../haptics';

import { t } from '../../i18n';
import { createMediaStyles, fixed, radius, spacing } from '../../theme';
import { lockTabSwipe } from '../tabSwipeLock';
import { Adjustments, FILTERS, FilterId, NO_ADJUSTMENTS, presetOf, stepsOf, tintsOf, viewFiltersOf } from './filters';
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
      <Rect width={52} height={52} fill={fixed.scene.sky} />
      <Circle cx={36} cy={16} r={7} fill={fixed.scene.sun} />
      <Circle cx={14} cy={18} r={4.5} fill={fixed.scene.cloud} />
      <Circle cx={19} cy={16} r={5.5} fill={fixed.scene.cloud} />
      <Circle cx={24} cy={19} r={4} fill={fixed.scene.cloud} />
      <Path d="M0 36 Q14 24 30 33 T52 30 V52 H0 Z" fill={fixed.scene.hill} />
      <Path d="M0 44 Q20 34 52 42 V52 H0 Z" fill={fixed.scene.hillDark} />
      <Rect x={33} y={36} width={8} height={7} fill={fixed.scene.house} />
    </Svg>
  );
}

// Les marques : une icône pour les filtres d'ambiance, un aperçu du texte pour Heure et Pellicule.
function StampSample({ kind, size }: { kind: StampKind; size: number }) {
  const styles = useStyles();
  const icon = size * 0.52;
  const line = { stroke: fixed.white, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  if (kind === 'time') return <Text style={[styles.stampText, styles.stampTime, { fontSize: size * 0.3 }]}>12:30</Text>;
  if (kind === 'date' || kind === 'weekday') {
    // Date : un calendrier et sa grille de jours. Jour : le même calendrier, un seul jour en plein.
    return (
      <Svg width={icon} height={icon} viewBox="0 0 24 24">
        <Rect x={3.5} y={5} width={17} height={15.5} rx={3} {...line} />
        <Path d="M3.5 10h17M8 3v4M16 3v4" {...line} />
        {kind === 'date' ? (
          <Path d="M8 14h.01M12 14h.01M16 14h.01M8 17.2h.01M12 17.2h.01M16 17.2h.01" {...line} strokeWidth={2.4} />
        ) : (
          <Rect x={10} y={13.2} width={4.4} height={4.4} rx={1.2} fill={fixed.white} />
        )}
      </Svg>
    );
  }
  if (kind === 'place') {
    return (
      <Svg width={icon} height={icon} viewBox="0 0 24 24">
        <Path d="M12 21.5s-7-6.2-7-11.5a7 7 0 0 1 14 0c0 5.3-7 11.5-7 11.5z" {...line} />
        <Circle cx={12} cy={10} r={2.6} {...line} />
      </Svg>
    );
  }
  if (kind === 'battery') {
    return (
      <Svg width={icon} height={icon} viewBox="0 0 24 24">
        <Rect x={2} y={7} width={18} height={10} rx={2.6} {...line} />
        <Path d="M22.2 10.5v3" {...line} />
        <Rect x={4.4} y={9.4} width={9} height={5.2} rx={1} fill={fixed.white} />
      </Svg>
    );
  }
  return <Text style={[styles.stampText, styles.stampFilm, { fontSize: size * 0.24 }]}>'26</Text>;
}

// Un contenu filtré, découpé dans un rond. Le filtre d'Android se pose sur la vue qui découpe
// elle-même : posé sur un enfant (FilteredView), il dessinait parfois hors du rond (coins carrés).
// Les voiles (fané, température) sont découpés par le même rond.
export function RoundFiltered({ id, radius: corner, adjustments = NO_ADJUSTMENTS, children }: { id: FilterId; radius: number; adjustments?: Adjustments; children: ReactNode }) {
  const styles = useStyles();
  const steps = stepsOf(id, adjustments);
  const filters = viewFiltersOf(steps);
  const round = { borderRadius: corner };
  return (
    <View style={[StyleSheet.absoluteFill, styles.clip, round]}>
      <View style={[StyleSheet.absoluteFill, styles.clip, round, filters.length > 0 && { filter: filters }]}>{children}</View>
      {tintsOf(steps).map((tint, index) => (
        <View key={index} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint.color, opacity: tint.opacity }]} />
      ))}
    </View>
  );
}

// Trois couches : l'ombre sur le rond extérieur (qui ne découpe rien, sinon il couperait l'ombre), le
// contenu découpé dans le rond, puis le bord blanc par-dessus (le contenu ne peut plus le cacher).
// `flat` : sans ombre ni bord (au cœur du déclencheur).
export function FilterSwatch({ id, size, flat = false }: { id: FilterId; size: number; flat?: boolean }) {
  const styles = useStyles();
  const preset = presetOf(id);
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[round, !flat && styles.swatchShadow]}>
      {preset.stamp ? (
        <View style={[StyleSheet.absoluteFill, styles.clip, styles.swatchStamp, { borderRadius: size / 2 }]}>
          <StampSample kind={preset.stamp} size={size} />
        </View>
      ) : (
        <RoundFiltered id={id} radius={size / 2}>
          <Scene size={size} />
        </RoundFiltered>
      )}
      {!flat && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.swatchRing, { borderRadius: size / 2 }]} />}
    </View>
  );
}

// Une pastille de la bande : ce qui s'affiche, son nom, et ce que fait un appui quand elle est déjà au milieu.
export type Pastille = { id: string; label: string; node: ReactNode; onSelectedPress?: () => void };

// La bande des pastilles, de part et d'autre du déclencheur, comme sur Snap : on la fait défiler, la
// pastille posée au milieu (sous le déclencheur) s'applique tout de suite à l'aperçu, et son nom
// apparaît un instant au-dessus. Sert aux filtres de couleur et aux lentilles.
export function PastilleStrip({ items, value, hidden, onChange }: { items: Pastille[]; value: string; hidden: boolean; onChange: (id: string) => void }) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const current = useRef(Math.max(0, items.findIndex((item) => item.id === value)));
  const visible = useSharedValue(hidden ? 0 : 1);
  const name = useSharedValue(0);
  const nameStyle = useAnimatedStyle(() => ({ opacity: name.get(), transform: [{ translateY: 4 * (1 - name.get()) }] }));
  const nameText = useRef<string>(items[current.current]?.label ?? '');

  useEffect(() => {
    visible.set(withTiming(hidden ? 0 : 1, { duration: HIDE_MS, easing: EASING }));
  }, [hidden, visible]);

  const showName = () => {
    cancelAnimation(name);
    name.set(withSequence(withTiming(1, { duration: 140, easing: EASING }), withDelay(700, withTiming(0, { duration: 280, easing: EASING }))));
  };

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(nativeEvent.contentOffset.x / ITEM_WIDTH)));
    if (index === current.current) return;
    current.current = index;
    haptics.select();
    nameText.current = items[index].label;
    onChange(items[index].id);
    showName();
  };

  return (
    <Reanimated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.layer, { opacity: visible }]}>
      <Reanimated.Text pointerEvents="none" style={[styles.name, nameStyle]}>
        {nameText.current}
      </Reanimated.Text>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        contentOffset={{ x: current.current * ITEM_WIDTH, y: 0 }}
        // La marge verticale laisse la place à l'ombre des pastilles, que la bande coupait (52 + 2 × 16
        // = 84, la hauteur de la rangée du déclencheur).
        contentContainerStyle={{ paddingHorizontal: (width - ITEM_WIDTH) / 2, paddingVertical: 16 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onTouchStart={() => lockTabSwipe(true)}
        onTouchEnd={() => lockTabSwipe(false)}
        onTouchCancel={() => lockTabSwipe(false)}
        style={styles.strip}
      >
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            onPress={() => {
              if (item.id === value && item.onSelectedPress) item.onSelectedPress();
              else scroll.current?.scrollTo({ x: index * ITEM_WIDTH, animated: true });
            }}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: item.id === value }}
            style={styles.item}
          >
            {item.node}
          </Pressable>
        ))}
      </ScrollView>
    </Reanimated.View>
  );
}

// Toucher le filtre déjà posé au milieu passe au style typographique suivant de sa marque.
type Props = { value: FilterId; hidden: boolean; onChange: (id: FilterId) => void; onRestyle?: (kind: StampKind) => void };

// La bande des filtres de couleur.
export function FilterStrip({ value, hidden, onChange, onRestyle }: Props) {
  const items: Pastille[] = CAMERA_FILTERS.map((preset) => ({
    id: preset.id,
    label: t(preset.label),
    node: <FilterSwatch id={preset.id} size={SWATCH_SIZE} />,
    onSelectedPress: preset.stamp ? () => onRestyle?.(preset.stamp as StampKind) : undefined,
  }));
  return <PastilleStrip items={items} value={value} hidden={hidden} onChange={(id) => onChange(id as FilterId)} />;
}

export const PASTILLE_SIZE = SWATCH_SIZE;

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
  clip: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchShadow: {
    // Un fond sous le contenu : l'ombre d'Android suit la forme d'une vue qui a un fond.
    backgroundColor: colors.text,
    boxShadow: `0px 2px 6px ${colors.overlay}`,
  },
  swatchRing: {
    borderWidth: 2.5,
    borderColor: colors.background,
  },
  swatchStamp: {
    backgroundColor: fixed.filterStripBackground,
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
  stampFilm: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: fixed.filmOrange,
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
