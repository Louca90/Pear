import { t } from '../i18n';
import { ComponentRef, memo, Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, findNodeHandle, Image, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { SlidersHorizontal, Trash2, Type } from 'lucide-react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useRotationGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Svg, { Defs, FeColorMatrix, Filter, G, Image as SvgImage } from 'react-native-svg';

import { captureView, editVideo } from '../../modules/pear-native';
import { VIDEO_BITRATE } from '../config';
import { createMediaStyles, radius, spacing, useMediaColors } from '../theme';
import { useInsets, useNavigationBarHeight } from './ui';
import { log } from '../log';
import { AdjustPanel } from './editor/AdjustPanel';
import { ColorMatrix, isIdentity, toMedia3 } from './editor/colorMatrix';
import { EditorToolbar, TOOL_SIZE } from './editor/EditorToolbar';
import { FilteredView } from './editor/FilteredView';
import { Adjustments, FilterId, matrixOf, neighborOf, NO_ADJUSTMENTS, presetOf, stepsOf } from './editor/filters';
import { bringToFront, clamp, Layer, layerAt, newLayerId, SCALE_MAX, SCALE_MIN, Size, TEXT_SIZE_DEFAULT, TextLayer, updateLayer } from './editor/layers';
import { formatStamp, Stamp, StampMarks } from './editor/stamps';
import { TextEditor } from './editor/TextEditor';
import { TextLayerView } from './editor/TextLayerView';

// Un glissé horizontal devient un changement de filtre au-delà de cette distance.
const SWIPE_START = 12;
// Lâché après ce tiers de l'écran, ou lancé assez vite, le filtre voisin s'installe.
const SWIPE_COMMIT = 0.3;
const SWIPE_FLING = 500;
// Vidéo (une seule vue vidéo, pas d'aperçu pendant le glissé) : distance pour passer au filtre voisin.
const VIDEO_SWIPE_DISTANCE = 50;
const SWIPE_MS = 220;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const TRASH_SIZE = 56;
const TRASH_REACH = 56;
// Les calques sont enregistrés plus grands que l'aperçu (jusqu'à la taille de la photo) : textes nets.
const EXPORT_SCALE_MAX = 2.5;
// Largeur maximale d'un texte, avant qu'il passe à la ligne (en part de l'aperçu).
const TEXT_MAX_WIDTH = 0.86;

export type MediaEditorHandle = {
  // Grave les retouches dans un nouveau fichier. Sans retouche, renvoie le fichier d'origine.
  flatten: () => Promise<string>;
};

function vibrate() {
  Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
}

function EditorVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (created) => {
    created.loop = true;
    created.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />;
}

// Une couche visible de la photo : filtrée par la carte graphique, avec la marque du filtre. Mémorisée :
// déplacer un texte ne la redessine pas.
const PhotoLayer = memo(function PhotoLayer({ uri, id, adjustments, stamp, width, height }: { uri: string; id: FilterId; adjustments: Adjustments; stamp: Stamp; width: number; height: number }) {
  const kind = presetOf(id).stamp;
  return (
    <>
      <FilteredView steps={stepsOf(id, adjustments)} style={StyleSheet.absoluteFill}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      </FilteredView>
      {kind && (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
          <StampMarks kind={kind} stamp={stamp} width={width} height={height} />
        </Svg>
      )}
    </>
  );
});

type Props = {
  uri: string;
  kind: 'image' | 'video';
  takenAt: number;
  // Le filtre choisi dans l'appareil photo avant la prise.
  initialFilter?: FilterId;
  // Un outil occupe l'écran (réglages, texte, déplacement) : l'écran parent range ses boutons.
  onToolChange?: (open: boolean) => void;
  ref: Ref<MediaEditorHandle>;
};

// À l'écran, tout passe par des vues : filtres de la carte graphique pour l'image, textes en vues
// React Native. Le fichier final sort d'une copie cachée sous l'aperçu (la photo avec sa matrice
// exacte, la marque et les calques), dessinée dans une image par le module natif : ce qu'on voit est
// ce qui part. Pour une vidéo, cette copie sans image devient le calque transparent que Media3 incruste
// pendant qu'il applique la même matrice à toute la vidéo.
export function MediaEditor({ uri, kind, takenAt, initialFilter = 'none', onToolChange, ref }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top: topInset } = useInsets();
  const navigationBar = useNavigationBarHeight();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  const [adjustments, setAdjustments] = useState<Adjustments>(NO_ADJUSTMENTS);
  const [adjusting, setAdjusting] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  // Le texte en cours d'écriture (nouveau, ou existant : il est alors caché sur l'image).
  const [editing, setEditing] = useState<TextLayer | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  // Pendant un glissé sur une photo : le filtre voisin (1 : suivant, par la droite ; -1 : précédent).
  const [swipeDirection, setSwipeDirection] = useState<0 | 1 | -1>(0);
  const reveal = useRef(new Animated.Value(0)).current;
  const exportRoot = useRef<ComponentRef<typeof View>>(null);
  const screen = Dimensions.get('screen');

  useEffect(() => {
    const measured = kind === 'video' ? getThumbnailAsync(uri, { time: 0 }) : Image.getSize(uri);
    measured.then(({ width: measuredWidth, height: measuredHeight }) => setSize({ width: measuredWidth, height: measuredHeight })).catch((e) => log.warn('média', e));
  }, [uri, kind]);

  const busy = adjusting || editing !== null || dragging !== null;
  useEffect(() => {
    onToolChange?.(busy);
  }, [busy, onToolChange]);

  // Le nom du filtre apparaît un instant au milieu, puis s'efface.
  const toast = useRef(new Animated.Value(0)).current;
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    toast.stopAnimation();
    Animated.sequence([
      Animated.timing(toast, { toValue: 1, duration: 150, easing: EASING, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(toast, { toValue: 0, duration: 300, easing: EASING, useNativeDriver: true }),
    ]).start();
  }, [filter, toast]);

  // La corbeille monte du bas pendant qu'on déplace un calque, et grossit quand il est dessus.
  const trash = useRef(new Animated.Value(0)).current;
  const trashHover = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(trash, { toValue: dragging ? 1 : 0, duration: 180, easing: EASING, useNativeDriver: true }).start();
  }, [dragging, trash]);
  useEffect(() => {
    Animated.timing(trashHover, { toValue: overTrash ? 1 : 0, duration: 140, easing: EASING, useNativeDriver: true }).start();
  }, [overTrash, trashHover]);

  const fit = size ? Math.min(screen.width / size.width, screen.height / size.height) : 1;
  const width = size ? size.width * fit : screen.width;
  const height = size ? size.height * fit : screen.height;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  const textMaxWidth = width * TEXT_MAX_WIDTH;
  const [stamp] = useState(() => formatStamp(takenAt));

  const steps = stepsOf(filter, adjustments);
  const neighbor = swipeDirection !== 0 ? neighborOf(filter, swipeDirection) : null;
  const trashCenter = { x: screen.width / 2, y: screen.height - navigationBar - spacing.lg - TRASH_SIZE / 2 };

  const measure = useCallback((id: string, measured: Size) => {
    setSizes((current) => (current[id]?.width === measured.width && current[id]?.height === measured.height ? current : { ...current, [id]: measured }));
  }, []);

  // --- Export ---

  // La copie cachée ne reçoit la matrice qu'au moment d'enregistrer (sinon elle se redessinerait à
  // chaque geste), puis elle est dessinée deux images plus tard.
  const [exportMatrix, setExportMatrix] = useState<ColorMatrix | null>(null);
  const [exportToken, setExportToken] = useState(0);
  const exportDone = useRef<{ resolve: (uri: string) => void; reject: (error: unknown) => void } | null>(null);
  useEffect(() => {
    if (!exportToken) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const done = exportDone.current;
        exportDone.current = null;
        const tag = findNodeHandle(exportRoot.current);
        if (!done) return;
        if (!tag || !size) {
          done.reject(new Error("L'image n'est pas prête."));
          return;
        }
        const output = new File(Paths.cache, `edited-${Date.now()}.png`).uri;
        captureView(tag, output, clamp(size.width / width, 1, EXPORT_SCALE_MAX)).then(done.resolve, done.reject);
      }),
    );
  }, [exportToken, size, width]);

  const snapshot = (matrix: ColorMatrix | null) =>
    new Promise<string>((resolve, reject) => {
      exportDone.current = { resolve, reject };
      setExportMatrix(matrix);
      setExportToken(Date.now());
    });

  useImperativeHandle(ref, () => ({
    flatten: async () => {
      const matrix = matrixOf(steps);
      const colored = !isIdentity(matrix);
      const marked = !!presetOf(filter).stamp || layers.length > 0;
      if (!colored && !marked) return uri;
      if (kind === 'image') return snapshot(colored ? matrix : null);
      // Vidéo : le calque seulement s'il y a quelque chose à poser dessus.
      const overlayUri = marked ? await snapshot(null) : undefined;
      return editVideo(uri, { overlayUri, matrix: colored ? toMedia3(matrix) : undefined, bitrate: VIDEO_BITRATE });
    },
  }));

  // --- Filtres ---

  const settling = useRef(false);
  const settleSwipe = (direction: 1 | -1, commit: boolean) => {
    settling.current = true;
    Animated.timing(reveal, { toValue: commit ? 1 : 0, duration: SWIPE_MS, easing: EASING, useNativeDriver: true }).start(() => {
      settling.current = false;
      if (commit) setFilter((current) => neighborOf(current, direction));
      setSwipeDirection(0);
    });
  };
  // Remis à zéro une fois la couche voisine retirée : sinon l'ancien filtre reparaîtrait une image.
  useEffect(() => {
    if (swipeDirection === 0) reveal.setValue(0);
  }, [swipeDirection, reveal]);

  // --- Gestes ---

  // Un doigt sur un calque le déplace ; ailleurs, il change de filtre. Deux doigts pincent et tournent
  // le calque touché. Les gestes lisent l'état du dernier rendu par cette référence.
  const touch = useRef({
    target: null as string | null,
    base: { x: 0, y: 0, scale: 1, rotation: 0 },
    moved: false,
    swiping: false,
    direction: 0 as 0 | 1 | -1,
    ignored: false,
    overTrash: false,
  });

  const startNewText = () => {
    vibrate();
    setEditing({ id: newLayerId(), kind: 'text', text: '', font: 'classic', color: '#FFFFFF', background: 'none', size: TEXT_SIZE_DEFAULT, x: width / 2, y: height * 0.45, scale: 1, rotation: 0 });
  };

  const latest = {
    target: (x: number, y: number) => {
      const state = touch.current;
      if (state.target) return state.target;
      const hit = layerAt(layers, sizes, x, y);
      if (!hit) return null;
      state.target = hit.id;
      state.base = { x: hit.x, y: hit.y, scale: hit.scale, rotation: hit.rotation };
      return hit.id;
    },
    panBegin: (x: number, y: number) => {
      const state = touch.current;
      state.ignored = settling.current;
      state.moved = false;
      state.swiping = false;
      state.direction = 0;
      latest.target(x, y);
    },
    panUpdate: (dx: number, dy: number, absoluteX: number, absoluteY: number) => {
      const state = touch.current;
      if (state.ignored) return;
      if (state.target) {
        if (!state.moved) {
          state.moved = true;
          setLayers((current) => bringToFront(current, state.target as string));
          setDragging(state.target);
        }
        setLayers((current) => updateLayer(current, state.target as string, { x: state.base.x + dx, y: state.base.y + dy }));
        const over = Math.hypot(absoluteX - trashCenter.x, absoluteY - trashCenter.y) < TRASH_REACH;
        if (over !== state.overTrash) {
          state.overTrash = over;
          setOverTrash(over);
          if (over) vibrate();
        }
        return;
      }
      if (!state.swiping && Math.abs(dx) > SWIPE_START && Math.abs(dx) > Math.abs(dy)) state.swiping = true;
      if (!state.swiping || kind !== 'image') return;
      // Vers la gauche, le filtre suivant arrive par la droite, comme sur Snap.
      const direction = dx < 0 ? 1 : -1;
      if (direction !== state.direction) {
        state.direction = direction;
        setSwipeDirection(direction);
      }
      reveal.setValue(Math.min(1, Math.abs(dx) / width));
    },
    panEnd: (dx: number, velocityX: number) => {
      const state = touch.current;
      if (state.ignored || state.target || !state.swiping) return;
      const direction = dx < 0 ? 1 : -1;
      if (kind !== 'image') {
        if (Math.abs(dx) > VIDEO_SWIPE_DISTANCE) setFilter((current) => neighborOf(current, direction));
        return;
      }
      const thrown = Math.abs(velocityX) > SWIPE_FLING && Math.sign(velocityX) === Math.sign(dx);
      settleSwipe(direction, Math.abs(dx) / width > SWIPE_COMMIT || thrown);
    },
    pinch: (scale: number) => {
      const state = touch.current;
      if (state.target) setLayers((current) => updateLayer(current, state.target as string, { scale: clamp(state.base.scale * scale, SCALE_MIN, SCALE_MAX) }));
    },
    rotate: (rotation: number) => {
      const state = touch.current;
      if (state.target) setLayers((current) => updateLayer(current, state.target as string, { rotation: state.base.rotation + rotation }));
    },
    // Tous les doigts levés : le calque lâché sur la corbeille disparaît.
    release: () => {
      const state = touch.current;
      if (state.target && state.overTrash) {
        const id = state.target;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((e) => log.warn('vibration', e));
        setLayers((current) => current.filter((layer) => layer.id !== id));
      }
      state.target = null;
      state.moved = false;
      state.overTrash = false;
      setOverTrash(false);
      setDragging(null);
    },
    cancel: () => {
      const state = touch.current;
      if (!state.ignored && !state.target && state.swiping && state.direction !== 0) settleSwipe(state.direction, false);
    },
    // Un toucher : modifie le texte touché, ou en commence un nouveau.
    tap: (x: number, y: number) => {
      if (busy) return;
      const hit = layerAt(layers, sizes, x, y);
      if (hit) {
        vibrate();
        setEditing(hit);
      } else {
        startNewText();
      }
    },
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;
  const fingers = useRef(0);
  const finger = (delta: number) => {
    fingers.current = Math.max(0, fingers.current + delta);
    if (fingers.current === 0) latestRef.current.release();
  };

  const pan = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    maxPointers: 2,
    onBegin: (event) => {
      finger(1);
      latestRef.current.panBegin(event.x, event.y);
    },
    onUpdate: (event) => latestRef.current.panUpdate(event.translationX, event.translationY, event.absoluteX, event.absoluteY),
    onDeactivate: (event) => latestRef.current.panEnd(event.translationX, event.velocityX),
    onFinalize: (event) => {
      if (event.canceled) latestRef.current.cancel();
      finger(-1);
    },
  });
  const pinch = usePinchGesture({
    runOnJS: true,
    disableReanimated: true,
    onBegin: () => finger(1),
    // Le calque visé se choisit au premier mouvement, sous le milieu des deux doigts.
    onUpdate: (event) => {
      latestRef.current.target(event.focalX, event.focalY);
      latestRef.current.pinch(event.scale);
    },
    onFinalize: () => finger(-1),
  });
  const rotation = useRotationGesture({
    runOnJS: true,
    disableReanimated: true,
    onBegin: () => finger(1),
    onUpdate: (event) => {
      latestRef.current.target(event.anchorX, event.anchorY);
      latestRef.current.rotate(event.rotation);
    },
    onFinalize: () => finger(-1),
  });
  const tap = useTapGesture({
    runOnJS: true,
    disableReanimated: true,
    onActivate: (event) => latestRef.current.tap(event.x, event.y),
  });
  const gestures = useSimultaneousGestures(pan, pinch, rotation, tap);

  const finishEditing = (layer: TextLayer) => {
    setEditing(null);
    setLayers((current) => {
      const exists = current.some((item) => item.id === layer.id);
      if (!layer.text) return current.filter((item) => item.id !== layer.id);
      return exists ? updateLayer(current, layer.id, layer) : [...current, layer];
    });
  };

  // La couche voisine arrive par un bord : le cadre glisse, l'image dedans reste immobile. Tout est
  // animé par le moteur natif, sans repasser par React à chaque image.
  const side = swipeDirection === 1 ? 1 : -1;
  const frameX = reveal.interpolate({ inputRange: [0, 1], outputRange: [side * width, 0] });
  const contentX = reveal.interpolate({ inputRange: [0, 1], outputRange: [-side * width, 0] });
  const currentStamp = presetOf(filter).stamp;

  const textLayers = (measured: boolean) =>
    layers.map((layer) => (
      <TextLayerView
        key={layer.id}
        layer={layer}
        maxWidth={textMaxWidth}
        size={sizes[layer.id]}
        onMeasure={measured ? measure : undefined}
        hidden={measured && (editing?.id === layer.id || (dragging === layer.id && overTrash))}
      />
    ));

  return (
    <>
      <View style={[styles.canvas, { width, height, left, top }]}>
        {/* Le fichier final, caché sous l'aperçu. */}
        {size && (
          <View ref={exportRoot} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
              {exportMatrix && (
                <Defs>
                  <Filter id="export" x="0" y="0" width="100%" height="100%">
                    <FeColorMatrix type="matrix" values={[...exportMatrix]} />
                  </Filter>
                </Defs>
              )}
              {kind === 'image' && (
                <G filter={exportMatrix ? 'url(#export)' : undefined}>
                  <SvgImage href={{ uri }} width={width} height={height} preserveAspectRatio="xMidYMid slice" />
                </G>
              )}
              <StampMarks kind={currentStamp} stamp={stamp} width={width} height={height} />
            </Svg>
            {textLayers(false)}
          </View>
        )}

        {size && kind === 'image' && <PhotoLayer uri={uri} id={filter} adjustments={adjustments} stamp={stamp} width={width} height={height} />}
        {size && kind === 'video' && (
          <>
            <FilteredView steps={steps} style={StyleSheet.absoluteFill}>
              <EditorVideo uri={uri} />
            </FilteredView>
            {currentStamp && (
              <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
                <StampMarks kind={currentStamp} stamp={stamp} width={width} height={height} />
              </Svg>
            )}
          </>
        )}
        {size && neighbor && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { transform: [{ translateX: frameX }] }]}>
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: contentX }] }]}>
              <PhotoLayer uri={uri} id={neighbor} adjustments={adjustments} stamp={stamp} width={width} height={height} />
            </Animated.View>
          </Animated.View>
        )}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {textLayers(true)}
        </View>

        <GestureDetector gesture={gestures}>
          <View
            collapsable={false}
            style={StyleSheet.absoluteFill}
            accessibilityLabel={t('editeur.aide')}
            accessibilityHint={t(presetOf(filter).label)}
            accessibilityActions={[{ name: 'increment', label: t('editeur.filtreSuivant') }, { name: 'decrement', label: t('editeur.filtrePrecedent') }]}
            onAccessibilityAction={({ nativeEvent }) => setFilter((current) => neighborOf(current, nativeEvent.actionName === 'increment' ? 1 : -1))}
          />
        </GestureDetector>
      </View>

      <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toast, transform: [{ scale: toast.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
        <Text style={styles.toastLabel}>{t(presetOf(filter).label)}</Text>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.trash,
          {
            left: trashCenter.x - TRASH_SIZE / 2,
            top: trashCenter.y - TRASH_SIZE / 2,
            opacity: trash,
            transform: [
              { translateY: trash.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              { scale: trashHover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
            ],
          },
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.trashOn, { opacity: trashHover }]} />
        <Trash2 size={24} color={colors.background} strokeWidth={1.75} />
      </Animated.View>

      <EditorToolbar
        top={topInset + spacing.md + TOOL_SIZE + spacing.md}
        hidden={busy}
        tools={[
          { id: 'text', icon: Type, label: t('editeur.texte'), onPress: startNewText },
          { id: 'adjust', icon: SlidersHorizontal, label: t('editeur.reglages'), active: adjusting, onPress: () => setAdjusting(true) },
        ]}
      />

      {adjusting && <AdjustPanel value={adjustments} bottom={navigationBar} onChange={setAdjustments} onClose={() => setAdjusting(false)} />}
      {editing && <TextEditor layer={editing} maxWidth={textMaxWidth} onDone={finishEditing} />}
    </>
  );
}

const useStyles = createMediaStyles((colors) => ({
  canvas: {
    position: 'absolute',
  },
  clip: {
    overflow: 'hidden',
  },
  toast: {
    position: 'absolute',
    top: '44%',
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  toastLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.background,
  },
  trash: {
    position: 'absolute',
    width: TRASH_SIZE,
    height: TRASH_SIZE,
    borderRadius: TRASH_SIZE / 2,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trashOn: {
    backgroundColor: colors.danger,
  },
}));
