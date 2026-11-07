// Le dessin à main levée : chaque trait garde ses points (dans l'aperçu), sa couleur et son épaisseur.
// Le tracé SVG est lissé (courbes passant par le milieu des points), pour un trait souple.

export type Stroke = { id: string; color: string; width: number; points: number[] };

export const BRUSH_MIN = 3;
export const BRUSH_MAX = 30;
export const BRUSH_DEFAULT = 8;
// Sous cette distance, un nouveau point n'apporte rien : on l'ignore (moins de points, trait plus lisse).
const MIN_STEP = 2;

export function addPoint(points: number[], x: number, y: number) {
  const count = points.length;
  if (count >= 2 && Math.hypot(x - points[count - 2], y - points[count - 1]) < MIN_STEP) return points;
  return [...points, x, y];
}

// Un seul point devient un rond (un petit trait de longueur nulle, aux bouts arrondis).
export function strokePath(points: number[]) {
  if (points.length < 2) return '';
  const x0 = points[0];
  const y0 = points[1];
  if (points.length === 2) return `M${x0} ${y0} L${x0 + 0.01} ${y0}`;
  let d = `M${x0} ${y0}`;
  for (let index = 2; index < points.length - 2; index += 2) {
    const midX = (points[index] + points[index + 2]) / 2;
    const midY = (points[index + 1] + points[index + 3]) / 2;
    d += ` Q${points[index]} ${points[index + 1]} ${midX} ${midY}`;
  }
  d += ` L${points[points.length - 2]} ${points[points.length - 1]}`;
  return d;
}

// Distance d'un point au segment [a, b].
function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// La gomme passe sur le trait ?
export function touchesStroke(stroke: Stroke, x: number, y: number, radius: number) {
  const reach = radius + stroke.width / 2;
  const { points } = stroke;
  if (points.length === 2) return Math.hypot(x - points[0], y - points[1]) <= reach;
  for (let index = 0; index < points.length - 2; index += 2) {
    if (segmentDistance(x, y, points[index], points[index + 1], points[index + 2], points[index + 3]) <= reach) return true;
  }
  return false;
}

// Historique pour annuler et rétablir : chaque état est la liste complète des traits.
export type History = { past: Stroke[][]; present: Stroke[]; future: Stroke[][] };

export function historyOf(strokes: Stroke[]): History {
  return { past: [], present: strokes, future: [] };
}

export function commit(history: History, next: Stroke[]): History {
  if (next === history.present) return history;
  return { past: [...history.past, history.present], present: next, future: [] };
}

export function undo(history: History): History {
  if (history.past.length === 0) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  if (history.future.length === 0) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
