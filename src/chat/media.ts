import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { Directory, File, FileHandle, FileMode, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { CHUNK_BYTES, DISK_BATCH_CHUNKS } from '../config';
import { log } from '../log';
import { exportsDirectory } from './cleanup';
import { getStoreKey, getUnfinishedFileIds, pruneStoreKeys, setStoreKey } from './database';
import { filesDirectory, openedDirectory, storedFile, storedFileId, thumbnailsDirectory } from './files';
import { chunkCount, chunkOffset, CHUNK_OVERHEAD, encodeHeader, HEADER_BYTES, openStoreChunk, parseHeader, plainLength, sealStoreChunk } from './sealedFormat';

// Lot 2.3 : les fichiers de pear-files/ sont chiffrés sur le disque, chacun avec sa clé (table
// file_keys de la base chiffrée). Pour les afficher, on les déchiffre dans le cache (pear-open/), vidé
// à la fermeture de la conversation, au passage en arrière-plan et au lancement.

// 4 morceaux du transfert direct : une reprise de réception tombe toujours sur une frontière.
export const STORE_CHUNK_BYTES = 4 * CHUNK_BYTES;
// Lu ou écrit d'un coup sur le disque (8 morceaux, 448 Ko).
const DISK_BATCH = DISK_BATCH_CHUNKS * CHUNK_BYTES;
const KEY_BYTES = 32;
const FILE_NAME = /^[A-Za-z0-9_-]+$/;

// --- Lecture ---

export type StoredReader = {
  // Taille du contenu en clair.
  size: number;
  // false pour un fichier d'avant le lot 2.3, encore en clair.
  sealed: boolean;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): void;
};

