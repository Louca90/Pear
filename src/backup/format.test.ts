import { beforeAll, describe, expect, it } from '@jest/globals';
import { crypto_pwhash_MEMLIMIT_MIN, crypto_pwhash_OPSLIMIT_MIN, ready } from 'react-native-libsodium';

import { ArchiveParser, BackupError, BackupReader, BackupWriter, bytesText, CHUNK_SIZE, deriveKey, entryHeader, newHeader, readHeader, Sink, Source, textBytes } from './format';

// Un fichier en mémoire.
function memory() {
  const parts: Uint8Array[] = [];
  const sink: Sink = { write: async (bytes) => void parts.push(bytes) };
  const bytes = () => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  return { sink, bytes };
}

function source(bytes: Uint8Array, step = 4096): Source {
  let offset = 0;
  return {
    read: async (length) => {
      const part = bytes.slice(offset, offset + Math.min(length, step));
      offset += part.length;
      return part;
    },
  };
}

// Écrit une archive (nom → contenu), puis la relit avec le mot de passe donné.
async function write(files: Record<string, Uint8Array>, password = 'secret-1234') {
  const header = newHeader('full', true, crypto_pwhash_OPSLIMIT_MIN, crypto_pwhash_MEMLIMIT_MIN);
  const file = memory();
  const writer = await BackupWriter.start(file.sink, header, deriveKey(password, header));
  for (const [name, content] of Object.entries(files)) {
    await writer.push(entryHeader(name, content.length));
    await writer.push(content);
  }
  await writer.finish();
  return file.bytes();
}

async function read(bytes: Uint8Array, password = 'secret-1234') {
  const input = source(bytes);
  const { header, headerHash } = await readHeader(input);
  const reader = new BackupReader(input, deriveKey(password, header), headerHash);
  const files: Record<string, Uint8Array[]> = {};
  let open = '';
  const parser = new ArchiveParser({
    begin: (name) => {
      open = name;
      files[name] = [];
    },
    data: (part) => void files[open].push(part),
    end: () => undefined,
  });
  for (let chunk = await reader.next(); chunk; chunk = await reader.next()) await parser.feed(chunk);
  parser.finish();
  return Object.fromEntries(Object.entries(files).map(([name, parts]) => [name, Buffer.concat(parts)]));
}

describe('sauvegarde chiffrée', () => {
  beforeAll(async () => {
    await ready;
  });

  it('relit exactement ce qui a été écrit, même sur plusieurs morceaux', async () => {
    const big = new Uint8Array(CHUNK_SIZE * 2 + 1234).map((_, index) => index % 251);
    const bytes = await write({ 'manifest.json': textBytes('{"kind":"full"}'), db: big, vide: new Uint8Array(0) });
    const files = await read(bytes);
    expect(bytesText(files['manifest.json'])).toBe('{"kind":"full"}');
    expect(Buffer.compare(files.db, Buffer.from(big))).toBe(0);
    expect(files.vide.length).toBe(0);
  });

  it('refuse un mauvais mot de passe', async () => {
    const bytes = await write({ a: textBytes('x') });
    await expect(read(bytes, 'mauvais')).rejects.toEqual(new BackupError('password'));
  });

  it("refuse un fichier qui n'est pas une sauvegarde", async () => {
    await expect(read(textBytes('ceci est un fichier texte quelconque'))).rejects.toEqual(new BackupError('format'));
  });

  it('refuse une sauvegarde coupée ou modifiée', async () => {
    const bytes = await write({ db: new Uint8Array(CHUNK_SIZE + 10) });
    // Coupée après le premier morceau : le dernier (marqué) manque.
    const firstBlockEnd = bytes.indexOf(0, 0) >= 0 ? bytes.length - 100 : bytes.length;
    await expect(read(bytes.slice(0, firstBlockEnd))).rejects.toBeInstanceOf(BackupError);
    // Un octet changé au milieu.
    const changed = bytes.slice();
    changed[Math.floor(changed.length / 2)] ^= 1;
    await expect(read(changed)).rejects.toBeInstanceOf(BackupError);
    // Des octets ajoutés après la fin.
    await expect(read(new Uint8Array([...bytes, 1, 2, 3]))).rejects.toEqual(new BackupError('damaged'));
  });

  it("refuse un en-tête modifié (par exemple pour faire croire à un profil seul)", async () => {
    const bytes = await write({ a: textBytes('x') });
    const text = Buffer.from(bytes).toString('latin1').replace('"kind":"full"', '"kind":"fake"');
    await expect(read(new Uint8Array(Buffer.from(text, 'latin1')))).rejects.toBeInstanceOf(BackupError);
    const swapped = Buffer.from(bytes).toString('latin1').replace('"media":true', '"media":fals');
    await expect(read(new Uint8Array(Buffer.from(swapped, 'latin1')))).rejects.toBeInstanceOf(BackupError);
  });
});
