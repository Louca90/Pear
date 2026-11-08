import { ComponentRef, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { Copy, Download, Forward, MessageCircle, Pencil, Pin, PinOff, Reply, Send, Trash2 } from 'lucide-react-native';

import { getContactProfile, getContactRows, getConversationSettings, getMessagePosition, getMessages, getPeerState, getPinnedMessages, isBlocked, Message } from '../../chat/database';
import { exportCopy, formatSize, MAX_FILE_BYTES, saveToGallery, videoThumbnail } from '../../chat/files';
import { GroupPosition, groupPosition } from '../../chat/grouping';
import { chat, PickedFile } from '../../chat/manager';
import { MESSAGE_PAGE_SIZE } from '../../config';
import { showDialog } from '../../components/dialog';
import { ContactPickerSheet } from '../../components/ContactPickerSheet';
import { MediaPicker } from '../../components/MediaPicker';
import { Screen, useInsets } from '../../components/ui';
import { bubblePalette, createStyles, radius, spacing, useColors } from '../../theme';

import { AttachMenu } from './components/AttachMenu';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ComposerFade } from './components/ComposerFade';
import { MediaViewer, Viewing } from './components/MediaViewer';
import { Bubble, markMessagesShown } from './components/MessageBubble';
import { MessageSelection, metaRoomFor, selectionLayout } from './components/MessageSelection';
import { NewMessagesButton } from './components/NewMessagesButton';
import { PinnedBanner } from './components/PinnedBanner';
import { ReactionsSheet } from './components/ReactionsSheet';
import { ScheduleSheet, scheduleLabel } from './components/ScheduleSheet';
import { Toast } from './components/Toast';
import { JUMP_PULSE_DELAY_MS, LIKE } from './constants';
import { useChatScroll } from './hooks/useChatScroll';
import { useKeyboardOpen } from './hooks/useKeyboardOpen';
import { useChatStyles } from './styles';
import { Action, Palettes, Rect, ViewRef } from './types';
import { log } from '../../log';
import { t } from '../../i18n';

type Props = {
  contactKey: string;
  name: string;
  // Notre demande d'ajout n'est pas encore acceptée : on ne peut pas encore écrire.
  pending: boolean;
  onBack: () => void;
  onInfo: () => void;
  onCustomize: () => void;
  // Affichée sous la page pendant le geste de retour : elle ne doit pas marquer les messages comme lus.
  preview?: boolean;
};

