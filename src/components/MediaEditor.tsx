import { t } from '../i18n';
import { ComponentRef, memo, ReactNode, Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Dimensions, findNodeHandle, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming, cancelAnimation, withDelay, withSequence } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { File, Paths } from 'expo-file-system';
import { haptics } from '../haptics';
import { useVideoPlayer, VideoPlayer, VideoView } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { ArrowRight, Crop as CropIcon, Gauge, Pencil, Scissors, SlidersHorizontal, Smile, Trash2, Type, Undo2, Volume2, VolumeX, X } from 'lucide-react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useRotationGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Svg, { Defs, FeColorMatrix, Filter, G, Image as SvgImage } from 'react-native-svg';

import { captureView, editVideo } from '../../modules/pear-native';
import { VIDEO_BITRATE } from '../config';
import { createMediaStyles, fixed, radius, spacing, useMediaColors } from '../theme';
import { IconButton, useInsets, useNavigationBarHeight, usePressFeedback } from './ui';
import { log } from '../log';
import { DURATION, timing } from '../motion';
import { AdjustPanel } from './editor/AdjustPanel';
import { AmbiancePanel } from './editor/AmbiancePanel';
import { ColorMatrix, isIdentity, toMedia3 } from './editor/colorMatrix';
import { AmbianceIcon, EditorToolbar, TOOLBAR_HEIGHT } from './editor/EditorToolbar';
import { FilteredView } from './editor/FilteredView';
import { Adjustments, FilterId, isAdjusted, matrixOf, neighborOf, NO_ADJUSTMENTS, presetOf, stepsOf } from './editor/filters';
import { bringToFront, clamp, Layer, layerAt, newLayerId, SCALE_MAX, SCALE_MIN, Size, TEXT_SIZE_DEFAULT, TextLayer, updateLayer } from './editor/layers';
import { getStampStyle, peekAmbient, readAmbient } from './editor/ambient';
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
// Les boutons ronds du haut (fermer, annuler) et la pilule « Envoyer ».
const ROUND_SIZE = 44;
const SEND_HEIGHT = 40;
// Hauteur de la rangée Ambiance (vignette 80 + anneau + nom + marges).
const AMBIANCE_PANEL_HEIGHT = 136;
// Sans boutons fournis, l'écran parent pose son bouton d'envoi (52 points) en bas : la barre d'outils
// se place au-dessus.
const PARENT_SEND_HEIGHT = 52;
// Historique : une retouche est retenue quand rien n'a bougé pendant ce temps (un pincement, un
// glissé, un curseur ne font qu'un seul pas en arrière).
const HISTORY_SETTLE_MS = 400;
const HISTORY_MAX = 50;

// Tout ce que « annuler » sait remettre comme avant.
type Edits = { layers: Layer[]; strokes: Stroke[]; filter: FilterId; adjustments: Adjustments; crop: Crop; trim: Trim; muted: boolean; speed: number };

function sameEdits(a: Edits, b: Edits) {
  return (Object.keys(a) as (keyof Edits)[]).every((key) => a[key] === b[key]);
}

// La pilule claire « Envoyer », avec l'effet d'appui commun.
function SendPill({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useMediaColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Reanimated.View style={[styles.send, feedback.style]}>
        <Text style={styles.sendLabel}>{label}</Text>
        <ArrowRight size={16} color={colors.text} strokeWidth={2} />
      </Reanimated.View>
    </Pressable>
  );
}

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
  // Les boutons du haut de la maquette (fermer, annuler, « Envoyer » en pilule claire, et `extra` entre
  // les deux, par exemple « enregistrer »). Sans eux, l'écran parent garde ses propres boutons : l'éditeur
  // n'ajoute alors que « annuler », à droite du bouton fermer du parent, et pose sa barre d'outils au-dessus
  // du bouton d'envoi du parent.
  actions?: { onClose: () => void; onSend: () => void; sendLabel?: string; extra?: ReactNode };
  ref: Ref<MediaEditorHandle>;
};

