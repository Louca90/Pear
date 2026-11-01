import { AppState } from 'react-native';
import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import { File, FileHandle, FileMode, Paths } from 'expo-file-system';
import { addNetworkStateListener, getNetworkStateAsync, NetworkState } from 'expo-network';
import { from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { openBytes, sealBytes } from '../crypto/box';
import { deriveSharedSecret, Identity } from '../crypto/pairing';
import { createRatchet, ratchetDecrypt, ratchetEncrypt } from '../crypto/ratchet';
import { PeerLink, PeerStatus, RouteType } from '../network/peer';
import { wakeContact } from '../network/wake';
import { Contact, loadRatchet, saveRatchet } from '../storage';
import {
  addMessage,
  addOutboxEvent,
  deleteMessage,
  deleteOldAvatars,
  describeMessage,
  editMessage,
  finishIncomingFile,
  getContactProfile,
  getContactToken,
  getMessage,
  getOutboxEvents,
  getPendingReadReceipts,
  getSetting,
  getUndelivered,
  markConversationRead,
  Message,
  MessageKind,
  removeOutboxEvent,
  setContactProfileField,
  setContactToken,
  setConversationSetting,
  setFileKey,
  setReaction,
  setReadReceiptSent,
  setSetting,
  setStatus,
} from './database';
import { CHUNK_BYTES, deleteStoredFile, exportCopy, isValidFileId, MAX_FILE_BYTES, storedFile, storeOutgoingFile } from './files';
import { clearMessageNotification, showMessageNotification } from './notifications';

export const MAX_TEXT_LENGTH = 2000;
// Evite d'afficher "hors ligne" pendant une micro-coupure, par exemple en passant du Wi-Fi à la 5G.
const OFFLINE_DELAY_MS = 1000;
// Android pénalise les pushs trop fréquents : on réveille un même contact au plus une fois par minute.
const WAKE_INTERVAL_MS = 60000;
const WAKE_CHECK_MS = 15000;
// Un morceau de fichier : l'id du fichier (16 octets), puis son numéro (4 octets) et ses données, chiffrés.
const FILE_ID_BYTES = 16;
const CHUNK_INDEX_BYTES = 4;
const FILE_KEY_BYTES = 32;
const PROGRESS_NOTIFY_MS = 500;
// Le disque est sollicité par paquets : un accès par morceau de 14 Ko ralentirait tout le transfert.
const DISK_BATCH_BYTES = 32 * CHUNK_BYTES;
// Contrôle de flux : l'envoyeur ne prend pas plus d'avance que ça sur ce que le receveur a écrit.
// Sans ça, le receveur est débordé : il ne répond plus aux battements de coeur et paraît hors ligne.
const SEND_WINDOW_CHUNKS = 128;
const WINDOW_POLL_MS = 10;
// Une réaction reste courte : un emoji peut compter plusieurs caractères, pas plus.
const MAX_SAVED_ID_LENGTH = 64;
const MAX_REACTION_LENGTH = 16;
export const MAX_PROFILE_NAME_LENGTH = 40;
const PROFILE_NAME = 'profile_name';
const PROFILE_PHOTO = 'profile_photo';
// Change à chaque modification du profil : un contact qui n'a pas la dernière version la recevra.
const PROFILE_VERSION = 'profile_version';

type Link = {
  peer: PeerLink;
  status: PeerStatus;
  route: RouteType | null;
  secret: Uint8Array;
};

type IncomingFile = {
  contact: string;
  key: Uint8Array;
  handle: FileHandle;
  size: number;
  next: number;
  received: number;
  // Morceaux reçus, pas encore écrits sur le disque.
  pending: Uint8Array[];
  pendingBytes: number;
};

export type PickedFile = {
  uri: string;
  name: string;
  size: number;
  mime: string | null;
  kind: MessageKind;
};

const fileContext = (id: string) => `pear-file-v2.${id}`;

// Garde une connexion par contact tant que l'app est ouverte, et prévient les écrans à chaque changement.
class ChatManager {
  private identity: Identity | null = null;
  private links = new Map<string, Link>();
  private names = new Map<string, string>();
  private lastWake = new Map<string, number>();
  private wakeTimer?: ReturnType<typeof setInterval>;
  private version = 0;
  private listeners = new Set<() => void>();
  private online = true;
  private offlineTimer?: ReturnType<typeof setTimeout>;
  private watching = false;
  private myToken: string | null = null;
  private openConversation: string | null = null;
  private lastActivity = 0;
  private sendingFiles = new Set<string>();
  // Pour chaque fichier en cours d'envoi, le nombre de morceaux que le receveur a confirmé.
  private confirmedChunks = new Map<string, number>();
  private incomingFiles = new Map<string, IncomingFile>();
  private progress = new Map<string, number>();
  private lastProgressNotify = 0;
  // Les écritures sur le disque se font une par une, dans l'ordre d'arrivée des morceaux.
  private writeQueue: Promise<void> = Promise.resolve();

  subscribe =(listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private notify() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  // Ouvre les connexions des nouveaux contacts et ferme celles des contacts supprimés.
  sync(identity: Identity, contacts: Contact[]) {
    this.identity = identity;
    this.watch();
    this.lastActivity = Date.now();
    this.names = new Map(contacts.map((contact) => [contact.publicKey, contact.name]));
    for (const [key, link] of this.links) {
      if (!this.names.has(key)) {
        link.peer.stop();
        this.links.delete(key);
      }
    }
    for (const key of this.names.keys()) {
      if (!this.links.has(key)) this.connect(identity, key);
    }
    if (!this.wakeTimer) {
      this.wakeTimer = setInterval(() => this.links.forEach((_, contact) => this.wakeIfNeeded(contact)), WAKE_CHECK_MS);
    }
    this.markOpenConversationRead();
    this.names.forEach((_, contact) => this.shareProfile(contact));
    this.notify();
  }

  stopAll() {
    clearInterval(this.wakeTimer);
    this.wakeTimer = undefined;
    this.links.forEach((link) => link.peer.stop());
    this.links.clear();
    this.closeIncomingFiles();
    this.notify();
  }

  // Entre 0 et 1 pendant un transfert, undefined sinon.
  getProgress(id: string) {
    return this.progress.get(id);
  }

  retryAll() {
    this.links.forEach((link) => link.peer.retryNow());
  }

  // Vrai quand un contact est connecté et que plus rien n'a bougé depuis un moment.
  isIdleSince(ms: number) {
    const connected = [...this.links.values()].some((link) => link.status === 'connected');
    return connected && Date.now() - this.lastActivity > ms;
  }

  getLink(contact: string): { status: PeerStatus; route: RouteType | null } {
    return this.links.get(contact) ?? { status: 'searching', route: null };
  }

  isOnline() {
    return this.online;
  }

  // La conversation affichée à l'écran : ses messages comptent comme lus.
  setOpenConversation(contact: string | null) {
    this.openConversation = contact;
    this.markOpenConversationRead();
    this.notify();
  }

  send(contact: string, text: string, replyTo: string | null = null) {
    addMessage({
      id: to_base64(randombytes_buf(16)),
      contact,
      mine: 1,
      text,
      status: 'sending',
      created_at: Date.now(),
      reply_to: replyTo,
    });
    this.flush(contact);
    this.wakeIfNeeded(contact);
    this.notify();
  }

  edit(contact: string, id: string, text: string) {
    editMessage(id, contact, 1, text);
    this.sendEvent(contact, { action: 'edit', id, text });
  }

  // Une seule réaction par personne : la même une deuxième fois l'enlève.
  react(contact: string, id: string, emoji: string) {
    const next = getMessage(id, contact)?.my_reaction === emoji ? null : emoji;
    setReaction(id, contact, 'my_reaction', next);
    this.sendEvent(contact, { action: 'react', id, emoji: next });
  }

  deleteForEveryone(contact: string, id: string) {
    deleteMessage(id, contact, 1);
    this.sendEvent(contact, { action: 'delete', id });
  }

  deleteForMe(contact: string, id: string) {
    this.dropIncomingFile(contact, id);
    deleteMessage(id, contact);
    this.notify();
  }

  private sendEvent(contact: string, event: object) {
    addOutboxEvent(to_base64(randombytes_buf(16)), contact, JSON.stringify(event));
    this.flush(contact);
    this.wakeIfNeeded(contact);
    this.notify();
  }

  private dropIncomingFile(contact: string, id: string) {
    const incoming = this.incomingFiles.get(id);
    if (incoming?.contact !== contact) return;
    this.incomingFiles.delete(id);
    this.progress.delete(id);
    this.writeQueue = this.writeQueue.then(() => incoming.handle.close()).catch((e) => console.warn('Pear écriture du fichier :', e));
  }

  // Prévient les écrans après un réglage enregistré.
  refresh() {
    this.notify();
  }

  // Le fond est transmis comme un fichier : l'autre téléphone l'applique quand il l'a reçu en entier.
  async setWallpaper(contact: string, file: PickedFile) {
    const uri = await this.sendFile(contact, { ...file, kind: 'wallpaper' });
    setConversationSetting(contact, 'wallpaper_uri', uri);
    this.notify();
  }

  clearWallpaper(contact: string) {
    setConversationSetting(contact, 'wallpaper_uri', null);
    this.addSystemMessage(contact, 1);
    this.sendEvent(contact, { action: 'wallpaper-clear', id: '' });
  }

  // Prévient l'autre téléphone qu'une photo ou une vidéo de la conversation vient d'être enregistrée.
  markSaved(contact: string, id: string, kind: 'image' | 'video') {
    this.addSystemMessage(contact, 1, `saved:${kind}`);
    this.sendEvent(contact, { action: 'saved', id });
    this.notify();
  }

  // text décrit l'événement. Vide, c'est le retrait du fond de discussion.
  private addSystemMessage(contact: string, mine: number, text = '', id = to_base64(randombytes_buf(16))) {
    addMessage({
      id,
      contact,
      mine,
      text,
      status: 'delivered',
      created_at: Date.now(),
      kind: 'system',
    });
  }

  getMyProfile() {
    return { name: getSetting(PROFILE_NAME), photo: getSetting(PROFILE_PHOTO) };
  }

  async saveProfile(name: string, photoUri: string | null) {
    const current = this.getMyProfile();
    let photo = photoUri;
    if (photoUri && photoUri !== current.photo) {
      photo = await storeOutgoingFile(photoUri, to_base64(randombytes_buf(FILE_ID_BYTES)));
    }
    if (current.photo && current.photo !== photo) deleteStoredFile(current.photo);
    setSetting(PROFILE_NAME, name || null);
    setSetting(PROFILE_PHOTO, photo);
    setSetting(PROFILE_VERSION, to_base64(randombytes_buf(16)));
    this.names.forEach((_, contact) => this.shareProfile(contact));
    this.notify();
  }

  private shareProfile(contact: string) {
    const version = getSetting(PROFILE_VERSION);
    if (!version || getContactProfile(contact).sent_version === version) return;
    setContactProfileField(contact, 'sent_version', version);
    const { name, photo } = this.getMyProfile();
    this.sendEvent(contact, { action: 'profile', id: '', name, hasPhoto: photo !== null });
    deleteOldAvatars(contact, 1, null);
    if (!photo) return;
    // Une copie par contact : l'envoi déplace le fichier qu'il reçoit.
    exportCopy(photo, `avatar-${to_base64(randombytes_buf(8))}.jpg`)
      .then((uri) => this.sendFile(contact, { uri, name: 'avatar.jpg', size: 0, mime: 'image/jpeg', kind: 'avatar' }))
      .catch((e) => console.warn('Pear photo de profil :', e));
  }

  async sendFile(contact: string, file: PickedFile) {
    const id = to_base64(randombytes_buf(FILE_ID_BYTES));
    const uri = await storeOutgoingFile(file.uri, id);
    // Le sélecteur ne donne pas toujours la taille, et File.size peut renvoyer 0 : on lit aussi le fichier ouvert.
    const handle = new File(uri).open(FileMode.ReadOnly);
    const size = Math.max(file.size, handle.size ?? 0);
    handle.close();
    if (size === 0) {
      deleteStoredFile(uri);
      throw new Error('Ce fichier semble vide.');
    }
    addMessage({
      id,
      contact,
      mine: 1,
      text: file.name,
      status: 'sending',
      created_at: Date.now(),
      kind: file.kind,
      file_uri: uri,
      file_size: size,
      file_mime: file.mime,
    });
    this.flush(contact);
    this.wakeIfNeeded(contact);
    this.notify();
    return uri;
  }

  private markOpenConversationRead() {
    const contact = this.openConversation;
    if (!contact || AppState.currentState !== 'active') return;
    markConversationRead(contact);
    clearMessageNotification(contact);
    this.flush(contact);
  }

  private watch() {
    if (this.watching) return;
    this.watching = true;

    // Android indique directement si le téléphone a internet : c'est immédiat.
    const update = (state: NetworkState) => this.setOnline(state.isInternetReachable ?? state.isConnected ?? true);
    getNetworkStateAsync().then(update).catch((e) => console.warn('Pear réseau :', e));
    addNetworkStateListener(update);

    const messaging = getMessaging();
    getToken(messaging)
      .then((token) => {
        this.myToken = token;
        this.shareToken();
      })
      .catch((e) => console.warn('Pear token FCM :', e));
    onTokenRefresh(messaging, (token) => {
      this.myToken = token;
      this.shareToken();
    });
  }

  // Le token voyage dans la connexion chiffrée : ni le QR code ni Firebase ne le transportent.
  private shareToken(contact?: string) {
    if (!this.myToken) return;
    const message = { type: 'token', token: this.myToken };
    if (contact) this.links.get(contact)?.peer.send(message);
    else this.links.forEach((link) => link.peer.send(message));
  }

  private setOnline(online: boolean) {
    clearTimeout(this.offlineTimer);
    if (online) {
      const wasOffline = !this.online;
      this.online = true;
      if (wasOffline) this.retryAll();
      this.notify();
    } else {
      this.offlineTimer = setTimeout(() => {
        this.online = false;
        this.notify();
      }, OFFLINE_DELAY_MS);
    }
  }

  private wakeIfNeeded(contact: string) {
    if (!this.online || this.links.get(contact)?.status === 'connected') return;
    if (getUndelivered(contact).length === 0 && getOutboxEvents(contact).length === 0) return;
    if (Date.now() - (this.lastWake.get(contact) ?? 0) < WAKE_INTERVAL_MS) return;
    const token = getContactToken(contact);
    if (!token) return;
    this.lastWake.set(contact, Date.now());
    wakeContact(token).catch((e) => console.warn('Pear réveil :', e));
  }

  private connect(identity: Identity, contact: string) {
    let secret: Uint8Array;
    try {
      secret = deriveSharedSecret(identity, contact);
    } catch (e) {
      console.warn('Pear contact non valide :', e);
      return;
    }
    const link: Link = {
      status: 'starting',
      route: null,
      secret,
      peer: new PeerLink(identity.publicKey < contact ? 'a' : 'b', secret, {
        onStatus: (status) => {
          link.status = status;
          if (status === 'connected') {
            this.lastActivity = Date.now();
            this.shareToken(contact);
            this.flush(contact);
          }
          this.notify();
        },
        onRoute: (route) => {
          link.route = route;
          this.notify();
        },
        onMessage: (message) => this.receive(contact, message),
        onBytes: (bytes) => {
          this.writeQueue = this.writeQueue
            .then(() => this.receiveChunk(contact, bytes))
            .catch((e) => console.warn('Pear écriture du fichier :', e));
        },
      }),
    };
    this.links.set(contact, link);
    link.peer.start();
  }

  private loadOrCreateRatchet(contact: string) {
    const secret = this.links.get(contact)?.secret;
    if (!secret || !this.identity) throw new Error('Contact non connecté');
    return loadRatchet(contact) ?? createRatchet(this.identity, contact, secret);
  }

  // Le contenu passe par le ratchet : chaque envoi utilise une nouvelle clé, enregistrée avant de partir.
  private sendSecure(contact: string, message: unknown): boolean {
    const peer = this.links.get(contact)?.peer;
    if (!peer?.isOpen()) return false;
    const { state, envelope } = ratchetEncrypt(this.loadOrCreateRatchet(contact), JSON.stringify(message));
    saveRatchet(contact, state);
    return peer.send({ type: 'ratchet', ...envelope });
  }

  // L'état n'est enregistré que si le message est authentique : un message forgé ne change rien.
  private receiveRatchet(contact: string, envelope: unknown) {
    const { state, text } = ratchetDecrypt(this.loadOrCreateRatchet(contact), envelope);
    saveRatchet(contact, state);
    const message = JSON.parse(text);
    if (message?.type === 'file-offer') this.receiveFileOffer(contact, message);
    else if (message?.type === 'message') this.receiveText(contact, message);
    else if (message?.type === 'event') this.receiveEvent(contact, message);
  }

  // Refaire la même action ne change rien : un événement renvoyé après une coupure est sans danger.
  private receiveEvent(contact: string, data: any) {
    if (typeof data.eventId !== 'string' || typeof data.id !== 'string') return;
    if (data.action === 'edit' && typeof data.text === 'string') {
      editMessage(data.id, contact, 0, data.text.slice(0, MAX_TEXT_LENGTH));
    } else if (data.action === 'react' && (data.emoji === null || (typeof data.emoji === 'string' && data.emoji.length <= MAX_REACTION_LENGTH))) {
      setReaction(data.id, contact, 'their_reaction', data.emoji);
    } else if (data.action === 'delete' && getMessage(data.id, contact)?.mine === 0) {
      this.dropIncomingFile(contact, data.id);
      deleteMessage(data.id, contact, 0);
    } else if (data.action === 'wallpaper-clear') {
      setConversationSetting(contact, 'wallpaper_uri', null);
      this.addSystemMessage(contact, 0);
    } else if (data.action === 'saved') {
      const original = getMessage(data.id, contact);
      // eventId sert d'identifiant : un événement renvoyé après un accusé perdu ne s'affiche qu'une fois.
      if (original?.kind === 'image' || original?.kind === 'video') {
        this.addSystemMessage(contact, 0, `saved:${original.kind}:${original.mine === 1 ? 'yours' : 'theirs'}`, data.eventId.slice(0, MAX_SAVED_ID_LENGTH));
      }
    } else if (data.action === 'profile') {
      setContactProfileField(contact, 'name', typeof data.name === 'string' ? data.name.slice(0, MAX_PROFILE_NAME_LENGTH) : null);
      if (data.hasPhoto === false) {
        setContactProfileField(contact, 'photo_uri', null);
        deleteOldAvatars(contact, 0, null);
      }
    }
    this.links.get(contact)?.peer.send({ type: 'event-ack', id: data.eventId });
    this.notify();
  }

  // Tout ce qui n'a pas été confirmé repart : l'autre téléphone ignore les doublons grâce à l'id.
  private flush(contact: string) {
    const peer = this.links.get(contact)?.peer;
    if (!peer) return;
    for (const message of getUndelivered(contact)) {
      if (message.kind !== 'text') {
        if (this.sendingFiles.has(message.id)) continue;
        let key = message.file_key;
        if (!key) {
          key = to_base64(randombytes_buf(FILE_KEY_BYTES));
          setFileKey(message.id, contact, key);
        }
        const offer = {
          type: 'file-offer',
          id: message.id,
          name: message.text,
          size: message.file_size,
          mime: message.file_mime,
          kind: message.kind,
          key,
        };
        if (!this.sendSecure(contact, offer)) return;
      } else if (!this.sendSecure(contact, { type: 'message', id: message.id, text: message.text, reply_to: message.reply_to })) {
        return;
      }
    }
    // Après les messages : une modification ou une réaction arrive toujours après ce qu'elle vise.
    for (const event of getOutboxEvents(contact)) {
      if (!this.sendSecure(contact, { type: 'event', eventId: event.id, ...JSON.parse(event.payload) })) return;
    }
    // Les confirmations de lecture restées en attente pendant une coupure partent aussi.
    for (const message of getPendingReadReceipts(contact)) {
      if (!peer.send({ type: 'read', id: message.id })) return;
      setReadReceiptSent(message.id, contact);
    }
  }

  private setProgress(id: string, value: number) {
    this.progress.set(id, value);
    this.lastActivity = Date.now();
    if (Date.now() - this.lastProgressNotify > PROGRESS_NOTIFY_MS) {
      this.lastProgressNotify = Date.now();
      this.notify();
    }
  }

  // Lit le fichier morceau par morceau : il n'est jamais chargé en entier en mémoire.
  private async streamFile(contact: string, id: string, from: number) {
    const peer = this.links.get(contact)?.peer;
    const message = getMessage(id, contact);
    if (!peer || message?.mine !== 1 || !message.file_uri || !message.file_key || this.sendingFiles.has(id)) return;
    if (message.status === 'delivered' || message.status === 'read') return;

    this.sendingFiles.add(id);
    const size = message.file_size ?? 0;
    const idBytes = from_base64(id);
    const key = from_base64(message.file_key);
    const context = fileContext(id);
    const epoch = peer.epoch;
    const handle = new File(message.file_uri).open(FileMode.ReadOnly);
    this.confirmedChunks.set(id, from);
    try {
      handle.offset = from * CHUNK_BYTES;
      let index = from;
      while (index * CHUNK_BYTES < size) {
        // Le message a été supprimé pendant l'envoi : on arrête.
        if (!getMessage(id, contact)) return;
        const batch = await handle.readBytes(Math.min(DISK_BATCH_BYTES, size - index * CHUNK_BYTES));
        if (batch.length === 0) throw new Error('Fin de fichier inattendue');
        for (let offset = 0; offset < batch.length; offset += CHUNK_BYTES) {
          const data = batch.subarray(offset, offset + CHUNK_BYTES);
          const plain = new Uint8Array(CHUNK_INDEX_BYTES + data.length);
          new DataView(plain.buffer).setUint32(0, index);
          plain.set(data, CHUNK_INDEX_BYTES);
          while (index - (this.confirmedChunks.get(id) ?? from) >= SEND_WINDOW_CHUNKS) {
            if (!peer.isCurrent(epoch)) return;
            await new Promise((resolve) => setTimeout(resolve, WINDOW_POLL_MS));
          }
          const sealed = sealBytes(plain, key, context);
          const chunk = new Uint8Array(FILE_ID_BYTES + sealed.length);
          chunk.set(idBytes, 0);
          chunk.set(sealed, FILE_ID_BYTES);
          if (!(await peer.sendChunk(epoch, chunk))) return;
          index += 1;
        }
      }
    } catch (e) {
      console.warn('Pear envoi du fichier :', e);
    } finally {
      handle.close();
      this.sendingFiles.delete(id);
      this.confirmedChunks.delete(id);
    }
  }

  private receiveFileOffer(contact: string, data: any) {
    const peer = this.links.get(contact)?.peer;
    const size = data.size;
    const kinds: MessageKind[] = ['image', 'video', 'audio', 'file', 'wallpaper', 'avatar'];
    if (!peer || !isValidFileId(data.id) || typeof data.name !== 'string' || !kinds.includes(data.kind)) return;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) return;
    if (typeof data.key !== 'string' || from_base64(data.key).length !== FILE_KEY_BYTES) return;

    const existing = getMessage(data.id, contact);
    if (existing && existing.status !== 'receiving') {
      peer.send({ type: 'file-done', id: data.id });
      return;
    }

    let incoming = this.incomingFiles.get(data.id);
    if (!incoming) {
      const file = storedFile(data.id);
      let partialSize = 0;
      if (file.exists) {
        const partial = file.open(FileMode.ReadOnly);
        partialSize = partial.size ?? 0;
        partial.close();
      }
      if (size - partialSize > Paths.availableDiskSpace) {
        console.warn('Pear : pas assez de place pour recevoir ce fichier');
        return;
      }
      if (!file.exists) file.create();
      addMessage({
        id: data.id,
        contact,
        mine: 0,
        text: data.name.slice(0, 255),
        status: 'receiving',
        created_at: Date.now(),
        kind: data.kind,
        file_uri: file.uri,
        file_size: size,
        file_mime: typeof data.mime === 'string' ? data.mime.slice(0, 255) : null,
        file_key: data.key,
      });
      // Reprise : les morceaux déjà écrits ne sont pas redemandés.
      const next = Math.floor(partialSize / CHUNK_BYTES);
      const handle = file.open(FileMode.ReadWrite);
      handle.offset = next * CHUNK_BYTES;
      // En cas de reprise, la clé enregistrée reste celle du début du fichier.
      const key = from_base64(existing?.file_key ?? data.key);
      incoming = { contact, key, handle, size, next, received: next * CHUNK_BYTES, pending: [], pendingBytes: 0 };
      this.incomingFiles.set(data.id, incoming);
    }

    if (incoming.received >= size) this.finishFile(contact, data.id, incoming);
    else peer.send({ type: 'file-resume', id: data.id, from: incoming.next });
    this.notify();
  }

  private async receiveChunk(contact: string, bytes: Uint8Array) {
    const id = to_base64(bytes.slice(0, FILE_ID_BYTES));
    const incoming = this.incomingFiles.get(id);
    if (incoming?.contact !== contact) return;

    // Le numéro est chiffré avec les données, et le contexte contient l'id : un morceau ne peut pas être déplacé.
    const plain = openBytes(bytes.slice(FILE_ID_BYTES), incoming.key, fileContext(id));
    const index = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0);
    if (index !== incoming.next) return;

    const data = plain.slice(CHUNK_INDEX_BYTES);
    incoming.pending.push(data);
    incoming.pendingBytes += data.length;
    incoming.next += 1;
    incoming.received += data.length;
    const complete = incoming.received >= incoming.size;
    if (complete || incoming.pendingBytes >= DISK_BATCH_BYTES) {
      await this.writePending(incoming);
      if (!complete) this.links.get(contact)?.peer.send({ type: 'file-ack', id, next: incoming.next });
    }
    if (complete) this.finishFile(contact, id, incoming);
    else this.setProgress(id, incoming.received / incoming.size);
  }

  private async writePending(incoming: IncomingFile) {
    if (incoming.pendingBytes === 0) return;
    const batch = new Uint8Array(incoming.pendingBytes);
    let offset = 0;
    for (const data of incoming.pending) {
      batch.set(data, offset);
      offset += data.length;
    }
    incoming.pending = [];
    incoming.pendingBytes = 0;
    await incoming.handle.writeBytes(batch);
  }

  private finishFile(contact: string, id: string, incoming: IncomingFile) {
    incoming.handle.close();
    this.incomingFiles.delete(id);
    this.progress.delete(id);
    const foreground = AppState.currentState === 'active';
    finishIncomingFile(id, contact, foreground && this.openConversation === contact ? 'read-pending' : 'delivered');
    this.links.get(contact)?.peer.send({ type: 'file-done', id });
    this.flush(contact);
    const message = getMessage(id, contact);
    if (message?.kind === 'wallpaper') {
      setConversationSetting(contact, 'wallpaper_uri', message.file_uri);
    } else if (message?.kind === 'avatar') {
      setContactProfileField(contact, 'photo_uri', message.file_uri);
      deleteOldAvatars(contact, 0, id);
    }
    if (!foreground && message && message.kind !== 'avatar') this.notifyMessage(contact, message);
    this.notify();
  }

  private closeIncomingFiles() {
    // Ce qui attend encore d'être écrit passe après les écritures en cours : rien n'est perdu.
    const files = [...this.incomingFiles.values()];
    this.incomingFiles.clear();
    this.writeQueue = this.writeQueue
      .then(async () => {
        for (const incoming of files) {
          await this.writePending(incoming);
          incoming.handle.close();
        }
      })
      .catch((e) => console.warn('Pear écriture du fichier :', e));
  }

  private notifyMessage(contact: string, message: Message) {
    showMessageNotification(contact, this.names.get(contact) ?? 'Pear', describeMessage(message)).catch((e) =>
      console.warn('Pear notification :', e),
    );
  }

  private receiveText(contact: string, data: any) {
    if (typeof data.id !== 'string' || typeof data.text !== 'string') return;
    const foreground = AppState.currentState === 'active';
    const text = data.text.slice(0, MAX_TEXT_LENGTH);
    const isNew = addMessage({
      id: data.id,
      contact,
      mine: 0,
      text,
      status: foreground && this.openConversation === contact ? 'read-pending' : 'delivered',
      created_at: Date.now(),
      reply_to: typeof data.reply_to === 'string' ? data.reply_to : null,
    });
    this.links.get(contact)?.peer.send({ type: 'ack', id: data.id });
    this.flush(contact);
    const message = getMessage(data.id, contact);
    if (isNew && !foreground && message) this.notifyMessage(contact, message);
    this.notify();
  }

  // Le contenu n'est accepté que par le ratchet : ici, seulement des messages de contrôle.
  private receive(contact: string, data: any) {
    this.lastActivity = Date.now();
    if (data?.type === 'ratchet') {
      const { type: _type, ...envelope } = data;
      this.receiveRatchet(contact, envelope);
    } else if (data?.type === 'file-resume' && isValidFileId(data.id) && Number.isSafeInteger(data.from) && data.from >= 0) {
      this.streamFile(contact, data.id, data.from).catch((e) => console.warn('Pear envoi du fichier :', e));
    } else if (data?.type === 'file-ack' && isValidFileId(data.id) && Number.isSafeInteger(data.next) && data.next >= 0) {
      // La barre de l'envoyeur suit ce que le receveur a vraiment écrit : les deux restent alignées.
      this.confirmedChunks.set(data.id, data.next);
      const size = getMessage(data.id, contact)?.file_size;
      if (size) this.setProgress(data.id, Math.min(1, (data.next * CHUNK_BYTES) / size));
    } else if (data?.type === 'file-done' && isValidFileId(data.id)) {
      setStatus(data.id, contact, 'delivered');
      this.progress.delete(data.id);
      this.notify();
    } else if (data?.type === 'event-ack' && typeof data.id === 'string') {
      removeOutboxEvent(data.id, contact);
    } else if ((data?.type === 'ack' || data?.type === 'read') && typeof data.id === 'string') {
      setStatus(data.id, contact, data.type === 'read' ? 'read' : 'delivered');
      this.notify();
    } else if (data?.type === 'token' && typeof data.token === 'string' && data.token.length <= 4096) {
      setContactToken(contact, data.token);
    }
  }
}

export const chat = new ChatManager();