// L'id dont la clé chiffre ce fichier : son nom, dans pear-files/ comme dans pear-thumbs/.
function keyIdOf(uri: string): string | null {
  const match = uri.match(/\/pear-(?:files|thumbs)\/([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

function keyFor(id: string): Uint8Array {
  const key = getStoreKey(id);
  if (!key) throw new Error('Clé du fichier introuvable');
  return from_base64(key);
}

function concat(parts: Uint8Array[], total: number) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readHeader(handle: FileHandle): number | null {
  const total = handle.size ?? 0;
  if (total < HEADER_BYTES) return null;
  handle.offset = 0;
  return parseHeader(handle.readBytesSync(HEADER_BYTES));
}

// Lit un fichier stocké, chiffré ou non, à n'importe quelle position : seuls les morceaux nécessaires
// sont déchiffrés.
export function openStored(uri: string, key?: Uint8Array): StoredReader {
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    const total = handle.size ?? 0;
    const chunk = readHeader(handle);
    if (chunk === null) {
      return {
        size: total,
        sealed: false,
        read: async (offset, length) => {
          handle.offset = offset;
          return handle.readBytes(Math.max(0, Math.min(length, total - offset)));
        },
        close: () => handle.close(),
      };
    }
    const id = keyIdOf(uri);
    const fileKey = key ?? (id ? keyFor(id) : null);
    if (!fileKey) throw new Error('Clé du fichier introuvable');
    const size = plainLength(total, chunk);
    if (size < 0) throw new Error('Fichier chiffré incomplet');
    const count = chunkCount(size, chunk);
    return {
      size,
      sealed: true,
      read: async (offset, length) => {
        const end = Math.min(size, offset + length);
        if (end <= offset) return new Uint8Array(0);
        const first = Math.floor(offset / chunk);
        const last = Math.floor((end - 1) / chunk);
        const lastLength = Math.min(chunk, size - last * chunk) + CHUNK_OVERHEAD;
        handle.offset = chunkOffset(first, chunk);
        const sealed = await handle.readBytes(chunkOffset(last, chunk) + lastLength - chunkOffset(first, chunk));
        const parts: Uint8Array[] = [];
        let plainBytes = 0;
        for (let index = first; index <= last; index += 1) {
          const start = chunkOffset(index, chunk) - chunkOffset(first, chunk);
          const sealedLength = Math.min(chunk, size - index * chunk) + CHUNK_OVERHEAD;
          const plain = openStoreChunk(sealed.slice(start, start + sealedLength), fileKey, index, index === count - 1);
          parts.push(plain);
          plainBytes += plain.length;
        }
        const all = concat(parts, plainBytes);
        const skip = offset - first * chunk;
        return all.slice(skip, skip + end - offset);
      },
      close: () => handle.close(),
    };
  } catch (e) {
    handle.close();
    throw e;
  }
}

// Taille du contenu en clair d'un fichier stocké, 0 si elle est illisible. File.size peut renvoyer 0 :
// on lit le fichier ouvert.
export function storedSize(uri: string) {
  try {
    const handle = new File(uri).open(FileMode.ReadOnly);
    try {
      const total = handle.size ?? 0;
      const chunk = readHeader(handle);
      return chunk === null ? total : Math.max(0, plainLength(total, chunk));
    } finally {
      handle.close();
    }
  } catch {
    return 0;
  }
}

function isSealedFile(file: File) {
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      return readHeader(handle) !== null;
    } finally {
      handle.close();
    }
  } catch {
    return false;
  }
}

// --- Écriture ---

export type StoredWriter = {
  // Octets en clair déjà sur le disque (les morceaux incomplets attendent en mémoire).
  readonly written: number;
  append(bytes: Uint8Array): Promise<void>;
  close(): void;
};

// Écrit plainSize octets chiffrés dans file (déjà créé, en-tête compris si startChunk > 0).
function sealedWriter(file: File, key: Uint8Array, plainSize: number, startChunk: number): StoredWriter {
  const chunk = STORE_CHUNK_BYTES;
  const count = chunkCount(plainSize, chunk);
  const handle = file.open(FileMode.ReadWrite);
  let written = Math.min(startChunk * chunk, plainSize);
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  if (startChunk === 0) {
    handle.offset = 0;
    handle.writeBytesSync(encodeHeader(chunk));
  } else {
    handle.offset = chunkOffset(startChunk, chunk);
  }
  return {
    get written() {
      return written;
    },
    async append(bytes) {
      if (written + pendingBytes + bytes.length > plainSize) throw new Error('Fichier plus gros qu’annoncé');
      pending.push(bytes);
      pendingBytes += bytes.length;
      const ready = written + pendingBytes === plainSize ? pendingBytes : pendingBytes - (pendingBytes % chunk);
      if (ready === 0) return;
      const data = concat(pending, pendingBytes);
      const out: Uint8Array[] = [];
      let outBytes = 0;
      for (let offset = 0; offset < ready; offset += chunk) {
        const index = (written + offset) / chunk;
        const sealed = sealStoreChunk(data.slice(offset, Math.min(ready, offset + chunk)), key, index, index === count - 1);
        out.push(sealed);
        outBytes += sealed.length;
      }
      const rest = data.slice(ready);
      pending = rest.length > 0 ? [rest] : [];
      pendingBytes = rest.length;
      await handle.writeBytes(concat(out, outBytes));
      written += ready;
    },
    close: () => handle.close(),
  };
}

function newKey(id: string) {
  const key = randombytes_buf(KEY_BYTES);
  setStoreKey(id, to_base64(key));
  return key;
}

// Crée (ou reprend, resume) le fichier chiffré id, de plainSize octets en clair. Une reprise garde les
// morceaux complets déjà écrits ; un fichier coupé en pleine écriture, ou un ancien fichier partiel en
// clair, repart de zéro.
export function createStored(id: string, plainSize: number, resume: boolean): StoredWriter {
  const file = storedFile(id);
  if (resume && file.exists) {
    const key = getStoreKey(id);
    let total = 0;
    let chunk: number | null = null;
    try {
      const handle = file.open(FileMode.ReadOnly);
      total = handle.size ?? 0;
      chunk = readHeader(handle);
      handle.close();
    } catch (e) {
      log.warn('reprise du fichier', e);
    }
    if (key && chunk === STORE_CHUNK_BYTES) {
      const body = total - HEADER_BYTES;
      const step = chunk + CHUNK_OVERHEAD;
      if (plainLength(total, chunk) === plainSize) return sealedWriter(file, from_base64(key), plainSize, chunkCount(plainSize, chunk));
      if (body % step === 0) return sealedWriter(file, from_base64(key), plainSize, body / step);
    }
  }
  // Clé et fichier créés d'un trait (sans attente) : le nettoyage des clés ne peut pas passer entre les deux.
  const key = newKey(id);
  file.create({ overwrite: true });
  return sealedWriter(file, key, plainSize, 0);
}

// Chiffre tout le contenu de reader dans file avec key.
async function sealInto(reader: StoredReader, file: File, key: Uint8Array) {
  const writer = sealedWriter(file, key, reader.size, 0);
  try {
    for (let offset = 0; offset < reader.size; offset += DISK_BATCH) {
      const data = await reader.read(offset, DISK_BATCH);
      if (data.length === 0) throw new Error('Fin de fichier inattendue');
      await writer.append(data);
    }
  } finally {
    writer.close();
  }
}

// Déchiffre tout le fichier uri dans destination.
async function decryptTo(uri: string, destination: File) {
  const reader = openStored(uri);
  try {
    destination.create({ overwrite: true, intermediates: true });
    const handle = destination.open(FileMode.WriteOnly);
    try {
      for (let offset = 0; offset < reader.size; offset += DISK_BATCH) {
        const data = await reader.read(offset, DISK_BATCH);
        if (data.length === 0) throw new Error('Fin de fichier inattendue');
        await handle.writeBytes(data);
      }
    } finally {
      handle.close();
    }
  } finally {
    reader.close();
  }
}

// Range un fichier à envoyer dans pear-files/, chiffré. Un fichier de Pear (transfert à un autre
// contact) est copié tel quel avec sa clé. Un fichier de notre cache est effacé une fois chiffré, sauf
// keepSource (le même fichier part ensuite à un autre contact) ; le reste, comme une photo de la
// galerie, n'est jamais touché.
export async function storeOutgoingFile(sourceUri: string, id: string, keepSource = false): Promise<string> {
  const destination = storedFile(id);
  const sourceId = storedFileId(sourceUri);
  const sourceKey = sourceId ? getStoreKey(sourceId) : null;
  try {
    if (sourceKey && isSealedFile(new File(sourceUri))) {
      setStoreKey(id, sourceKey);
      destination.create({ overwrite: true });
      await new File(sourceUri).copy(destination, { overwrite: true });
      return destination.uri;
    }
    const reader = openStored(sourceUri);
    try {
      const key = newKey(id);
      destination.create({ overwrite: true });
      await sealInto(reader, destination, key);
    } finally {
      reader.close();
    }
  } catch (e) {
    if (destination.exists) destination.delete();
    throw e;
  }
  if (!keepSource && sourceUri.startsWith(Paths.cache.uri)) {
    try {
      new File(sourceUri).delete();
    } catch (e) {
      log.warn('suppression du fichier de passage', e);
    }
  }
  return destination.uri;
}

// --- Copies déchiffrées ---

export type OpenScope = 'conversation' | 'app';
type Opened = { promise: Promise<string>; target: string | null; scope: OpenScope; generation: number };

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

const opened = new Map<string, Opened>();
const resolved = new Map<string, string>();
let generation = 0;
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

// Nom de la copie déchiffrée : l'id, et l'extension du type quand on la connaît (certains lecteurs s'en servent).
function openedName(uri: string, mime?: string | null) {
  const thumbnail = uri.match(/\/pear-thumbs\/([A-Za-z0-9_-]+)$/);
  if (thumbnail) return `${thumbnail[1]}-thumb.jpg`;
  const id = storedFileId(uri);
  if (!id) return null;
  const extension = mime ? EXTENSIONS[mime.toLowerCase()] : undefined;
  return extension ? `${id}.${extension}` : id;
}

// Une copie déchiffrée de uri, lisible par les lecteurs (photo, vidéo, vocal). Une uri hors de Pear,
// ou un ancien fichier encore en clair, est renvoyée telle quelle.
export function openMedia(uri: string, options: { mime?: string | null; scope?: OpenScope } = {}): Promise<string> {
  const scope = options.scope ?? 'conversation';
  const existing = opened.get(uri);
  if (existing) {
    if (scope === 'app') existing.scope = 'app';
    return existing.promise;
  }
  const name = keyIdOf(uri) ? openedName(uri, options.mime) : null;
  const entry: Opened = { promise: Promise.resolve(uri), target: null, scope, generation };
  if (name) {
    entry.target = name;
    entry.promise = (async () => {
      if (!isSealedFile(new File(uri))) return uri;
      const destination = new File(openedDirectory(), name);
      if (!destination.exists) {
        // Écrit à côté puis renommé : une copie à moitié écrite n'est jamais lue.
        const part = new File(openedDirectory(), `${name}.${to_base64(randombytes_buf(6))}.part`);
        try {
          await decryptTo(uri, part);
          await part.move(destination, { overwrite: true });
        } catch (e) {
          if (part.exists) part.delete();
          throw e;
        }
      }
      return destination.uri;
    })();
  }
  opened.set(uri, entry);
  entry.promise.then(
    (result) => {
      if (opened.get(uri) === entry && entry.generation === generation) resolved.set(uri, result);
    },
    () => {
      if (opened.get(uri) === entry) opened.delete(uri);
    },
  );
  return entry.promise;
}

function forget(uri: string) {
  opened.delete(uri);
  resolved.delete(uri);
}

// Efface les copies déchiffrées : celles des conversations, ou toutes (arrière-plan, lancement).
export function clearOpenedMedia(scope: 'conversation' | 'all') {
  generation += 1;
  if (scope === 'all') {
    opened.clear();
    resolved.clear();
    try {
      const directory = new Directory(Paths.cache, 'pear-open');
      if (directory.exists) directory.delete();
    } catch (e) {
      log.warn('vidage des médias ouverts', e);
    }
  } else {
    for (const [uri, entry] of [...opened]) {
      if (entry.scope === 'app') continue;
      forget(uri);
      if (!entry.target) continue;
      try {
        const file = new File(openedDirectory(), entry.target);
        if (file.exists) file.delete();
      } catch (e) {
        log.warn('vidage des médias ouverts', e);
      }
    }
  }
  changed();
}

// Une conversation (ou la fiche d'un contact) est ouverte : ses médias déchiffrés restent jusqu'à ce
// que le dernier écran qui les montre se ferme.
let retained = 0;
export function retainOpenedMedia() {
  retained += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    retained -= 1;
    if (retained === 0) clearOpenedMedia('conversation');
  };
}

