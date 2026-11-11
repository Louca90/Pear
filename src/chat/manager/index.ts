import { AppState } from 'react-native';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { Identity } from '../../crypto/pairing';
import { PeerStatus, RouteType } from '../../network/peer';
import { Contact, loadContacts, loadOrCreateIdentity, saveContacts } from '../../storage';
import { t } from '../../i18n';
import { addMessage, blockKey, dropMessageFile, getExpiredMessages, getSpentOnce, markOnceOpened, deleteMessage, deleteRelayIncoming, editMessage, getMessage, getPendingRequests, getRelayIncoming, unblockKey, markConversationRead, Message, addScheduledMessage, getDueScheduled, releaseScheduled, setConversationSetting, setMessagePinned, setIncomingStatus, setReaction, setStatus } from '../database';
import { clearMessageNotification } from '../notifications';
import { encodeMeta, MessageMeta, parseMeta } from '../meta';
import { isSelf } from '../self';

import { deleteRelay } from '../../network/relay';
import { unpublishToken } from '../../network/tokens';
import { log } from '../../log';
import { parisNow } from '../../time';

import { publishMyToken, retryAll, watch } from './connections';
import { ChatCore } from './core';
import { addSystemMessage, applyEphemeral, ephemeralFor, ephemeralSettingTime, flush, lastEphemeralChoice, sendEvent } from './outbox';
import { expiryFor } from '../ephemeral';
import { sharedLocationId, startLocation, stopLocation, tickLocations } from './location';
import { isRepairPending, requestRepair } from './sessions';
import { getMyProfile, saveProfile, shareProfile } from './profile';
import { acceptFile, closeIncomingFiles, dropIncomingFile, refuseFile, sendFile } from './transfers';
import { AFTER_SEND_MS, PickedFile, WAKE_CHECK_MS } from './types';
import { contactForTag, receivePush } from './incoming';
import { reconcile } from './strategy';
import { downloadRelayFile, relayPending } from './relay';
import { acceptPairing, blockPairing, declinePairing, requestPairing, startPairing, syncPairRequests } from './pairing';
import { deliverNow, sendStatusNow, settlePushAcks, wakeIfNeeded } from './wake';
import { notifyMessage } from './notify';

export { MAX_PROFILE_NAME_LENGTH, MAX_TEXT_LENGTH } from './types';
export type { PickedFile } from './types';