// À l'écran, tout passe par des vues : filtres de la carte graphique pour l'image, textes en vues
// React Native. Le fichier final sort d'une copie cachée sous l'aperçu (la photo avec sa matrice
// exacte, la marque et les calques), dessinée dans une image par le module natif : ce qu'on voit est
// ce qui part. Pour une vidéo, cette copie sans image devient le calque transparent que Media3 incruste
// pendant qu'il applique la même matrice à toute la vidéo.
export function MediaEditor({ uri, kind, takenAt, initialFilter = 'none', onToolChange, actions, ref }: Props) {
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
  const reveal = useSharedValue(0);
  const exportRoot = useRef<ComponentRef<typeof View>>(null);
  const screen = Dimensions.get('screen');

  // L'image des vignettes Ambiance : la photo elle-même, ou la première image de la vidéo.
  const [videoPoster, setVideoPoster] = useState<string | null>(null);
  const poster = kind === 'image' ? uri : videoPoster;
  useEffect(() => {
    if (kind === 'video') {
      getThumbnailAsync(uri, { time: 0 })
        .then((thumbnail) => {
          setSize({ width: thumbnail.width, height: thumbnail.height });
          setVideoPoster(thumbnail.uri);
        })
        .catch((e) => log.warn('média', e));
      return;
    }
    Image.getSize(uri)
      .then(({ width: measuredWidth, height: measuredHeight }) => setSize({ width: measuredWidth, height: measuredHeight }))
      .catch((e) => log.warn('média', e));
  }, [uri, kind]);
  // La rangée Ambiance, ouverte au-dessus de la barre d'outils (elle n'occupe pas l'écran : pas « busy »).
  const [ambiancing, setAmbiancing] = useState(false);

  // Vidéo : découpe, son et vitesse, appliqués à l'aperçu par le lecteur puis au fichier par Media3.
  const [trimming, setTrimming] = useState(false);
  const [trim, setTrim] = useState<Trim>({ start: 0, end: null });
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const playhead = useSharedValue(0);
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
      playhead.set(currentTime);
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

  // --- Annuler ---

  // `committed` : le dernier état retenu ; `past` : les précédents. Une retouche n'est retenue qu'une
  // fois l'outil refermé et les doigts immobiles (HISTORY_SETTLE_MS) ; avant, « annuler » la défait déjà.
  const edits: Edits = { layers, strokes, filter, adjustments, crop, trim, muted, speed };
  const committed = useRef(edits);
  const past = useRef<Edits[]>([]);
  const pending = !sameEdits(edits, committed.current);
  useEffect(() => {
    if (busy || !pending) return;
    const settled = edits;
    const timer = setTimeout(() => {
      past.current = [...past.current.slice(1 - HISTORY_MAX), committed.current];
      committed.current = settled;
    }, HISTORY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [busy, pending, layers, strokes, filter, adjustments, crop, trim, muted, speed]);
  const canUndo = pending || past.current.length > 0;
  const undo = () => {
    const target = pending ? committed.current : past.current.pop();
    if (!target) return;
    vibrate();
    committed.current = target;
    setLayers(target.layers);
    setStrokes(target.strokes);
    setFilter(target.filter);
    setAdjustments(target.adjustments);
    setCrop(target.crop);
    setTrim(target.trim);
    setMuted(target.muted);
    setSpeed(target.speed);
  };

  // Un message apparaît un instant au milieu, puis s'efface : le nom du filtre, la vitesse, le son.
  const toast = useSharedValue(0);
  const [toastText, setToastText] = useState('');
  const showToast = useCallback(
    (text: string) => {
      setToastText(text);
      cancelAnimation(toast);
      toast.set(withSequence(withTiming(1, { duration: 150, easing: EASING }), withDelay(700, withTiming(0, { duration: 300, easing: EASING }))));
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
  const trash = useSharedValue(0);
  const trashHover = useSharedValue(0);
  useEffect(() => {
    trash.set(withTiming(dragging ? 1 : 0, { duration: 180, easing: EASING }));
  }, [dragging, trash]);
  useEffect(() => {
    trashHover.set(withTiming(overTrash ? 1 : 0, { duration: 140, easing: EASING }));
  }, [overTrash, trashHover]);

  const geometry = cropGeometry(size ?? screen, crop, screen);
  const { width, height, image: placement, pixelsPerPoint } = geometry;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  const textMaxWidth = width * TEXT_MAX_WIDTH;
  // Lieu et Batterie se lisent sur le téléphone quand le filtre est choisi (jamais avant).
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
  // Rangée Ambiance ouverte : la batterie et la ville (si déjà permise) s'écrivent sur leurs vignettes.
  useEffect(() => {
    if (!ambiancing) return;
    let current = true;
    peekAmbient().then((found) => current && setAmbient((previous) => ({ ...previous, ...found })));
    return () => {
      current = false;
    };
  }, [ambiancing]);

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
    const settled = () => {
      settling.current = false;
      if (commit) setFilter((current) => neighborOf(current, direction));
      setSwipeDirection(0);
    };
    reveal.set(
      withTiming(commit ? 1 : 0, { duration: SWIPE_MS, easing: EASING }, (finished) => {
        if (finished) scheduleOnRN(settled);
      }),
    );
  };
  // Remis à zéro une fois la couche voisine retirée : sinon l'ancien filtre reparaîtrait une image.
  useEffect(() => {
    if (swipeDirection === 0) reveal.set(0);
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

  // Les boutons de l'éditeur sont des Pressable, que le détecteur de gestes de l'image ne voit pas :
  // sans ce filtre, un appui sur un outil ajoutait aussi un texte. Un geste qui part de l'en-tête, de la
  // barre d'outils ou de la rangée Ambiance est laissé aux boutons.
  const onChrome = (absoluteY: number) => {
    if (busy) return false;
    const headerBottom = topInset + spacing.md + ROUND_SIZE + spacing.sm;
    const toolbarTop = screen.height - (toolbarBottom + toolbarInset + TOOLBAR_HEIGHT) - (ambiancing ? AMBIANCE_PANEL_HEIGHT + spacing.sm : 0);
    return absoluteY < headerBottom || absoluteY > toolbarTop;
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
      state.ignored = settling.current || onChrome(top + y);
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
      reveal.set(Math.min(1, Math.abs(dx) / width));
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
    tap: (x: number, y: number, absoluteY: number) => {
      if (busy || onChrome(absoluteY)) return;
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
    onActivate: (event) => latestRef.current.tap(event.x, event.y, event.absoluteY),
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
  // animé sur le fil de l'interface, sans repasser par React à chaque image.
  const side = swipeDirection === 1 ? 1 : -1;
  const frameSlide = useAnimatedStyle(() => ({ transform: [{ translateX: side * width * (1 - reveal.get()) }] }));
  const contentSlide = useAnimatedStyle(() => ({ transform: [{ translateX: -side * width * (1 - reveal.get()) }] }));
  const toastStyle = useAnimatedStyle(() => ({ opacity: toast.get(), transform: [{ scale: 0.96 + 0.04 * toast.get() }] }));
  const trashStyle = useAnimatedStyle(() => ({ opacity: trash.get(), transform: [{ translateY: 24 * (1 - trash.get()) }, { scale: 1 + 0.25 * trashHover.get() }] }));
  const currentStamp = presetOf(filter).stamp;

  // Les calques, à l'écran (mesurés, animés) ou dans la copie de l'export (mêmes tailles, immobiles).
  const textLayers = (measured: boolean) =>
    layers.map((layer) => {
      const hidden = measured && (editing?.id === layer.id || (dragging === layer.id && overTrash));
      const onMeasure = measured ? measure : undefined;
      if (layer.kind === 'sticker') return <StickerLayerView key={layer.id} layer={layer} size={sizes[layer.id]} onMeasure={onMeasure} hidden={hidden} animated={measured} />;
      return <TextLayerView key={layer.id} layer={layer} maxWidth={textMaxWidth} size={sizes[layer.id]} onMeasure={onMeasure} hidden={hidden} />;
    });

  // --- Barre d'outils et boutons du haut ---

  // Avec ses propres boutons, la barre est collée en bas ; sinon elle laisse la place au bouton d'envoi du parent.
  const toolbarBottom = actions ? 0 : navigationBar + spacing.lg + PARENT_SEND_HEIGHT + spacing.sm;
  const toolbarInset = actions ? navigationBar : 0;
  const selectedTool = ambiancing
    ? 'filters'
    : adjusting
      ? 'adjust'
      : drawing
        ? 'draw'
        : cropping
          ? 'crop'
          : trimming
            ? 'trim'
            : picking
              ? 'stickers'
              : editing
                ? 'text'
                : null;
  // Un outil qui prend l'écran referme la rangée Ambiance.
  const openTool = (open: () => void) => () => {
    setAmbiancing(false);
    open();
  };
  const headerVisible = useSharedValue(1);
  useEffect(() => {
    headerVisible.set(timing(busy ? 0 : 1, DURATION.small));
  }, [busy, headerVisible]);
  const headerShown = useAnimatedStyle(() => ({ opacity: headerVisible.get() }));

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
          <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, frameSlide]}>
            <Reanimated.View style={[StyleSheet.absoluteFill, contentSlide]}>
              <PhotoLayer uri={uri} id={neighbor} adjustments={adjustments} stamp={stamp} width={width} height={height} placement={placement} />
            </Reanimated.View>
          </Reanimated.View>
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

      <Reanimated.View pointerEvents="none" style={[styles.toast, toastStyle]}>
        <Text style={styles.toastLabel}>{toastText}</Text>
      </Reanimated.View>

      <Reanimated.View
        pointerEvents="none"
        style={[
          styles.trash,
          { left: trashCenter.x - TRASH_SIZE / 2, top: trashCenter.y - TRASH_SIZE / 2 },
          trashStyle,
        ]}
      >
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.trashOn, { opacity: trashHover }]} />
        <Trash2 size={24} color={colors.background} strokeWidth={1.75} />
      </Reanimated.View>

      <Reanimated.View pointerEvents={busy ? 'none' : 'box-none'} style={[styles.header, { top: topInset + spacing.md }, headerShown]}>
        {actions ? (
          <IconButton onPress={actions.onClose} label={t('editeur.fermer')} style={styles.round}>
            <X size={22} color={colors.background} strokeWidth={1.9} />
          </IconButton>
        ) : (
          // La place du bouton fermer de l'écran parent.
          <View pointerEvents="none" style={styles.roundSpace} />
        )}
        <IconButton onPress={undo} disabled={!canUndo} label={t('editeur.annulerAction')} style={styles.round}>
          <View style={!canUndo && styles.disabled}>
            <Undo2 size={22} color={colors.background} strokeWidth={1.9} />
          </View>
        </IconButton>
        <View style={styles.headerSpace} />
        {actions?.extra}
        {actions && <SendPill label={actions.sendLabel ?? t('editeur.envoyer')} onPress={actions.onSend} />}
      </Reanimated.View>

      {ambiancing && !busy && <AmbiancePanel value={filter} poster={poster} adjustments={adjustments} stamp={stamp} bottom={toolbarBottom + toolbarInset + TOOLBAR_HEIGHT + spacing.sm} onChange={setFilter} />}

      <EditorToolbar
        bottom={toolbarBottom}
        inset={toolbarInset}
        hidden={busy}
        selected={selectedTool}
        tools={[
          ...(kind === 'image' ? [{ id: 'crop', icon: CropIcon, label: t('editeur.recadrer'), on: isCropped(crop), onPress: openTool(() => setCropping(true)) }] : []),
          ...(kind === 'video'
            ? [{ id: 'trim', icon: Scissors, label: t('editeur.decouper'), on: trim.start > 0 || trim.end !== null, onPress: openTool(() => duration > 0 && setTrimming(true)) }]
            : []),
          { id: 'draw', icon: Pencil, label: t('editeur.dessin'), on: strokes.length > 0, onPress: openTool(() => setDrawing(true)) },
          { id: 'text', icon: Type, label: t('editeur.texte'), onPress: openTool(startNewText) },
          {
            id: 'filters',
            icon: AmbianceIcon,
            label: t('editeur.ambiance'),
            on: filter !== 'none',
            onPress: () => {
              vibrate();
              setAmbiancing((open) => !open);
            },
          },
          { id: 'stickers', icon: Smile, label: t('editeur.stickers'), onPress: openTool(() => setPicking(true)) },
          { id: 'adjust', icon: SlidersHorizontal, label: t('editeur.reglages'), on: isAdjusted(adjustments), onPress: openTool(() => setAdjusting(true)) },
          ...(kind === 'video'
            ? [
                {
                  id: 'sound',
                  icon: muted ? VolumeX : Volume2,
                  label: muted ? t('editeur.sonCoupe') : t('editeur.son'),
                  on: muted,
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
                  on: speed !== 1,
                  onPress: () => {
                    vibrate();
                    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                    setSpeed(next);
                    showToast(t('editeur.vitesseValeur', { vitesse: String(next).replace('.', ',') }));
                  },
                },
              ]
            : []),
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
  header: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerSpace: {
    flex: 1,
  },
  round: {
    width: ROUND_SIZE,
    height: ROUND_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundSpace: {
    width: ROUND_SIZE,
    height: ROUND_SIZE,
  },
  disabled: {
    opacity: 0.4,
  },
  send: {
    height: SEND_HEIGHT,
    paddingHorizontal: 18,
    borderRadius: SEND_HEIGHT / 2,
    backgroundColor: colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sendLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
}));
