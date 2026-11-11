// Messages éphémères (lot 4.7) : règles sans dépendance au téléphone, testées avec Jest.
// Le minuteur est réglé par conversation et synchronisé par un événement chiffré. Chaque message porte
// sa propre durée de vie (ttl, en secondes) : c'est elle qui fait foi, des deux côtés. Le compte
// part de l'envoi chez l'expéditeur et de la réception chez le destinataire.

const HOUR = 3600;
export const EPHEMERAL_CHOICES = [HOUR, 24 * HOUR, 7 * 24 * HOUR] as const;
export const DEFAULT_EPHEMERAL = 24 * HOUR;

// Une durée reçue de l'autre téléphone : seulement l'une des trois proposées.
export function validTtl(value: unknown): number | null {
  return typeof value === 'number' && (EPHEMERAL_CHOICES as readonly number[]).includes(value) ? value : null;
}

// Le réglage reçu : une des durées, ou 0 (coupé). null si la valeur n'est pas valide.
export function validEphemeralSetting(value: unknown): number | null {
  return value === 0 ? 0 : validTtl(value);
}

export function expiryFor(createdAt: number, ttl: number | null | undefined): number | null {
  return ttl ? createdAt + ttl * 1000 : null;
}

// La durée de vie d'un message déjà enregistré, à renvoyer avec lui.
export function ttlOf(message: { created_at: number; expires_at?: number | null }): number | null {
  return message.expires_at ? validTtl(Math.round((message.expires_at - message.created_at) / 1000)) : null;
}

// Message système « éphémères activés (durée) / coupés ».
const SYSTEM_PREFIX = 'ephemeral:';
export const ephemeralSystemText = (seconds: number) => `${SYSTEM_PREFIX}${seconds}`;

export function parseEphemeralSystem(text: string): number | null {
  if (!text.startsWith(SYSTEM_PREFIX)) return null;
  return validEphemeralSetting(Number(text.slice(SYSTEM_PREFIX.length)));
}

// Nouvelle heure de réglage : toujours après la précédente, même si une horloge retarde.
export function nextSettingTime(now: number, last: number) {
  return Math.max(now, last + 1);
}

// Geste d'activation : la liste suit le doigt vers le haut, 96 points au plus ; au-delà de 72, relâcher bascule.
export const PULL_MAX = 96;
export const PULL_THRESHOLD = 72;

export function pullOffset(dy: number) {
  return Math.max(-PULL_MAX, Math.min(0, dy));
}

export function pullProgress(dy: number) {
  return Math.max(0, Math.min(1, -dy / PULL_THRESHOLD));
}

export const pullTriggers = (dy: number) => -dy >= PULL_THRESHOLD;
