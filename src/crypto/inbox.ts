import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { crypto_kdf_derive_from_key, from_base64, to_base64 } from 'react-native-libsodium';

import { Identity } from './pairing';

// Calculs partagés avec le serveur (server/lib/inbox.js, décrits dans DOCS_SERVEUR.md).

const utf8 = (text: string) => new TextEncoder().encode(text);

// La boîte d'un téléphone : une empreinte de sa clé publique, impossible à inverser.
export function inboxIdFor(publicKey: string): string {
  return to_base64(sha256(utf8(`pear-inbox-v1:${publicKey}`))).slice(0, 32);
}

// Prouve au serveur qu'on possède la clé privée de cette identité, pour ce compte et à cette heure.
export function inboxProof(identity: Identity, serverKey: string, uid: string, at: number): string {
  const shared = x25519.getSharedSecret(from_base64(identity.secretKey), from_base64(serverKey));
  return to_base64(hmac(sha256, sha256(shared), utf8(`pear-inbox-v1|${uid}|${identity.publicKey}|${at}`)));
}

// Où et avec quelle clé ranger son token FCM pour un contact (tokens/{boîte}/{étiquette}). Les deux
// téléphones calculent les mêmes valeurs : chacun écrit dans sa boîte et lit dans celle de l'autre.
export function deriveTokenKeys(secret: Uint8Array) {
  return {
    tag: to_base64(crypto_kdf_derive_from_key(16, 7, 'peartokn', secret)),
    key: crypto_kdf_derive_from_key(32, 8, 'peartokn', secret),
  };
}