// Garde les connexions utiles tant que l'app est ouverte (voir strategy.ts), et prévient les écrans à chaque changement.
const TYPING_EVERY_MS = 3000;

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
        unpublishToken(identity, key).catch((e) => log.warn('retrait du token', e));
      }
    }
    publishMyToken(this);
    this.releaseDueScheduled();
    this.purge();
    reconcile(this);
    if (!this.wakeTimer) {
      this.wakeTimer = setInterval(() => {
        this.releaseDueScheduled();
        this.purge();
        tickLocations(this);
        reconcile(this);
        this.names.forEach((_, contact) => {
          wakeIfNeeded(this, contact);
          relayPending(this, contact);
        });
      }, WAKE_CHECK_MS);
    }
    this.markOpenConversationRead();
    this.names.forEach((_, contact) => shareProfile(this, contact));
    if (!this.pairingStarted) {
      this.pairingStarted = true;
      startPairing(this, contacts.filter((contact) => contact.pending).map((contact) => contact.publicKey)).catch((e) => log.warn('demandes de pairing', e));
    }
    this.notify();
  }

  // Réveil en arrière-plan : identité et contacts, sans ouvrir aucune connexion.
  prepare(identity: Identity, contacts: Contact[]) {
    this.identity = identity;
    this.names = new Map(contacts.map((contact) => [contact.publicKey, contact.name]));
  }

  // Un push reçu (« msg » : message chiffré ; « pair » : demande ; « wake » : réveil). Attend la fin.
  async handlePush(data: { [key: string]: unknown } | undefined) {
    if (data?.type === 'pair') {
      await syncPairRequests(this);
      return;
    }
    receivePush(this, data);
    this.purge();
    await settlePushAcks(this);
  }

  // Réveil en arrière-plan : se connecter à ces contacts-là, le temps de récupérer ce qui attend.
  connectForWake(contacts: string[]) {
    contacts.forEach((contact) => this.keepConnected(contact, AFTER_SEND_MS));
    reconcile(this);
  }

  // Le contact visé par un réveil, ou null pour un réveil d'une ancienne version (tous les contacts).
  contactForWake(data: { [key: string]: unknown } | undefined) {
    return data?.type === 'wake' ? contactForTag(this, data.payload) : null;
  }

  // Depuis une notification, l'app peut être fermée : on charge alors identité et contacts.
  private async ensurePrepared() {
    if (this.identity) return;
    const [identity, contacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
    this.prepare(identity, contacts);
  }

  // Répondre depuis la notification : la conversation est lue, la réponse part (en direct ou par push)
  // et la notification affiche la réponse.
  async replyFromNotification(contact: string, text: string) {
    await this.ensurePrepared();
    this.send(contact, text);
    markConversationRead(contact);
    notifyMessage(this, contact);
    await deliverNow(this, contact);
  }

  async markReadFromNotification(contact: string) {
    await this.ensurePrepared();
    markConversationRead(contact);
    clearMessageNotification(contact);
    flush(this, contact);
    this.notify();
  }

  // --- Suppression et blocage d'un contact ---

  // Avant de retirer le contact : l'autre téléphone saura qu'il ne peut plus nous écrire.
  notifyRemoved(contact: string) {
    sendStatusNow(this, contact, 'removed').catch((e) => log.warn('statut', e));
  }

  blockContact(contact: string) {
    blockKey(contact);
    sendStatusNow(this, contact, 'blocked').catch((e) => log.warn('statut', e));
    this.notify();
  }

  unblockContact(contact: string) {
    unblockKey(contact);
    sendStatusNow(this, contact, 'unblocked').catch((e) => log.warn('statut', e));
    this.notify();
  }

  // --- Pairing à sens unique ---

  onContactsChanged(listener: () => void) {
    this.contactsListeners.add(listener);
    return () => {
      this.contactsListeners.delete(listener);
    };
  }

  // Après avoir enregistré un contact scanné : la demande part vers sa boîte.
  requestPairing(contact: string) {
    requestPairing(this, contact).catch((e) => log.warn('demande de pairing', e));
  }

  // L'écran a déjà enregistré le contact (sync) : on prévient l'autre téléphone.
  acceptRequest(contact: string) {
    acceptPairing(this, contact);
    this.notify();
  }

  declineRequest(contact: string) {
    declinePairing(this, contact);
  }

  blockRequest(contact: string) {
    blockPairing(this, contact);
  }

  // Depuis la notification d'une demande, app peut-être fermée : le contact est enregistré ici, avec
  // le pseudo de la demande, puis l'autre téléphone est prévenu (par push s'il le faut).
  async acceptRequestFromNotification(contact: string) {
    await this.ensurePrepared();
    const request = getPendingRequests().find((pending) => pending.from_key === contact);
    if (!request) return;
    const contacts = await loadContacts();
    if (!contacts.some((saved) => saved.publicKey === contact)) {
      const next = [...contacts, { publicKey: contact, name: request.name || t('app.contact') }];
      await saveContacts(next);
      this.names = new Map(next.map((saved) => [saved.publicKey, saved.name]));
    }
    acceptPairing(this, contact);
    this.contactsChanged();
    await deliverNow(this, contact);
  }

  async declineRequestFromNotification(contact: string) {
    await this.ensurePrepared();
    declinePairing(this, contact);
  }

  async blockRequestFromNotification(contact: string) {
    await this.ensurePrepared();
    blockPairing(this, contact);
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
  // Pour l'écran Diagnostic.
  getMyToken() {
    return this.myToken;
  }

  countConnected() {
    return [...this.links.values()].filter((link) => link.status === 'connected').length;
  }

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

  isTyping(contact: string) {
    return (this.typingUntil.get(contact) ?? 0) > Date.now();
  }

  // « écrit… » : seulement par la connexion directe (jamais push ni relais), jamais stocké, au plus une
  // fois toutes les 3 secondes pendant la frappe, et un « arrêt » quand le brouillon est vidé ou envoyé.
  sendTyping(contact: string, typing: boolean) {
    const peer = this.links.get(contact)?.peer;
    if (!peer?.isOpen()) return;
    const now = Date.now();
    if (typing) {
      if (now - (this.typingSentAt.get(contact) ?? 0) < TYPING_EVERY_MS) return;
      this.typingSentAt.set(contact, now);
    } else {
      if (!this.typingSentAt.has(contact)) return;
      this.typingSentAt.delete(contact);
    }
    peer.send({ type: 'typing', state: typing ? 'start' : 'stop' });
  }

  // La conversation affichée à l'écran : ses messages comptent comme lus.
  setOpenConversation(contact: string | null) {
    this.openConversation = contact;
    reconcile(this);
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

  // « Réparer la conversation » : nouvelle session avec le contact. Vrai si la demande est partie tout de
  // suite, faux si elle attend la prochaine connexion.
  repairConversation(contact: string) {
    const sent = requestRepair(this, contact);
    this.notify();
    return sent;
  }

  isRepairPending(contact: string) {
    return isRepairPending(contact);
  }

  // meta : l'aperçu du lien préparé pendant la saisie (lot 4.3).
  send(contact: string, text: string, replyTo: string | null = null, forwarded = false, meta: MessageMeta | null = null) {
    const now = Date.now();
    addMessage({
      id: to_base64(randombytes_buf(16)),
      contact,
      mine: 1,
      text,
      // Notes à moi-même : enregistré sur ce téléphone, sans rien envoyer.
      status: isSelf(contact) ? 'read' : 'sending',
      created_at: now,
      // Conversation en mode éphémère : le message porte sa durée de vie.
      expires_at: expiryFor(now, ephemeralFor(contact)),
      reply_to: replyTo,
      forwarded: forwarded ? 1 : 0,
      conn_session: this.sessionFor(contact),
      meta: encodeMeta(meta),
    });
    this.afterSend(contact);
    flush(this, contact);
    wakeIfNeeded(this, contact);
    this.notify();
  }

  // Un envoi garde (ou ouvre) la connexion un moment : la réponse arrive souvent vite.
  private afterSend(contact: string) {
    this.keepConnected(contact, AFTER_SEND_MS);
    reconcile(this);
  }

  edit(contact: string, id: string, text: string) {
    editMessage(id, contact, 1, text);
    this.afterSend(contact);
    sendEvent(this, contact, { action: 'edit', id, text });
  }

  // Une seule réaction par personne : la même une deuxième fois l'enlève.
  react(contact: string, id: string, emoji: string) {
    const next = getMessage(id, contact)?.my_reaction === emoji ? null : emoji;
    setReaction(id, contact, 'my_reaction', next);
    this.afterSend(contact);
    sendEvent(this, contact, { action: 'react', id, emoji: next });
  }

  // Transférer un message : mention « Transféré », sans la citation. Un fichier repart du fichier
  // local, copié et chiffré avec une nouvelle clé pour chaque destinataire (chemin d'envoi normal).
  async forward(message: Message, contacts: string[]) {
    // L'aperçu du lien, la forme d'onde et la miniature floue suivent le message transféré.
    const meta = parseMeta(message.meta);
    for (const contact of contacts) {
      if (message.kind === 'text') this.send(contact, message.text, null, true, meta);
      else if (message.file_uri) {
        await this.sendFile(contact, {
          uri: message.file_uri,
          name: message.text,
          size: message.file_size ?? 0,
          mime: message.file_mime,
          kind: message.kind,
          forwarded: true,
          meta,
        });
      }
    }
  }

  // Envoi programmé : le message attend ici jusqu'à son heure (heure de Paris), puis part normalement.
  schedule(contact: string, text: string, at: number, replyTo: string | null = null) {
    addScheduledMessage(to_base64(randombytes_buf(16)), contact, text, at, replyTo);
    this.notify();
  }

  sendScheduledNow(contact: string, id: string) {
    releaseScheduled(id, contact, Date.now(), this.sessionFor(contact));
    if (isSelf(contact)) setStatus(id, contact, 'read');
    this.afterSend(contact);
    flush(this, contact);
    wakeIfNeeded(this, contact);
    this.notify();
  }

  // Vérifié au lancement, au retour de l'app et toutes les WAKE_CHECK_MS.
  releaseDueScheduled() {
    const due = getDueScheduled(parisNow());
    for (const { id, contact } of due) this.sendScheduledNow(contact, id);
  }

  // Épingler ou désépingler un message, pour les deux.
  pin(contact: string, id: string, pinned: boolean) {
    setMessagePinned(id, contact, pinned);
    this.notify();
    sendEvent(this, contact, { action: 'pin', id, pinned });
  }

  // --- Position en direct (lot 4.8) ---

  // Partage ma position avec ce contact pendant `seconds`, seulement par la connexion directe.
  // false si le téléphone ne donne aucune position.
  startLocation(contact: string, seconds: number) {
    if (isSelf(contact)) return false;
    const started = startLocation(this, contact, seconds);
    if (started) reconcile(this);
    return started;
  }

  stopLocation(contact: string) {
    stopLocation(this, contact);
  }

  deleteForEveryone(contact: string, id: string) {
    // Supprimer le message de ma position arrête aussi le partage.
    if (sharedLocationId(contact) === id) stopLocation(this, contact);
    deleteMessage(id, contact, 1);
    sendEvent(this, contact, { action: 'delete', id });
  }

  deleteForMe(contact: string, id: string) {
    if (sharedLocationId(contact) === id) stopLocation(this, contact);
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

  // Un fichier trop lourd attend notre accord avant d'être reçu.
  acceptFile(contact: string, id: string) {
    // Un fichier qui attend dans le relais se télécharge de là ; sinon il viendra en direct.
    if (getRelayIncoming(id, contact)) {
      setIncomingStatus(id, contact, 'offered', 'receiving');
      downloadRelayFile(this, contact, id).catch((e) => log.warn('réception par le relais', e));
      this.notify();
      return;
    }
    acceptFile(this, contact, id);
  }

  refuseFile(contact: string, id: string) {
    // Refusé alors qu'il attendait dans le relais : on le supprime tout de suite du serveur.
    const relayed = getRelayIncoming(id, contact);
    if (relayed) {
      deleteRelay(relayed.file_id).catch((e) => log.warn('suppression du relais', e));
      deleteRelayIncoming(id, contact);
    }
    refuseFile(this, contact, id);
  }

  // --- Messages éphémères et vue unique (lot 4.7) ---

  // Règle le minuteur de la conversation (secondes, 0 pour couper) : appliqué ici, annoncé par un
  // message système et synchronisé avec le contact par un événement chiffré.
  setEphemeral(contact: string, seconds: number) {
    if (isSelf(contact)) return;
    const at = ephemeralSettingTime(contact);
    applyEphemeral(contact, seconds, at, 1);
    sendEvent(this, contact, { action: 'ephemeral', id: '', seconds, at });
  }

  // Le geste : active avec la dernière durée choisie, ou coupe. Renvoie le nouvel état.
  toggleEphemeral(contact: string) {
    const next = ephemeralFor(contact) ? 0 : lastEphemeralChoice(contact);
    this.setEphemeral(contact, next);
    return next;
  }

  getEphemeral(contact: string) {
    return ephemeralFor(contact);
  }

  // Média à vue unique qu'on ouvre : il compte comme vu dès l'ouverture, et l'expéditeur est prévenu.
  openOnce(contact: string, id: string) {
    markOnceOpened(id, contact);
    sendEvent(this, contact, { action: 'viewed', id });
  }

  // Visionneuse refermée : le fichier est effacé de ce téléphone.
  closeOnce(contact: string, id: string) {
    dropMessageFile(id, contact);
    this.notify();
  }

  // Efface ce qui doit l'être : messages éphémères arrivés à leur heure, fichiers à vue unique qui
  // n'ont plus à rester. Au lancement, à chaque tour d'horloge (15 s) et à chaque push reçu.
  purge() {
    let changed = false;
    for (const { id, contact } of getExpiredMessages(Date.now())) {
      dropIncomingFile(this, contact, id);
      deleteMessage(id, contact);
      changed = true;
    }
    for (const { id, contact } of getSpentOnce()) {
      dropMessageFile(id, contact);
      changed = true;
    }
    if (changed) this.notify();
  }

  // Identifiant d'un nouvel album (lot 4.5).
  newAlbumId() {
    return to_base64(randombytes_buf(16));
  }

  sendFile(contact: string, file: PickedFile) {
    this.afterSend(contact);
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
