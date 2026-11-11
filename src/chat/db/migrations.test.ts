/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';

import { LATEST_VERSION, migrate, MigrationDb, rebuildSearchIndex, schemaVersion, searchIndexIsStale } from './migrations';

// Le SQLite de Node, présenté comme celui d'expo-sqlite.
function memoryDb() {
  const raw = new DatabaseSync(':memory:');
  const db: MigrationDb & { raw: DatabaseSync } = {
    raw,
    execSync: (sql) => raw.exec(sql),
    getFirstSync: <T>(sql: string) => (raw.prepare(sql).get() as T | undefined) ?? null,
    getAllSync: <T>(sql: string) => raw.prepare(sql).all() as T[],
    withTransactionSync: (task) => {
      raw.exec('BEGIN');
      try {
        task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}

const columns = (db: MigrationDb, table: string) => db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map((info) => info.name);
const tables = (db: MigrationDb) =>
  db.getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name);

// Les schémas exactement tels que les anciennes versions de l'app les laissaient.
const BASE = `
  CREATE TABLE messages (id TEXT PRIMARY KEY NOT NULL, contact TEXT NOT NULL, mine INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX messages_contact ON messages (contact, created_at);
  CREATE TABLE contact_tokens (contact TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL);
`;
const HISTORY = [
  BASE,
  `ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
   ALTER TABLE messages ADD COLUMN file_uri TEXT;
   ALTER TABLE messages ADD COLUMN file_size INTEGER;
   ALTER TABLE messages ADD COLUMN file_mime TEXT;
   PRAGMA user_version = 1;`,
  `ALTER TABLE messages ADD COLUMN file_key TEXT; PRAGMA user_version = 2;`,
  `ALTER TABLE messages ADD COLUMN reply_to TEXT;
   ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE messages ADD COLUMN my_reaction TEXT;
   ALTER TABLE messages ADD COLUMN their_reaction TEXT;
   CREATE TABLE outbox (id TEXT PRIMARY KEY NOT NULL, contact TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
   PRAGMA user_version = 3;`,
  `CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT);
   CREATE TABLE conversation_settings (contact TEXT PRIMARY KEY NOT NULL, my_bubble TEXT, their_bubble TEXT, wallpaper_uri TEXT);
   CREATE TABLE contact_profiles (contact TEXT PRIMARY KEY NOT NULL, name TEXT, photo_uri TEXT, sent_version TEXT);
   PRAGMA user_version = 4;`,
];

function oldDatabase(version: number) {
  const db = memoryDb();
  for (const step of HISTORY.slice(0, version + 1)) db.execSync(step);
  db.execSync("INSERT INTO messages (id, contact, mine, text, status, created_at) VALUES ('m1', 'alice', 0, 'Salut', 'read', 1)");
  return db;
}

function expectLatest(db: MigrationDb) {
  expect(schemaVersion(db)).toBe(LATEST_VERSION);
  expect(columns(db, 'messages')).toEqual(
    expect.arrayContaining(['kind', 'file_uri', 'file_size', 'file_mime', 'file_key', 'reply_to', 'edited', 'my_reaction', 'their_reaction', 'pinned']),
  );
  expect(tables(db)).toEqual(expect.arrayContaining(['messages', 'contact_tokens', 'outbox', 'settings', 'conversation_settings', 'contact_profiles', 'ratchets', 'contacts', 'pairing_requests', 'blocked_keys', 'uploads', 'relay_incoming', 'file_keys']));
}

describe('migrate', () => {
  it('crée une base neuve à la dernière version', () => {
    const db = memoryDb();
    migrate(db);
    expectLatest(db);
  });

  it.each([0, 1, 2, 3, 4])('migre une base de la version %i sans perdre de message', (version) => {
    const db = oldDatabase(version);
    migrate(db);
    expectLatest(db);
    expect(db.getFirstSync<{ text: string; kind: string; edited: number }>("SELECT text, kind, edited FROM messages WHERE id = 'm1'")).toEqual({
      text: 'Salut',
      kind: 'text',
      edited: 0,
    });
  });

  it('répare une base restée à moitié migrée par une ancienne version (app tuée entre deux ALTER)', () => {
    const db = oldDatabase(0);
    db.execSync("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
    expect(schemaVersion(db)).toBe(0);
    migrate(db);
    expectLatest(db);
  });

  it('annule une migration interrompue, puis la refait entièrement au lancement suivant', () => {
    const db = oldDatabase(2);
    const crashing: MigrationDb = {
      ...db,
      execSync: (sql) => {
        if (sql.includes('CREATE TABLE IF NOT EXISTS outbox')) throw new Error('app tuée');
        db.execSync(sql);
      },
    };
    expect(() => migrate(crashing)).toThrow('app tuée');
    expect(schemaVersion(db)).toBe(2);
    expect(columns(db, 'messages')).not.toContain('reply_to');
    migrate(db);
    expectLatest(db);
  });

  it('lot 1.5 : les contacts existants passent en « non vérifié » sans rien perdre, et la validation se garde', () => {
    const db = oldDatabase(4);
    migrate(db);
    expectLatest(db);
    expect(columns(db, 'contacts')).toContain('verified');
    db.execSync("INSERT INTO contacts (public_key, name, created_at) VALUES ('k1', 'Alice', 1), ('k2', 'Bob', 2)");
    db.execSync("UPDATE contacts SET verified = 1 WHERE public_key = 'k1'");
    expect(db.getAllSync("SELECT public_key, name, verified FROM contacts ORDER BY created_at")).toEqual([
      { public_key: 'k1', name: 'Alice', verified: 1 },
      { public_key: 'k2', name: 'Bob', verified: 0 },
    ]);
  });

  it('lot 4.1 : les messages déjà là sont indexés, et l’index suit les ajouts, modifications et suppressions', () => {
    const db = oldDatabase(4);
    migrate(db);
    const find = (word: string) => db.getAllSync<{ id: string }>(`SELECT id FROM messages_fts WHERE messages_fts MATCH '"${word}"*'`).map((row) => row.id);
    expect(find('salut')).toEqual(['m1']);
    db.execSync("INSERT INTO messages (id, contact, mine, text, status, created_at) VALUES ('m2', 'alice', 1, 'Élodie arrive demain', 'read', 2)");
    db.execSync("INSERT INTO messages (id, contact, mine, text, status, created_at, kind) VALUES ('f1', 'alice', 1, 'demain.jpg', 'read', 3, 'image')");
    expect(find('elodie')).toEqual(['m2']);
    expect(find('dem')).toEqual(['m2']);
    db.execSync("UPDATE messages SET text = 'Élodie arrive lundi' WHERE id = 'm2'");
    expect(find('demain')).toEqual([]);
    expect(find('lundi')).toEqual(['m2']);
    expect(searchIndexIsStale(db)).toBe(false);
    db.execSync("DELETE FROM messages WHERE id = 'm2'");
    expect(find('lundi')).toEqual([]);
    // Index décalé (copie qui renumérote) : détecté, puis reconstruit.
    db.execSync("DELETE FROM messages_fts; INSERT INTO messages_fts (rowid, text, id, contact) VALUES (99, 'Salut', 'm1', 'alice')");
    expect(searchIndexIsStale(db)).toBe(true);
    rebuildSearchIndex(db);
    expect(searchIndexIsStale(db)).toBe(false);
    expect(find('salut')).toEqual(['m1']);
  });

  it('vague 4 : les nouvelles colonnes arrivent vides, sans toucher aux messages déjà là', () => {
    const db = oldDatabase(4);
    db.execSync("INSERT INTO conversation_settings (contact, my_bubble) VALUES ('alice', '#112233')");
    migrate(db);
    expect(columns(db, 'messages')).toEqual(expect.arrayContaining(['meta', 'album', 'expires_at', 'view_once']));
    expect(columns(db, 'conversation_settings')).toContain('ephemeral');
    expect(db.getFirstSync("SELECT text, meta, album, expires_at, view_once FROM messages WHERE id = 'm1'")).toEqual({ text: 'Salut', meta: null, album: null, expires_at: null, view_once: 0 });
    expect(db.getFirstSync("SELECT my_bubble, ephemeral FROM conversation_settings WHERE contact = 'alice'")).toEqual({ my_bubble: '#112233', ephemeral: null });
  });

  it('ne refait rien sur une base déjà à jour', () => {
    const db = memoryDb();
    migrate(db);
    migrate(db);
    expectLatest(db);
  });
});
