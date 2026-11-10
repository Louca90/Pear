import { createEphemeral, createSessionV2, decryptWithSessions, isRetiredSessionExpired, isSessionV2, retireSession } from '../../crypto/rekey';
import { RatchetState } from '../../crypto/ratchet';
import { deleteRatchet, loadEphemeral, loadRatchet, saveEphemeral, saveRatchet } from '../../storage';
import { deleteSystemMessages, getSetting, setSetting } from '../database';
import { SESSION_BROKEN, SESSION_REPAIRED } from '../protocol';

import { ChatCore } from './core';
import { addSystemMessage, flush } from './outbox';
import { loadOrCreateRatchet, secretFor, sendSecure } from './secure';
import { Payload } from './types';
import { log } from '../../log';

// Passage des contacts existants en session v2 (src/crypto/rekey.ts), sans jamais perdre un message :
// 1. le rôle « a » propose une clé éphémère, dans la session actuelle ;
// 2. le rôle « b » répond avec la sienne et prépare la session v2 sans encore l'utiliser ;
// 3. « a » bascule et envoie un premier message v2 ; « b » bascule en le recevant.
// Chacun garde l'ancienne session 7 jours pour les messages encore en route. Un téléphone qui ne connaît
// pas la v2 ignore la proposition : la session reste en v1, et « a » réessaie le lendemain.
//
// Réparation : quand plusieurs messages de suite sont indéchiffrables (sauvegarde restaurée, état perdu),
// la conversation propose « Réparer la conversation ». Les clés éphémères passent alors par la connexion
// directe (chiffrée et authentifiée par le secret du pairing), pas par la session cassée. La nouvelle
// session se calcule comme la v2 : secret du pairing et trois échanges Diffie-Hellman.

const RETRY_MS = 24 * 3600 * 1000;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const FAILURES_BEFORE_REPAIR = 3;

const pendingKey = (contact: string) => `${contact}.pending`;
const previousKey = (contact: string) => `${contact}.previous`;
// Clé éphémère d'une réparation demandée et pas encore confirmée.
const repairKey = (contact: string) => `${contact}.repair`;
const failuresKey = (contact: string) => `decrypt-failures.${contact}`;

function isFirst(core: ChatCore, contact: string) {
  return core.identity !== null && core.identity.publicKey < contact;
}

// L'ancienne session, tant qu'elle a moins de 7 jours. Une ancienne session d'avant cette règle reçoit
// sa date maintenant.
function loadPrevious(contact: string): RatchetState | null {
  const previous = loadRatchet(previousKey(contact));
  if (!previous) return null;
  if (previous.retiredAt === undefined) {
    const dated = retireSession(previous);
    saveRatchet(previousKey(contact), dated);
    return dated;
  }
  if (isRetiredSessionExpired(previous)) {
    deleteRatchet(previousKey(contact));
    log.info('ancienne session effacée');
    return null;
  }
  return previous;
}

