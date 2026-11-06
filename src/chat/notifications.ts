import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { log } from '../log';
import { NOTIFICATION_CHANNEL_ID, NOTIFICATION_SMALL_ICON } from '../config';
import { t } from '../i18n';

// La notification est créée ici, après déchiffrement : ni Google ni Vercel n'en voient le contenu.
export async function showMessageNotification(contact: string, name: string, text: string) {
  await notifee.createChannel({
    id: NOTIFICATION_CHANNEL_ID,
    name: t('notifications.canal'),
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
  });
  await notifee.displayNotification({
    id: contact,
    title: name,
    body: text,
    data: { contact },
    android: {
      channelId: NOTIFICATION_CHANNEL_ID,
      // PRIVATE : le contenu reste caché tant que le téléphone est verrouillé.
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: NOTIFICATION_SMALL_ICON,
      pressAction: { id: 'default' },
    },
  });
}

export function clearMessageNotification(contact: string) {
  notifee.cancelNotification(contact).catch((e) => log.warn('notification', e));
}
