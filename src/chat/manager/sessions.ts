import { createEphemeral, createSessionV2, decryptWithSessions, isSessionV2 } from '../../crypto/rekey';
import { deleteRatchet, loadEphemeral, loadRatchet, saveEphemeral, saveRatchet } from '../../storage';

import { ChatCore } from './core';
import { loadOrCreateRatchet, secretFor, sendSecure } from './secure';
import { Payload } from './types';
import { log } from '../../log';

// Passage des contacts existants en session v2 (src/crypto/rekey.ts), sans jamais perdre un message :
// 1. le rôle « a » propose une clé éphémère, dans la session actuelle ;
// 2. le rôle « b » répond avec la sienne et prépare la session v2 sans encore l'utiliser ;
// 3. « a » bascule et envoie un premier message v2 ; « b » bascule en le recevant.
// Chacun garde l'ancienne session pour les messages encore en route. Un téléphone qui ne connaît pas
// la v2 ignore la proposition : la session reste en v1, et « a » réessaie le lendemain.

const RETRY_MS = 24 * 3600 * 1000;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;

const pendingKey = (contact: string) => `${contact}.pending`;
const previousKey = (contact: string) => `${contact}.previous`;

function isFirst(core: ChatCore, contact: string) {
  return core.identity !== null && core.identity.publicKey < contact;
}

// Déchiffre avec la session qui convient et range les états. Lance une erreur si aucune ne convient.
export function decryptIncoming(core: ChatCore, contact: string, envelope: unknown): string {
  const current = loadOrCreateRatchet(core, contact);
  const result = decryptWithSessions({ current, pending: loadRatchet(pendingKey(contact)), previous: loadRatchet(previousKey(contact)) }, envelope);
  if (result.slot === 'pending') {
    // L'autre téléphone écrit en v2 : on bascule à notre tour.
    saveRatchet(previousKey(contact), current);
    saveRatchet(contact, result.state);
    deleteRatchet(pendingKey(contact));
    log.info('session v2 active');
  } else if (result.slot === 'current') {
    saveRatchet(contact, result.state);
  } else {
    saveRatchet(previousKey(contact), result.state);
  }
  return result.text;
}

// À la connexion : proposer la v2 si la session est encore en v1.
export function maybeRekey(core: ChatCore, contact: string) {
  if (!isFirst(core, contact) || isSessionV2(loadRatchet(contact))) return;
  if (Date.now() - (core.rekeyAttempts.get(contact) ?? 0) < RETRY_MS) return;
  core.rekeyAttempts.set(contact, Date.now());
  // La même clé éphémère est reproposée tant qu'aucune réponse n'est arrivée.
  const ephemeral = loadEphemeral(contact) ?? createEphemeral();
  saveEphemeral(contact, ephemeral);
  sendSecure(core, contact, { type: 'rekey', e: ephemeral.publicKey });
}

export function receiveRekey(core: ChatCore, contact: string, data: Payload) {
  if (!core.identity || isFirst(core, contact) || typeof data.e !== 'string' || !PUBLIC_KEY.test(data.e)) return;
  const ephemeral = createEphemeral();
  saveRatchet(pendingKey(contact), createSessionV2(core.identity, contact, secretFor(core, contact), ephemeral, data.e));
  sendSecure(core, contact, { type: 'rekey-ack', e: ephemeral.publicKey });
}

export function receiveRekeyAck(core: ChatCore, contact: string, data: Payload) {
  const ephemeral = loadEphemeral(contact);
  if (!core.identity || !ephemeral || !isFirst(core, contact) || typeof data.e !== 'string' || !PUBLIC_KEY.test(data.e)) return;
  saveRatchet(previousKey(contact), loadOrCreateRatchet(core, contact));
  saveRatchet(contact, createSessionV2(core.identity, contact, secretFor(core, contact), ephemeral, data.e));
  saveEphemeral(contact, null);
  // Premier message v2 : l'autre téléphone bascule en le recevant.
  sendSecure(core, contact, { type: 'rekey-done' });
  log.info('session v2 active');
}
