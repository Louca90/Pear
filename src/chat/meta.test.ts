import { describe, expect, it } from '@jest/globals';

import { decodeWave, encodeMeta, encodeWave, parseMeta, sanitizeMeta, WAVE_BARS } from './meta';

describe('meta des messages', () => {
  it('ne garde que les champs connus et valides', () => {
    expect(sanitizeMeta({ wave: 'f'.repeat(WAVE_BARS), inconnu: 1, thumb: 'pas du base64 !' })).toEqual({ wave: 'f'.repeat(WAVE_BARS) });
    expect(sanitizeMeta({ wave: 'zz' })).toBeNull();
    expect(sanitizeMeta('texte')).toBeNull();
    expect(sanitizeMeta([1])).toBeNull();
    expect(sanitizeMeta({ sticker: true, thumb: 'AAAA' })).toEqual({ sticker: true, thumb: 'AAAA' });
  });

  it('refuse un aperçu de lien sans titre ou sans adresse http(s)', () => {
    expect(sanitizeMeta({ preview: { url: 'javascript:alert(1)', title: 'x' } })).toBeNull();
    expect(sanitizeMeta({ preview: { url: 'https://exemple.fr', title: '  ' } })).toBeNull();
    expect(sanitizeMeta({ preview: { url: 'https://exemple.fr', title: 'T'.repeat(500), site: 'Exemple', image: '<svg>' } })).toEqual({
      preview: { url: 'https://exemple.fr', title: 'T'.repeat(200), site: 'Exemple' },
    });
  });

  it('relit la colonne meta sans jamais échouer', () => {
    expect(parseMeta(null)).toEqual({});
    expect(parseMeta('{cassé')).toEqual({});
    expect(parseMeta(encodeMeta({ sticker: true }))).toEqual({ sticker: true });
    expect(encodeMeta({})).toBeNull();
  });

  it('résume les niveaux du micro en barres', () => {
    const wave = encodeWave([...Array(320).fill(-160), ...Array(320).fill(0)]);
    expect(wave).toBe('0'.repeat(16) + 'f'.repeat(16));
    const bars = decodeWave(wave);
    expect(bars?.[0]).toBe(0);
    expect(bars?.[WAVE_BARS - 1]).toBe(1);
    expect(encodeWave([])).toBeUndefined();
    expect(encodeWave([-25])).toBe('8'.repeat(WAVE_BARS));
    expect(decodeWave('abc')).toBeNull();
  });
});
