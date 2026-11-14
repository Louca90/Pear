import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { haptics } from '../../haptics';
import { RotateCw } from 'lucide-react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { t } from '../../i18n';
import { createMediaStyles, fixed, radius, spacing, useMediaColors } from '../../theme';
import { IconButton, useInsets } from '../ui';
import { Aspect, ASPECTS, Crop, fullRect, nextRotation, NO_CROP, Rect, rotatedSize, STRAIGHTEN_MAX, straightenScale } from './crop';
import { clamp } from './layers';

const OPEN_MS = 180;
const TURN_MS = 140;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const CORNER_REACH = 32;
const EDGE_REACH = 24;
const MIN_SIZE = 56;
const HANDLE = 22;
const TOP_SPACE = 84;
const BOTTOM_SPACE = 190;

// Le nom d'un format : « Libre », sinon sa proportion (1:1, 4:5…), la même dans toutes les langues.
function aspectLabel(id: Aspect) {
  return id === 'free' ? t('editeur.formatLibre') : id;
}

// La règle « Redresser » : une graduation par degré, qui défile sous un repère vert fixe. Glisser vers la
// gauche penche la photo vers la droite. Près de 0°, elle s'y pose (et vibre une fois).
const TICK_GAP = 9;
const SNAP = 0.8;

