import { AppState } from 'react-native';
import { File, FileMode } from 'expo-file-system';
import { from_base64, to_base64 } from 'react-native-libsodium';

import { openBytes, sealBytes } from '../../crypto/box';
import { deleteRelay, downloadRelayChunk, RELAY_CHUNK_BYTES, RELAY_MAX_BYTES, reserveRelay, uploadRelayChunk } from '../../network/relay';
import {
  addMessage,
  addRelayIncoming,
  deleteRelayIncoming,
  deleteUpload,
  finishIncomingFile,
  getMessage,
  getPendingIncomingBytes,
  getRelayIncoming,
  getUndelivered,
  getUpload,
  Message,
  saveUpload,
} from '../database';
import { isValidFileId, storedFile } from '../files';
import { decideOffer } from '../limits';

import { ChatCore } from './core';
import { notifyMessage } from './notify';
import { sendEvent } from './outbox';
import { setProgress } from './transfers';
import { FILE_KEY_BYTES, isCount, isFileKind, Payload } from './types';
import { queuePushAck } from './wake';
import { log } from '../../log';

// Relais chiffré des fichiers : seulement si le contact n'est pas joignable en direct depuis quelques
// secondes. Le fichier est chiffré avec sa clé (celle du transfert direct), découpé en morceaux de
// 512 Ko et rangé dans Firebase ; la clé ne voyage que dans le message chiffré du ratchet.

const RELAY_DELAY_MS = 8 * 1000;
const RELAY_KINDS = ['image', 'video', 'audio', 'file'];
const RELAY_ID = /^[A-Za-z0-9_-]{22}$/;
// Une photo arrive toute seule ; le reste attend un appui sur « Recevoir ».
const AUTO_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const relayContext = (relayId: string, index: number) => `pear-relay-v1.${relayId}.${index}`;
const chunkCount = (size: number) => Math.ceil(size / RELAY_CHUNK_BYTES);
const isConnected = (core: ChatCore, contact: string) => core.links.get(contact)?.status === 'connected';

// Appelée régulièrement (app ouverte) : les fichiers qui n'ont pas pu partir en direct passent par le relais.
export function relayPending(core: ChatCore, contact: string) {
  if (!core.online || isConnected(core, contact)) return;
  for (const message of getUndelivered(contact)) {
    if (!RELAY_KINDS.includes(message.kind) || core.relaying.has(message.id)) continue;
    if (!message.file_uri || !message.file_key || !message.file_size || message.file_size > RELAY_MAX_BYTES) continue;
    if (Date.now() - message.created_at < RELAY_DELAY_MS || getUpload(message.id, contact)?.state === 'uploaded') continue;
    core.relaying.add(message.id);
    upload(core, contact, message)
      .catch((e) => log.warn('envoi par le relais', e))
      .finally(() => core.relaying.delete(message.id));
    // Un fichier à la fois : le réseau n'est pas partagé entre plusieurs envois.
    return;
  }
}

async function upload(core: ChatCore, contact: string, message: Message) {
  const size = message.file_size ?? 0;
  let state = getUpload(message.id, contact);
  if (!state) {
    const reservation = await reserveRelay(size);
    if (!reservation) return;
    state = { file_id: reservation.id, message_id: message.id, contact, parts_done: 0, state: 'uploading', size };
    saveUpload(state);
  }
  const chunks = chunkCount(size);
  const key = from_base64(message.file_key ?? '');
  const handle = new File(message.file_uri ?? '').open(FileMode.ReadOnly);
  try {
    for (let index = state.parts_done; index < chunks; index += 1) {
      // Le contact s'est connecté : le direct reprend la main, le fichier partiel est supprimé.
      if (isConnected(core, contact) || !getMessage(message.id, contact)) {
        await deleteRelay(state.file_id);
        deleteUpload(message.id, contact);
        return;
      }
      handle.offset = index * RELAY_CHUNK_BYTES;
      const plain = await handle.readBytes(Math.min(RELAY_CHUNK_BYTES, size - index * RELAY_CHUNK_BYTES));
      await uploadRelayChunk(state.file_id, index, to_base64(sealBytes(plain, key, relayContext(state.file_id, index))));
      state = { ...state, parts_done: index + 1 };
      saveUpload(state);
      setProgress(core, message.id, (index + 1) / chunks);
    }
  } finally {
    handle.close();
  }
  saveUpload({ ...state, state: 'uploaded' });
  core.progress.delete(message.id);
  // Le destinataire n'est prévenu qu'une fois tout le fichier en ligne.
  sendEvent(core, contact, {
    action: 'relay',
    id: message.id,
    relay: state.file_id,
    size,
    name: message.text,
    mime: message.file_mime,
    kind: message.kind,
    key: message.file_key,
  });
}

