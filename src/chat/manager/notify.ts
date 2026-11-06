import { describeMessage, Message } from '../database';
import { showMessageNotification } from '../notifications';

import { ChatCore } from './core';
import { log } from '../../log';

export function notifyMessage(core: ChatCore, contact: string, message: Message) {
  showMessageNotification(contact, core.names.get(contact) ?? 'Pear', describeMessage(message)).catch((e) =>
    log.warn('notification', e),
  );
}
