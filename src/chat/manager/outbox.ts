import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import {
  addMessage,
  addOutboxEvent,
  getOutboxEvents,
  getPendingReadReceipts,
  getUndelivered,
  setFileKey,
  setReadReceiptSent,
} from '../database';

import { ChatCore } from './core';
import { sendSecure } from './secure';
import { FILE_KEY_BYTES } from './types';
import { wakeIfNeeded } from './wake';

export function sendEvent(core: ChatCore, contact: string, event: object) {
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

// Tout ce qui n'a pas été confirmé repart : l'autre téléphone ignore les doublons grâce à l'id.
export function flush(core: ChatCore, contact: string) {
  const peer = core.links.get(contact)?.peer;
  if (!peer) return;
  for (const message of getUndelivered(contact)) {
    if (message.kind !== 'text') {
      if (core.sendingFiles.has(message.id)) continue;
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
      if (!sendSecure(core, contact, offer)) return;
    } else if (!sendSecure(core, contact, { type: 'message', id: message.id, text: message.text, reply_to: message.reply_to })) {
      return;
    }
  }
  // Après les messages : une modification ou une réaction arrive toujours après ce qu'elle vise.
  for (const event of getOutboxEvents(contact)) {
    if (!sendSecure(core, contact, { type: 'event', eventId: event.id, ...JSON.parse(event.payload) })) return;
  }
  // Les confirmations de lecture restées en attente pendant une coupure partent aussi.
  for (const message of getPendingReadReceipts(contact)) {
    if (!peer.send({ type: 'read', id: message.id })) return;
    setReadReceiptSent(message.id, contact);
  }
}
