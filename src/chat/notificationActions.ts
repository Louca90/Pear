import { Event, EventType } from '@notifee/react-native';

import { chat } from './manager';
import { deleteCover } from './notifications';
import { REQUESTS_TARGET, setNotificationTarget } from './notificationTarget';
import { log } from '../log';

// Appui sur une notification ou sur l'une de ses actions, app ouverte, en arrière-plan ou fermée.
// « Répondre » envoie la réponse sans ouvrir l'app (par push si le contact n'est pas connecté).
export async function handleNotificationEvent({ type, detail }: Event) {
  const data = detail.notification?.data;
  if (data?.requests) {
    if (type === EventType.PRESS) setNotificationTarget(REQUESTS_TARGET);
    else if (type === EventType.ACTION_PRESS && typeof data.key === 'string') {
      // Accepter, refuser ou bloquer sans ouvrir l'app.
      const action = detail.pressAction?.id;
      try {
        if (action === 'pair-accept') await chat.acceptRequestFromNotification(data.key);
        else if (action === 'pair-decline') await chat.declineRequestFromNotification(data.key);
        else if (action === 'pair-block') await chat.blockRequestFromNotification(data.key);
      } catch (e) {
        log.warn('action de demande', e);
      }
    }
    return;
  }
  const contact = detail.notification?.data?.contact;
  if (typeof contact !== 'string') return;
  if (type === EventType.DISMISSED || type === EventType.PRESS) deleteCover(contact);
  if (type === EventType.PRESS) {
    setNotificationTarget(contact);
    return;
  }
  if (type !== EventType.ACTION_PRESS) return;
  try {
    if (detail.pressAction?.id === 'reply' && detail.input?.trim()) await chat.replyFromNotification(contact, detail.input.trim());
    else if (detail.pressAction?.id === 'read') await chat.markReadFromNotification(contact);
  } catch (e) {
    log.warn('action de notification', e);
  }
}
