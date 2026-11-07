import { describe, expect, it } from '@jest/globals';

import { buildPairingLink, createIdentity, LINK_NAME_LENGTH, parsePairingLink } from './pairing';

describe('lien de pairing', () => {
  it('transporte la clé et le pseudo, y compris accents et emojis', () => {
    const { publicKey } = createIdentity();
    const link = buildPairingLink(publicKey, 'Élvira 🍐');
    expect(link).toMatch(/^pear:\/\/pair\?k=[A-Za-z0-9_-]{43}&n=/);
    expect(parsePairingLink(link)).toEqual({ publicKey, name: 'Élvira 🍐' });
  });

  it('lit encore les anciens liens qui n’ont que la clé', () => {
    const { publicKey } = createIdentity();
    expect(parsePairingLink(`pear://pair?k=${publicKey}`)).toEqual({ publicKey, name: null });
    expect(buildPairingLink(publicKey)).toBe(`pear://pair?k=${publicKey}`);
  });

  it('raccourcit le pseudo à 20 caractères', () => {
    const { publicKey } = createIdentity();
    const parsed = parsePairingLink(buildPairingLink(publicKey, 'a'.repeat(50)));
    expect(parsed?.name).toHaveLength(LINK_NAME_LENGTH);
  });

  it('refuse un lien mal formé', () => {
    const { publicKey } = createIdentity();
    expect(parsePairingLink('https://exemple.fr')).toBeNull();
    expect(parsePairingLink('pear://pair?k=court')).toBeNull();
    expect(parsePairingLink(`pear://pair?k=${publicKey}&n=a&x=b`)).toBeNull();
    expect(parsePairingLink(`pear://pair?k=${publicKey}&n=%E0%A4%A`)).toBeNull();
  });
});
