import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';
import { randombytes_buf, to_hex } from 'react-native-libsodium';

import { log } from '../../log';
import { isSqliteHeader, keyLiteral, MainState, planEncryption, sqlPath } from './encryptionPlan';

// pear.db chiffrée par SQLCipher (lot 2.2). La clé, aléatoire, ne quitte jamais le SecureStore
// (Keystore d'Android) et n'entre dans aucune sauvegarde : une base restaurée arrive en clair et se
// chiffre au démarrage suivant avec la clé de ce téléphone.

const KEY_NAME = 'db_key';
// La copie chiffrée en préparation, et l'ancienne base en clair le temps de l'échange.
const TEMP_SUFFIX = '.enc';
const OLD_SUFFIX = '.plain';
const SIDECARS = ['-wal', '-shm', '-journal'];
const MAX_STEPS = 4;

let encrypted = false;

// Vrai une fois la base ouverte chiffrée. Faux sur un APK construit sans SQLCipher.
export function isDatabaseEncrypted() {
  return encrypted;
}

function databaseFile(name: string) {
  return new File(Paths.document, 'SQLite', name);
}

// Chemin brut, pour ATTACH.
function rawDatabasePath(name: string) {
  return `${defaultDatabaseDirectory}/${name}`;
}

function deleteFiles(name: string, suffixes: string[]) {
  for (const suffix of suffixes) {
    const file = databaseFile(name + suffix);
    if (file.exists) file.delete();
  }
}

function moveFile(from: string, to: string) {
  deleteFiles(to, ['', ...SIDECARS]);
  databaseFile(from).moveSync(databaseFile(to));
}

function mainState(name: string): MainState {
  const file = databaseFile(name);
  // Un fichier vide (base pas encore écrite) se traite comme une nouvelle installation.
  if (!file.exists || (file.size ?? 0) < 16) return 'absent';
  const handle = file.open();
  try {
    return isSqliteHeader(handle.readBytesSync(16)) ? 'plain' : 'encrypted';
  } finally {
    handle.close();
  }
}

function cipherAvailable() {
  const probe = openDatabaseSync(':memory:', { useNewConnection: true });
  try {
    return !!probe.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version')?.cipher_version;
  } catch {
    return false;
  } finally {
    probe.closeSync();
  }
}

function applyKey(database: SQLiteDatabase, key: string) {
  database.execSync(`PRAGMA key = ${keyLiteral(key)}`);
  // Lit la première page : lance « file is not a database » si la clé ne correspond pas.
  database.getFirstSync('SELECT count(*) FROM sqlite_master');
}

// Le nombre de lignes de chaque table, pour vérifier que la copie chiffrée n'a rien perdu.
function tableCounts(database: SQLiteDatabase) {
  const tables = database.getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return tables.map(({ name }) => `${name}:${database.getFirstSync<{ n: number }>(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`)?.n ?? 0}`).join(',');
}

function userVersion(database: SQLiteDatabase) {
  return database.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

// Copie chiffrée de la base en clair, vérifiée, puis échangée avec elle. L'ancienne est effacée.
function encryptInPlace(name: string, key: string) {
  const temp = name + TEMP_SUFFIX;
  deleteFiles(temp, ['', ...SIDECARS]);

  const plain = openDatabaseSync(name, { useNewConnection: true });
  let version: number;
  let counts: string;
  try {
    plain.execSync('PRAGMA wal_checkpoint(TRUNCATE)');
    version = userVersion(plain);
    counts = tableCounts(plain);
    plain.execSync(`ATTACH DATABASE ${sqlPath(rawDatabasePath(temp))} AS encrypted KEY ${keyLiteral(key)}`);
    plain.execSync("SELECT sqlcipher_export('encrypted')");
    plain.execSync(`PRAGMA encrypted.user_version = ${version}`);
    plain.execSync('DETACH DATABASE encrypted');
  } finally {
    plain.closeSync();
  }

  const copy = openDatabaseSync(temp, { useNewConnection: true });
  let problem: string | null = null;
  try {
    applyKey(copy, key);
    const integrity = copy.getFirstSync<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check;
    if (integrity !== 'ok') problem = `intégrité : ${integrity}`;
    else if (userVersion(copy) !== version) problem = `version ${userVersion(copy)} au lieu de ${version}`;
    else if (tableCounts(copy) !== counts) problem = 'lignes manquantes';
  } finally {
    copy.closeSync();
  }
  if (problem) {
    deleteFiles(temp, ['', ...SIDECARS]);
    throw new Error(`Chiffrement de la base de messages interrompu (${problem}). Rien n'a été perdu.`);
  }

  // Après le point de contrôle et la fermeture, le journal est vide : on ne garde que le fichier.
  deleteFiles(name, SIDECARS);
  deleteFiles(temp, SIDECARS);
  moveFile(name, name + OLD_SUFFIX);
  moveFile(temp, name);
  deleteFiles(name + OLD_SUFFIX, ['', ...SIDECARS]);
  log.info('base', `base de messages chiffrée (version ${version})`);
}

// Ouvre la base chiffrée, en chiffrant d'abord une base en clair (première ouverture après la mise à
// jour, ou après une restauration). Reprend là où un essai interrompu s'était arrêté.
export function openEncryptedDatabase(name: string): SQLiteDatabase {
  if (!cipherAvailable()) {
    if (mainState(name) === 'encrypted') throw new Error('Cette version de Pear ne sait pas lire la base de messages chiffrée. Installez la dernière version.');
    log.warn('base', 'SQLCipher absent de cet APK : base ouverte en clair');
    encrypted = false;
    return openDatabaseSync(name);
  }

  const files = () => ({ main: mainState(name), temp: databaseFile(name + TEMP_SUFFIX).exists, old: databaseFile(name + OLD_SUFFIX).exists });
  const start = files();
  let key = SecureStore.getItem(KEY_NAME);
  if (!key) {
    // Jamais de nouvelle clé par-dessus une base déjà chiffrée : elle deviendrait illisible pour de bon.
    if (start.main === 'encrypted' || (start.main === 'absent' && start.temp && start.old)) {
      throw new Error('La clé de la base de messages est introuvable sur ce téléphone.');
    }
    key = to_hex(randombytes_buf(32));
    SecureStore.setItem(KEY_NAME, key);
  }

  for (let i = 0; i < MAX_STEPS; i++) {
    const step = planEncryption(files());
    if (step === 'none') break;
    if (step === 'encrypt') encryptInPlace(name, key);
    else if (step === 'restore-old') moveFile(name + OLD_SUFFIX, name);
    else if (step === 'finish-swap') {
      moveFile(name + TEMP_SUFFIX, name);
      deleteFiles(name + OLD_SUFFIX, ['', ...SIDECARS]);
    } else if (step === 'delete-old') deleteFiles(name + OLD_SUFFIX, ['', ...SIDECARS]);
  }

  const database = openDatabaseSync(name);
  try {
    applyKey(database, key);
  } catch (e) {
    database.closeSync();
    throw e;
  }
  encrypted = true;
  return database;
}

// Copie en clair de la base ouverte (pour une sauvegarde, qui la chiffre ensuite en entier).
export function exportPlainCopy(database: SQLiteDatabase, path: string) {
  const version = userVersion(database);
  database.execSync(`ATTACH DATABASE ${sqlPath(path)} AS plain KEY ''`);
  try {
    database.execSync("SELECT sqlcipher_export('plain')");
    database.execSync(`PRAGMA plain.user_version = ${version}`);
  } finally {
    database.execSync('DETACH DATABASE plain');
  }
}
