import { openDatabaseSync } from 'expo-sqlite';

import { deleteStoredFile } from './files';

// Mes messages : sending (pas encore confirmé), delivered (reçu par l'autre), read (lu par l'autre).
// Messages reçus : receiving (fichier en cours), delivered (pas lu), read-pending (lu, l'autre n'est pas encore prévenu), read.
export type MessageStatus = 'sending' | 'receiving' | 'delivered' | 'read-pending' | 'read';
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

// L'historique vit uniquement dans ce fichier, sur le téléphone.
const db = openDatabaseSync('pear.db');

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

// Ajoute les colonnes des fichiers aux bases déjà créées, sans toucher à l'historique.
const { user_version: schemaVersion } = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!;
if (schemaVersion < 1) {
  db.execSync(`
    ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE messages ADD COLUMN file_uri TEXT;
    ALTER TABLE messages ADD COLUMN file_size INTEGER;
    ALTER TABLE messages ADD COLUMN file_mime TEXT;
    PRAGMA user_version = 1;
  `);
}
if (schemaVersion < 2) {
  db.execSync(`
    ALTER TABLE messages ADD COLUMN file_key TEXT;
    PRAGMA user_version = 2;
  `);
}
if (schemaVersion < 3) {
  db.execSync(`
    ALTER TABLE messages ADD COLUMN reply_to TEXT;
    ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE messages ADD COLUMN my_reaction TEXT;
    ALTER TABLE messages ADD COLUMN their_reaction TEXT;
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY NOT NULL,
      contact TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    PRAGMA user_version = 3;
  `);
}
if (schemaVersion < 4) {
  db.execSync(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
    CREATE TABLE conversation_settings (
      contact TEXT PRIMARY KEY NOT NULL,
      my_bubble TEXT,
      their_bubble TEXT,
      wallpaper_uri TEXT
    );
    CREATE TABLE contact_profiles (
      contact TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      photo_uri TEXT,
      sent_version TEXT
    );
    PRAGMA user_version = 4;
  `);
}

// Renvoie false si le message existait déjà.
export function addMessage(message: NewMessage): boolean {
  // INSERT OR IGNORE : un message renvoyé après une coupure n'apparaît pas en double.
  const result = db.runSync(
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
    message.file_key ?? null,
    message.reply_to ?? null,
  );
  return result.changes > 0;
}

// "mine" vérifie l'auteur : un téléphone ne peut modifier que ses propres messages, ici comme chez l'autre.
export function editMessage(id: string, contact: string, mine: number, text: string) {
  db.runSync("UPDATE messages SET text = ?, edited = 1 WHERE id = ? AND contact = ? AND mine = ? AND kind = 'text'", text, id, contact, mine);
}

export function setReaction(id: string, contact: string, column: 'my_reaction' | 'their_reaction', emoji: string | null) {
  db.runSync(`UPDATE messages SET ${column} = ? WHERE id = ? AND contact = ?`, emoji, id, contact);
}

export function deleteMessage(id: string, contact: string, mine?: number) {
  const message = getMessage(id, contact);
  if (!message || (mine !== undefined && message.mine !== mine)) return;
  if (message.file_uri) deleteStoredFile(message.file_uri);
  db.runSync('DELETE FROM messages WHERE id = ? AND contact = ?', id, contact);
}

export function addOutboxEvent(id: string, contact: string, payload: string) {
  db.runSync('INSERT INTO outbox (id, contact, payload, created_at) VALUES (?, ?, ?, ?)', id, contact, payload, Date.now());
}

export function getOutboxEvents(contact: string): OutboxEvent[] {
  return db.getAllSync<OutboxEvent>('SELECT id, payload FROM outbox WHERE contact = ? ORDER BY created_at', contact);
}

export function removeOutboxEvent(id: string, contact: string) {
  db.runSync('DELETE FROM outbox WHERE id = ? AND contact = ?', id, contact);
}

export function setFileKey(id: string, contact: string, key: string) {
  db.runSync('UPDATE messages SET file_key = ? WHERE id = ? AND contact = ?', key, id, contact);
}

export function setFileSize(id: string, contact: string, size: number) {
  db.runSync('UPDATE messages SET file_size = ? WHERE id = ? AND contact = ?', size, id, contact);
}

export function getMessage(id: string, contact: string): Message | null {
  return db.getFirstSync<Message>('SELECT * FROM messages WHERE id = ? AND contact = ?', id, contact);
}

export function finishIncomingFile(id: string, contact: string, status: MessageStatus) {
  db.runSync("UPDATE messages SET status = ? WHERE id = ? AND contact = ? AND mine = 0 AND status = 'receiving'", status, id, contact);
}

export function getSetting(key: string): string | null {
  return db.getFirstSync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export function getConversationSettings(contact: string): ConversationSettings {
  return (
    db.getFirstSync<ConversationSettings>('SELECT my_bubble, their_bubble, wallpaper_uri FROM conversation_settings WHERE contact = ?', contact) ?? {
      my_bubble: null,
      their_bubble: null,
      wallpaper_uri: null,
    }
  );
}

export function setConversationSetting(contact: string, column: keyof ConversationSettings, value: string | null) {
  db.runSync('INSERT OR IGNORE INTO conversation_settings (contact) VALUES (?)', contact);
  db.runSync(`UPDATE conversation_settings SET ${column} = ? WHERE contact = ?`, value, contact);
}

export function getContactProfile(contact: string): ContactProfile {
  return (
    db.getFirstSync<ContactProfile>('SELECT name, photo_uri, sent_version FROM contact_profiles WHERE contact = ?', contact) ?? {
      name: null,
      photo_uri: null,
      sent_version: null,
    }
  );
}

export function setContactProfileField(contact: string, column: keyof ContactProfile, value: string | null) {
  db.runSync('INSERT OR IGNORE INTO contact_profiles (contact) VALUES (?)', contact);
  db.runSync(`UPDATE contact_profiles SET ${column} = ? WHERE contact = ?`, value, contact);
}

// Efface les anciennes photos de profil de cette conversation, sauf celle qu'on vient de recevoir.
export function deleteOldAvatars(contact: string, mine: number, keepId: string | null) {
  db.getAllSync<{ id: string }>("SELECT id FROM messages WHERE contact = ? AND kind = 'avatar' AND mine = ?", contact, mine)
    .filter((row) => row.id !== keepId)
    .forEach((row) => deleteMessage(row.id, contact));
}

// Jours d'affilée où les deux personnes ont écrit, comme sur Snapchat. La série tient encore si le dernier jour est hier.
export function getStreak(contact: string): number {
  const days = db.getAllSync<{ day: string; both: number }>(
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
export function describeMessage(message: Message): string {
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
  db.runSync('INSERT OR REPLACE INTO contact_tokens (contact, token) VALUES (?, ?)', contact, token);
}

export function getContactToken(contact: string): string | null {
  return db.getFirstSync<{ token: string }>('SELECT token FROM contact_tokens WHERE contact = ?', contact)?.token ?? null;
}

export function getMessages(contact: string): Message[] {
  return db.getAllSync<Message>("SELECT * FROM messages WHERE contact = ? AND kind != 'avatar' ORDER BY created_at DESC LIMIT 200", contact);
}

export function getUndelivered(contact: string): Message[] {
  return db.getAllSync<Message>(
    "SELECT * FROM messages WHERE contact = ? AND mine = 1 AND status NOT IN ('delivered', 'read') ORDER BY created_at",
    contact,
  );
}

export function getPendingReadReceipts(contact: string): Message[] {
  return db.getAllSync<Message>("SELECT * FROM messages WHERE contact = ? AND mine = 0 AND status = 'read-pending'", contact);
}

export function markConversationRead(contact: string) {
  db.runSync("UPDATE messages SET status = 'read-pending' WHERE contact = ? AND mine = 0 AND status = 'delivered'", contact);
}

export function setReadReceiptSent(id: string, contact: string) {
  db.runSync("UPDATE messages SET status = 'read' WHERE id = ? AND contact = ? AND mine = 0", id, contact);
}

export function getLastMessage(contact: string): Message | null {
  return db.getFirstSync<Message>("SELECT * FROM messages WHERE contact = ? AND kind != 'avatar' ORDER BY created_at DESC LIMIT 1", contact);
}

// "read" ne redescend jamais : un accusé de réception en retard ne doit pas l'écraser.
export function setStatus(id: string, contact: string, status: 'delivered' | 'read') {
  db.runSync(
    "UPDATE messages SET status = ? WHERE id = ? AND contact = ? AND mine = 1 AND status != 'read'",
    status,
    id,
    contact,
  );
}

export function deleteMessages(contact: string) {
  db.getAllSync<{ file_uri: string }>('SELECT file_uri FROM messages WHERE contact = ? AND file_uri IS NOT NULL', contact).forEach(
    (row) => deleteStoredFile(row.file_uri),
  );
  db.runSync('DELETE FROM messages WHERE contact = ?', contact);
  db.runSync('DELETE FROM contact_tokens WHERE contact = ?', contact);
  db.runSync('DELETE FROM outbox WHERE contact = ?', contact);
  db.runSync('DELETE FROM conversation_settings WHERE contact = ?', contact);
  db.runSync('DELETE FROM contact_profiles WHERE contact = ?', contact);
}
