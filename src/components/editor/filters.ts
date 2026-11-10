import type { ViewStyle } from 'react-native';

import type { TextKey } from '../../i18n';
import { fixed } from '../../theme';
import type { StampKind } from './stamps';
import { brightness, chain, ColorMatrix, contrast, fade, FADE_GRAY, FADE_OPACITY, mix, saturation, SEPIA, temperature } from './colorMatrix';

// Un filtre est une suite d'étapes. Les mêmes étapes donnent la matrice du fichier final (photo : SVG,
// vidéo : Media3) et l'aperçu d'une vidéo pendant l'édition (filtres de vue de React Native, plus un
// voile pour le fané et la température).
export type Step =
  | { op: 'brightness'; value: number } // gain, 1 = inchangé
  | { op: 'contrast'; value: number } // gain, 1 = inchangé
  | { op: 'saturate'; value: number } // 0 = noir et blanc, 1 = inchangé
  | { op: 'sepia'; value: number } // 0 à 1
  | { op: 'warmth'; value: number } // -1 (froid) à 1 (chaud)
  | { op: 'fade'; value: number }; // 0 à 1

export type FilterId = 'none' | 'time' | 'date' | 'weekday' | 'place' | 'streak' | 'battery' | 'film' | 'bw' | 'sepia' | 'warm' | 'cool' | 'vivid' | 'faded' | 'vintage' | 'punch' | 'dark';

export type FilterPreset = { id: FilterId; label: TextKey; steps: Step[]; stamp?: StampKind };

// Original, puis les marques (heure, date, jour, lieu, série, batterie, pellicule), puis les couleurs. Dans chaque filtre, le voile
// et la température en dernier : sur une vidéo, ils se posent par-dessus les autres étapes.
export const FILTERS: FilterPreset[] = [
  { id: 'none', label: 'editeur.filtreOriginal', steps: [] },
  { id: 'time', label: 'editeur.filtreHeure', steps: [], stamp: 'time' },
  { id: 'date', label: 'editeur.filtreDate', steps: [], stamp: 'date' },
  { id: 'weekday', label: 'editeur.filtreJour', steps: [], stamp: 'weekday' },
  { id: 'place', label: 'editeur.filtreLieu', steps: [], stamp: 'place' },
  { id: 'streak', label: 'editeur.filtreSerie', steps: [], stamp: 'streak' },
  { id: 'battery', label: 'editeur.filtreBatterie', steps: [], stamp: 'battery' },
  { id: 'film', label: 'editeur.filtrePellicule', steps: [{ op: 'warmth', value: 0.35 }], stamp: 'film' },
  { id: 'bw', label: 'editeur.filtreNoirBlanc', steps: [{ op: 'saturate', value: 0 }, { op: 'contrast', value: 1.12 }] },
  { id: 'sepia', label: 'editeur.filtreSepia', steps: [{ op: 'sepia', value: 0.85 }, { op: 'contrast', value: 1.05 }] },
  { id: 'warm', label: 'editeur.filtreChaud', steps: [{ op: 'saturate', value: 1.1 }, { op: 'warmth', value: 0.8 }] },
  { id: 'cool', label: 'editeur.filtreFroid', steps: [{ op: 'saturate', value: 0.95 }, { op: 'warmth', value: -0.8 }] },
  { id: 'vivid', label: 'editeur.filtreVif', steps: [{ op: 'saturate', value: 1.5 }, { op: 'contrast', value: 1.1 }] },
  { id: 'faded', label: 'editeur.filtreFane', steps: [{ op: 'saturate', value: 0.7 }, { op: 'contrast', value: 0.92 }, { op: 'fade', value: 1 }] },
  { id: 'vintage', label: 'editeur.filtreVintage', steps: [{ op: 'sepia', value: 0.4 }, { op: 'saturate', value: 0.85 }, { op: 'warmth', value: 0.4 }, { op: 'fade', value: 0.8 }] },
  { id: 'punch', label: 'editeur.filtreContraste', steps: [{ op: 'contrast', value: 1.35 }, { op: 'saturate', value: 1.15 }] },
  { id: 'dark', label: 'editeur.filtreSombre', steps: [{ op: 'brightness', value: 0.58 }] },
];

