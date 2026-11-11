import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Appearance, Easing, ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';

import { getSetting, setSetting } from './chat/database';
import { log } from './log';

// Toutes les couleurs et tailles de l'app, au même endroit. Les écrans lisent la palette du thème
// courant avec useColors() et leurs styles avec createStyles() : rien n'est écrit en dur ailleurs.
export type Palette = {
  scheme: 'light' | 'dark';
  background: string;
  surface: string;
  // Ce qui flotte au-dessus du fond (barre du bas, menus, saisie, popups) et sa partie active.
  elevated: string;
  elevatedActive: string;
  border: string;
  text: string;
  textMuted: string;
  // Texte et pistes posés sur un fond sombre (bulle foncée, visionneuse, caméra), quel que soit le thème.
  onDarkMuted: string;
  onDarkTrack: string;
  overlay: string;
  selectionDim: string;
  disabled: string;
  danger: string;
  // Bouton principal : fond de la couleur du texte, libellé de la couleur du fond.
  accent: string;
  onAccent: string;
  // Couleur signature : boutons principaux, pastilles, anneaux. Jamais en fond d'écran.
  signature: string;
  onSignature: string;
  // Petits indicateurs (anneau « en ligne », point, coche « vérifié »).
  signatureStrong: string;
  shadow: string;
  // Icônes et texte posés sur une photo ou une vidéo : toujours blancs.
  onMedia: string;
  // Bulles par défaut, quand la conversation n'a pas de couleur choisie.
  bubbleMine: string;
  bubbleTheirs: string;
};

const light: Palette = {
  scheme: 'light',
  background: '#FFFFFF',
  surface: '#F5F5F5',
  elevated: '#FFFFFF',
  elevatedActive: '#F0F0F0',
  border: '#E8E8E8',
  text: '#000000',
  textMuted: '#6B6B6B',
  onDarkMuted: '#B8B8B8',
  onDarkTrack: '#4A4A4A',
  overlay: 'rgba(0, 0, 0, 0.55)',
  selectionDim: 'rgba(0, 0, 0, 0.12)',
  disabled: '#C4C4C4',
  danger: '#C62828',
  accent: '#000000',
  onAccent: '#FFFFFF',
  signature: '#E6EFCB',
  onSignature: '#000000',
  signatureStrong: '#9DB84A',
  shadow: 'rgba(0, 0, 0, 0.14)',
  onMedia: '#FFFFFF',
  bubbleMine: '#000000',
  bubbleTheirs: '#F5F5F5',
};

const dark: Palette = {
  scheme: 'dark',
  background: '#0B0B0C',
  surface: '#1A1A1C',
  elevated: '#1F1F22',
  elevatedActive: '#36363A',
  border: '#2C2C2F',
  text: '#F5F5F7',
  textMuted: '#8E8E93',
  onDarkMuted: '#B8B8B8',
  onDarkTrack: '#4A4A4A',
  overlay: 'rgba(0, 0, 0, 0.7)',
  selectionDim: 'rgba(0, 0, 0, 0.45)',
  disabled: '#4A4A4A',
  danger: '#EF5350',
  accent: '#F5F5F7',
  onAccent: '#0B0B0C',
  signature: '#2B3420',
  onSignature: '#E3EDC8',
  signatureStrong: '#B4CC68',
  shadow: 'rgba(0, 0, 0, 0.6)',
  onMedia: '#FFFFFF',
  bubbleMine: '#E9E9EB',
  bubbleTheirs: '#26262A',
};

// Couleurs qui ne changent jamais avec le thème : le contenu des photos et de l'éditeur, les dessins
// (flamme, cœur, aperçu des filtres), le QR code. Les autres fichiers n'écrivent aucune couleur en dur.
export const fixed = {
  white: '#FFFFFF',
  black: '#000000',
  // Éditeur : voiles de température posés sur la vidéo, tampons « pellicule ».
  warmTint: '#FF8A00',
  coolTint: '#0A6CFF',
  filmOrange: '#FF8A1F',
  filmGlow: '#C8320A',
  // Filtre Batterie : niveau bas.
  batteryLow: '#FF5A4F',
  // Couleurs proposées pour le texte et le pinceau de l'éditeur.
  editorTextColors: ['#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#AF52DE', '#FF2D92'],
  // Cœur du double appui, flamme de la série.
  heart: '#FF3B5C',
  flame: '#FF7A1A',
  flameCore: '#FFC94D',
  // Petit paysage qui montre l'effet des filtres, et son fond.
  scene: { sky: '#7FBDF0', sun: '#FFC93C', cloud: '#FFFFFF', hill: '#7CC36A', hillDark: '#2E8B4A', house: '#E5483B' },
  filterStripBackground: '#1C1C1E',
};

