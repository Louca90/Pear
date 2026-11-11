import { blurCover } from '../../../modules/pear-native';
import { describeMessage, getContactProfile, getMutedKinds, getNotificationMessages, Message } from '../database';
import { openMedia } from '../media';
import { trailingMediaRun } from '../mediaRun';
import { coverFile, deleteCover, showMessageNotification } from '../notifications';
import { t } from '../../i18n';

import { ChatCore } from './core';
import { log } from '../../log';

// Remet à jour la notification de la conversation : les messages non lus, et nos réponses envoyées
// depuis la notification après le premier d'entre eux.
// Les types coupés pour cette conversation ne préviennent pas : si le dernier message reçu en est un,
// pas de notification ; sinon ils sont retirés du résumé.
export function notifyMessage(core: ChatCore, contact: string, since?: number) {
  const muted = getMutedKinds(contact);
  const messages = getNotificationMessages(contact, since);
  const lastReceived = [...messages].reverse().find((message) => message.mine === 0);
  if (!lastReceived || muted.includes(lastReceived.kind)) return;
  const visible = messages.filter((message) => !muted.includes(message.kind));
  const name = core.names.get(contact) ?? 'Pear';
  const lines = visible.map((message) => ({ text: describeMessage(message), at: message.created_at, mine: message.mine === 1 }));
  // Une photo ou une vidéo reçue en dernier : « {nom} vous a envoyé une photo », les médias à la suite en une seule ligne.
  const run = trailingMediaRun(visible, visible.lastIndexOf(lastReceived));
  let cover: Message | undefined;
  if (run) {
    const last = visible.lastIndexOf(lastReceived);
    const { photos, videos } = run;
    const key = videos === 0 ? (photos === 1 ? 'photoDe' : 'photosDe') : photos === 0 ? (videos === 1 ? 'videoDe' : 'videosDe') : 'mediasDe';
    lines.splice(run.start, last - run.start + 1, { text: t(`notifications.${key}`, { nom: name, n: photos + videos }), at: lastReceived.created_at, mine: false });
    // Jamais l'image d'un média à vue unique, même floue.
    cover = [...visible.slice(run.start, last + 1)].reverse().find((message) => message.file_uri && message.status !== 'offered' && !message.view_once);
  }
  // La photo du contact est chiffrée sur le disque (lot 2.3) : la notification lit sa copie déchiffrée.
  const photo = getContactProfile(contact).photo_uri;
  const opened = photo
    ? openMedia(photo, { scope: 'app' }).catch((e) => {
        log.warn('photo de la notification', e);
        return null;
      })
    : Promise.resolve(null);
  Promise.all([opened, makeCover(contact, cover)])
    .then(([uri, coverUri]) => showMessageNotification(contact, name, uri, lines, coverUri))
    .catch((e) => log.warn('notification', e));
}

// L'image floue du média (sur le téléphone, à partir de la copie déchiffrée) ; null si le fichier n'est
// pas encore arrivé ou si l'APK ne sait pas la faire : la notification reste alors sans image.
async function makeCover(contact: string, message: Message | undefined): Promise<string | null> {
  if (!message?.file_uri || !blurCover) {
    deleteCover(contact);
    return null;
  }
  try {
    const source = await openMedia(message.file_uri, { mime: message.file_mime });
    return await blurCover(source, coverFile(contact).uri, message.kind === 'video');
  } catch (e) {
    log.warn('couverture floue', e);
    deleteCover(contact);
    return null;
  }
}
