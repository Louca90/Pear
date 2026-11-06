import { derivePushKeys, deriveSharedSecret } from '../../crypto/pairing';
import { createRatchet, ratchetEncrypt, RatchetEnvelope } from '../../crypto/ratchet';
import { loadRatchet, saveRatchet } from '../../storage';

import { ChatCore } from './core';
import { PROTOCOL_VERSION } from './types';

// Le secret partagé avec un contact : celui de la connexion s'il y en a une, sinon recalculé (réveil
// en arrière-plan, où aucune connexion n'est ouverte).
export function secretFor(core: ChatCore, contact: string): Uint8Array {
  const linked = core.links.get(contact)?.secret;
  if (linked) return linked;
  let secret = core.secrets.get(contact);
  if (!secret) {
    if (!core.identity) throw new Error('Identité non chargée');
    secret = deriveSharedSecret(core.identity, contact);
    core.secrets.set(contact, secret);
  }
  return secret;
}

export function pushKeysFor(core: ChatCore, contact: string) {
  let keys = core.pushKeys.get(contact);
  if (!keys) {
    keys = derivePushKeys(secretFor(core, contact));
    core.pushKeys.set(contact, keys);
  }
  return keys;
}

export function loadOrCreateRatchet(core: ChatCore, contact: string) {
  if (!core.identity) throw new Error('Identité non chargée');
  return loadRatchet(contact) ?? createRatchet(core.identity, contact, secretFor(core, contact));
}

// Chiffre avec le ratchet. Lecture, chiffrement et écriture de l'état se font d'un seul tenant, sans
// attente : un autre traitement (réveil en arrière-plan, écran) ne peut pas repartir du même état.
export function sealSecure(core: ChatCore, contact: string, message: Record<string, unknown>): RatchetEnvelope {
  const { state, envelope } = ratchetEncrypt(loadOrCreateRatchet(core, contact), JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  saveRatchet(contact, state);
  return envelope;
}

// Le contenu passe par le ratchet : chaque envoi utilise une nouvelle clé, enregistrée avant de partir.
export function sendSecure(core: ChatCore, contact: string, message: Record<string, unknown>): boolean {
  const peer = core.links.get(contact)?.peer;
  if (!peer?.isOpen()) return false;
  return peer.send({ type: 'ratchet', ...sealSecure(core, contact, message) });
}
