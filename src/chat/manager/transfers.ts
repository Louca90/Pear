import { AppState } from 'react-native';
import { File, FileMode, Paths } from 'expo-file-system';
import { from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { openBytes, sealBytes } from '../../crypto/box';
import {
  addMessage,
  deleteOldAvatars,
  finishIncomingFile,
  getMessage,
  MessageKind,
  setContactProfileField,
  setConversationSetting,
} from '../database';
import { CHUNK_BYTES, deleteStoredFile, isValidFileId, MAX_FILE_BYTES, storedFile, storeOutgoingFile } from '../files';

import { ChatCore } from './core';
import { notifyMessage } from './notify';
import { flush } from './outbox';
import {
  CHUNK_INDEX_BYTES,
  DISK_BATCH_BYTES,
  FILE_ID_BYTES,
  FILE_KEY_BYTES,
  fileContext,
  IncomingFile,
  PickedFile,
  PROGRESS_NOTIFY_MS,
  SEND_WINDOW_CHUNKS,
  WINDOW_POLL_MS,
} from './types';
import { wakeIfNeeded } from './wake';

export async function sendFile(core: ChatCore, contact: string, file: PickedFile) {
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
  flush(core, contact);
  wakeIfNeeded(core, contact);
  core.notify();
  return uri;
}

export function dropIncomingFile(core: ChatCore, contact: string, id: string) {
  const incoming = core.incomingFiles.get(id);
  if (incoming?.contact !== contact) return;
  core.incomingFiles.delete(id);
  core.progress.delete(id);
  core.writeQueue = core.writeQueue.then(() => incoming.handle.close()).catch((e) => console.warn('Pear écriture du fichier :', e));
}

export function setProgress(core: ChatCore, id: string, value: number) {
  core.progress.set(id, value);
  core.lastActivity = Date.now();
  if (Date.now() - core.lastProgressNotify > PROGRESS_NOTIFY_MS) {
    core.lastProgressNotify = Date.now();
    core.notify();
  }
}

// Lit le fichier morceau par morceau : il n'est jamais chargé en entier en mémoire.
export async function streamFile(core: ChatCore, contact: string, id: string, from: number) {
  const peer = core.links.get(contact)?.peer;
  const message = getMessage(id, contact);
  if (!peer || message?.mine !== 1 || !message.file_uri || !message.file_key || core.sendingFiles.has(id)) return;
  if (message.status === 'delivered' || message.status === 'read') return;

  core.sendingFiles.add(id);
  const size = message.file_size ?? 0;
  const idBytes = from_base64(id);
  const key = from_base64(message.file_key);
  const context = fileContext(id);
  const epoch = peer.epoch;
  const handle = new File(message.file_uri).open(FileMode.ReadOnly);
  core.confirmedChunks.set(id, from);
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
        while (index - (core.confirmedChunks.get(id) ?? from) >= SEND_WINDOW_CHUNKS) {
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
    core.sendingFiles.delete(id);
    core.confirmedChunks.delete(id);
  }
}

export function receiveFileOffer(core: ChatCore, contact: string, data: any) {
  const peer = core.links.get(contact)?.peer;
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

  let incoming = core.incomingFiles.get(data.id);
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
    core.incomingFiles.set(data.id, incoming);
  }

  if (incoming.received >= size) finishFile(core, contact, data.id, incoming);
  else peer.send({ type: 'file-resume', id: data.id, from: incoming.next });
  core.notify();
}

export async function receiveChunk(core: ChatCore, contact: string, bytes: Uint8Array) {
  const id = to_base64(bytes.slice(0, FILE_ID_BYTES));
  const incoming = core.incomingFiles.get(id);
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
    await writePending(incoming);
    if (!complete) core.links.get(contact)?.peer.send({ type: 'file-ack', id, next: incoming.next });
  }
  if (complete) finishFile(core, contact, id, incoming);
  else setProgress(core, id, incoming.received / incoming.size);
}

async function writePending(incoming: IncomingFile) {
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

function finishFile(core: ChatCore, contact: string, id: string, incoming: IncomingFile) {
  incoming.handle.close();
  core.incomingFiles.delete(id);
  core.progress.delete(id);
  const foreground = AppState.currentState === 'active';
  finishIncomingFile(id, contact, foreground && core.openConversation === contact ? 'read-pending' : 'delivered');
  core.links.get(contact)?.peer.send({ type: 'file-done', id });
  flush(core, contact);
  const message = getMessage(id, contact);
  if (message?.kind === 'wallpaper') {
    setConversationSetting(contact, 'wallpaper_uri', message.file_uri);
  } else if (message?.kind === 'avatar') {
    setContactProfileField(contact, 'photo_uri', message.file_uri);
    deleteOldAvatars(contact, 0, id);
  }
  if (!foreground && message && message.kind !== 'avatar') notifyMessage(core, contact, message);
  core.notify();
}

export function closeIncomingFiles(core: ChatCore) {
  // Ce qui attend encore d'être écrit passe après les écritures en cours : rien n'est perdu.
  const files = [...core.incomingFiles.values()];
  core.incomingFiles.clear();
  core.writeQueue = core.writeQueue
    .then(async () => {
      for (const incoming of files) {
        await writePending(incoming);
        incoming.handle.close();
      }
    })
    .catch((e) => console.warn('Pear écriture du fichier :', e));
}
