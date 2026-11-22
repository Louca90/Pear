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

// Les pages d'une version (4 au plus). Une version corrective sans pages à elle (1.9.1) montre celles de
// sa version (1.9.0) : après une mise à jour, on voit toujours les nouveautés en grand quand elles
// existent. Vide : la popup courte reste.
export function pagesFor(version: string, pages: Record<string, WhatsNewPage[]> = PAGES): WhatsNewPage[] {
  const minor = /^(\d+)\.(\d+)\.\d+$/.exec(version);
  const own = pages[version] ?? (minor ? pages[`${minor[1]}.${minor[2]}.0`] : undefined);
  return (own ?? []).slice(0, MAX_PAGES);
}

// La visite guidée de « Découvrir Pear » : ce que fait l'app, en quatre pages.
export const DISCOVER_PAGES: WhatsNewPage[] = [
  { theme: 'securite', titre: 'decouvrir.directTitre', texte: 'decouvrir.directTexte', demo: 'direct' },
  { theme: 'securite', titre: 'decouvrir.faceTitre', texte: 'decouvrir.faceTexte', demo: 'faceAFace' },
  { theme: 'conversation', titre: 'decouvrir.ephemereTitre', texte: 'decouvrir.ephemereTexte', demo: 'ephemere' },
  { theme: 'camera', titre: 'decouvrir.outilsTitre', texte: 'decouvrir.outilsTexte', demo: 'outils' },
];

// Toutes les pages déjà sorties, rangées par thème, pour « Découvrir Pear ».
export function pagesByTheme(): { theme: WhatsNewTheme; pages: WhatsNewPage[] }[] {
  const all = Object.values(PAGES).flat();
  return THEMES.map((theme) => ({ theme, pages: all.filter((page) => page.theme === theme) })).filter((group) => group.pages.length > 0);
}
