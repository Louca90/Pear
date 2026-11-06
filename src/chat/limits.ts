import type { MessageKind } from './database';
import { AUTO_ACCEPT_BYTES, PENDING_QUOTA_BYTES } from '../config';

export { AUTO_ACCEPT_BYTES, PENDING_QUOTA_BYTES };

// Au-dessus de leur limite, ces types sont refusés d'office.
const ALWAYS_REFUSED_ABOVE: MessageKind[] = ['avatar', 'wallpaper'];

export type OfferDecision = 'accept' | 'ask' | 'refuse';

export function decideOffer(kind: MessageKind, size: number, pendingBytes: number): OfferDecision {
  const limit = (AUTO_ACCEPT_BYTES as Partial<Record<MessageKind, number>>)[kind] ?? 0;
  if (size > limit) return ALWAYS_REFUSED_ABOVE.includes(kind) ? 'refuse' : 'ask';
  if (pendingBytes + size > PENDING_QUOTA_BYTES) return ALWAYS_REFUSED_ABOVE.includes(kind) ? 'refuse' : 'ask';
  return 'accept';
}
