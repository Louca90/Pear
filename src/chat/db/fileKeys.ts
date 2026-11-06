import * as SecureStore from 'expo-secure-store';
import { from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { open, seal } from '../../crypto/box';
import { log } from '../../log';

// La clé d'un fichier en cours de transfert est rangée chiffrée dans pear.db, avec une clé gardée dans
// le SecureStore d'Android. Une fois le transfert fini, elle est effacée : elle ne sert plus à rien.
const SECRET_KEY = 'db_file_keys';
const CONTEXT = 'pear-filekey-v1';
const PREFIX = 'enc1:';

let secret: Uint8Array | null = null;

function fileKeysSecret() {
  if (secret) return secret;
  const saved = SecureStore.getItem(SECRET_KEY);
  if (saved) {
    secret = from_base64(saved);
  } else {
    secret = randombytes_buf(32);
    SecureStore.setItem(SECRET_KEY, to_base64(secret));
  }
  return secret;
}

export function isEncryptedFileKey(stored: string) {
  return stored.startsWith(PREFIX);
}

export function encryptFileKey(key: string | null | undefined): string | null {
  return key ? PREFIX + seal(key, fileKeysSecret(), CONTEXT) : null;
}

// Les anciennes versions rangeaient la clé en clair : elle reste lisible jusqu'à son chiffrement au
// lancement suivant. Une clé illisible (coffre réinitialisé) donne null : seul le transfert en cours
// est perdu, il repart avec une nouvelle clé.
export function decryptFileKey(stored: string | null): string | null {
  if (!stored) return null;
  if (!isEncryptedFileKey(stored)) return stored;
  try {
    return open(stored.slice(PREFIX.length), fileKeysSecret(), CONTEXT);
  } catch (e) {
    log.warn('clé de fichier illisible', e);
    return null;
  }
}
