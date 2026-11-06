import type { MessageKind } from './database';

const MB = 1024 * 1024;

// Ce qu'un contact peut nous envoyer sans rien demander. Au-delà, on demande (ou on refuse pour la
// photo de profil et le fond d'écran, qui arrivent sans qu'on les voie passer).
export const AUTO_ACCEPT_BYTES: Partial<Record<MessageKind, number>> = {
  avatar: 2 * MB,
  wallpaper: 10 * MB,
  image: 25 * MB,
  audio: 25 * MB,
  video: 100 * MB,
  file: 25 * MB,
};

// Au-dessus de leur limite, ces types sont refusés d'office.
const ALWAYS_REFUSED_ABOVE: MessageKind[] = ['avatar', 'wallpaper'];

// Fichiers en cours de réception chez un même contact : au-delà, même un petit fichier attend notre accord.
export const PENDING_QUOTA_BYTES = 300 * MB;

export type OfferDecision = 'accept' | 'ask' | 'refuse';

export function decideOffer(kind: MessageKind, size: number, pendingBytes: number): OfferDecision {
  const limit = AUTO_ACCEPT_BYTES[kind] ?? 0;
  if (size > limit) return ALWAYS_REFUSED_ABOVE.includes(kind) ? 'refuse' : 'ask';
  if (pendingBytes + size > PENDING_QUOTA_BYTES) return ALWAYS_REFUSED_ABOVE.includes(kind) ? 'refuse' : 'ask';
  return 'accept';
}
