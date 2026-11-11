import notifee, { AndroidForegroundServiceType, AndroidImportance, AndroidStyle, AndroidVisibility } from '@notifee/react-native';
import { Directory, File, Paths } from 'expo-file-system';

import { log } from '../log';
import { NOTIFICATION_CHANNEL_ID, NOTIFICATION_SMALL_ICON } from '../config';
import { t } from '../i18n';

// Les notifications sont créées ici, après déchiffrement : ni Google ni Vercel n'en voient le contenu.

export type NotificationLine = { text: string; at: number; mine: boolean };

// La couverture floue d'une photo ou d'une vidéo reçue (lot 2.7) : une seule par conversation, dans le
// cache, jamais en clair. Elle est supprimée avec la notification.
const coverName = (contact: string) => `${contact.replace(/[^A-Za-z0-9]/g, '_')}.jpg`;

export function coverFile(contact: string): File {
  const directory = new Directory(Paths.cache, 'couvertures');
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, coverName(contact));
}

export function deleteCover(contact: string) {
  try {
    const file = new File(new Directory(Paths.cache, 'couvertures'), coverName(contact));
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('couverture', e);
  }
}

// Efface les couvertures dont la notification n'est plus affichée (balayée, ou app tuée entre-temps).
async function pruneCovers() {
  const directory = new Directory(Paths.cache, 'couvertures');
  if (!directory.exists) return;
  const shown = new Set((await notifee.getDisplayedNotifications()).map((item) => (item.id ? coverName(item.id) : '')));
  for (const entry of directory.list()) if (entry instanceof File && !shown.has(entry.name)) entry.delete();
}

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
// Avec une couverture, le style « grande image » remplace le style messagerie : la phrase sous le nom, l'image floue dessous.
export async function showMessageNotification(contact: string, name: string, photoUri: string | null, lines: NotificationLine[], coverUri: string | null = null) {
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
      style: coverUri
        ? { type: AndroidStyle.BIGPICTURE, picture: coverUri }
        : {
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
  if (!coverUri) deleteCover(contact);
  pruneCovers().catch((e) => log.warn('couverture', e));
}

// « Pear X.Y est disponible » : un appui ouvre l'app, qui vérifie alors la mise à jour (et la signature).
export async function showUpdateNotification(version: string) {
  await ensureChannel();
  await notifee.displayNotification({
    id: 'update',
    title: t('maj.notifTitre', { version }),
    body: t('maj.notifTexte'),
    android: { channelId: NOTIFICATION_CHANNEL_ID, smallIcon: NOTIFICATION_SMALL_ICON, pressAction: { id: 'default' } },
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
  deleteCover(contact);
  notifee.cancelNotification(contact).catch((e) => log.warn('notification', e));
}

// Réception d'un fichier, app en arrière-plan ou fermée : une notification de service de premier plan
// (sans elle Android coupe le processus en cours de transfert) avec une barre de progression.
// Une seule notification pour tous les fichiers en cours. Les mises à jour passent dans une file par
// fichier et portent un jeton : une mise à jour en retard n'est jamais affichée après la fin du fichier.
const FILE_NOTIFICATION_ID = 'file-transfer';
const PAUSED_NOTIFICATION_ID = 'file-paused';
const fileQueues = new Map<string, Promise<void>>();
const fileTokens = new Map<string, number>();
const activeFiles = new Set<string>();

// À appeler une fois, dans index.ts : Notifee exige une tâche pour tout service de premier plan.
// Elle ne se termine jamais d'elle-même, c'est stopForegroundService qui l'arrête.
export function registerFileService() {
  notifee.registerForegroundService(() => new Promise<void>(() => {}));
}

function enqueue(id: string, task: () => Promise<void>) {
  const next = (fileQueues.get(id) ?? Promise.resolve()).then(task).catch((e) => log.warn('notification', e));
  fileQueues.set(id, next);
  next.then(() => {
    if (fileQueues.get(id) === next) fileQueues.delete(id);
  });
}

export function showFileProgress(id: string, name: string, progress: number) {
  const token = fileTokens.get(id) ?? 0;
  activeFiles.add(id);
  enqueue(id, async () => {
    if ((fileTokens.get(id) ?? 0) !== token) return;
    await ensureChannel();
    await notifee.cancelNotification(PAUSED_NOTIFICATION_ID);
    await notifee.displayNotification({
      id: FILE_NOTIFICATION_ID,
      title: t('notifications.reception', { nom: name }),
      android: {
        channelId: NOTIFICATION_CHANNEL_ID,
        smallIcon: NOTIFICATION_SMALL_ICON,
        onlyAlertOnce: true,
        ongoing: true,
        asForegroundService: true,
        foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC],
        progress: { max: 100, current: Math.round(progress * 100) },
      },
    });
  });
}

// Fichier fini, refusé ou abandonné : plus aucune mise à jour pour lui ; le service s'arrête avec le dernier.
export function clearFileProgress(id: string) {
  if (!activeFiles.has(id) && !fileQueues.has(id)) return;
  fileTokens.set(id, (fileTokens.get(id) ?? 0) + 1);
  activeFiles.delete(id);
  enqueue(id, async () => {
    if (activeFiles.size > 0) return;
    await notifee.stopForegroundService();
    await notifee.cancelNotification(FILE_NOTIFICATION_ID);
  });
}

// Connexion coupée en plein transfert : « Réception en pause, ouvre Pear ».
export function showFilePaused() {
  if (activeFiles.size === 0) return;
  [...activeFiles].forEach(clearFileProgress);
  enqueue(PAUSED_NOTIFICATION_ID, async () => {
    await ensureChannel();
    await notifee.displayNotification({
      id: PAUSED_NOTIFICATION_ID,
      title: t('notifications.receptionPause'),
      android: { channelId: NOTIFICATION_CHANNEL_ID, smallIcon: NOTIFICATION_SMALL_ICON, pressAction: { id: 'default' } },
    });
  });
}
