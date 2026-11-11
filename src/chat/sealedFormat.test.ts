import { beforeAll, describe, expect, it } from '@jest/globals';
import { randombytes_buf, ready } from 'react-native-libsodium';

import { CHUNK_OVERHEAD, chunkCount, chunkOffset, encodeHeader, HEADER_BYTES, openStoreChunk, parseHeader, plainLength, sealedLength, sealStoreChunk } from './sealedFormat';

const CHUNK = 1000;

beforeAll(async () => {
  await ready;
});

// Chiffre un contenu entier comme le fait l'écrivain de media.ts.
function sealAll(plain: Uint8Array, key: Uint8Array, chunk = CHUNK) {
  const parts: Uint8Array[] = [encodeHeader(chunk)];
  const count = chunkCount(plain.length, chunk);
  for (let index = 0; index < count; index += 1) {
    parts.push(sealStoreChunk(plain.slice(index * chunk, (index + 1) * chunk), key, index, index === count - 1));
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Déchiffre un fichier entier comme le fait le lecteur de media.ts.
function openAll(sealed: Uint8Array, key: Uint8Array) {
  const chunk = parseHeader(sealed);
  if (chunk === null) throw new Error('pas un fichier chiffré');
  const size = plainLength(sealed.length, chunk);
  if (size < 0) throw new Error('longueur impossible');
  const count = chunkCount(size, chunk);
  const out = new Uint8Array(size);
  for (let index = 0; index < count; index += 1) {
    const start = chunkOffset(index, chunk);
    const length = Math.min(chunk, size - index * chunk) + CHUNK_OVERHEAD;
    out.set(openStoreChunk(sealed.slice(start, start + length), key, index, index === count - 1), index * chunk);
  }
  return out;
}

describe('en-tête', () => {
  it('relit la taille des morceaux', () => {
    expect(encodeHeader(CHUNK)).toHaveLength(HEADER_BYTES);
    expect(parseHeader(encodeHeader(CHUNK))).toBe(CHUNK);
  });

  it('reconnaît un fichier ancien en clair', () => {
    expect(parseHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(parseHeader(new Uint8Array(3))).toBeNull();
  });
});

describe('tailles', () => {
  it('passe de la taille en clair à la taille chiffrée et retour', () => {
    for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 5 * CHUNK, 123_457]) {
      expect(plainLength(sealedLength(size, CHUNK), CHUNK)).toBe(size);
    }
  });

  it('refuse une longueur coupée au milieu d’un morceau', () => {
    expect(plainLength(HEADER_BYTES + 10, CHUNK)).toBe(-1);
    expect(plainLength(4, CHUNK)).toBe(-1);
  });
});

describe('chiffrement', () => {
  let key: Uint8Array = new Uint8Array();
  let plain: Uint8Array = new Uint8Array();
  beforeAll(() => {
    key = randombytes_buf(32);
    plain = randombytes_buf(3 * CHUNK + 17);
  });

  it('relit le contenu', () => {
    const sealed = sealAll(plain, key);
    expect(sealed).toHaveLength(sealedLength(plain.length, CHUNK));
    expect(openAll(sealed, key)).toEqual(plain);
  });

  it('refuse une autre clé', () => {
    expect(() => openAll(sealAll(plain, key), randombytes_buf(32))).toThrow();
  });

  it('refuse un morceau déplacé ou un mauvais drapeau « dernier »', () => {
    const chunk = sealStoreChunk(plain.slice(0, CHUNK), key, 0, false);
    expect(() => openStoreChunk(chunk, key, 1, false)).toThrow();
    expect(() => openStoreChunk(chunk, key, 0, true)).toThrow();
    expect(openStoreChunk(chunk, key, 0, false)).toEqual(plain.slice(0, CHUNK));
  });

  it('refuse un octet modifié', () => {
    const sealed = sealAll(plain, key);
    sealed[HEADER_BYTES + 30] ^= 1;
    expect(() => openAll(sealed, key)).toThrow();
  });

  it('refuse un fichier coupé à la frontière d’un morceau', () => {
    const sealed = sealAll(plain, key);
    expect(() => openAll(sealed.slice(0, chunkOffset(2, CHUNK)), key)).toThrow();
  });
});
