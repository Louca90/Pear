import { describe, expect, it } from '@jest/globals';

import { createIdentity, deriveSharedSecret } from '../crypto/pairing';
import { createRatchet, ratchetDecrypt, ratchetEncrypt, RatchetEnvelope, RatchetState } from '../crypto/ratchet';
import { MAX_PUSH_PAYLOAD } from './pushPayload';
import { offlineRoute, packetFingerprint, PacketMemory, parseEnvelope, receiveOnce, sealOnce } from './packets';

function pair() {
  const alice = createIdentity();
  const bob = createIdentity();
  const secret = deriveSharedSecret(alice, bob.publicKey);
  return { alice: { state: createRatchet(alice, bob.publicKey, secret) }, bob: { state: createRatchet(bob, alice.publicKey, secret) } };
}

type Side = { state: RatchetState };

// L'expéditeur : un message en attente, avec la colonne sealed_packet de la base.
function outbox(side: Side) {
  let stored: string | null = null;
  const seal = (text: string) =>
    sealOnce(
      stored,
      () => {
        const { state, envelope } = ratchetEncrypt(side.state, text);
        side.state = state;
        return envelope;
      },
      (packet) => {
        stored = packet;
      },
    );
  return { seal };
}

// Le destinataire : la table received_packets, les messages enregistrés et les accusés envoyés.
function inbox(side: Side) {
  const packets = new Map<string, string>();
  const memory: PacketMemory = { find: (fingerprint) => packets.get(fingerprint) ?? null, remember: (fingerprint, id) => packets.set(fingerprint, id) };
  const saved: string[] = [];
  const acks: string[] = [];
  const receive = (envelope: RatchetEnvelope) =>
    receiveOnce(memory, envelope, (id) => acks.push(id), () => {
      const { state, text } = ratchetDecrypt(side.state, envelope);
      side.state = state;
      const { id } = JSON.parse(text) as { id: string };
      // INSERT OR IGNORE, puis l'accusé, comme receiveText.
      if (!saved.includes(id)) saved.push(id);
      acks.push(id);
      return id;
    });
  return { receive, saved, acks };
}

describe('paquet chiffré une seule fois', () => {
  it('deux envois du même message donnent exactement les mêmes octets et n’avancent pas le ratchet', () => {
    const { alice } = pair();
    const box = outbox(alice);
    const first = box.seal(JSON.stringify({ id: 'm1', text: 'salut' }));
    const sent = alice.state.sent;
    const second = box.seal(JSON.stringify({ id: 'm1', text: 'salut' }));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(alice.state.sent).toBe(sent);
  });

  it('une valeur gardée abîmée est rechiffrée plutôt que d’envoyer n’importe quoi', () => {
    expect(parseEnvelope('{pas du json')).toBeNull();
    expect(parseEnvelope(JSON.stringify({ dh: 'x', n: 'un', pn: 0, cipher: 'c' }))).toBeNull();
    const { alice } = pair();
    const envelope = sealOnce('{abîmé', () => ratchetEncrypt(alice.state, 'x').envelope, () => undefined);
    expect(envelope.cipher).toContain('.');
  });

  it('le destinataire reçoit deux fois le même paquet : traité une fois, acquitté les deux fois', () => {
    const { alice, bob } = pair();
    const box = outbox(alice);
    const phone = inbox(bob);
    const packet = box.seal(JSON.stringify({ id: 'm1', text: 'salut' }));
    phone.receive(packet);
    // Accusé perdu : l'expéditeur renvoie les mêmes octets (reconnexion, push, « Réessayer »).
    expect(() => phone.receive(box.seal(JSON.stringify({ id: 'm1', text: 'salut' })))).not.toThrow();
    expect(phone.saved).toEqual(['m1']);
    expect(phone.acks).toEqual(['m1', 'm1']);
  });

  it('les messages suivants se déchiffrent toujours après des renvois', () => {
    const { alice, bob } = pair();
    const phone = inbox(bob);
    const first = outbox(alice);
    const second = outbox(alice);
    const p1 = first.seal(JSON.stringify({ id: 'm1' }));
    const p2 = second.seal(JSON.stringify({ id: 'm2' }));
    // Arrivés dans le désordre, avec des doublons.
    phone.receive(p2);
    phone.receive(p1);
    phone.receive(p2);
    phone.receive(p1);
    expect(phone.saved).toEqual(['m2', 'm1']);
    expect(phone.acks).toEqual(['m2', 'm1', 'm2', 'm1']);
  });

  it('l’empreinte distingue deux sessions qui recommencent au même numéro', () => {
    const one = pair().alice;
    const two = pair().alice;
    const a = ratchetEncrypt(one.state, 'x').envelope;
    const b = ratchetEncrypt(two.state, 'x').envelope;
    expect(packetFingerprint(a)).not.toBeNull();
    expect(packetFingerprint(a)).not.toBe(packetFingerprint(b));
    expect(packetFingerprint({ dh: 'x' })).toBeNull();
  });
});

describe('texte hors connexion : push ou relais', () => {
  const short = 'x'.repeat(200);
  const long = 'x'.repeat(MAX_PUSH_PAYLOAD + 1);
  const payload = (text: string) => (text.length <= MAX_PUSH_PAYLOAD ? text : null);

  it('un texte court part dans un push, comme avant', () => {
    expect(offlineRoute(payload(short), true)).toBe('push');
    expect(offlineRoute(payload(short), false)).toBe('push');
  });

  it('un texte qui ne tient pas dans un push passe par le relais, ou attend la connexion si le relais est coupé', () => {
    expect(offlineRoute(payload(long), true)).toBe('relay');
    expect(offlineRoute(payload(long), false)).toBe('wake');
  });
});
