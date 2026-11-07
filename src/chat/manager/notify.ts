import { describeMessage, getContactProfile, getMutedKinds, getNotificationMessages } from '../database';
import { showMessageNotification } from '../notifications';

import { ChatCore } from './core';
import { log } from '../../log';

// Remet à jour la notification de la conversation : les messages non lus, et nos réponses envoyées
// depuis la notification après le premier d'entre eux.
// Les types coupés pour cette conversation ne préviennent pas : si le dernier message reçu en est un,
// pas de notification ; sinon ils sont retirés du résumé.
export function notifyMessage(core: ChatCore, contact: string) {
  const muted = getMutedKinds(contact);
  const messages = getNotificationMessages(contact);
  const lastReceived = [...messages].reverse().find((message) => message.mine === 0);
  if (!lastReceived || muted.includes(lastReceived.kind)) return;
  const lines = messages.filter((message) => !muted.includes(message.kind)).map((message) => ({ text: describeMessage(message), at: message.created_at, mine: message.mine === 1 }));
  showMessageNotification(contact, core.names.get(contact) ?? 'Pear', getContactProfile(contact).photo_uri, lines).catch((e) =>
    log.warn('notification', e),
  );
}
