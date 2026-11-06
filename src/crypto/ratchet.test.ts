import { describe, expect, it } from '@jest/globals';

import { createIdentity, deriveSharedSecret, Identity } from './pairing';
import { createRatchet, ratchetDecrypt, ratchetEncrypt, RatchetEnvelope, RatchetState } from './ratchet';

// Deux téléphones appairés, avec chacun son état de ratchet.
function pair() {
  const alice = createIdentity();
  const bob = createIdentity();
  const secret = deriveSharedSecret(alice, bob.publicKey);
  expect(deriveSharedSecret(bob, alice.publicKey)).toEqual(secret);
  return {
    alice: { identity: alice, state: createRatchet(alice, bob.publicKey, secret) },
    bob: { identity: bob, state: createRatchet(bob, alice.publicKey, secret) },
  };
}

type Side = { identity: Identity; state: RatchetState };

function send(from: Side, text: string): RatchetEnvelope {
  const { state, envelope } = ratchetEncrypt(from.state, text);
  from.state = state;
  return envelope;
}

function receive(to: Side, envelope: unknown): string {
  const { state, text } = ratchetDecrypt(to.state, envelope);
  to.state = state;
  return text;
}

// L'état est enregistré en JSON entre deux lancements de l'app.
const restart = (side: Side) => {
  side.state = JSON.parse(JSON.stringify(side.state));
};

describe('double ratchet', () => {
  it('chiffre et déchiffre dans les deux sens, chacun pouvant écrire en premier', () => {
    for (const firstWriter of ['alice', 'bob'] as const) {
      const sides = pair();
      const [a, b] = firstWriter === 'alice' ? [sides.alice, sides.bob] : [sides.bob, sides.alice];
      expect(receive(b, send(a, 'salut'))).toBe('salut');
      expect(receive(a, send(b, 'ça va ?'))).toBe('ça va ?');
      expect(receive(b, send(a, 'oui'))).toBe('oui');
    }
  });

  it('accepte les messages dans le désordre', () => {
    const { alice, bob } = pair();
    const first = send(alice, 'un');
    const second = send(alice, 'deux');
    const third = send(alice, 'trois');
    expect(receive(bob, third)).toBe('trois');
    expect(receive(bob, first)).toBe('un');
    expect(receive(bob, second)).toBe('deux');
  });

  it('rattrape un message perdu arrivé après un changement de sens', () => {
    const { alice, bob } = pair();
    const lost = send(alice, 'en retard');
    expect(receive(bob, send(alice, 'à l’heure'))).toBe('à l’heure');
    expect(receive(alice, send(bob, 'réponse'))).toBe('réponse');
    expect(receive(bob, send(alice, 'suite'))).toBe('suite');
    expect(receive(bob, lost)).toBe('en retard');
  });

  it('refuse un doublon sans abîmer l’état', () => {
    const { alice, bob } = pair();
    const envelope = send(alice, 'une fois');
    expect(receive(bob, envelope)).toBe('une fois');
    expect(() => receive(bob, envelope)).toThrow();
    expect(receive(bob, send(alice, 'après'))).toBe('après');
  });

  it('refuse un message modifié ou forgé, et l’état reste intact', () => {
    const { alice, bob } = pair();
    const envelope = send(alice, 'original');
    const tampered = { ...envelope, cipher: envelope.cipher.slice(0, -4) + 'AAAA' };
    expect(() => receive(bob, tampered)).toThrow();
    expect(() => receive(bob, { dh: 'court', n: 0, pn: 0, cipher: 'x' })).toThrow('Enveloppe non valide');
    expect(() => receive(bob, null)).toThrow('Enveloppe non valide');
    expect(receive(bob, envelope)).toBe('original');
  });

  it('refuse un message chiffré pour une autre conversation', () => {
    const one = pair();
    const other = pair();
    expect(() => receive(other.bob, send(one.alice, 'pas pour toi'))).toThrow();
  });

  it('continue après un redémarrage de l’app (état relu depuis le stockage)', () => {
    const { alice, bob } = pair();
    expect(receive(bob, send(alice, 'avant'))).toBe('avant');
    restart(alice);
    restart(bob);
    expect(receive(alice, send(bob, 'après le redémarrage'))).toBe('après le redémarrage');
    const pending = send(alice, 'en attente');
    restart(bob);
    expect(receive(bob, pending)).toBe('en attente');
  });

  it('chaque message utilise une clé différente', () => {
    const { alice } = pair();
    const one = send(alice, 'même texte');
    const two = send(alice, 'même texte');
    expect(one.cipher).not.toBe(two.cipher);
    expect(two.n).toBe(one.n + 1);
  });
});
