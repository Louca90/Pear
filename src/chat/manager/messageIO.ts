import { AppState } from 'react-native';

import {
  setMessagePinned,
  activateContact,
  addMessage,
  deleteUpload,
  getPeerState,
  isBlocked,
  setPeerState,
  deleteMessage,
  deleteOldAvatars,
  editMessage,
  getMessage,
  markRefused,
  removeOutboxEvent,
  setContactProfileField,
  setContactToken,
  setConversationSetting,
  setReaction,
  setStatus,
} from '../database';
import { CHUNK_BYTES, isValidFileId } from '../files';

import { ChatCore } from './core';
import { showStatusNotification } from '../notifications';
import { notifyMessage } from './notify';
import { addSystemMessage, flush } from './outbox';
import { reshareProfile } from './profile';
import { receiveRelayOffer } from './relay';
import { decryptIncoming, receiveRekey, receiveRekeyAck } from './sessions';
import { queuePushAck } from './wake';
import { dropIncomingFile, receiveFileOffer, setProgress, streamFile } from './transfers';
import { AFTER_ACTIVITY_MS, asPayload, isCount, isSupportedVersion, UPDATE_REQUIRED, MAX_PROFILE_NAME_LENGTH, MAX_REACTION_LENGTH, MAX_SAVED_ID_LENGTH, MAX_TEXT_LENGTH, Payload } from './types';
import { log } from '../../log';

// L'état n'est enregistré que si le message est authentique : un message forgé ne change rien.
// Appelée pour ce qui arrive en direct comme pour ce qui arrive dans un push.
export function receiveRatchet(core: ChatCore, contact: string, envelope: unknown) {
  const text = decryptIncoming(core, contact, envelope);
  // Un contact bloqué ne peut plus rien nous faire parvenir.
  if (isBlocked(contact)) return;
  // Un message authentique de ce contact prouve qu'il nous a enregistré : la demande est acceptée.
  if (activateContact(contact)) {
    reshareProfile(core, contact);
    core.contactsChanged();
  }
  const message = asPayload(JSON.parse(text));
  if (message && !isSupportedVersion(message)) {
    // L'id du message (s'il existe) évite d'afficher l'avertissement deux fois pour un même envoi.
    const id = typeof message.id === 'string' ? `${UPDATE_REQUIRED}:${message.id}` : undefined;
    addSystemMessage(contact, 0, UPDATE_REQUIRED, id);
    core.notify();
    return;
  }
  if (message?.type === 'file-offer') receiveFileOffer(core, contact, message);
  else if (message?.type === 'message') receiveText(core, contact, message);
  else if (message?.type === 'event') receiveEvent(core, contact, message);
  else if (message?.type === 'acks') receiveAcks(core, contact, message);
  else if (message?.type === 'status') receiveStatus(core, contact, message);
  else if (message?.type === 'rekey') receiveRekey(core, contact, message);
  else if (message?.type === 'rekey-ack') receiveRekeyAck(core, contact, message);
}

// L'autre nous a supprimé, bloqué ou débloqué : la conversation l'affiche, et on prévient par une notification.
function receiveStatus(core: ChatCore, contact: string, data: Payload) {
  if (data.state !== 'removed' && data.state !== 'blocked' && data.state !== 'unblocked') return;
  setPeerState(contact, data.state === 'unblocked' ? null : data.state);
  if (data.state !== 'unblocked') showStatusNotification(contact, core.names.get(contact) ?? 'Pear', data.state).catch((e) => log.warn('notification', e));
  core.notify();
}

// Confirme la réception : en direct si la connexion est ouverte, sinon par push.
function acknowledge(core: ChatCore, contact: string, ack: { id?: string; eventId?: string }) {
  const peer = core.links.get(contact)?.peer;
  if (peer?.isOpen()) peer.send(ack.id ? { type: 'ack', id: ack.id } : { type: 'event-ack', id: ack.eventId });
  else queuePushAck(core, contact, ack);
}

// Accusés arrivés par push (l'autre téléphone a reçu nos messages sans connexion directe).
function receiveAcks(core: ChatCore, contact: string, data: Payload) {
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : []);
  for (const id of strings(data.ids)) {
    setStatus(id, contact, 'delivered');
    deleteUpload(id, contact);
  }
  for (const id of strings(data.events)) removeOutboxEvent(id, contact);
  core.notify();
}

