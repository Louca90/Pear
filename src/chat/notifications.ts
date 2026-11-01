import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';

const CHANNEL_ID = 'messages';

// La notification est créée ici, après déchiffrement : ni Google ni Vercel n'en voient le contenu.
export async function showMessageNotification(contact: string, name: string, text: string) {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
  });
  await notifee.displayNotification({
    id: contact,
    title: name,
    body: text,
    data: { contact },
    android: {
      channelId: CHANNEL_ID,
      // PRIVATE : le contenu reste caché tant que le téléphone est verrouillé.
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: 'ic_launcher_monochrome',
      pressAction: { id: 'default' },
    },
  });
}

export function clearMessageNotification(contact: string) {
  notifee.cancelNotification(contact).catch((e) => console.warn('Pear notification :', e));
}
