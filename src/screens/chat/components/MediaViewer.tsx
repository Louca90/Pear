import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Image, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoPlayer, VideoView } from 'expo-video';
import { Pause, Play, X } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { IconButton, useNavigationBarHeight } from '../../../components/ui';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../../theme';

import { SeekBar } from './SeekBar';
import { VIEWER_CANCEL_MS, VIEWER_CLOSE_DISTANCE, VIEWER_CLOSE_MS, VIEWER_CLOSE_SPEED, VIEWER_DRAG_START, VIEWER_EASING, VIEWER_MIN_SCALE, VIEWER_OPEN_MS } from '../constants';
import { useChatStyles } from '../styles';
import { Rect } from '../types';
import { t } from '../../../i18n';
import { log } from '../../../log';

// Plein écran : juste lecture ou pause et une barre pour se déplacer.
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
  const duration = player.duration;
  const position = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const toggle = () => (isPlaying ? player.pause() : player.play());

  useEventListener(player, 'playToEnd', () => {
    player.pause();
    player.currentTime = 0;
  });

  return (
    <>
      <Pressable onPress={toggle} accessibilityLabel={isPlaying ? t('chat.pause') : t('chat.lire')} style={styles.videoTap}>
        {!isPlaying && (
          <View style={styles.playButton}>
            <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          </View>
        )}
      </Pressable>
      <View style={[styles.videoControls, { bottom: bottom + spacing.md }]}>
        <IconButton onPress={toggle} label={isPlaying ? t('chat.pause') : t('chat.lire')}>
          {isPlaying ? (
            <Pause size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          ) : (
            <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          )}
        </IconButton>
        <View style={styles.flex}>
          <SeekBar
            position={position}
            color={colors.background}
            trackColor={colors.onDarkTrack}
            label={t('chat.deplacerVideo')}
            onSeek={(ratio) => {
              if (duration > 0) player.currentTime = ratio * duration;
            }}
          />
        </View>
      </View>
    </>
  );
}

// Zoom : pincer de 1× à 5×, double appui (photo) pour 2,5× puis retour, déplacement limité aux bords.
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 350;
const TAP_SLOP = 8;
const ZOOM_MS = 240;
// Élan au relâché : la distance parcourue pendant ce temps à la vitesse du doigt.
const INERTIA_MS = 220;