AppState.addEventListener('change', (state) => {
  if (state === 'background') clearOpenedMedia('all');
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// L'uri à afficher pour un fichier de Pear : null pendant le déchiffrement. Après un vidage du cache, la
// copie est refaite toute seule (même chemin : l'image affichée ne clignote pas).
export function useMediaUri(uri: string | null | undefined, options: { mime?: string | null; scope?: OpenScope } = {}): string | null {
  const current = useSyncExternalStore(subscribe, () => version);
  const [state, setState] = useState<{ uri: string; source: string } | null>(null);
  const mime = options.mime;
  const scope = options.scope;
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    openMedia(uri, { mime, scope })
      .then((source) => {
        if (!cancelled) setState({ uri, source });
      })
      .catch((e) => log.warn('ouverture du média', e));
    return () => {
      cancelled = true;
    };
  }, [uri, mime, scope, current]);
  if (!uri) return null;
  if (state?.uri === uri) return state.source;
  return resolved.get(uri) ?? null;
}

type PreviewSource = { id: string; kind: string; file_uri: string | null; file_mime: string | null; view_once?: number };

// L'image à montrer pour une photo (sa copie déchiffrée) ou une vidéo (sa miniature) : null pendant la
// préparation, et pour tout autre type de message.
export function useMediaPreview(message: PreviewSource): string | null {
  const current = useSyncExternalStore(subscribe, () => version);
  const [state, setState] = useState<{ key: string; source: string } | null>(null);
  const { id, kind, file_uri: uri, file_mime: mime } = message;
  // Un média à vue unique n'a jamais d'aperçu (bulle, citation, épinglé) : il ne s'ouvre que dans la visionneuse.
  const key = uri && !message.view_once && (kind === 'image' || kind === 'video') ? `${kind}:${id}:${uri}` : null;
  useEffect(() => {
    if (!key || !uri) return;
    let cancelled = false;
    const pending = kind === 'video' ? videoThumbnail(id, uri) : openMedia(uri, { mime });
    pending
      .then((source) => {
        if (!cancelled) setState({ key, source });
      })
      .catch((e) => log.warn('aperçu du média', e));
    return () => {
      cancelled = true;
    };
  }, [key, id, kind, uri, mime, current]);
  if (!key) return null;
  if (state?.key === key) return state.source;
  return kind === 'image' && uri ? (resolved.get(uri) ?? null) : null;
}

