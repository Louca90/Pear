import { Directory, Paths } from 'expo-file-system';

import { log } from '../log';

// Dossiers du cache où Pear (ou une bibliothèque, pour lui) laisse des fichiers de passage : photos et
// vidéos prises puis abandonnées, enregistrements vocaux, fichiers choisis, copies d'export. Une fois
// envoyés, ces fichiers ont déjà été déplacés dans le stockage de Pear : au lancement, il ne reste
// donc que des restes.
const TEMPORARY_DIRECTORIES = ['Camera', 'ImagePicker', 'DocumentPicker', 'Audio', 'VideoThumbnails', 'exports'];
// Fichiers de passage posés à la racine du cache : retouches (image et vidéo) et journaux exportés.
const TEMPORARY_FILES = /^(edited-.*\.(png|mp4)|pear-journal-.*\.txt)$/;

export function exportsDirectory() {
  const directory = new Directory(Paths.cache, 'exports');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

// Rien de ce que d'autres bibliothèques gardent dans le cache (cache vidéo, cache HTTP, base de
// Notifee) n'est touché, ni les miniatures vidéo, qui se recréent toutes seules si on les efface.
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