// Refaire la même action ne change rien : un événement renvoyé après une coupure est sans danger.
function receiveEvent(core: ChatCore, contact: string, data: Payload) {
  if (typeof data.eventId !== 'string' || typeof data.id !== 'string') return;
  if (data.action === 'edit' && typeof data.text === 'string') {
    editMessage(data.id, contact, 0, data.text.slice(0, MAX_TEXT_LENGTH));
  } else if (data.action === 'react' && (data.emoji === null || (typeof data.emoji === 'string' && data.emoji.length <= MAX_REACTION_LENGTH))) {
    setReaction(data.id, contact, 'their_reaction', data.emoji);
  } else if (data.action === 'delete' && getMessage(data.id, contact)?.mine === 0) {
    dropIncomingFile(core, contact, data.id);
    deleteMessage(data.id, contact, 0);
  } else if (data.action === 'pin' && typeof data.pinned === 'boolean') {
    setMessagePinned(data.id, contact, data.pinned);
  } else if (data.action === 'wallpaper-clear') {
    setConversationSetting(contact, 'wallpaper_uri', null);
    addSystemMessage(contact, 0);
  } else if (data.action === 'saved') {
    const original = getMessage(data.id, contact);
    // eventId sert d'identifiant : un événement renvoyé après un accusé perdu ne s'affiche qu'une fois.
    if (original?.kind === 'image' || original?.kind === 'video') {
      addSystemMessage(contact, 0, `saved:${original.kind}:${original.mine === 1 ? 'yours' : 'theirs'}`, data.eventId.slice(0, MAX_SAVED_ID_LENGTH));
    }
  } else if (data.action === 'relay') {
    // Un fichier qui attend dans le relais (l'expéditeur ne nous joignait pas en direct).
    receiveRelayOffer(core, contact, data);
  } else if (data.action === 'accepted') {
    // Notre demande de pairing est acceptée : le contact passe d'« en attente » à actif.
    if (activateContact(contact)) {
      reshareProfile(core, contact);
      core.contactsChanged();
    }
  } else if (data.action === 'profile') {
    setContactProfileField(contact, 'name', typeof data.name === 'string' ? data.name.slice(0, MAX_PROFILE_NAME_LENGTH) : null);
    if (data.hasPhoto === false) {
      setContactProfileField(contact, 'photo_uri', null);
      deleteOldAvatars(contact, 0, null);
    }
  }
  acknowledge(core, contact, { eventId: data.eventId });
  core.notify();
}

// « écrit… » : sans nouvelle au bout de ce délai (connexion coupée…), l'indicateur s'éteint seul.
const TYPING_TTL_MS = 6000;

function receiveTyping(core: ChatCore, contact: string, typing: boolean) {
  if (typing) {
    core.typingUntil.set(contact, Date.now() + TYPING_TTL_MS);
    setTimeout(() => {
      if ((core.typingUntil.get(contact) ?? 0) > Date.now()) return;
      core.typingUntil.delete(contact);
      core.notify();
    }, TYPING_TTL_MS + 50);
  } else core.typingUntil.delete(contact);
  core.notify();
}

function receiveText(core: ChatCore, contact: string, data: Payload) {
  if (typeof data.id !== 'string' || typeof data.text !== 'string') return;
  // Il nous écrit de nouveau : s'il nous avait supprimé, il nous a rajouté.
  if (getPeerState(contact) === 'removed') setPeerState(contact, null);
  const foreground = AppState.currentState === 'active';
  const text = data.text.slice(0, MAX_TEXT_LENGTH);
  const isNew = addMessage({
    id: data.id,
    contact,
    mine: 0,
    text,
    status: foreground && core.isReading(contact) ? 'read-pending' : 'delivered',
    created_at: Date.now(),
    reply_to: typeof data.reply_to === 'string' ? data.reply_to : null,
    forwarded: data.forwarded === true ? 1 : 0,
    conn_session: core.sessionFor(contact),
  });
  core.typingUntil.delete(contact);
  acknowledge(core, contact, { id: data.id });
  flush(core, contact);
  const message = getMessage(data.id, contact);
  if (isNew && !foreground && message) notifyMessage(core, contact);
  core.notify();
}

// Le contenu n'est accepté que par le ratchet : ici, seulement des messages de contrôle.
export function receive(core: ChatCore, contact: string, received: unknown) {
  const data = asPayload(received);
  if (!data) return;
  core.lastActivity = Date.now();
  if (data.type !== 'heartbeat') core.keepConnected(contact, AFTER_ACTIVITY_MS);
  if (data.type === 'ratchet') {
    const { type: _type, ...envelope } = data;
    receiveRatchet(core, contact, envelope);
  } else if (data.type === 'file-resume' && isValidFileId(data.id) && isCount(data.from)) {
    streamFile(core, contact, data.id, data.from).catch((e) => log.warn('envoi du fichier', e));
  } else if (data.type === 'file-ack' && isValidFileId(data.id) && isCount(data.next)) {
    // La barre de l'envoyeur suit ce que le receveur a vraiment écrit : les deux restent alignées.
    core.confirmedChunks.set(data.id, data.next);
    const size = getMessage(data.id, contact)?.file_size;
    if (size) setProgress(core, data.id, Math.min(1, (data.next * CHUNK_BYTES) / size));
  } else if (data.type === 'file-done' && isValidFileId(data.id)) {
    setStatus(data.id, contact, 'delivered');
    core.progress.delete(data.id);
    core.notify();
  } else if (data.type === 'file-refused' && isValidFileId(data.id)) {
    // Fichier refusé par l'autre (trop lourd, ou refusé à la main) : il ne repart plus.
    markRefused(data.id, contact);
    core.progress.delete(data.id);
    core.notify();
  } else if (data.type === 'event-ack' && typeof data.id === 'string') {
    removeOutboxEvent(data.id, contact);
  } else if ((data.type === 'ack' || data.type === 'read') && typeof data.id === 'string') {
    setStatus(data.id, contact, data.type === 'read' ? 'read' : 'delivered');
    deleteUpload(data.id, contact);
    core.notify();
  } else if (data.type === 'typing') {
    receiveTyping(core, contact, data.state === 'start');
  } else if (data.type === 'token' && typeof data.token === 'string' && data.token.length <= 4096) {
    setContactToken(contact, data.token);
  }
}