function StraightenRuler({ angle, onChange, onEnd }: { angle: number; onChange: (angle: number) => void; onEnd: () => void }) {
  const colors = useMediaColors();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const start = useRef(0);
  const latest = useRef({ angle, onChange, onEnd });
  latest.current = { angle, onChange, onEnd };
  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    minDistance: 2,
    onBegin: () => {
      start.current = latest.current.angle;
    },
    onUpdate: (event) => {
      let next = clamp(start.current - event.translationX / TICK_GAP, -STRAIGHTEN_MAX, STRAIGHTEN_MAX);
      if (Math.abs(next) < SNAP) next = 0;
      const previous = latest.current.angle;
      if (next !== previous && (next === 0 || Math.trunc(next / 5) !== Math.trunc(previous / 5))) haptics.select();
      latest.current.onChange(next);
    },
    onFinalize: () => latest.current.onEnd(),
  });
  const center = width / 2;
  const ticks = [];
  for (let degree = -STRAIGHTEN_MAX; degree <= STRAIGHTEN_MAX; degree += 1) {
    const x = center + (degree - angle) * TICK_GAP;
    if (x < -2 || x > width + 2) continue;
    const major = degree % 5 === 0;
    ticks.push(<View key={degree} style={[styles.tick, { left: x - 1, height: major ? 18 : 10, backgroundColor: degree === 0 ? colors.background : colors.onDarkTrack }]} />);
  }
  return (
    <View style={styles.ruler}>
      <Text style={[styles.angle, angle !== 0 && { color: colors.signature }]}>{`${Math.round(angle)}°`}</Text>
      <GestureDetector gesture={pan}>
        <View
          collapsable={false}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={styles.rulerTrack}
          accessibilityRole="adjustable"
          accessibilityLabel={t('editeur.redresser')}
          accessibilityValue={{ text: `${Math.round(angle)}°` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={({ nativeEvent }) => onChange(clamp(angle + (nativeEvent.actionName === 'increment' ? 1 : -1), -STRAIGHTEN_MAX, STRAIGHTEN_MAX))}
        >
          {ticks}
          <View pointerEvents="none" style={[styles.tickCenter, { left: center - 1 }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

type Mode = 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | null;

function vibrate() {
  haptics.select();
}

type Props = {
  uri: string;
  image: { width: number; height: number };
  crop: Crop;
  bottom: number;
  onDone: (crop: Crop) => void;
  // Format imposé (photo de profil : 1:1) : pas de choix de format, et un cercle montre ce qui restera.
  lockedAspect?: Aspect;
};

// Recadrer et tourner une photo : la photo entière, le cadre gardé en clair, le reste assombri.
export function CropPanel({ uri, image, crop: initial, bottom, onDone, lockedAspect }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top } = useInsets();
  const screen = useWindowDimensions();
  const [crop, setCrop] = useState(initial);
  const [aspect, setAspect] = useState<Aspect>(lockedAspect ?? 'free');
  const progress = useSharedValue(0);
  const content = useSharedValue(1);
  const grid = useSharedValue(0);
  const closing = useRef(false);
  const gridStyle = useAnimatedStyle(() => ({ opacity: 0.45 + 0.55 * grid.get() }));
  const rowIn = useAnimatedStyle(() => ({ transform: [{ translateY: 14 * (1 - progress.get()) }] }));

  useEffect(() => {
    progress.set(withTiming(1, { duration: OPEN_MS, easing: EASING }));
  }, [progress]);

  // La photo tournée, ajustée à la zone libre entre les boutons du haut et ceux du bas.
  const area = { left: spacing.md, top: top + TOP_SPACE, width: screen.width - spacing.md * 2, height: screen.height - top - TOP_SPACE - BOTTOM_SPACE - bottom };
  const turned = rotatedSize(image, crop.rotation);
  const fit = Math.min(area.width / turned.width, area.height / turned.height);
  const shown = { width: turned.width * fit, height: turned.height * fit };
  const origin = { x: area.left + (area.width - shown.width) / 2, y: area.top + (area.height - shown.height) / 2 };
  const box = { x: crop.rect.x * shown.width, y: crop.rect.y * shown.height, width: crop.rect.width * shown.width, height: crop.rect.height * shown.height };
  const ratio = ASPECTS.find((item) => item.id === aspect)?.ratio ?? null;

  const finish = () => {
    if (closing.current) return;
    closing.current = true;
    const done = () => onDone(crop);
    progress.set(
      withTiming(0, { duration: OPEN_MS, easing: EASING }, (finished) => {
        if (finished) scheduleOnRN(done);
      }),
    );
  };

  // Changer de format ou tourner : l'image s'efface un instant, puis revient avec son nouveau cadre.
  const swap = (next: Crop) => {
    const turn = () => {
      setCrop(next);
      content.set(withTiming(1, { duration: TURN_MS * 1.4, easing: EASING }));
    };
    content.set(
      withTiming(0, { duration: TURN_MS, easing: EASING }, (finished) => {
        if (finished) scheduleOnRN(turn);
      }),
    );
  };

  const rotate = () => {
    vibrate();
    const rotation = nextRotation(crop.rotation);
    swap({ rotation, rect: fullRect(image, rotation, ratio) });
  };

  const chooseAspect = (id: Aspect) => {
    vibrate();
    setAspect(id);
    swap({ rotation: crop.rotation, rect: fullRect(image, crop.rotation, ASPECTS.find((item) => item.id === id)?.ratio ?? null) });
  };

  // Le geste : saisi par un coin, un bord ou l'intérieur du cadre (en points de la photo affichée).
  const drag = useRef<{ mode: Mode; start: Rect }>({ mode: null, start: box });
  const latest = {
    begin: (x: number, y: number) => {
      const px = x - (origin.x - area.left);
      const py = y - (origin.y - area.top);
      const near = (a: number, b: number, reach: number) => Math.abs(a - b) <= reach;
      const right = box.x + box.width;
      const bottomEdge = box.y + box.height;
      let mode: Mode = null;
      if (near(px, box.x, CORNER_REACH) && near(py, box.y, CORNER_REACH)) mode = 'tl';
      else if (near(px, right, CORNER_REACH) && near(py, box.y, CORNER_REACH)) mode = 'tr';
      else if (near(px, box.x, CORNER_REACH) && near(py, bottomEdge, CORNER_REACH)) mode = 'bl';
      else if (near(px, right, CORNER_REACH) && near(py, bottomEdge, CORNER_REACH)) mode = 'br';
      else if (!ratio && near(py, box.y, EDGE_REACH) && px > box.x && px < right) mode = 't';
      else if (!ratio && near(py, bottomEdge, EDGE_REACH) && px > box.x && px < right) mode = 'b';
      else if (!ratio && near(px, box.x, EDGE_REACH) && py > box.y && py < bottomEdge) mode = 'l';
      else if (!ratio && near(px, right, EDGE_REACH) && py > box.y && py < bottomEdge) mode = 'r';
      else if (px > box.x && px < right && py > box.y && py < bottomEdge) mode = 'move';
      drag.current = { mode, start: box };
      if (mode) grid.set(withTiming(1, { duration: 120, easing: EASING }));
    },
    update: (dx: number, dy: number) => {
      const { mode, start } = drag.current;
      if (!mode) return;
      let { x, y, width, height } = start;
      if (mode === 'move') {
        x = clamp(start.x + dx, 0, shown.width - width);
        y = clamp(start.y + dy, 0, shown.height - height);
      } else {
        const left = mode.includes('l') ? clamp(start.x + dx, 0, start.x + start.width - MIN_SIZE) : start.x;
        const rightEdge = mode.includes('r') ? clamp(start.x + start.width + dx, start.x + MIN_SIZE, shown.width) : start.x + start.width;
        const topEdge = mode.includes('t') ? clamp(start.y + dy, 0, start.y + start.height - MIN_SIZE) : start.y;
        const bottomEdge = mode.includes('b') ? clamp(start.y + start.height + dy, start.y + MIN_SIZE, shown.height) : start.y + start.height;
        x = left;
        y = topEdge;
        width = rightEdge - left;
        height = bottomEdge - topEdge;
        // Format imposé : la hauteur suit la largeur, depuis le coin opposé (qui reste en place).
        if (ratio) {
          height = width / ratio;
          if (mode.includes('t')) y = start.y + start.height - height;
          if (y < 0 || y + height > shown.height) {
            height = mode.includes('t') ? start.y + start.height : shown.height - start.y;
            width = height * ratio;
            if (mode.includes('l')) x = start.x + start.width - width;
            y = mode.includes('t') ? 0 : start.y;
          }
        }
      }
      setCrop((current) => ({ ...current, rect: { x: x / shown.width, y: y / shown.height, width: width / shown.width, height: height / shown.height } }));
    },
    end: () => {
      drag.current.mode = null;
      grid.set(withTiming(0, { duration: 220, easing: EASING }));
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
    onUpdate: (event) => latestRef.current.update(event.translationX, event.translationY),
    onFinalize: () => latestRef.current.end(),
  });

  // Redressée, la photo grandit juste assez pour remplir le cadre de la photo tournée.
  const angle = crop.angle ?? 0;
  const grow = straightenScale(turned, angle);
  const imageStyle = {
    position: 'absolute' as const,
    left: origin.x + (shown.width - image.width * fit * grow) / 2,
    top: origin.y + (shown.height - image.height * fit * grow) / 2,
    width: image.width * fit * grow,
    height: image.height * fit * grow,
    transform: [{ rotate: `${crop.rotation + angle}deg` }],
  };
  const straighten = (next: number) => {
    setCrop((current) => ({ ...current, angle: next }));
    grid.set(withTiming(1, { duration: 120, easing: EASING }));
  };
  const straightenEnd = () => grid.set(withTiming(0, { duration: 220, easing: EASING }));
  const frame = { left: origin.x + box.x, top: origin.y + box.y, width: box.width, height: box.height };

  return (
    <Reanimated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: progress }]}>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: content }]}>
        <Image source={{ uri }} style={imageStyle} resizeMode="stretch" />
        {/* Le reste de la photo, assombri autour du cadre. */}
        <View style={[styles.shade, { left: origin.x, top: origin.y, width: shown.width, height: box.y }]} />
        <View style={[styles.shade, { left: origin.x, top: frame.top + frame.height, width: shown.width, height: shown.height - box.y - box.height }]} />
        <View style={[styles.shade, { left: origin.x, top: frame.top, width: box.x, height: frame.height }]} />
        <View style={[styles.shade, { left: frame.left + frame.width, top: frame.top, width: shown.width - box.x - box.width, height: frame.height }]} />
        <View style={[styles.frame, frame]}>
          {lockedAspect === '1:1' && <View style={styles.circle} />}
          <Reanimated.View style={[StyleSheet.absoluteFill, gridStyle]}>
            <View style={[styles.gridLine, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View style={[styles.gridLine, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View style={[styles.gridLine, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            <View style={[styles.gridLine, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
          </Reanimated.View>
          {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
            <View
              key={corner}
              style={[
                styles.handle,
                corner.includes('t') ? { top: -4 } : { bottom: -4 },
                corner.includes('l') ? { left: -4, borderLeftWidth: 4 } : { right: -4, borderRightWidth: 4 },
                corner.includes('t') ? { borderTopWidth: 4 } : { borderBottomWidth: 4 },
              ]}
            />
          ))}
        </View>
      </Reanimated.View>

      <GestureDetector gesture={pan}>
        <View collapsable={false} style={[styles.surface, area]} />
      </GestureDetector>

      <View style={[styles.topRow, { top: top + spacing.md }]}>
        <IconButton onPress={rotate} label={t('editeur.tourner')} style={styles.round}>
          <RotateCw size={22} color={colors.background} strokeWidth={1.75} />
        </IconButton>
        <Pressable accessibilityRole="button" accessibilityLabel={t('editeur.termine')} onPress={finish} style={styles.done}>
          <Text style={styles.doneLabel}>{t('editeur.termine')}</Text>
        </Pressable>
      </View>

      {/* Le panneau du bas monte de 14 points en fondu, comme les autres outils. */}
      <Reanimated.View style={[styles.bottomRow, { bottom: bottom + spacing.lg }, rowIn]}>
        <View style={styles.aspects}>
          {ASPECTS.filter(({ id }) => !lockedAspect || id === lockedAspect).map(({ id }) => (
            <Pressable
              key={id}
              onPress={() => chooseAspect(id)}
              accessibilityRole="button"
              accessibilityLabel={aspectLabel(id)}
              accessibilityState={{ selected: aspect === id }}
              style={[styles.chip, aspect === id && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, aspect === id && { color: colors.text }]}>{aspectLabel(id)}</Text>
            </Pressable>
          ))}
        </View>
        {/* Le redressement fin : pas pour la photo de profil, recadrée par le module natif sans angle. */}
        {!lockedAspect && <StraightenRuler angle={angle} onChange={straighten} onEnd={straightenEnd} />}
        <Pressable
          onPress={() => {
            vibrate();
            if (lockedAspect) {
              swap({ rotation: 0, rect: fullRect(image, 0, ratio) });
              return;
            }
            setAspect('free');
            swap(NO_CROP);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('editeur.reinitialiser')}
          style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
        >
          <Text style={styles.resetLabel}>{t('editeur.reinitialiser')}</Text>
        </Pressable>
      </Reanimated.View>    </Reanimated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  screen: {
    backgroundColor: colors.text,
  },
  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  frame: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  circle: {
    ...StyleSheet.absoluteFill,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.7)',
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderColor: colors.background,
  },
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
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
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
  bottomRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  // Passe à la ligne plutôt que de déborder (langues aux mots longs, petits écrans).
  aspects: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: fixed.cameraSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruler: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
  },
  angle: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.onDarkMuted,
  },
  rulerTrack: {
    alignSelf: 'stretch',
    height: 34,
    overflow: 'hidden',
  },
  tick: {
    position: 'absolute',
    bottom: 4,
    width: 2,
    borderRadius: 1,
  },
  tickCenter: {
    position: 'absolute',
    bottom: 2,
    width: 2,
    height: 26,
    borderRadius: 1,
    backgroundColor: colors.signatureStrong,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.background,
  },
  chipOn: {
    backgroundColor: colors.background,
  },
  reset: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  resetLabel: {
    fontSize: 14,
    color: colors.onDarkMuted,
  },
  pressed: {
    opacity: 0.6,
  },
}));
