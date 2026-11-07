import { dateLocale, t } from '../i18n';
import { ComponentRef, Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Image, PanResponder, StyleSheet, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { Check, SlidersHorizontal, Type } from 'lucide-react-native';
import Svg, { Defs, FeColorMatrix, Filter, G, Image as SvgImage, Rect, Text as SvgText } from 'react-native-svg';

import { editVideo } from '../../modules/pear-native';
import { VIDEO_BITRATE } from '../config';
import { createMediaStyles, radius, spacing, useMediaColors } from '../theme';
import { IconButton, useInsets, useNavigationBarHeight } from './ui';
import { log } from '../log';
import { AdjustPanel } from './editor/AdjustPanel';
import { ColorMatrix, isIdentity, toMedia3 } from './editor/colorMatrix';
import { FilteredView } from './editor/FilteredView';
import { Adjustments, FilterId, matrixOf, neighborOf, NO_ADJUSTMENTS, presetOf, stepsOf } from './editor/filters';

const CAPTION_FONT = 20;
const CAPTION_LINE_HEIGHT = 28;
const CAPTION_PADDING = 10;
const CAPTION_MAX_LENGTH = 160;
// Une lettre fait en moyenne un peu plus de la moitié de la taille de la police.
const CAPTION_LETTER_WIDTH = CAPTION_FONT * 0.54;
const STAMP_SHADOW_OPACITY = 0.45;
const TAP_DISTANCE = 10;
// Un glissé horizontal devient un changement de filtre au-delà de cette distance.
const SWIPE_START = 12;
// Lâché après ce tiers de l'écran, ou lancé assez vite, le filtre voisin s'installe.
const SWIPE_COMMIT = 0.3;
const SWIPE_FLING = 0.5;
// Vidéo (une seule vue vidéo, pas d'aperçu pendant le glissé) : distance pour passer au filtre voisin.
const VIDEO_SWIPE_DISTANCE = 50;
const SWIPE_MS = 220;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const TOOLS_MS = 180;
const TOOL_SIZE = 44;

export type MediaEditorHandle = {
  // Grave les retouches dans un nouveau fichier. Sans retouche, renvoie le fichier d'origine.
  flatten: () => Promise<string>;
};

function wrapCaption(text: string, maxLetters: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= maxLetters) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function formatStamp(timestamp: number) {
  const date = new Date(timestamp);
  return {
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    date: date.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

function ShadowedText({ x, y, size, weight, children }: { x: number; y: number; size: number; weight: '400' | '600'; children: string }) {
  const colors = useMediaColors();
  const shared = { fontSize: size, fontWeight: weight, textAnchor: 'middle' as const };
  return (
    <>
      <SvgText {...shared} x={x + 1} y={y + 2} fill={colors.text} opacity={STAMP_SHADOW_OPACITY}>{children}</SvgText>
      <SvgText {...shared} x={x} y={y} fill={colors.background}>{children}</SvgText>
    </>
  );
}

type Stamp = ReturnType<typeof formatStamp>;

// L'heure (et la date) des filtres Heure et Date, dessinées pareil à l'écran et dans le fichier.
function StampMarks({ kind, stamp, width, height }: { kind: 'time' | 'date' | undefined; stamp: Stamp; width: number; height: number }) {
  if (!kind) return null;
  return (
    <>
      <ShadowedText x={width / 2} y={height * 0.42} size={72} weight="600">{stamp.time}</ShadowedText>
      {kind === 'date' && <ShadowedText x={width / 2} y={height * 0.42 + 36} size={20} weight="400">{stamp.date}</ShadowedText>}
    </>
  );
}

function CaptionMarks({ lines, top, width, bandHeight }: { lines: string[]; top: number; width: number; bandHeight: number }) {
  const colors = useMediaColors();
  if (lines.length === 0) return null;
  return (
    <G y={top}>
      <Rect width={width} height={bandHeight} fill={colors.overlay} />
      {lines.map((line, index) => (
        <SvgText key={index} x={width / 2} y={CAPTION_PADDING + CAPTION_LINE_HEIGHT * index + CAPTION_FONT} fontSize={CAPTION_FONT} fill={colors.background} textAnchor="middle">
          {line}
        </SvgText>
      ))}
    </G>
  );
}

function EditorVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (created) => {
    created.loop = true;
    created.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />;
}

type Props = {
  uri: string;
  kind: 'image' | 'video';
  takenAt: number;
  // Le filtre choisi dans l'appareil photo avant la prise.
  initialFilter?: FilterId;
  // Un outil occupe le bas de l'écran (réglages) : l'écran parent range ses boutons.
  onToolChange?: (open: boolean) => void;
  ref: Ref<MediaEditorHandle>;
};

// À l'écran, tout passe par les filtres de vue (carte graphique) : le glissé reste fluide. Le fichier
// final sort d'un SVG caché dessous, qui reçoit la matrice exacte au moment d'enregistrer : photo
// filtrée avec ses marques, ou, pour une vidéo, le calque transparent que Media3 incruste pendant
// qu'il applique la même matrice à toute la vidéo.
export function MediaEditor({ uri, kind, takenAt, initialFilter = 'none', onToolChange, ref }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top: topInset } = useInsets();
  const navigationBar = useNavigationBarHeight();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  const [adjustments, setAdjustments] = useState<Adjustments>(NO_ADJUSTMENTS);
  const [adjusting, setAdjusting] = useState(false);
  const [caption, setCaption] = useState('');
  const [captionRatio, setCaptionRatio] = useState(0.6);
  const [draft, setDraft] = useState<string | null>(null);
  // Pendant un glissé sur une photo : le filtre voisin (1 : suivant, par la droite ; -1 : précédent).
  const [swipeDirection, setSwipeDirection] = useState<0 | 1 | -1>(0);
  const reveal = useRef(new Animated.Value(0)).current;
  const canvas = useRef<ComponentRef<typeof Svg>>(null);
  const screen = Dimensions.get('screen');

  useEffect(() => {
    const measured = kind === 'video' ? getThumbnailAsync(uri, { time: 0 }) : Image.getSize(uri);
    measured.then(({ width: measuredWidth, height: measuredHeight }) => setSize({ width: measuredWidth, height: measuredHeight })).catch((e) => log.warn('média', e));
  }, [uri, kind]);

  useEffect(() => {
    onToolChange?.(adjusting);
  }, [adjusting, onToolChange]);

  // Les boutons d'outils s'effacent quand un outil est ouvert.
  const tools = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(tools, { toValue: adjusting ? 0 : 1, duration: TOOLS_MS, easing: EASING, useNativeDriver: true }).start();
  }, [adjusting, tools]);

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

  const fit = size ? Math.min(screen.width / size.width, screen.height / size.height) : 1;
  const width = size ? size.width * fit : screen.width;
  const height = size ? size.height * fit : screen.height;

  const lines = caption ? wrapCaption(caption, Math.floor((width - spacing.lg) / CAPTION_LETTER_WIDTH)) : [];
  const bandHeight = lines.length * CAPTION_LINE_HEIGHT + CAPTION_PADDING * 2;
  const bandTop = Math.max(0, Math.min(height - bandHeight, captionRatio * height));
  const stamp = formatStamp(takenAt);

  const steps = stepsOf(filter, adjustments);
  const neighbor = swipeDirection !== 0 ? neighborOf(filter, swipeDirection) : null;

  // L'export : le SVG caché ne reçoit sa matrice qu'à ce moment-là (sinon il se redessinerait à chaque
  // geste), puis il est lu deux images plus tard, une fois dessiné.
  const [exportMatrix, setExportMatrix] = useState<ColorMatrix | null>(null);
  const [exportToken, setExportToken] = useState(0);
  const exportDone = useRef<((base64: string) => void) | null>(null);
  useEffect(() => {
    if (!exportToken) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!canvas.current) return;
        canvas.current.toDataURL((base64: string) => exportDone.current?.(base64));
      }),
    );
  }, [exportToken]);

  const snapshot = (matrix: ColorMatrix | null) =>
    new Promise<string>((resolve, reject) => {
      if (!canvas.current) {
        reject(new Error("L'image n'est pas prête."));
        return;
      }
      exportDone.current = (base64) => {
        exportDone.current = null;
        const edited = new File(Paths.cache, `edited-${Date.now()}.png`);
        Promise.resolve(edited.write(base64, { encoding: 'base64' }))
          .then(() => resolve(edited.uri))
          .catch(reject);
      };
      setExportMatrix(matrix);
      setExportToken(Date.now());
    });

  useImperativeHandle(ref, () => ({
    flatten: async () => {
      const matrix = matrixOf(steps);
      const colored = !isIdentity(matrix);
      const stamped = !!presetOf(filter).stamp;
      if (!colored && !stamped && !caption) return uri;
      if (kind === 'image') return snapshot(colored ? matrix : null);
      // Vidéo : le calque seulement s'il y a quelque chose à poser dessus.
      const overlayUri = stamped || caption ? await snapshot(null) : undefined;
      return editVideo(uri, { overlayUri, matrix: colored ? toMedia3(matrix) : undefined, bitrate: VIDEO_BITRATE });
    },
  }));

  // Passe au filtre voisin, en glissant jusqu'au bout ou en revenant.
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

  const gesture = useRef({ startRatio: 0, draggingCaption: false, swiping: false, direction: 0 as 0 | 1 | -1, ignored: false });
  const latest = {
    down: (locationY: number) => {
      // Pendant que le filtre se pose, le doigt attend la fin.
      gesture.current.ignored = settling.current;
      gesture.current.draggingCaption = !!caption && locationY >= bandTop && locationY <= bandTop + bandHeight;
      gesture.current.startRatio = bandTop / height;
      gesture.current.swiping = false;
      gesture.current.direction = 0;
    },
    move: (dx: number, dy: number) => {
      const state = gesture.current;
      if (state.ignored) return;
      if (state.draggingCaption) {
        setCaptionRatio(state.startRatio + dy / height);
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
    up: (dx: number, dy: number, vx: number) => {
      const state = gesture.current;
      if (state.ignored) return;
      if (Math.abs(dx) < TAP_DISTANCE && Math.abs(dy) < TAP_DISTANCE && !state.swiping) {
        setDraft(caption);
        return;
      }
      if (!state.swiping) return;
      const direction = dx < 0 ? 1 : -1;
      if (kind !== 'image') {
        if (Math.abs(dx) > VIDEO_SWIPE_DISTANCE) setFilter((current) => neighborOf(current, direction));
        return;
      }
      const thrown = Math.abs(vx) > SWIPE_FLING && Math.sign(vx) === Math.sign(dx);
      settleSwipe(direction, Math.abs(dx) / width > SWIPE_COMMIT || thrown);
    },
    cancel: () => {
      const state = gesture.current;
      if (!state.ignored && state.swiping && state.direction !== 0) settleSwipe(state.direction, false);
    },
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => latestRef.current.down(event.nativeEvent.locationY),
      onPanResponderMove: (_event, { dx, dy }) => latestRef.current.move(dx, dy),
      onPanResponderRelease: (_event, { dx, dy, vx }) => latestRef.current.up(dx, dy, vx),
      onPanResponderTerminate: () => latestRef.current.cancel(),
    }),
  ).current;

  const commitDraft = () => {
    if (draft !== null) setCaption(draft.trim());
    setDraft(null);
  };

  // Une couche visible : la photo filtrée par la carte graphique, et l'heure ou la date du filtre.
  const layer = (id: FilterId) => (
    <>
      <FilteredView steps={stepsOf(id, adjustments)} style={StyleSheet.absoluteFill}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      </FilteredView>
      {presetOf(id).stamp && (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
          <StampMarks kind={presetOf(id).stamp} stamp={stamp} width={width} height={height} />
        </Svg>
      )}
    </>
  );

  // La couche voisine arrive par un bord : le cadre glisse, l'image dedans reste immobile. Tout est
  // animé par le moteur natif, sans repasser par React à chaque image.
  const side = swipeDirection === 1 ? 1 : -1;
  const frameX = reveal.interpolate({ inputRange: [0, 1], outputRange: [side * width, 0] });
  const contentX = reveal.interpolate({ inputRange: [0, 1], outputRange: [-side * width, 0] });

  return (
    <>
      <View style={[styles.canvas, { width, height, left: (screen.width - width) / 2, top: (screen.height - height) / 2 }]}>
        {/* Le fichier final, caché sous l'aperçu ; il ne se redessine que si la légende change. */}
        {size && (
          <Svg ref={canvas} pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
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
            <StampMarks kind={presetOf(filter).stamp} stamp={stamp} width={width} height={height} />
            <CaptionMarks lines={lines} top={bandTop} width={width} bandHeight={bandHeight} />
          </Svg>
        )}

        {size && kind === 'image' && layer(filter)}
        {size && kind === 'video' && (
          <>
            <FilteredView steps={steps} style={StyleSheet.absoluteFill}>
              <EditorVideo uri={uri} />
            </FilteredView>
            {presetOf(filter).stamp && (
              <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
                <StampMarks kind={presetOf(filter).stamp} stamp={stamp} width={width} height={height} />
              </Svg>
            )}
          </>
        )}
        {size && neighbor && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { transform: [{ translateX: frameX }] }]}>
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: contentX }] }]}>{layer(neighbor)}</Animated.View>
          </Animated.View>
        )}
        {lines.length > 0 && (
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
            <CaptionMarks lines={lines} top={bandTop} width={width} bandHeight={bandHeight} />
          </Svg>
        )}

        <View
          collapsable={false}
          style={StyleSheet.absoluteFill}
          accessibilityLabel={t('editeur.aide')}
          accessibilityHint={t(presetOf(filter).label)}
          accessibilityActions={[{ name: 'increment', label: t('editeur.filtreSuivant') }, { name: 'decrement', label: t('editeur.filtrePrecedent') }]}
          onAccessibilityAction={({ nativeEvent }) => setFilter((current) => neighborOf(current, nativeEvent.actionName === 'increment' ? 1 : -1))}
          {...pan.panHandlers}
        />
      </View>

      <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toast, transform: [{ scale: toast.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
        <Text style={styles.toastLabel}>{t(presetOf(filter).label)}</Text>
      </Animated.View>

      <Animated.View pointerEvents={adjusting ? 'none' : 'box-none'} style={[styles.tools, { top: topInset + spacing.md + TOOL_SIZE + spacing.md, opacity: tools }]}>
        <IconButton onPress={() => setDraft(caption)} label={t('editeur.ajouterTexte')} style={styles.round}>
          <Type size={22} color={colors.background} strokeWidth={1.75} />
        </IconButton>
        <IconButton onPress={() => setAdjusting(true)} label={t('editeur.reglages')} style={styles.round}>
          <SlidersHorizontal size={22} color={colors.background} strokeWidth={1.75} />
        </IconButton>
      </Animated.View>

      {adjusting && <AdjustPanel value={adjustments} bottom={navigationBar} onChange={setAdjustments} onClose={() => setAdjusting(false)} />}

      {draft !== null && (
        <View style={styles.writing}>
          <TextInput
            autoFocus
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={commitDraft}
            submitBehavior="blurAndSubmit"
            maxLength={CAPTION_MAX_LENGTH}
            placeholder={t('editeur.ecrire')}
            placeholderTextColor={colors.onDarkMuted}
            multiline
            textAlign="center"
          />
          <IconButton onPress={commitDraft} label={t('editeur.valider')} style={styles.round}>
            <Check size={24} color={colors.background} strokeWidth={2} />
          </IconButton>
        </View>
      )}
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
  tools: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.md,
  },
  round: {
    width: TOOL_SIZE,
    height: TOOL_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
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
  writing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingTop: '30%',
    gap: spacing.md,
    backgroundColor: colors.overlay,
  },
  input: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: CAPTION_FONT,
    color: colors.background,
    backgroundColor: colors.overlay,
  },
}));
