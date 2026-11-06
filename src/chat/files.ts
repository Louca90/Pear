import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { log } from '../log';
import { exportsDirectory } from './cleanup';
import { CHUNK_BYTES, MAX_FILE_BYTES } from '../config';

export { CHUNK_BYTES, MAX_FILE_BYTES };

const FILE_ID = /^[A-Za-z0-9_-]{22}$/;

export function isValidFileId(id: unknown): id is string {
  return typeof id === 'string' && FILE_ID.test(id);
}

function filesDirectory(): Directory {
  const directory = new Directory(Paths.document, 'pear-files');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

// Le fichier porte toujours notre id aléatoire, jamais le nom envoyé par l'autre téléphone :
// un nom piégé comme "../../truc" ne peut donc pas écrire ailleurs.
export function storedFile(id: string): File {
  return new File(filesDirectory(), id);
}

// Un fichier de notre cache est déplacé, ce qui évite de copier une grosse vidéo.
// Tout le reste, comme une photo de la galerie, est copié : l'original ne doit jamais quitter sa place.
// move et copy sont asynchrones : le fichier n'est à sa place qu'une fois la Promise terminée.
export async function storeOutgoingFile(sourceUri: string, id: string): Promise<string> {
  const source = new File(sourceUri);
  const destination = storedFile(id);
  if (!sourceUri.startsWith(Paths.cache.uri)) {
    await source.copy(destination);
    return destination.uri;
  }
  try {
    await source.move(destination);
  } catch {
    await source.copy(destination);
  }
  return destination.uri;
}

// La taille réelle d'un fichier stocké, 0 si elle est illisible. File.size peut renvoyer 0 :
// on lit le fichier ouvert.
export function storedSize(uri: string) {
  try {
    const handle = new File(uri).open(FileMode.ReadOnly);
    const size = handle.size ?? 0;
    handle.close();
    return size;
  } catch {
    return 0;
  }
}

export function deleteStoredFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('suppression du fichier', e);
  }
}

// Copie temporaire avec le vrai nom, pour l'ouvrir dans une autre app. Rangée dans le dossier des
// exports, vidé au lancement suivant.
export async function exportCopy(uri: string, name: string): Promise<string> {
  const safeName = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'fichier';
  const copy = new File(exportsDirectory(), safeName);
  await new File(uri).copy(copy, { overwrite: true });
  return copy.uri;
}

// Copie le média dans la galerie du téléphone, seulement quand on le demande.
export async function saveToGallery(uri: string, name: string) {
  const { granted } = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
  if (!granted) throw new Error("L'accès à la galerie a été refusé.");
  await MediaLibrary.saveToLibraryAsync(await exportCopy(uri, name));
}

// La miniature est gardée dans le cache : si Android le vide, elle est simplement recréée.
export async function videoThumbnail(id: string, uri: string): Promise<string> {
  const cached = new File(Paths.cache, `thumbnail-${id}.jpg`);
  if (cached.exists) return cached.uri;
  const generated = await getThumbnailAsync(uri, { time: 0 });
  await new File(generated.uri).move(cached);
  return cached.uri;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}
