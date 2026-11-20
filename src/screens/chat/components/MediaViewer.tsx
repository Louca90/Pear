import { useEffect, useRef, useState } from 'react';
import { Dimensions, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming, type EntryExitAnimationFunction, interpolate } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureDetector, GestureHandlerRootView, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoPlayer, VideoView } from 'expo-video';
import { Volume2, VolumeX, X } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { openMedia } from '../../../chat/media';
import { log } from '../../../log';
import { IconButton, useNavigationBarHeight } from '../../../components/ui';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../../theme';

import { SeekBar } from './SeekBar';
import { formatClock } from '../format';
import { PauseIcon, PlayIcon } from '../../../components/PlayIcon';
import { haptics } from '../../../haptics';
import { enterUp, timing } from '../../../motion';
import { VIEWER_CANCEL_MS, VIEWER_CLOSE_DISTANCE, VIEWER_CLOSE_MS, VIEWER_CLOSE_SPEED, VIEWER_DRAG_START, VIEWER_EASING, VIEWER_MIN_SCALE, VIEWER_OPEN_MS } from '../constants';
import { useChatStyles } from '../styles';
import { Rect } from '../types';
import { t } from '../../../i18n';

// Plein écran. Toucher la vidéo affiche ou masque les commandes (elles se masquent seules après 2,5 s de
// lecture) ; double-toucher à gauche ou à droite recule ou avance de 10 s, avec une onde à l'endroit
// touché. Au centre, lecture/pause en fondu croisé ; en bas, la barre (qui avance en continu), le temps,
// la vitesse et le son. Tout bouge sur le fil natif.
const SEEK_STEP = 10;
const RATES = [1, 1.5, 2, 0.5];
const DOUBLE_TAP_MS = 280;
const AUTO_HIDE_MS = 2500;

function rippleIn(): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0.45, transform: [{ scale: 0.4 }] },
      animations: { opacity: withTiming(0, { duration: 520 }), transform: [{ scale: withTiming(1.6, { duration: 520 }) }] },
    };
  };
}

function SeekRipple({ side }: { side: 'back' | 'forward' }) {
  const styles = useStyles();
  return (
    <View pointerEvents="none" style={[styles.rippleZone, side === 'back' ? styles.rippleBack : styles.rippleForward]}>
      <Reanimated.View entering={rippleIn()} style={styles.ripple} />
      <Reanimated.Text entering={enterUp(6, 180)} exiting={FadeOut.duration(220)} style={styles.rippleLabel}>
        {side === 'back' ? `« ${SEEK_STEP} s` : `${SEEK_STEP} s »`}
      </Reanimated.Text>
    </View>
  );
}

