import { describeMessage, Message } from '../database';
import { showMessageNotification } from '../notifications';

import { ChatCore } from './core';

export function notifyMessage(core: ChatCore, contact: string, message: Message) {
  showMessageNotification(contact, core.names.get(contact) ?? 'Pear', describeMessage(message)).catch((e) =>
    console.warn('Pear notification :', e),
  );
}
