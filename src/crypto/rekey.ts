import { x25519 } from '@noble/curves/ed25519.js';
import { crypto_generichash, from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import type { Identity } from './pairing';
import { createRatchet, ratchetDecrypt, RatchetState } from './ratchet';

// Passage d'une session v1 (secret statique tiré des seules clés d'identité, première clé de ratchet
// = clé d'identité du rôle « b ») à une session v2 qui part de clés éphémères.
//
// Les clés éphémères s'échangent À L'INTÉRIEUR de la session actuelle, déjà authentifiée. Le nouveau
// secret mélange l'ancien et trois échanges Diffie-Hellman (éphémère/éphémère, identité/éphémère dans
// les deux sens) : voler plus tard les clés d'identité ne suffit plus à retrouver la nouvelle session.
// Le ratchet v2 démarre sur les clés éphémères, jamais sur une clé d'identité.

export type EphemeralKeys = { publicKey: string; secretKey: string };

export function createEphemeral(): EphemeralKeys {
  const secretKey = randombytes_buf(32);
  return { publicKey: to_base64(x25519.getPublicKey(secretKey)), secretKey: to_base64(secretKey) };
}

const dh = (secretKey: string, publicKey: string) => x25519.getSharedSecret(from_base64(secretKey), from_base64(publicKey));

// Les deux téléphones calculent le même secret : l'ordre des éléments suit l'ordre des clés d'identité.
function sessionSecret(identity: Identity, theirIdentity: string, oldSecret: Uint8Array, mine: EphemeralKeys, theirs: string) {
  const iAmFirst = identity.publicKey < theirIdentity;
  const ephemeral = dh(mine.secretKey, theirs);
  // identité de « first » avec l'éphémère de « second », puis l'inverse.
  const myIdentityTheirEphemeral = dh(identity.secretKey, theirs);
  const myEphemeralTheirIdentity = dh(mine.secretKey, theirIdentity);
  const [firstSecond, secondFirst] = iAmFirst ? [myIdentityTheirEphemeral, myEphemeralTheirIdentity] : [myEphemeralTheirIdentity, myIdentityTheirEphemeral];
  const input = new Uint8Array(oldSecret.length + 96);
  input.set(oldSecret, 0);
  input.set(ephemeral, oldSecret.length);
  input.set(firstSecond, oldSecret.length + 32);
  input.set(secondFirst, oldSecret.length + 64);
  return crypto_generichash(32, input, new TextEncoder().encode('pear-session-v2'));
}

// La nouvelle session, du point de vue de ce téléphone. Le ratchet v2 se comporte comme le v1, mais
// avec les clés éphémères à la place des clés d'identité.
export function createSessionV2(identity: Identity, theirIdentity: string, oldSecret: Uint8Array, mine: EphemeralKeys, theirs: string): RatchetState {
  const secret = sessionSecret(identity, theirIdentity, oldSecret, mine, theirs);
  const state = createRatchet(mine, theirs, secret);
  return { ...state, context: state.context.replace('pear-ratchet-v1', 'pear-ratchet-v2') };
}

export function isSessionV2(state: RatchetState | null) {
  return state?.context.startsWith('pear-ratchet-v2') ?? false;
}

// L'ancienne session ne sert qu'aux messages partis juste avant le changement : au-delà de 7 jours, elle
// est effacée (ses clés ne doivent pas rester sur le téléphone).
export const RETIRED_SESSION_MS = 7 * 24 * 3600 * 1000;

export function retireSession(state: RatchetState, now = Date.now()): RatchetState {
  return { ...state, retiredAt: now };
}

export function isRetiredSessionExpired(state: RatchetState, now = Date.now()) {
  return state.retiredAt !== undefined && now - state.retiredAt > RETIRED_SESSION_MS;
}

export type SessionSlot = 'current' | 'pending' | 'previous';

// Essaie chaque session dans l'ordre : l'actuelle, celle qui attend d'être confirmée, puis l'ancienne
// (messages encore en route au moment du changement). Le chiffrement authentifié refuse tout ce qui
// ne correspond pas : un essai raté ne change rien.
export function decryptWithSessions(sessions: Partial<Record<SessionSlot, RatchetState | null>>, envelope: unknown) {
  let lastError: unknown = new Error('Aucune session');
  for (const slot of ['current', 'pending', 'previous'] as SessionSlot[]) {
    const state = sessions[slot];
    if (!state) continue;
    try {
      return { slot, ...ratchetDecrypt(state, envelope) };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
