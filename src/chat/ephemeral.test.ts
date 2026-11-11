import { describe, expect, it } from '@jest/globals';

import { ephemeralSystemText, expiryFor, nextSettingTime, parseEphemeralSystem, pullOffset, pullProgress, pullTriggers, ttlOf, validEphemeralSetting, validTtl } from './ephemeral';

describe('messages éphémères', () => {
  it('n’accepte que les trois durées proposées', () => {
    expect(validTtl(3600)).toBe(3600);
    expect(validTtl(86400)).toBe(86400);
    expect(validTtl(604800)).toBe(604800);
    expect(validTtl(1)).toBeNull();
    expect(validTtl('3600')).toBeNull();
    expect(validEphemeralSetting(0)).toBe(0);
    expect(validEphemeralSetting(-1)).toBeNull();
  });

  it('calcule l’expiration et retrouve la durée d’un message', () => {
    expect(expiryFor(1000, 3600)).toBe(1000 + 3600_000);
    expect(expiryFor(1000, null)).toBeNull();
    expect(ttlOf({ created_at: 1000, expires_at: 1000 + 86400_000 })).toBe(86400);
    expect(ttlOf({ created_at: 1000, expires_at: null })).toBeNull();
  });

  it('écrit et relit le message système', () => {
    expect(parseEphemeralSystem(ephemeralSystemText(3600))).toBe(3600);
    expect(parseEphemeralSystem(ephemeralSystemText(0))).toBe(0);
    expect(parseEphemeralSystem('ephemeral:12')).toBeNull();
    expect(parseEphemeralSystem('saved:image')).toBeNull();
  });

  it('date un réglage toujours après le précédent', () => {
    expect(nextSettingTime(500, 100)).toBe(500);
    expect(nextSettingTime(500, 900)).toBe(901);
  });

  it('borne le geste : 96 points de course, bascule à 72', () => {
    expect(pullOffset(-30)).toBe(-30);
    expect(pullOffset(-300)).toBe(-96);
    expect(pullOffset(40)).toBe(0);
    expect(pullProgress(-36)).toBe(0.5);
    expect(pullProgress(-200)).toBe(1);
    expect(pullTriggers(-71)).toBe(false);
    expect(pullTriggers(-72)).toBe(true);
  });
});
