import { describe, expect, it } from '@jest/globals';

import { bringToFront, contains, Layer, layerAt, readableOn, updateLayer } from './layers';

const text = (fields: Partial<Layer> = {}): Layer => ({
  id: 'a',
  kind: 'text',
  text: 'Salut',
  font: 'classic',
  color: '#FFFFFF',
  background: 'none',
  size: 32,
  x: 100,
  y: 100,
  scale: 1,
  rotation: 0,
  ...fields,
});

describe('calques', () => {
  const size = { width: 80, height: 40 };

  it('touche un calque dans son cadre, avec une marge', () => {
    expect(contains(text(), size, 100, 100)).toBe(true);
    expect(contains(text(), size, 150, 100)).toBe(true);
    expect(contains(text(), size, 170, 100)).toBe(false);
    expect(contains(text(), undefined, 100, 100)).toBe(false);
  });

  it("tient compte de l'échelle et de la rotation", () => {
    expect(contains(text({ scale: 2 }), size, 170, 100)).toBe(true);
    // Tourné d'un quart de tour, le cadre est debout : 55 px au-dessus du centre est dedans.
    expect(contains(text({ rotation: Math.PI / 2 }), size, 100, 45)).toBe(true);
    expect(contains(text({ rotation: Math.PI / 2 }), size, 155, 100)).toBe(false);
  });

  it('prend le calque du dessus, et le fait passer devant', () => {
    const layers = [text({ id: 'a' }), text({ id: 'b' })];
    const sizes = { a: size, b: size };
    expect(layerAt(layers, sizes, 100, 100)?.id).toBe('b');
    expect(layerAt(layers, sizes, 400, 400)).toBeNull();
    expect(bringToFront(layers, 'a').map((layer) => layer.id)).toEqual(['b', 'a']);
    expect(updateLayer(layers, 'a', { x: 5 })[0].x).toBe(5);
  });

  it('choisit un texte lisible sur un fond plein', () => {
    expect(readableOn('#FFFFFF')).toBe('#000000');
    expect(readableOn('#FFCC00')).toBe('#000000');
    expect(readableOn('#007AFF')).toBe('#FFFFFF');
  });
});
