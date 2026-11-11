import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { haptics } from '../../haptics';
import { Eraser, Redo2, Undo2 } from 'lucide-react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { t } from '../../i18n';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';
import { IconButton, useInsets } from '../ui';
import { addPoint, BRUSH_MAX, BRUSH_MIN, commit, History, historyOf, redo, Stroke, strokePath, touchesStroke, undo } from './drawing';
import { newLayerId, TEXT_COLORS } from './layers';
import { VerticalSlider } from './VerticalSlider';

const OPEN_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const SLIDER_HEIGHT = 200;
const ERASER_RADIUS = 14;

function vibrate() {
  haptics.select();
}

// Les traits terminés, dans un SVG transparent de la taille de l'aperçu. Mémorisé : un nouveau trait
// en cours ne redessine pas les anciens.
export const StrokesView = memo(function StrokesView({ strokes, width, height }: { strokes: Stroke[]; width: number; height: number }) {
  if (strokes.length === 0) return null;
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
      {strokes.map((stroke) => (
        <Path key={stroke.id} d={strokePath(stroke.points)} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </Svg>
  );
});

type Props = {
  // La zone de l'aperçu, où l'on dessine (mêmes coordonnées que les traits).
  frame: { left: number; top: number; width: number; height: number };
  strokes: Stroke[];
  color: string;
  width: number;
  bottom: number;
  onStrokes: (strokes: Stroke[]) => void;
  onBrush: (brush: { color: string; width: number }) => void;
  onClose: () => void;
};

// Le mode dessin : un doigt trace (ou gomme les traits qu'il touche). Les commandes s'effacent pendant
// qu'on dessine, pour voir toute l'image.
export function DrawPanel({ frame, strokes, color, width, bottom, onStrokes, onBrush, onClose }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top } = useInsets();
  const [history, setHistory] = useState<History>(() => historyOf(strokes));
  const [erasing, setErasing] = useState(false);
  const [live, setLive] = useState<number[] | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const controls = useRef(new Animated.Value(1)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  // Chaque changement de l'historique part tout de suite vers l'éditeur (traits affichés dessous).
  const apply = (next: History) => {
    setHistory(next);
    onStrokes(next.present);
  };

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start(onClose);
  };

  const showControls = (visible: boolean) => Animated.timing(controls, { toValue: visible ? 1 : 0, duration: 160, easing: EASING, useNativeDriver: true }).start();

  // Le trait en cours, et pour la gomme la liste des traits restants : un seul pas d'historique par geste.
  const working = useRef<{ points: number[]; remaining: Stroke[] | null }>({ points: [], remaining: null });
  const latest = {
    begin: (x: number, y: number) => {
      showControls(false);
      if (erasing) {
        working.current.remaining = history.present;
        latest.erase(x, y);
        return;
      }
      working.current.points = [x, y];
      setLive(working.current.points);
    },
    move: (x: number, y: number) => {
      if (erasing) {
        latest.erase(x, y);
        return;
      }
      const next = addPoint(working.current.points, x, y);
      if (next === working.current.points) return;
      working.current.points = next;
      setLive(next);
    },
    erase: (x: number, y: number) => {
      const remaining = working.current.remaining;
      if (!remaining) return;
      const kept = remaining.filter((stroke) => !touchesStroke(stroke, x, y, ERASER_RADIUS));
      if (kept.length === remaining.length) return;
      vibrate();
      working.current.remaining = kept;
      onStrokes(kept);
    },
    end: () => {
      showControls(true);
      if (erasing) {
        const kept = working.current.remaining;
        working.current.remaining = null;
        if (kept && kept !== history.present) apply(commit(history, kept));
        return;
      }
      const points = working.current.points;
      working.current.points = [];
      setLive(null);
      if (points.length >= 2) apply(commit(history, [...history.present, { id: newLayerId(), color, width, points }]));
    },
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    minDistance: 0,
    maxPointers: 1,
    onBegin: (event) => latestRef.current.begin(event.x, event.y),
    onUpdate: (event) => latestRef.current.move(event.x, event.y),
    onFinalize: () => latestRef.current.end(),
  });

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
      <GestureDetector gesture={pan}>
        <View collapsable={false} style={[styles.surface, frame]}>
          {live && (
            <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={frame.width} height={frame.height}>
              <Path d={strokePath(live)} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          )}
        </View>
      </GestureDetector>

      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: controls }]}>
        <View style={[styles.topRow, { top: top + spacing.md }]}>
          <View style={styles.group}>
            <IconButton onPress={() => apply(undo(history))} disabled={!canUndo} label={t('editeur.annuler')} style={[styles.round, !canUndo && styles.disabled]}>
              <Undo2 size={22} color={colors.background} strokeWidth={1.75} />
            </IconButton>
            <IconButton onPress={() => apply(redo(history))} disabled={!canRedo} label={t('editeur.retablir')} style={[styles.round, !canRedo && styles.disabled]}>
              <Redo2 size={22} color={colors.background} strokeWidth={1.75} />
            </IconButton>
          </View>
          <View style={styles.group}>
            <IconButton
              onPress={() => {
                vibrate();
                setErasing((current) => !current);
              }}
              label={t('editeur.gomme')}
              style={[styles.round, erasing && styles.roundOn]}
            >
              <Eraser size={22} color={erasing ? colors.text : colors.background} strokeWidth={1.75} />
            </IconButton>
            <Pressable accessibilityRole="button" accessibilityLabel={t('editeur.termine')} onPress={close} style={styles.done}>
              <Text style={styles.doneLabel}>{t('editeur.termine')}</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.sliderWrap, { top: top + 120 }]}>
          <VerticalSlider value={width} min={BRUSH_MIN} max={BRUSH_MAX} height={SLIDER_HEIGHT} label={t('editeur.epaisseur')} onChange={(next) => onBrush({ color, width: next })} />
          {/* La pointe du pinceau, à sa taille et à sa couleur. */}
          <View style={[styles.tip, { width: width + 4, height: width + 4, borderRadius: (width + 4) / 2, backgroundColor: erasing ? 'transparent' : color, borderColor: colors.background }]} />
        </View>

        <View style={[styles.colors, { bottom: bottom + spacing.lg }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorsContent}>
            {TEXT_COLORS.map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  vibrate();
                  setErasing(false);
                  onBrush({ color: value, width });
                }}
                accessibilityRole="button" accessibilityLabel={t('editeur.couleur', { n: TEXT_COLORS.indexOf(value) + 1 })}
                accessibilityState={{ selected: !erasing && color === value }}
                style={[styles.color, { backgroundColor: value }, !erasing && color === value && styles.colorOn]}
              />
            ))}
          </ScrollView>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  surface: {
    position: 'absolute',
  },
  topRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: {
    backgroundColor: colors.background,
  },
  disabled: {
    opacity: 0.4,
  },
  done: {
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  doneLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  sliderWrap: {
    position: 'absolute',
    left: spacing.md,
    alignItems: 'center',
    gap: spacing.md,
  },
  tip: {
    borderWidth: 2,
  },
  colors: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  colorsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
    alignItems: 'center',
    height: 44,
  },
  color: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  colorOn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
  },
}));
