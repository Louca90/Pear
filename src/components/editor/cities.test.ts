import { describe, expect, it } from '@jest/globals';

import { nearestCity, nearestPlace } from './cities';

describe('nearestCity', () => {
  it('trouve la commune la plus proche, pas seulement la grande ville', () => {
    expect(nearestCity({ latitude: 46.371, longitude: 6.48 })).toBe('Thonon-les-Bains');
    expect(nearestCity({ latitude: 46.081, longitude: 6.407 })).toBe('Bonneville');
    // Paris, Lyon et Marseille : l'arrondissement (« Paris 04 Hôtel-de-Ville »).
    expect(nearestCity({ latitude: 48.86, longitude: 2.35 })).toMatch(/^Paris/);
  });

  it('donne la distance au centre de la commune', () => {
    const near = nearestPlace({ latitude: 46.1944, longitude: 6.2378 });
    expect(near?.name).toBe('Annemasse');
    expect(near!.km).toBeLessThan(1);
  });

  it('hors de la zone couverte, la grande ville la plus proche', () => {
    expect(nearestCity({ latitude: 35.68, longitude: 139.69 })).toBe('Tokyo');
  });

  it('ne donne rien en pleine mer', () => {
    expect(nearestCity({ latitude: 0, longitude: -30 })).toBeNull();
  });
});
