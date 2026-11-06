import * as SecureStore from 'expo-secure-store';
import { from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { open, seal } from '../../crypto/box';

// Clé locale de Pear, gardée dans le SecureStore d'Android (Keystore) : elle chiffre ce que pear.db ne
// doit pas garder en clair (clés de fichiers en cours de transfert, états du double ratchet).
const SECRET_KEY = 'db_file_keys';

let secret: Uint8Array | null = null;

function localSecret() {
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

// Le contexte distingue les usages : une valeur chiffrée pour l'un est refusée pour l'autre.
export function sealLocal(text: string, context: string) {
  return seal(text, localSecret(), context);
}

// Lance une erreur si la valeur a été modifiée ou chiffrée avec une autre clé.
export function openLocal(sealed: string, context: string) {
  return open(sealed, localSecret(), context);
}
