import {
  crypto_aead_xchacha20poly1305_ietf_decrypt,
  crypto_aead_xchacha20poly1305_ietf_encrypt,
  crypto_generichash,
  crypto_pwhash,
  crypto_pwhash_ALG_DEFAULT,
  from_base64,
  randombytes_buf,
  to_base64,
  to_hex,
} from 'react-native-libsodium';

// Le fichier de sauvegarde de Pear (lot 12), protégé par un mot de passe.
//
//   « PEARBAK1 » (8 octets) · longueur de l'en-tête (4 octets) · en-tête JSON, en clair
//   puis des morceaux : longueur (4 octets) · nonce (24) · XChaCha20-Poly1305 du morceau
//
// La clé vient du mot de passe (Argon2id, sel aléatoire, coût noté dans l'en-tête). Chaque morceau est
// authentifié avec l'empreinte de l'en-tête, son numéro et un drapeau « dernier » : un en-tête changé,
// un morceau modifié, déplacé, retiré, ou un fichier coupé avant la fin, et la lecture échoue.
// Dedans, une archive : pour chaque fichier, son nom, sa taille, puis son contenu.

export const BACKUP_MAGIC = 'PEARBAK1';
export const BACKUP_EXTENSION = '.pear';
export const CHUNK_SIZE = 1 << 20;
// Argon2id : environ une seconde sur un téléphone récent, assez pour ralentir fortement les essais.
export const KDF_OPS = 3;
export const KDF_MEM = 64 * 1024 * 1024;
const MAX_OPS = 10;
const MIN_MEM = 8 * 1024;
const MAX_MEM = 256 * 1024 * 1024;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const HEADER_MAX = 64 * 1024;
// XChaCha20 : toujours 24 octets (écrit en dur : les constantes de libsodium ne sont prêtes qu'après son chargement).
const NONCE = 24;

export type BackupKind = 'profile' | 'full';
export type BackupHeader = { v: 1; kind: BackupKind; createdAt: number; salt: string; ops: number; mem: number; media: boolean };

export type Sink = { write(bytes: Uint8Array): Promise<void> };
export type Source = { read(length: number): Promise<Uint8Array> };

