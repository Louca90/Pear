import { Directory, File, Paths } from 'expo-file-system';
import { randombytes_buf, to_hex } from 'react-native-libsodium';

import { log } from '../log';
import { getSetting, setSetting } from './database';

// Stickers maison (lot 4.9) : des images PNG découpées dans mes photos, gardées dans le dossier privé de
// Pear (pear-stickers/), jamais envoyées ailleurs que dans une conversation, comme une image.
// L'ordre (le plus récent d'abord) est dans les réglages de la base.

const ORDER_KEY = 'stickers';
const ID = /^[0-9a-f]{16}$/;
export const MAX_STICKERS = 120;

export type Sticker = { id: string; uri: string };

function directory(): Directory {
  const folder = new Directory(Paths.document, 'pear-stickers');
  folder.create({ idempotent: true, intermediates: true });
  return folder;
}

const fileOf = (id: string) => new File(directory(), `${id}.png`);

function order(): string[] {
  try {
    const saved = JSON.parse(getSetting(ORDER_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && ID.test(id)) : [];
  } catch {
    return [];
  }
}

export function listStickers(): Sticker[] {
  return order()
    .map((id) => ({ id, uri: fileOf(id).uri }))
    .filter(({ id }) => fileOf(id).exists);
}

// Range l'image découpée (fichier de passage) parmi les stickers. Au-delà de la limite, le plus ancien part.
export function addSticker(sourceUri: string): Sticker {
  const id = to_hex(randombytes_buf(8));
  const destination = fileOf(id);
  new File(sourceUri).move(destination);
  const all = [id, ...order()];
  for (const old of all.slice(MAX_STICKERS)) removeFile(old);
  setSetting(ORDER_KEY, JSON.stringify(all.slice(0, MAX_STICKERS)));
  return { id, uri: destination.uri };
}

function removeFile(id: string) {
  try {
    const file = fileOf(id);
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('sticker', e);
  }
}

export function deleteSticker(id: string) {
  removeFile(id);
  setSetting(ORDER_KEY, JSON.stringify(order().filter((other) => other !== id)));
}
