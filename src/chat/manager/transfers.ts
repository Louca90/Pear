import { AppState } from 'react-native';
import { FileMode, Paths } from 'expo-file-system';
import { from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { openBytes, sealBytes } from '../../crypto/box';
import {
  addMessage,
  deleteFileAndKey,
  deleteOldAvatars,
  finishIncomingFile,
  getMessage,
  getPendingIncomingBytes,
  getRelayIncoming,
  setContactProfileField,
  setConversationSetting,
  setFileSize,
  setIncomingStatus,
} from '../database';
import { CHUNK_BYTES, isValidFileId, MAX_FILE_BYTES, storedFile, storedFileId } from '../files';
import { makeBlurThumb } from '../thumb';
import { isSelf } from '../self';
import { expiryFor, validTtl } from '../ephemeral';
import { ephemeralFor } from './outbox';
import { createStored, openStored, StoredReader, STORE_CHUNK_BYTES, storedSize, storeOutgoingFile } from '../media';
import { sealedLength } from '../sealedFormat';
import { encodeMeta, sanitizeMeta } from '../meta';

import { decideOffer } from '../limits';
import { clearFileProgress, showFilePaused, showFileProgress } from '../notifications';

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
  isCount,
  isFileKind,
  Payload,
  PickedFile,
  PROGRESS_NOTIFY_MS,
  SEND_WINDOW_CHUNKS,
  WINDOW_POLL_MS,
} from './types';
import { wakeIfNeeded } from './wake';
import { log } from '../../log';