// --- Copies pour les autres apps ---

// Copie temporaire déchiffrée avec le vrai nom, pour l'ouvrir dans une autre app. Rangée dans le dossier
// des exports, vidé au lancement suivant.
export async function exportCopy(uri: string, name: string): Promise<string> {
  const safeName = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'fichier';
  const copy = new File(exportsDirectory(), safeName);
  if (keyIdOf(uri) && isSealedFile(new File(uri))) await decryptTo(uri, copy);
  else await new File(uri).copy(copy, { overwrite: true });
  return copy.uri;
}

// Copie le média dans la galerie du téléphone, seulement quand on le demande.
export async function saveToGallery(uri: string, name: string) {
  const { granted } = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
  if (!granted) throw new Error("L'accès à la galerie a été refusé.");
  await MediaLibrary.saveToLibraryAsync(await exportCopy(uri, name));
}

// La miniature d'une vidéo est faite une fois, puis gardée chiffrée (avec la clé de la vidéo) dans
// pear-thumbs/ ; seule cette petite image est déchiffrée ensuite.
const thumbnails = new Map<string, Promise<string>>();
export function videoThumbnail(id: string, uri: string): Promise<string> {
  const thumbnail = new File(thumbnailsDirectory(), id);
  if (thumbnail.exists) return openMedia(thumbnail.uri);
  let pending = thumbnails.get(id);
  if (!pending) {
    pending = (async () => {
      const video = await openMedia(uri, { mime: 'video/mp4' });
      const generated = new File((await getThumbnailAsync(video, { time: 0 })).uri);
      const key = getStoreKey(id);
      if (!key || !isSealedFile(new File(uri))) {
        // Ancienne vidéo encore en clair : miniature de passage, refaite après la migration.
        const copy = new File(openedDirectory(), `${id}-thumb.jpg`);
        await generated.move(copy, { overwrite: true });
        return copy.uri;
      }
      const reader = openStored(generated.uri);
      try {
        thumbnail.create({ overwrite: true });
        await sealInto(reader, thumbnail, from_base64(key));
      } catch (e) {
        if (thumbnail.exists) thumbnail.delete();
        throw e;
      } finally {
        reader.close();
        generated.delete();
      }
      return openMedia(thumbnail.uri);
    })();
    thumbnails.set(id, pending);
    pending.finally(() => thumbnails.delete(id)).catch(() => undefined);
  }
  return pending;
}

