import { describe, expect, it } from '@jest/globals';

import { createIdentity } from './pairing';
import { openPairRequest, sealPairRequest } from './pairRequest';

describe('demande de pairing', () => {
  it('seul le destinataire lit la clé et le pseudo de l’expéditeur', () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const sealed = sealPairRequest(alice, 'Alice 🍐', bob.publicKey);
    expect(sealed).not.toContain(alice.publicKey);
    expect(openPairRequest(bob, sealed)).toEqual({ publicKey: alice.publicKey, name: 'Alice 🍐' });
    expect(openPairRequest(createIdentity(), sealed)).toBeNull();
  });

  it('tient dans la limite du serveur et refuse une demande modifiée', () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const sealed = sealPairRequest(alice, 'x'.repeat(200), bob.publicKey);
    expect(sealed.length).toBeLessThanOrEqual(2800);
    expect(openPairRequest(bob, sealed)?.name).toHaveLength(40);
    expect(openPairRequest(bob, sealed.slice(0, -4) + 'AAAA')).toBeNull();
    expect(openPairRequest(bob, 42)).toBeNull();
  });
});