export async function sendFile(core: ChatCore, contact: string, file: PickedFile) {
  const id = to_base64(randombytes_buf(FILE_ID_BYTES));
  // Miniature floue (lot 4.4) : faite avant le rangement, tant que le fichier est encore lisible tel
  // quel. Un fichier transféré garde celle du message d'origine ; un sticker n'en a pas.
  // Un média à vue unique n'a pas de miniature : rien ne doit en rester.
  const once = file.once === true && !isSelf(contact) && (file.kind === 'image' || file.kind === 'video');
  if (once) file = { ...file, meta: undefined, album: undefined };
  else if (!file.meta?.thumb && !file.meta?.sticker && !storedFileId(file.uri)) {
    const thumb = await makeBlurThumb(file.uri, file.kind);
    if (thumb) file = { ...file, meta: { ...file.meta, thumb } };
  }
  const uri = await storeOutgoingFile(file.uri, id, file.keepSource);
  // Seule la taille du fichier stocké compte : le sélecteur donne parfois celle de l'original avant
  // compression (photo réduite par quality).
  const size = storedSize(uri) || file.size;
  if (size === 0) {
    deleteFileAndKey(uri);
    throw new Error('Ce fichier semble vide.');
  }
  const now = Date.now();
  // Fond et photo de profil ne sont pas des messages : ils ne s'effacent pas avec le minuteur.
  const ttl = file.kind === 'wallpaper' || file.kind === 'avatar' ? null : ephemeralFor(contact);
  addMessage({
    id,
    contact,
    mine: 1,
    text: file.name,
    // Notes à moi-même : le fichier est rangé, il ne part nulle part.
    status: isSelf(contact) ? 'read' : 'sending',
    created_at: now,
    expires_at: expiryFor(now, ttl),
    view_once: once ? 1 : 0,
    kind: file.kind,
    file_uri: uri,
    file_size: size,
    file_mime: file.mime,
    from_camera: file.fromCamera ? 1 : 0,
    forwarded: file.forwarded ? 1 : 0,
    conn_session: core.sessionFor(contact),
    meta: encodeMeta(file.meta),
    album: file.album ?? null,
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
  clearFileProgress(id);
  core.writeQueue = core.writeQueue.then(() => incoming.writer.close()).catch((e) => log.warn('écriture du fichier', e));
}

export function setProgress(core: ChatCore, id: string, value: number) {
  core.progress.set(id, value);
  core.lastActivity = Date.now();
  if (Date.now() - core.lastProgressNotify > PROGRESS_NOTIFY_MS) {
    core.lastProgressNotify = Date.now();
    core.notify();
    // App en arrière-plan : un fichier reçu montre sa progression dans une notification.
    // Seulement les fichiers qu'on a vraiment demandé à voir : pas la photo de profil ni le fond d'écran,
    // qui arrivent tout seuls.
    const incoming = core.incomingFiles.get(id);
    const kind = incoming ? getMessage(id, incoming.contact)?.kind : undefined;
    if (incoming && kind !== 'avatar' && kind !== 'wallpaper' && AppState.currentState !== 'active') {
      showFileProgress(id, core.names.get(incoming.contact) ?? 'Pear', value);
    }
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
  const uri = message.file_uri;
  let reader: StoredReader | null = null;
  core.confirmedChunks.set(id, from);
  try {
    // Le fichier est déchiffré morceau par morceau (lot 2.3), puis rechiffré avec la clé du transfert.
    reader = openStored(uri);
    let index = from;
    while (index * CHUNK_BYTES < size) {
      // Le message a été supprimé pendant l'envoi, ou l'autre a refusé le fichier : on arrête.
      const current = getMessage(id, contact);
      if (!current || current.status === 'refused') return;
      const batch = await reader.read(index * CHUNK_BYTES, Math.min(DISK_BATCH_BYTES, size - index * CHUNK_BYTES));
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
    log.warn('envoi du fichier', e);
  } finally {
    reader?.close();
    core.sendingFiles.delete(id);
    core.confirmedChunks.delete(id);
  }
}

export function receiveFileOffer(core: ChatCore, contact: string, data: Payload) {
  const peer = core.links.get(contact)?.peer;
  const size = data.size;
  if (!peer || !isValidFileId(data.id) || typeof data.name !== 'string' || !isFileKind(data.kind)) return;
  if (!isCount(size) || size > MAX_FILE_BYTES) return;
  if (typeof data.key !== 'string' || from_base64(data.key).length !== FILE_KEY_BYTES) return;

  // Le même fichier arrive par le relais : on ne le reçoit pas une deuxième fois en direct.
  if (getRelayIncoming(data.id, contact)) return;
  const existing = getMessage(data.id, contact);
  if (existing?.status === 'refused') {
    peer.send({ type: 'file-refused', id: data.id });
    return;
  }
  // Proposé et pas encore accepté : il attend notre accord.
  if (existing?.status === 'offered') return;
  if (existing && existing.status !== 'receiving') {
    peer.send({ type: 'file-done', id: data.id });
    return;
  }

  if (!existing) {
    // Un fichier trop lourd ne s'installe pas tout seul : on demande, ou on refuse (photo de profil, fond).
    const decision = decideOffer(data.kind, size, getPendingIncomingBytes(contact));
    if (decision === 'refuse') {
      log.warn('fichier refusé (trop lourd)', `${data.kind} ${size}`);
      peer.send({ type: 'file-refused', id: data.id });
      return;
    }
    addMessage({
      id: data.id,
      contact,
      mine: 0,
      text: data.name.slice(0, 255),
      status: decision === 'ask' ? 'offered' : 'receiving',
      created_at: Date.now(),
      kind: data.kind,
      file_uri: storedFile(data.id).uri,
      file_size: size,
      file_mime: typeof data.mime === 'string' ? data.mime.slice(0, 255) : null,
      file_key: data.key,
      from_camera: data.camera === true ? 1 : 0,
      forwarded: data.forwarded === true ? 1 : 0,
      conn_session: core.sessionFor(contact),
      meta: encodeMeta(sanitizeMeta(data.meta)),
      album: isValidFileId(data.album) ? data.album : null,
      expires_at: expiryFor(Date.now(), validTtl(data.ttl)),
      view_once: data.once === true && (data.kind === 'image' || data.kind === 'video') ? 1 : 0,
    });
    if (decision === 'ask') {
      const message = getMessage(data.id, contact);
      if (message && AppState.currentState !== 'active') notifyMessage(core, contact, message.created_at);
      core.notify();
      return;
    }
  } else if (existing.file_size !== size) {
    // L'expéditeur a corrigé la taille annoncée : on attend la vraie.
    setFileSize(data.id, contact, size);
  }
  startReceiving(core, contact, data.id, size);
}

// Ouvre (ou reprend) l'écriture du fichier et demande la suite à l'expéditeur.
function startReceiving(core: ChatCore, contact: string, id: string, size: number) {
  const peer = core.links.get(contact)?.peer;
  const message = getMessage(id, contact);
  if (!peer || !message?.file_key) return;
  let incoming = core.incomingFiles.get(id);
  if (!incoming) {
    const file = storedFile(id);
    let partialSize = 0;
    if (file.exists) {
      const partial = file.open(FileMode.ReadOnly);
      partialSize = partial.size ?? 0;
      partial.close();
    }
    if (sealedLength(size, STORE_CHUNK_BYTES) - partialSize > Paths.availableDiskSpace) {
      log.warn('pas assez de place pour recevoir un fichier');
      return;
    }
    // Reprise : les morceaux déjà écrits (chiffrés sur le disque) ne sont pas redemandés.
    const writer = createStored(id, size, true);
    const next = Math.floor(writer.written / CHUNK_BYTES);
    // En cas de reprise, la clé du transfert reste celle du début du fichier.
    incoming = { contact, key: from_base64(message.file_key), writer, size, next, received: writer.written >= size ? size : next * CHUNK_BYTES, pending: [], pendingBytes: 0 };
    core.incomingFiles.set(id, incoming);
  }

  if (incoming.received >= size) finishFile(core, contact, id, incoming);
  else peer.send({ type: 'file-resume', id, from: incoming.next });
  core.notify();
}

// Fichier proposé accepté : la réception démarre tout de suite si l'autre est connecté, sinon à sa
// prochaine offre (il la renvoie à chaque connexion).
export function acceptFile(core: ChatCore, contact: string, id: string) {
  setIncomingStatus(id, contact, 'offered', 'receiving');
  const message = getMessage(id, contact);
  if (message?.status === 'receiving' && message.file_size !== null) startReceiving(core, contact, id, message.file_size);
  core.notify();
}

export function refuseFile(core: ChatCore, contact: string, id: string) {
  setIncomingStatus(id, contact, 'offered', 'refused');
  core.links.get(contact)?.peer.send({ type: 'file-refused', id });
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
  // Plus gros que la taille annoncée : on coupe, le fichier ne remplira pas le téléphone.
  if (incoming.received + data.length > incoming.size) {
    log.warn("fichier plus gros qu'annoncé, réception coupée");
    dropIncomingFile(core, contact, id);
    deleteFileAndKey(storedFile(id).uri);
    setIncomingStatus(id, contact, 'receiving', 'refused');
    core.links.get(contact)?.peer.send({ type: 'file-refused', id });
    core.notify();
    return;
  }
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
  await incoming.writer.append(batch);
}

function finishFile(core: ChatCore, contact: string, id: string, incoming: IncomingFile) {
  incoming.writer.close();
  core.incomingFiles.delete(id);
  core.progress.delete(id);
  clearFileProgress(id);
  const foreground = AppState.currentState === 'active';
  finishIncomingFile(id, contact, foreground && core.isReading(contact) ? 'read-pending' : 'delivered');
  core.links.get(contact)?.peer.send({ type: 'file-done', id });
  flush(core, contact);
  const message = getMessage(id, contact);
  if (message?.kind === 'wallpaper') {
    setConversationSetting(contact, 'wallpaper_uri', message.file_uri);
  } else if (message?.kind === 'avatar') {
    setContactProfileField(contact, 'photo_uri', message.file_uri);
    deleteOldAvatars(contact, 0, id);
  }
  if (!foreground && message && message.kind !== 'avatar') notifyMessage(core, contact);
  core.notify();
}

export function closeIncomingFiles(core: ChatCore) {
  // Ce qui attend encore d'être écrit passe après les écritures en cours : rien n'est perdu.
  const ids = [...core.incomingFiles.keys()];
  const files = [...core.incomingFiles.values()];
  // Coupé en pleine réception, app fermée : la barre disparaît et on le dit.
  if (files.length > 0 && AppState.currentState !== 'active') showFilePaused();
  else ids.forEach(clearFileProgress);
  core.incomingFiles.clear();
  core.writeQueue = core.writeQueue
    .then(async () => {
      for (const incoming of files) {
        await writePending(incoming);
        incoming.writer.close();
      }
    })
    .catch((e) => log.warn('écriture du fichier', e));
}
