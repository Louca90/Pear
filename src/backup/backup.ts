import * as SecureStore from 'expo-secure-store';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { snapshotDatabase } from '../chat/database';
import { chat } from '../chat/manager';
import { exportCopy } from '../chat/media';
import { seal } from '../crypto/box';
import { DB_NAME } from '../config';
import { log } from '../log';
import { languageChoice, LanguageChoice, saveLanguageChoice } from '../i18n';
import { setThemePreference, ThemePreference, themePreference } from '../theme';
import {
  ArchiveParser,
  BACKUP_EXTENSION,
  BackupError,
  BackupHeader,
  BackupKind,
  BackupReader,
  BackupWriter,
  bytesText,
  deriveKey,
  entryHeader,
  newHeader,
  readHeader,
  Sink,
  Source,
  textBytes,
} from './format';
import { RESTORE_CONTEXT, RESTORE_KEY, RESTORED_SECRETS, RestoredSecrets, stagingDirectory } from './restore';

// Export et import des sauvegardes (lot 12). Deux contenus :
// - profil seul : pseudo, photo, thème, langue. Le charger ne touche jamais à l'identité ni aux conversations.
// - sauvegarde complète : identité, contacts, conversations, réglages, états du chiffrement et, si on le
//   veut, les photos et vidéos. La charger remplace tout ce qu'il y a sur le téléphone.

const READ_STEP = 1 << 20;
const FILE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_KINDS = "'image', 'video', 'audio', 'file'";

export type Progress = (done: number, total: number) => void;

type ProfileManifest = { type: 'profile'; name: string | null; theme: ThemePreference; language: LanguageChoice; photo: boolean };
type FullManifest = { type: 'full'; secrets: RestoredSecrets; media: boolean };
type Entry = { name: string; size: number; bytes?: Uint8Array; file?: File };

