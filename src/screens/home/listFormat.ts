import { t } from '../../i18n';

// Règles de la liste des conversations (lot 8.1 et 8.8), sans dépendance à l'écran : testées avec Jest.

// Au-delà, on n'affiche plus le dernier message mais « +4 nouveaux messages » avec un point sans chiffre.
export const UNREAD_DETAIL_MAX = 4;

export type Preview =
  | { kind: 'none' }
  // Non lus : le texte du dernier message, et le nombre exact dans le point (1 à 4).
  | { kind: 'unread'; count: number }
  // 5 non lus ou plus : « +4 nouveaux messages » et un point plein.
  | { kind: 'many' }
  // Conversation lue : « Envoyé il y a… » ou « Reçu il y a… ».
  | { kind: 'status'; mine: boolean; at: number };

export function previewFor(last: { mine: number; created_at: number } | null, unread: number): Preview {
  if (!last) return { kind: 'none' };
  if (unread > UNREAD_DETAIL_MAX) return { kind: 'many' };
  if (unread > 0) return { kind: 'unread', count: unread };
  return { kind: 'status', mine: last.mine === 1, at: last.created_at };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// « à l'instant », « il y a 5 min », « il y a 2 h », « il y a 3 j », puis la date au-delà d'une semaine.
export function relativeTime(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return t('liste.aLinstant');
  if (elapsed < HOUR) return t('liste.ilYaMin', { n: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t('liste.ilYaH', { n: Math.floor(elapsed / HOUR) });
  if (elapsed < 7 * DAY) return t('liste.ilYaJ', { n: Math.floor(elapsed / DAY) });
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(at);
}

// Recherche insensible à la casse et aux accents : « elodie » trouve « Élodie ».
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function matchesSearch(name: string, query: string): boolean {
  const wanted = normalizeSearch(query);
  return wanted === '' || normalizeSearch(name).includes(wanted);
}
