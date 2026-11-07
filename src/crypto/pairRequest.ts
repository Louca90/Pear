import { crypto_box_seal, crypto_box_seal_open, from_base64, to_base64, to_string } from 'react-native-libsodium';

import type { Identity } from './pairing';

// Contenu d'une demande de pairing : la clé publique et le pseudo de l'expéditeur, scellés pour le
// destinataire (boîte scellée libsodium : seule sa clé privée l'ouvre, l'expéditeur reste anonyme
// pour le serveur). La clé X25519 d'identité du destinataire sert directement de clé de chiffrement.

const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
export const MAX_REQUEST_NAME_LENGTH = 40;

export type PairRequestContent = { publicKey: string; name: string };

export function sealPairRequest(sender: Identity, name: string, recipientKey: string): string {
  const content = JSON.stringify({ v: 1, k: sender.publicKey, n: [...name.trim()].slice(0, MAX_REQUEST_NAME_LENGTH).join('') });
  return to_base64(crypto_box_seal(content, from_base64(recipientKey)));
}

// null si la demande n'est pas pour nous, a été modifiée, ou est mal formée.
export function openPairRequest(recipient: Identity, sealed: unknown): PairRequestContent | null {
  if (typeof sealed !== 'string' || sealed.length > 2800) return null;
  try {
    const data = JSON.parse(to_string(crypto_box_seal_open(from_base64(sealed), from_base64(recipient.publicKey), from_base64(recipient.secretKey))));
    if (data?.v !== 1 || typeof data.k !== 'string' || !PUBLIC_KEY.test(data.k) || typeof data.n !== 'string') return null;
    return { publicKey: data.k, name: [...data.n.trim()].slice(0, MAX_REQUEST_NAME_LENGTH).join('') };
  } catch {
    return null;
  }
}