export class BackupError extends Error {
  constructor(readonly reason: 'format' | 'password' | 'damaged') {
    super(reason === 'format' ? 'Ce fichier n’est pas une sauvegarde de Pear.' : reason === 'password' ? 'Mot de passe incorrect.' : 'Sauvegarde abîmée ou incomplète.');
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function readUint32(bytes: Uint8Array, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function readExactly(source: Source, length: number) {
  const parts: Uint8Array[] = [];
  let missing = length;
  while (missing > 0) {
    const part = await source.read(missing);
    if (part.length === 0) break;
    parts.push(part);
    missing -= part.length;
  }
  return concat(parts);
}

export function newHeader(kind: BackupKind, media: boolean, ops = KDF_OPS, mem = KDF_MEM): BackupHeader {
  return { v: 1, kind, createdAt: Date.now(), salt: to_base64(randombytes_buf(SALT_BYTES)), ops, mem, media };
}

export function deriveKey(password: string, header: BackupHeader) {
  return crypto_pwhash(KEY_BYTES, password, from_base64(header.salt), header.ops, header.mem, crypto_pwhash_ALG_DEFAULT);
}

function additionalData(headerHash: string, index: number, final: boolean) {
  return `pear-backup-v1:${headerHash}:${index}:${final ? 1 : 0}`;
}

// Écrit l'en-tête, puis chiffre tout ce qu'on lui donne par morceaux de CHUNK_SIZE.
export class BackupWriter {
  private pending: Uint8Array[] = [];
  private pendingSize = 0;
  private index = 0;

  private constructor(private readonly sink: Sink, private readonly key: Uint8Array, private readonly headerHash: string) {}

  static async start(sink: Sink, header: BackupHeader, key: Uint8Array) {
    const json = encoder.encode(JSON.stringify(header));
    await sink.write(concat([encoder.encode(BACKUP_MAGIC), uint32(json.length), json]));
    return new BackupWriter(sink, key, to_hex(crypto_generichash(32, json, null)));
  }

  async push(bytes: Uint8Array) {
    this.pending.push(bytes);
    this.pendingSize += bytes.length;
    while (this.pendingSize >= CHUNK_SIZE) await this.emit(this.take(CHUNK_SIZE), false);
  }

  // Le dernier morceau (même vide) porte le drapeau : sans lui, la sauvegarde est refusée comme coupée.
  async finish() {
    await this.emit(this.take(this.pendingSize), true);
  }

  private take(length: number) {
    const all = concat(this.pending);
    this.pending = all.length > length ? [all.slice(length)] : [];
    this.pendingSize = all.length - length;
    return all.slice(0, length);
  }

  private async emit(plain: Uint8Array, final: boolean) {
    const nonce = randombytes_buf(NONCE);
    const cipher = crypto_aead_xchacha20poly1305_ietf_encrypt(plain, additionalData(this.headerHash, this.index, final), null, nonce, this.key);
    this.index += 1;
    await this.sink.write(concat([uint32(nonce.length + cipher.length), nonce, cipher]));
  }
}

export async function readHeader(source: Source): Promise<{ header: BackupHeader; headerHash: string }> {
  const start = await readExactly(source, BACKUP_MAGIC.length + 4);
  if (start.length < BACKUP_MAGIC.length + 4 || decoder.decode(start.slice(0, BACKUP_MAGIC.length)) !== BACKUP_MAGIC) throw new BackupError('format');
  const length = readUint32(start, BACKUP_MAGIC.length);
  if (length === 0 || length > HEADER_MAX) throw new BackupError('format');
  const json = await readExactly(source, length);
  if (json.length !== length) throw new BackupError('format');
  let header: BackupHeader;
  try {
    header = JSON.parse(decoder.decode(json));
  } catch {
    throw new BackupError('format');
  }
  if (header?.v !== 1 || (header.kind !== 'profile' && header.kind !== 'full') || typeof header.salt !== 'string') throw new BackupError('format');
  // L'en-tête est en clair : sans bornes, un fichier piégé ferait réserver des gigaoctets à Argon2.
  if (!Number.isInteger(header.ops) || header.ops < 1 || header.ops > MAX_OPS || !Number.isInteger(header.mem) || header.mem < MIN_MEM || header.mem > MAX_MEM) throw new BackupError('format');
  return { header, headerHash: to_hex(crypto_generichash(32, json, null)) };
}

// Rend les morceaux déchiffrés un par un ; null une fois le dernier lu. Un mauvais mot de passe se
// voit dès le premier morceau.
export class BackupReader {
  private index = 0;
  private done = false;

  constructor(private readonly source: Source, private readonly key: Uint8Array, private readonly headerHash: string) {}

  async next(): Promise<Uint8Array | null> {
    if (this.done) {
      if ((await this.source.read(1)).length > 0) throw new BackupError('damaged');
      return null;
    }
    const lengthBytes = await readExactly(this.source, 4);
    if (lengthBytes.length < 4) throw new BackupError('damaged');
    const length = readUint32(lengthBytes);
    if (length <= NONCE || length > CHUNK_SIZE + NONCE + 64) throw new BackupError('damaged');
    const block = await readExactly(this.source, length);
    if (block.length !== length) throw new BackupError('damaged');
    const nonce = block.slice(0, NONCE);
    const cipher = block.slice(NONCE);
    for (const final of [false, true]) {
      try {
        const plain = crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipher, additionalData(this.headerHash, this.index, final), nonce, this.key);
        this.index += 1;
        this.done = final;
        return plain;
      } catch {
        // l'autre drapeau, sinon morceau refusé
      }
    }
    throw new BackupError(this.index === 0 ? 'password' : 'damaged');
  }
}

// --- L'archive à l'intérieur ---

const ENTRY = 0x46; // « F »

export function entryHeader(name: string, size: number) {
  const nameBytes = encoder.encode(name);
  const out = new Uint8Array(1 + 2 + nameBytes.length + 8);
  const view = new DataView(out.buffer);
  out[0] = ENTRY;
  view.setUint16(1, nameBytes.length);
  out.set(nameBytes, 3);
  view.setUint32(3 + nameBytes.length, Math.floor(size / 2 ** 32));
  view.setUint32(7 + nameBytes.length, size % 2 ** 32);
  return out;
}

export type ArchiveHandlers = {
  begin(name: string, size: number): Promise<void> | void;
  data(bytes: Uint8Array): Promise<void> | void;
  end(name: string): Promise<void> | void;
};

// Lit l'archive au fil des morceaux, même quand un en-tête de fichier est à cheval sur deux morceaux.
export class ArchiveParser {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private current: { name: string; remaining: number } | null = null;

  constructor(private readonly handlers: ArchiveHandlers) {}

  async feed(bytes: Uint8Array) {
    this.buffer = this.buffer.length ? concat([this.buffer, bytes]) : bytes;
    while (this.buffer.length > 0) {
      if (this.current) {
        const take = Math.min(this.current.remaining, this.buffer.length);
        if (take > 0) await this.handlers.data(this.buffer.slice(0, take));
        this.buffer = this.buffer.slice(take);
        this.current.remaining -= take;
        if (this.current.remaining === 0) {
          await this.handlers.end(this.current.name);
          this.current = null;
        }
        continue;
      }
      if (this.buffer.length < 3) return;
      if (this.buffer[0] !== ENTRY) throw new BackupError('damaged');
      const nameLength = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint16(1);
      if (this.buffer.length < 3 + nameLength + 8) return;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const name = decoder.decode(this.buffer.slice(3, 3 + nameLength));
      const size = view.getUint32(3 + nameLength) * 2 ** 32 + view.getUint32(7 + nameLength);
      this.buffer = this.buffer.slice(3 + nameLength + 8);
      await this.handlers.begin(name, size);
      this.current = { name, remaining: size };
      if (size === 0) {
        await this.handlers.end(name);
        this.current = null;
      }
    }
  }

  // À la fin de la sauvegarde, rien ne doit rester à moitié lu.
  finish() {
    if (this.current || this.buffer.length > 0) throw new BackupError('damaged');
  }
}

export function textBytes(text: string) {
  return encoder.encode(text);
}

export function bytesText(bytes: Uint8Array) {
  return decoder.decode(bytes);
}
