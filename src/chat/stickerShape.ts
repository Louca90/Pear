// Stickers maison (lot 4.9) : géométrie de la découpe au doigt, sans dépendance au téléphone (testée
// avec Jest). Le contour est une suite de points x, y (points de l'écran, dans la photo affichée).

export type Bounds = { x: number; y: number; width: number; height: number };

// Sous cette taille, ou avec trop peu de points, ce n'est pas un contour : un appui ou un petit trait.
const MIN_SIDE = 48;
const MIN_POINTS = 8;
// Côté le plus long de l'image du sticker, en pixels.
export const STICKER_PIXELS = 512;

export function outlineBounds(points: number[]): Bounds | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length - 1; index += 2) {
    minX = Math.min(minX, points[index]);
    maxX = Math.max(maxX, points[index]);
    minY = Math.min(minY, points[index + 1]);
    maxY = Math.max(maxY, points[index + 1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function isUsableOutline(points: number[]): boolean {
  const bounds = outlineBounds(points);
  return !!bounds && points.length >= MIN_POINTS * 2 && bounds.width >= MIN_SIDE && bounds.height >= MIN_SIDE;
}

const round = (value: number) => Math.round(value * 10) / 10;

// Le contour fermé en tracé SVG, lissé (courbes passant par le milieu des points), décalé de (dx, dy) :
// dans la photo entière (0, 0), ou dans le cadre du sticker (-bounds.x, -bounds.y).
export function outlinePath(points: number[], dx = 0, dy = 0): string {
  const count = points.length / 2;
  if (count < 3) return '';
  const x = (index: number) => points[(index % count) * 2] + dx;
  const y = (index: number) => points[(index % count) * 2 + 1] + dy;
  const midX = (index: number) => (x(index) + x(index + 1)) / 2;
  const midY = (index: number) => (y(index) + y(index + 1)) / 2;
  let d = `M${round(midX(0))} ${round(midY(0))}`;
  for (let index = 1; index <= count; index += 1) d += ` Q${round(x(index))} ${round(y(index))} ${round(midX(index))} ${round(midY(index))}`;
  return `${d} Z`;
}

// Garde le point dans la photo affichée : le doigt peut déborder, pas la découpe.
export function clampPoint(x: number, y: number, width: number, height: number): [number, number] {
  return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
}

// Agrandissement de la capture pour que le plus long côté fasse STICKER_PIXELS : jamais plus que ×1,
// et jamais moins que ×0,5 (la limite de la capture native).
export function captureScale(bounds: Bounds, pixelRatio: number): number {
  const longest = Math.max(bounds.width, bounds.height) * pixelRatio;
  return Math.max(0.5, Math.min(1, STICKER_PIXELS / longest));
}

// La photo tient en entier dans la zone (largeur × hauteur), centrée.
export function fitInside(image: { width: number; height: number }, area: { width: number; height: number }) {
  const scale = Math.min(area.width / image.width, area.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, left: (area.width - width) / 2, top: (area.height - height) / 2 };
}
