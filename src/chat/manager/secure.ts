import { createRatchet, ratchetEncrypt } from '../../crypto/ratchet';
import { loadRatchet, saveRatchet } from '../../storage';

import { ChatCore } from './core';

export function loadOrCreateRatchet(core: ChatCore, contact: string) {
  const secret = core.links.get(contact)?.secret;
  if (!secret || !core.identity) throw new Error('Contact non connecté');
  return loadRatchet(contact) ?? createRatchet(core.identity, contact, secret);
}

// Le contenu passe par le ratchet : chaque envoi utilise une nouvelle clé, enregistrée avant de partir.
export function sendSecure(core: ChatCore, contact: string, message: unknown): boolean {
  const peer = core.links.get(contact)?.peer;
  if (!peer?.isOpen()) return false;
  const { state, envelope } = ratchetEncrypt(loadOrCreateRatchet(core, contact), JSON.stringify(message));
  saveRatchet(contact, state);
  return peer.send({ type: 'ratchet', ...envelope });
}
