import { Directory, File, Paths } from 'expo-file-system';
import { log } from '../log';
import { CHUNK_BYTES, MAX_FILE_BYTES } from '../config';
import { t } from '../i18n';

export { CHUNK_BYTES, MAX_FILE_BYTES };

// Emplacements des fichiers de Pear. Le chiffrement (lot 2.3) et l'ouverture sont dans media.ts.

const FILE_ID = /^[A-Za-z0-9_-]{22}$/;

export function isValidFileId(id: unknown): id is string {
  return typeof id === 'string' && FILE_ID.test(id);
}

export function filesDirectory(): Directory {
  const directory = new Directory(Paths.document, 'pear-files');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

// Miniatures des vidéos, chiffrées avec la clé de leur vidéo.
export function thumbnailsDirectory(): Directory {
  const directory = new Directory(Paths.document, 'pear-thumbs');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

// Copies déchiffrées des médias ouverts : dans le cache, vidées à la fermeture de la conversation, au
// passage en arrière-plan et au lancement.
export const OPENED_DIRECTORY = 'pear-open';

export function openedDirectory(): Directory {
  const directory = new Directory(Paths.cache, OPENED_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

// Le fichier porte toujours notre id aléatoire, jamais le nom envoyé par l'autre téléphone :
// un nom piégé comme "../../truc" ne peut donc pas écrire ailleurs.
export function storedFile(id: string): File {
  return new File(filesDirectory(), id);
}

// L'id (nom du fichier) d'une uri de pear-files/, null pour toute autre uri.
export function storedFileId(uri: string): string | null {
  const match = uri.match(/\/pear-files\/([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export function deleteStoredFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('suppression du fichier', e);
  }
  const id = storedFileId(uri);
  if (!id) return;
  // Sa miniature et ses copies déchiffrées partent avec lui.
  try {
    const thumbnail = new File(thumbnailsDirectory(), id);
    if (thumbnail.exists) thumbnail.delete();
    for (const entry of openedDirectory().list()) {
      if (entry instanceof File && (entry.name === id || entry.name.startsWith(`${id}.`) || entry.name.startsWith(`${id}-`))) entry.delete();
    }
  } catch (e) {
    log.warn('suppression du fichier', e);
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return t('taille.ko', { n: Math.round(bytes / 1024) });
  if (bytes < 1024 * 1024 * 1024) return t('taille.mo', { n: (bytes / (1024 * 1024)).toFixed(1) });
  return t('taille.go', { n: (bytes / (1024 * 1024 * 1024)).toFixed(1) });
}
