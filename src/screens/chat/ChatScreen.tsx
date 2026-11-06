import { ComponentRef, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { Copy, Download, MessageCircle, Pencil, Reply, Trash2 } from 'lucide-react-native';

import { getConversationSettings, getMessages, Message } from '../../chat/database';
import { exportCopy, formatSize, MAX_FILE_BYTES, saveToGallery, videoThumbnail } from '../../chat/files';
import { chat, PickedFile } from '../../chat/manager';
import { showDialog } from '../../components/dialog';
import { MediaPicker } from '../../components/MediaPicker';
import { Screen, useInsets } from '../../components/ui';
import { bubblePalette, colors, spacing } from '../../theme';

import { AttachMenu } from './components/AttachMenu';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ComposerFade } from './components/ComposerFade';
import { MediaViewer, Viewing } from './components/MediaViewer';
import { Bubble } from './components/MessageBubble';
import { MessageSelection } from './components/MessageSelection';
import { NewMessagesButton } from './components/NewMessagesButton';
import { Toast } from './components/Toast';
import { JUMP_PULSE_DELAY_MS, LIKE } from './constants';
import { useChatScroll } from './hooks/useChatScroll';
import { useKeyboardOpen } from './hooks/useKeyboardOpen';
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
  const [attachOpen, setAttachOpen] = useState(false);
  const attachProgress = useRef(new Animated.Value(0)).current;
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; token: number } | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [selection, setSelection] = useState<{ message: Message; rect: Rect; origin: { y: number; height: number }; clip: { top: number; bottom: number } } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const blurTarget = useRef<ViewRef>(null);
  const root = useRef<ViewRef>(null);
  const listArea = useRef<ViewRef>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const list = useRef<FlatList<Message>>(null);
  const [pulsing, setPulsing] = useState<{ id: string; token: number } | null>(null);
  const keyboardOpen = useKeyboardOpen();
  const { top: topInset } = useInsets();
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const messages = getMessages(contactKey);
  const scroll = useChatScroll(list, messages, preview);
  const settings = getConversationSettings(contactKey);
  const palettes: Palettes = {
    mine: bubblePalette(settings.my_bubble ?? colors.text),
    theirs: bubblePalette(settings.their_bubble ?? colors.surface),
    hasWallpaper: settings.wallpaper_uri !== null,
  };

  useEffect(() => {
    if (preview) return;
    chat.setOpenConversation(contactKey);
    return () => chat.setOpenConversation(null);
  }, [contactKey, preview]);

  const closeSelection = useRef(() => setSelection(null)).current;

  const selectMessage = (message: Message, rect: Rect) => {
    Keyboard.dismiss();
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch((e) => console.warn('Pear vibration :', e));
    root.current?.measureInWindow((_x, y, _width, height) =>
      listArea.current?.measureInWindow((_listX, listY, _listWidth, listHeight) =>
        setSelection({ message, rect, origin: { y, height }, clip: { top: listY, bottom: listY + listHeight } }),
      ),
    );
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
      scroll.followSent();
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

  // Déjà liké : le double appui ne retire pas le like (on le retire depuis le menu des réactions).
  const likeMessage = (message: Message) => {
    if (message.my_reaction !== LIKE) chat.react(contactKey, message.id, LIKE);
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
      scroll.followSent();
    } catch (e) {
      showDialog('Envoi impossible', String(e));
    }
  };

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

  // L'image et sa taille sont préparées dès le toucher, pendant la fenêtre du double appui : la
  // visionneuse s'ouvre sans attendre une fois l'appui simple confirmé.
  const prepared = useRef(new Map<string, Promise<{ poster: string; size: { width: number; height: number } }>>()).current;
  const prepareMedia = (message: Message) => {
    if (message.kind !== 'image' && message.kind !== 'video') return null;
    let media = prepared.get(message.id);
    if (!media) {
      const uri = message.file_uri ?? '';
      media = (async () => {
        const poster = message.kind === 'video' ? await videoThumbnail(message.id, uri) : uri;
        return { poster, size: await Image.getSize(poster) };
      })();
      media.catch(() => prepared.delete(message.id));
      prepared.set(message.id, media);
    }
    return media;
  };

  const openFile = async (message: Message, rect: Rect) => {
    if (message.kind !== 'file') {
      // Une photo ou une vidéo s'ouvre dès l'appui, sans attendre : on la like avec un appui long (réactions).
      Keyboard.dismiss();
      try {
        const media = await (prepareMedia(message) ?? Promise.reject(new Error('Média introuvable.')));
        setViewing({ message, rect, ...media });
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
        <ChatHeader contactKey={contactKey} name={name} onBack={onBack} onInfo={onInfo} onCustomize={onCustomize} />
        {/* Le décalage compense la barre d'état, placée au-dessus de la zone floutée. */}
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={topInset} style={styles.flex}>
          <View ref={listArea} collapsable={false} style={styles.flex}>
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
                  onPrepareFile={prepareMedia}
                  onSelect={selectMessage}
                  onDoubleTap={likeMessage}
                  onReply={startReply}
                />
              )}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              {...scroll.listProps}
            />
          )}
          <NewMessagesButton count={scroll.newCount} onPress={scroll.scrollToBottom} />
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
          <Composer
            name={name}
            draft={draft}
            onChangeDraft={setDraft}
            replyingTo={replyingTo}
            editing={editing}
            onCancelMode={cancelComposerMode}
            onSend={send}
            input={input}
            keyboardOpen={keyboardOpen}
            attachOpen={attachOpen}
            attachProgress={attachProgress}
            onToggleAttach={() => setAttachOpen(!attachOpen)}
            onVoiceRecorded={(uri, seconds) => sendPicked({ uri, name: `vocal-${seconds}s.m4a`, size: 0, mime: 'audio/mp4', kind: 'audio' })}
            onVoiceTooShort={() => setToast({ text: 'Maintenez le micro pour enregistrer', token: Date.now() })}
          />
        </KeyboardAvoidingView>
      </BlurTargetView>
      {selection && (
        <MessageSelection
          message={selection.message}
          name={name}
          palettes={palettes}
          rect={selection.rect}
          origin={selection.origin}
          clip={selection.clip}
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
});

const styles = { ...sharedStyles, ...localStyles };
