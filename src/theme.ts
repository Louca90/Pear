import { useSyncExternalStore } from 'react';
import { Appearance, ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';

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
  shadow: 'rgba(0, 0, 0, 0.6)',
  onMedia: '#FFFFFF',
  bubbleMine: '#E9E9EB',
  bubbleTheirs: '#26262A',
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

// Des styles qui dépendent de la palette, créés une seule fois par thème.
export function createStyles<T extends NamedStyles<T>>(factory: (colors: Palette) => T) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const colors = useColors();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
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
  return whiteWins
    ? { background, text: light.background, muted: light.onDarkMuted, track: light.onDarkTrack }
    : { background, text: light.text, muted: light.textMuted, track: light.border };
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
