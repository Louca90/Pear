import { openDatabaseSync } from 'expo-sqlite';

// Mes messages : sending (pas encore confirmé), delivered (reçu par l'autre), read (lu par l'autre).
// Messages reçus : delivered (pas lu), read-pending (lu, l'autre n'est pas encore prévenu), read.
export type MessageStatus = 'sending' | 'delivered' | 'read-pending' | 'read';

export type Message = {
  id: string;
  contact: string;
  mine: number;
  text: string;
  status: MessageStatus;
  created_at: number;
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

// Renvoie false si le message existait déjà.
export function addMessage(message: Message): boolean {
  // INSERT OR IGNORE : un message renvoyé après une coupure n'apparaît pas en double.
  const result = db.runSync(
    'INSERT OR IGNORE INTO messages (id, contact, mine, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    message.id,
    message.contact,
    message.mine,
    message.text,
    message.status,
    message.created_at,
  );
  return result.changes > 0;
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
  db.runSync('DELETE FROM messages WHERE contact = ?', contact);
  db.runSync('DELETE FROM contact_tokens WHERE contact = ?', contact);
}
