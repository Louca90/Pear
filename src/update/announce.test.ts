import { describe, expect, it } from '@jest/globals';

import { announcedVersion } from './announce';

describe('annonce d’une nouvelle version', () => {
  it('annonce une version plus récente que celle installée', () => {
    expect(announcedVersion({ version: '1.9.0', versionCode: '13' }, 12)).toBe('1.9.0');
    expect(announcedVersion({ version: '1.10.2', versionCode: '20' }, 12)).toBe('1.10.2');
  });

  it('rien si la version installée est déjà à jour', () => {
    expect(announcedVersion({ version: '1.9.0', versionCode: '13' }, 13)).toBeNull();
  });

  it('rien pour un push mal formé', () => {
    expect(announcedVersion({ version: 'd.d.d', versionCode: '13' }, 12)).toBeNull();
    expect(announcedVersion({ version: '1.9', versionCode: '13' }, 12)).toBeNull();
    expect(announcedVersion({ version: '1.9.0', versionCode: 'x' }, 12)).toBeNull();
  });
});