// Un fichier annoncé par le relais.
export function receiveRelayOffer(core: ChatCore, contact: string, data: Payload) {
  const { id, relay, size, kind } = data;
  if (!isValidFileId(id) || typeof relay !== 'string' || !RELAY_ID.test(relay) || !isCount(size) || size > RELAY_MAX_BYTES) return;
  if (!isFileKind(kind) || !RELAY_KINDS.includes(kind) || typeof data.name !== 'string') return;
  if (typeof data.key !== 'string' || from_base64(data.key).length !== FILE_KEY_BYTES) return;
  // Déjà reçu (en direct ou par un premier avis) : rien à refaire.
  if (getMessage(id, contact)) return;

  const decision = decideOffer(kind, size, getPendingIncomingBytes(contact));
  if (decision === 'refuse') return;
  const auto = decision === 'accept' && kind === 'image' && size <= AUTO_DOWNLOAD_BYTES;
  addMessage({
    id,
    contact,
    mine: 0,
    text: data.name.slice(0, 255),
    status: auto ? 'receiving' : 'offered',
    created_at: Date.now(),
    kind,
    file_uri: storedFile(id).uri,
    file_size: size,
    file_mime: typeof data.mime === 'string' ? data.mime.slice(0, 255) : null,
    file_key: data.key,
  });
  addRelayIncoming({ file_id: relay, contact, message_id: id, size });
  if (auto) downloadRelayFile(core, contact, id).catch((e) => log.warn('réception par le relais', e));
  else if (AppState.currentState !== 'active') notifyMessage(core, contact);
  core.notify();
}

// Télécharge, déchiffre et écrit le fichier, puis le supprime du relais et confirme la réception.
export async function downloadRelayFile(core: ChatCore, contact: string, id: string) {
  const incoming = getRelayIncoming(id, contact);
  const message = getMessage(id, contact);
  if (!incoming || !message?.file_key || core.relaying.has(id)) return;
  core.relaying.add(id);
  const file = storedFile(id);
  if (file.exists) file.delete();
  file.create();
  const handle = file.open(FileMode.ReadWrite);
  const key = from_base64(message.file_key);
  const chunks = chunkCount(incoming.size);
  try {
    for (let index = 0; index < chunks; index += 1) {
      const data = await downloadRelayChunk(incoming.file_id, index);
      if (!data) throw new Error('Fichier du relais incomplet ou expiré');
      await handle.writeBytes(openBytes(from_base64(data), key, relayContext(incoming.file_id, index)));
      setProgress(core, id, (index + 1) / chunks);
    }
  } finally {
    handle.close();
    core.relaying.delete(id);
  }
  core.progress.delete(id);
  const foreground = AppState.currentState === 'active';
  finishIncomingFile(id, contact, foreground && core.isReading(contact) ? 'read-pending' : 'delivered');
  deleteRelayIncoming(id, contact);
  await deleteRelay(incoming.file_id);
  const peer = core.links.get(contact)?.peer;
  if (peer?.isOpen()) peer.send({ type: 'ack', id });
  else queuePushAck(core, contact, { id });
  if (!foreground) notifyMessage(core, contact);
  core.notify();
}
