import { describe, expect, it } from '@jest/globals';

import { hexToHsv, hsvToHex } from './colorMath';

describe('couleurs de la roue', () => {
  it('fait l’aller-retour entre hexadécimal et teinte/saturation/luminosité', () => {
    for (const hex of ['#000000', '#FFFFFF', '#1F6F54', '#2F5D8A', '#A5473E', '#C98A1B', '#FF0000']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('place le rouge, le vert et le bleu autour de la roue', () => {
    expect(hexToHsv('#FF0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00FF00').h).toBe(120);
    expect(hexToHsv('#0000FF').h).toBe(240);
    expect(hexToHsv('#FFFFFF')).toEqual({ h: 0, s: 0, v: 1 });
  });
});

describe('inkOn : jamais noir sur noir ni blanc sur blanc', () => {
  const { inkOn, contrastRatio } = require('./theme');
  it('garde la couleur voulue quand elle se distingue du fond', () => {
    expect(inkOn('#FFFFFF', '#000000')).toBe('#000000');
    expect(inkOn('#FFFFFF', '#9DB84A')).toBe('#9DB84A');
  });
  it('remplace une couleur invisible par noir ou blanc', () => {
    expect(inkOn('#0B0B0C', '#000000')).toBe('#FFFFFF');
    expect(inkOn('#FFFFFF', '#F5F5F5')).toBe('#000000');
  });
  it('rapport de contraste symétrique, de 1 à 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});
