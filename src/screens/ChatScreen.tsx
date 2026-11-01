import { ComponentRef, RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, BackHandler, Dimensions, Easing, FlatList, GestureResponderEvent, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { AudioPlayer, requestRecordingPermissionsAsync, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import { BlurTargetView, BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoPlayer, VideoView } from 'expo-video';
import { ArrowUp, Check, CheckCheck, ChevronUp, Copy, Download, FileText, Flame, Images, Lock, LucideIcon, MessageCircle, Mic, Paperclip, Pause, Pencil, Play, Reply, SmilePlus, Trash2, X } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Rect as SvgRect, Stop } from 'react-native-svg';

import { MediaPicker } from '../components/MediaPicker';
import { showDialog } from '../components/dialog';
import { Avatar, Header, IconButton, Screen, useNavigationBarHeight } from '../components/ui';
import { describeMessage, getContactProfile, getConversationSettings, getMessage, getMessages, getStreak, Message, MessageStatus } from '../chat/database';
import { ALL_EMOJIS, QUICK_REACTIONS } from '../chat/emojis';
import { exportCopy, formatSize, MAX_FILE_BYTES, saveToGallery, videoThumbnail } from '../chat/files';
import { chat, MAX_TEXT_LENGTH, PickedFile } from '../chat/manager';
import { RouteType } from '../network/peer';
import { BubblePalette, bubblePalette, colors, radius, spacing } from '../theme';

const DOUBLE_TAP_MS = 300;
const LONG_PRESS_MS = 350;
const EMOJI_COLUMNS = 8;
// Place réservée autour du message sélectionné : les réactions au-dessus, les actions en dessous.
const REACTIONS_HEIGHT = 56;
const ACTION_HEIGHT = 48;
const SELECTION_GAP = 12;
const SELECTION_TOP = 72;
const SELECTION_CLOSE_MS = 170;
// Glisser pour répondre : le geste démarre après SWIPE_START, et répond à partir de SWIPE_REPLY.
const SWIPE_START = 12;
const SWIPE_REPLY = 56;
const SWIPE_MAX = 76;
const JUMP_PULSE_DELAY_MS = 350;
// Plein écran : au-delà de cette distance ou de cette vitesse vers le bas, le glissé ferme.
const VIEWER_CLOSE_DISTANCE = 110;
const VIEWER_CLOSE_SPEED = 1;
const VIEWER_DRAG_START = 10;
const VIEWER_MIN_SCALE = 0.55;
const VIEWER_OPEN_MS = 300;
const VIEWER_CLOSE_MS = 240;
const VIEWER_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const COMPOSER_FADE_HEIGHT = 140;
const ATTACH_CLOSE_MS = 140;
const TOAST_VISIBLE_MS = 1800;
// Vocal : lâcher avant ce temps ne l'envoie pas. Glisser à gauche l'annule, vers le haut le verrouille.
const VOICE_MIN_MS = 700;
const VOICE_CANCEL_DISTANCE = 110;
const VOICE_LOCK_DISTANCE = 90;
const SEEK_THUMB_SIZE = 16;
const VOICE_DOT_MS = 600;
// Une courbe douce plutôt qu'une ligne droite : on ne voit pas où le dégradé commence.
const COMPOSER_FADE_STOPS = [[0, 0], [0.25, 0.08], [0.5, 0.3], [0.75, 0.68], [1, 1]];

const ROUTE: Record<RouteType, string> = {
  host: 'Connecté, sur le même réseau',
  srflx: 'Connecté, direct par internet',
  relay: 'Connecté, par un serveur relais',
};

// 1 coche : pas encore reçu. 2 coches grises : reçu par l'autre. 2 coches contrastées : conversation ouverte par l'autre.
function statusIcon(status: MessageStatus, tone: MetaTone) {
  if (status === 'read') return { Icon: CheckCheck, color: tone.text, label: 'Lu' };
  if (status === 'delivered') return { Icon: CheckCheck, color: tone.muted, label: 'Reçu' };
  return { Icon: Check, color: tone.muted, label: 'Pas encore reçu' };
}

type MetaTone = { text: string; muted: string };

// Sans bulle, l'heure et les coches sont posées sur le fond : sur une image, elles gardent leur propre pastille sombre.
const PLAIN_TONE: MetaTone = { text: colors.text, muted: colors.textMuted };
const ON_WALLPAPER_TONE: MetaTone = { text: colors.background, muted: colors.onDarkMuted };

type Palettes = { mine: BubblePalette; theirs: BubblePalette; hasWallpaper: boolean };

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
  onCustomize: () => void;
  // Affichée sous la page pendant le geste de retour : elle ne doit pas marquer les messages comme lus.
  preview?: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };
type ViewRef = ComponentRef<typeof View>;

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Photo ou vidéo déjà disponible : affichée seule, sans bulle autour.
function isBareMedia(message: Message) {
  return (message.kind === 'image' || message.kind === 'video') && message.status !== 'receiving';
}

function VideoPreview({ message }: { message: Message }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    videoThumbnail(message.id, message.file_uri ?? '')
      .then((uri) => {
        if (!cancelled) setThumbnail(uri);
      })
      .catch((e) => console.warn('Pear miniature :', e));
    return () => {
      cancelled = true;
    };
  }, [message.id, message.file_uri]);

  return (
    <View style={styles.video}>
      {thumbnail && <Image source={{ uri: thumbnail }} style={styles.image} resizeMode="cover" />}
      <View style={styles.playButton}>
        <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
      </View>
    </View>
  );
}

