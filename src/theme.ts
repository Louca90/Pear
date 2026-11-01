// Toutes les couleurs et tailles de l'app, au même endroit.
export const colors = {
  background: '#FFFFFF',
  surface: '#F5F5F5',
  border: '#E8E8E8',
  text: '#000000',
  textMuted: '#6B6B6B',
  onDarkMuted: '#B8B8B8',
  onDarkTrack: '#4A4A4A',
  overlay: 'rgba(0, 0, 0, 0.55)',
  selectionDim: 'rgba(0, 0, 0, 0.12)',
  disabled: '#C4C4C4',
  danger: '#C62828',
};

// Couleurs proposées pour les bulles. Des aplats uniquement.
export const BUBBLE_COLORS = ['#000000', '#3A3A3A', '#F5F5F5', '#FFFFFF', '#1F6F54', '#2F5D8A', '#A5473E', '#C98A1B', '#D8E8DF', '#DCE6F2', '#F4DEDA', '#F5E8C8'];

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

// Choisit le texte le plus lisible sur cette couleur, avec la formule de contraste des normes d'accessibilité (WCAG).
export function bubblePalette(background: string): BubblePalette {
  const level = luminance(background);
  const whiteWins = 1.05 / (level + 0.05) > (level + 0.05) / 0.05;
  return whiteWins
    ? { background, text: colors.background, muted: colors.onDarkMuted, track: colors.onDarkTrack }
    : { background, text: colors.text, muted: colors.textMuted, track: colors.border };
}

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
