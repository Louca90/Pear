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
  {
    // Lot 8.4 : les séries ne comptent que les photos et vidéos prises avec la caméra de Pear. Les
    // messages d'avant cette version gardent l'ancienne règle (les séries en cours ne cassent pas).
    version: 7,
    up: (db) => {
      addColumn(db, 'messages', 'from_camera', 'INTEGER NOT NULL DEFAULT 0');
      db.execSync(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('camera_streak_since', CAST(CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS TEXT))",
      );
    },
  },
  {
    // Lot 8.4 : message transféré (mention « Transféré » dans la bulle).
    version: 8,
    up: (db) => addColumn(db, 'messages', 'forwarded', 'INTEGER NOT NULL DEFAULT 0'),
  },
  {
    // Lot 8.13 : session de connexion, pour regrouper les bulles envoyées d'une traite.
    version: 9,
    up: (db) => addColumn(db, 'messages', 'conn_session', 'INTEGER'),
  },
  {
    // Qui a réagi et quand : l'heure de chaque réaction.
    version: 10,
    up: (db) => {
      addColumn(db, 'messages', 'my_reaction_at', 'INTEGER');
      addColumn(db, 'messages', 'their_reaction_at', 'INTEGER');
    },
  },
  {
    // Lot 8.9 : envoi programmé (le message attend sur l'appareil jusqu'à l'heure choisie).
    version: 11,
    up: (db) => addColumn(db, 'messages', 'scheduled_at', 'INTEGER'),
  },
  {
    // Lot 1.5 : contact « vérifié » (code comparé sur la fiche, ou scans croisés en face à face).
    version: 12,
    up: (db) => addColumn(db, 'contacts', 'verified', 'INTEGER NOT NULL DEFAULT 0'),
  },
  {
    // Lot 2.3 : clé de chaque fichier de pear-files/ (chiffré sur le disque), par nom de fichier.
    version: 13,
    up: (db) => db.execSync('CREATE TABLE IF NOT EXISTS file_keys (id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL)'),
  },
  {
    // Lot 4.1 : recherche dans les messages. Index plein texte (FTS5) des messages de type texte, dans
    // la base chiffrée, tenu à jour par des déclencheurs. Sans FTS5 (SQLite construit sans), la
    // recherche se fait par LIKE : la migration ne bloque jamais le démarrage.
    version: 14,
    up: (db) => {
      try {
        createSearchIndex(db);
      } catch {
        db.execSync('DROP TABLE IF EXISTS messages_fts');
      }
    },
  },
  {
    // Vague 4 : ce qu'un message transporte en plus (forme d'onde d'un vocal, miniature floue, aperçu
    // de lien), en JSON. Voir src/chat/meta.ts.
    version: 15,
    up: (db) => addColumn(db, 'messages', 'meta', 'TEXT'),
  },
  {
    // Lot 4.5 : album (plusieurs photos envoyées ensemble) : le même identifiant sur chaque média.
    version: 16,
    up: (db) => addColumn(db, 'messages', 'album', 'TEXT'),
  },
  {
    // Lot 4.7 : messages éphémères (heure d'effacement de chaque message, minuteur de la conversation
    // en secondes) et médias à vue unique (1 : à voir une fois, 2 : déjà ouvert).
    version: 17,
    up: (db) => {
      addColumn(db, 'messages', 'expires_at', 'INTEGER');
      addColumn(db, 'messages', 'view_once', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'conversation_settings', 'ephemeral', 'INTEGER');
      db.execSync('CREATE INDEX IF NOT EXISTS messages_expires ON messages (expires_at) WHERE expires_at IS NOT NULL');
    },
  },
];

// La ligne de l'index porte le rowid du message : une modification ou une suppression la retrouve
// sans parcourir l'index.
export function createSearchIndex(db: MigrationDb) {
  db.execSync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, id UNINDEXED, contact UNINDEXED, tokenize = "unicode61 remove_diacritics 2");
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages WHEN new.kind = 'text' BEGIN
      INSERT INTO messages_fts (rowid, text, id, contact) VALUES (new.rowid, new.text, new.id, new.contact);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF text ON messages WHEN new.kind = 'text' BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
      INSERT INTO messages_fts (rowid, text, id, contact) VALUES (new.rowid, new.text, new.id, new.contact);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages WHEN old.kind = 'text' BEGIN
      DELETE FROM messages_fts WHERE rowid = old.rowid;
    END;
  `);
  rebuildSearchIndex(db);
}

export function rebuildSearchIndex(db: MigrationDb) {
  db.execSync(`
    DELETE FROM messages_fts;
    INSERT INTO messages_fts (rowid, text, id, contact) SELECT rowid, text, id, contact FROM messages WHERE kind = 'text';
  `);
}

export function hasSearchIndex(db: MigrationDb) {
  return db.getFirstSync("SELECT 1 AS found FROM sqlite_master WHERE name = 'messages_fts'") !== null;
}

// Une copie de la base (sauvegarde, chiffrement) peut renuméroter les lignes de messages : l'index ne
// désignerait plus les bons messages. Vérifié à l'ouverture sur le nombre de lignes et sur la dernière.
export function searchIndexIsStale(db: MigrationDb) {
  const texts = db.getFirstSync<{ n: number }>("SELECT count(*) AS n FROM messages WHERE kind = 'text'")?.n ?? 0;
  const indexed = db.getFirstSync<{ n: number }>('SELECT count(*) AS n FROM messages_fts')?.n ?? 0;
  if (texts !== indexed) return true;
  if (texts === 0) return false;
  const last = db.getFirstSync<{ same: number }>(
    "SELECT (SELECT f.id FROM messages_fts f WHERE f.rowid = m.rowid) = m.id AS same FROM messages m WHERE m.kind = 'text' ORDER BY m.rowid DESC LIMIT 1",
  );
  return last?.same !== 1;
}

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
