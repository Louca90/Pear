import { Event, EventType } from '@notifee/react-native';

import { chat } from './manager';
import { REQUESTS_TARGET, setNotificationTarget } from './notificationTarget';
import { log } from '../log';

// Appui sur une notification ou sur l'une de ses actions, app ouverte, en arrière-plan ou fermée.
// « Répondre » envoie la réponse sans ouvrir l'app (par push si le contact n'est pas connecté).
export async function handleNotificationEvent({ type, detail }: Event) {
  if (type === EventType.PRESS && detail.notification?.data?.requests) {
    setNotificationTarget(REQUESTS_TARGET);
    return;
  }
  const contact = detail.notification?.data?.contact;
  if (typeof contact !== 'string') return;
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
