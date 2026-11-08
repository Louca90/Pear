import { FileHandle } from 'expo-file-system';

import { PeerLink, PeerStatus, RouteType } from '../../network/peer';
import { CHUNK_BYTES } from '../files';
import { MessageKind } from '../database';
import { DISK_BATCH_CHUNKS, MAX_PROFILE_NAME_LENGTH, MAX_REACTION_LENGTH, MAX_SAVED_ID_LENGTH, MAX_TEXT_LENGTH, OFFLINE_DELAY_MS, PROGRESS_NOTIFY_MS, SEND_WINDOW_CHUNKS, WAKE_CHECK_MS, WAKE_INTERVAL_MS, WINDOW_POLL_MS } from '../../config';

export { MAX_PROFILE_NAME_LENGTH, MAX_REACTION_LENGTH, MAX_SAVED_ID_LENGTH, MAX_TEXT_LENGTH, OFFLINE_DELAY_MS, PROGRESS_NOTIFY_MS, SEND_WINDOW_CHUNKS, WAKE_CHECK_MS, WAKE_INTERVAL_MS, WINDOW_POLL_MS };

// Un morceau de fichier : l'id du fichier (16 octets), puis son numéro (4 octets) et ses données, chiffrés.
export const FILE_ID_BYTES = 16;
export const CHUNK_INDEX_BYTES = 4;
export const FILE_KEY_BYTES = 32;
export const DISK_BATCH_BYTES = DISK_BATCH_CHUNKS * CHUNK_BYTES;
export const PROFILE_NAME = 'profile_name';
export const PROFILE_PHOTO = 'profile_photo';
// Change à chaque modification du profil : un contact qui n'a pas la dernière version la recevra.
export const PROFILE_VERSION = 'profile_version';

export type Link = {
  peer: PeerLink;
  status: PeerStatus;
  route: RouteType | null;
  secret: Uint8Array;
};

export type IncomingFile = {
  contact: string;
  key: Uint8Array;
  handle: FileHandle;
  size: number;
  next: number;
  received: number;
  // Morceaux reçus, pas encore écrits sur le disque.
  pending: Uint8Array[];
  pendingBytes: number;
};

export type PickedFile = {
  uri: string;
  name: string;
  size: number;
  mime: string | null;
  kind: MessageKind;
  // Pris avec la caméra de Pear : compte pour les séries.
  fromCamera?: boolean;
  // Transféré depuis une autre conversation.
  forwarded?: boolean;
  // Le même fichier part ensuite à un autre contact : copié, jamais déplacé.
  keepSource?: boolean;
};

// Après un envoi ou une réception, la connexion reste ouverte un moment : la réponse arrive souvent vite.
export const AFTER_SEND_MS = 45 * 1000;
export const AFTER_ACTIVITY_MS = 2 * 60 * 1000;

// Ce qui arrive de l'autre téléphone n'est jamais supposé valide : chaque champ est vérifié avant usage.
export type Payload = Record<string, unknown>;

export { isSupportedVersion, PROTOCOL_VERSION, UPDATE_REQUIRED } from '../protocol';

export function asPayload(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Payload) : null;
}

// Un entier positif ou nul (taille, numéro de morceau).
export function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const FILE_KINDS: MessageKind[] = ['image', 'video', 'audio', 'file', 'wallpaper', 'avatar'];

export function isFileKind(value: unknown): value is MessageKind {
  return FILE_KINDS.includes(value as MessageKind);
}

export const fileContext = (id: string) => `pear-file-v2.${id}`;
