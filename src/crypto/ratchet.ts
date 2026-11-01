import { x25519 } from '@noble/curves/ed25519.js';
import { crypto_generichash, crypto_kdf_derive_from_key, from_base64, randombytes_buf, to_base64 } from 'react-native-libsodium';

import { open, seal } from './box';
import type { Identity } from './pairing';

// Double Ratchet, selon la spécification publiée par Signal. Chaque message a sa propre clé :
// - le "cliquet symétrique" dérive une nouvelle clé par message et oublie la précédente ;
// - le "cliquet Diffie-Hellman" injecte un nouveau secret à chaque changement de sens de la conversation.
// Voler l'état d'un téléphone ne permet donc pas de relire les anciens messages, et l'accès futur se referme.
const KEY_BYTES = 32;
const KDF_CONTEXT = 'pearrtch';
// Limite les calculs qu'un message forgé pourrait imposer, et la place prise par les clés gardées.
const MAX_SKIP = 1000;
const MAX_STORED_SKIPPED = 200;

type KeyPair = { publicKey: string; secretKey: string };

export type RatchetState = {
  // Identifie la conversation : un message chiffré pour une autre paire de téléphones est refusé.
  context: string;
  rootKey: string;
  ownKeys: KeyPair;
  theirKey: string | null;
  sendChain: string;
  receiveChain: string | null;
  sent: number;
  received: number;
  previousSent: number;
  // Clés des messages sautés : ils peuvent encore arriver après une coupure.
  skipped: Record<string, string>;
};

export type RatchetEnvelope = {
  dh: string;
  n: number;
  pn: number;
  cipher: string;
};

function newKeyPair(): KeyPair {
  const secretKey = randombytes_buf(KEY_BYTES);
  return { publicKey: to_base64(x25519.getPublicKey(secretKey)), secretKey: to_base64(secretKey) };
}

function exchange(keys: KeyPair, theirKey: string): Uint8Array {
  return x25519.getSharedSecret(from_base64(keys.secretKey), from_base64(theirKey));
}

// BLAKE2b avec clé : la clé racine et le nouveau secret donnent une nouvelle clé racine et une nouvelle chaîne.
function advanceRoot(rootKey: string, secret: Uint8Array) {
  const output = crypto_generichash(KEY_BYTES * 2, secret, from_base64(rootKey));
  return { rootKey: to_base64(output.slice(0, KEY_BYTES)), chain: to_base64(output.slice(KEY_BYTES)) };
}

function advanceChain(chain: string) {
  const key = from_base64(chain);
  return {
    messageKey: crypto_kdf_derive_from_key(KEY_BYTES, 1, KDF_CONTEXT, key),
    chain: to_base64(crypto_kdf_derive_from_key(KEY_BYTES, 2, KDF_CONTEXT, key)),
  };
}

function additionalData(state: RatchetState, dh: string, n: number, pn: number) {
  return `${state.context}.${dh}.${n}.${pn}`;
}

// Les deux téléphones partent du secret du pairing. Le rôle "b" reçoit une première chaîne dérivée
// de ce secret : il peut donc écrire en premier, sans attendre un message du rôle "a".
export function createRatchet(identity: Identity, theirPublicKey: string, secret: Uint8Array): RatchetState {
  const [first, second] = identity.publicKey < theirPublicKey ? [identity.publicKey, theirPublicKey] : [theirPublicKey, identity.publicKey];
  const rootKey = to_base64(crypto_kdf_derive_from_key(KEY_BYTES, 3, KDF_CONTEXT, secret));
  const firstChain = to_base64(crypto_kdf_derive_from_key(KEY_BYTES, 4, KDF_CONTEXT, secret));
  const base = { context: `pear-ratchet-v1.${first}.${second}`, sent: 0, received: 0, previousSent: 0, skipped: {} };

  if (identity.publicKey === first) {
    const ownKeys = newKeyPair();
    const root = advanceRoot(rootKey, exchange(ownKeys, theirPublicKey));
    return { ...base, rootKey: root.rootKey, ownKeys, theirKey: theirPublicKey, sendChain: root.chain, receiveChain: firstChain };
  }
  return { ...base, rootKey, ownKeys: identity, theirKey: null, sendChain: firstChain, receiveChain: null };
}

// Renvoie un nouvel état : il faut l'enregistrer avant d'envoyer, pour ne jamais réutiliser une clé.
export function ratchetEncrypt(state: RatchetState, text: string): { state: RatchetState; envelope: RatchetEnvelope } {
  const { messageKey, chain } = advanceChain(state.sendChain);
  const dh = state.ownKeys.publicKey;
  const cipher = seal(text, messageKey, additionalData(state, dh, state.sent, state.previousSent));
  return {
    state: { ...state, sendChain: chain, sent: state.sent + 1 },
    envelope: { dh, n: state.sent, pn: state.previousSent, cipher },
  };
}

function skipKeys(state: RatchetState, until: number) {
  if (!state.receiveChain || !state.theirKey) return;
  if (until - state.received > MAX_SKIP) throw new Error('Trop de messages sautés');
  while (state.received < until) {
    const { messageKey, chain } = advanceChain(state.receiveChain);
    state.skipped[`${state.theirKey}:${state.received}`] = to_base64(messageKey);
    state.receiveChain = chain;
    state.received += 1;
  }
  const stored = Object.keys(state.skipped);
  stored.slice(0, Math.max(0, stored.length - MAX_STORED_SKIPPED)).forEach((key) => delete state.skipped[key]);
}

function turnRatchet(state: RatchetState, theirKey: string) {
  state.previousSent = state.sent;
  state.sent = 0;
  state.received = 0;
  state.theirKey = theirKey;
  const receiving = advanceRoot(state.rootKey, exchange(state.ownKeys, theirKey));
  state.receiveChain = receiving.chain;
  state.ownKeys = newKeyPair();
  const sending = advanceRoot(receiving.rootKey, exchange(state.ownKeys, theirKey));
  state.rootKey = sending.rootKey;
  state.sendChain = sending.chain;
}

function isValidEnvelope(envelope: any): envelope is RatchetEnvelope {
  return (
    typeof envelope?.dh === 'string' &&
    from_base64(envelope.dh).length === KEY_BYTES &&
    Number.isSafeInteger(envelope.n) &&
    envelope.n >= 0 &&
    Number.isSafeInteger(envelope.pn) &&
    envelope.pn >= 0 &&
    typeof envelope.cipher === 'string'
  );
}

// Travaille sur une copie : un message forgé ou abîmé lance une erreur et laisse l'état intact.
export function ratchetDecrypt(state: RatchetState, envelope: unknown): { state: RatchetState; text: string } {
  if (!isValidEnvelope(envelope)) throw new Error('Enveloppe non valide');
  const { dh, n, pn, cipher } = envelope;
  const next: RatchetState = { ...state, skipped: { ...state.skipped } };
  const data = additionalData(state, dh, n, pn);

  const skippedKey = `${dh}:${n}`;
  const stored = next.skipped[skippedKey];
  if (stored) {
    delete next.skipped[skippedKey];
    return { state: next, text: open(cipher, from_base64(stored), data) };
  }

  if (dh !== next.theirKey) {
    skipKeys(next, pn);
    turnRatchet(next, dh);
  }
  skipKeys(next, n);
  if (!next.receiveChain) throw new Error('Aucune chaîne de réception');
  const { messageKey, chain } = advanceChain(next.receiveChain);
  next.receiveChain = chain;
  next.received += 1;
  return { state: next, text: open(cipher, messageKey, data) };
}
