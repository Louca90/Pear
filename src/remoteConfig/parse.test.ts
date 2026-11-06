import { describe, expect, it } from '@jest/globals';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/curves/utils.js';

import published from '../../config/remote-config.json';
import { REMOTE_CONFIG_PUBLIC_KEY } from '../config';
import { isNewer, SIGNING_PREFIX, verifyRemoteConfig } from './parse';

const { secretKey, publicKey } = ed25519.keygen();
const publicHex = bytesToHex(publicKey);

const values = {
  version: 10,
  wakeUrl: 'https://pear.example.app/api/wake',
  iceServers: [{ urls: 'stun:stun.example.com:3478' }],
};

function sign(content: unknown, key = secretKey) {
  const payload = JSON.stringify(content);
  const signature = bytesToHex(ed25519.sign(new TextEncoder().encode(SIGNING_PREFIX + payload), key));
  return { payload, signature };
}

describe('configuration distante', () => {
  it('accepte un fichier signé avec la bonne clé', () => {
    expect(verifyRemoteConfig(sign(values), publicHex)).toEqual({
      ...values,
      iceServers: [{ urls: 'stun:stun.example.com:3478', username: undefined, credential: undefined }],
    });
  });

  it('refuse un fichier modifié après signature', () => {
    const file = sign(values);
    const tampered = { ...file, payload: file.payload.replace('pear.example.app', 'evil.example.com') };
    expect(verifyRemoteConfig(tampered, publicHex)).toBeNull();
  });

  it('refuse une signature faite avec une autre clé', () => {
    expect(verifyRemoteConfig(sign(values, ed25519.keygen().secretKey), publicHex)).toBeNull();
  });

  it('refuse une signature faite sans le préfixe de Pear', () => {
    const payload = JSON.stringify(values);
    const signature = bytesToHex(ed25519.sign(new TextEncoder().encode(payload), secretKey));
    expect(verifyRemoteConfig({ payload, signature }, publicHex)).toBeNull();
  });

  it('refuse un contenu signé mais non valide', () => {
    expect(verifyRemoteConfig(sign({ ...values, wakeUrl: 'http://pear.example.app/api/wake' }), publicHex)).toBeNull();
    expect(verifyRemoteConfig(sign({ ...values, iceServers: [] }), publicHex)).toBeNull();
    expect(verifyRemoteConfig(sign({ ...values, iceServers: [{ urls: 'https://pas-un-stun' }] }), publicHex)).toBeNull();
    expect(verifyRemoteConfig(sign({ ...values, version: 0 }), publicHex)).toBeNull();
  });

  it('refuse un fichier mal formé sans lever d’erreur', () => {
    expect(verifyRemoteConfig(null, publicHex)).toBeNull();
    expect(verifyRemoteConfig({ payload: '{', signature: 'zz' }, publicHex)).toBeNull();
    const file = sign(values);
    expect(verifyRemoteConfig({ payload: 'pas du json', signature: file.signature }, publicHex)).toBeNull();
  });

  it('ne revient jamais à une version plus ancienne', () => {
    const config = verifyRemoteConfig(sign(values), publicHex)!;
    expect(isNewer(config, null)).toBe(true);
    expect(isNewer({ ...config, version: 11 }, config)).toBe(true);
    expect(isNewer(config, config)).toBe(false);
    expect(isNewer({ ...config, version: 9 }, config)).toBe(false);
  });

  it('le fichier publié dans le dépôt est signé avec la clé de l’app', () => {
    expect(verifyRemoteConfig(published, REMOTE_CONFIG_PUBLIC_KEY)).not.toBeNull();
  });
});
