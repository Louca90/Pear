import { FileHandle } from 'expo-file-system';

import { PeerLink, PeerStatus, RouteType } from '../../network/peer';
import { CHUNK_BYTES } from '../files';
import { MessageKind } from '../database';

export const MAX_TEXT_LENGTH = 2000;
// Evite d'afficher "hors ligne" pendant une micro-coupure, par exemple en passant du Wi-Fi à la 5G.
export const OFFLINE_DELAY_MS = 1000;
// Android pénalise les pushs trop fréquents : on réveille un même contact au plus une fois par minute.
export const WAKE_INTERVAL_MS = 60000;
export const WAKE_CHECK_MS = 15000;
// Un morceau de fichier : l'id du fichier (16 octets), puis son numéro (4 octets) et ses données, chiffrés.
export const FILE_ID_BYTES = 16;
export const CHUNK_INDEX_BYTES = 4;
export const FILE_KEY_BYTES = 32;
export const PROGRESS_NOTIFY_MS = 500;
// Le disque est sollicité par paquets : un accès par morceau de 14 Ko ralentirait tout le transfert.
export const DISK_BATCH_BYTES = 32 * CHUNK_BYTES;
// Contrôle de flux : l'envoyeur ne prend pas plus d'avance que ça sur ce que le receveur a écrit.
// Sans ça, le receveur est débordé : il ne répond plus aux battements de coeur et paraît hors ligne.
export const SEND_WINDOW_CHUNKS = 128;
export const WINDOW_POLL_MS = 10;
// Une réaction reste courte : un emoji peut compter plusieurs caractères, pas plus.
export const MAX_SAVED_ID_LENGTH = 64;
export const MAX_REACTION_LENGTH = 16;
export const MAX_PROFILE_NAME_LENGTH = 40;
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
};

export const fileContext = (id: string) => `pear-file-v2.${id}`;
