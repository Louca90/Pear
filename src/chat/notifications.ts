import notifee, { AndroidImportance, AndroidStyle, AndroidVisibility } from '@notifee/react-native';
import { log } from '../log';
import { NOTIFICATION_CHANNEL_ID, NOTIFICATION_SMALL_ICON } from '../config';
import { t } from '../i18n';

// Les notifications sont créées ici, après déchiffrement : ni Google ni Vercel n'en voient le contenu.

const FILE_PROGRESS_TIMEOUT_MS = 60 * 1000;

export type NotificationLine = { text: string; at: number; mine: boolean };

async function ensureChannel() {
  await notifee.createChannel({
    id: NOTIFICATION_CHANNEL_ID,
    name: t('notifications.canal'),
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PRIVATE,
  });
}

// Une notification par conversation, au style « messagerie » d'Android : photo du contact, derniers
// messages, et deux actions (répondre sans ouvrir l'app, marquer comme lu).
export async function showMessageNotification(contact: string, name: string, photoUri: string | null, lines: NotificationLine[]) {
  if (lines.length === 0) return;
  await ensureChannel();
  const sender = { name, ...(photoUri ? { icon: photoUri } : {}) };
  await notifee.displayNotification({
    id: contact,
    title: name,
    body: lines[lines.length - 1].text,
    data: { contact },
    android: {
      channelId: NOTIFICATION_CHANNEL_ID,
      // PRIVATE : le contenu reste caché tant que le téléphone est verrouillé.
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: NOTIFICATION_SMALL_ICON,
      ...(photoUri ? { largeIcon: photoUri, circularLargeIcon: true } : {}),
      pressAction: { id: 'default' },
      // Une réponse depuis la notification la remet à jour sans refaire sonner le téléphone.
      onlyAlertOnce: lines[lines.length - 1].mine,
      style: {
        type: AndroidStyle.MESSAGING,
        person: { name: t('chat.vous') },
        messages: lines.map((line) => ({ text: line.text, timestamp: line.at, ...(line.mine ? {} : { person: sender }) })),
      },
      actions: [
        { title: t('notifications.repondre'), pressAction: { id: 'reply' }, input: { placeholder: t('chat.champMessage') } },
        { title: t('notifications.marquerLu'), pressAction: { id: 'read' } },
      ],
    },
  });
}

// « X veut se pairer avec toi » : un appui ouvre la page Demandes ; on peut aussi répondre directement.
export async function showPairNotification(contact: string, name: string) {
  await ensureChannel();
  await notifee.displayNotification({
    id: `pair:${contact}`,
    title: t('demandes.notificationTitre', { nom: name || t('demandes.quelquun') }),
    body: t('demandes.notificationTexte'),
    data: { requests: '1', key: contact },
    android: {
      channelId: NOTIFICATION_CHANNEL_ID,
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: NOTIFICATION_SMALL_ICON,
      pressAction: { id: 'default' },
      actions: [
        { title: t('demandes.accepter'), pressAction: { id: 'pair-accept' } },
        { title: t('demandes.refuser'), pressAction: { id: 'pair-decline' } },
        { title: t('demandes.bloquer'), pressAction: { id: 'pair-block' } },
      ],
    },
  });
}

export function clearPairNotification(contact: string) {
  notifee.cancelNotification(`pair:${contact}`).catch((e) => log.warn('notification', e));
}

// « X vous a supprimé » / « X vous a bloqué ».
export async function showStatusNotification(contact: string, name: string, state: 'removed' | 'blocked') {
  await ensureChannel();
  await notifee.displayNotification({
    id: `status:${contact}`,
    title: t(state === 'removed' ? 'statut.supprimeTitre' : 'statut.bloqueTitre', { nom: name }),
    body: t(state === 'removed' ? 'statut.supprimeTexte' : 'statut.bloqueTexte'),
    data: { contact },
    android: {
      channelId: NOTIFICATION_CHANNEL_ID,
      visibility: AndroidVisibility.PRIVATE,
      smallIcon: NOTIFICATION_SMALL_ICON,
      pressAction: { id: 'default' },
    },
  });
}

export function clearMessageNotification(contact: string) {
  notifee.cancelNotification(contact).catch((e) => log.warn('notification', e));
}

// Fichier en cours de réception, app en arrière-plan : une barre de progression discrète.
export async function showFileProgress(id: string, name: string, progress: number) {
  await ensureChannel();
  await notifee.displayNotification({
    id: `file:${id}`,
    title: t('notifications.reception', { nom: name }),
    android: {
      channelId: NOTIFICATION_CHANNEL_ID,
      smallIcon: NOTIFICATION_SMALL_ICON,
      onlyAlertOnce: true,
      // Disparaît seule si le transfert s'interrompt (plus de nouvelles pendant une minute).
      timeoutAfter: FILE_PROGRESS_TIMEOUT_MS,
      progress: { max: 100, current: Math.round(progress * 100) },
    },
  });
}

export function clearFileProgress(id: string) {
  notifee.cancelNotification(`file:${id}`).catch((e) => log.warn('notification', e));
}
