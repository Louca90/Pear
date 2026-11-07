import { describe, expect, it } from '@jest/globals';

import { cropGeometry, fullRect, isCropped, NO_CROP, nextRotation, rotatedSize } from './crop';

describe('recadrage', () => {
  const photo = { width: 4000, height: 3000 };
  const screen = { width: 400, height: 800 };

  it("sans recadrage, l'aperçu est la photo ajustée à l'écran", () => {
    const geometry = cropGeometry(photo, NO_CROP, screen);
    expect(geometry.width).toBeCloseTo(400);
    expect(geometry.height).toBeCloseTo(300);
    expect(geometry.image).toEqual({ left: 0, top: 0, width: 400, height: 300, rotation: 0 });
    expect(geometry.pixelsPerPoint).toBeCloseTo(10);
    expect(isCropped(NO_CROP)).toBe(false);
  });

  it('la moitié droite remplit tout l’aperçu', () => {
    const geometry = cropGeometry(photo, { rotation: 0, rect: { x: 0.5, y: 0, width: 0.5, height: 1 } }, screen);
    expect(geometry.width).toBeCloseTo(400);
    expect(geometry.height).toBeCloseTo(600);
    // La photo est deux fois plus large que l'aperçu, décalée de sa moitié vers la gauche.
    expect(geometry.image.width).toBeCloseTo(800);
    expect(geometry.image.left).toBeCloseTo(-400);
  });

  it("tournée d'un quart de tour, la photo couchée devient debout", () => {
    const crop = { rotation: 90 as const, rect: { x: 0, y: 0, width: 1, height: 1 } };
    expect(rotatedSize(photo, 90)).toEqual({ width: 3000, height: 4000 });
    const geometry = cropGeometry(photo, crop, screen);
    expect(geometry.width).toBeCloseTo(400);
    expect(geometry.height).toBeCloseTo(533.33, 1);
    // La photo garde sa taille couchée, centrée sur l'aperçu debout, puis tournée.
    expect(geometry.image.width).toBeCloseTo(533.33, 1);
    expect(geometry.image.left).toBeCloseTo((400 - 533.33) / 2, 1);
    expect(isCropped(crop)).toBe(true);
  });

  it('cadre au format choisi, centré', () => {
    expect(fullRect(photo, 0, 1)).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    // Tournée (3000 × 4000, rapport 0,75), plus large que 9:16 : on garde 0,5625 / 0,75 de sa largeur.
    const story = fullRect(photo, 90, 9 / 16);
    expect(story.width).toBeCloseTo(0.75);
    expect(story.height).toBe(1);
    expect(story.x).toBeCloseTo(0.125);
    expect(fullRect(photo, 0, null)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(nextRotation(270)).toBe(0);
  });
});