export function ChatScreen({ contactKey, name, pending, onBack, onInfo, onCustomize, preview }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const attachProgress = useRef(new Animated.Value(0)).current;
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; token: number } | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [showingReactions, setShowingReactions] = useState<Message | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [selection, setSelection] = useState<{ message: Message; rect: Rect; origin: { y: number; height: number }; clip: { top: number; bottom: number }; position: GroupPosition; keepOriginal: boolean } | null>(null);
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
  const version = useSyncExternalStore(chat.subscribe, chat.getVersion);
  // Pas de saisie si l'on ne peut pas écrire : demande pas encore acceptée, contact qui nous a supprimé
  // ou bloqué, ou contact que l'on a bloqué.
  const blockedByMe = isBlocked(contactKey);
  const peerState = getPeerState(contactKey);
  const notice = pending
    ? { title: t('demandes.enAttente'), text: t('demandes.enAttenteAide', { nom: name }) }
    : peerState === 'removed'
      ? { title: t('statut.supprimeTitre', { nom: name }), text: t('statut.supprimeTexte') }
      : peerState === 'blocked'
        ? { title: t('statut.bloqueTitre', { nom: name }), text: t('statut.bloqueTexte') }
        : null;

  // Relu seulement quand le moteur signale un changement, pas à chaque rafraîchissement de l'écran.
  // Pagination : 40 messages à l'ouverture, 40 de plus à chaque approche du haut.
  const [limit, setLimit] = useState(MESSAGE_PAGE_SIZE);
  const messages = useMemo(() => getMessages(contactKey, limit), [contactKey, version, limit]);
  const loadOlder = () => {
    if (messages.length >= limit) setLimit((value) => value + MESSAGE_PAGE_SIZE);
  };
  // Un message à rejoindre qui n'était pas encore chargé : on charge jusqu'à lui, puis on y va.
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const pinnedMessages = useMemo(() => getPinnedMessages(contactKey), [contactKey, version]);
  const contactPhoto = useMemo(() => getContactProfile(contactKey).photo_uri, [contactKey, version]);
  // À l'ouverture, les messages déjà là ne font pas d'entrée ; seuls les suivants apparaissent en douceur.
  const openedWith = useRef<string | null>(null);
  // Les plus anciens chargés en remontant non plus : seuls les messages plus récents que le dernier
  // déjà affiché (envoyés ou reçus maintenant) font leur entrée.
  const newestShown = useRef(0);
  if (openedWith.current !== contactKey) {
    openedWith.current = contactKey;
    markMessagesShown(messages.map(({ id }) => id));
  } else {
    markMessagesShown(messages.filter(({ created_at }) => created_at <= newestShown.current).map(({ id }) => id));
  }
  newestShown.current = Math.max(newestShown.current, messages[0]?.created_at ?? 0);
  const scroll = useChatScroll(list, messages, preview);
  const settings = getConversationSettings(contactKey);
  const palettes: Palettes = {
    mine: bubblePalette(settings.my_bubble ?? colors.bubbleMine),
    theirs: bubblePalette(settings.their_bubble ?? colors.bubbleTheirs),
    hasWallpaper: settings.wallpaper_uri !== null,
  };

  useEffect(() => {
    if (preview) return;
    chat.setOpenConversation(contactKey);
    return () => chat.setOpenConversation(null);
  }, [contactKey, preview]);

  const closeSelection = useRef(() => setSelection(null)).current;

  const selectMessage = (message: Message, measure: (done: (rect: Rect) => void) => void) => {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch((e) => log.warn('vibration', e));
    const open = () =>
      measure((rect) =>
        root.current?.measureInWindow((_x, y, _width, height) =>
          listArea.current?.measureInWindow((_listX, listY, _listWidth, listHeight) =>
            {
              const position = groupPosition(messages, Math.max(0, messages.findIndex(({ id }) => id === message.id)));
              const clip = { top: listY, bottom: listY + listHeight };
              const origin = { y, height };
              const { tooLong } = selectionLayout(rect, origin, clip, actionsFor(message).length, metaRoomFor(position));
              setSelection({ message, rect, origin, clip, position, keepOriginal: tooLong });
            },
          ),
        ),
      );
    // Clavier ouvert : il reste ouvert, la sélection s'ouvre tout de suite au-dessus de lui (sans
    // attendre qu'il se ferme, ce qui faisait sauter la conversation).
    open();
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
    chat.sendTyping(contactKey, false);
  };

  const confirmDelete = (message: Message) => {
    const forMe = { label: t('chat.pourMoi'), style: 'danger' as const, onPress: () => chat.deleteForMe(contactKey, message.id) };
    const cancel = { label: t('commun.annuler'), style: 'cancel' as const };
    if (message.mine === 1) {
      showDialog(t('chat.supprimerQuestion'), undefined, [
        { label: t('chat.pourToutLeMonde'), style: 'danger', onPress: () => chat.deleteForEveryone(contactKey, message.id) },
        forMe,
        cancel,
      ]);
    } else {
      showDialog(t('chat.supprimerPourVous'), undefined, [{ ...forMe, label: t('commun.supprimer') }, cancel]);
    }
  };

  // Remonte jusqu'au message cité, puis le fait grossir un instant pour le repérer.
  const jumpTo = (id: string) => {
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) {
      const position = getMessagePosition(contactKey, id);
      if (position < 0) {
        showDialog(t('chat.tropAncien'), t('chat.tropAncienAide'));
        return;
      }
      setLimit(position + MESSAGE_PAGE_SIZE);
      setPendingJump(id);
      return;
    }
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setTimeout(() => setPulsing({ id, token: Date.now() }), JUMP_PULSE_DELAY_MS);
  };

  // Déjà liké : le double appui ne retire pas le like (on le retire depuis le menu des réactions).
  useEffect(() => {
    if (!pendingJump || !messages.some(({ id }) => id === pendingJump)) return;
    setPendingJump(null);
    requestAnimationFrame(() => jumpTo(pendingJump));
  }, [pendingJump, messages]);

  // Double appui : met le cœur, ou l'enlève s'il y est déjà.
  const likeMessage = (message: Message) => chat.react(contactKey, message.id, LIKE);

  const startReply = (message: Message) => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(message);
    input.current?.focus();
  };

  const saveMedia = async (message: Message) => {
    try {
      await saveToGallery(message.file_uri ?? '', message.text);
      Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
      setToast({ text: t('chat.enregistreTelephone'), token: Date.now() });
      if (message.kind === 'image' || message.kind === 'video') chat.markSaved(contactKey, message.id, message.kind);
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  const schedule = (time: number) => {
    const text = draft.trim();
    if (!text) return;
    chat.schedule(contactKey, text, time, replyingTo?.id ?? null);
    setReplyingTo(null);
    setDraft('');
    chat.sendTyping(contactKey, false);
    setToast({ text: t('programme.programmeToast', { quand: scheduleLabel(time) }), token: Date.now() });
  };

  // Un message programmé n'est pas encore parti : l'envoyer tout de suite, le copier ou l'annuler.
  const scheduledActions = (message: Message): Action[] => [
    { label: t('programme.envoyerMaintenant'), icon: Send, onPress: () => chat.sendScheduledNow(contactKey, message.id) },
    { label: t('chat.copier'), icon: Copy, onPress: () => Clipboard.setStringAsync(message.text) },
    { label: t('programme.annuler'), icon: Trash2, danger: true, onPress: () => chat.deleteForMe(contactKey, message.id) },
  ];

  const actionsFor = (message: Message): Action[] => message.status === 'scheduled' ? scheduledActions(message) : [
    { label: t('chat.repondre'), icon: Reply, onPress: () => startReply(message) },
    ...(message.kind === 'text'
      ? [{ label: t('chat.copier'), icon: Copy, onPress: () => Clipboard.setStringAsync(message.text) }]
      : []),
    ...(message.kind === 'text' && message.mine === 1
      ? [
          {
            label: t('chat.modifier'),
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
      ? [{ label: t('commun.enregistrer'), icon: Download, onPress: () => saveMedia(message) }]
      : []),
    ...(message.kind !== 'text' && (!message.file_uri || message.status === 'offered' || message.status === 'receiving')
      ? []
      : [{ label: t('transfert.transferer'), icon: Forward, onPress: () => setForwarding(message) }]),
    message.pinned
      ? { label: t('chat.desepingler'), icon: PinOff, onPress: () => chat.pin(contactKey, message.id, false) }
      : { label: t('chat.epingler'), icon: Pin, onPress: () => chat.pin(contactKey, message.id, true) },
    { label: t('commun.supprimer'), icon: Trash2, danger: true, onPress: () => confirmDelete(message) },
  ];

  const cancelComposerMode = () => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(null);
  };

  const sendPicked = async (file: PickedFile) => {
    if (file.size > MAX_FILE_BYTES) {
      showDialog(t('chat.fichierTropLourd'), t('chat.limite', { taille: formatSize(MAX_FILE_BYTES) }));
      return;
    }
    try {
      await chat.sendFile(contactKey, file);
      scroll.followSent();
    } catch (e) {
      showDialog(t('chat.envoiImpossible'), String(e));
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
        showDialog(t('chat.ouvertureImpossible'), String(e));
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
      showDialog(t('chat.ouvertureImpossible'), String(e));
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
          <PinnedBanner messages={pinnedMessages} onJump={jumpTo} />
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <MessageCircle size={28} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyText}>{t('chat.vide')}</Text>
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
              renderItem={({ item, index }) => (
                <Bubble
                  message={item}
                  position={groupPosition(messages, index)}
                  avatar={contactPhoto}
                  name={name}
                  palettes={palettes}
                  pulse={pulsing?.id === item.id ? pulsing.token : undefined}
                  onJump={jumpTo}
                  hidden={selection?.message.id === item.id && !selection.keepOriginal}
                  mediaHidden={viewing?.message.id === item.id}
                  onOpenFile={openFile}
                  onPrepareFile={prepareMedia}
                  onAcceptFile={(message) => chat.acceptFile(contactKey, message.id)}
                  onRefuseFile={(message) => chat.refuseFile(contactKey, message.id)}
                  onSelect={selectMessage}
                  onDoubleTap={likeMessage}
                  onReply={startReply}
                  onShowReactions={setShowingReactions}
                />
              )}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              {...scroll.listProps}
              onEndReached={loadOlder}
              onEndReachedThreshold={0.6}
              showsVerticalScrollIndicator
              // Seules les bulles proches de l'écran sont dessinées.
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              windowSize={11}
            />
          )}
          <NewMessagesButton count={scroll.newCount} onPress={scroll.scrollToBottom} />
          {toast && <Toast text={toast.text} token={toast.token} />}
          {scheduling && <ScheduleSheet onSchedule={schedule} onClose={() => setScheduling(false)} />}
          {showingReactions && (
            <ReactionsSheet
              message={messages.find(({ id }) => id === showingReactions.id) ?? showingReactions}
              name={name}
              avatar={contactPhoto}
              onClose={() => setShowingReactions(null)}
            />
          )}
          {forwarding && (
            <ContactPickerSheet
              title={t('transfert.titre')}
              contacts={getContactRows()
                .filter((row) => !isBlocked(row.public_key))
                .map((row) => ({ publicKey: row.public_key, name: row.name, ...(row.state === 'pending' ? { pending: true } : {}) }))}
              onClose={() => setForwarding(null)}
              onSend={(keys) => {
                chat
                  .forward(forwarding, keys)
                  .then(() => setToast({ text: keys.length > 1 ? t('transfert.envoyesN', { n: keys.length }) : t('transfert.envoye'), token: Date.now() }))
                  .catch((e) => showDialog(t('chat.envoiImpossible'), String(e)));
              }}
            />
          )}
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
          {blockedByMe ? (
            <View style={styles.pendingBar}>
              <Text style={styles.pendingTitle}>{t('statut.vousAvezBloque')}</Text>
              <Pressable onPress={() => chat.unblockContact(contactKey)} style={({ pressed }) => [styles.unblock, pressed && styles.pressed]}>
                <Text style={styles.unblockLabel}>{t('reglages.debloquer')}</Text>
              </Pressable>
            </View>
          ) : notice ? (
            <View style={styles.pendingBar}>
              <Text style={styles.pendingTitle}>{notice.title}</Text>
              <Text style={styles.pendingText}>{notice.text}</Text>
            </View>
          ) : (
            <Composer
              name={name}
              draft={draft}
              onChangeDraft={(text) => {
                setDraft(text);
                chat.sendTyping(contactKey, text.trim().length > 0);
              }}
              replyingTo={replyingTo}
              editing={editing}
              onCancelMode={cancelComposerMode}
              onJump={jumpTo}
              onSend={send}
              onSchedule={() => draft.trim() && setScheduling(true)}
              input={input}
              keyboardOpen={keyboardOpen}
              attachOpen={attachOpen}
              attachProgress={attachProgress}
              onToggleAttach={() => setAttachOpen(!attachOpen)}
              onVoiceRecorded={(uri, seconds) => sendPicked({ uri, name: `vocal-${seconds}s.m4a`, size: 0, mime: 'audio/mp4', kind: 'audio' })}
              onVoiceTooShort={() => setToast({ text: t('chat.maintenirMicro'), token: Date.now() })}
            />
          )}
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
          position={selection.position}
          avatar={contactPhoto}
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

const useLocalStyles = createStyles((colors) => ({
  pendingBar: {
    gap: 2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
  },
  pendingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  pendingText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  unblock: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  unblockLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onAccent,
  },
  pressed: {
    opacity: 0.6,
  },
  wallpaper: {
    ...StyleSheet.absoluteFill,
    // S'arrête derrière la saisie (opaque) : collé au bord, l'arrondi des tailles laissait voir une ligne
    // du fond d'écran sous la barre de navigation.
    bottom: spacing.lg,
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
  // L'espace entre les bulles vient de leur groupe (2 px dans un groupe, 10 px entre deux).
  list: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
