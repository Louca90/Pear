import { log } from '../../log';
import { openLocal, sealLocal } from './localCrypto';

// La clé d'un fichier en cours de transfert est rangée chiffrée dans pear.db (clé locale du SecureStore).
// Une fois le transfert fini, elle est effacée : elle ne sert plus à rien.
const CONTEXT = 'pear-filekey-v1';
const PREFIX = 'enc1:';

export function isEncryptedFileKey(stored: string) {
  return stored.startsWith(PREFIX);
}

export function encryptFileKey(key: string | null | undefined): string | null {
  return key ? PREFIX + sealLocal(key, CONTEXT) : null;
}

// Les anciennes versions rangeaient la clé en clair : elle reste lisible jusqu'à son chiffrement au
// lancement suivant. Une clé illisible (coffre réinitialisé) donne null : seul le transfert en cours
// est perdu, il repart avec une nouvelle clé.
export function decryptFileKey(stored: string | null): string | null {
  if (!stored) return null;
  if (!isEncryptedFileKey(stored)) return stored;
  try {
    return openLocal(stored.slice(PREFIX.length), CONTEXT);
  } catch (e) {
    log.warn('clé de fichier illisible', e);
    return null;
  }
}
