import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ArrowUp, Check, CheckCheck, FileText, Images, Info, MessageCircle, Paperclip, Play, X } from 'lucide-react-native';

import { Header, Screen } from '../components/ui';
import { getMessages, Message, MessageStatus } from '../chat/database';
import { exportCopy, formatSize, MAX_FILE_BYTES, videoThumbnail } from '../chat/files';
import { chat, MAX_TEXT_LENGTH, PickedFile } from '../chat/manager';
import { RouteType } from '../network/peer';
import { colors, radius, spacing } from '../theme';

// Place de la barre de navigation Android, la plus haute étant celle à 3 boutons.
const NAVIGATION_BAR_SPACE = 48;

const ROUTE: Record<RouteType, string> = {
  host: 'Connecté, sur le même réseau',
  srflx: 'Connecté, direct par internet',
  relay: 'Connecté, par un serveur relais',
};

// 1 coche : pas encore reçu. 2 coches grises : reçu par l'autre. 2 coches blanches : conversation ouverte par l'autre.
function statusIcon(status: MessageStatus) {
  if (status === 'read') return { Icon: CheckCheck, color: colors.background, label: 'Lu' };
  if (status === 'delivered') return { Icon: CheckCheck, color: colors.onDarkMuted, label: 'Reçu' };
  return { Icon: Check, color: colors.onDarkMuted, label: 'Pas encore reçu' };
}

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
};

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

function FileContent({ message, onOpen }: { message: Message; onOpen: () => void }) {
  const mine = message.mine === 1;
  const foreground = mine ? colors.background : colors.text;
  const secondary = mine ? colors.onDarkMuted : colors.textMuted;
  const complete = message.status !== 'receiving';
  const progress = chat.getProgress(message.id);

  return (
    <Pressable onPress={onOpen} disabled={!complete}>
      {message.kind === 'image' && complete ? (
        <Image source={{ uri: message.file_uri ?? undefined }} style={styles.image} resizeMode="cover" />
      ) : message.kind === 'video' && complete ? (
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
        <View style={[styles.progressTrack, { backgroundColor: mine ? colors.onDarkTrack : colors.border }]}>
          <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%`, backgroundColor: foreground }]} />
        </View>
      )}
    </Pressable>
  );
}

function Bubble({ message, onOpenFile }: { message: Message; onOpenFile: (message: Message) => void }) {
  const mine = message.mine === 1;
  const { Icon: StatusIcon, color: statusColor, label: statusLabel } = statusIcon(message.status);
  const foreground = mine ? colors.background : colors.text;
  const secondary = mine ? colors.onDarkMuted : colors.textMuted;
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      {message.kind === 'text' ? (
        <Text style={[styles.text, { color: foreground }]}>{message.text}</Text>
      ) : (
        <FileContent message={message} onOpen={() => onOpenFile(message)} />
      )}
      <View style={styles.meta}>
        <Text style={[styles.time, { color: secondary }]}>{formatTime(message.created_at)}</Text>
        {mine && (
          <StatusIcon
            size={14}
            color={statusColor}
            strokeWidth={1.75}
            accessibilityLabel={statusLabel}
          />
        )}
      </View>
    </View>
  );
}

function VideoViewer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={styles.viewerMedia} contentFit="contain" nativeControls />;
}

function MediaViewer({ message, onClose }: { message: Message; onClose: () => void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
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

export function ChatScreen({ contactKey, name, onBack, onInfo }: Props) {
  const [draft, setDraft] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewing, setViewing] = useState<Message | null>(null);
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

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    chat.send(contactKey, text);
    setDraft('');
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
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
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
            renderItem={({ item }) => <Bubble message={item} onOpenFile={openFile} />}
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
        <View style={[styles.composer, { paddingBottom: keyboardOpen ? spacing.sm : NAVIGATION_BAR_SPACE }]}>
          <Pressable
            onPress={() => setAttachOpen(!attachOpen)}
            accessibilityLabel="Joindre un fichier"
            style={({ pressed }) => [styles.attach, pressed && styles.pressed]}
          >
            <Paperclip size={20} color={colors.text} strokeWidth={1.75} />
          </Pressable>
          <TextInput
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
            accessibilityLabel="Envoyer"
            style={({ pressed }) => [styles.send, !draft.trim() && styles.sendDisabled, pressed && styles.pressed]}
          >
            <ArrowUp size={20} color={colors.background} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.text,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
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