// --- Choix du thème : suit le système, ou forcé clair / sombre (réglage du profil) ---

export type ThemePreference = 'auto' | 'light' | 'dark';
const SETTING_KEY = 'theme';

let preference: ThemePreference | null = null;
// Avant la lecture du réglage (base pas encore ouverte), on suit le système.
let palette: Palette = Appearance.getColorScheme() === 'dark' ? dark : light;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  if (preference) return preference;
  try {
    const saved = getSetting(SETTING_KEY);
    preference = saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch (e) {
    log.warn('thème', e);
    preference = 'auto';
  }
  return preference;
}

// `changed` : le choix lui-même a changé (Automatique → Sombre peut garder la même palette).
function update(changed = false) {
  const wanted = readPreference();
  const scheme = wanted === 'auto' ? (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light') : wanted;
  const next = scheme === 'dark' ? dark : light;
  if (next === palette && !changed) return;
  palette = next;
  listeners.forEach((listener) => listener());
}

Appearance.addChangeListener(() => update());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Appelé au démarrage, une fois la base ouverte.
export function loadTheme() {
  update(true);
}

export function themePreference() {
  return readPreference();
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  setSetting(SETTING_KEY, next);
  update(true);
}

export function useColors(): Palette {
  return useSyncExternalStore(subscribe, () => palette);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => readPreference());
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

// --- Taille du texte : 4 crans (réglage des Paramètres), appliquée aux styles de createStyles ---

export const TEXT_SCALES = [1, 1.12, 1.25, 1.4] as const;
const TEXT_SCALE_KEY = 'text_scale';
let scaleIndex: number | null = null;
const scaleListeners = new Set<() => void>();

export function textScaleIndex(): number {
  if (scaleIndex !== null) return scaleIndex;
  try {
    const saved = Number(getSetting(TEXT_SCALE_KEY));
    scaleIndex = Number.isInteger(saved) && saved >= 0 && saved < TEXT_SCALES.length ? saved : 0;
  } catch (e) {
    log.warn('taille du texte', e);
    scaleIndex = 0;
  }
  return scaleIndex;
}

export function setTextScaleIndex(next: number) {
  scaleIndex = next;
  setSetting(TEXT_SCALE_KEY, next === 0 ? null : String(next));
  scaleListeners.forEach((listener) => listener());
}

function subscribeScale(listener: () => void) {
  scaleListeners.add(listener);
  return () => {
    scaleListeners.delete(listener);
  };
}

export function useTextScaleIndex(): number {
  return useSyncExternalStore(subscribeScale, textScaleIndex);
}

function scaleText<T extends NamedStyles<T>>(styles: T, scale: number): T {
  if (scale === 1) return styles;
  const out: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(styles) as [string, Record<string, unknown>][]) {
    const next = { ...style };
    if (typeof next.fontSize === 'number') next.fontSize = Math.round(next.fontSize * scale * 2) / 2;
    if (typeof next.lineHeight === 'number') next.lineHeight = Math.round(next.lineHeight * scale * 2) / 2;
    out[name] = next;
  }
  return out as T;
}

// Des styles qui dépendent de la palette, créés une seule fois par thème et par taille de texte.
export function createStyles<T extends NamedStyles<T>>(factory: (colors: Palette) => T) {
  const cache = new Map<Palette, Map<number, T>>();
  return function useStyles(): T {
    const colors = useColors();
    const index = useTextScaleIndex();
    let bySize = cache.get(colors);
    if (!bySize) {
      bySize = new Map();
      cache.set(colors, bySize);
    }
    let styles = bySize.get(index);
    if (!styles) {
      styles = StyleSheet.create(scaleText(factory(colors), TEXT_SCALES[index]));
      bySize.set(index, styles);
    }
    return styles;
  };
}

