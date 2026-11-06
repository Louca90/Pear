import type { Message } from '../../chat/database';

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
  if (message.kind === 'wallpaper') return 'changé le fond de discussion';
  if (!message.text.startsWith('saved:')) return 'retiré le fond de discussion';
  const [, kind, owner] = message.text.split(':');
  const noun = kind === 'video' ? 'vidéo' : 'photo';
  if (message.mine === 1) return `enregistré une ${noun} sur votre téléphone`;
  return `enregistré ${owner === 'yours' ? 'votre' : 'sa'} ${noun} sur son téléphone`;
}
