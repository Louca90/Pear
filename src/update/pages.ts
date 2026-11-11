import notes from './release-notes.json';
import type { TextKey } from '../i18n';

// Une page « Quoi de neuf » : une nouveauté, un titre, une phrase, une petite démo.
export type WhatsNewTheme = 'conversation' | 'securite' | 'camera' | 'personnalisation';
export type WhatsNewPage = {
  theme: WhatsNewTheme;
  titre: TextKey;
  texte: TextKey;
  // Nom d'une démo de src/update/demos/ ; absente ou inconnue : la poire seule.
  demo?: string;
  // Page « tutoriel » : un bouton d'action en plus (voir ACTIONS).
  action?: { id: string; label: TextKey };
};

export const THEMES: WhatsNewTheme[] = ['conversation', 'securite', 'camera', 'personnalisation'];
export const MAX_PAGES = 4;

// Actions des pages tutoriel, par identifiant. Vide tant qu'aucune fonction n'en a besoin
// (le widget d'accueil y mettra « widget »).
export const ACTIONS: Record<string, () => void> = {};

const PAGES = (notes as unknown as { pages?: Record<string, WhatsNewPage[]> }).pages ?? {};

// Les pages d'une version (4 au plus) ; vide : la popup courte reste.
export function pagesFor(version: string): WhatsNewPage[] {
  return (PAGES[version] ?? []).slice(0, MAX_PAGES);
}

// Toutes les pages déjà sorties, rangées par thème, pour « Découvrir Pear ».
export function pagesByTheme(): { theme: WhatsNewTheme; pages: WhatsNewPage[] }[] {
  const all = Object.values(PAGES).flat();
  return THEMES.map((theme) => ({ theme, pages: all.filter((page) => page.theme === theme) })).filter((group) => group.pages.length > 0);
}
