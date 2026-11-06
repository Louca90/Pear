import type { Message } from '../../chat/database';
import { UPDATE_REQUIRED } from '../../chat/protocol';
import { t } from '../../i18n';

export function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Photo ou vidéo déjà disponible : affichée seule, sans bulle autour.
export function isBareMedia(message: Message) {
  const available = message.status !== 'receiving' && message.status !== 'offered' && message.status !== 'refused';
  return (message.kind === 'image' || message.kind === 'video') && available;
}

export function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function systemAction(message: Message) {
  if (message.kind === 'wallpaper') return t('chat.fondChange');
  if (message.text === UPDATE_REQUIRED) return t('chat.majRequise');
  if (!message.text.startsWith('saved:')) return t('chat.fondRetire');
  const [, kind, owner] = message.text.split(':');
  const noun = kind === 'video' ? t('chat.video') : t('chat.photo');
  if (message.mine === 1) return t('chat.enregistreMien', { objet: noun });
  return t('chat.enregistreSien', { possessif: owner === 'yours' ? t('chat.votre') : t('chat.sa'), objet: noun });
}
