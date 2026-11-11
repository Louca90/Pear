// Chiffrement de pear.db par SQLCipher (lot 2.2) : la partie sans téléphone, testée par Jest.
//
// Une base en clair est chiffrée dans une copie (temp), vérifiée, puis échangée avec l'originale, qui
// passe un instant à côté (old) avant d'être effacée. Chaque étape peut être interrompue : au démarrage
// suivant, l'état des trois fichiers dit où reprendre.

export type MainState = 'absent' | 'plain' | 'encrypted';
export type EncryptionFiles = { main: MainState; temp: boolean; old: boolean };

export type EncryptionStep =
  // Chiffrer main dans temp (en effaçant un temp laissé par un essai interrompu), puis échanger.
  | 'encrypt'
  // Tué pendant l'échange : temp était déjà vérifié, il devient main, puis old est effacé.
  | 'finish-swap'
  // Tué juste après avoir mis l'ancienne base de côté, sans copie : on la remet, puis on chiffre.
  | 'restore-old'
  // Tué juste avant d'effacer l'ancienne base : il ne reste qu'à l'effacer.
  | 'delete-old'
  // Rien à faire (base déjà chiffrée, ou nouvelle installation créée directement chiffrée).
  | 'none';

export function planEncryption({ main, temp, old }: EncryptionFiles): EncryptionStep {
  if (main === 'plain') return 'encrypt';
  if (main === 'absent' && old) return temp ? 'finish-swap' : 'restore-old';
  if (main === 'encrypted' && old) return 'delete-old';
  return 'none';
}

// Les 16 premiers octets d'une base SQLite en clair. Une base chiffrée commence par un sel aléatoire.
const SQLITE_HEADER = 'SQLite format 3\0';

export function isSqliteHeader(bytes: Uint8Array) {
  if (bytes.length < SQLITE_HEADER.length) return false;
  for (let i = 0; i < SQLITE_HEADER.length; i++) if (bytes[i] !== SQLITE_HEADER.charCodeAt(i)) return false;
  return true;
}

// Clé brute de 32 octets (64 caractères hexadécimaux) : SQLCipher ne la dérive pas (pas de PBKDF2), la
// base s'ouvre vite, même au réveil par un push. Une PRAGMA ne prend pas de paramètre lié : la clé est
// vérifiée avant d'être écrite dans la requête.
const KEY_FORMAT = /^[0-9a-f]{64}$/;

export function keyLiteral(hex: string) {
  if (!KEY_FORMAT.test(hex)) throw new Error('Clé de la base invalide.');
  return `"x'${hex}'"`;
}

// Un chemin de fichier dans une requête SQL, entre apostrophes.
export function sqlPath(path: string) {
  return `'${path.replace(/'/g, "''")}'`;
}
