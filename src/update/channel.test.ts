import { describe, expect, it, jest } from '@jest/globals';

import { chooseRelease } from './channel';
import { Release } from './release';

// La signature est vérifiée par release.test.ts : ici on la remplace par un contrôle simple.
jest.mock('./release', () => ({ isReleaseSigned: (release: { signature: string | null }) => release.signature === 'ok' }));

const make = (versionCode: number, prerelease: boolean, signature: string | null = 'ok'): Release => ({
  tag: `v${versionCode}`, version: String(versionCode), versionCode, sha256: 'x', signature, summary: '', pageUrl: '', apkUrl: '', apkSize: 1, prerelease,
});

describe('choix de la release (programme testeur)', () => {
  it('sans programme testeur, seules les stables comptent', () => {
    expect(chooseRelease([make(12, false), make(13, true)], 11, false, 'k')?.versionCode).toBe(12);
  });

  it('testeur : la version de test plus récente que la stable est proposée', () => {
    expect(chooseRelease([make(12, false), make(13, true)], 11, true, 'k')?.versionCode).toBe(13);
  });

  it('testeur : une stable plus récente passe devant la version de test', () => {
    expect(chooseRelease([make(14, false), make(13, true)], 11, true, 'k')?.versionCode).toBe(14);
  });

  it('rien si tout est déjà installé', () => {
    expect(chooseRelease([make(12, false), make(13, true)], 13, true, 'k')).toBeNull();
    expect(chooseRelease([], 1, true, 'k')).toBeNull();
  });

  it('une release non signée est ignorée', () => {
    expect(chooseRelease([make(13, true, null), make(12, false)], 11, true, 'k')?.versionCode).toBe(12);
    expect(chooseRelease([make(13, true, null)], 11, true, 'k')).toBeNull();
  });
});
