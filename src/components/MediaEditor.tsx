import { t } from '../i18n';
import { ComponentRef, memo, Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, findNodeHandle, Image, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { haptics } from '../haptics';
import { useVideoPlayer, VideoPlayer, VideoView } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { Crop as CropIcon, Gauge, Pencil, Scissors, SlidersHorizontal, Smile, Trash2, Type, Volume2, VolumeX } from 'lucide-react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useRotationGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Svg, { Defs, FeColorMatrix, Filter, G, Image as SvgImage } from 'react-native-svg';

import { captureView, editVideo } from '../../modules/pear-native';
import { VIDEO_BITRATE } from '../config';
import { createMediaStyles, fixed, radius, spacing, useMediaColors } from '../theme';
import { useInsets, useNavigationBarHeight } from './ui';
import { log } from '../log';
import { AdjustPanel } from './editor/AdjustPanel';
import { ColorMatrix, isIdentity, toMedia3 } from './editor/colorMatrix';
import { EditorToolbar, TOOL_SIZE } from './editor/EditorToolbar';
import { FilteredView } from './editor/FilteredView';
import { Adjustments, FilterId, matrixOf, neighborOf, NO_ADJUSTMENTS, presetOf, stepsOf } from './editor/filters';
import { bringToFront, clamp, Layer, layerAt, newLayerId, SCALE_MAX, SCALE_MIN, Size, TEXT_SIZE_DEFAULT, TextLayer, updateLayer } from './editor/layers';
import { getStampStyle, readAmbient } from './editor/ambient';
import { Ambient, formatStamp, NO_AMBIENT, Stamp, StampMarks } from './editor/stamps';
import { TextEditor } from './editor/TextEditor';
import { TextLayerView } from './editor/TextLayerView';
import { StickerLayerView } from './editor/StickerLayerView';
import { StickerPicker } from './editor/StickerPicker';
import { DrawPanel, StrokesView } from './editor/DrawPanel';
import { BRUSH_DEFAULT, Stroke } from './editor/drawing';
import { Crop, cropGeometry, ImagePlacement, isCropped, NO_CROP } from './editor/crop';
import { CropPanel } from './editor/CropPanel';
import { Trim, TrimPanel } from './editor/TrimPanel';

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
// Les vitesses proposées, dans l'ordre où le bouton les fait défiler.
const SPEEDS = [1, 1.5, 2, 0.5];
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
  haptics.select();
}

function EditorVideo({ player }: { player: VideoPlayer }) {
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />;
}

// Une couche visible de la photo : filtrée par la carte graphique, avec la marque du filtre. Mémorisée :
// déplacer un texte ne la redessine pas.
// La photo est placée (et tournée) pour que la partie gardée au recadrage remplisse l'aperçu.
function placedImageStyle(placement: ImagePlacement) {
  return {
    position: 'absolute' as const,
    left: placement.left,
    top: placement.top,
    width: placement.width,
    height: placement.height,
    transform: [{ rotate: `${placement.rotation}deg` }],
  };
}

