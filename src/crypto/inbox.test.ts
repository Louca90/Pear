import { describe, expect, it } from '@jest/globals';

import { inboxIdFor, inboxProof } from './inbox';
import { createIdentity } from './pairing';

// Le code du serveur, tel qu'il tourne sur Vercel : l'app doit calculer exactement les mêmes valeurs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require('../../server/lib/inbox.js');

describe('boîte de demandes de pairing', () => {
  it("calcule le même identifiant de boîte que le serveur", () => {
    const identity = createIdentity();
    expect(inboxIdFor(identity.publicKey)).toBe(server.inboxIdFor(identity.publicKey));
    expect(inboxIdFor(identity.publicKey)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('produit une preuve que le serveur accepte, et seulement pour ce compte et cette heure', () => {
    const identity = createIdentity();
    const keys = server.serverKeys({ private_key: 'clé de test' });
    const at = Date.now();
    const proof = inboxProof(identity, keys.publicKey, 'uid1', at);
    expect(server.isValidProof(keys.privateKey, identity.publicKey, 'uid1', at, proof)).toBe(true);
    expect(server.isValidProof(keys.privateKey, identity.publicKey, 'uid2', at, proof)).toBe(false);
    expect(server.isValidProof(keys.privateKey, identity.publicKey, 'uid1', at + 1, proof)).toBe(false);
    // Une autre identité ne peut pas produire la preuve de celle-ci.
    expect(server.isValidProof(keys.privateKey, identity.publicKey, 'uid1', at, inboxProof(createIdentity(), keys.publicKey, 'uid1', at))).toBe(false);
  });
});