function VideoControls({ player }: { player: VideoPlayer }) {
  const styles = useStyles();
  const colors = useMediaColors();
  const bottom = useNavigationBarHeight();
  // L'état vient toujours du lecteur : relu à l'apparition (la lecture a pu démarrer juste avant qu'on
  // écoute) puis à chaque événement, pour que le bouton ne reste jamais sur « pause » pendant la lecture.
  const [isPlaying, setIsPlaying] = useState(player.playing);
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: player.currentTime, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  useEventListener(player, 'playingChange', ({ isPlaying: playing }) => setIsPlaying(playing));
  useEventListener(player, 'timeUpdate', () => setIsPlaying(player.playing));
  useEventListener(player, 'statusChange', () => setIsPlaying(player.playing));
  useEffect(() => setIsPlaying(player.playing), [player]);
  const [rate, setRate] = useState(player.playbackRate || 1);
  const [muted, setMuted] = useState(player.muted);
  const [chromeOn, setChromeOn] = useState(true);
  const [ripple, setRipple] = useState<{ side: 'back' | 'forward'; n: number } | null>(null);
  const lastTap = useRef<{ at: number; side: 'back' | 'center' | 'forward' } | null>(null);
  const duration = player.duration;
  const position = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEventListener(player, 'playToEnd', () => {
    player.pause();
    player.currentTime = 0;
    setChromeOn(true);
  });

  // Les commandes et l'icône centrale, sur le fil natif.
  const chrome = useSharedValue(1);
  const playing = useSharedValue(isPlaying ? 1 : 0);
  useEffect(() => chrome.set(timing(chromeOn ? 1 : 0, 220)), [chromeOn]);
  useEffect(() => playing.set(timing(isPlaying ? 1 : 0, 220)), [isPlaying]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.get() }));
  const playStyle = useAnimatedStyle(() => ({ opacity: 1 - playing.get(), transform: [{ scale: 1 - 0.4 * playing.get() }, { rotate: `${-90 * playing.get()}deg` }] }));
  const pauseStyle = useAnimatedStyle(() => ({ opacity: playing.get(), transform: [{ scale: 0.6 + 0.4 * playing.get() }, { rotate: `${90 * (1 - playing.get())}deg` }] }));

  // Pendant la lecture, les commandes se masquent seules.
  useEffect(() => {
    if (!chromeOn || !isPlaying) return;
    const timer = setTimeout(() => setChromeOn(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [chromeOn, isPlaying]);

  const toggle = () => (isPlaying ? player.pause() : player.play());

  const seekBy = (seconds: number) => {
    if (!(duration > 0)) return;
    player.currentTime = Math.max(0, Math.min(duration, player.currentTime + seconds));
  };

  // Un toucher affiche ou masque ; un second toucher rapide du même côté recule ou avance.
  const tapZone = (side: 'back' | 'center' | 'forward') => {
    const now = Date.now();
    const previous = lastTap.current;
    if (side !== 'center' && previous && previous.side === side && now - previous.at < DOUBLE_TAP_MS) {
      lastTap.current = null;
      setChromeOn((on) => !on);
      seekBy(side === 'back' ? -SEEK_STEP : SEEK_STEP);
      haptics.select();
      setRipple((r) => ({ side, n: (r?.n ?? 0) + 1 }));
      return;
    }
    lastTap.current = { at: now, side };
    setChromeOn((on) => !on);
  };

  useEffect(() => {
    if (!ripple) return;
    const timer = setTimeout(() => setRipple(null), 620);
    return () => clearTimeout(timer);
  }, [ripple]);

  const changeRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    player.playbackRate = next;
    setRate(next);
    haptics.select();
  };
  const toggleMute = () => {
    player.muted = !muted;
    setMuted(!muted);
  };
  const rateText = `${String(rate).replace('.', ',')}×`;

  return (
    <>
      <View style={styles.tapRow}>
        <Pressable style={styles.flex} onPress={() => tapZone('back')} accessibilityLabel={t('chat.reculer10')} />
        <Pressable style={styles.flex} onPress={() => tapZone('center')} accessibilityLabel={isPlaying ? t('chat.pause') : t('chat.lire')} />
        <Pressable style={styles.flex} onPress={() => tapZone('forward')} accessibilityLabel={t('chat.avancer10')} />
      </View>
      {ripple && <SeekRipple key={ripple.n} side={ripple.side} />}
      <Reanimated.View pointerEvents={chromeOn ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, chromeStyle]}>
        <View pointerEvents="box-none" style={styles.centerSlot}>
          <IconButton onPress={toggle} label={isPlaying ? t('chat.pause') : t('chat.lire')} style={styles.bigPlay}>
            <View style={styles.bigPlayIcon}>
              <Reanimated.View style={[StyleSheet.absoluteFill, styles.iconCenter, playStyle]}>
                <PlayIcon size={30} color={colors.background} />
              </Reanimated.View>
              <Reanimated.View style={[StyleSheet.absoluteFill, styles.iconCenter, pauseStyle]}>
                <PauseIcon size={30} color={colors.background} />
              </Reanimated.View>
            </View>
          </IconButton>
        </View>
        <View style={[styles.videoControls, { bottom: bottom + spacing.md }]}>
          <SeekBar
            position={position}
            speed={isPlaying && duration > 0 ? rate / duration : 0}
            color={colors.background}
            trackColor={colors.onDarkTrack}
            label={t('chat.deplacerVideo')}
            onSeek={(ratio) => {
              if (duration > 0) player.currentTime = ratio * duration;
            }}
          />
          <View style={styles.videoFooter}>
            <Text style={styles.videoTime}>
              {formatClock(currentTime)} / {formatClock(duration > 0 ? duration : 0)}
            </Text>
            <Pressable onPress={changeRate} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('chat.vitesseVideo', { vitesse: rateText })} style={styles.videoChip}>
              <Text style={styles.videoChipText}>{rateText}</Text>
            </Pressable>
            <IconButton onPress={toggleMute} label={muted ? t('chat.activerSon') : t('chat.couperSon')} style={styles.videoRound}>
              {muted ? <VolumeX size={18} color={colors.background} strokeWidth={1.9} /> : <Volume2 size={18} color={colors.background} strokeWidth={1.9} />}
            </IconButton>
          </View>
        </View>
      </Reanimated.View>
    </>
  );
}
// Zoom : pincer de 1× à 5×, double appui (photo) pour 2,5× puis retour, déplacement limité aux bords.
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const ZOOM_MS = 240;
// Élan au relâché : la distance parcourue pendant ce temps à la vitesse du doigt.
const INERTIA_MS = 220;

