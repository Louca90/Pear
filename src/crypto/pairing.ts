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
// pear://pair?k=<clé>&n=<pseudo encodé>. Les anciens liens n'ont que k.
const PAIRING_LINK = /^pear:\/\/pair\?k=([A-Za-z0-9_-]{43})(?:&n=([^&\s]{0,200}))?$/;
// Le pseudo reste court dans le lien (et donc dans le QR code, qui reste facile à scanner).
export const LINK_NAME_LENGTH = 20;

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

// Étiquette d'un contact dans les pushs : le destinataire retrouve l'expéditeur sans que Google ni le
// serveur ne voient sa clé ou son nom. Elle ne permet pas de retrouver le secret.
// La clé chiffre l'en-tête du ratchet dans les pushs (voir src/chat/pushPayload.ts).
export function derivePushKeys(secret: Uint8Array) {
  return {
    tag: to_base64(crypto_kdf_derive_from_key(16, 5, 'pearpush', secret)),
    key: crypto_kdf_derive_from_key(KEY_BYTES, 6, 'pearpush', secret),
  };
}

export function deriveMessageKey(secret: Uint8Array): Uint8Array {
  return crypto_kdf_derive_from_key(KEY_BYTES, 4, 'pearmsgs', secret);
}

// Seulement la clé publique et le pseudo : pas de photo (elle arrive après la connexion).
export function buildPairingLink(publicKey: string, name?: string | null): string {
  const short = [...(name ?? '').trim()].slice(0, LINK_NAME_LENGTH).join('');
  return short ? `pear://pair?k=${publicKey}&n=${encodeURIComponent(short)}` : `pear://pair?k=${publicKey}`;
}

export type PairingLink = { publicKey: string; name: string | null };

// Renvoie la clé publique et le pseudo contenus dans le lien, ou null si le lien n'est pas valide.
export function parsePairingLink(text: string): PairingLink | null {
  const match = text.trim().match(PAIRING_LINK);
  if (!match) return null;
  try {
    if (from_base64(match[1]).length !== KEY_BYTES) return null;
    const name = match[2] ? [...decodeURIComponent(match[2]).trim()].slice(0, LINK_NAME_LENGTH).join('') : '';
    return { publicKey: match[1], name: name || null };
  } catch {
    return null;
  }
}
