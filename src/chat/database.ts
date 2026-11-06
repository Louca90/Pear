import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';

import { decryptFileKey, encryptFileKey, isEncryptedFileKey } from './db/fileKeys';
import { LATEST_VERSION, migrate, schemaVersion } from './db/migrations';
import { deleteStoredFile, formatSize } from './files';
import { DB_NAME } from '../config';

// Mes messages : sending (pas encore confirmé), delivered (reçu par l'autre), read (lu par l'autre),
// refused (fichier refusé par l'autre : il ne repart plus).
// Messages reçus : offered (fichier trop lourd, il attend notre accord), receiving (fichier en cours),
// delivered (pas lu), read-pending (lu, l'autre n'est pas encore prévenu), read, refused (fichier refusé).
export type MessageStatus = 'sending' | 'offered' | 'receiving' | 'delivered' | 'read-pending' | 'read' | 'refused';
// wallpaper et avatar passent par le transfert de fichiers. avatar n'apparaît jamais dans la conversation.
export type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'file' | 'wallpaper' | 'avatar' | 'system';

export type ConversationSettings = {
  my_bubble: string | null;
  their_bubble: string | null;
  wallpaper_uri: string | null;
};

export type ContactProfile = {
  name: string | null;
  photo_uri: string | null;
  sent_version: string | null;
};

// Pour un fichier, "text" contient son nom.
export type Message = {
  id: string;
  contact: string;
  mine: number;
  text: string;
  status: MessageStatus;
  created_at: number;
  kind: MessageKind;
  file_uri: string | null;
  file_size: number | null;
  file_mime: string | null;
  // Clé aléatoire propre au fichier, transmise dans un message protégé par le ratchet.
  file_key: string | null;
  reply_to: string | null;
  edited: number;
  my_reaction: string | null;
  their_reaction: string | null;
};

export type NewMessage = Pick<Message, 'id' | 'contact' | 'mine' | 'text' | 'status' | 'created_at'> & Partial<Message>;

// Une action à faire connaître à l'autre téléphone : elle reste ici tant qu'il ne l'a pas confirmée.
export type OutboxEvent = {
  id: string;
  payload: string;
};

const BACKUP_SUFFIX = '.bak';

let instance: SQLiteDatabase | null = null;

// Rien ne s'exécute au chargement du module : la base est ouverte (et migrée) au premier accès.
// App l'appelle au démarrage pour afficher une erreur claire si la migration échoue.
export function openDatabase(): SQLiteDatabase {
  instance ??= openAndMigrate();
  return instance;
}

const db = openDatabase;

function databaseFile(suffix = '') {
  return new File(defaultDatabaseDirectory, DB_NAME + suffix);
}

// Avant toute migration d'une base existante, on garde une copie, supprimée seulement une fois la
// base migrée vérifiée. En cas d'échec, l'historique reste dans pear.db.bak.
// Anciennes versions : les clés des transferts terminés sont effacées, celles des transferts en cours
// chiffrées. Sans effet une fois fait.
function protectFileKeys(database: SQLiteDatabase) {
  database.runSync(
    "UPDATE messages SET file_key = NULL WHERE file_key IS NOT NULL AND ((mine = 1 AND status IN ('delivered', 'read', 'refused')) OR (mine = 0 AND status NOT IN ('offered', 'receiving')))",
  );
  const plain = database
    .getAllSync<{ id: string; contact: string; file_key: string }>('SELECT id, contact, file_key FROM messages WHERE file_key IS NOT NULL')
    .filter((row) => !isEncryptedFileKey(row.file_key));
  if (plain.length === 0) return;
  database.withTransactionSync(() => {
    for (const row of plain) database.runSync('UPDATE messages SET file_key = ? WHERE id = ? AND contact = ?', encryptFileKey(row.file_key), row.id, row.contact);
  });
}

