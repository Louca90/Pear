import { open, seal } from '../crypto/box';
import { RatchetEnvelope } from '../crypto/ratchet';

// Contenu d'un push « msg » : `étiquette~en-tête~chiffré`.
// - L'étiquette, dérivée du secret partagé, désigne le contact sans révéler ni sa clé ni son nom.
// - L'en-tête du ratchet (clé publique de ratchet, compteurs) est chiffré avec une clé tirée du même
//   secret : au début d'une session, la clé de ratchet est encore la clé d'identité, qui ne doit pas
//   voyager en clair chez Google.
// - Le chiffré est celui du ratchet, déjà illisible.

// FCM limite un push à 4 Ko : au-delà, on se contente d'un réveil et le message passe en direct.
export const MAX_PUSH_PAYLOAD = 3500;
const HEADER_CONTEXT = 'pear-push-header-v1';
const TAG = /^[A-Za-z0-9_-]{8,64}$/;
const SEALED = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type PushParts = { tag: string; header: string; cipher: string };

export function encodePushPayload(tag: string, headerKey: Uint8Array, envelope: RatchetEnvelope): string | null {
  const header = seal(`${envelope.dh}.${envelope.n}.${envelope.pn}`, headerKey, HEADER_CONTEXT);
  const payload = `${tag}~${header}~${envelope.cipher}`;
  return payload.length <= MAX_PUSH_PAYLOAD ? payload : null;
}

// Première étape, sans clé : l'étiquette dit de quel contact il s'agit.
export function splitPushPayload(payload: unknown): PushParts | null {
  if (typeof payload !== 'string' || payload.length > MAX_PUSH_PAYLOAD) return null;
  const parts = payload.split('~');
  if (parts.length !== 3) return null;
  const [tag, header, cipher] = parts;
  if (!TAG.test(tag) || !SEALED.test(header) || !SEALED.test(cipher)) return null;
  return { tag, header, cipher };
}

// Deuxième étape, avec la clé de ce contact. null si l'en-tête a été modifié ou ne lui est pas destiné.
export function openPushEnvelope(parts: PushParts, headerKey: Uint8Array): RatchetEnvelope | null {
  try {
    const [dh, n, pn] = open(parts.header, headerKey, HEADER_CONTEXT).split('.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(dh) || !/^\d{1,9}$/.test(n) || !/^\d{1,9}$/.test(pn)) return null;
    return { dh, n: Number(n), pn: Number(pn), cipher: parts.cipher };
  } catch {
    return null;
  }
}