function FileContent({ message, palette, mediaHidden, onOpen, onLongPress }: { message: Message; palette: BubblePalette; mediaHidden?: boolean; onOpen: (rect: Rect) => void; onLongPress: () => void }) {
  const media = useRef<ViewRef>(null);
  const bare = isBareMedia(message);
  const foreground = bare ? colors.text : palette.text;
  const secondary = bare ? colors.textMuted : palette.muted;
  const progress = chat.getProgress(message.id);

  return (
    <Pressable
      ref={media}
      onPress={() => media.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }))}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      disabled={message.status === 'receiving'}
      style={mediaHidden && styles.hidden}
    >
      {bare && message.kind === 'image' ? (
        <Image source={{ uri: message.file_uri ?? undefined }} style={styles.image} resizeMode="cover" />
      ) : bare ? (
        <VideoPreview message={message} />
      ) : (
        <View style={styles.fileRow}>
          {message.kind === 'video' ? (
            <Play size={24} color={foreground} strokeWidth={1.75} />
          ) : message.kind === 'audio' ? (
            <Mic size={24} color={foreground} strokeWidth={1.75} />
          ) : message.kind === 'image' ? (
            <Images size={24} color={foreground} strokeWidth={1.75} />
          ) : (
            <FileText size={24} color={foreground} strokeWidth={1.75} />
          )}
          <View style={styles.fileText}>
            <Text style={[styles.fileName, { color: foreground }]} numberOfLines={1}>{message.text}</Text>
            <Text style={[styles.time, { color: secondary }]}>{formatSize(message.file_size ?? 0)}</Text>
          </View>
        </View>
      )}
      {progress !== undefined && (
        <View style={[styles.progressTrack, { backgroundColor: bare ? colors.border : palette.track }]}>
          <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%`, backgroundColor: foreground }]} />
        </View>
      )}
    </Pressable>
  );
}

type SeekBarProps = {
  position: number;
  color: string;
  trackColor: string;
  label: string;
  onSeek: (ratio: number) => void;
};

// Une fois la barre attrapée, le doigt peut aller n'importe où : la position suit seulement sa place à l'horizontale.
// Bloquer le geste natif empêche aussi la liste de défiler, jusqu'à ce qu'on lâche.
function SeekBar({ position, color, trackColor, label, onSeek }: SeekBarProps) {
  const area = useRef<ViewRef>(null);
  const origin = useRef(0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const thumb = useRef(new Animated.Value(1)).current;
  const trackWidth = Math.max(0, width - SEEK_THUMB_SIZE);
  const shown = dragging ?? position;

  const growThumb = (toValue: number) => Animated.spring(thumb, { toValue, useNativeDriver: true, damping: 12, stiffness: 320 }).start();

  const seekTo = (pageX: number) => {
    if (trackWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, (pageX - origin.current - SEEK_THUMB_SIZE / 2) / trackWidth));
    setDragging(ratio);
    onSeek(ratio);
  };

  const end = () => {
    setDragging(null);
    growThumb(1);
  };

  return (
    <View
      ref={area}
      collapsable={false}
      style={styles.seekArea}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        const { pageX, locationX } = event.nativeEvent;
        origin.current = pageX - locationX;
        growThumb(1.4);
        seekTo(pageX);
        return true;
      }}
      onResponderMove={(event) => seekTo(event.nativeEvent.pageX)}
      onResponderRelease={end}
      onResponderTerminate={end}
      accessibilityLabel={label}
    >
      <View pointerEvents="none" style={[styles.seekTrack, { backgroundColor: trackColor }]}>
        <View style={[styles.seekBar, { width: `${shown * 100}%`, backgroundColor: color }]} />
      </View>
      <Animated.View
        pointerEvents="none"
        style={[styles.seekThumb, { left: shown * trackWidth, backgroundColor: color, transform: [{ scale: thumb }] }]}
      />
    </View>
  );
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Un seul vocal à la fois : en lancer un met le précédent en pause.
let playingVoice: AudioPlayer | null = null;

function VoiceContent({ message, palette }: { message: Message; palette: BubblePalette }) {
  const player = useAudioPlayer(message.file_uri ?? null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const progress = chat.getProgress(message.id);
  const position = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    player.seekTo(0).catch((e) => console.warn('Pear vocal :', e));
  }, [status.didJustFinish, player]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (playingVoice && playingVoice !== player) {
      try {
        playingVoice.pause();
      } catch {
        // Ce lecteur a déjà été libéré en quittant la conversation : rien à mettre en pause.
      }
    }
    playingVoice = player;
    player.play();
  };

  const seek = (ratio: number) => {
    if (status.duration > 0) player.seekTo(ratio * status.duration).catch((e) => console.warn('Pear vocal :', e));
  };

  return (
    <View style={styles.voice}>
      <IconButton onPress={toggle} label={status.playing ? 'Mettre en pause' : 'Écouter le vocal'} hitSlop={2} style={[styles.voiceButton, { backgroundColor: palette.track }]}>
        {status.playing ? (
          <Pause size={18} color={palette.text} fill={palette.text} strokeWidth={1.75} />
        ) : (
          <Play size={18} color={palette.text} fill={palette.text} strokeWidth={1.75} />
        )}
      </IconButton>
      <View style={styles.voiceBody}>
        <SeekBar position={progress ?? position} color={palette.text} trackColor={palette.track} label="Se déplacer dans le vocal" onSeek={seek} />
        <Text style={[styles.time, { color: palette.muted }]}>{formatClock(status.playing || status.currentTime > 0 ? status.currentTime : status.duration)}</Text>
      </View>
    </View>
  );
}

function ReplyQuote({ message, name, palette, onJump }: { message: Message; name: string; palette: BubblePalette; onJump?: (id: string) => void }) {
  const original = message.reply_to ? getMessage(message.reply_to, message.contact) : null;
  if (!message.reply_to) return null;
  const author = original ? (original.mine === 1 ? 'Vous' : name) : '';
  return (
    <Pressable
      onPress={() => original && onJump?.(original.id)}
      accessibilityLabel="Voir le message d'origine"
      style={[styles.quote, { backgroundColor: palette.track }]}
    >
      {original && <Text style={[styles.quoteAuthor, { color: palette.text }]} numberOfLines={1}>{author}</Text>}
      <Text style={[styles.quoteText, { color: palette.muted }]} numberOfLines={2}>
        {original ? describeMessage(original) : 'Message supprimé'}
      </Text>
    </Pressable>
  );
}

function MessageMeta({ message, tone, pill }: { message: Message; tone: MetaTone; pill?: boolean }) {
  const { Icon: StatusIcon, color: statusColor, label: statusLabel } = statusIcon(message.status, tone);
  const pop = useRef(new Animated.Value(1)).current;
  const lastStatus = useRef(message.status);

  // Quand la coche change, surtout quand le message passe à « lu », elle saute pour qu'on le voie.
  useEffect(() => {
    if (lastStatus.current === message.status) return;
    lastStatus.current = message.status;
    Animated.sequence([
      Animated.timing(pop, { toValue: message.status === 'read' ? 1.9 : 1.4, duration: 140, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 240 }),
    ]).start();
  }, [message.status, pop]);

  return (
    <View style={[styles.meta, pill && styles.metaPill]}>
      {message.edited === 1 && <Text style={[styles.time, { color: tone.muted }]}>modifié</Text>}
      <Text style={[styles.time, { color: tone.muted }]}>{formatTime(message.created_at)}</Text>
      {message.mine === 1 && (
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <StatusIcon size={14} color={statusColor} strokeWidth={1.75} accessibilityLabel={statusLabel} />
        </Animated.View>
      )}
    </View>
  );
}

// Le fond s'efface doucement vers la zone de saisie. Placé sous la liste, il ne couvre jamais les messages.
function ComposerFade() {
  return (
    <View pointerEvents="none" style={styles.composerFade}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="composerFade" x1="0" y1="0" x2="0" y2="1">
            {COMPOSER_FADE_STOPS.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={colors.background} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <SvgRect width="100%" height="100%" fill="url(#composerFade)" />
      </Svg>
    </View>
  );
}

function systemAction(message: Message) {
  if (message.kind === 'wallpaper') return 'changé le fond de discussion';
  if (!message.text.startsWith('saved:')) return 'retiré le fond de discussion';
  const [, kind, owner] = message.text.split(':');
  const noun = kind === 'video' ? 'vidéo' : 'photo';
  if (message.mine === 1) return `enregistré une ${noun} sur votre téléphone`;
  return `enregistré ${owner === 'yours' ? 'votre' : 'sa'} ${noun} sur son téléphone`;
}

// Une petite annonce sous la barre du haut : elle descend, reste un instant, puis repart.
function Toast({ text, token }: { text: string; token: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.sequence([
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 240 }),
      Animated.delay(TOAST_VISIBLE_MS),
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [token, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}
    >
      <Check size={16} color={colors.background} strokeWidth={2} />
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  );
}

// Les événements de la conversation : centrés, sans bulle, comme un message du système.
function SystemRow({ message, name, hasWallpaper }: { message: Message; name: string; hasWallpaper: boolean }) {
  const author = message.mine === 1 ? 'Vous avez' : `${name} a`;
  return (
    <View style={[styles.systemRow, hasWallpaper && styles.metaPill]}>
      <Text style={[styles.systemText, hasWallpaper && { color: colors.background }]}>{`${author} ${systemAction(message)}`}</Text>
    </View>
  );
}

type BubbleProps = {
  message: Message;
  name: string;
  palettes: Palettes;
  hidden?: boolean;
  mediaHidden?: boolean;
  // Change quand on saute vers ce message : il grossit un instant pour qu'on le repère.
  pulse?: number;
  onOpenFile?: (message: Message, rect: Rect) => void;
  onSelect?: (message: Message, rect: Rect) => void;
  onDoubleTap?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onJump?: (id: string) => void;
};

function Bubble({ message, name, palettes, hidden, mediaHidden, pulse, onOpenFile, onSelect, onDoubleTap, onReply, onJump }: BubbleProps) {
  const container = useRef<ViewRef>(null);
  const lastTap = useRef(0);
  const mine = message.mine === 1;
  const bare = isBareMedia(message);
  const palette = mine ? palettes.mine : palettes.theirs;
  const reactions = [message.their_reaction, message.my_reaction].filter(Boolean);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.08, duration: 160, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 200 }),
    ]).start();
  }, [pulse, scale]);

  // Mon message glisse vers la gauche, celui de l'autre vers la droite.
  const direction = mine ? -1 : 1;
  const swipe = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const reply = useRef(onReply);
  reply.current = onReply;
  const reset = () => {
    armed.current = false;
    Animated.spring(swipe, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start();
  };
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx * direction > SWIPE_START && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        const distance = Math.max(0, Math.min(SWIPE_MAX, gesture.dx * direction));
        swipe.setValue(distance * direction);
        const reached = distance >= SWIPE_REPLY;
        if (reached !== armed.current) {
          armed.current = reached;
          if (reached) Haptics.selectionAsync().catch((e) => console.warn('Pear vibration :', e));
        }
      },
      onPanResponderRelease: () => {
        if (armed.current) reply.current?.(message);
        reset();
      },
      onPanResponderTerminate: reset,
    }),
  ).current;
  const iconRange = mine ? [-SWIPE_REPLY, -SWIPE_START] : [SWIPE_START, SWIPE_REPLY];
  const iconOutput = (hiddenValue: number, shownValue: number) => (mine ? [shownValue, hiddenValue] : [hiddenValue, shownValue]);

  const select = () => {
    container.current?.measureInWindow((x, y, width, height) => onSelect?.(message, { x, y, width, height }));
  };

  const press = () => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDoubleTap(message);
    } else {
      lastTap.current = now;
    }
  };

  if (message.kind === 'wallpaper' || message.kind === 'system') {
    return <SystemRow message={message} name={name} hasWallpaper={palettes.hasWallpaper} />;
  }

  return (
    <View
      ref={container}
      collapsable={false}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, hidden && styles.hidden]}
      {...(onReply ? swipeResponder.panHandlers : undefined)}
    >
      {onReply && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeIcon,
            mine ? styles.swipeIconMine : styles.swipeIconTheirs,
            {
              opacity: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0, 1), extrapolate: 'clamp' }),
              transform: [
                { scale: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0.4, 1), extrapolate: 'clamp' }) },
                { rotate: swipe.interpolate({ inputRange: iconRange, outputRange: mine ? ['0deg', '-60deg'] : ['60deg', '0deg'], extrapolate: 'clamp' }) },
              ],
            },
          ]}
        >
          <Reply size={18} color={colors.text} strokeWidth={1.75} />
        </Animated.View>
      )}
      <Animated.View style={[mine ? styles.rowMine : styles.rowTheirs, { transform: [{ translateX: swipe }, { scale }] }]}>
        <Pressable
          onPress={press}
          onLongPress={select}
          delayLongPress={LONG_PRESS_MS}
          style={bare ? styles.bare : [styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: palette.background }]}
        >
          <ReplyQuote message={message} name={name} palette={palette} onJump={onJump} />
          {message.kind === 'text' ? (
            <Text style={[styles.text, { color: palette.text }]}>{message.text}</Text>
          ) : message.kind === 'audio' && message.status !== 'receiving' ? (
            <VoiceContent message={message} palette={palette} />
          ) : (
            <FileContent message={message} palette={palette} mediaHidden={mediaHidden} onOpen={(rect) => onOpenFile?.(message, rect)} onLongPress={select} />
          )}
          {bare ? (
            <MessageMeta message={message} tone={palettes.hasWallpaper ? ON_WALLPAPER_TONE : PLAIN_TONE} pill={palettes.hasWallpaper} />
          ) : (
            <MessageMeta message={message} tone={palette} />
          )}
        </Pressable>
        {reactions.length > 0 && (
          <View style={styles.reactions}>
            {reactions.map((emoji, index) => (
              <Text key={index} style={styles.reactionEmoji}>{emoji}</Text>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// Plein écran : juste lecture ou pause et une barre pour se déplacer.
function VideoControls({ player }: { player: VideoPlayer }) {
  const bottom = useNavigationBarHeight();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing, oldIsPlaying: false });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: player.currentTime, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const duration = player.duration;
  const position = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const toggle = () => (isPlaying ? player.pause() : player.play());

  useEventListener(player, 'playToEnd', () => {
    player.pause();
    player.currentTime = 0;
  });

  return (
    <>
      <Pressable onPress={toggle} accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'} style={styles.videoTap}>
        {!isPlaying && (
          <View style={styles.playButton}>
            <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          </View>
        )}
      </Pressable>
      <View style={[styles.videoControls, { bottom: bottom + spacing.md }]}>
        <IconButton onPress={toggle} label={isPlaying ? 'Mettre en pause' : 'Lire'}>
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
            label="Se déplacer dans la vidéo"
            onSeek={(ratio) => {
              if (duration > 0) player.currentTime = ratio * duration;
            }}
          />
        </View>
      </View>
    </>
  );
}

type Viewing = { message: Message; rect: Rect; poster: string; size: { width: number; height: number } };

// Le cadre passe en douceur du carré de la conversation au format réel du média : l'image, recadrée
// en continu, ne saute jamais. Une vidéo n'est lue qu'une fois le cadre en place, et se met en pause
// dès la fermeture. Glissé vers le bas, le média suit le doigt ; lâché trop tôt, il revient en plein écran.
// Le cadre change de taille à chaque image : ces animations ne peuvent pas passer par le pilote natif.
function MediaViewer({ viewing: { message, rect, poster, size }, onClose }: { viewing: Viewing; onClose: () => void }) {
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

  const close = () => {
    if (closingRef.current) return;
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

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: VIEWER_OPEN_MS, easing: VIEWER_EASING, useNativeDriver: false }).start(({ finished }) => {
      if (!finished || closingRef.current) return;
      setOpened(true);
      if (isVideo) player.play();
    });
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > VIEWER_DRAG_START && gesture.dy > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => drag.setValue({ x: gesture.dx, y: Math.max(0, gesture.dy) }),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > VIEWER_CLOSE_DISTANCE || gesture.vy > VIEWER_CLOSE_SPEED) latestClose.current();
        else Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false, damping: 18, stiffness: 220 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(),
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
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
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
        <IconButton onPress={close} label="Fermer">
          <X size={28} color={colors.background} strokeWidth={1.75} />
        </IconButton>
      </Animated.View>
    </Modal>
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const bottom = useNavigationBarHeight();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.emojiOverlay} onPress={onClose}>
        <Pressable style={[styles.emojiSheet, { paddingBottom: bottom + spacing.sm }]}>
          <FlatList
            data={ALL_EMOJIS}
            numColumns={EMOJI_COLUMNS}
            keyExtractor={(emoji, index) => `${index}-${emoji}`}
            renderItem={({ item }) => (
              <Pressable onPress={() => onPick(item)} style={styles.emojiCell}>
                <Text style={styles.emojiLarge}>{item}</Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Maintenir le micro enregistre, lâcher envoie. Glisser à gauche annule, glisser vers le haut verrouille :
// le doigt est alors libre, et on choisit ensuite d'envoyer ou de supprimer.
function useVoiceRecorder(onRecorded: (uri: string, seconds: number) => void, onTooShort: () => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<'idle' | 'holding' | 'locked'>('idle');
  const [seconds, setSeconds] = useState(0);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const lockProgress = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const phaseRef = useRef<'idle' | 'holding' | 'locked'>('idle');
  const startedAt = useRef(0);
  const fingerDown = useRef(false);
  const overCancel = useRef(false);
  const tapWhileLocked = useRef(false);

  const changePhase = (next: 'idle' | 'holding' | 'locked') => {
    phaseRef.current = next;
    setPhase(next);
  };

  const settle = (value: Animated.Value, toValue: number) =>
    Animated.spring(value, { toValue, useNativeDriver: true, damping: 15, stiffness: 240 }).start();

  useEffect(() => {
    if (phase === 'idle') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [phase === 'idle']);

  const begin = async () => {
    overCancel.current = false;
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        showDialog('Micro non autorisé', 'Autorisez le micro dans les réglages pour envoyer des vocaux.', [
          { label: 'Ouvrir les réglages', onPress: () => Linking.openSettings() },
          { label: 'Annuler', style: 'cancel' },
        ]);
        return;
      }
      // Le doigt a pu se lever pendant la demande d'autorisation : dans ce cas, rien ne s'enregistre.
      if (!fingerDown.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!fingerDown.current) return;
      recorder.record();
      startedAt.current = Date.now();
      changePhase('holding');
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch((e) => console.warn('Pear vibration :', e));
    } catch (e) {
      showDialog('Enregistrement impossible', String(e));
    }
  };

  const stop = async (send: boolean) => {
    const duration = Date.now() - startedAt.current;
    changePhase('idle');
    settle(dragX, 0);
    settle(dragY, 0);
    settle(lockProgress, 0);
    settle(scale, 1);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!send) return;
      if (duration < VOICE_MIN_MS) onTooShort();
      else if (recorder.uri) onRecorded(recorder.uri, Math.round(duration / 1000));
    } catch (e) {
      showDialog('Enregistrement impossible', String(e));
    }
  };

  const press = () => {
    fingerDown.current = true;
    if (phaseRef.current === 'locked') {
      tapWhileLocked.current = true;
      return;
    }
    settle(scale, 1.3);
    begin();
  };

  const move = (dx: number, dy: number) => {
    if (phaseRef.current !== 'holding') return;
    // Un seul axe à la fois : soit vers la poubelle, soit vers le cadenas.
    const sideways = Math.abs(dx) >= Math.abs(dy);
    dragX.setValue(sideways ? Math.min(0, dx) : 0);
    dragY.setValue(sideways ? 0 : Math.min(0, dy));
    const cancelling = sideways && dx < -VOICE_CANCEL_DISTANCE;
    if (cancelling !== overCancel.current) {
      overCancel.current = cancelling;
      if (cancelling) Haptics.selectionAsync().catch((e) => console.warn('Pear vibration :', e));
    }
    if (!sideways && dy < -VOICE_LOCK_DISTANCE) {
      changePhase('locked');
      overCancel.current = false;
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm).catch((e) => console.warn('Pear vibration :', e));
      settle(dragX, 0);
      settle(dragY, 0);
      settle(scale, 1);
      settle(lockProgress, 1);
    }
  };

  const release = () => {
    fingerDown.current = false;
    if (phaseRef.current === 'locked') {
      if (tapWhileLocked.current) {
        tapWhileLocked.current = false;
        stop(true);
      }
      return;
    }
    if (phaseRef.current === 'holding') {
      stop(!overCancel.current);
    } else {
      settle(scale, 1);
      onTooShort();
    }
  };

  const latest = useRef({ press, move, release });
  latest.current = { press, move, release };
  const panHandlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        Keyboard.dismiss();
        latest.current.press();
      },
      onPanResponderMove: (_event, { dx, dy }) => latest.current.move(dx, dy),
      onPanResponderRelease: () => latest.current.release(),
      onPanResponderTerminate: () => latest.current.release(),
    }),
  ).current.panHandlers;

  return { phase, seconds, dragX, dragY, lockProgress, scale, panHandlers, discard: () => stop(false) };
}

// Le texte passe en fondu de l'un à l'autre, au fil du glissé.
function RecordingRow({ seconds, locked, dragX, onDiscard }: { seconds: number; locked: boolean; dragX: Animated.Value; onDiscard: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const lockAppear = useRef(new Animated.Value(0)).current;
  const cancelRange = { inputRange: [-VOICE_CANCEL_DISTANCE, -VOICE_CANCEL_DISTANCE * 0.5], extrapolate: 'clamp' as const };

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: VOICE_DOT_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: VOICE_DOT_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    Animated.spring(lockAppear, { toValue: locked ? 1 : 0, useNativeDriver: true, damping: 12, stiffness: 240 }).start();
  }, [locked, lockAppear]);

  return (
    <View style={styles.recordingRow}>
      {locked && (
        <IconButton onPress={onDiscard} label="Supprimer le vocal" hitSlop={8}>
          <Trash2 size={20} color={colors.danger} strokeWidth={1.75} />
        </IconButton>
      )}
      <Animated.View style={[styles.recordingDot, { opacity: pulse }]} />
      <Text style={styles.recordingTime}>{formatClock(seconds)}</Text>
      {locked ? (
        <Animated.View style={[styles.recordingLock, { opacity: lockAppear, transform: [{ scale: lockAppear }] }]} accessibilityLabel="Vocal verrouillé">
          <Lock size={18} color={colors.text} strokeWidth={1.75} />
        </Animated.View>
      ) : (
        <View style={styles.recordingHints}>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.recordingHint,
              {
                opacity: dragX.interpolate({ ...cancelRange, outputRange: [0, 1] }),
                transform: [{ translateX: dragX.interpolate({ ...cancelRange, outputRange: [-14, 0] }) }],
              },
            ]}
          >
            ‹ Glissez pour annuler
          </Animated.Text>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.recordingHint,
              { color: colors.danger },
              {
                opacity: dragX.interpolate({ ...cancelRange, outputRange: [1, 0] }),
                transform: [{ translateX: dragX.interpolate({ ...cancelRange, outputRange: [0, 14] }) }],
              },
            ]}
          >
            Lâchez pour annuler
          </Animated.Text>
        </View>
      )}
    </View>
  );
}

type AttachMenuProps = {
  open: boolean;
  progress: Animated.Value;
  onPhotos: () => void;
  onFile: () => void;
};

// Les deux choix montent depuis le trombone, l'un après l'autre, puis redescendent à la fermeture.
function AttachMenu({ open, progress, onPhotos, onFile }: AttachMenuProps) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 240 }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: ATTACH_CLOSE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, progress]);

  if (!mounted) return null;

  const options = [
    { icon: Images, label: 'Photos', onPress: onPhotos },
    { icon: FileText, label: 'Fichier', onPress: onFile },
  ];

  return (
    <View style={styles.attachMenu}>
      {options.map(({ icon: Icon, label, onPress }, index) => {
        const inputRange = index === 0 ? [0, 0.7] : [0.3, 1];
        const appear = (from: number, to: number) => progress.interpolate({ inputRange, outputRange: [from, to], extrapolateLeft: 'clamp' });
        return (
          <Animated.View key={label} style={{ opacity: appear(0, 1), transform: [{ translateY: appear(16, 0) }, { scale: appear(0.7, 1) }] }}>
            <IconButton onPress={onPress} label={label} hitSlop={0} style={styles.attachOption}>
              <Icon size={18} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.attachLabel}>{label}</Text>
            </IconButton>
          </Animated.View>
        );
      })}
    </View>
  );
}

type Action = { label: string; icon: LucideIcon; onPress: () => void; danger?: boolean };

type SelectionProps = {
  message: Message;
  name: string;
  palettes: Palettes;
  rect: Rect;
  origin: { y: number; height: number };
  blurTarget: RefObject<ViewRef | null>;
  actions: Action[];
  onReact: (emoji: string) => void;
  onClose: () => void;
};

// Comme dans Google Messages : tout s'assombrit et se floute, le message monte et grossit,
// avec les réactions au-dessus et les actions en dessous.
function MessageSelection({ message, name, palettes, rect, origin, blurTarget, actions, onReact, onClose }: SelectionProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [pickerOpen, setPickerOpen] = useState(false);
  const closing = useRef(false);
  const mine = message.mine === 1;
  const bottom = useNavigationBarHeight();

  // Le message redescend à sa place, puis l'action choisie s'exécute.
  const dismiss = useRef((after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: SELECTION_CLOSE_MS, useNativeDriver: true }).start(() => {
      onClose();
      after?.();
    });
  }).current;

  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 220, mass: 0.8 }).start();
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => back.remove();
  }, [progress, dismiss]);

  const react = (emoji: string) => {
    setPickerOpen(false);
    dismiss(() => onReact(emoji));
  };

  // Le message se place pour laisser la place aux réactions et aux actions, sans sortir de l'écran.
  const menuHeight = actions.length * ACTION_HEIGHT + spacing.sm * 2;
  const startY = rect.y - origin.y;
  const lowest = origin.height - bottom - spacing.lg - menuHeight - SELECTION_GAP - rect.height;
  const targetY = Math.max(SELECTION_TOP + REACTIONS_HEIGHT, Math.min(startY - spacing.sm, lowest));
  const edge = mine ? styles.alignEnd : styles.alignStart;

  const appear = {
    opacity: progress,
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={40} tint="default" style={StyleSheet.absoluteFill} />
        <View style={styles.selectionDim} />
      </Animated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel="Fermer" />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.selected,
          {
            top: startY,
            left: spacing.md,
            right: spacing.md,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, targetY - startY] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) },
            ],
          },
        ]}
      >
        <Bubble message={message} name={name} palettes={palettes} />
      </Animated.View>

      <Animated.View style={[styles.reactionBar, edge, { top: targetY - REACTIONS_HEIGHT - spacing.sm }, appear]}>
        {QUICK_REACTIONS.map((emoji) => (
          <IconButton key={emoji} onPress={() => react(emoji)} label={emoji} hitSlop={4} style={styles.reactionOption}>
            <Text style={[styles.reactionChoice, message.my_reaction === emoji && styles.reactionActive]}>{emoji}</Text>
          </IconButton>
        ))}
        <IconButton onPress={() => setPickerOpen(true)} label="Tous les emojis" hitSlop={4} style={styles.reactionOption}>
          <SmilePlus size={24} color={colors.text} strokeWidth={1.75} />
        </IconButton>
      </Animated.View>

      <Animated.View style={[styles.actionsMenu, edge, { top: targetY + rect.height + SELECTION_GAP }, appear]}>
        {actions.map(({ label, icon: Icon, onPress, danger }) => (
          <Pressable key={label} onPress={() => dismiss(onPress)} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
            <Icon size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.75} />
            <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
          </Pressable>
        ))}
      </Animated.View>

      {pickerOpen && <EmojiPicker onPick={react} onClose={() => setPickerOpen(false)} />}
    </View>
  );
}

export function ChatScreen({ contactKey, name, onBack, onInfo, onCustomize, preview }: Props) {
  const [draft, setDraft] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachProgress = useRef(new Animated.Value(0)).current;
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; token: number } | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [selection, setSelection] = useState<{ message: Message; rect: Rect; origin: { y: number; height: number } } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const blurTarget = useRef<ViewRef>(null);
  const root = useRef<ViewRef>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const list = useRef<FlatList<Message>>(null);
  const [pulsing, setPulsing] = useState<{ id: string; token: number } | null>(null);
  const bottom = useNavigationBarHeight();
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const messages = getMessages(contactKey);
  const settings = getConversationSettings(contactKey);
  const palettes: Palettes = {
    mine: bubblePalette(settings.my_bubble ?? colors.text),
    theirs: bubblePalette(settings.their_bubble ?? colors.surface),
    hasWallpaper: settings.wallpaper_uri !== null,
  };
  const streak = getStreak(contactKey);
  const photo = getContactProfile(contactKey).photo_uri;
  const { status, route } = chat.getLink(contactKey);
  const subtitle = !chat.isOnline()
    ? 'Vous êtes hors ligne'
    : status === 'connected'
      ? route ? ROUTE[route] : 'Connecté'
      : 'Votre contact est hors ligne';

  useEffect(() => {
    if (preview) return;
    chat.setOpenConversation(contactKey);
    return () => chat.setOpenConversation(null);
  }, [contactKey, preview]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const closeSelection = useRef(() => setSelection(null)).current;

  const selectMessage = (message: Message, rect: Rect) => {
    Keyboard.dismiss();
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch((e) => console.warn('Pear vibration :', e));
    root.current?.measureInWindow((_x, y, _width, height) => setSelection({ message, rect, origin: { y, height } }));
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (editing) {
      chat.edit(contactKey, editing.id, text);
      setEditing(null);
    } else {
      chat.send(contactKey, text, replyingTo?.id ?? null);
      setReplyingTo(null);
    }
    setDraft('');
  };

  const confirmDelete = (message: Message) => {
    const forMe = { label: 'Pour moi', style: 'danger' as const, onPress: () => chat.deleteForMe(contactKey, message.id) };
    const cancel = { label: 'Annuler', style: 'cancel' as const };
    if (message.mine === 1) {
      showDialog('Supprimer ce message ?', undefined, [
        { label: 'Pour tout le monde', style: 'danger', onPress: () => chat.deleteForEveryone(contactKey, message.id) },
        forMe,
        cancel,
      ]);
    } else {
      showDialog('Supprimer ce message pour vous ?', undefined, [{ ...forMe, label: 'Supprimer' }, cancel]);
    }
  };

  // Remonte jusqu'au message cité, puis le fait grossir un instant pour le repérer.
  const jumpTo = (id: string) => {
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) {
      showDialog('Message trop ancien', 'Seuls les 200 derniers messages sont affichés.');
      return;
    }
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setTimeout(() => setPulsing({ id, token: Date.now() }), JUMP_PULSE_DELAY_MS);
  };

  const startReply = (message: Message) => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(message);
    input.current?.focus();
  };

  const saveMedia = async (message: Message) => {
    try {
      await saveToGallery(message.file_uri ?? '', message.text);
      Haptics.selectionAsync().catch((e) => console.warn('Pear vibration :', e));
      setToast({ text: 'Enregistré sur votre téléphone', token: Date.now() });
      if (message.kind === 'image' || message.kind === 'video') chat.markSaved(contactKey, message.id, message.kind);
    } catch (e) {
      showDialog('Enregistrement impossible', String(e));
    }
  };

  const actionsFor = (message: Message): Action[] => [
    { label: 'Répondre', icon: Reply, onPress: () => startReply(message) },
    ...(message.kind === 'text'
      ? [{ label: 'Copier', icon: Copy, onPress: () => Clipboard.setStringAsync(message.text) }]
      : []),
    ...(message.kind === 'text' && message.mine === 1
      ? [
          {
            label: 'Modifier',
            icon: Pencil,
            onPress: () => {
              setReplyingTo(null);
              setEditing(message);
              setDraft(message.text);
              input.current?.focus();
            },
          },
        ]
      : []),
    ...((message.kind === 'image' || message.kind === 'video') && message.file_uri
      ? [{ label: 'Enregistrer', icon: Download, onPress: () => saveMedia(message) }]
      : []),
    { label: 'Supprimer', icon: Trash2, danger: true, onPress: () => confirmDelete(message) },
  ];

  const cancelComposerMode = () => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(null);
  };

  const sendPicked = async (file: PickedFile) => {
    if (file.size > MAX_FILE_BYTES) {
      showDialog('Fichier trop lourd', `La limite est de ${formatSize(MAX_FILE_BYTES)}.`);
      return;
    }
    try {
      await chat.sendFile(contactKey, file);
    } catch (e) {
      showDialog('Envoi impossible', String(e));
    }
  };

  const voice = useVoiceRecorder(
    (uri, seconds) => sendPicked({ uri, name: `vocal-${seconds}s.m4a`, size: 0, mime: 'audio/mp4', kind: 'audio' }),
    () => setToast({ text: 'Maintenez le micro pour enregistrer', token: Date.now() }),
  );
  // Le micro devient progressivement une poubelle, au fil du glissé vers la gauche.
  const trashAmount = voice.dragX.interpolate({ inputRange: [-VOICE_CANCEL_DISTANCE, -VOICE_CANCEL_DISTANCE * 0.2], outputRange: [1, 0], extrapolate: 'clamp' });

  const sendFromGallery = async (files: PickedFile[]) => {
    setGalleryOpen(false);
    for (const file of files) await sendPicked(file);
  };

  const pickDocument = async () => {
    setAttachOpen(false);
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await sendPicked({
      uri: asset.uri,
      name: asset.name,
      size: asset.size ?? 0,
      mime: asset.mimeType ?? null,
      kind: 'file',
    });
  };

  const openFile = async (message: Message, rect: Rect) => {
    if (message.kind !== 'file') {
      Keyboard.dismiss();
      const uri = message.file_uri ?? '';
      try {
        const poster = message.kind === 'video' ? await videoThumbnail(message.id, uri) : uri;
        setViewing({ message, rect, poster, size: await Image.getSize(poster) });
      } catch (e) {
        showDialog('Ouverture impossible', String(e));
      }
      return;
    }
    try {
      const copy = new File(await exportCopy(message.file_uri ?? '', message.text));
      const mimeType = message.file_mime ?? undefined;
      // Ouvre le fichier dans une app adaptée. Sans app pour ce format, on propose de le partager.
      if (await copy.canPreview({ mimeType })) await copy.preview({ title: message.text, mimeType });
      else await Sharing.shareAsync(copy.uri, { mimeType, dialogTitle: message.text });
    } catch (e) {
      showDialog('Ouverture impossible', String(e));
    }
  };

  return (
    <Screen edgeToEdgeBottom>
      <View ref={root} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <BlurTargetView ref={blurTarget} style={styles.flex}>
        {settings.wallpaper_uri && <Image source={{ uri: settings.wallpaper_uri }} style={styles.wallpaper} resizeMode="cover" />}
        <View style={styles.headerBar}>
          <Header
            title={name}
            subtitle={subtitle}
            onBack={onBack}
            avatar={<Avatar uri={photo} size={36} />}
            onTitlePress={onInfo}
            action={
              <View style={styles.headerActions}>
                {streak > 0 && (
                  <View style={styles.streak} accessibilityLabel={`Série de ${streak} jours`}>
                    <Flame size={18} color={colors.text} strokeWidth={1.75} />
                    <Text style={styles.streakCount}>{streak}</Text>
                  </View>
                )}
                <IconButton onPress={onCustomize} label="Personnaliser la conversation" style={styles.moreButton}>
                  <View style={styles.moreDot} />
                  <View style={styles.moreDot} />
                </IconButton>
              </View>
            }
          />
        </View>
        {/* Le décalage compense la barre d'état, placée au-dessus de la zone floutée. */}
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={StatusBar.currentHeight ?? 0} style={styles.flex}>
          <View style={styles.flex}>
          {palettes.hasWallpaper && <ComposerFade />}
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <MessageCircle size={28} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyText}>Vos messages restent sur vos deux téléphones.</Text>
            </View>
          ) : (
            <FlatList
              ref={list}
              inverted
              style={styles.flex}
              data={messages}
              keyExtractor={(message) => message.id}
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                // Le message n'est pas encore affiché : on s'en approche, puis on réessaie.
                list.current?.scrollToOffset({ offset: index * averageItemLength, animated: true });
                setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), JUMP_PULSE_DELAY_MS);
              }}
              renderItem={({ item }) => (
                <Bubble
                  message={item}
                  name={name}
                  palettes={palettes}
                  pulse={pulsing?.id === item.id ? pulsing.token : undefined}
                  onJump={jumpTo}
                  hidden={selection?.message.id === item.id}
                  mediaHidden={viewing?.message.id === item.id}
                  onOpenFile={openFile}
                  onSelect={selectMessage}
                  onDoubleTap={(message) => chat.react(contactKey, message.id, '❤️')}
                  onReply={startReply}
                />
              )}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          )}
          {toast && <Toast text={toast.text} token={toast.token} />}
          <AttachMenu
            open={attachOpen}
            progress={attachProgress}
            onPhotos={() => {
              setAttachOpen(false);
              setGalleryOpen(true);
            }}
            onFile={pickDocument}
          />
          </View>
          <View style={styles.composerArea}>
          {(replyingTo || editing) && (
            <View style={styles.composerMode}>
              {editing ? <Pencil size={20} color={colors.text} strokeWidth={1.75} /> : <Reply size={20} color={colors.text} strokeWidth={1.75} />}
              <View style={styles.flex}>
                <Text style={styles.composerModeTitle} numberOfLines={1}>
                  {editing ? 'Modifier le message' : `Répondre à ${replyingTo?.mine === 1 ? 'vous-même' : name}`}
                </Text>
                <Text style={styles.composerModeText} numberOfLines={1}>{describeMessage((editing ?? replyingTo)!)}</Text>
              </View>
              <IconButton onPress={cancelComposerMode} label="Annuler">
                <X size={20} color={colors.text} strokeWidth={1.75} />
              </IconButton>
            </View>
          )}
          <View style={[styles.composer, { paddingBottom: keyboardOpen ? spacing.sm : bottom + spacing.sm }]}>
            {voice.phase !== 'idle' ? (
              <RecordingRow seconds={voice.seconds} locked={voice.phase === 'locked'} dragX={voice.dragX} onDiscard={voice.discard} />
            ) : (
              <>
                <IconButton onPress={() => setAttachOpen(!attachOpen)} label="Joindre un fichier" hitSlop={0} style={styles.attach}>
                  <Animated.View style={{ transform: [{ rotate: attachProgress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) }] }}>
                    <Paperclip size={20} color={colors.text} strokeWidth={1.75} />
                  </Animated.View>
                </IconButton>
                <TextInput
                  ref={input}
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Message"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_TEXT_LENGTH}
                  multiline
                />
              </>
            )}
            {voice.phase === 'holding' && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.voiceLockHint,
                  { transform: [{ scale: voice.dragY.interpolate({ inputRange: [-VOICE_LOCK_DISTANCE, 0], outputRange: [1.25, 1], extrapolate: 'clamp' }) }] },
                ]}
              >
                <Lock size={18} color={colors.text} strokeWidth={1.75} />
                <ChevronUp size={16} color={colors.textMuted} strokeWidth={1.75} />
              </Animated.View>
            )}
            {(draft.trim() || editing) && voice.phase === 'idle' ? (
              <IconButton
                onPress={send}
                disabled={!draft.trim()}
                label={editing ? 'Enregistrer' : 'Envoyer'}
                hitSlop={0}
                style={[styles.send, !draft.trim() && styles.sendDisabled]}
              >
                {editing ? <Check size={20} color={colors.background} strokeWidth={2} /> : <ArrowUp size={20} color={colors.background} strokeWidth={2} />}
              </IconButton>
            ) : (
              <Animated.View
                {...voice.panHandlers}
                accessibilityRole="button"
                accessibilityLabel={voice.phase === 'locked' ? 'Envoyer le vocal' : 'Maintenir pour enregistrer un vocal'}
                style={[styles.send, { transform: [{ translateX: voice.dragX }, { translateY: voice.dragY }, { scale: voice.scale }] }]}
              >
                <Animated.View style={[styles.micLayer, styles.micTrash, { opacity: trashAmount }]}>
                  <Trash2 size={20} color={colors.background} strokeWidth={2} />
                </Animated.View>
                <Animated.View style={[styles.micLayer, { opacity: Animated.multiply(Animated.subtract(1, trashAmount), Animated.subtract(1, voice.lockProgress)) }]}>
                  <Mic size={20} color={colors.background} strokeWidth={2} />
                </Animated.View>
                <Animated.View style={[styles.micLayer, { opacity: voice.lockProgress }]}>
                  <ArrowUp size={20} color={colors.background} strokeWidth={2} />
                </Animated.View>
              </Animated.View>
            )}
          </View>
          </View>
        </KeyboardAvoidingView>
      </BlurTargetView>
      {selection && (
        <MessageSelection
          message={selection.message}
          name={name}
          palettes={palettes}
          rect={selection.rect}
          origin={selection.origin}
          blurTarget={blurTarget}
          actions={actionsFor(selection.message)}
          onReact={(emoji) => chat.react(contactKey, selection.message.id, emoji)}
          onClose={closeSelection}
        />
      )}
      {viewing && <MediaViewer viewing={viewing} onClose={() => setViewing(null)} />}
      {galleryOpen && <MediaPicker onPick={sendFromGallery} onClose={() => setGalleryOpen(false)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerBar: {
    backgroundColor: colors.background,
  },
  moreButton: {
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  moreDot: {
    width: 4,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.text,
  },
  composerFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Dépasse un peu sous la saisie : sur certains écrans, un arrondi laisserait voir le fond sur un pixel.
    bottom: -2,
    height: COMPOSER_FADE_HEIGHT,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  streakCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  wallpaper: {
    ...StyleSheet.absoluteFill,
  },
  systemRow: {
    alignSelf: 'center',
    paddingVertical: 2,
  },
  systemText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  metaPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    maxWidth: '80%',
  },
  rowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  hidden: {
    opacity: 0,
  },
  swipeIcon: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  swipeIconMine: {
    right: spacing.sm,
  },
  swipeIconTheirs: {
    left: spacing.sm,
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  bare: {
    alignItems: 'flex-end',
    gap: 2,
  },
  mine: {
    borderBottomRightRadius: 4,
  },
  theirs: {
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
  },
  quote: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginBottom: 6,
  },
  quoteAuthor: {
    fontSize: 13,
    fontWeight: '600',
  },
  quoteText: {
    fontSize: 13,
  },
  reactions: {
    flexDirection: 'row',
    gap: 2,
    marginTop: -6,
    marginHorizontal: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
  },
  video: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
    backgroundColor: colors.onDarkTrack,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playButton: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  seekArea: {
    height: 44,
    justifyContent: 'center',
  },
  seekTrack: {
    marginHorizontal: SEEK_THUMB_SIZE / 2,
    height: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  seekBar: {
    height: 4,
  },
  seekThumb: {
    position: 'absolute',
    top: (44 - SEEK_THUMB_SIZE) / 2,
    width: SEEK_THUMB_SIZE,
    height: SEEK_THUMB_SIZE,
    borderRadius: radius.full,
  },
  selectionDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.selectionDim,
  },
  selected: {
    position: 'absolute',
  },
  alignEnd: {
    right: spacing.md,
  },
  alignStart: {
    left: spacing.md,
  },
  reactionBar: {
    position: 'absolute',
    height: REACTIONS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.background,
  },
  reactionOption: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionChoice: {
    fontSize: 26,
  },
  reactionActive: {
    opacity: 0.45,
  },
  actionsMenu: {
    position: 'absolute',
    minWidth: 200,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: ACTION_HEIGHT,
    paddingHorizontal: spacing.md,
  },
  actionPressed: {
    backgroundColor: colors.surface,
  },
  actionLabel: {
    fontSize: 16,
    color: colors.text,
  },
  emojiOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  emojiSheet: {
    height: '50%',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.background,
  },
  emojiCell: {
    flex: 1 / EMOJI_COLUMNS,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiLarge: {
    fontSize: 28,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 180,
  },
  fileText: {
    flexShrink: 1,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '500',
  },
  progressTrack: {
    height: 3,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressBar: {
    height: 3,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
  time: {
    fontSize: 12,
  },
  toast: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.text,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.background,
  },
  attachMenu: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  attachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    boxShadow: '0px 4px 16px rgba(0, 0, 0, 0.14)',
  },
  attachLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  composerArea: {
    backgroundColor: colors.background,
  },
  composerMode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  composerModeTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  composerModeText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  attach: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micLayer: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micTrash: {
    backgroundColor: colors.danger,
  },
  voiceLockHint: {
    position: 'absolute',
    right: spacing.md,
    bottom: '100%',
    marginBottom: spacing.sm,
    width: 44,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    boxShadow: '0px 4px 16px rgba(0, 0, 0, 0.14)',
    alignItems: 'center',
    gap: 2,
  },
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
  },
  recordingTime: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  recordingHints: {
    flex: 1,
    height: 20,
  },
  recordingHint: {
    ...StyleSheet.absoluteFill,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'right',
  },
  recordingLock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: 220,
  },
  voiceButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBody: {
    flex: 1,
  },
  sendDisabled: {
    backgroundColor: colors.disabled,
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
});
