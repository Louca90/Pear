import { createRatchet, ratchetEncrypt } from '../../crypto/ratchet';
import { loadRatchet, saveRatchet } from '../../storage';

import { ChatCore } from './core';
import { PROTOCOL_VERSION } from './types';

export function loadOrCreateRatchet(core: ChatCore, contact: string) {
  const secret = core.links.get(contact)?.secret;
  if (!secret || !core.identity) throw new Error('Contact non connecté');
  return loadRatchet(contact) ?? createRatchet(core.identity, contact, secret);
}

// Le contenu passe par le ratchet : chaque envoi utilise une nouvelle clé, enregistrée avant de partir.
export function sendSecure(core: ChatCore, contact: string, message: Record<string, unknown>): boolean {
  const peer = core.links.get(contact)?.peer;
  if (!peer?.isOpen()) return false;
  const { state, envelope } = ratchetEncrypt(loadOrCreateRatchet(core, contact), JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  saveRatchet(contact, state);
  return peer.send({ type: 'ratchet', ...envelope });
}
