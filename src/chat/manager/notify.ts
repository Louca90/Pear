import { describeMessage, getContactProfile, getNotificationMessages } from '../database';
import { showMessageNotification } from '../notifications';

import { ChatCore } from './core';
import { log } from '../../log';

// Remet à jour la notification de la conversation : les messages non lus, et nos réponses envoyées
// depuis la notification après le premier d'entre eux.
export function notifyMessage(core: ChatCore, contact: string) {
  const lines = getNotificationMessages(contact).map((message) => ({ text: describeMessage(message), at: message.created_at, mine: message.mine === 1 }));
  showMessageNotification(contact, core.names.get(contact) ?? 'Pear', getContactProfile(contact).photo_uri, lines).catch((e) =>
    log.warn('notification', e),
  );
}
