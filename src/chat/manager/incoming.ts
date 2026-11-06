import { openPushEnvelope, splitPushPayload } from '../pushPayload';

import { ChatCore } from './core';
import { receiveRatchet } from './messageIO';
import { pushKeysFor } from './secure';
import { log } from '../../log';

type PushData = { [key: string]: unknown } | undefined;

// Le contact désigné par l'étiquette d'un push, parmi les nôtres. null si personne ne correspond
// (contact supprimé, push d'un inconnu).
export function contactForTag(core: ChatCore, tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  for (const contact of core.names.keys()) {
    try {
      if (pushKeysFor(core, contact).tag === tag) return contact;
    } catch (e) {
      log.warn('clés de push', e);
    }
  }
  return null;
}

// Un push « msg » : le message chiffré est déchiffré, enregistré et notifié tout de suite, sans
// connexion directe. Un doublon (déjà reçu en direct) est refusé par le ratchet : rien ne change.
export function receivePush(core: ChatCore, data: PushData) {
  if (data?.type !== 'msg') return;
  const parts = splitPushPayload(data.payload);
  if (!parts) return;
  const contact = contactForTag(core, parts.tag);
  if (!contact) return;
  const envelope = openPushEnvelope(parts, pushKeysFor(core, contact).key);
  if (!envelope) return;
  try {
    receiveRatchet(core, contact, envelope);
    log.info('message reçu par push');
  } catch (e) {
    log.warn('push non déchiffré', e);
  }
}
