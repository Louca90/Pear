// Évolutions du schéma de pear.db, numérotées par PRAGMA user_version.
// Chaque migration s'exécute dans une transaction avec la mise à jour de la version : si l'app est
// tuée au milieu, rien n'est appliqué et la migration recommence proprement au lancement suivant.
// Les anciennes versions de l'app migraient hors transaction : les ajouts de colonnes vérifient donc
// d'abord qu'elles n'existent pas déjà, pour réparer une base restée à moitié migrée.

// Le strict nécessaire de SQLite, pour pouvoir tester les migrations sans le téléphone.
export type MigrationDb = {
  execSync(sql: string): void;
  getFirstSync<T>(sql: string): T | null;
  getAllSync<T>(sql: string): T[];
  withTransactionSync(task: () => void): void;
};

type Migration = { version: number; up: (db: MigrationDb) => void };

function hasColumn(db: MigrationDb, table: string, column: string) {
  return db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).some((info) => info.name === column);
}

function addColumn(db: MigrationDb, table: string, column: string, definition: string) {
  if (!hasColumn(db, table, column)) db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.execSync(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY NOT NULL,
          contact TEXT NOT NULL,
          mine INTEGER NOT NULL,
          text TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS messages_contact ON messages (contact, created_at);
        CREATE TABLE IF NOT EXISTS contact_tokens (
          contact TEXT PRIMARY KEY NOT NULL,
          token TEXT NOT NULL
        );
      `);
      addColumn(db, 'messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
      addColumn(db, 'messages', 'file_uri', 'TEXT');
      addColumn(db, 'messages', 'file_size', 'INTEGER');
      addColumn(db, 'messages', 'file_mime', 'TEXT');
    },
  },
  {
    version: 2,
    up: (db) => addColumn(db, 'messages', 'file_key', 'TEXT'),
  },
  {
    version: 3,
    up: (db) => {
      addColumn(db, 'messages', 'reply_to', 'TEXT');
      addColumn(db, 'messages', 'edited', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'messages', 'my_reaction', 'TEXT');
      addColumn(db, 'messages', 'their_reaction', 'TEXT');
      db.execSync(`
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY NOT NULL,
          contact TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    up: (db) =>
      db.execSync(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS conversation_settings (
          contact TEXT PRIMARY KEY NOT NULL,
          my_bubble TEXT,
          their_bubble TEXT,
          wallpaper_uri TEXT
        );
        CREATE TABLE IF NOT EXISTS contact_profiles (
          contact TEXT PRIMARY KEY NOT NULL,
          name TEXT,
          photo_uri TEXT,
          sent_version TEXT
        );
      `),
  },
  {
    // L'état du double ratchet de chaque contact, chiffré avec la clé locale (avant : dans le SecureStore).
    version: 5,
    up: (db) =>
      db.execSync(`
        CREATE TABLE IF NOT EXISTS ratchets (
          contact TEXT PRIMARY KEY NOT NULL,
          state TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `),
  },
  {
    // Lot 3 : contacts sortis du SecureStore (un seul bloc JSON, fragile vers 20 contacts), demandes de
    // pairing, clés bloquées, envois et réceptions par le relais (lot 7), messages épinglés.
    version: 6,
    up: (db) => {
      db.execSync(`
        CREATE TABLE IF NOT EXISTS contacts (
          public_key TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'active',
          pinned INTEGER NOT NULL DEFAULT 0,
          pin_order INTEGER
        );
        CREATE TABLE IF NOT EXISTS pairing_requests (
          id TEXT PRIMARY KEY NOT NULL,
          from_key TEXT NOT NULL,
          name TEXT NOT NULL,
          at INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS blocked_keys (
          key TEXT PRIMARY KEY NOT NULL,
          at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS uploads (
          file_id TEXT PRIMARY KEY NOT NULL,
          message_id TEXT NOT NULL,
          contact TEXT NOT NULL,
          upload_id TEXT,
          parts_done INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS relay_incoming (
          file_id TEXT PRIMARY KEY NOT NULL,
          contact TEXT NOT NULL,
          message_id TEXT NOT NULL,
          state TEXT NOT NULL,
          size INTEGER NOT NULL
        );
      `);
      addColumn(db, 'messages', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function schemaVersion(db: MigrationDb) {
  return db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

export function migrate(db: MigrationDb) {
  const current = schemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.withTransactionSync(() => {
      migration.up(db);
      db.execSync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
