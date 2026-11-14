// Les lentilles (filtres fun) de l'appareil photo, par catégorie. Les identifiants sont ceux du dessin
// natif (FaceLens.kt) ; « none » n'en dessine aucune. Couleurs : les filtres de couleur habituels.
import type { TextKey } from '../../i18n';

export type LensCategory = 'visage' | 'reactions' | 'couleurs';

export type Lens = {
  id: string;
  glyph: string;
  // Clé de traduction du nom, et du conseil pour les lentilles qui réagissent à une expression.
  label: TextKey;
  hint?: TextKey;
};

export const NO_LENS = 'none';

// Filtres désactivés pour la mise à jour en cours (voir CLAUDE.md, « Filtres de l'appareil photo ») :
// FILTERS_ENABLED montre la bande des filtres sous le déclencheur (filtres de couleur) ; LENSES_ENABLED y
// ajoute les lentilles (catégories Visage, Réactions, conseils). Les lentilles demandent la bande.
export const FILTERS_ENABLED = false;
export const LENSES_ENABLED = false && FILTERS_ENABLED;

export const LENS_CATEGORIES: { id: LensCategory; label: TextKey }[] = [
  { id: 'visage', label: 'lentilles.visage' },
  { id: 'reactions', label: 'lentilles.reactions' },
  { id: 'couleurs', label: 'lentilles.couleurs' },
];

const NONE: Lens = { id: NO_LENS, glyph: '', label: 'lentilles.aucune' };

export const LENSES: Record<Exclude<LensCategory, 'couleurs'>, Lens[]> = {
  visage: [
    NONE,
    { id: 'glasses', glyph: '🕶️', label: 'lentilles.lunettes' },
    { id: 'crown', glyph: '👑', label: 'lentilles.couronne' },
    { id: 'dog', glyph: '🐶', label: 'lentilles.chien' },
    { id: 'cat', glyph: '🐱', label: 'lentilles.chat' },
    { id: 'mustache', glyph: '🥸', label: 'lentilles.moustache' },
  ],
  reactions: [
    NONE,
    { id: 'hearts', glyph: '💖', label: 'lentilles.coeurs', hint: 'lentilles.ouvreBouche' },
    { id: 'kisses', glyph: '😘', label: 'lentilles.bisous', hint: 'lentilles.faisBisou' },
    { id: 'stars', glyph: '✨', label: 'lentilles.etoiles', hint: 'lentilles.souris' },
    { id: 'tears', glyph: '😢', label: 'lentilles.larmes', hint: 'lentilles.faisTriste' },
  ],
};

export function lensOf(id: string): Lens | undefined {
  return [...LENSES.visage, ...LENSES.reactions].find((lens) => lens.id === id && lens.id !== NO_LENS);
}
