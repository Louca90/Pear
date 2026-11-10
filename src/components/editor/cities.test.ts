import { describe, expect, it } from '@jest/globals';

import { nearestCity } from './cities';

describe('nearestCity', () => {
  it('trouve la ville la plus proche', () => {
    expect(nearestCity({ latitude: 45.9, longitude: 6.12 })).toBe('Annecy');
    expect(nearestCity({ latitude: 48.86, longitude: 2.35 })).toBe('Paris');
  });

  it('ne donne rien en pleine mer', () => {
    expect(nearestCity({ latitude: 0, longitude: -30 })).toBeNull();
  });
});