const PhotoLayer = memo(function PhotoLayer({ uri, id, adjustments, stamp, width, height, placement }: { uri: string; id: FilterId; adjustments: Adjustments; stamp: Stamp; width: number; height: number; placement: ImagePlacement }) {
  const kind = presetOf(id).stamp;
  return (
    <>
      <FilteredView steps={stepsOf(id, adjustments)} style={StyleSheet.absoluteFill}>
        <Image source={{ uri }} style={placedImageStyle(placement)} resizeMode="stretch" />
      </FilteredView>
      {kind && (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
          <StampMarks kind={kind} stamp={stamp} width={width} height={height} variant={getStampStyle(kind)} />
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
  const [picking, setPicking] = useState(false);
  const [crop, setCrop] = useState<Crop>(NO_CROP);
  const [cropping, setCropping] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brush, setBrush] = useState({ color: fixed.white, width: BRUSH_DEFAULT });
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

  // Vidéo : découpe, son et vitesse, appliqués à l'aperçu par le lecteur puis au fichier par Media3.
  const [trimming, setTrimming] = useState(false);
  const [trim, setTrim] = useState<Trim>({ start: 0, end: null });
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const playhead = useRef(new Animated.Value(0)).current;
  const scrubbing = useRef(false);
  const player = useVideoPlayer(kind === 'video' ? uri : null, (created) => {
    created.loop = true;
    created.timeUpdateEventInterval = 0.05;
    created.play();
  });
  useEffect(() => {
    if (kind !== 'video') return;
    if (player.duration > 0) setDuration(player.duration);
    const loaded = player.addListener('sourceLoad', (event) => setDuration(event.duration));
    return () => loaded.remove();
  }, [kind, player]);
  // La lecture tourne en boucle dans la partie gardée.
  useEffect(() => {
    if (kind !== 'video') return;
    const ticking = player.addListener('timeUpdate', ({ currentTime }) => {
      playhead.setValue(currentTime);
      if (scrubbing.current) return;
      const last = trim.end ?? duration;
      if ((last > 0 && currentTime >= last - 0.03) || currentTime < trim.start - 0.15) player.currentTime = trim.start;
    });
    return () => ticking.remove();
  }, [kind, player, trim, duration, playhead]);
  useEffect(() => {
    if (kind === 'video') player.muted = muted;
  }, [kind, player, muted]);
  useEffect(() => {
    if (kind === 'video') player.playbackRate = speed;
  }, [kind, player, speed]);

  const scrub = (time: number | null) => {
    if (time === null) {
      scrubbing.current = false;
      player.currentTime = trim.start;
      player.play();
      return;
    }
    scrubbing.current = true;
    player.pause();
    player.currentTime = time;
  };

  const busy = adjusting || picking || drawing || cropping || trimming || editing !== null || dragging !== null;
  useEffect(() => {
    onToolChange?.(busy);
  }, [busy, onToolChange]);

  // Un message apparaît un instant au milieu, puis s'efface : le nom du filtre, la vitesse, le son.
  const toast = useRef(new Animated.Value(0)).current;
  const [toastText, setToastText] = useState('');
  const showToast = useCallback(
    (text: string) => {
      setToastText(text);
      toast.stopAnimation();
      Animated.sequence([
        Animated.timing(toast, { toValue: 1, duration: 150, easing: EASING, useNativeDriver: true }),
        Animated.delay(700),
        Animated.timing(toast, { toValue: 0, duration: 300, easing: EASING, useNativeDriver: true }),
      ]).start();
    },
    [toast],
  );
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    showToast(t(presetOf(filter).label));
  }, [filter, showToast]);

  // La corbeille monte du bas pendant qu'on déplace un calque, et grossit quand il est dessus.
  const trash = useRef(new Animated.Value(0)).current;
  const trashHover = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(trash, { toValue: dragging ? 1 : 0, duration: 180, easing: EASING, useNativeDriver: true }).start();
  }, [dragging, trash]);
  useEffect(() => {
    Animated.timing(trashHover, { toValue: overTrash ? 1 : 0, duration: 140, easing: EASING, useNativeDriver: true }).start();
  }, [overTrash, trashHover]);

  const geometry = cropGeometry(size ?? screen, crop, screen);
  const { width, height, image: placement, pixelsPerPoint } = geometry;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  const textMaxWidth = width * TEXT_MAX_WIDTH;
  // Lieu, Série et Batterie se lisent sur le téléphone quand le filtre est choisi (jamais avant).
  const [ambient, setAmbient] = useState<Ambient>(NO_AMBIENT);
  const stamp = useMemo(() => formatStamp(takenAt, ambient), [takenAt, ambient]);
  const stampKind = presetOf(filter).stamp;
  useEffect(() => {
    if (!stampKind) return;
    let current = true;
    readAmbient(stampKind).then((found) => current && setAmbient((previous) => ({ ...previous, ...found })));
    return () => {
      current = false;
    };
  }, [stampKind]);

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
          done.reject(new Error(t('editeur.imagePasPrete')));
          return;
        }
        const output = new File(Paths.cache, `edited-${Date.now()}.png`).uri;
        captureView(tag, output, clamp(pixelsPerPoint, 1, EXPORT_SCALE_MAX)).then(done.resolve, done.reject);
      }),
    );
  }, [exportToken, size, pixelsPerPoint]);

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
      const marked = !!presetOf(filter).stamp || layers.length > 0 || strokes.length > 0;
      const last = trim.end ?? duration;
      const timing = {
        startMs: trim.start > 0.05 ? Math.round(trim.start * 1000) : undefined,
        endMs: trim.end !== null && duration > 0 && trim.end < duration - 0.05 ? Math.round(last * 1000) : undefined,
        mute: muted || undefined,
        speed: speed !== 1 ? speed : undefined,
      };
      const timed = kind === 'video' && (timing.startMs !== undefined || timing.endMs !== undefined || muted || speed !== 1);
      if (!colored && !marked && !timed && !isCropped(crop)) return uri;
      if (kind === 'image') return snapshot(colored ? matrix : null);
      // Vidéo : le calque seulement s'il y a quelque chose à poser dessus.
      const overlayUri = marked ? await snapshot(null) : undefined;
      return editVideo(uri, { overlayUri, matrix: colored ? toMedia3(matrix) : undefined, ...timing, bitrate: VIDEO_BITRATE });
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
    setEditing({ id: newLayerId(), kind: 'text', text: '', font: 'classic', color: fixed.white, background: 'none', size: TEXT_SIZE_DEFAULT, x: width / 2, y: height * 0.45, scale: 1, rotation: 0 });
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
        haptics.action();
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
      if (hit?.kind === 'text') {
        vibrate();
        setEditing(hit);
      } else if (!hit) {
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

  // Les calques, à l'écran (mesurés, animés) ou dans la copie de l'export (mêmes tailles, immobiles).
  const textLayers = (measured: boolean) =>
    layers.map((layer) => {
      const hidden = measured && (editing?.id === layer.id || (dragging === layer.id && overTrash));
      const onMeasure = measured ? measure : undefined;
      if (layer.kind === 'sticker') return <StickerLayerView key={layer.id} layer={layer} size={sizes[layer.id]} onMeasure={onMeasure} hidden={hidden} animated={measured} />;
      return <TextLayerView key={layer.id} layer={layer} maxWidth={textMaxWidth} size={sizes[layer.id]} onMeasure={onMeasure} hidden={hidden} />;
    });

  const addSticker = (emoji: string) =>
    setLayers((current) => [...current, { id: newLayerId(), kind: 'sticker', emoji, x: width / 2, y: height / 2, scale: 1, rotation: 0 }]);

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
                  <SvgImage
                    href={{ uri }}
                    x={placement.left}
                    y={placement.top}
                    width={placement.width}
                    height={placement.height}
                    preserveAspectRatio="none"
                    transform={`rotate(${placement.rotation} ${placement.left + placement.width / 2} ${placement.top + placement.height / 2})`}
                  />
                </G>
              )}
              <StampMarks kind={currentStamp} stamp={stamp} width={width} height={height} variant={currentStamp ? getStampStyle(currentStamp) : 0} />
            </Svg>
            <StrokesView strokes={strokes} width={width} height={height} />
            {textLayers(false)}
          </View>
        )}

        {size && kind === 'image' && <PhotoLayer uri={uri} id={filter} adjustments={adjustments} stamp={stamp} width={width} height={height} placement={placement} />}
        {size && kind === 'video' && (
          <>
            <FilteredView steps={steps} style={StyleSheet.absoluteFill}>
              <EditorVideo player={player} />
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
              <PhotoLayer uri={uri} id={neighbor} adjustments={adjustments} stamp={stamp} width={width} height={height} placement={placement} />
            </Animated.View>
          </Animated.View>
        )}
        <StrokesView strokes={strokes} width={width} height={height} />
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
        <Text style={styles.toastLabel}>{toastText}</Text>
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
          ...(kind === 'image' ? [{ id: 'crop', icon: CropIcon, label: t('editeur.recadrer'), onPress: () => setCropping(true) }] : []),
          ...(kind === 'video'
            ? [
                { id: 'trim', icon: Scissors, label: t('editeur.decouper'), active: trim.start > 0 || trim.end !== null, onPress: () => duration > 0 && setTrimming(true) },
                {
                  id: 'sound',
                  icon: muted ? VolumeX : Volume2,
                  label: muted ? t('editeur.sonCoupe') : t('editeur.son'),
                  active: muted,
                  onPress: () => {
                    vibrate();
                    setMuted((current) => !current);
                    showToast(muted ? t('editeur.son') : t('editeur.sonCoupe'));
                  },
                },
                {
                  id: 'speed',
                  icon: Gauge,
                  label: t('editeur.vitesse'),
                  active: speed !== 1,
                  onPress: () => {
                    vibrate();
                    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                    setSpeed(next);
                    showToast(t('editeur.vitesseValeur', { vitesse: String(next).replace('.', ',') }));
                  },
                },
              ]
            : []),
          { id: 'draw', icon: Pencil, label: t('editeur.dessin'), onPress: () => setDrawing(true) },
          { id: 'stickers', icon: Smile, label: t('editeur.stickers'), onPress: () => setPicking(true) },
          { id: 'adjust', icon: SlidersHorizontal, label: t('editeur.reglages'), active: adjusting, onPress: () => setAdjusting(true) },
        ]}
      />

      {adjusting && <AdjustPanel value={adjustments} bottom={navigationBar} onChange={setAdjustments} onClose={() => setAdjusting(false)} />}
      {drawing && (
        <DrawPanel
          frame={{ left, top, width, height }}
          strokes={strokes}
          color={brush.color}
          width={brush.width}
          bottom={navigationBar}
          onStrokes={setStrokes}
          onBrush={setBrush}
          onClose={() => setDrawing(false)}
        />
      )}
      {trimming && duration > 0 && (
        <TrimPanel uri={uri} duration={duration} trim={trim} playhead={playhead} bottom={navigationBar} onChange={setTrim} onScrub={scrub} onClose={() => setTrimming(false)} />
      )}
      {cropping && size && (
        <CropPanel
          uri={uri}
          image={size}
          crop={crop}
          bottom={navigationBar}
          onDone={(next) => {
            const after = cropGeometry(size, next, screen);
            const sx = after.width / width;
            const sy = after.height / height;
            setLayers((current) => current.map((layer) => ({ ...layer, x: layer.x * sx, y: layer.y * sy })));
            setStrokes((current) => current.map((stroke) => ({ ...stroke, points: stroke.points.map((value, index) => value * (index % 2 === 0 ? sx : sy)) })));
            setCrop(next);
            setCropping(false);
          }}
        />
      )}
      {picking && <StickerPicker bottom={navigationBar} onPick={addSticker} onClose={() => setPicking(false)} />}
      {editing && <TextEditor layer={editing} maxWidth={textMaxWidth} onDone={finishEditing} />}
    </>
  );
}

const useStyles = createMediaStyles((colors) => ({
  canvas: {
    position: 'absolute',
    overflow: 'hidden',
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
