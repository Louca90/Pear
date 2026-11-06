import { AppState } from 'react-native';

import { ratchetDecrypt } from '../../crypto/ratchet';
import { saveRatchet } from '../../storage';
import {
  addMessage,
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
import { notifyMessage } from './notify';
import { addSystemMessage, flush } from './outbox';
import { loadOrCreateRatchet } from './secure';
import { dropIncomingFile, receiveFileOffer, setProgress, streamFile } from './transfers';
import { asPayload, isCount, MAX_PROFILE_NAME_LENGTH, MAX_REACTION_LENGTH, MAX_SAVED_ID_LENGTH, MAX_TEXT_LENGTH, Payload } from './types';
import { log } from '../../log';

// L'état n'est enregistré que si le message est authentique : un message forgé ne change rien.
function receiveRatchet(core: ChatCore, contact: string, envelope: unknown) {
  const { state, text } = ratchetDecrypt(loadOrCreateRatchet(core, contact), envelope);
  saveRatchet(contact, state);
  const message = asPayload(JSON.parse(text));
  if (message?.type === 'file-offer') receiveFileOffer(core, contact, message);
  else if (message?.type === 'message') receiveText(core, contact, message);
  else if (message?.type === 'event') receiveEvent(core, contact, message);
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
  } else if (data.action === 'wallpaper-clear') {
    setConversationSetting(contact, 'wallpaper_uri', null);
    addSystemMessage(contact, 0);
  } else if (data.action === 'saved') {
    const original = getMessage(data.id, contact);
    // eventId sert d'identifiant : un événement renvoyé après un accusé perdu ne s'affiche qu'une fois.
    if (original?.kind === 'image' || original?.kind === 'video') {
      addSystemMessage(contact, 0, `saved:${original.kind}:${original.mine === 1 ? 'yours' : 'theirs'}`, data.eventId.slice(0, MAX_SAVED_ID_LENGTH));
    }
  } else if (data.action === 'profile') {
    setContactProfileField(contact, 'name', typeof data.name === 'string' ? data.name.slice(0, MAX_PROFILE_NAME_LENGTH) : null);
    if (data.hasPhoto === false) {
      setContactProfileField(contact, 'photo_uri', null);
      deleteOldAvatars(contact, 0, null);
    }
  }
  core.links.get(contact)?.peer.send({ type: 'event-ack', id: data.eventId });
  core.notify();
}

function receiveText(core: ChatCore, contact: string, data: Payload) {
  if (typeof data.id !== 'string' || typeof data.text !== 'string') return;
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
  });
  core.links.get(contact)?.peer.send({ type: 'ack', id: data.id });
  flush(core, contact);
  const message = getMessage(data.id, contact);
  if (isNew && !foreground && message) notifyMessage(core, contact, message);
  core.notify();
}

// Le contenu n'est accepté que par le ratchet : ici, seulement des messages de contrôle.
export function receive(core: ChatCore, contact: string, received: unknown) {
  const data = asPayload(received);
  if (!data) return;
  core.lastActivity = Date.now();
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
    core.notify();
  } else if (data.type === 'token' && typeof data.token === 'string' && data.token.length <= 4096) {
    setContactToken(contact, data.token);
  }
}
