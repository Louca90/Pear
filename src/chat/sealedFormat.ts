import { crypto_aead_xchacha20poly1305_ietf_decrypt, crypto_aead_xchacha20poly1305_ietf_encrypt, randombytes_buf } from 'react-native-libsodium';

// Les fichiers rangés dans pear-files/ (lot 2.3), chiffrés avec une clé propre à chaque fichier :
//
//   « PEARSF » (6 octets) · version (2 octets) · taille d'un morceau en clair (4 octets)
//   puis les morceaux : nonce (24) · XChaCha20-Poly1305 du morceau (16 octets de plus)
//
// Chaque morceau est authentifié avec son numéro et un drapeau « dernier » : un morceau modifié,
// déplacé, ou un fichier coupé avant la fin, et la lecture échoue. Un fichier sans cet en-tête est un
// fichier d'avant le lot 2.3, encore en clair, jusqu'à sa migration.

export const STORE_MAGIC = 'PEARSF';
export const STORE_VERSION = 1;
export const HEADER_BYTES = 12;
// XChaCha20 : toujours 24 octets, et 16 pour le tag (écrits en dur : les constantes de libsodium ne
// sont prêtes qu'après son chargement).
const NONCE = 24;
const TAG = 16;
export const CHUNK_OVERHEAD = NONCE + TAG;
const MAX_CHUNK = 16 * 1024 * 1024;

export function encodeHeader(chunkSize: number): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  for (let i = 0; i < STORE_MAGIC.length; i += 1) header[i] = STORE_MAGIC.charCodeAt(i);
  const view = new DataView(header.buffer);
  view.setUint16(6, STORE_VERSION);
  view.setUint32(8, chunkSize);
  return header;
}

// La taille d'un morceau, ou null si ce n'est pas un fichier chiffré par Pear (fichier ancien en clair).
export function parseHeader(bytes: Uint8Array): number | null {
  if (bytes.length < HEADER_BYTES) return null;
  for (let i = 0; i < STORE_MAGIC.length; i += 1) if (bytes[i] !== STORE_MAGIC.charCodeAt(i)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
  if (view.getUint16(6) !== STORE_VERSION) return null;
  const chunkSize = view.getUint32(8);
  return chunkSize > 0 && chunkSize <= MAX_CHUNK ? chunkSize : null;
}

export const chunkCount = (plainSize: number, chunkSize: number) => Math.ceil(plainSize / chunkSize);

// Taille du fichier chiffré pour un contenu de plainSize octets.
export function sealedLength(plainSize: number, chunkSize: number) {
  return HEADER_BYTES + plainSize + chunkCount(plainSize, chunkSize) * CHUNK_OVERHEAD;
}

// Taille du contenu en clair d'un fichier chiffré complet ; -1 si la longueur est impossible
// (fichier coupé au milieu d'un morceau).
export function plainLength(sealedSize: number, chunkSize: number) {
  if (sealedSize < HEADER_BYTES) return -1;
  const body = sealedSize - HEADER_BYTES;
  const full = Math.floor(body / (chunkSize + CHUNK_OVERHEAD));
  const rest = body % (chunkSize + CHUNK_OVERHEAD);
  if (rest === 0) return full * chunkSize;
  if (rest <= CHUNK_OVERHEAD) return -1;
  return full * chunkSize + rest - CHUNK_OVERHEAD;
}

// Position du morceau index dans le fichier chiffré.
export const chunkOffset = (index: number, chunkSize: number) => HEADER_BYTES + index * (chunkSize + CHUNK_OVERHEAD);

const additionalData = (index: number, last: boolean) => `pear-store-v1.${index}.${last ? 1 : 0}`;

export function sealStoreChunk(plain: Uint8Array, key: Uint8Array, index: number, last: boolean): Uint8Array {
  const nonce = randombytes_buf(NONCE);
  const cipher = crypto_aead_xchacha20poly1305_ietf_encrypt(plain, additionalData(index, last), null, nonce, key);
  const sealed = new Uint8Array(NONCE + cipher.length);
  sealed.set(nonce, 0);
  sealed.set(cipher, NONCE);
  return sealed;
}

// Lance une erreur si le morceau a été modifié, déplacé, ou chiffré avec une autre clé.
export function openStoreChunk(sealed: Uint8Array, key: Uint8Array, index: number, last: boolean): Uint8Array {
  if (sealed.length < CHUNK_OVERHEAD) throw new Error('Morceau incomplet');
  return crypto_aead_xchacha20poly1305_ietf_decrypt(null, sealed.slice(NONCE), additionalData(index, last), sealed.slice(0, NONCE), key);
}
