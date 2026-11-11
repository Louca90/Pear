import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import {
  addMessage,
  addOutboxEvent,
  getConversationSettings,
  getSetting,
  setConversationSetting,
  setSetting,
  getOutboxEvents,
  getPendingReadReceipts,
  getUpload,
  getUndelivered,
  setFileKey,
  setFileSize,
  setReadReceiptSent,
} from '../database';
import { storedSize } from '../media';
import { parseMeta } from '../meta';

import { ChatCore } from './core';
import { sendSecure } from './secure';
import { FILE_KEY_BYTES } from './types';
import { isSelf } from '../self';
import { DEFAULT_EPHEMERAL, ephemeralSystemText, nextSettingTime, validTtl } from '../ephemeral';
import { fileExtras, textPayload } from './payloads';

// --- Messages éphémères (lot 4.7) ---

const settingTimeKey = (contact: string) => `ephemeral_at.${contact}`;
const lastChoiceKey = (contact: string) => `ephemeral_last.${contact}`;

// La durée de vie des messages envoyés maintenant dans cette conversation (secondes), null si coupé.
export function ephemeralFor(contact: string): number | null {
  return isSelf(contact) ? null : validTtl(getConversationSettings(contact).ephemeral);
}

// La durée à remettre quand on réactive par le geste : la dernière choisie, sinon 1 jour.
export function lastEphemeralChoice(contact: string): number {
  return validTtl(Number(getSetting(lastChoiceKey(contact)))) ?? DEFAULT_EPHEMERAL;
}

// Applique un réglage du minuteur (le nôtre ou celui reçu), daté : un réglage plus ancien que celui
// déjà appliqué est ignoré (événements croisés). Le message système n'apparaît que si la valeur change.
export function applyEphemeral(contact: string, seconds: number, at: number, mine: number): boolean {
  if (at <= Number(getSetting(settingTimeKey(contact)) ?? 0)) return false;
  setSetting(settingTimeKey(contact), String(at));
  const current = getConversationSettings(contact).ephemeral ?? 0;
  setConversationSetting(contact, 'ephemeral', seconds || null);
  if (seconds) setSetting(lastChoiceKey(contact), String(seconds));
  if (current !== seconds) addSystemMessage(contact, mine, ephemeralSystemText(seconds));
  return true;
}

// L'heure d'un réglage fait maintenant sur ce téléphone.
export function ephemeralSettingTime(contact: string) {
  return nextSettingTime(Date.now(), Number(getSetting(settingTimeKey(contact)) ?? 0));
}


import { wakeIfNeeded } from './wake';

export function sendEvent(core: ChatCore, contact: string, event: object) {
  // Notes à moi-même : il n'y a personne à prévenir, rien n'attend dans la file d'envoi.
  if (isSelf(contact)) {
    core.notify();
    return;
  }
  addOutboxEvent(to_base64(randombytes_buf(16)), contact, JSON.stringify(event));
  flush(core, contact);
  wakeIfNeeded(core, contact);
  core.notify();
}

// text décrit l'événement. Vide, c'est le retrait du fond de discussion.
export function addSystemMessage(contact: string, mine: number, text = '', id = to_base64(randombytes_buf(16))) {
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

// Tout ce qui n'a pas été confirmé repart, une fois par connexion : l'autre téléphone ignore les doublons
// grâce à l'id. Dans une même connexion, le canal est fiable : renvoyer ne ferait que consommer des clés.
export function flush(core: ChatCore, contact: string) {
  const peer = core.links.get(contact)?.peer;
  if (!peer) return;
  const epoch = peer.epoch;
  const once = (id: string, send: () => boolean) => {
    if (core.sentOnce.has(contact, epoch, id)) return true;
    if (!send()) return false;
    core.sentOnce.add(contact, epoch, id);
    return true;
  };
  for (const message of getUndelivered(contact)) {
    if (core.sentOnce.has(contact, epoch, message.id)) continue;
    if (message.kind !== 'text') {
      // Déjà déposé dans le relais : le destinataire le télécharge de là, on ne l'envoie pas deux fois.
      if (core.sendingFiles.has(message.id) || getUpload(message.id, contact)?.state === 'uploaded') continue;
      // Réparation : une ancienne version pouvait annoncer une taille plus grande que le fichier,
      // et l'envoi échouait en boucle en arrivant au bout du fichier.
      const realSize = message.file_uri ? storedSize(message.file_uri) : 0;
      if (realSize > 0 && realSize !== message.file_size) {
        setFileSize(message.id, contact, realSize);
        message.file_size = realSize;
      }
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
        camera: message.from_camera === 1,
        forwarded: message.forwarded === 1,
        ...(message.meta ? { meta: parseMeta(message.meta) } : {}),
        ...(message.album ? { album: message.album } : {}),
        ...fileExtras(message),
      };
      if (!once(message.id, () => sendSecure(core, contact, offer))) return;
    } else if (!once(message.id, () => sendSecure(core, contact, textPayload(message)))) {
      return;
    }
  }
  // Après les messages : une modification ou une réaction arrive toujours après ce qu'elle vise.
  for (const event of getOutboxEvents(contact)) {
    if (!once(`event:${event.id}`, () => sendSecure(core, contact, { type: 'event', eventId: event.id, ...JSON.parse(event.payload) }))) return;
  }
  // Les confirmations de lecture restées en attente pendant une coupure partent aussi.
  for (const message of getPendingReadReceipts(contact)) {
    if (!peer.send({ type: 'read', id: message.id })) return;
    setReadReceiptSent(message.id, contact);
  }
}
