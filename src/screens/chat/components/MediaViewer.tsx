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

  const close = () => {
    if (closingRef.current) return;
    autoplay.current = false;
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

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > VIEWER_DRAG_START && gesture.dy > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => drag.setValue({ x: gesture.dx, y: Math.max(0, gesture.dy) }),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > VIEWER_CLOSE_DISTANCE || gesture.vy > VIEWER_CLOSE_SPEED) latestClose.current();
        else settleDrag();
      },
      onPanResponderTerminate: () => settleDrag(),
    }),
  ).current;

  // La place finale : le média entier, à son format, centré dans l'écran.
  const fit = Math.min(width / size.width, height / size.height);
  const finalWidth = size.width * fit;
  const finalHeight = size.height * fit;
  const between = (from: number, to: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

  const dragRange = { inputRange: [0, height / 2], extrapolate: 'clamp' as const };
  const dimming = Animated.multiply(progress, drag.y.interpolate({ ...dragRange, outputRange: [1, 0.15] }));
  const chrome = drag.y.interpolate({ inputRange: [0, VIEWER_CLOSE_DISTANCE], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} onShow={startOpening} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.viewerBackground, { opacity: dimming }]} />
      {/* collapsable : sans contrôles vidéo, cette vue doit exister pour recevoir le doigt sur une photo. */}
      <View collapsable={false} style={StyleSheet.absoluteFill} {...pan.panHandlers}>
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
