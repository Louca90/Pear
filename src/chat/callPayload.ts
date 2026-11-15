import { open, seal } from '../crypto/box';

// Push « call » (vague 5) : `étiquette~chiffré`. Il ne fait que réveiller le téléphone appelé et lui dire
// à quel contact se connecter : la sonnerie attend l'invitation, qui arrive par la connexion directe.
// Le chiffré (clé tirée du secret partagé, comme l'en-tête d'un push « msg ») contient l'identifiant de
// l'appel, audio ou vidéo, et l'heure : un push arrivé en retard ne fait rien.

const CONTEXT = 'pear-call-v1';
const TAG = /^[A-Za-z0-9_-]{8,64}$/;
const SEALED = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CALL_ID = /^[A-Za-z0-9_-]{8,32}$/;
// Au-delà, l'appelant a déjà abandonné (il attend 30 s la connexion).
export const CALL_PUSH_MAX_AGE_MS = 40 * 1000;
const MAX_LENGTH = 600;

export type CallInvite = { id: string; video: boolean; at: number };

export function isCallId(value: unknown): value is string {
  return typeof value === 'string' && CALL_ID.test(value);
}

export function encodeCallPush(tag: string, key: Uint8Array, invite: CallInvite): string {
  return `${tag}~${seal(JSON.stringify({ c: invite.id, v: invite.video ? 1 : 0, at: invite.at }), key, CONTEXT)}`;
}

// L'étiquette seule, sans clé : elle désigne le contact.
export function callPushTag(payload: unknown): string | null {
  if (typeof payload !== 'string' || payload.length > MAX_LENGTH) return null;
  const parts = payload.split('~');
  if (parts.length !== 2 || !TAG.test(parts[0]) || !SEALED.test(parts[1])) return null;
  return parts[0];
}

// null si le push a été modifié, ne vient pas de ce contact, ou est trop vieux.
export function decodeCallPush(payload: string, key: Uint8Array, now: number): CallInvite | null {
  try {
    const data = JSON.parse(open(payload.split('~')[1], key, CONTEXT));
    if (!isCallId(data.c) || (data.v !== 0 && data.v !== 1) || !Number.isSafeInteger(data.at)) return null;
    if (Math.abs(now - data.at) > CALL_PUSH_MAX_AGE_MS) return null;
    return { id: data.c, video: data.v === 1, at: data.at };
  } catch {
    return null;
  }
}
