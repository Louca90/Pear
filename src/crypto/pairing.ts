import { x25519 } from '@noble/curves/ed25519.js';
import {
  crypto_generichash,
  crypto_kdf_derive_from_key,
  from_base64,
  randombytes_buf,
  to_base64,
} from 'react-native-libsodium';

const KEY_BYTES = 32;
// Une clé de 32 octets fait toujours 43 caractères en base64 URL.
const PAIRING_LINK = /^pear:\/\/pair\?k=([A-Za-z0-9_-]{43})$/;

// Les clés sont gardées en base64 : c'est du texte, facile à stocker et à mettre dans un lien.
export type Identity = {
  publicKey: string;
  secretKey: string;
};

export function createIdentity(): Identity {
  const secretKey = randombytes_buf(KEY_BYTES);
  return {
    publicKey: to_base64(x25519.getPublicKey(secretKey)),
    secretKey: to_base64(secretKey),
  };
}

// ECDH : ma clé privée + sa clé publique donne le même résultat des deux côtés,
// sans que ce résultat ne passe jamais sur le réseau.
export function deriveSharedSecret(identity: Identity, theirPublicKey: string): Uint8Array {
  const mine = from_base64(identity.publicKey);
  const theirs = from_base64(theirPublicKey);
  const exchanged = x25519.getSharedSecret(from_base64(identity.secretKey), theirs);

  // Recette de la doc libsodium : hash(échange || clé publique 1 || clé publique 2).
  // Les clés sont triées pour que les deux téléphones hashent exactement la même chose.
  const [first, second] = identity.publicKey < theirPublicKey ? [mine, theirs] : [theirs, mine];
  const input = new Uint8Array(exchanged.length + first.length + second.length);
  input.set(exchanged, 0);
  input.set(first, exchanged.length);
  input.set(second, exchanged.length + first.length);
  return crypto_generichash(KEY_BYTES, input, null);
}

// Code à comparer à l'oeil : s'il est identique, les deux téléphones ont le même secret
// et personne ne s'est glissé au milieu. Il est dérivé du secret mais ne permet pas de le retrouver.
export function getVerificationCode(secret: Uint8Array): string[] {
  const bytes = crypto_kdf_derive_from_key(16, 1, 'pearcode', secret);
  return [0, 1, 2, 3].map((group) => {
    const value = (bytes[group * 2] << 8) | bytes[group * 2 + 1];
    return String(value % 10000).padStart(4, '0');
  });
}

// Le secret donne deux valeurs indépendantes : l'adresse de la "boîte" Firebase, que seuls
// les deux téléphones peuvent calculer, et la clé qui chiffre ce qui y passe.
export function deriveSignalingKeys(secret: Uint8Array) {
  return {
    roomId: to_base64(crypto_kdf_derive_from_key(KEY_BYTES, 2, 'pearsign', secret)),
    key: crypto_kdf_derive_from_key(KEY_BYTES, 3, 'pearsign', secret),
  };
}

export function deriveMessageKey(secret: Uint8Array): Uint8Array {
  return crypto_kdf_derive_from_key(KEY_BYTES, 4, 'pearmsgs', secret);
}

export function buildPairingLink(publicKey: string): string {
  return `pear://pair?k=${publicKey}`;
}

// Renvoie la clé publique contenue dans le lien, ou null si le lien n'est pas valide.
export function parsePairingLink(text: string): string | null {
  const match = text.trim().match(PAIRING_LINK);
  if (!match) return null;
  try {
    return from_base64(match[1]).length === KEY_BYTES ? match[1] : null;
  } catch {
    return null;
  }
}
