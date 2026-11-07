// Les calques posés sur une photo ou une vidéo (textes pour l'instant ; dessins et stickers ensuite).
// Chaque calque a son centre (x, y, en points de l'aperçu), une échelle et une rotation (radians).

export type TextFont = 'classic' | 'strong' | 'elegant' | 'typewriter' | 'hand';
export type TextBackground = 'none' | 'solid' | 'soft';

export type TextLayer = {
  id: string;
  kind: 'text';
  text: string;
  font: TextFont;
  color: string;
  background: TextBackground;
  size: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type Layer = TextLayer;

export type Size = { width: number; height: number };

export const TEXT_FONTS: TextFont[] = ['classic', 'strong', 'elegant', 'typewriter', 'hand'];
export const TEXT_BACKGROUNDS: TextBackground[] = ['none', 'solid', 'soft'];
export const TEXT_COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#AF52DE', '#FF2D92'];
export const TEXT_SIZE_MIN = 18;
export const TEXT_SIZE_MAX = 64;
export const TEXT_SIZE_DEFAULT = 32;
export const SCALE_MIN = 0.3;
export const SCALE_MAX = 6;
// Une marge autour du calque pour l'attraper plus facilement.
const HIT_SLOP = 16;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

let counter = 0;
export function newLayerId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

// Le point (dans l'aperçu) est-il sur le calque, une fois sa rotation et son échelle défaites ?
export function contains(layer: Layer, size: Size | undefined, x: number, y: number) {
  if (!size) return false;
  const dx = x - layer.x;
  const dy = y - layer.y;
  const cos = Math.cos(-layer.rotation);
  const sin = Math.sin(-layer.rotation);
  const localX = (dx * cos - dy * sin) / layer.scale;
  const localY = (dx * sin + dy * cos) / layer.scale;
  const slop = HIT_SLOP / layer.scale;
  return Math.abs(localX) <= size.width / 2 + slop && Math.abs(localY) <= size.height / 2 + slop;
}

// Le calque du dessus sous le doigt (le dernier de la liste est dessiné en dernier, donc au-dessus).
export function layerAt(layers: Layer[], sizes: Record<string, Size>, x: number, y: number): Layer | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    if (contains(layers[index], sizes[layers[index].id], x, y)) return layers[index];
  }
  return null;
}

// Le calque touché passe au-dessus des autres.
export function bringToFront(layers: Layer[], id: string) {
  const layer = layers.find((item) => item.id === id);
  return layer ? [...layers.filter((item) => item.id !== id), layer] : layers;
}

export function updateLayer(layers: Layer[], id: string, change: Partial<Layer>) {
  return layers.map((layer) => (layer.id === id ? { ...layer, ...change } : layer));
}

// Texte noir sur fond clair, blanc sur fond foncé (fond plein).
export function readableOn(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#000000' : '#FFFFFF';
}
