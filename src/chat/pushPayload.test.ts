import { describe, expect, it } from '@jest/globals';

import { createIdentity, derivePushKeys, deriveSharedSecret } from '../crypto/pairing';
import { createRatchet, ratchetDecrypt, ratchetEncrypt } from '../crypto/ratchet';
import { encodePushPayload, MAX_PUSH_PAYLOAD, openPushEnvelope, splitPushPayload } from './pushPayload';

// libsodium n'est prêt qu'une fois les tests lancés : les identités sont créées dans chaque test.
function setup() {
  const alice = createIdentity();
  const bob = createIdentity();
  return { alice, bob, secret: deriveSharedSecret(alice, bob.publicKey) };
}

describe('contenu des pushs', () => {
  it('transporte un message chiffré que seul le destinataire lit, sans clé en clair', () => {
    const { alice, bob, secret } = setup();
    const sender = createRatchet(alice, bob.publicKey, secret);
    const receiver = createRatchet(bob, alice.publicKey, deriveSharedSecret(bob, alice.publicKey));
    const { envelope } = ratchetEncrypt(sender, JSON.stringify({ type: 'message', id: 'x', text: 'salut' }));
    const keys = derivePushKeys(secret);
    const payload = encodePushPayload(keys.tag, keys.key, envelope)!;
    expect(payload).toMatch(/^[A-Za-z0-9_.~-]+$/);
    expect(payload).not.toContain(alice.publicKey);
    expect(payload).not.toContain(bob.publicKey);

    const parts = splitPushPayload(payload)!;
    const bobKeys = derivePushKeys(deriveSharedSecret(bob, alice.publicKey));
    expect(parts.tag).toBe(bobKeys.tag);
    const opened = openPushEnvelope(parts, bobKeys.key)!;
    expect(JSON.parse(ratchetDecrypt(receiver, opened).text).text).toBe('salut');
  });

  it('donne une étiquette différente pour chaque paire, et une autre paire ne lit pas l’en-tête', () => {
    const { alice, bob, secret } = setup();
    const carol = createIdentity();
    const other = derivePushKeys(deriveSharedSecret(alice, carol.publicKey));
    expect(other.tag).not.toBe(derivePushKeys(secret).tag);
    const { envelope } = ratchetEncrypt(createRatchet(alice, bob.publicKey, secret), 'x');
    const keys = derivePushKeys(secret);
    expect(openPushEnvelope(splitPushPayload(encodePushPayload(keys.tag, keys.key, envelope))!, other.key)).toBeNull();
  });

  it('refuse un message trop long pour un push, et un contenu mal formé', () => {
    const { alice, bob, secret } = setup();
    const keys = derivePushKeys(secret);
    const { envelope } = ratchetEncrypt(createRatchet(alice, bob.publicKey, secret), 'x'.repeat(MAX_PUSH_PAYLOAD));
    expect(encodePushPayload(keys.tag, keys.key, envelope)).toBeNull();
    expect(splitPushPayload('a~b')).toBeNull();
    expect(splitPushPayload('tagtagtag~a.b~chiffré!.x')).toBeNull();
    expect(splitPushPayload(42)).toBeNull();
  });
});
