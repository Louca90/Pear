import { describe, expect, it } from '@jest/globals';

import { apply, brightness, chain, compose, contrast, fade, FADE_GRAY, FADE_OPACITY, IDENTITY, isIdentity, mix, saturation, SEPIA, temperature, toMedia3 } from './colorMatrix';
import { adjustmentSteps, FILTERS, matrixOf, neighborOf, NO_ADJUSTMENTS, stepsOf, tintsOf, viewFiltersOf } from './filters';

const close = (a: number[], b: number[]) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index], 5));

describe('matrices de couleur', () => {
  it("l'identité ne change rien et se compose sans effet", () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    close([...compose(IDENTITY, SEPIA)], [...SEPIA]);
    close([...compose(SEPIA, IDENTITY)], [...SEPIA]);
    expect(isIdentity(chain())).toBe(true);
  });

  it("chain applique les matrices dans l'ordre", () => {
    const darkThenContrast = chain(brightness(0.5), contrast(2));
    // 0,8 → 0,4 (luminosité), puis 0,4 → 0,3 (contraste autour de 0,5).
    close(apply(darkThenContrast, [0.8, 0.8, 0.8]), [0.3, 0.3, 0.3]);
    close(apply(chain(contrast(2), brightness(0.5)), [0.8, 0.8, 0.8]), [0.55, 0.55, 0.55]);
  });

  it('la saturation à 0 donne du gris, à 1 ne change rien', () => {
    const [r, g, b] = apply(saturation(0), [1, 0, 0]);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
    expect(r).toBeCloseTo(0.2126, 4);
    expect(isIdentity(saturation(1))).toBe(true);
  });

  it('le contraste garde le gris moyen', () => {
    close(apply(contrast(1.7), [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5]);
  });

  it('le fané est un voile gris posé par-dessus', () => {
    const opacity = FADE_OPACITY;
    close(apply(fade(1), [0, 0.5, 1]), [0, 0.5, 1].map((value) => value * (1 - opacity) + FADE_GRAY * opacity));
  });

  it('la température réchauffe ou refroidit, et rien à 0', () => {
    const [r, , b] = apply(temperature(1), [0.5, 0.5, 0.5]);
    expect(r).toBeGreaterThan(b);
    expect(isIdentity(temperature(0))).toBe(true);
    expect(isIdentity(mix(SEPIA, 0))).toBe(true);
  });

  it('se convertit pour Media3 : 4 × 4 par colonnes, décalage en dernière colonne', () => {
    close(toMedia3(IDENTITY), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const media3 = toMedia3(contrast(2));
    // Ligne rouge : gain 2 en (0, 0), décalage -0,5 en colonne 3.
    expect(media3[0]).toBeCloseTo(2, 5);
    expect(media3[12]).toBeCloseTo(-0.5, 5);
    expect(media3[15]).toBe(1);
  });
});

describe('filtres', () => {
  it('chaque filtre donne une matrice valide, et Original ne change rien', () => {
    for (const preset of FILTERS) expect(matrixOf(preset.steps).every(Number.isFinite)).toBe(true);
    expect(isIdentity(matrixOf(stepsOf('none', NO_ADJUSTMENTS)))).toBe(true);
    expect(isIdentity(matrixOf(stepsOf('time', NO_ADJUSTMENTS)))).toBe(true);
  });

  it('passe au voisin en tournant', () => {
    expect(neighborOf('none', 1)).toBe(FILTERS[1].id);
    expect(neighborOf('none', -1)).toBe(FILTERS[FILTERS.length - 1].id);
  });

  it('les réglages à 0 ne font rien', () => {
    expect(adjustmentSteps(NO_ADJUSTMENTS)).toEqual([]);
    expect(adjustmentSteps({ ...NO_ADJUSTMENTS, contrast: 1 })).toEqual([{ op: 'contrast', value: 1.5 }]);
  });

  it("l'aperçu vidéo reprend les étapes : filtres de vue et voiles", () => {
    const steps = stepsOf('vintage', NO_ADJUSTMENTS);
    expect(viewFiltersOf(steps)).toEqual([{ sepia: 0.4 }, { saturate: 0.85 }]);
    expect(tintsOf(steps)).toHaveLength(2);
    expect(tintsOf(stepsOf('bw', NO_ADJUSTMENTS))).toEqual([]);
  });
});
