import { derivePushKeys, deriveSharedSecret } from '../../crypto/pairing';
import { createRatchet, ratchetEncrypt, RatchetEnvelope } from '../../crypto/ratchet';
import { loadRatchet, saveRatchet } from '../../storage';
import { getSealedPacket, Message, recordAttempt, setSealedPacket } from '../database';
import { sealOnce } from '../packets';

import { ChatCore } from './core';
import { textPayload } from './payloads';
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

// Un texte à envoyer : chiffré au premier essai, puis la même enveloppe à chaque renvoi (src/chat/packets.ts).
// L'enveloppe est relue dans la base : le message passé peut avoir été lu avant qu'un autre envoi la crée.
export function sealedText(core: ChatCore, contact: string, message: Message): RatchetEnvelope {
  return sealOnce(
    getSealedPacket(message.id, contact),
    () => sealSecure(core, contact, textPayload(message)),
    (packet) => setSealedPacket(message.id, contact, packet),
  );
}

// Le contenu passe par le ratchet : chaque envoi utilise une nouvelle clé, enregistrée avant de partir.
export function sendSecure(core: ChatCore, contact: string, message: Record<string, unknown>): boolean {
  const peer = core.links.get(contact)?.peer;
  if (!peer?.isOpen()) return false;
  return peer.send({ type: 'ratchet', ...sealSecure(core, contact, message) });
}

// Un texte en direct : son enveloppe gardée, sans rechiffrer.
export function sendSealedText(core: ChatCore, contact: string, message: Message): boolean {
  const peer = core.links.get(contact)?.peer;
  if (!peer?.isOpen()) return false;
  return peer.send({ type: 'ratchet', ...sealedText(core, contact, message) });
}

// Un essai de ce message est vraiment parti du téléphone. S'il fait suite à « Réessayer », il compte
// dans le plafond des essais à la main.
export function noteAttempt(core: ChatCore, contact: string, id: string) {
  recordAttempt(id, contact);
  if (core.retryRequested.delete(contact)) core.manualRetries.set(contact, [...(core.manualRetries.get(contact) ?? []), Date.now()]);
  core.notify();
}