// Déchiffre avec la session qui convient et range les états. Lance une erreur si aucune ne convient.
export function decryptIncoming(core: ChatCore, contact: string, envelope: unknown): string {
  const current = loadOrCreateRatchet(core, contact);
  let result: ReturnType<typeof decryptWithSessions>;
  try {
    result = decryptWithSessions({ current, pending: loadRatchet(pendingKey(contact)), previous: loadPrevious(contact) }, envelope);
  } catch (e) {
    noteFailure(core, contact);
    throw e;
  }
  if (getSetting(failuresKey(contact))) setSetting(failuresKey(contact), null);
  if (result.slot === 'pending') {
    // L'autre téléphone écrit en v2 : on bascule à notre tour.
    saveRatchet(previousKey(contact), retireSession(current));
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

// Compté dans la base : les messages reçus par push sont déchiffrés par des réveils en arrière-plan.
function noteFailure(core: ChatCore, contact: string) {
  const failures = Number(getSetting(failuresKey(contact)) ?? 0) + 1;
  setSetting(failuresKey(contact), String(failures));
  log.warn('message indéchiffrable', failures);
  if (failures === FAILURES_BEFORE_REPAIR) {
    addSystemMessage(contact, 0, SESSION_BROKEN);
    core.notify();
  }
}

// À la connexion : effacer l'ancienne session expirée, proposer la v2 si la session est encore en v1.
export function maybeRekey(core: ChatCore, contact: string) {
  loadPrevious(contact);
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
  saveRatchet(previousKey(contact), retireSession(loadOrCreateRatchet(core, contact)));
  saveRatchet(contact, createSessionV2(core.identity, contact, secretFor(core, contact), ephemeral, data.e));
  saveEphemeral(contact, null);
  // Premier message v2 : l'autre téléphone bascule en le recevant.
  sendSecure(core, contact, { type: 'rekey-done' });
  log.info('session v2 active');
}

// --- Réparation ---

// Vrai si la demande est partie tout de suite ; sinon elle partira à la prochaine connexion.
export function requestRepair(core: ChatCore, contact: string): boolean {
  const ephemeral = loadEphemeral(repairKey(contact)) ?? createEphemeral();
  saveEphemeral(repairKey(contact), ephemeral);
  return core.links.get(contact)?.peer.send({ type: 'repair', e: ephemeral.publicKey }) ?? false;
}

// À la connexion : une réparation demandée hors connexion part maintenant.
export function resumeRepair(core: ChatCore, contact: string) {
  const ephemeral = loadEphemeral(repairKey(contact));
  if (ephemeral) core.links.get(contact)?.peer.send({ type: 'repair', e: ephemeral.publicKey });
}

export function isRepairPending(contact: string) {
  return loadEphemeral(repairKey(contact)) !== null;
}

export function receiveRepair(core: ChatCore, contact: string, data: Payload) {
  if (!core.identity || typeof data.e !== 'string' || !PUBLIC_KEY.test(data.e)) return;
  // Demandée des deux côtés à la fois : celle du rôle « a » l'emporte, « b » abandonne la sienne.
  if (isRepairPending(contact)) {
    if (isFirst(core, contact)) return;
    saveEphemeral(repairKey(contact), null);
  }
  const ephemeral = createEphemeral();
  const session = createSessionV2(core.identity, contact, secretFor(core, contact), ephemeral, data.e);
  replaceSession(core, contact, session);
  // La réponse part avant tout message de la nouvelle session (le canal garde l'ordre).
  core.links.get(contact)?.peer.send({ type: 'repair-ack', e: ephemeral.publicKey });
  afterRepair(core, contact);
}

export function receiveRepairAck(core: ChatCore, contact: string, data: Payload) {
  const ephemeral = loadEphemeral(repairKey(contact));
  if (!core.identity || !ephemeral || typeof data.e !== 'string' || !PUBLIC_KEY.test(data.e)) return;
  saveEphemeral(repairKey(contact), null);
  replaceSession(core, contact, createSessionV2(core.identity, contact, secretFor(core, contact), ephemeral, data.e));
  afterRepair(core, contact);
}

// L'ancienne session reste 7 jours pour ce qui était en route. Un passage en v2 en cours n'a plus lieu
// d'être : la nouvelle session est déjà une v2.
function replaceSession(core: ChatCore, contact: string, session: RatchetState) {
  saveRatchet(previousKey(contact), retireSession(loadOrCreateRatchet(core, contact)));
  saveRatchet(contact, session);
  deleteRatchet(pendingKey(contact));
  saveEphemeral(contact, null);
  setSetting(failuresKey(contact), null);
  log.info('session réparée');
}

// Tout ce qui n'a pas été confirmé repart avec la nouvelle session.
function afterRepair(core: ChatCore, contact: string) {
  deleteSystemMessages(contact, SESSION_BROKEN);
  addSystemMessage(contact, 0, SESSION_REPAIRED);
  core.sentOnce.forget(contact);
  flush(core, contact);
  core.notify();
}
