import { describe, expect, it } from '@jest/globals';

import { createIdentity, derivePushKeys, deriveSharedSecret } from '../crypto/pairing';
import { CALL_PUSH_MAX_AGE_MS, callPushTag, decodeCallPush, encodeCallPush, isCallId } from './callPayload';

function setup() {
  const alice = createIdentity();
  const bob = createIdentity();
  return { alice, bob, aliceKeys: derivePushKeys(deriveSharedSecret(alice, bob.publicKey)), bobKeys: derivePushKeys(deriveSharedSecret(bob, alice.publicKey)) };
}

describe('push d’appel', () => {
  it('désigne le contact par son étiquette et ne se lit qu’avec la clé partagée', () => {
    const { alice, bob, aliceKeys, bobKeys } = setup();
    const now = 1_700_000_000_000;
    const payload = encodeCallPush(aliceKeys.tag, aliceKeys.key, { id: 'abcdefgh1234', video: true, at: now });
    expect(payload).toMatch(/^[A-Za-z0-9_.~-]+$/);
    expect(payload).not.toContain(alice.publicKey);
    expect(payload).not.toContain(bob.publicKey);
    expect(callPushTag(payload)).toBe(bobKeys.tag);
    expect(decodeCallPush(payload, bobKeys.key, now + 1000)).toEqual({ id: 'abcdefgh1234', video: true, at: now });
  });

  it('refuse un push trop vieux, modifié ou chiffré avec une autre clé', () => {
    const { aliceKeys } = setup();
    const other = setup().bobKeys;
    const now = 1_700_000_000_000;
    const payload = encodeCallPush(aliceKeys.tag, aliceKeys.key, { id: 'abcdefgh1234', video: false, at: now });
    expect(decodeCallPush(payload, aliceKeys.key, now + CALL_PUSH_MAX_AGE_MS + 1)).toBeNull();
    expect(decodeCallPush(payload, other.key, now)).toBeNull();
    const tampered = payload.slice(0, -2) + (payload.endsWith('A') ? 'BB' : 'AA');
    expect(decodeCallPush(tampered, aliceKeys.key, now)).toBeNull();
  });

  it('rejette ce qui n’a pas la forme d’un push d’appel', () => {
    expect(callPushTag(undefined)).toBeNull();
    expect(callPushTag('a~b~c')).toBeNull();
    expect(callPushTag('court~x.y')).toBeNull();
    expect(isCallId('abcdefgh')).toBe(true);
    expect(isCallId('abc')).toBe(false);
    expect(isCallId('abcdefgh!')).toBe(false);
  });
});