function rawPath(uri: string) {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function fileSink(file: File): Sink & { close(): void } {
  if (file.exists) file.delete();
  file.create();
  const handle = file.open(FileMode.WriteOnly);
  return { write: (bytes) => handle.writeBytes(bytes), close: () => handle.close() };
}

function fileSource(file: File): Source & { close(): void } {
  const handle = file.open(FileMode.ReadOnly);
  return { read: (length) => handle.readBytes(length), close: () => handle.close() };
}

function exportsDirectory() {
  const directory = new Directory(Paths.cache, 'exports');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

function filesDirectory() {
  return new Directory(Paths.document, 'pear-files');
}

// Laisse l'écran se redessiner (barre de progression) entre deux gros calculs.
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// --- Export ---

async function profileEntries(): Promise<Entry[]> {
  const { name, photo } = chat.getMyProfile();
  // La photo est chiffrée sur le disque avec une clé de la base (lot 2.3), absente d'une sauvegarde du
  // profil : on y met sa copie déchiffrée (la sauvegarde elle-même est chiffrée par le mot de passe).
  let photoFile: File | null = null;
  if (photo && new File(photo).exists) {
    photoFile = await exportCopy(photo, 'pear-profile-photo')
      .then((uri) => new File(uri))
      .catch((e) => {
        log.warn('photo de la sauvegarde', e);
        return null;
      });
  }
  const hasPhoto = !!photoFile?.exists;
  const manifest: ProfileManifest = { type: 'profile', name, theme: themePreference(), language: languageChoice(), photo: hasPhoto };
  const bytes = textBytes(JSON.stringify(manifest));
  return [{ name: 'manifest.json', size: bytes.length, bytes }, ...(hasPhoto && photoFile ? [{ name: 'photo', size: photoFile.size ?? 0, file: photoFile }] : [])];
}

// La base copiée telle quelle ; sans les médias, leurs messages deviennent « Média supprimé » dans la
// copie, mais les photos de profil et les fonds d'écran restent.
function fullEntries(media: boolean): { entries: Entry[]; snapshot: File } {
  const snapshot = new File(Paths.cache, `pear-sauvegarde-${Date.now()}.db`);
  if (snapshot.exists) snapshot.delete();
  snapshotDatabase(rawPath(snapshot.uri));

  const all = filesDirectory().exists ? filesDirectory().list().filter((item): item is File => item instanceof File) : [];
  let kept = all;
  if (!media) {
    const copy = openDatabaseSync(snapshot.name, undefined, rawPath(Paths.cache.uri));
    try {
      copy.execSync(`UPDATE messages SET file_uri = NULL WHERE kind IN (${MEDIA_KINDS})`);
      const used = new Set<string>();
      const remember = (value: string | null | undefined) => {
        const match = value?.match(/pear-files\/([A-Za-z0-9_-]+)/);
        if (match) used.add(match[1]);
      };
      copy.getAllSync<{ file_uri: string }>('SELECT file_uri FROM messages WHERE file_uri IS NOT NULL').forEach((row) => remember(row.file_uri));
      copy.getAllSync<{ value: string }>("SELECT value FROM settings WHERE value LIKE '%pear-files/%'").forEach((row) => remember(row.value));
      copy.getAllSync<{ wallpaper_uri: string }>('SELECT wallpaper_uri FROM conversation_settings WHERE wallpaper_uri IS NOT NULL').forEach((row) => remember(row.wallpaper_uri));
      copy.getAllSync<Record<string, string | null>>('SELECT * FROM contact_profiles').forEach((row) => Object.values(row).forEach((value) => remember(typeof value === 'string' ? value : null)));
      kept = all.filter((file) => used.has(file.name));
      // Les clés des fichiers laissés de côté ne partent pas avec la copie.
      copy.getAllSync<{ id: string }>('SELECT id FROM file_keys').forEach((row) => {
        if (!used.has(row.id)) copy.runSync('DELETE FROM file_keys WHERE id = ?', row.id);
      });
    } finally {
      copy.closeSync();
    }
  }

  const secrets: RestoredSecrets = {
    identity: SecureStore.getItem(RESTORED_SECRETS.identity),
    localKey: SecureStore.getItem(RESTORED_SECRETS.localKey),
    language: SecureStore.getItem(RESTORED_SECRETS.language),
  };
  const manifest = textBytes(JSON.stringify({ type: 'full', secrets, media } satisfies FullManifest));
  return {
    snapshot,
    entries: [
      { name: 'manifest.json', size: manifest.length, bytes: manifest },
      { name: 'db', size: snapshot.size ?? 0, file: snapshot },
      ...kept.filter((file) => FILE_NAME.test(file.name)).map((file) => ({ name: `files/${file.name}`, size: file.size ?? 0, file })),
    ],
  };
}

export async function exportBackup(kind: BackupKind, password: string, media: boolean, onProgress?: Progress): Promise<string> {
  await breathe();
  const header = newHeader(kind, kind === 'full' && media);
  const key = deriveKey(password, header);
  const day = new Date().toISOString().slice(0, 10);
  const output = new File(exportsDirectory(), `Pear-${kind === 'full' ? 'sauvegarde' : 'profil'}-${day}${BACKUP_EXTENSION}`);
  const { entries, snapshot } = kind === 'full' ? fullEntries(media) : { entries: await profileEntries(), snapshot: null };
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  let done = 0;
  const sink = fileSink(output);
  try {
    const writer = await BackupWriter.start(sink, header, key);
    for (const entry of entries) {
      await writer.push(entryHeader(entry.name, entry.size));
      if (entry.bytes) {
        await writer.push(entry.bytes);
        done += entry.bytes.length;
      } else if (entry.file) {
        const source = fileSource(entry.file);
        try {
          for (let left = entry.size; left > 0; ) {
            const part = await source.read(Math.min(READ_STEP, left));
            if (part.length === 0) throw new Error(`Fichier raccourci pendant la sauvegarde : ${entry.name}`);
            await writer.push(part);
            left -= part.length;
            done += part.length;
            onProgress?.(done, total);
          }
        } finally {
          source.close();
        }
      }
      onProgress?.(done, total);
    }
    await writer.finish();
  } catch (e) {
    sink.close();
    if (output.exists) output.delete();
    throw e;
  } finally {
    if (snapshot?.exists) snapshot.delete();
  }
  sink.close();
  return output.uri;
}

// --- Import ---

// Juste l'en-tête, pour savoir ce que contient le fichier avant de demander le mot de passe.
export async function inspectBackup(uri: string): Promise<BackupHeader> {
  const source = fileSource(new File(uri));
  try {
    return (await readHeader(source)).header;
  } finally {
    source.close();
  }
}

export async function importBackup(uri: string, password: string, onProgress?: Progress): Promise<{ kind: BackupKind; needsReload: boolean }> {
  await breathe();
  const file = new File(uri);
  const total = file.size ?? 0;
  const source = fileSource(file);
  let read = 0;
  const counted: Source = {
    read: async (length) => {
      const part = await source.read(length);
      read += part.length;
      onProgress?.(read, total);
      return part;
    },
  };
  try {
    const { header, headerHash } = await readHeader(counted);
    const reader = new BackupReader(counted, deriveKey(password, header), headerHash);
    return header.kind === 'profile' ? await importProfile(reader) : await importFull(reader);
  } finally {
    source.close();
  }
}

async function importProfile(reader: BackupReader) {
  let manifest: ProfileManifest | null = null;
  const photo: Uint8Array[] = [];
  const parts: Uint8Array[] = [];
  let open = '';
  const parser = new ArchiveParser({
    begin: (name) => {
      if (name !== 'manifest.json' && name !== 'photo') throw new BackupError('damaged');
      open = name;
    },
    data: (bytes) => void (open === 'photo' ? photo : parts).push(bytes),
    end: (name) => {
      if (name === 'manifest.json') manifest = JSON.parse(bytesText(concatParts(parts)));
    },
  });
  for (let chunk = await reader.next(); chunk; chunk = await reader.next()) await parser.feed(chunk);
  parser.finish();
  const profile = manifest as ProfileManifest | null;
  if (profile?.type !== 'profile') throw new BackupError('damaged');

  // Tout a été lu et vérifié : on applique. L'identité et les conversations ne bougent pas.
  let photoUri: string | null = null;
  if (profile.photo && photo.length > 0) {
    const target = new File(Paths.cache, `profil-${to_base64(randombytes_buf(8))}.jpg`);
    target.create();
    target.write(concatParts(photo));
    photoUri = target.uri;
  }
  await chat.saveProfile(profile.name ?? '', photoUri);
  setThemePreference(profile.theme);
  const needsReload = profile.language !== languageChoice();
  if (needsReload) await saveLanguageChoice(profile.language);
  return { kind: 'profile' as const, needsReload };
}

async function importFull(reader: BackupReader) {
  const staging = stagingDirectory();
  if (staging.exists) staging.delete();
  staging.create({ intermediates: true });
  const stagedFiles = new Directory(staging, 'pear-files');
  stagedFiles.create();
  let manifest: FullManifest | null = null;
  const manifestParts: Uint8Array[] = [];
  let sink: (Sink & { close(): void }) | null = null;
  let current = '';

  try {
    const parser = new ArchiveParser({
      begin: (name) => {
        current = name;
        if (name === 'manifest.json') return;
        if (name === 'db') sink = fileSink(new File(staging, DB_NAME));
        else if (name.startsWith('files/') && FILE_NAME.test(name.slice(6))) sink = fileSink(new File(stagedFiles, name.slice(6)));
        // Tout autre nom (« ../ », dossier inconnu…) : la sauvegarde est refusée.
        else throw new BackupError('damaged');
      },
      data: async (bytes) => {
        if (current === 'manifest.json') manifestParts.push(bytes);
        else await sink?.write(bytes);
      },
      end: (name) => {
        if (name === 'manifest.json') manifest = JSON.parse(bytesText(concatParts(manifestParts)));
        sink?.close();
        sink = null;
      },
    });
    for (let chunk = await reader.next(); chunk; chunk = await reader.next()) await parser.feed(chunk);
    parser.finish();
    const full = manifest as FullManifest | null;
    if (full?.type !== 'full' || !full.secrets?.identity || !new File(staging, DB_NAME).exists) throw new BackupError('damaged');

    // Vérifié jusqu'au bout. Les clés attendent chiffrées, avec une clé gardée dans le SecureStore.
    const key = randombytes_buf(32);
    SecureStore.setItem(RESTORE_KEY, to_base64(key));
    const sealed = new File(staging, 'secure');
    sealed.create();
    sealed.write(seal(JSON.stringify(full.secrets), key, RESTORE_CONTEXT));
    const ready = new File(staging, 'ready');
    ready.create();
    ready.write('1');
    return { kind: 'full' as const, needsReload: true };
  } catch (e) {
    (sink as (Sink & { close(): void }) | null)?.close();
    if (staging.exists) staging.delete();
    throw e;
  }
}

function concatParts(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

