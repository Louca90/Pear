import { Directory, Paths } from 'expo-file-system';

import { log } from '../log';

// Dossiers du cache où Pear (ou une bibliothèque, pour lui) laisse des fichiers de passage : photos et
// vidéos prises puis abandonnées, enregistrements vocaux, fichiers choisis, copies d'export. Une fois
// envoyés, ces fichiers ont déjà été chiffrés dans le stockage de Pear : au lancement, il ne reste
// donc que des restes. pear-open : les copies déchiffrées des médias ouverts (lot 2.3).
const TEMPORARY_DIRECTORIES = ['Camera', 'ImagePicker', 'DocumentPicker', 'Audio', 'VideoThumbnails', 'exports', 'pear-open'];
// Fichiers de passage posés à la racine du cache : retouches (image et vidéo), journaux exportés, et les
// miniatures vidéo en clair d'avant le lot 2.3.
const TEMPORARY_FILES = /^(edited-.*\.(png|mp4)|pear-journal-.*\.txt|thumbnail-.*\.jpg)$/;

// Taille d'un dossier, sous-dossiers compris (0 si illisible).
function directorySize(directory: Directory): number {
  let total = 0;
  try {
    for (const entry of directory.list()) total += entry instanceof Directory ? directorySize(entry) : (entry.size ?? 0);
  } catch (e) {
    log.warn('taille du cache', e);
  }
  return total;
}

export function cacheSize() {
  return directorySize(Paths.cache);
}

// « Vider le cache » : les fichiers de passage, copies déchiffrées comprises (elles se refont à
// l'ouverture : l'écran du stockage appelle aussi clearOpenedMedia).
export function clearCache() {
  cleanupCache();
}

export function exportsDirectory() {
  const directory = new Directory(Paths.cache, 'exports');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

// Rien de ce que d'autres bibliothèques gardent dans le cache (cache vidéo, cache HTTP, base de
// Notifee) n'est touché.
export function cleanupCache() {
  let removed = 0;
  try {
    for (const entry of Paths.cache.list()) {
      const temporary = entry instanceof Directory ? TEMPORARY_DIRECTORIES.includes(entry.name) : TEMPORARY_FILES.test(entry.name);
      if (!temporary) continue;
      try {
        entry.delete();
        removed += 1;
      } catch (e) {
        log.warn('nettoyage du cache', e);
      }
    }
  } catch (e) {
    log.warn('nettoyage du cache', e);
  }
  if (removed > 0) log.info('nettoyage du cache', `${removed} éléments supprimés`);
}