type Point = { x: number; y: number };
const distance = (a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type Viewing = { message: Message; rect: Rect; poster: string; size: { width: number; height: number } };

// Le cadre passe en douceur du carré de la conversation au format réel du média : l'image, recadrée
// en continu, ne saute jamais. Une vidéo n'est lue qu'une fois le cadre en place, et se met en pause
// dès la fermeture. Glissé vers le bas, le média suit le doigt ; lâché trop tôt, il revient en plein écran.
// Le cadre change de taille à chaque image : ces animations ne peuvent pas passer par le pilote natif.
export function MediaViewer({ viewing: { message, rect, poster, size }, onClose }: { viewing: Viewing; onClose: () => void }) {
  const styles = useStyles();
  const colors = useMediaColors();
  const isVideo = message.kind === 'video';
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.ValueXY()).current;
  const closingRef = useRef(false);
  const [opened, setOpened] = useState(false);
  const [closing, setClosing] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const { width, height } = Dimensions.get('screen');
  const player = useVideoPlayer(isVideo ? message.file_uri : null, (created) => {
    created.timeUpdateEventInterval = 0.25;
  });

  // Lecture automatique à l'ouverture : si la vidéo n'était pas encore prête quand on a demandé la
  // lecture, elle démarre dès qu'elle l'est (une seule fois : une pause de l'utilisateur est respectée).
  const autoplay = useRef(false);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (autoplay.current && status === 'readyToPlay' && !player.playing && !closingRef.current) player.play();
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (isPlaying) autoplay.current = false;
  });

  // Zoom et déplacement (pilotés en JS, comme le reste de la visionneuse).
  const zoom = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY()).current;
  const zoomNow = useRef(1);
  const panNow = useRef<Point>({ x: 0, y: 0 });
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const lastTap = useRef(0);
  const fitted = useRef({ width: 0, height: 0 });

  // Jusqu'où on peut déplacer le média zoomé sans voir au-delà de ses bords.
  const clampPan = (point: Point, level = zoomNow.current): Point => {
    const maxX = Math.max(0, (fitted.current.width * level - width) / 2);
    const maxY = Math.max(0, (fitted.current.height * level - height) / 2);
    return { x: clamp(point.x, -maxX, maxX), y: clamp(point.y, -maxY, maxY) };
  };
  const setPan = (point: Point) => {
    panNow.current = point;
    pan.setValue(point);
  };
  const setZoom = (level: number) => {
    zoomNow.current = level;
    zoom.setValue(level);
    setPan(clampPan(panNow.current, level));
  };
  const animateZoom = (level: number, target: Point) => {
    const next = clampPan(target, level);
    zoomNow.current = level;
    panNow.current = next;
    Animated.parallel([
      Animated.timing(zoom, { toValue: level, duration: ZOOM_MS, easing: VIEWER_EASING, useNativeDriver: false }),
      Animated.timing(pan, { toValue: next, duration: ZOOM_MS, easing: VIEWER_EASING, useNativeDriver: false }),
    ]).start();
  };
  const zoomed = () => zoomNow.current > 1.01;

  const close = () => {
    if (closingRef.current) return;
    autoplay.current = false;
    if (zoomed()) animateZoom(1, { x: 0, y: 0 });
    closingRef.current = true;
    if (isVideo) player.pause();
    setClosing(true);
    Animated.parallel([
      Animated.timing(progress, { toValue: 0, duration: VIEWER_CLOSE_MS, easing: VIEWER_EASING, useNativeDriver: false }),
      Animated.timing(drag, { toValue: { x: 0, y: 0 }, duration: VIEWER_CLOSE_MS, easing: VIEWER_EASING, useNativeDriver: false }),
    ]).start(onClose);
  };
  const latestClose = useRef(close);
  latestClose.current = close;

  // L'ouverture démarre une fois la fenêtre affichée : lancée pendant sa création, ses premières images sautaient.
  const startOpening = () => {
    Animated.timing(progress, { toValue: 1, duration: VIEWER_OPEN_MS, easing: VIEWER_EASING, useNativeDriver: false }).start(({ finished }) => {
      if (!finished || closingRef.current) return;
      setOpened(true);
      if (isVideo) {
        autoplay.current = true;
        player.play();
      }
    });
  };

  // Lâché trop tôt, le média revient en plein écran, sans rebond.
  const settleDrag = () =>
    Animated.timing(drag, { toValue: { x: 0, y: 0 }, duration: VIEWER_CANCEL_MS, easing: VIEWER_EASING, useNativeDriver: false }).start();

  // Les gestes : deux doigts pincent (zoom), un doigt déplace le média zoomé ; sinon un glissé vers le
  // bas ferme. Zoomé, la fermeture par glissé est désactivée. Le double appui zoome sur une photo
  // (sur une vidéo, l'appui sert à lecture/pause).
  const gestures = useRef({ clampPan, setPan, setZoom, animateZoom, zoomed, isVideo });
  gestures.current = { clampPan, setPan, setZoom, animateZoom, zoomed, isVideo };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (event, gesture) =>
        event.nativeEvent.touches.length >= 2 || (gestures.current.zoomed() && Math.hypot(gesture.dx, gesture.dy) > TAP_SLOP / 2),
      onMoveShouldSetPanResponder: (_event, gesture) => gestures.current.zoomed() || (gesture.dy > VIEWER_DRAG_START && gesture.dy > Math.abs(gesture.dx)),
      onPanResponderGrant: (event) => {
        pinch.current = null;
        panStart.current = { ...panNow.current };
        log.info('visionneuse', `appui ${event.nativeEvent.touches.length} zoom ${zoomNow.current}`);
      },
      // Un deuxième doigt posé : le pincement commence.
      onPanResponderStart: (event) => {
        log.info('visionneuse', `doigts ${event.nativeEvent.touches.length}`);
      },
      onPanResponderMove: (event, gesture) => {
        const { touches } = event.nativeEvent;
        const g = gestures.current;
        if (touches.length >= 2) {
          const spread = distance(touches[0], touches[1]);
          if (!pinch.current) pinch.current = { distance: spread, zoom: zoomNow.current };
          g.setZoom(clamp((pinch.current.zoom * spread) / pinch.current.distance, MIN_ZOOM, MAX_ZOOM));
          return;
        }
        // Un doigt levé après un pincement : on attend le relâché, sans sauter.
        if (pinch.current) return;
        if (g.zoomed()) {
          g.setPan(g.clampPan({ x: panStart.current.x + gesture.dx, y: panStart.current.y + gesture.dy }));
          return;
        }
        drag.setValue({ x: gesture.dx, y: Math.max(0, gesture.dy) });
      },
      onPanResponderRelease: (event, gesture) => {
        const g = gestures.current;
        log.info('visionneuse', `relâché dx ${Math.round(gesture.dx)} dy ${Math.round(gesture.dy)} pincement ${pinch.current !== null} écart ${Date.now() - lastTap.current}`);
        const wasPinch = pinch.current !== null;
        pinch.current = null;
        if (g.zoomed() || wasPinch) {
          if (zoomNow.current < 1.05) g.animateZoom(1, { x: 0, y: 0 });
          else g.animateZoom(zoomNow.current, { x: panNow.current.x + gesture.vx * INERTIA_MS, y: panNow.current.y + gesture.vy * INERTIA_MS });
          return;
        }
        if (Math.abs(gesture.dx) < TAP_SLOP && Math.abs(gesture.dy) < TAP_SLOP) {
          settleDrag();
          const now = Date.now();
          if (!g.isVideo && now - lastTap.current < DOUBLE_TAP_MS) {
            lastTap.current = 0;
            // Zoom vers l'endroit touché.
            const { pageX, pageY } = event.nativeEvent;
            g.animateZoom(DOUBLE_TAP_ZOOM, { x: (width / 2 - pageX) * (DOUBLE_TAP_ZOOM - 1), y: (height / 2 - pageY) * (DOUBLE_TAP_ZOOM - 1) });
          } else lastTap.current = now;
          return;
        }
        if (gesture.dy > VIEWER_CLOSE_DISTANCE || gesture.vy > VIEWER_CLOSE_SPEED) latestClose.current();
        else settleDrag();
      },
      onPanResponderTerminate: () => {
        pinch.current = null;
        settleDrag();
      },
    }),
  ).current;

  // La place finale : le média entier, à son format, centré dans l'écran.
  const fit = Math.min(width / size.width, height / size.height);
  const finalWidth = size.width * fit;
  const finalHeight = size.height * fit;
  fitted.current = { width: finalWidth, height: finalHeight };
  const between = (from: number, to: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

  const dragRange = { inputRange: [0, height / 2], extrapolate: 'clamp' as const };
  const dimming = Animated.multiply(progress, drag.y.interpolate({ ...dragRange, outputRange: [1, 0.15] }));
  const chrome = drag.y.interpolate({ inputRange: [0, VIEWER_CLOSE_DISTANCE], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} onShow={startOpening} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.viewerBackground, { opacity: dimming }]} />
      {/* collapsable : sans contrôles vidéo, cette vue doit exister pour recevoir le doigt sur une photo. */}
      <View collapsable={false} style={StyleSheet.absoluteFill} {...responder.panHandlers}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                { translateX: drag.x },
                { translateY: drag.y },
                { scale: drag.y.interpolate({ ...dragRange, outputRange: [1, VIEWER_MIN_SCALE] }) },
              ],
            },
          ]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>
          <Animated.View
            style={[
              styles.viewerFrame,
              {
                left: between(rect.x, (width - finalWidth) / 2),
                top: between(rect.y, (height - finalHeight) / 2),
                width: between(rect.width, finalWidth),
                height: between(rect.height, finalHeight),
                borderRadius: between(radius.md, 0),
              },
            ]}
          >
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
          </Animated.View>
          </Animated.View>
          </Animated.View>
        </Animated.View>
        {isVideo && opened && !closing && (
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: chrome }]}>
            <VideoControls player={player} />
          </Animated.View>
        )}
      </View>
      <Animated.View style={[styles.viewerClose, { opacity: dimming }]}>
        <IconButton onPress={close} label={t('commun.fermer')}>
          <X size={28} color={colors.background} strokeWidth={1.75} />
        </IconButton>
      </Animated.View>
    </Modal>
  );
}

const useLocalStyles = createMediaStyles((colors) => ({
  videoTap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 56,
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
}));

const useStyles = () => useChatStyles(useLocalStyles());
