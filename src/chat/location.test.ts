import { describe, expect, it } from '@jest/globals';

import { bearing, compassPoint, distanceKm, formatDistance, geoLink, isSharing, locationText, parseLocation, parseLocationText } from './location';

const paris = { latitude: 48.8566, longitude: 2.3522 };
const lyon = { latitude: 45.764, longitude: 4.8357 };

describe('position en direct', () => {
  it('refuse une position dont un champ n’est pas valide', () => {
    expect(parseLocation({ ...paris, at: 1000, until: 2000 })).toEqual({ ...paris, at: 1000, until: 2000 });
    expect(parseLocation({ latitude: 91, longitude: 0, at: 1, until: 2 })).toBeNull();
    expect(parseLocation({ latitude: 0, longitude: 'x', at: 1, until: 2 })).toBeNull();
    expect(parseLocation({ latitude: 0, longitude: 0, at: -1, until: 2 })).toBeNull();
    expect(parseLocation(null)).toBeNull();
    expect(parseLocationText('pas du json')).toBeNull();
    expect(parseLocationText(locationText({ ...lyon, at: 5, until: 9 }))).toEqual({ ...lyon, at: 5, until: 9 });
  });

  it('borne la durée d’un partage reçu à 8 heures', () => {
    const year = 365 * 24 * 3600 * 1000;
    const parsed = parseLocation({ ...paris, at: 1000, until: 1000 + year });
    expect(parsed && parsed.until - parsed.at).toBe((8 * 3600 + 600) * 1000);
  });

  it('sait si un partage est encore en cours', () => {
    expect(isSharing({ ...paris, at: 1000, until: 5000 }, 2000)).toBe(true);
    expect(isSharing({ ...paris, at: 1000, until: 5000 }, 6000)).toBe(false);
    // Arrêté à la main : la fin vaut l'heure de la dernière position.
    expect(isSharing({ ...paris, at: 3000, until: 3000 }, 2000)).toBe(false);
  });

  it('mesure la distance et la direction', () => {
    expect(Math.round(distanceKm(paris, lyon))).toBe(391);
    expect(compassPoint(bearing(paris, lyon))).toBe('se');
    expect(compassPoint(bearing(lyon, paris))).toBe('no');
    expect(compassPoint(359)).toBe('n');
    expect(compassPoint(-90)).toBe('o');
  });

  it('écrit la distance sans fausse précision', () => {
    expect(formatDistance(0.02)).toBe('100 m');
    expect(formatDistance(0.84)).toBe('800 m');
    expect(formatDistance(3.44)).toBe('3,4 km');
    expect(formatDistance(3.44, '.')).toBe('3.4 km');
    expect(formatDistance(391.6)).toBe('392 km');
  });

  it('fabrique un lien geo: pour l’app de cartes', () => {
    expect(geoLink(paris)).toBe('geo:48.85660,2.35220?q=48.85660,2.35220');
  });
});