function openAndMigrate() {
  let database = openDatabaseSync(DB_NAME);
  const version = schemaVersion(database);
  if (version >= LATEST_VERSION) {
    protectFileKeys(database);
    return database;
  }

  const existing = version > 0;
  if (existing) {
    database.closeSync();
    for (const suffix of ['', '-wal']) {
      const file = databaseFile(suffix);
      if (file.exists) file.copy(databaseFile(suffix + BACKUP_SUFFIX));
    }
    database = openDatabaseSync(DB_NAME);
  }
  migrate(database);

  const integrity = database.getFirstSync<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check;
  if (schemaVersion(database) !== LATEST_VERSION || integrity !== 'ok') {
    throw new Error(`Mise à jour de la base de messages incomplète (version ${schemaVersion(database)}, ${integrity}).`);
  }
  protectFileKeys(database);
  if (existing) {
    for (const suffix of ['', '-wal']) {
      const backup = databaseFile(suffix + BACKUP_SUFFIX);
      if (backup.exists) backup.delete();
    }
  }
  return database;
}

// Renvoie false si le message existait déjà.
export function addMessage(message: NewMessage): boolean {
  // INSERT OR IGNORE : un message renvoyé après une coupure n'apparaît pas en double.
  const result = db().runSync(
    `INSERT OR IGNORE INTO messages (id, contact, mine, text, status, created_at, kind, file_uri, file_size, file_mime, file_key, reply_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id,
    message.contact,
    message.mine,
    message.text,
    message.status,
    message.created_at,
    message.kind ?? 'text',
    message.file_uri ?? null,
    message.file_size ?? null,
    message.file_mime ?? null,
    encryptFileKey(message.file_key),
    message.reply_to ?? null,
  );
  return result.changes > 0;
}

// "mine" vérifie l'auteur : un téléphone ne peut modifier que ses propres messages, ici comme chez l'autre.
export function editMessage(id: string, contact: string, mine: number, text: string) {
  db().runSync("UPDATE messages SET text = ?, edited = 1 WHERE id = ? AND contact = ? AND mine = ? AND kind = 'text'", text, id, contact, mine);
}

export function setReaction(id: string, contact: string, column: 'my_reaction' | 'their_reaction', emoji: string | null) {
  db().runSync(`UPDATE messages SET ${column} = ? WHERE id = ? AND contact = ?`, emoji, id, contact);
}

export function deleteMessage(id: string, contact: string, mine?: number) {
  const message = getMessage(id, contact);
  if (!message || (mine !== undefined && message.mine !== mine)) return;
  if (message.file_uri) deleteStoredFile(message.file_uri);
  db().runSync('DELETE FROM messages WHERE id = ? AND contact = ?', id, contact);
}

export function addOutboxEvent(id: string, contact: string, payload: string) {
  db().runSync('INSERT INTO outbox (id, contact, payload, created_at) VALUES (?, ?, ?, ?)', id, contact, payload, Date.now());
}

export function getOutboxEvents(contact: string): OutboxEvent[] {
  return db().getAllSync<OutboxEvent>('SELECT id, payload FROM outbox WHERE contact = ? ORDER BY created_at', contact);
}

export function removeOutboxEvent(id: string, contact: string) {
  db().runSync('DELETE FROM outbox WHERE id = ? AND contact = ?', id, contact);
}

export function setFileKey(id: string, contact: string, key: string) {
  db().runSync('UPDATE messages SET file_key = ? WHERE id = ? AND contact = ?', encryptFileKey(key), id, contact);
}

export function setFileSize(id: string, contact: string, size: number) {
  db().runSync('UPDATE messages SET file_size = ? WHERE id = ? AND contact = ?', size, id, contact);
}

// La clé d'un fichier n'est déchiffrée que là où le transfert en a besoin ; les listes l'ignorent.
function withFileKey(message: Message): Message {
  return message.file_key ? { ...message, file_key: decryptFileKey(message.file_key) } : message;
}

function withoutFileKey(message: Message): Message {
  return message.file_key ? { ...message, file_key: null } : message;
}

export function getMessage(id: string, contact: string): Message | null {
  const message = db().getFirstSync<Message>('SELECT * FROM messages WHERE id = ? AND contact = ?', id, contact);
  return message && withFileKey(message);
}

// Fichier reçu en entier : sa clé ne sert plus, elle est effacée.
export function finishIncomingFile(id: string, contact: string, status: MessageStatus) {
  db().runSync("UPDATE messages SET status = ?, file_key = NULL WHERE id = ? AND contact = ? AND mine = 0 AND status = 'receiving'", status, id, contact);
}

// Un fichier reçu passe d'un état à l'autre (proposé → en cours, ou → refusé), seulement depuis l'état attendu.
export function setIncomingStatus(id: string, contact: string, from: MessageStatus, to: MessageStatus) {
  const clearKey = to === 'refused' ? ', file_key = NULL' : '';
  db().runSync(`UPDATE messages SET status = ?${clearKey} WHERE id = ? AND contact = ? AND mine = 0 AND status = ?`, to, id, contact, from);
}

// L'autre a refusé mon fichier : il ne sera plus proposé.
export function markRefused(id: string, contact: string) {
  db().runSync("UPDATE messages SET status = 'refused', file_key = NULL WHERE id = ? AND contact = ? AND mine = 1 AND status = 'sending'", id, contact);
}

// La place que prennent déjà les fichiers en cours de réception chez ce contact.
export function getPendingIncomingBytes(contact: string): number {
  return (
    db().getFirstSync<{ total: number | null }>("SELECT SUM(file_size) AS total FROM messages WHERE contact = ? AND mine = 0 AND status = 'receiving'", contact)
      ?.total ?? 0
  );
}

// États du double ratchet, déjà chiffrés par l'appelant (src/storage.ts).
export function getRatchetRow(contact: string): string | null {
  return db().getFirstSync<{ state: string }>('SELECT state FROM ratchets WHERE contact = ?', contact)?.state ?? null;
}

export function setRatchetRow(contact: string, state: string) {
  db().runSync('INSERT OR REPLACE INTO ratchets (contact, state, updated_at) VALUES (?, ?, ?)', contact, state, Date.now());
}

export function getSetting(key: string): string | null {
  return db().getFirstSync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  db().runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export function getConversationSettings(contact: string): ConversationSettings {
  return (
    db().getFirstSync<ConversationSettings>('SELECT my_bubble, their_bubble, wallpaper_uri FROM conversation_settings WHERE contact = ?', contact) ?? {
      my_bubble: null,
      their_bubble: null,
      wallpaper_uri: null,
    }
  );
}

export function setConversationSetting(contact: string, column: keyof ConversationSettings, value: string | null) {
  db().runSync('INSERT OR IGNORE INTO conversation_settings (contact) VALUES (?)', contact);
  db().runSync(`UPDATE conversation_settings SET ${column} = ? WHERE contact = ?`, value, contact);
}

export function getContactProfile(contact: string): ContactProfile {
  return (
    db().getFirstSync<ContactProfile>('SELECT name, photo_uri, sent_version FROM contact_profiles WHERE contact = ?', contact) ?? {
      name: null,
      photo_uri: null,
      sent_version: null,
    }
  );
}

export function setContactProfileField(contact: string, column: keyof ContactProfile, value: string | null) {
  db().runSync('INSERT OR IGNORE INTO contact_profiles (contact) VALUES (?)', contact);
  db().runSync(`UPDATE contact_profiles SET ${column} = ? WHERE contact = ?`, value, contact);
}

// Efface les anciennes photos de profil de cette conversation, sauf celle qu'on vient de recevoir.
export function deleteOldAvatars(contact: string, mine: number, keepId: string | null) {
  db().getAllSync<{ id: string }>("SELECT id FROM messages WHERE contact = ? AND kind = 'avatar' AND mine = ?", contact, mine)
    .filter((row) => row.id !== keepId)
    .forEach((row) => deleteMessage(row.id, contact));
}

// Jours d'affilée où les deux personnes ont écrit, comme sur Snapchat. La série tient encore si le dernier jour est hier.
export function getStreak(contact: string): number {
  const days = db().getAllSync<{ day: string; both: number }>(
    `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, (SUM(mine = 1) > 0 AND SUM(mine = 0) > 0) AS both
     FROM messages WHERE contact = ? AND kind IN ('text', 'image', 'video', 'audio', 'file')
     GROUP BY day ORDER BY day DESC`,
    contact,
  );
  const dayKey = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const byDay = new Map(days.map((row) => [row.day, row.both === 1]));
  // Aujourd'hui peut ne pas être encore complet : on compte à partir d'hier si besoin.
  let offset = byDay.get(dayKey(0)) ? 0 : 1;
  let streak = 0;
  while (byDay.get(dayKey(offset))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}

// Le texte montré sur l'accueil et dans les notifications.
const KIND_LABELS: Partial<Record<MessageKind, string>> = { image: 'Photo', video: 'Vidéo', audio: 'Message vocal', file: 'Fichier' };

export function describeMessage(message: Message): string {
  if (message.status === 'offered') return `${KIND_LABELS[message.kind] ?? 'Fichier'} en attente (${formatSize(message.file_size ?? 0)})`;
  if (message.kind === 'wallpaper') return 'Fond de discussion changé';
  if (message.kind === 'system' && message.text.startsWith('saved:')) return message.text.includes(':video') ? 'Vidéo enregistrée' : 'Photo enregistrée';
  if (message.kind === 'system') return 'Fond de discussion retiré';
  if (message.kind === 'image') return 'Photo';
  if (message.kind === 'video') return 'Vidéo';
  if (message.kind === 'audio') return 'Message vocal';
  if (message.kind === 'file') return `Fichier : ${message.text}`;
  return message.text;
}

// Le token FCM du contact, reçu par la connexion chiffrée : il sert à le réveiller.
export function setContactToken(contact: string, token: string) {
  db().runSync('INSERT OR REPLACE INTO contact_tokens (contact, token) VALUES (?, ?)', contact, token);
}

export function getContactToken(contact: string): string | null {
  return db().getFirstSync<{ token: string }>('SELECT token FROM contact_tokens WHERE contact = ?', contact)?.token ?? null;
}

export function getMessages(contact: string): Message[] {
  return db().getAllSync<Message>("SELECT * FROM messages WHERE contact = ? AND kind != 'avatar' ORDER BY created_at DESC LIMIT 200", contact).map(withoutFileKey);
}

export function getUndelivered(contact: string): Message[] {
  return db().getAllSync<Message>(
    "SELECT * FROM messages WHERE contact = ? AND mine = 1 AND status NOT IN ('delivered', 'read', 'refused') ORDER BY created_at",
    contact,
  ).map(withFileKey);
}

export function getPendingReadReceipts(contact: string): Message[] {
  return db().getAllSync<Message>("SELECT * FROM messages WHERE contact = ? AND mine = 0 AND status = 'read-pending'", contact).map(withoutFileKey);
}

export function markConversationRead(contact: string) {
  db().runSync("UPDATE messages SET status = 'read-pending' WHERE contact = ? AND mine = 0 AND status = 'delivered'", contact);
}

export function setReadReceiptSent(id: string, contact: string) {
  db().runSync("UPDATE messages SET status = 'read' WHERE id = ? AND contact = ? AND mine = 0", id, contact);
}

export function getLastMessage(contact: string): Message | null {
  const message = db().getFirstSync<Message>("SELECT * FROM messages WHERE contact = ? AND kind != 'avatar' ORDER BY created_at DESC LIMIT 1", contact);
  return message && withoutFileKey(message);
}

// "read" ne redescend jamais : un accusé de réception en retard ne doit pas l'écraser.
// Une fois livré, un fichier n'a plus besoin de sa clé : elle est effacée.
export function setStatus(id: string, contact: string, status: 'delivered' | 'read') {
  db().runSync(
    "UPDATE messages SET status = ?, file_key = NULL WHERE id = ? AND contact = ? AND mine = 1 AND status != 'read'",
    status,
    id,
    contact,
  );
}

export function deleteMessages(contact: string) {
  db().getAllSync<{ file_uri: string }>('SELECT file_uri FROM messages WHERE contact = ? AND file_uri IS NOT NULL', contact).forEach(
    (row) => deleteStoredFile(row.file_uri),
  );
  db().runSync('DELETE FROM messages WHERE contact = ?', contact);
  db().runSync('DELETE FROM contact_tokens WHERE contact = ?', contact);
  db().runSync('DELETE FROM outbox WHERE contact = ?', contact);
  db().runSync('DELETE FROM conversation_settings WHERE contact = ?', contact);
  db().runSync('DELETE FROM contact_profiles WHERE contact = ?', contact);
}
