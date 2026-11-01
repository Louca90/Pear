import { ComponentRef, RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Animated, BackHandler, FlatList, GestureResponderEvent, Image, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { BlurTargetView, BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ArrowUp, Check, CheckCheck, Copy, FileText, Images, Info, LucideIcon, MessageCircle, Paperclip, Pause, Pencil, Play, Reply, SmilePlus, Trash2, X } from 'lucide-react-native';

import { Header, Screen } from '../components/ui';
import { describeMessage, getMessage, getMessages, Message, MessageStatus } from '../chat/database';
import { ALL_EMOJIS, QUICK_REACTIONS } from '../chat/emojis';
import { exportCopy, formatSize, MAX_FILE_BYTES, videoThumbnail } from '../chat/files';
import { chat, MAX_TEXT_LENGTH, PickedFile } from '../chat/manager';
import { RouteType } from '../network/peer';
import { colors, radius, spacing } from '../theme';

// Place de la barre de navigation Android, la plus haute étant celle à 3 boutons.
const NAVIGATION_BAR_SPACE = 48;
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

const ROUTE: Record<RouteType, string> = {
  host: 'Connecté, sur le même réseau',
  srflx: 'Connecté, direct par internet',
  relay: 'Connecté, par un serveur relais',
};

// 1 coche : pas encore reçu. 2 coches grises : reçu par l'autre. 2 coches contrastées : conversation ouverte par l'autre.
function statusIcon(status: MessageStatus, onDark: boolean) {
  if (status === 'read') return { Icon: CheckCheck, color: onDark ? colors.background : colors.text, label: 'Lu' };
  const color = onDark ? colors.onDarkMuted : colors.textMuted;
  if (status === 'delivered') return { Icon: CheckCheck, color, label: 'Reçu' };
  return { Icon: Check, color, label: 'Pas encore reçu' };
}

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
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

function FileContent({ message, onOpen, onLongPress }: { message: Message; onOpen: () => void; onLongPress: () => void }) {
  const bare = isBareMedia(message);
  const onDark = message.mine === 1 && !bare;
  const foreground = onDark ? colors.background : colors.text;
  const secondary = onDark ? colors.onDarkMuted : colors.textMuted;
  const progress = chat.getProgress(message.id);

  return (
    <Pressable onPress={onOpen} onLongPress={onLongPress} delayLongPress={LONG_PRESS_MS} disabled={message.status === 'receiving'}>
      {bare && message.kind === 'image' ? (
        <Image source={{ uri: message.file_uri ?? undefined }} style={styles.image} resizeMode="cover" />
      ) : bare ? (
        <VideoPreview message={message} />
      ) : (
        <View style={styles.fileRow}>
          {message.kind === 'video' ? (
            <Play size={24} color={foreground} strokeWidth={1.75} />
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
        <View style={[styles.progressTrack, { backgroundColor: onDark ? colors.onDarkTrack : colors.border }]}>
          <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%`, backgroundColor: foreground }]} />
        </View>
      )}
    </Pressable>
  );
}

function ReplyQuote({ message, name }: { message: Message; name: string }) {
  const original = message.reply_to ? getMessage(message.reply_to, message.contact) : null;
  if (!message.reply_to) return null;
  const mine = message.mine === 1;
  const author = original ? (original.mine === 1 ? 'Vous' : name) : '';
  return (
    <View style={[styles.quote, { backgroundColor: mine ? colors.onDarkTrack : colors.border }]}>
      {original && <Text style={[styles.quoteAuthor, { color: mine ? colors.background : colors.text }]} numberOfLines={1}>{author}</Text>}
      <Text style={[styles.quoteText, { color: mine ? colors.onDarkMuted : colors.textMuted }]} numberOfLines={2}>
        {original ? describeMessage(original) : 'Message supprimé'}
      </Text>
    </View>
  );
}

function MessageMeta({ message, onDark }: { message: Message; onDark: boolean }) {
  const { Icon: StatusIcon, color: statusColor, label: statusLabel } = statusIcon(message.status, onDark);
  const secondary = onDark ? colors.onDarkMuted : colors.textMuted;
  return (
    <View style={styles.meta}>
      {message.edited === 1 && <Text style={[styles.time, { color: secondary }]}>modifié</Text>}
      <Text style={[styles.time, { color: secondary }]}>{formatTime(message.created_at)}</Text>
      {message.mine === 1 && <StatusIcon size={14} color={statusColor} strokeWidth={1.75} accessibilityLabel={statusLabel} />}
    </View>
  );
}

type BubbleProps = {
  message: Message;
  name: string;
  hidden?: boolean;
  onOpenFile?: (message: Message) => void;
  onSelect?: (message: Message, rect: Rect) => void;
  onDoubleTap?: (message: Message) => void;
  onReply?: (message: Message) => void;
};

function Bubble({ message, name, hidden, onOpenFile, onSelect, onDoubleTap, onReply }: BubbleProps) {
  const container = useRef<ViewRef>(null);
  const lastTap = useRef(0);
  const mine = message.mine === 1;
  const bare = isBareMedia(message);
  const reactions = [message.their_reaction, message.my_reaction].filter(Boolean);

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
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDoubleTap?.(message);
    } else {
      lastTap.current = now;
    }
  };

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
              transform: [{ scale: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0.4, 1), extrapolate: 'clamp' }) }],
            },
          ]}
        >
          <Reply size={18} color={colors.text} strokeWidth={1.75} />
        </Animated.View>
      )}
      <Animated.View style={[mine ? styles.rowMine : styles.rowTheirs, { transform: [{ translateX: swipe }] }]}>
        <Pressable
          onPress={press}
          onLongPress={select}
          delayLongPress={LONG_PRESS_MS}
          style={bare ? styles.bare : [styles.bubble, mine ? styles.mine : styles.theirs]}
        >
          <ReplyQuote message={message} name={name} />
          {message.kind === 'text' ? (
            <Text style={[styles.text, { color: mine ? colors.background : colors.text }]}>{message.text}</Text>
          ) : (
            <FileContent message={message} onOpen={() => onOpenFile?.(message)} onLongPress={select} />
          )}
          <MessageMeta message={message} onDark={mine && !bare} />
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
function VideoViewer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (created) => {
    created.timeUpdateEventInterval = 0.25;
    created.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: true, oldIsPlaying: false });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const [barWidth, setBarWidth] = useState(0);
  const duration = player.duration;
  const position = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const toggle = () => (isPlaying ? player.pause() : player.play());

  useEventListener(player, 'playToEnd', () => {
    player.pause();
    player.currentTime = 0;
  });

  const seek = (event: GestureResponderEvent) => {
    if (barWidth > 0 && duration > 0) {
      player.currentTime = Math.max(0, Math.min(1, event.nativeEvent.locationX / barWidth)) * duration;
    }
  };

  return (
    <>
      <VideoView player={player} style={styles.viewerMedia} contentFit="contain" nativeControls={false} />
      <Pressable onPress={toggle} accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'} style={styles.videoTap}>
        {!isPlaying && (
          <View style={styles.playButton}>
            <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          </View>
        )}
      </Pressable>
      <View style={styles.videoControls}>
        <Pressable onPress={toggle} hitSlop={12} accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}>
          {isPlaying ? (
            <Pause size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          ) : (
            <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
          )}
        </Pressable>
        <View
          style={styles.seekArea}
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onResponderGrant={seek}
          onResponderMove={seek}
          accessibilityLabel="Se déplacer dans la vidéo"
        >
          <View style={styles.seekTrack} pointerEvents="none">
            <View style={[styles.seekBar, { width: `${position * 100}%` }]} />
          </View>
        </View>
      </View>
    </>
  );
}

function MediaViewer({ message, onClose }: { message: Message; onClose: () => void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.viewer}>
        {message.kind === 'video' ? (
          <VideoViewer uri={message.file_uri ?? ''} />
        ) : (
          <Image source={{ uri: message.file_uri ?? undefined }} style={styles.viewerMedia} resizeMode="contain" />
        )}
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fermer" style={styles.viewerClose}>
          <X size={28} color={colors.background} strokeWidth={1.75} />
        </Pressable>
      </View>
    </Modal>
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.emojiOverlay} onPress={onClose}>
        <Pressable style={styles.emojiSheet}>
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

type Action = { label: string; icon: LucideIcon; onPress: () => void; danger?: boolean };

type SelectionProps = {
  message: Message;
  name: string;
  rect: Rect;
  origin: { y: number; height: number };
  blurTarget: RefObject<ViewRef | null>;
  actions: Action[];
  onReact: (emoji: string) => void;
  onClose: () => void;
};

// Comme dans Google Messages : tout s'assombrit et se floute, le message monte et grossit,
// avec les réactions au-dessus et les actions en dessous.
function MessageSelection({ message, name, rect, origin, blurTarget, actions, onReact, onClose }: SelectionProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [pickerOpen, setPickerOpen] = useState(false);
  const closing = useRef(false);
  const mine = message.mine === 1;

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
  const lowest = origin.height - NAVIGATION_BAR_SPACE - menuHeight - SELECTION_GAP - rect.height;
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
        <Bubble message={message} name={name} />
      </Animated.View>

      <Animated.View style={[styles.reactionBar, edge, { top: targetY - REACTIONS_HEIGHT - spacing.sm }, appear]}>
        {QUICK_REACTIONS.map((emoji) => (
          <Pressable key={emoji} onPress={() => react(emoji)} hitSlop={4} style={styles.reactionOption}>
            <Text style={[styles.reactionChoice, message.my_reaction === emoji && styles.reactionActive]}>{emoji}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setPickerOpen(true)} hitSlop={4} accessibilityLabel="Tous les emojis" style={styles.reactionOption}>
          <SmilePlus size={24} color={colors.text} strokeWidth={1.75} />
        </Pressable>
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

export function ChatScreen({ contactKey, name, onBack, onInfo }: Props) {
  const [draft, setDraft] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [selection, setSelection] = useState<{ message: Message; rect: Rect; origin: { y: number; height: number } } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const blurTarget = useRef<ViewRef>(null);
  const root = useRef<ViewRef>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const messages = getMessages(contactKey);
  const { status, route } = chat.getLink(contactKey);
  const subtitle = !chat.isOnline()
    ? 'Vous êtes hors ligne'
    : status === 'connected'
      ? route ? ROUTE[route] : 'Connecté'
      : 'Votre contact est hors ligne';

  useEffect(() => {
    chat.setOpenConversation(contactKey);
    return () => chat.setOpenConversation(null);
  }, [contactKey]);

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
    const forMe = { text: 'Pour moi', style: 'destructive' as const, onPress: () => chat.deleteForMe(contactKey, message.id) };
    const cancel = { text: 'Annuler', style: 'cancel' as const };
    if (message.mine === 1) {
      Alert.alert('Supprimer ce message ?', undefined, [
        cancel,
        forMe,
        { text: 'Pour tout le monde', style: 'destructive', onPress: () => chat.deleteForEveryone(contactKey, message.id) },
      ]);
    } else {
      Alert.alert('Supprimer ce message pour vous ?', undefined, [cancel, { ...forMe, text: 'Supprimer' }]);
    }
  };

  const startReply = (message: Message) => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(message);
    input.current?.focus();
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
    { label: 'Supprimer', icon: Trash2, danger: true, onPress: () => confirmDelete(message) },
  ];

  const cancelComposerMode = () => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(null);
  };

  const sendPicked = async (file: PickedFile) => {
    if (file.size > MAX_FILE_BYTES) {
      Alert.alert('Fichier trop lourd', `La limite est de ${formatSize(MAX_FILE_BYTES)}.`);
      return;
    }
    try {
      await chat.sendFile(contactKey, file);
    } catch (e) {
      Alert.alert('Envoi impossible', String(e));
    }
  };

  const pickMedia = async () => {
    setAttachOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await sendPicked({
      uri: asset.uri,
      name: asset.fileName ?? (asset.type === 'video' ? 'video' : 'photo'),
      size: asset.fileSize ?? 0,
      mime: asset.mimeType ?? null,
      kind: asset.type === 'video' ? 'video' : 'image',
    });
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

  const openFile = async (message: Message) => {
    if (message.kind !== 'file') {
      setViewing(message);
      return;
    }
    try {
      const copy = new File(await exportCopy(message.file_uri ?? '', message.text));
      const mimeType = message.file_mime ?? undefined;
      // Ouvre le fichier dans une app adaptée. Sans app pour ce format, on propose de le partager.
      if (await copy.canPreview({ mimeType })) await copy.preview({ title: message.text, mimeType });
      else await Sharing.shareAsync(copy.uri, { mimeType, dialogTitle: message.text });
    } catch (e) {
      Alert.alert('Ouverture impossible', String(e));
    }
  };

  return (
    <Screen edgeToEdgeBottom>
      <View ref={root} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <BlurTargetView ref={blurTarget} style={styles.flex}>
        <Header
          title={name}
          subtitle={subtitle}
          onBack={onBack}
          action={
            <Pressable onPress={onInfo} hitSlop={12} accessibilityLabel="Informations du contact">
              <Info size={24} color={colors.text} strokeWidth={1.75} />
            </Pressable>
          }
        />
        {/* Le décalage compense la barre d'état, placée au-dessus de la zone floutée. */}
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={StatusBar.currentHeight ?? 0} style={styles.flex}>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <MessageCircle size={28} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyText}>Vos messages restent sur vos deux téléphones.</Text>
            </View>
          ) : (
            <FlatList
              inverted
              style={styles.flex}
              data={messages}
              keyExtractor={(message) => message.id}
              renderItem={({ item }) => (
                <Bubble
                  message={item}
                  name={name}
                  hidden={selection?.message.id === item.id}
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
          {attachOpen && (
            <View style={styles.attachMenu}>
              <Pressable onPress={pickMedia} style={styles.attachOption}>
                <Images size={20} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.attachLabel}>Photo ou vidéo</Text>
              </Pressable>
              <Pressable onPress={pickDocument} style={styles.attachOption}>
                <FileText size={20} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.attachLabel}>Fichier</Text>
              </Pressable>
            </View>
          )}
          {(replyingTo || editing) && (
            <View style={styles.composerMode}>
              {editing ? <Pencil size={20} color={colors.text} strokeWidth={1.75} /> : <Reply size={20} color={colors.text} strokeWidth={1.75} />}
              <View style={styles.flex}>
                <Text style={styles.composerModeTitle} numberOfLines={1}>
                  {editing ? 'Modifier le message' : `Répondre à ${replyingTo?.mine === 1 ? 'vous-même' : name}`}
                </Text>
                <Text style={styles.composerModeText} numberOfLines={1}>{describeMessage((editing ?? replyingTo)!)}</Text>
              </View>
              <Pressable onPress={cancelComposerMode} hitSlop={12} accessibilityLabel="Annuler">
                <X size={20} color={colors.text} strokeWidth={1.75} />
              </Pressable>
            </View>
          )}
          <View style={[styles.composer, { paddingBottom: keyboardOpen ? spacing.sm : NAVIGATION_BAR_SPACE }]}>
            <Pressable
              onPress={() => setAttachOpen(!attachOpen)}
              accessibilityLabel="Joindre un fichier"
              style={({ pressed }) => [styles.attach, pressed && styles.pressed]}
            >
              <Paperclip size={20} color={colors.text} strokeWidth={1.75} />
            </Pressable>
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
            <Pressable
              onPress={send}
              disabled={!draft.trim()}
              accessibilityLabel={editing ? 'Enregistrer' : 'Envoyer'}
              style={({ pressed }) => [styles.send, !draft.trim() && styles.sendDisabled, pressed && styles.pressed]}
            >
              {editing ? <Check size={20} color={colors.background} strokeWidth={2} /> : <ArrowUp size={20} color={colors.background} strokeWidth={2} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </BlurTargetView>
      {selection && (
        <MessageSelection
          message={selection.message}
          name={name}
          rect={selection.rect}
          origin={selection.origin}
          blurTarget={blurTarget}
          actions={actionsFor(selection.message)}
          onReact={(emoji) => chat.react(contactKey, selection.message.id, emoji)}
          onClose={closeSelection}
        />
      )}
      {viewing && <MediaViewer message={viewing} onClose={() => setViewing(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
    backgroundColor: colors.text,
    borderBottomRightRadius: 4,
  },
  theirs: {
    backgroundColor: colors.surface,
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
    bottom: NAVIGATION_BAR_SPACE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 56,
  },
  seekArea: {
    flex: 1,
    height: 56,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.onDarkTrack,
    overflow: 'hidden',
  },
  seekBar: {
    height: 4,
    backgroundColor: colors.background,
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
    paddingBottom: NAVIGATION_BAR_SPACE,
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
  attachMenu: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  attachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  attachLabel: {
    fontSize: 16,
    color: colors.text,
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
  sendDisabled: {
    backgroundColor: colors.disabled,
  },
  pressed: {
    opacity: 0.6,
  },
  viewer: {
    flex: 1,
    backgroundColor: colors.text,
    justifyContent: 'center',
  },
  viewerMedia: {
    width: '100%',
    height: '100%',
  },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: spacing.lg,
  },
});
