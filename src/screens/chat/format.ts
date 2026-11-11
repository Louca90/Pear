import type { Message } from '../../chat/database';
import { UPDATE_REQUIRED } from '../../chat/protocol';
import { parseEphemeralSystem } from '../../chat/ephemeral';
import { t } from '../../i18n';

export function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Photo ou vidéo déjà disponible : affichée seule, sans bulle autour.
// Média dont le fichier a été supprimé (page Stockage, nettoyage automatique) : le message reste.
export function isMediaDeleted(message: Message) {
  // Un média à vue unique perd son fichier par nature : il garde sa propre ligne (« Ouverte »).
  if (message.view_once) return false;
  const media = message.kind === 'image' || message.kind === 'video' || message.kind === 'audio' || message.kind === 'file';
  const settled = message.status !== 'receiving' && message.status !== 'offered' && message.status !== 'refused' && message.status !== 'sending';
  return media && settled && !message.file_uri;
}

export function isBareMedia(message: Message) {
  const available = message.status !== 'receiving' && message.status !== 'offered' && message.status !== 'refused';
  return (message.kind === 'image' || message.kind === 'video') && available && !message.view_once && !isMediaDeleted(message);
}

// Sticker maison (lot 4.9) : une image envoyée comme telle, montrée petite et sans cadre.
export function isSticker(message: Message) {
  return message.kind === 'image' && !!message.meta && message.meta.includes('"sticker":true');
}

// Durée d'un minuteur de messages éphémères : « 1 jour », ou « 1 j » en court (à côté du nom).
export function ephemeralLabel(seconds: number, short = false): string {
  const key = seconds <= 3600 ? 'h1' : seconds <= 86400 ? 'j1' : 's1';
  return t(short ? `ephemere.${key}Court` : `ephemere.${key}`);
}

export function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function systemAction(message: Message) {
  if (message.kind === 'wallpaper') return t('chat.fondChange');
  if (message.text === UPDATE_REQUIRED) return t('chat.majRequise');
  const ephemeral = parseEphemeralSystem(message.text);
  if (ephemeral !== null) return ephemeral ? t('ephemere.active', { duree: ephemeralLabel(ephemeral) }) : t('ephemere.coupe');
  if (!message.text.startsWith('saved:')) return t('chat.fondRetire');
  const [, kind, owner] = message.text.split(':');
  const noun = kind === 'video' ? t('chat.video') : t('chat.photo');
  if (message.mine === 1) return t('chat.enregistreMien', { objet: noun });
  return t('chat.enregistreSien', { possessif: owner === 'yours' ? t('chat.votre') : t('chat.sa'), objet: noun });
}

// Liens d'un message : http(s)://… ou www.…, sans la ponctuation finale (« voir https://x.fr. »).
const LINK = /\b(?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]'"»]/gi;

export type TextPart = { text: string; url?: string };

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    const link = match[0];
    parts.push({ text: link, url: /^https?:\/\//i.test(link) ? link : `https://${link}` });
    last = start + link.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// Un emoji tel qu'on le voit : avec sa teinte de peau, ses assemblages (famille, drapeau de métier)
// et les drapeaux de pays (deux lettres régionales).
// Plages explicites plutôt que \p{Extended_Pictographic}, que Hermes ne connaît pas forcément.
const PICTO = String.raw`[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{3030}\u{303D}\u{3297}\u{3299}\u{A9}\u{AE}\u{203C}\u{2049}\u{2122}\u{2139}]\u{FE0F}?[\u{1F3FB}-\u{1F3FF}]?`;
const EMOJI = new RegExp(String.raw`[\u{1F1E6}-\u{1F1FF}]{2}|${PICTO}(?:\u{200D}${PICTO})*|[0-9#*]\u{FE0F}?\u{20E3}`, 'gu');

// Nombre d'emojis d'un texte fait seulement d'emojis (1 à 3), 0 sinon : il s'affiche en grand, sans bulle.
export function emojiOnly(text: string): number {
  const trimmed = text.replace(/\s/g, '');
  if (!trimmed) return 0;
  const found = trimmed.match(EMOJI) ?? [];
  if (found.join('') !== trimmed) return 0;
  return found.length <= 3 ? found.length : 0;
}

// Le vocal suivant à lire automatiquement : le message juste en dessous (liste inversée : index - 1),
// s'il est un vocal du même auteur, arrivé en entier.
export function nextVoice(messages: Message[], index: number): string | undefined {
  const message = messages[index];
  const below = messages[index - 1];
  if (!message || message.kind !== 'audio' || !below || below.kind !== 'audio' || below.mine !== message.mine) return undefined;
  if (below.status === 'receiving' || below.status === 'offered' || below.status === 'refused' || !below.file_uri) return undefined;
  return below.id;
}

// Étiquette de la date collante : « Aujourd'hui », « Hier », le jour de la semaine cette semaine, sinon la date.
export function dayLabel(at: number, now: number, locale: string): string {
  const start = (time: number) => new Date(new Date(time).toDateString()).getTime();
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days === 0) return t('chat.aujourdhui');
  if (days === 1) return t('chat.hier');
  if (days > 1 && days < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(at);
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { weekday: 'short', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(at);
}