type Point = { x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// round : la photo part d'un rond (avatar) : ses coins passent de ronds à droits en s'ouvrant.
// title / subtitle / hint : la photo de profil en grand (planche « Profil · photo en grand ») : bouton fermer,
// nom et « Photo de profil » en haut, le geste rappelé en bas.
export type Viewing = { message: Message; rect: Rect; poster: string; size: { width: number; height: number }; round?: boolean; title?: string; subtitle?: string; hint?: string };

// Le cadre passe en douceur du carré de la conversation au format réel du média : l'image, recadrée
// en continu, ne saute jamais. Une vidéo n'est lue qu'une fois le cadre en place, et se met en pause
// dès la fermeture. Glissé vers le bas, le média suit le doigt ; lâché trop tôt, il revient en plein écran.
// Tout passe par Reanimated : le cadre change de taille sur le fil de l'interface, sans repasser par JS.
export function MediaViewer({ viewing: { message, rect, poster, size, round, title, subtitle, hint }, onClose }: { viewing: Viewing; onClose: () => void }) {
  const styles = useStyles();
  const colors = useMediaColors();
  const isVideo = message.kind === 'video';
  const progress = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const closingRef = useRef(false);
  const [opened, setOpened] = useState(false);
  const [closing, setClosing] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const { width, height } = Dimensions.get('screen');
  const player = useVideoPlayer(null, (created) => {
    created.timeUpdateEventInterval = 0.25;
  });

  // La vidéo est chiffrée sur le disque (lot 2.3) : le lecteur reçoit sa copie déchiffrée dès qu'elle est
  // prête (la miniature reste affichée en attendant, la lecture automatique attend readyToPlay).
  useEffect(() => {
    if (!isVideo || !message.file_uri) return;
    let cancelled = false;
    openMedia(message.file_uri, { mime: message.file_mime })
      .then((uri) => {
        if (!cancelled) player.replace(uri);
      })
      .catch((e) => log.warn('ouverture de la vidéo', e));
    return () => {
      cancelled = true;
    };
  }, [isVideo, message.file_uri, message.file_mime, player]);

  // Lecture automatique à l'ouverture : si la vidéo n'était pas encore prête quand on a demandé la
  // lecture, elle démarre dès qu'elle l'est (une seule fois : une pause de l'utilisateur est respectée).
  const autoplay = useRef(false);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (autoplay.current && status === 'readyToPlay' && !player.playing && !closingRef.current) player.play();
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (isPlaying) autoplay.current = false;
  });

  // Zoom et déplacement : la position voulue est gardée en JS (gestes), l'affichage suit par Reanimated.
  const zoom = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const zoomNow = useRef(1);
  const panNow = useRef<Point>({ x: 0, y: 0 });
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const pinchStart = useRef(1);
  const fitted = useRef({ width: 0, height: 0 });

  // Jusqu'où on peut déplacer le média zoomé sans voir au-delà de ses bords.
  const clampPan = (point: Point, level = zoomNow.current): Point => {
    const maxX = Math.max(0, (fitted.current.width * level - width) / 2);
    const maxY = Math.max(0, (fitted.current.height * level - height) / 2);
    return { x: clamp(point.x, -maxX, maxX), y: clamp(point.y, -maxY, maxY) };
  };
  const setPan = (point: Point) => {
    panNow.current = point;
    panX.set(point.x);
    panY.set(point.y);
  };
  const setZoom = (level: number) => {
    zoomNow.current = level;
    zoom.set(level);
    setPan(clampPan(panNow.current, level));
  };
  const animateZoom = (level: number, target: Point) => {
    const next = clampPan(target, level);
    zoomNow.current = level;
    panNow.current = next;
    const config = { duration: ZOOM_MS, easing: VIEWER_EASING };
    zoom.set(withTiming(level, config));
    panX.set(withTiming(next.x, config));
    panY.set(withTiming(next.y, config));
  };
  const zoomed = () => zoomNow.current > 1.01;

  const close = () => {
    if (closingRef.current) return;
    autoplay.current = false;
    if (zoomed()) animateZoom(1, { x: 0, y: 0 });
    closingRef.current = true;
    if (isVideo) player.pause();
    setClosing(true);
    const config = { duration: VIEWER_CLOSE_MS, easing: VIEWER_EASING };
    dragX.set(withTiming(0, config));
    dragY.set(withTiming(0, config));
    progress.set(
      withTiming(0, config, (finished) => {
        if (finished) scheduleOnRN(onClose);
      }),
    );
  };
  const latestClose = useRef(close);
  latestClose.current = close;

  // L'ouverture démarre une fois la fenêtre affichée : lancée pendant sa création, ses premières images sautaient.
  const startOpening = () => {
    const opened = () => {
      if (closingRef.current) return;
      setOpened(true);
      if (isVideo) {
        autoplay.current = true;
        player.play();
      }
    };
    progress.set(
      withTiming(1, { duration: VIEWER_OPEN_MS, easing: VIEWER_EASING }, (finished) => {
        if (finished) scheduleOnRN(opened);
      }),
    );
  };

  // Lâché trop tôt, le média revient en plein écran, sans rebond.
  const settleDrag = () => {
    const config = { duration: VIEWER_CANCEL_MS, easing: VIEWER_EASING };
    dragX.set(withTiming(0, config));
    dragY.set(withTiming(0, config));
  };

  // Les gestes (react-native-gesture-handler, qui voit vraiment les deux doigts sur Android), en même
  // temps : deux doigts pincent pour zoomer et dézoomer, un doigt déplace le média zoomé (sinon un
  // glissé vers le bas ferme), un double appui zoome à l'endroit touché ou revient à la taille normale.
  const pinchGesture = usePinchGesture({
    runOnJS: true,
    disableReanimated: true,
    onBegin: () => {
      pinchStart.current = zoomNow.current;
    },
    onUpdate: (event) => setZoom(clamp(pinchStart.current * event.scale, MIN_ZOOM, MAX_ZOOM)),
    onDeactivate: () => {
      if (zoomNow.current < 1.05) animateZoom(1, { x: 0, y: 0 });
      else animateZoom(zoomNow.current, panNow.current);
    },
  });

  const panGesture = usePanGesture({
    runOnJS: true,
    disableReanimated: true,
    maxPointers: 2,
    onBegin: () => {
      panStart.current = { ...panNow.current };
    },
    onUpdate: (event) => {
      if (zoomed()) {
        setPan(clampPan({ x: panStart.current.x + event.translationX, y: panStart.current.y + event.translationY }));
        return;
      }
      // Pas zoomé : seul un glissé vers le bas compte (fermeture).
      if (event.translationY > VIEWER_DRAG_START) {
        dragX.set(event.translationX);
        dragY.set(Math.max(0, event.translationY));
      }
    },
    onDeactivate: (event) => {
      if (zoomed()) {
        animateZoom(zoomNow.current, { x: panNow.current.x + event.velocityX * (INERTIA_MS / 1000), y: panNow.current.y + event.velocityY * (INERTIA_MS / 1000) });
        return;
      }
      if (event.translationY > VIEWER_CLOSE_DISTANCE || event.velocityY > VIEWER_CLOSE_SPEED * 1000) latestClose.current();
      else settleDrag();
    },
  });

  // Sur une vidéo, le double appui sert à reculer ou avancer (commandes vidéo) : pas de zoom.
  const doubleTapGesture = useTapGesture({
    runOnJS: true,
    disableReanimated: true,
    enabled: !isVideo,
    numberOfTaps: 2,
    onActivate: (event) => {
      if (zoomed()) animateZoom(1, { x: 0, y: 0 });
      else animateZoom(DOUBLE_TAP_ZOOM, { x: (width / 2 - event.absoluteX) * (DOUBLE_TAP_ZOOM - 1), y: (height / 2 - event.absoluteY) * (DOUBLE_TAP_ZOOM - 1) });
    },
  });

  const gestures = useSimultaneousGestures(pinchGesture, panGesture, doubleTapGesture);

  // La place finale : le média entier, à son format, centré dans l'écran.
  const fit = Math.min(width / size.width, height / size.height);
  const finalWidth = size.width * fit;
  const finalHeight = size.height * fit;
  fitted.current = { width: finalWidth, height: finalHeight };
  const half = height / 2;
  const dimming = useAnimatedStyle(() => ({ opacity: progress.get() * interpolate(dragY.get(), [0, half], [1, 0.15], 'clamp') }));
  const chrome = useAnimatedStyle(() => ({ opacity: interpolate(dragY.get(), [0, VIEWER_CLOSE_DISTANCE], [1, 0], 'clamp') }));
  const dragged = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.get() }, { translateY: dragY.get() }, { scale: interpolate(dragY.get(), [0, half], [1, VIEWER_MIN_SCALE], 'clamp') }],
  }));
  const panned = useAnimatedStyle(() => ({ transform: [{ translateX: panX.get() }, { translateY: panY.get() }] }));
  const zoomed_ = useAnimatedStyle(() => ({ transform: [{ scale: zoom.get() }] }));
  const from = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
  const to = { left: (width - finalWidth) / 2, top: (height - finalHeight) / 2, width: finalWidth, height: finalHeight };
  const corner = round ? rect.width / 2 : radius.md;
  const frame = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      left: from.left + (to.left - from.left) * p,
      top: from.top + (to.top - from.top) * p,
      width: from.width + (to.width - from.width) * p,
      height: from.height + (to.height - from.height) * p,
      borderRadius: corner * (1 - p),
    };
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} onShow={startOpening} statusBarTranslucent navigationBarTranslucent>
      {/* Sur Android, les gestes d'une fenêtre Modal ne marchent que si son contenu a sa propre racine. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.viewerBackground, dimming]} />
      {/* collapsable : sans contrôles vidéo, cette vue doit exister pour recevoir le doigt sur une photo. */}
      <GestureDetector gesture={gestures}>
      <View collapsable={false} style={StyleSheet.absoluteFill}>
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dragged]}>
          <Reanimated.View style={[StyleSheet.absoluteFill, panned]}>
          <Reanimated.View style={[StyleSheet.absoluteFill, zoomed_]}>
          <Reanimated.View style={[styles.viewerFrame, frame]}>
            <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            {isVideo && opened && (
              <VideoView
                player={player}
                style={[StyleSheet.absoluteFill, !frameReady && styles.hidden]}
                contentFit="cover"
                nativeControls={false}
                surfaceType="textureView"
                onFirstFrameRender={() => setFrameReady(true)}
              />
            )}
          </Reanimated.View>
          </Reanimated.View>
          </Reanimated.View>
        </Reanimated.View>
        {isVideo && opened && !closing && (
          <Reanimated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chrome]}>
            <VideoControls player={player} />
          </Reanimated.View>
        )}
      </View>
      </GestureDetector>
      {title ? (
        <Reanimated.View style={[styles.viewerTop, chrome, dimming]}>
          <IconButton onPress={close} label={t('commun.fermer')} style={styles.viewerTopClose}>
            <X size={20} color={colors.background} strokeWidth={2} />
          </IconButton>
          <View style={styles.viewerTopText}>
            <Text style={styles.viewerTitle} numberOfLines={1}>{title}</Text>
            {!!subtitle && <Text style={styles.viewerSubtitle}>{subtitle}</Text>}
          </View>
        </Reanimated.View>
      ) : (
        <Reanimated.View style={[styles.viewerClose, dimming]}>
          <IconButton onPress={close} label={t('commun.fermer')}>
            <X size={28} color={colors.background} strokeWidth={1.75} />
          </IconButton>
        </Reanimated.View>
      )}
      {!!hint && opened && !closing && (
        <Reanimated.View pointerEvents="none" entering={FadeIn.delay(120).duration(240)} style={[styles.viewerHint, chrome]}>
          <Text style={styles.viewerHintText}>{hint}</Text>
        </Reanimated.View>
      )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const useLocalStyles = createMediaStyles((colors) => ({
  tapRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  centerSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigPlay: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.onDarkTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigPlayIcon: {
    width: 30,
    height: 30,
  },
  iconCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '34%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleBack: {
    left: 0,
  },
  rippleForward: {
    right: 0,
  },
  ripple: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: radius.full,
    backgroundColor: colors.background,
  },
  rippleLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.background,
  },
  videoControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    gap: spacing.sm / 2,
    paddingHorizontal: spacing.lg,
  },
  videoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  videoTime: {
    flex: 1,
    fontSize: 13,
    color: colors.background,
    fontVariant: ['tabular-nums'],
  },
  videoChip: {
    height: 30,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.onDarkTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.background,
  },
  videoRound: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.onDarkTrack,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerBackground: {
    backgroundColor: colors.text,
  },
  viewerFrame: {
    position: 'absolute',
    overflow: 'hidden',
  },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: spacing.lg,
  },
  viewerTop: {
    position: 'absolute',
    top: 48,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewerTopClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerTopText: {
    flex: 1,
    gap: 2,
  },
  viewerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.background,
  },
  viewerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  viewerHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 40,
    alignItems: 'center',
  },
  viewerHintText: {
    fontSize: 13,
    color: colors.textMuted,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
