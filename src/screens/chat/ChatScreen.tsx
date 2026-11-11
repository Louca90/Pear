import { ComponentRef, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, Linking, PermissionsAndroid, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { haptics } from '../../haptics';
import * as Sharing from 'expo-sharing';
import { Copy, Download, Forward, Pencil, Pin, PinOff, Reply, Send, Trash2 } from 'lucide-react-native';

import { getContactProfile, getContactRows, getConversationSettings, getDraft, getMessagePosition, getMessages, getPeerState, getPinnedMessages, isBlocked, Message, setDraft as saveDraft } from '../../chat/database';
import { formatSize, MAX_FILE_BYTES } from '../../chat/files';
import { exportCopy, openMedia, retainOpenedMedia, saveToGallery, useMediaUri, videoThumbnail } from '../../chat/media';
import { ALBUM_MAX, albumAt, GroupPosition, groupPosition } from '../../chat/grouping';
import { chat, PickedFile } from '../../chat/manager';
import { MESSAGE_PAGE_SIZE } from '../../config';
import { showDialog } from '../../components/dialog';
import { ContactPickerSheet } from '../../components/ContactPickerSheet';
import { MediaPicker } from '../../components/MediaPicker';
import { Pear } from '../../components/Pear';
import { Screen, useInsets } from '../../components/ui';
import { bubblePalette, createStyles, motion, radius, spacing, useColors } from '../../theme';

import { ChatHeader } from './components/ChatHeader';
import { ChatSearch } from './components/ChatSearch';
import { DraftPreviewCard } from './components/LinkPreview';
import { StickerSheet } from './components/StickerSheet';
import { useDraftPreview } from '../../chat/linkPreview';
import { isSelf, SELF } from '../../chat/self';
import { EPHEMERAL_CHOICES } from '../../chat/ephemeral';
import { LOCATION_DURATIONS } from '../../chat/location';
import { useEphemeralPull } from './hooks/useEphemeralPull';
import { PullPear, PullView } from '../../components/pull';
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
import { TypingBubble } from './components/TypingBubble';
import { dayLabel, ephemeralLabel, nextVoice } from './format';
import { playSound } from './sounds';
import { JUMP_PULSE_DELAY_MS, LIKE } from './constants';
import { useChatScroll } from './hooks/useChatScroll';
import { useKeyboardOpen } from './hooks/useKeyboardOpen';
import { useChatStyles } from './styles';
import { Action, Palettes, Rect, ViewRef } from './types';
import { dateLocale, t } from '../../i18n';

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
  // Message à rejoindre à l'ouverture (résultat de la recherche de l'accueil).
  jump?: string;
};

