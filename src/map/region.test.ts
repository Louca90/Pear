import { describe, expect, it } from '@jest/globals';

import { insideRegion, regionBounds } from './region';

describe('zone de carte', () => {
  const annecy = { latitude: 45.9, longitude: 6.12 };

  it('un carré de 25 km de rayon autour du point', () => {
    const [west, south, east, north] = regionBounds(annecy, 25);
    expect(north - annecy.latitude).toBeCloseTo(25 / 111.32, 4);
    expect(annecy.latitude - south).toBeCloseTo(25 / 111.32, 4);
    // À 46° de latitude, un degré de longitude fait environ 77 km : l'écart en longitude est plus grand.
    expect(east - annecy.longitude).toBeGreaterThan(north - annecy.latitude);
    expect(annecy.longitude - west).toBeCloseTo(east - annecy.longitude, 6);
  });

  it('dit si un point est dans la zone', () => {
    const bounds = regionBounds(annecy, 25);
    expect(insideRegion(bounds, annecy)).toBe(true);
    expect(insideRegion(bounds, { latitude: 45.76, longitude: 4.84 })).toBe(false);
  });
});
