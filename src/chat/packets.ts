import type { RatchetEnvelope } from '../crypto/ratchet';

// Un message texte est chiffré une seule fois : l'enveloppe du ratchet est gardée avec le message et
// renvoyée telle quelle à chaque essai (connexion directe, push, bouton « Réessayer »). Un renvoi
// n'avance donc pas le ratchet et ne consomme pas les clés sautées du destinataire.
//
// Le destinataire, lui, ne peut pas redéchiffrer une enveloppe déjà ouverte (sa clé est effacée) : il
// reconnaît le paquet à son empreinte, acquitte de nouveau le message, sans le retraiter. Sans ça, un
// accusé perdu ferait réessayer l'expéditeur indéfiniment.

export function isEnvelope(value: unknown): value is RatchetEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  return typeof envelope.dh === 'string' && Number.isSafeInteger(envelope.n) && Number.isSafeInteger(envelope.pn) && typeof envelope.cipher === 'string';
}

export function parseEnvelope(stored: string | null | undefined): RatchetEnvelope | null {
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    return isEnvelope(value) ? { dh: value.dh, n: value.n, pn: value.pn, cipher: value.cipher } : null;
  } catch {
    return null;
  }
}

// L'enveloppe gardée, sinon une nouvelle, chiffrée maintenant et enregistrée aussitôt.
export function sealOnce(stored: string | null, seal: () => RatchetEnvelope, save: (packet: string) => void): RatchetEnvelope {
  const known = parseEnvelope(stored);
  if (known) return known;
  const envelope = seal();
  save(JSON.stringify(envelope));
  return envelope;
}

// Clé du ratchet, numéro dans la chaîne et nonce aléatoire du chiffré (les 32 premiers caractères :
// 24 octets en base64). Le nonce sépare deux sessions qui recommenceraient au même numéro.
export function packetFingerprint(envelope: unknown): string | null {
  if (!isEnvelope(envelope)) return null;
  const nonce = envelope.cipher.split('.')[0];
  if (!nonce || nonce.length < 16) return null;
  return `${envelope.dh}.${envelope.n}.${nonce.slice(0, 32)}`;
}

export type PacketMemory = {
  find(fingerprint: string): string | null;
  remember(fingerprint: string, messageId: string): void;
};

// process déchiffre et traite le paquet (accusé compris), et rend l'identifiant du message texte
// qu'il contenait. Un paquet déjà traité n'est que réacquitté.
export function receiveOnce(memory: PacketMemory, envelope: unknown, acknowledge: (messageId: string) => void, process: () => string | null) {
  const fingerprint = packetFingerprint(envelope);
  const known = fingerprint ? memory.find(fingerprint) : null;
  if (known) {
    acknowledge(known);
    return;
  }
  const messageId = process();
  if (fingerprint && messageId) memory.remember(fingerprint, messageId);
}

// Comment un texte part quand le contact n'est pas connecté : dans un push s'il y tient, sinon par le
// relais chiffré (s'il est activé), sinon un simple réveil et il attend la connexion directe.
export type OfflineRoute = 'push' | 'relay' | 'wake';

export function offlineRoute(pushPayload: string | null, relayEnabled: boolean): OfflineRoute {
  if (pushPayload) return 'push';
  return relayEnabled ? 'relay' : 'wake';
}