// Caméra, éditeur et visionneuse sont toujours sur fond noir et gardent la même palette quel que soit
// le thème (dessinée pour eux : `background` y est le blanc des icônes, `text` le noir des pastilles).
export function useMediaColors(): Palette {
  return light;
}

export function createMediaStyles<T extends NamedStyles<T>>(factory: (colors: Palette) => T) {
  const styles = StyleSheet.create(factory(light));
  return function useStyles(): T {
    return styles;
  };
}

// --- Mouvement ---

// Toutes les durées d'animation, au même endroit. Une seule courbe : démarre vite et se pose
// doucement, sans jamais dépasser (aucun rebond). Si Android a « Supprimer les animations », les
// durées valent 0 : lire `motion.press` etc. au moment de lancer l'animation, pas dans une
// constante de module.
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch((e) => log.warn('animations', e));
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

const duration = (ms: number) => (reduceMotion ? 0 : ms);

export const motion = {
  // Appui sur un bouton.
  get press() {
    return duration(110);
  },
  // Apparition, changement d'état.
  get small() {
    return duration(180);
  },
  // Passage d'un écran à l'autre.
  get screen() {
    return duration(180);
  },
  // La poire mascotte.
  get mascot() {
    return duration(420);
  },
  easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  // Effet d'appui commun à tous les boutons (src/components/ui.tsx).
  pressScale: 0.97,
  pressOpacity: 0.85,
  get reduced() {
    return reduceMotion;
  },
};

// --- Bulles ---

// Couleurs proposées pour les bulles. Des aplats uniquement.

export type BubblePalette = {
  background: string;
  text: string;
  muted: string;
  track: string;
};

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

// Lisibilité du texte, en un seul endroit :
// - sur le fond de l'app : colors.text / colors.textMuted (suivent le thème) ;
// - sur un bouton principal (fond colors.accent) : colors.onAccent ;
// - sur une photo, une vidéo ou un fond d'écran (pastille colors.overlay) : colors.onMedia / colors.onDarkMuted ;
// - sur n'importe quelle autre couleur (bulle personnalisée…) : readableOn(couleur).
//
// Choisit le texte le plus lisible sur cette couleur, avec la formule de contraste des normes
// d'accessibilité (WCAG). Indépendant du thème : seule la couleur du fond compte.
export function readableOn(background: string): BubblePalette {
  const level = luminance(background);
  const whiteWins = 1.05 / (level + 0.05) > (level + 0.05) / 0.05;
  // La piste (bouton du vocal, barres pas encore écoutées, barre de transfert) est le fond de la bulle
  // tiré vers la couleur du texte : elle se détache toujours, sur une bulle claire comme sur une foncée.
  return whiteWins
    ? { background, text: light.background, muted: light.onDarkMuted, track: mix(background, fixed.white, 0.26) }
    : { background, text: light.text, muted: light.textMuted, track: mix(background, fixed.black, 0.16) };
}

// Mélange deux couleurs « #RRGGBB » : `amount` = part de la seconde, de 0 à 1.
export function mix(from: string, to: string, amount: number) {
  const channel = (start: number) => {
    const a = parseInt(from.slice(start, start + 2), 16);
    const b = parseInt(to.slice(start, start + 2), 16);
    return Math.round(a + (b - a) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// Bulle d'un message éphémère : vide, cernée de pointillés de la couleur de la bulle normale. On la
// reconnaît d'un coup d'œil, sans nouvelle couleur. Si la bulle normale se confond avec le fond de
// l'app (bulle reçue par défaut), le contour prend le gris du texte secondaire.
export type EphemeralBubble = BubblePalette & { border: string };

export function ephemeralBubble(base: BubblePalette, colors: Palette): EphemeralBubble {
  return {
    ...readableOn(colors.background),
    muted: colors.textMuted,
    border: contrast(base.background, colors.background) >= 1.6 ? base.background : colors.textMuted,
  };
}

export const bubblePalette = readableOn;

export const spacing = {
  sm: 8,
  md: 16,
  lg: 24,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  full: 999,
};
