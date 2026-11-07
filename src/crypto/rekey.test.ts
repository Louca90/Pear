import { describe, expect, it } from '@jest/globals';

import { createIdentity, deriveSharedSecret } from './pairing';
import { createRatchet, ratchetDecrypt, ratchetEncrypt, RatchetState } from './ratchet';
import { createEphemeral, createSessionV2, decryptWithSessions, isSessionV2 } from './rekey';

type Phone = { current: RatchetState; pending?: RatchetState; previous?: RatchetState };

function send(phone: Phone, text: string) {
  const { state, envelope } = ratchetEncrypt(phone.current, text);
  phone.current = state;
  return envelope;
}

// Réception telle que l'app la fera : la session qui réussit est mise à jour ; un message arrivé par
// la session en attente la rend actuelle (l'autre téléphone a basculé).
function receive(phone: Phone, envelope: unknown) {
  const result = decryptWithSessions(phone, envelope);
  if (result.slot === 'pending') {
    phone.previous = phone.current;
    phone.current = result.state;
    phone.pending = undefined;
  } else {
    phone[result.slot] = result.state;
  }
  return result.text;
}

function setup() {
  const alice = createIdentity();
  const bob = createIdentity();
  const secret = deriveSharedSecret(alice, bob.publicKey);
  return {
    alice,
    bob,
    secret,
    a: { current: createRatchet(alice, bob.publicKey, secret) } as Phone,
    b: { current: createRatchet(bob, alice.publicKey, deriveSharedSecret(bob, alice.publicKey)) } as Phone,
  };
}

// Le rôle « a » propose, « b » prépare la session sans l'utiliser, « a » bascule à la réponse.
function rekey({ alice, bob, secret, a, b }: ReturnType<typeof setup>) {
  const ephA = createEphemeral();
  expect(JSON.parse(receive(b, send(a, JSON.stringify({ type: 'rekey', e: ephA.publicKey })))).e).toBe(ephA.publicKey);
  const ephB = createEphemeral();
  b.pending = createSessionV2(bob, alice.publicKey, secret, ephB, ephA.publicKey);
  const ack = send(b, JSON.stringify({ type: 'rekey-ack', e: ephB.publicKey }));
  expect(JSON.parse(receive(a, ack)).e).toBe(ephB.publicKey);
  a.previous = a.current;
  a.current = createSessionV2(alice, bob.publicKey, secret, ephA, ephB.publicKey);
}

describe('passage en session v2 (clés éphémères)', () => {
  it('bascule les deux téléphones sans perdre de message, dans les deux sens', () => {
    const phones = setup();
    const { a, b } = phones;
    expect(receive(b, send(a, 'avant'))).toBe('avant');
    rekey(phones);
    // « b » écrit encore avec l'ancienne session tant qu'il n'a rien reçu de la nouvelle.
    const late = send(b, 'en route pendant le changement');
    expect(receive(b, send(a, 'premier en v2'))).toBe('premier en v2');
    expect(isSessionV2(b.current)).toBe(true);
    expect(receive(a, late)).toBe('en route pendant le changement');
    expect(receive(a, send(b, 'réponse en v2'))).toBe('réponse en v2');
    expect(receive(b, send(a, 'et encore'))).toBe('et encore');
  });

  it('continue en v1 si la réponse se perd', () => {
    const phones = setup();
    const { alice, bob, secret, a, b } = phones;
    const ephA = createEphemeral();
    receive(b, send(a, JSON.stringify({ type: 'rekey', e: ephA.publicKey })));
    b.pending = createSessionV2(bob, alice.publicKey, secret, createEphemeral(), ephA.publicKey);
    // La réponse n'arrive jamais : « a » reste en v1, et « b » aussi (il n'a rien reçu en v2).
    expect(receive(b, send(a, 'toujours v1'))).toBe('toujours v1');
    expect(receive(a, send(b, 'v1 aussi'))).toBe('v1 aussi');
    expect(isSessionV2(a.current)).toBe(false);
    expect(isSessionV2(b.current)).toBe(false);
  });

  it("ne démarre jamais sur une clé d'identité, et ne se déduit pas des seules identités", () => {
    const phones = setup();
    rekey(phones);
    const { alice, bob, a } = phones;
    expect(a.current.ownKeys.publicKey).not.toBe(alice.publicKey);
    expect(a.current.theirKey).not.toBe(bob.publicKey);
    expect(a.current.context.startsWith('pear-ratchet-v2')).toBe(true);
    // Une session v1 refaite avec les seules identités ne lit pas un message v2.
    const intruder = createRatchet(bob, alice.publicKey, deriveSharedSecret(bob, alice.publicKey));
    expect(() => ratchetDecrypt(intruder, send(a, 'secret'))).toThrow();
  });

  it('refuse un message forgé dans toutes les sessions', () => {
    const phones = setup();
    rekey(phones);
    const envelope = send(phones.a, 'vrai');
    expect(() => decryptWithSessions(phones.b, { ...envelope, cipher: envelope.cipher.slice(0, -4) + 'AAAA' })).toThrow();
    expect(receive(phones.b, envelope)).toBe('vrai');
  });
});
