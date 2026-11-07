import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { from_base64 } from 'react-native-libsodium';

import { open } from '../crypto/box';
import { DB_NAME } from '../config';

// Une sauvegarde complète se restaure en deux temps (lot 12). L'import déchiffre et vérifie tout dans
// « restore/ », sans rien toucher, puis l'app redémarre. Ici, au tout début du démarrage (avant que la
// base ne s'ouvre), ce dossier remplace la base, les médias et les clés. Chaque étape peut être rejouée :
// si l'app est tuée au milieu, le démarrage suivant termine le travail.

export const RESTORE_DIRECTORY = 'restore';
export const RESTORE_KEY = 'restore_pending_key';
export const RESTORE_CONTEXT = 'pear-restore-v1';
// Les clés du SecureStore qu'une sauvegarde complète remplace.
export const RESTORED_SECRETS = { identity: 'identity', localKey: 'db_file_keys', language: 'pear.language' } as const;

export type RestoredSecrets = { identity: string | null; localKey: string | null; language: string | null };

export function stagingDirectory() {
  return new Directory(Paths.document, RESTORE_DIRECTORY);
}

export function applyPendingRestore() {
  const staging = stagingDirectory();
  if (!staging.exists) return;
  const ready = new File(staging, 'ready');
  // Un import interrompu avant la fin de la vérification : on l'oublie, rien n'avait été remplacé.
  if (!ready.exists) {
    staging.delete();
    SecureStore.deleteItemAsync(RESTORE_KEY).catch(() => undefined);
    return;
  }

  const stagedDatabase = new File(staging, DB_NAME);
  if (stagedDatabase.exists) {
    const folder = new Directory(Paths.document, 'SQLite');
    folder.create({ idempotent: true, intermediates: true });
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const current = new File(folder, DB_NAME + suffix);
      if (current.exists) current.delete();
    }
    stagedDatabase.moveSync(new File(folder, DB_NAME));
  }

  const stagedFiles = new Directory(staging, 'pear-files');
  if (stagedFiles.exists) {
    const current = new Directory(Paths.document, 'pear-files');
    if (current.exists) current.delete();
    stagedFiles.moveSync(new Directory(Paths.document, 'pear-files'));
  }

  const sealed = new File(staging, 'secure');
  const key = SecureStore.getItem(RESTORE_KEY);
  if (sealed.exists && key) {
    const secrets = JSON.parse(open(sealed.textSync(), from_base64(key), RESTORE_CONTEXT)) as RestoredSecrets;
    for (const [field, storeKey] of Object.entries(RESTORED_SECRETS) as [keyof RestoredSecrets, string][]) {
      const value = secrets[field];
      if (value) SecureStore.setItem(storeKey, value);
      else SecureStore.deleteItemAsync(storeKey).catch(() => undefined);
    }
  }

  staging.delete();
  SecureStore.deleteItemAsync(RESTORE_KEY).catch(() => undefined);
}
