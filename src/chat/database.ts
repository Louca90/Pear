import { File, Paths } from 'expo-file-system';
import { openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';

import { decryptFileKey, encryptFileKey, isEncryptedFileKey } from './db/fileKeys';
import { LATEST_VERSION, migrate, schemaVersion } from './db/migrations';
import { deleteStoredFile, formatSize } from './files';
import { DB_NAME } from '../config';
import { t } from '../i18n';
import { UPDATE_REQUIRED } from './protocol';

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
// Une demande de pairing expire au bout de 7 jours, comme sur le serveur.
const REQUEST_EXPIRY_MS = 7 * 24 * 3600 * 1000;

let instance: SQLiteDatabase | null = null;

// Rien ne s'exécute au chargement du module : la base est ouverte (et migrée) au premier accès.
// App l'appelle au démarrage pour afficher une erreur claire si la migration échoue.
export function openDatabase(): SQLiteDatabase {
  instance ??= openAndMigrate();
  return instance;
}

const db = openDatabase;

// expo-sqlite range ses bases dans files/SQLite. defaultDatabaseDirectory est un chemin brut que File
// refuse (« URI is not absolute ») : on part de Paths.document, qui est une URI file://.
function databaseFile(suffix = '') {
  return new File(Paths.document, 'SQLite', DB_NAME + suffix);
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

// Contacts, dans l'ordre où ils ont été ajoutés (src/storage.ts garde la même interface qu'avant).
// pending : on a envoyé une demande, le contact ne l'a pas encore acceptée.
export type ContactRow = { public_key: string; name: string; state?: 'active' | 'pending' };

export function getContactRows(): ContactRow[] {
  return db().getAllSync<ContactRow>("SELECT public_key, name, state FROM contacts WHERE state IN ('active', 'pending') ORDER BY created_at, rowid");
}

// Le contact a accepté notre demande (ou nous a ajouté de son côté).
export function activateContact(contact: string): boolean {
  return db().runSync("UPDATE contacts SET state = 'active' WHERE public_key = ? AND state = 'pending'", contact).changes > 0;
}

export function getContactState(contact: string): 'active' | 'pending' | null {
  return db().getFirstSync<{ state: 'active' | 'pending' }>('SELECT state FROM contacts WHERE public_key = ?', contact)?.state ?? null;
}

// --- Demandes de pairing reçues ---

export type PairingRequest = { id: string; from_key: string; name: string; at: number };

// Renvoie false si une demande de cette clé attendait déjà (on garde la plus récente).
export function addPairingRequest(request: PairingRequest) {
  db().runSync("DELETE FROM pairing_requests WHERE from_key = ? AND state = 'pending'", request.from_key);
  db().runSync("INSERT OR REPLACE INTO pairing_requests (id, from_key, name, at, state) VALUES (?, ?, ?, ?, 'pending')", request.id, request.from_key, request.name, request.at);
}

// Les demandes en attente de moins de 7 jours, les plus récentes d'abord.
export function getPendingRequests(): PairingRequest[] {
  return db().getAllSync<PairingRequest>(
    "SELECT id, from_key, name, at FROM pairing_requests WHERE state = 'pending' AND at > ? ORDER BY at DESC",
    Date.now() - REQUEST_EXPIRY_MS,
  );
}

export function setRequestState(fromKey: string, state: 'accepted' | 'declined') {
  db().runSync("UPDATE pairing_requests SET state = ? WHERE from_key = ? AND state = 'pending'", state, fromKey);
}

// --- Clés bloquées ---

export function blockKey(key: string) {
  db().runSync('INSERT OR REPLACE INTO blocked_keys (key, at) VALUES (?, ?)', key, Date.now());
}

export function unblockKey(key: string) {
  db().runSync('DELETE FROM blocked_keys WHERE key = ?', key);
}

export function isBlocked(key: string) {
  return db().getFirstSync('SELECT 1 FROM blocked_keys WHERE key = ?', key) !== null;
}

export type BlockedKey = { key: string; at: number; name: string | null };

// Avec le pseudo de la dernière demande reçue de cette clé, pour reconnaître qui on a bloqué.
export function getBlockedKeys(): BlockedKey[] {
  return db().getAllSync<BlockedKey>(
    'SELECT b.key, b.at, (SELECT name FROM pairing_requests WHERE from_key = b.key ORDER BY at DESC LIMIT 1) AS name FROM blocked_keys b ORDER BY b.at DESC',
  );
}

// Remplace la liste entière en gardant la date d'ajout (et l'épinglage) des contacts déjà connus.
export function replaceContactRows(contacts: ContactRow[]) {
  const database = db();
  database.withTransactionSync(() => {
    const keys = contacts.map((contact) => contact.public_key);
    database.runSync(`DELETE FROM contacts WHERE public_key NOT IN (${keys.map(() => '?').join(', ') || "''"})`, ...keys);
    const now = Date.now();
    contacts.forEach((contact, index) => {
      database.runSync(
        'INSERT INTO contacts (public_key, name, created_at, state) VALUES (?, ?, ?, ?) ON CONFLICT(public_key) DO UPDATE SET name = excluded.name, state = excluded.state',
        contact.public_key,
        contact.name,
        now + index,
        contact.state ?? 'active',
      );
    });
  });
}

// Ce que montre la notification d'une conversation : à partir du plus ancien message reçu non lu,
// les messages des deux côtés (nos réponses depuis la notification y apparaissent), au plus 8.
export function getNotificationMessages(contact: string): Message[] {
  const firstUnread = db().getFirstSync<{ at: number | null }>(
    "SELECT MIN(created_at) AS at FROM messages WHERE contact = ? AND mine = 0 AND status = 'delivered' AND kind NOT IN ('system', 'avatar')",
    contact,
  )?.at;
  if (firstUnread == null) return [];
  return db()
    .getAllSync<Message>(
      "SELECT * FROM messages WHERE contact = ? AND created_at >= ? AND kind NOT IN ('system', 'avatar') ORDER BY created_at DESC LIMIT 8",
      contact,
      firstUnread,
    )
    .reverse();
}

// --- Relais des fichiers (lot 7) ---

// Un envoi par le relais : reprend au dernier morceau envoyé, même après fermeture de l'app.
export type RelayUpload = { file_id: string; message_id: string; contact: string; parts_done: number; state: 'uploading' | 'uploaded'; size: number };

export function getUpload(messageId: string, contact: string): RelayUpload | null {
  return db().getFirstSync<RelayUpload>('SELECT file_id, message_id, contact, parts_done, state, size FROM uploads WHERE message_id = ? AND contact = ?', messageId, contact);
}

export function saveUpload(upload: RelayUpload) {
  db().runSync(
    'INSERT OR REPLACE INTO uploads (file_id, message_id, contact, parts_done, state, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    upload.file_id,
    upload.message_id,
    upload.contact,
    upload.parts_done,
    upload.state,
    upload.size,
    Date.now(),
  );
}

export function deleteUpload(messageId: string, contact: string) {
  db().runSync('DELETE FROM uploads WHERE message_id = ? AND contact = ?', messageId, contact);
}

// Un fichier qui attend dans le relais, à télécharger.
export type RelayIncoming = { file_id: string; contact: string; message_id: string; size: number };

export function addRelayIncoming(incoming: RelayIncoming) {
  db().runSync(
    "INSERT OR REPLACE INTO relay_incoming (file_id, contact, message_id, state, size) VALUES (?, ?, ?, 'pending', ?)",
    incoming.file_id,
    incoming.contact,
    incoming.message_id,
    incoming.size,
  );
}

export function getRelayIncoming(messageId: string, contact: string): RelayIncoming | null {
  return db().getFirstSync<RelayIncoming>('SELECT file_id, contact, message_id, size FROM relay_incoming WHERE message_id = ? AND contact = ?', messageId, contact);
}

export function deleteRelayIncoming(messageId: string, contact: string) {
  db().runSync('DELETE FROM relay_incoming WHERE message_id = ? AND contact = ?', messageId, contact);
}

// Ce que ce contact a fait de son côté : il nous a supprimé ou bloqué. null : rien de particulier.
export type PeerState = 'removed' | 'blocked';

export function getPeerState(contact: string): PeerState | null {
  const state = getSetting(`peer_state.${contact}`);
  return state === 'removed' || state === 'blocked' ? state : null;
}

export function setPeerState(contact: string, state: PeerState | null) {
  setSetting(`peer_state.${contact}`, state);
}

// Messages reçus pas encore lus, par contact (calculé depuis la base : exact après un redémarrage).
export function getUnreadCounts(): Map<string, number> {
  const rows = db().getAllSync<{ contact: string; count: number }>(
    "SELECT contact, COUNT(*) AS count FROM messages WHERE mine = 0 AND status = 'delivered' AND kind NOT IN ('system', 'avatar') GROUP BY contact",
  );
  return new Map(rows.map((row) => [row.contact, row.count]));
}

// Conversations épinglées, dans l'ordre où elles ont été épinglées.
export function getPinnedOrder(): string[] {
  return db()
    .getAllSync<{ public_key: string }>('SELECT public_key FROM contacts WHERE pinned = 1 ORDER BY pin_order, rowid')
    .map((row) => row.public_key);
}

export const MAX_PINNED = 3;

// Renvoie false si la limite de 3 épingles est atteinte.
export function setPinned(contact: string, pinned: boolean): boolean {
  if (!pinned) {
    db().runSync('UPDATE contacts SET pinned = 0, pin_order = NULL WHERE public_key = ?', contact);
    return true;
  }
  if (getPinnedOrder().length >= MAX_PINNED) return false;
  const next = (db().getFirstSync<{ top: number | null }>('SELECT MAX(pin_order) AS top FROM contacts')?.top ?? 0) + 1;
  db().runSync('UPDATE contacts SET pinned = 1, pin_order = ? WHERE public_key = ?', next, contact);
  return true;
}

export function getPinnedContacts(): Set<string> {
  return new Set(db().getAllSync<{ public_key: string }>('SELECT public_key FROM contacts WHERE pinned = 1').map((row) => row.public_key));
}

// Les contacts avec qui un message a été échangé depuis `since`.
export function getRecentContacts(since: number): Set<string> {
  return new Set(db().getAllSync<{ contact: string }>('SELECT DISTINCT contact FROM messages WHERE created_at > ?', since).map((row) => row.contact));
}

// États du double ratchet, déjà chiffrés par l'appelant (src/storage.ts).
export function getRatchetRow(contact: string): string | null {
  return db().getFirstSync<{ state: string }>('SELECT state FROM ratchets WHERE contact = ?', contact)?.state ?? null;
}

export function deleteRatchetRow(contact: string) {
  db().runSync('DELETE FROM ratchets WHERE contact = ?', contact);
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
const KIND_LABELS: Partial<Record<MessageKind, string>> = { image: t('apercu.photo'), video: t('apercu.video'), audio: t('apercu.vocal'), file: t('apercu.fichier') };

export function describeMessage(message: Message): string {
  if (message.status === 'offered') return t('apercu.enAttente', { type: KIND_LABELS[message.kind] ?? t('apercu.fichier'), taille: formatSize(message.file_size ?? 0) });
  if (message.kind === 'wallpaper') return t('apercu.fondChange');
  if (message.kind === 'system' && message.text === UPDATE_REQUIRED) return t('chat.majRequise');
  if (message.kind === 'system' && message.text.startsWith('saved:')) return message.text.includes(':video') ? t('apercu.videoEnregistree') : t('apercu.photoEnregistree');
  if (message.kind === 'system') return t('apercu.fondRetire');
  if (message.kind === 'image') return t('apercu.photo');
  if (message.kind === 'video') return t('apercu.video');
  if (message.kind === 'audio') return t('apercu.vocal');
  if (message.kind === 'file') return t('apercu.fichierNom', { nom: message.text });
  return message.text;
}

// Le token FCM du contact, reçu par la connexion chiffrée : il sert à le réveiller.
export function setContactToken(contact: string, token: string) {
  db().runSync('INSERT OR REPLACE INTO contact_tokens (contact, token) VALUES (?, ?)', contact, token);
}

export function deleteContactToken(contact: string) {
  db().runSync('DELETE FROM contact_tokens WHERE contact = ?', contact);
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
