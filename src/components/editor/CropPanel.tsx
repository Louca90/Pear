import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RotateCw } from 'lucide-react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { t } from '../../i18n';
import { log } from '../../log';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';
import { IconButton, useInsets } from '../ui';
import { Aspect, ASPECTS, Crop, fullRect, nextRotation, NO_CROP, Rect, rotatedSize } from './crop';
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

// L'icône d'un format : un cadre à ses proportions. Le format libre : les quatre équerres d'un
// recadrage, sans cadre fermé.
const ICON_BOX = 22;

function AspectIcon({ id, ratio, color }: { id: Aspect; ratio: number | null; color: string }) {
  if (id === 'free' || !ratio) {
    const arm = 7;
    const corner = (vertical: 'top' | 'bottom', horizontal: 'left' | 'right') => ({
      position: 'absolute' as const,
      width: arm,
      height: arm,
      [vertical]: 0,
      [horizontal]: 0,
      borderColor: color,
      [vertical === 'top' ? 'borderTopWidth' : 'borderBottomWidth']: 2,
      [horizontal === 'left' ? 'borderLeftWidth' : 'borderRightWidth']: 2,
      [`border${vertical === 'top' ? 'Top' : 'Bottom'}${horizontal === 'left' ? 'Left' : 'Right'}Radius`]: 2,
    });
    return (
      <View style={{ width: ICON_BOX - 2, height: ICON_BOX - 6 }}>
        <View style={corner('top', 'left')} />
        <View style={corner('top', 'right')} />
        <View style={corner('bottom', 'left')} />
        <View style={corner('bottom', 'right')} />
      </View>
    );
  }
  const width = ratio >= 1 ? ICON_BOX : ICON_BOX * ratio;
  const height = ratio >= 1 ? ICON_BOX / ratio : ICON_BOX;
  return <View style={{ width, height, borderWidth: 2, borderRadius: 3, borderColor: color }} />;
}

type Mode = 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | null;

function vibrate() {
  Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
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
  const progress = useRef(new Animated.Value(0)).current;
  const content = useRef(new Animated.Value(1)).current;
  const grid = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
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
    Animated.timing(progress, { toValue: 0, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start(() => onDone(crop));
  };

  // Changer de format ou tourner : l'image s'efface un instant, puis revient avec son nouveau cadre.
  const swap = (next: Crop) =>
    Animated.timing(content, { toValue: 0, duration: TURN_MS, easing: EASING, useNativeDriver: true }).start(() => {
      setCrop(next);
      Animated.timing(content, { toValue: 1, duration: TURN_MS * 1.4, easing: EASING, useNativeDriver: true }).start();
    });

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
      if (mode) Animated.timing(grid, { toValue: 1, duration: 120, easing: EASING, useNativeDriver: true }).start();
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
      Animated.timing(grid, { toValue: 0, duration: 220, easing: EASING, useNativeDriver: true }).start();
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

  const imageStyle = {
    position: 'absolute' as const,
    left: origin.x + (shown.width - image.width * fit) / 2,
    top: origin.y + (shown.height - image.height * fit) / 2,
    width: image.width * fit,
    height: image.height * fit,
    transform: [{ rotate: `${crop.rotation}deg` }],
  };
  const frame = { left: origin.x + box.x, top: origin.y + box.y, width: box.width, height: box.height };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: progress }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: content }]}>
        <Image source={{ uri }} style={imageStyle} resizeMode="stretch" />
        {/* Le reste de la photo, assombri autour du cadre. */}
        <View style={[styles.shade, { left: origin.x, top: origin.y, width: shown.width, height: box.y }]} />
        <View style={[styles.shade, { left: origin.x, top: frame.top + frame.height, width: shown.width, height: shown.height - box.y - box.height }]} />
        <View style={[styles.shade, { left: origin.x, top: frame.top, width: box.x, height: frame.height }]} />
        <View style={[styles.shade, { left: frame.left + frame.width, top: frame.top, width: shown.width - box.x - box.width, height: frame.height }]} />
        <View style={[styles.frame, frame]}>
          {lockedAspect === '1:1' && <View style={styles.circle} />}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: grid }]}>
            <View style={[styles.gridLine, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View style={[styles.gridLine, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View style={[styles.gridLine, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            <View style={[styles.gridLine, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
          </Animated.View>
          {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
            <View
              key={corner}
              style={[
                styles.handle,
                corner.includes('t') ? { top: -3 } : { bottom: -3 },
                corner.includes('l') ? { left: -3, borderLeftWidth: 3 } : { right: -3, borderRightWidth: 3 },
                corner.includes('t') ? { borderTopWidth: 3 } : { borderBottomWidth: 3 },
              ]}
            />
          ))}
        </View>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <View collapsable={false} style={[styles.surface, area]} />
      </GestureDetector>

      <View style={[styles.topRow, { top: top + spacing.md }]}>
        <IconButton onPress={rotate} label={t('editeur.tourner')} style={styles.round}>
          <RotateCw size={22} color={colors.background} strokeWidth={1.75} />
        </IconButton>
        <Pressable onPress={finish} style={styles.done}>
          <Text style={styles.doneLabel}>{t('editeur.termine')}</Text>
        </Pressable>
      </View>

      <View style={[styles.bottomRow, { bottom: bottom + spacing.lg }]}>
        <View style={styles.aspects}>
          {ASPECTS.filter(({ id }) => !lockedAspect || id === lockedAspect).map(({ id, ratio: value }) => (
            <Pressable
              key={id}
              onPress={() => chooseAspect(id)}
              accessibilityRole="button"
              accessibilityLabel={aspectLabel(id)}
              accessibilityState={{ selected: aspect === id }}
              style={[styles.chip, aspect === id && styles.chipOn]}
            >
              <View style={styles.chipIcon}>
                <AspectIcon id={id} ratio={value} color={aspect === id ? colors.text : colors.background} />
              </View>
              <Text style={[styles.chipLabel, aspect === id && { color: colors.text }]}>{aspectLabel(id)}</Text>
            </Pressable>
          ))}
        </View>
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
          style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
        >
          <Text style={styles.resetLabel}>{t('editeur.reinitialiser')}</Text>
        </Pressable>
      </View>
    </Animated.View>
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
    borderWidth: 1,
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
    width: 52,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  chipIcon: {
    height: ICON_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 11,
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
