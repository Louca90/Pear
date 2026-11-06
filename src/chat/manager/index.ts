import { AppState } from 'react-native';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { Identity } from '../../crypto/pairing';
import { PeerStatus, RouteType } from '../../network/peer';
import { Contact } from '../../storage';
import { addMessage, deleteMessage, editMessage, getMessage, markConversationRead, setConversationSetting, setReaction } from '../database';
import { clearMessageNotification } from '../notifications';

import { connect, retryAll, watch } from './connections';
import { ChatCore } from './core';
import { addSystemMessage, flush, sendEvent } from './outbox';
import { getMyProfile, saveProfile, shareProfile } from './profile';
import { closeIncomingFiles, dropIncomingFile, sendFile } from './transfers';
import { PickedFile, WAKE_CHECK_MS } from './types';
import { wakeIfNeeded } from './wake';

export { MAX_PROFILE_NAME_LENGTH, MAX_TEXT_LENGTH } from './types';
export type { PickedFile } from './types';

// Garde une connexion par contact tant que l'app est ouverte, et prévient les écrans à chaque changement.
class ChatManager extends ChatCore {
  // Ouvre les connexions des nouveaux contacts et ferme celles des contacts supprimés.
  sync(identity: Identity, contacts: Contact[]) {
    this.identity = identity;
    watch(this);
    this.lastActivity = Date.now();
    this.names = new Map(contacts.map((contact) => [contact.publicKey, contact.name]));
    for (const [key, link] of this.links) {
      if (!this.names.has(key)) {
        link.peer.stop();
        this.links.delete(key);
      }
    }
    for (const key of this.names.keys()) {
      if (!this.links.has(key)) connect(this, identity, key);
    }
    if (!this.wakeTimer) {
      this.wakeTimer = setInterval(() => this.links.forEach((_, contact) => wakeIfNeeded(this, contact)), WAKE_CHECK_MS);
    }
    this.markOpenConversationRead();
    this.names.forEach((_, contact) => shareProfile(this, contact));
    this.notify();
  }

  stopAll() {
    clearInterval(this.wakeTimer);
    this.wakeTimer = undefined;
    this.links.forEach((link) => link.peer.stop());
    this.links.clear();
    closeIncomingFiles(this);
    this.notify();
  }

  // Entre 0 et 1 pendant un transfert, undefined sinon.
  getProgress(id: string) {
    return this.progress.get(id);
  }

  retryAll() {
    retryAll(this);
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
    this.atBottom = true;
    this.markOpenConversationRead();
    this.notify();
  }

  // La conversation ouverte est-elle affichée tout en bas ? En y revenant, ses messages deviennent lus.
  setAtBottom(atBottom: boolean) {
    if (this.atBottom === atBottom) return;
    this.atBottom = atBottom;
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
    flush(this, contact);
    wakeIfNeeded(this, contact);
    this.notify();
  }

  edit(contact: string, id: string, text: string) {
    editMessage(id, contact, 1, text);
    sendEvent(this, contact, { action: 'edit', id, text });
  }

  // Une seule réaction par personne : la même une deuxième fois l'enlève.
  react(contact: string, id: string, emoji: string) {
    const next = getMessage(id, contact)?.my_reaction === emoji ? null : emoji;
    setReaction(id, contact, 'my_reaction', next);
    sendEvent(this, contact, { action: 'react', id, emoji: next });
  }

  deleteForEveryone(contact: string, id: string) {
    deleteMessage(id, contact, 1);
    sendEvent(this, contact, { action: 'delete', id });
  }

  deleteForMe(contact: string, id: string) {
    dropIncomingFile(this, contact, id);
    deleteMessage(id, contact);
    this.notify();
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
    addSystemMessage(contact, 1);
    sendEvent(this, contact, { action: 'wallpaper-clear', id: '' });
  }

  // Prévient l'autre téléphone qu'une photo ou une vidéo de la conversation vient d'être enregistrée.
  markSaved(contact: string, id: string, kind: 'image' | 'video') {
    addSystemMessage(contact, 1, `saved:${kind}`);
    sendEvent(this, contact, { action: 'saved', id });
    this.notify();
  }

  getMyProfile() {
    return getMyProfile();
  }

  saveProfile(name: string, photoUri: string | null) {
    return saveProfile(this, name, photoUri);
  }

  sendFile(contact: string, file: PickedFile) {
    return sendFile(this, contact, file);
  }

  private markOpenConversationRead() {
    const contact = this.openConversation;
    if (!contact || !this.atBottom || AppState.currentState !== 'active') return;
    markConversationRead(contact);
    clearMessageNotification(contact);
    flush(this, contact);
  }
}

export const chat = new ChatManager();
