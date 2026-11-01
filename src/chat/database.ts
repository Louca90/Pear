import { openDatabaseSync } from 'expo-sqlite';

import { deleteStoredFile } from './files';

// Mes messages : sending (pas encore confirmé), delivered (reçu par l'autre), read (lu par l'autre).
// Messages reçus : receiving (fichier en cours), delivered (pas lu), read-pending (lu, l'autre n'est pas encore prévenu), read.
export type MessageStatus = 'sending' | 'receiving' | 'delivered' | 'read-pending' | 'read';
export type MessageKind = 'text' | 'image' | 'video' | 'file';

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
};

export type NewMessage = Omit<Message, 'kind' | 'file_uri' | 'file_size' | 'file_mime'> & Partial<Message>;

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

// Renvoie false si le message existait déjà.
export function addMessage(message: NewMessage): boolean {
  // INSERT OR IGNORE : un message renvoyé après une coupure n'apparaît pas en double.
  const result = db.runSync(
    `INSERT OR IGNORE INTO messages (id, contact, mine, text, status, created_at, kind, file_uri, file_size, file_mime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
  return result.changes > 0;
}

export function getMessage(id: string, contact: string): Message | null {
  return db.getFirstSync<Message>('SELECT * FROM messages WHERE id = ? AND contact = ?', id, contact);
}

export function finishIncomingFile(id: string, contact: string, status: MessageStatus) {
  db.runSync("UPDATE messages SET status = ? WHERE id = ? AND contact = ? AND mine = 0 AND status = 'receiving'", status, id, contact);
}

// Le texte montré sur l'accueil et dans les notifications.
export function describeMessage(message: Message): string {
  if (message.kind === 'image') return 'Photo';
  if (message.kind === 'video') return 'Vidéo';
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
  return db.getAllSync<Message>('SELECT * FROM messages WHERE contact = ? ORDER BY created_at DESC LIMIT 200', contact);
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
  return db.getFirstSync<Message>('SELECT * FROM messages WHERE contact = ? ORDER BY created_at DESC LIMIT 1', contact);
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
}
