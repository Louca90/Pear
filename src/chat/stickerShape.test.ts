import { describe, expect, it } from '@jest/globals';

import { captureScale, clampPoint, fitInside, isUsableOutline, outlineBounds, outlinePath } from './stickerShape';

// Un carré de 100 points de côté, 5 points par côté.
const square: number[] = [];
for (let i = 0; i < 5; i += 1) square.push(10 + i * 25, 20);
for (let i = 1; i < 5; i += 1) square.push(110, 20 + i * 25);
for (let i = 1; i < 5; i += 1) square.push(110 - i * 25, 120);
for (let i = 1; i < 4; i += 1) square.push(10, 120 - i * 25);

describe('découpe d’un sticker', () => {
  it('trouve le cadre du contour', () => {
    expect(outlineBounds(square)).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    expect(outlineBounds([])).toBeNull();
  });

  it('refuse un appui ou un trait trop petit', () => {
    expect(isUsableOutline(square)).toBe(true);
    expect(isUsableOutline([10, 10, 12, 12])).toBe(false);
    expect(isUsableOutline(square.map((value) => value / 10))).toBe(false);
  });

  it('ferme le tracé et le décale dans le cadre du sticker', () => {
    const whole = outlinePath(square);
    expect(whole.startsWith('M')).toBe(true);
    expect(whole.endsWith('Z')).toBe(true);
    const local = outlinePath(square, -10, -20);
    // Décalé : aucun nombre négatif ni au-delà du cadre de 100 points.
    const numbers = local.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(100);
    expect(outlinePath([1, 1, 2, 2])).toBe('');
  });

  it('garde les points dans la photo', () => {
    expect(clampPoint(-5, 300, 200, 100)).toEqual([0, 100]);
    expect(clampPoint(50, 50, 200, 100)).toEqual([50, 50]);
  });

  it('vise 512 pixels sans jamais agrandir', () => {
    expect(captureScale({ x: 0, y: 0, width: 100, height: 50 }, 3)).toBe(1);
    expect(captureScale({ x: 0, y: 0, width: 300, height: 200 }, 3)).toBeCloseTo(512 / 900);
    expect(captureScale({ x: 0, y: 0, width: 2000, height: 200 }, 3)).toBe(0.5);
  });

  it('fait tenir la photo dans la zone, centrée', () => {
    expect(fitInside({ width: 4000, height: 3000 }, { width: 400, height: 600 })).toEqual({ width: 400, height: 300, left: 0, top: 150 });
  });
});
