import { wakeContact } from '../../network/wake';
import { getContactToken, getOutboxEvents, getUndelivered } from '../database';

import { ChatCore } from './core';
import { WAKE_INTERVAL_MS } from './types';

export function wakeIfNeeded(core: ChatCore, contact: string) {
  if (!core.online || core.links.get(contact)?.status === 'connected') return;
  if (getUndelivered(contact).length === 0 && getOutboxEvents(contact).length === 0) return;
  if (Date.now() - (core.lastWake.get(contact) ?? 0) < WAKE_INTERVAL_MS) return;
  const token = getContactToken(contact);
  if (!token) return;
  core.lastWake.set(contact, Date.now());
  wakeContact(token).catch((e) => console.warn('Pear réveil :', e));
}

// Le token voyage dans la connexion chiffrée : ni le QR code ni Firebase ne le transportent.
export function shareToken(core: ChatCore, contact?: string) {
  if (!core.myToken) return;
  const message = { type: 'token', token: core.myToken };
  if (contact) core.links.get(contact)?.peer.send(message);
  else core.links.forEach((link) => link.peer.send(message));
}