// --- Migration des fichiers d'avant le lot 2.3 ---

let migrating = false;

// Chiffre en tâche de fond les fichiers encore en clair, un à la fois. Chaque étape laisse un état
// relisible si l'app est tuée : X.sealing (copie chiffrée en cours), puis X.plain (original gardé
// jusqu'à ce que la copie chiffrée soit en place).
export async function migrateStoredFiles() {
  if (migrating) return;
  migrating = true;
  let sealed = 0;
  try {
    const directory = filesDirectory();
    recoverInterrupted(directory);
    const unfinished = getUnfinishedFileIds();
    const files = directory.list().filter((entry): entry is File => entry instanceof File && FILE_NAME.test(entry.name));
    for (const file of files) {
      if (unfinished.has(file.name) || !file.exists || isSealedFile(file)) continue;
      try {
        await sealInPlace(directory, file.name);
        sealed += 1;
      } catch (e) {
        log.warn('chiffrement d’un ancien fichier', e);
      }
    }
    // Liste et nettoyage d'un trait : aucune clé neuve ne peut apparaître entre les deux.
    const existing = new Set(directory.list().map((entry) => entry.name));
    const pruned = pruneStoreKeys(existing);
    if (sealed > 0 || pruned > 0) log.info('fichiers chiffrés', `${sealed} chiffrés, ${pruned} clés retirées`);
  } catch (e) {
    log.warn('chiffrement des anciens fichiers', e);
  } finally {
    migrating = false;
  }
}

function recoverInterrupted(directory: Directory) {
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) continue;
    try {
      if (entry.name.endsWith('.sealing')) {
        entry.delete();
      } else if (entry.name.endsWith('.plain')) {
        const name = entry.name.slice(0, -'.plain'.length);
        const target = new File(directory, name);
        if (target.exists && isSealedFile(target)) {
          entry.delete();
        } else {
          if (target.exists) target.delete();
          entry.rename(name);
        }
      }
    } catch (e) {
      log.warn('reprise du chiffrement', e);
    }
  }
}

async function sealInPlace(directory: Directory, name: string) {
  const original = new File(directory, name);
  const sealing = new File(directory, `${name}.sealing`);
  const key = newKey(name);
  sealing.create({ overwrite: true });
  const reader = openStored(original.uri);
  try {
    await sealInto(reader, sealing, key);
  } catch (e) {
    if (sealing.exists) sealing.delete();
    throw e;
  } finally {
    reader.close();
  }
  // Supprimé pendant le chiffrement (message effacé) : rien à remplacer.
  if (!original.exists) {
    sealing.delete();
    return;
  }
  // Les trois étapes s'enchaînent sans attente.
  new File(directory, name).rename(`${name}.plain`);
  new File(directory, `${name}.sealing`).rename(name);
  new File(directory, `${name}.plain`).delete();
  // Une copie « en clair » déjà renvoyée pointe maintenant vers un fichier chiffré : on l'oublie.
  forget(storedFile(name).uri);
  changed();
}
