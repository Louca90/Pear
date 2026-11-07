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