export function ChatScreen({ contactKey, name, pending, onBack, onInfo, onCustomize, preview, jump }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [draft, setDraft] = useState(() => getDraft(contactKey));
  const [attachOpen, setAttachOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; token: number } | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [showingReactions, setShowingReactions] = useState<Message | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [searching, setSearching] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [selection, setSelection] = useState<{ message: Message; rect: Rect; origin: { y: number; height: number }; clip: { top: number; bottom: number }; position: GroupPosition; keepOriginal: boolean } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  // Le brouillon est gardé pour la liste des conversations (« Brouillon : … »), sauf pendant la modification d'un message.
  useEffect(() => {
    if (!editing) saveDraft(contactKey, draft);
  }, [contactKey, draft, editing]);
  // Aperçu du lien en cours de saisie (lot 4.3) : pas pendant la modification d'un message.
  const draftPreview = useDraftPreview(draft, !editing);
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

  // Sons (lot 3.4) : seulement pour un message plus récent que tout ce qui était affiché, pas au
  // chargement de la conversation ni en remontant l'historique.
  const newestSounded = useRef<{ contact: string; at: number } | null>(null);
  useEffect(() => {
    const newest = messages[0];
    const previous = newestSounded.current;
    newestSounded.current = { contact: contactKey, at: Math.max(newest?.created_at ?? 0, previous?.contact === contactKey ? previous.at : 0) };
    if (preview || !newest || previous?.contact !== contactKey || newest.created_at <= previous.at) return;
    if (newest.kind === 'system' || newest.kind === 'wallpaper') return;
    if (newest.mine === 1) {
      if (newest.status !== 'scheduled') playSound('sent');
    } else playSound('received');
  }, [messages, contactKey, preview]);

  // Date collante (lot 3.4) : pendant qu'on fait défiler, le jour des messages du haut de l'écran.
  // Effacée 800 ms après l'arrêt du défilement.
  const [stickyDay, setStickyDay] = useState('');
  const stickyOpacity = useRef(new Animated.Value(0)).current;
  const stickyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSticky = (visible: boolean) =>
    Animated.timing(stickyOpacity, { toValue: visible ? 1 : 0, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  const stickyProps = {
    onScrollBeginDrag: () => {
      if (stickyTimer.current) clearTimeout(stickyTimer.current);
      showSticky(true);
    },
    onMomentumScrollBegin: () => {
      if (stickyTimer.current) clearTimeout(stickyTimer.current);
    },
    onScrollEndDrag: () => hideStickyLater(),
    onMomentumScrollEnd: () => hideStickyLater(),
  };
  const hideStickyLater = () => {
    if (stickyTimer.current) clearTimeout(stickyTimer.current);
    stickyTimer.current = setTimeout(() => showSticky(false), STICKY_HIDE_MS);
  };
  useEffect(() => () => {
    if (stickyTimer.current) clearTimeout(stickyTimer.current);
  }, []);
  // Liste inversée : le message le plus haut à l'écran est celui de plus grand index.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index?: number | null; item: Message }[] }) => {
    let top: Message | null = null;
    let topIndex = -1;
    for (const { index, item } of viewableItems) {
      if (index != null && index > topIndex) {
        topIndex = index;
        top = item;
      }
    }
    if (top) setStickyDay(dayLabel(top.created_at, Date.now(), dateLocale()));
  }).current;
  const settings = getConversationSettings(contactKey);
  // Le même objet tant que les couleurs ne changent pas : les bulles ne se redessinent pas pour rien.
  const hasWallpaper = settings.wallpaper_uri !== null;
  const palettes: Palettes = useMemo(
    () => ({
      mine: bubblePalette(settings.my_bubble ?? colors.bubbleMine),
      theirs: bubblePalette(settings.their_bubble ?? colors.bubbleTheirs),
      hasWallpaper,
    }),
    [settings.my_bubble, settings.their_bubble, hasWallpaper, colors],
  );
  // Le fond est chiffré sur le disque (lot 2.3) : affiché depuis sa copie déchiffrée.
  const wallpaper = useMediaUri(settings.wallpaper_uri, { scope: 'app' });

  // Les médias déchiffrés de la conversation sont effacés du cache quand on la quitte.
  useEffect(() => retainOpenedMedia(), []);

  useEffect(() => {
    if (preview) return;
    chat.setOpenConversation(contactKey);
    return () => chat.setOpenConversation(null);
  }, [contactKey, preview]);

  const closeSelection = useRef(() => setSelection(null)).current;

  // Messages éphémères (lot 4.7) : le geste bascule le mode, la pastille de l'en-tête règle la durée.
  const ephemeral = settings.ephemeral;
  const canWrite = !pending && !blockedByMe && peerState === null && !isSelf(contactKey);
  const pull = useEphemeralPull(
    () => canWrite && !preview && !keyboardOpen && chat.atBottom && !selection && !viewing,
    () => chat.toggleEphemeral(contactKey),
  );
  const chooseEphemeral = () =>
    showDialog(t('ephemere.titre'), t('ephemere.aide'), [
      ...EPHEMERAL_CHOICES.map((seconds) => ({ label: ephemeralLabel(seconds), onPress: () => chat.setEphemeral(contactKey, seconds) })),
      { label: t('ephemere.desactiver'), style: 'danger' as const, onPress: () => chat.setEphemeral(contactKey, 0) },
      { label: t('commun.annuler'), style: 'cancel' as const },
    ]);

  const selectMessage = (message: Message, measure: (done: (rect: Rect) => void) => void) => {
    haptics.action();
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
      // L'aperçu part avec le message s'il est prêt ; sinon le lien part seul, sans attendre.
      const preview = draftPreview.current?.preview;
      chat.send(contactKey, text, replyingTo?.id ?? null, false, preview ? { preview } : null);
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
    let index = messages.findIndex((message) => message.id === id);
    // Un média rangé dans un album : c'est la grille (dessinée par le plus récent) qu'on rejoint.
    const album = index >= 0 ? albumAt(messages, index) : null;
    if (album && !album.lead) {
      id = album.members[album.members.length - 1].id;
      index = messages.findIndex((message) => message.id === id);
    }
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

  // Ouverte depuis un résultat de recherche : on rejoint le message une fois la liste en place.
  const jumped = useRef(false);
  useEffect(() => {
    if (!jump || jumped.current || preview) return;
    jumped.current = true;
    const timer = setTimeout(() => jumpTo(jump), JUMP_PULSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [jump, preview]);

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
      haptics.select();
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

  // Un média à vue unique ne se copie, ne se transfère, ne s'enregistre ni ne s'épingle.
  const onceActions = (message: Message): Action[] => [
    { label: t('chat.repondre'), icon: Reply, onPress: () => startReply(message) },
    { label: t('commun.supprimer'), icon: Trash2, danger: true, onPress: () => confirmDelete(message) },
  ];

  const actionsFor = (message: Message): Action[] => message.status === 'scheduled' ? scheduledActions(message) : message.view_once ? onceActions(message) : [
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

  // Plusieurs photos ou vidéos choisies ensemble partent en album (lot 4.5), par paquets de 10.
  const sendFromGallery = async (files: PickedFile[]) => {
    setGalleryOpen(false);
    const isMedia = (file: PickedFile) => (file.kind === 'image' || file.kind === 'video') && !file.once;
    const grouped = files.filter(isMedia).length >= 2;
    let album = '';
    let inAlbum = 0;
    for (const file of files) {
      if (!grouped || !isMedia(file)) {
        await sendPicked(file);
        continue;
      }
      if (inAlbum % ALBUM_MAX === 0) album = chat.newAlbumId();
      inAlbum += 1;
      await sendPicked({ ...file, album });
    }
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

  // Position en direct (lot 4.8) : la durée, puis l'autorisation de position (approximative), puis le partage.
  const shareLocation = () => {
    setAttachOpen(false);
    const start = async (seconds: number) => {
      try {
        const granted = (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)) === PermissionsAndroid.RESULTS.GRANTED;
        if (!granted) {
          showDialog(t('position.refusee'), t('position.refuseeAide'), [
            { label: t('commun.ouvrirReglages'), onPress: () => Linking.openSettings() },
            { label: t('commun.annuler'), style: 'cancel' },
          ]);
          return;
        }
        if (chat.startLocation(contactKey, seconds)) scroll.followSent();
        else showDialog(t('position.indisponible'), t('position.indisponibleAide'));
      } catch (e) {
        showDialog(t('position.indisponible'), String(e));
      }
    };
    const labels = [t('position.min15'), t('position.h1'), t('position.h8')];
    showDialog(t('position.partager'), t('position.aide'), [
      ...LOCATION_DURATIONS.map((seconds, index) => ({ label: labels[index], onPress: () => void start(seconds) })),
      { label: t('commun.annuler'), style: 'cancel' as const },
    ]);
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
        const poster = message.kind === 'video' ? await videoThumbnail(message.id, uri) : await openMedia(uri, { mime: message.file_mime });
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
      // Vue unique : seul le destinataire l'ouvre, et une seule fois.
      if (message.view_once && (message.mine === 1 || message.view_once !== 1)) return;
      try {
        const media = await (prepareMedia(message) ?? Promise.reject(new Error(t('chat.mediaIntrouvable'))));
        // La copie déchiffrée peut être effacée (arrière-plan) : elle sera refaite à la prochaine ouverture.
        prepared.delete(message.id);
        // Elle compte comme vue dès qu'elle s'affiche ; le fichier part à la fermeture de la visionneuse.
        if (message.view_once) chat.openOnce(contactKey, message.id);
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

  // Les actions passées aux bulles gardent la même identité d'un rendu à l'autre (elles appellent
  // toujours la version la plus récente) : une bulle dont le message n'a pas changé n'est pas redessinée.
  const latestActions = useRef({ openFile, prepareMedia, selectMessage, likeMessage, startReply, jumpTo });
  latestActions.current = { openFile, prepareMedia, selectMessage, likeMessage, startReply, jumpTo };
  const bubbleActions = useRef({
    onJump: (id: string) => latestActions.current.jumpTo(id),
    onOpenFile: (message: Message, rect: Rect) => void latestActions.current.openFile(message, rect),
    onPrepareFile: (message: Message) => latestActions.current.prepareMedia(message),
    onAcceptFile: (message: Message) => chat.acceptFile(message.contact, message.id),
    onRefuseFile: (message: Message) => chat.refuseFile(message.contact, message.id),
    onSelect: (message: Message, measure: (done: (rect: Rect) => void) => void) => latestActions.current.selectMessage(message, measure),
    onDoubleTap: (message: Message) => latestActions.current.likeMessage(message),
    onReply: (message: Message) => latestActions.current.startReply(message),
    onShowReactions: (message: Message) => setShowingReactions(message),
  }).current;

  return (
    <Screen edgeToEdgeBottom>
      <View ref={root} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <BlurTargetView ref={blurTarget} style={styles.flex}>
        {wallpaper && <Image source={{ uri: wallpaper }} style={styles.wallpaper} resizeMode="cover" />}
        <ChatHeader contactKey={contactKey} name={name} onBack={onBack} onInfo={onInfo} onCustomize={onCustomize} onSearch={() => setSearching(true)} ephemeral={ephemeral} onEphemeral={chooseEphemeral} />
        {/* Le décalage compense la barre d'état, placée au-dessus de la zone floutée. */}
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={topInset} style={styles.flex}>
          <View ref={listArea} collapsable={false} style={styles.flex}>
          {palettes.hasWallpaper && <ComposerFade />}
          <PinnedBanner messages={pinnedMessages} onJump={jumpTo} />
          <PullView gesture={pull.gesture} offset={pull.offset} indicator={canWrite ? <PullPear offset={pull.offset} dir={-1} kind="ripening" label={(full) => t(full ? (ephemeral ? 'ephemere.relacherCouper' : 'ephemere.relacherActiver') : 'ephemere.tirer')} /> : null}>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Pear height={56} color={colors.textMuted} state="resting" />
              <Text style={styles.emptyText}>{isSelf(contactKey) ? t('notes.vide') : t('chat.vide')}</Text>
            </View>
          ) : (
            <View style={styles.flex}>
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
              renderItem={({ item, index }) => {
                const album = albumAt(messages, index);
                return (
                <Bubble
                  message={item}
                  album={album}
                  viewingId={viewing?.message.id}
                  position={groupPosition(messages, index)}
                  avatar={contactPhoto}
                  name={name}
                  palettes={palettes}
                  pulse={pulsing?.id === item.id ? pulsing.token : undefined}
                  hidden={!!selection && !selection.keepOriginal && (selection.message.id === item.id || !!album?.members.some(({ id }) => id === selection.message.id))}
                  mediaHidden={viewing?.message.id === item.id}
                  {...bubbleActions}
                  nextVoice={nextVoice(messages, index)}
                />
                );
              }}
              // Liste inversée : l'en-tête est en bas, juste sous le dernier message.
              ListHeaderComponent={<TypingBubble typing={!preview && chat.isTyping(contactKey)} palette={palettes.theirs} avatar={contactPhoto} />}
              onViewableItemsChanged={onViewableItemsChanged}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              {...scroll.listProps}
              {...stickyProps}
              onEndReached={loadOlder}
              onEndReachedThreshold={0.6}
              showsVerticalScrollIndicator
              // Seules les bulles proches de l'écran sont dessinées.
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              windowSize={11}
            />
            {stickyDay !== '' && (
              <Animated.View pointerEvents="none" style={[styles.sticky, { opacity: stickyOpacity }]}>
                <Text style={styles.stickyText}>{stickyDay}</Text>
              </Animated.View>
            )}
            </View>
          )}
          </PullView>
          <NewMessagesButton count={scroll.newCount} onPress={scroll.scrollToBottom} />
          {/* Menu des pièces jointes ouvert : un appui dans la conversation le referme seulement. */}
          {attachOpen && <Pressable style={StyleSheet.absoluteFill} onPress={() => setAttachOpen(false)} accessibilityLabel={t('commun.fermer')} />}
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
              contacts={[
                ...getContactRows()
                  .filter((row) => !isBlocked(row.public_key))
                  .map((row) => ({ publicKey: row.public_key, name: row.name, ...(row.state === 'pending' ? { pending: true } : {}) })),
                // Garder un message pour soi : il se transfère aussi vers ses notes.
                ...(isSelf(contactKey) ? [] : [{ publicKey: SELF, name: t('notes.titre') }]),
              ]}
              onClose={() => setForwarding(null)}
              onSend={(keys) => {
                chat
                  .forward(forwarding, keys)
                  .then(() => setToast({ text: keys.length > 1 ? t('transfert.envoyesN', { n: keys.length }) : t('transfert.envoye'), token: Date.now() }))
                  .catch((e) => showDialog(t('chat.envoiImpossible'), String(e)));
              }}
            />
          )}
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
            <>
            {draftPreview.current && <DraftPreviewCard key={draftPreview.current.url} draft={draftPreview.current} onDismiss={draftPreview.dismiss} />}
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
              onToggleAttach={() => setAttachOpen(!attachOpen)}
              onCloseAttach={() => setAttachOpen(false)}
              onPhotos={() => {
                setAttachOpen(false);
                setGalleryOpen(true);
              }}
              onFile={pickDocument}
              onLocation={isSelf(contactKey) ? undefined : shareLocation}
              onStickers={() => {
                setAttachOpen(false);
                setStickersOpen(true);
              }}
              onVoiceRecorded={(uri, seconds, wave) => sendPicked({ uri, name: `vocal-${seconds}s.m4a`, size: 0, mime: 'audio/mp4', kind: 'audio', ...(wave ? { meta: { wave } } : {}) })}
              onVoiceTooShort={() => setToast({ text: t('chat.maintenirMicro'), token: Date.now() })}
            />
            </>
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
      {viewing && (
        <MediaViewer
          viewing={viewing}
          onClose={() => {
            // Vue unique : refermée, elle est effacée de ce téléphone.
            if (viewing.message.view_once) chat.closeOnce(contactKey, viewing.message.id);
            setViewing(null);
          }}
        />
      )}
      {stickersOpen && (
        <StickerSheet
          onClose={() => setStickersOpen(false)}
          // Envoyé comme une image : le fichier du sticker reste sur le téléphone (copié, jamais déplacé).
          onSend={(sticker) => sendPicked({ uri: sticker.uri, name: 'sticker.png', size: 0, mime: 'image/png', kind: 'image', keepSource: true, meta: { sticker: true } })}
        />
      )}
      {searching && <ChatSearch contactKey={contactKey} name={name} onClose={() => setSearching(false)} onPick={jumpTo} />}
      {galleryOpen && <MediaPicker onPick={sendFromGallery} onClose={() => setGalleryOpen(false)} allowOnce={!isSelf(contactKey)} />}
    </Screen>
  );
}

const STICKY_HIDE_MS = 800;

const useLocalStyles = createStyles((colors) => ({
  sticky: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stickyText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
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