export function presetOf(id: FilterId) {
  return FILTERS.find((preset) => preset.id === id) ?? FILTERS[0];
}

// Le filtre voisin, dans un sens ou dans l'autre, en tournant.
export function neighborOf(id: FilterId, direction: 1 | -1): FilterId {
  const index = FILTERS.findIndex((preset) => preset.id === id);
  return FILTERS[(index + direction + FILTERS.length) % FILTERS.length].id;
}

// Réglages manuels, de -1 à 1, 0 ne changeant rien.
export type Adjustments = { brightness: number; contrast: number; saturation: number; warmth: number };
export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
export const ADJUSTMENTS: { key: keyof Adjustments; label: TextKey }[] = [
  { key: 'brightness', label: 'editeur.luminosite' },
  { key: 'contrast', label: 'editeur.contraste' },
  { key: 'saturation', label: 'editeur.saturation' },
  { key: 'warmth', label: 'editeur.temperature' },
];

export function isAdjusted(adjustments: Adjustments) {
  return ADJUSTMENTS.some(({ key }) => adjustments[key] !== 0);
}

export function adjustmentSteps(adjustments: Adjustments): Step[] {
  const steps: Step[] = [];
  if (adjustments.brightness) steps.push({ op: 'brightness', value: 1 + adjustments.brightness * 0.4 });
  if (adjustments.contrast) steps.push({ op: 'contrast', value: 1 + adjustments.contrast * 0.5 });
  if (adjustments.saturation) steps.push({ op: 'saturate', value: 1 + adjustments.saturation });
  if (adjustments.warmth) steps.push({ op: 'warmth', value: adjustments.warmth });
  return steps;
}

// Le filtre, puis les réglages.
export function stepsOf(id: FilterId, adjustments: Adjustments): Step[] {
  return [...presetOf(id).steps, ...adjustmentSteps(adjustments)];
}

function stepMatrix(step: Step): ColorMatrix {
  switch (step.op) {
    case 'brightness':
      return brightness(step.value);
    case 'contrast':
      return contrast(step.value);
    case 'saturate':
      return saturation(step.value);
    case 'sepia':
      return mix(SEPIA, step.value);
    case 'warmth':
      return temperature(step.value);
    case 'fade':
      return fade(step.value);
  }
}

export function matrixOf(steps: Step[]): ColorMatrix {
  return chain(...steps.map(stepMatrix));
}

// --- Aperçu d'une vidéo ---

type ViewFilter = Exclude<NonNullable<ViewStyle['filter']>, string>[number];

// Les étapes que React Native applique lui-même à la vue de la vidéo, avec les mêmes formules.
export function viewFiltersOf(steps: Step[]): ViewFilter[] {
  const filters: ViewFilter[] = [];
  for (const step of steps) {
    if (step.op === 'brightness') filters.push({ brightness: step.value });
    else if (step.op === 'contrast') filters.push({ contrast: step.value });
    else if (step.op === 'saturate') filters.push({ saturate: step.value });
    else if (step.op === 'sepia') filters.push({ sepia: step.value });
  }
  return filters;
}



const WARMTH_TINT_OPACITY = 0.12;

// Les voiles posés par-dessus : exact pour le fané, approché pour la température.
export function tintsOf(steps: Step[]): { color: string; opacity: number }[] {
  const gray = Math.round(FADE_GRAY * 255);
  return steps.flatMap((step) => {
    if (step.op === 'fade') return [{ color: `rgb(${gray}, ${gray}, ${gray})`, opacity: step.value * FADE_OPACITY }];
    if (step.op === 'warmth') return [{ color: step.value > 0 ? fixed.warmTint : fixed.coolTint, opacity: Math.abs(step.value) * WARMTH_TINT_OPACITY }];
    return [];
  });
}
