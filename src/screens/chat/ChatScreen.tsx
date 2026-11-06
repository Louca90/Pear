import { ComponentRef, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { ArrowUp, Check, ChevronUp, Copy, Download, Flame, Lock, MessageCircle, Mic, Paperclip, Pencil, Reply, Trash2, X } from 'lucide-react-native';

import { describeMessage, getContactProfile, getConversationSettings, getMessages, getStreak, Message } from '../../chat/database';
import { exportCopy, formatSize, MAX_FILE_BYTES, saveToGallery, videoThumbnail } from '../../chat/files';
import { chat, MAX_TEXT_LENGTH, PickedFile } from '../../chat/manager';
import { showDialog } from '../../components/dialog';
import { MediaPicker } from '../../components/MediaPicker';
import { Avatar, Header, IconButton, Screen, useNavigationBarHeight } from '../../components/ui';
import { bubblePalette, colors, radius, spacing } from '../../theme';

import { AttachMenu } from './components/AttachMenu';
import { ComposerFade } from './components/ComposerFade';
import { MediaViewer, Viewing } from './components/MediaViewer';
import { Bubble } from './components/MessageBubble';
import { MessageSelection } from './components/MessageSelection';
import { RecordingRow } from './components/RecordingRow';
import { Toast } from './components/Toast';
import { JUMP_PULSE_DELAY_MS, ROUTE, VOICE_CANCEL_DISTANCE, VOICE_LOCK_DISTANCE } from './constants';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { sharedStyles } from './styles';
import { Action, Palettes, Rect, ViewRef } from './types';

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
  onCustomize: () => void;
  // Affichée sous la page pendant le geste de retour : elle ne doit pas marquer les messages comme lus.
  preview?: boolean;
};

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

const localStyles = StyleSheet.create({
  wallpaper: {
    ...StyleSheet.absoluteFill,
  },
  headerBar: {
    backgroundColor: colors.background,
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
  micLayer: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micTrash: {
    backgroundColor: colors.danger,
  },
});

const styles = { ...sharedStyles, ...localStyles };
