import { describe, expect, it } from '@jest/globals';

import { SentOnce } from './sentOnce';

describe('renvoi unique par connexion', () => {
  it("n'envoie qu'une fois dans une même connexion, puis de nouveau à la suivante", () => {
    const sent = new SentOnce();
    expect(sent.has('alice', 1, 'm1')).toBe(false);
    sent.add('alice', 1, 'm1');
    expect(sent.has('alice', 1, 'm1')).toBe(true);
    expect(sent.has('alice', 1, 'm2')).toBe(false);
    // Autre contact : indépendant.
    expect(sent.has('bob', 1, 'm1')).toBe(false);
    // Nouvelle connexion : tout ce qui n'est pas confirmé repart une fois.
    expect(sent.has('alice', 2, 'm1')).toBe(false);
    sent.add('alice', 2, 'm2');
    expect(sent.has('alice', 2, 'm2')).toBe(true);
    expect(sent.has('alice', 1, 'm1')).toBe(false);
  });

  it('repart tout de suite après une réparation de session', () => {
    const sent = new SentOnce();
    sent.add('alice', 3, 'm1');
    sent.forget('alice');
    expect(sent.has('alice', 3, 'm1')).toBe(false);
  });
});
