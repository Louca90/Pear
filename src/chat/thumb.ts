import { File, Paths } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { randombytes_buf, to_hex } from 'react-native-libsodium';

import { resizeImage } from '../../modules/pear-native';
import { log } from '../log';

// Petites images JPEG en base64, faites sur ce téléphone et envoyées chiffrées avec le message : la
// miniature floue d'une photo ou d'une vidéo (lot 4.4) et l'image d'un aperçu de lien (lot 4.3).

const BLUR_SIZE = 32;
const BLUR_QUALITY = 45;

function tempFile(suffix: string) {
  return new File(Paths.cache, `pear-small-${to_hex(randombytes_buf(8))}${suffix}`);
}

function remove(file: File) {
  try {
    if (file.exists) file.delete();
  } catch (e) {
    log.warn('fichier de passage', e);
  }
}

// L'image uri réduite à maxSize points de côté, en base64. Lance une erreur si l'image est illisible.
export async function smallJpeg(uri: string, maxSize: number, quality: number): Promise<string> {
  const out = tempFile('.jpg');
  try {
    await resizeImage(uri, out.uri, maxSize, quality);
    return (await out.base64()).replace(/\s/g, '');
  } finally {
    remove(out);
  }
}

// La miniature floue d'une photo ou d'une vidéo à envoyer : 32 points, quelques centaines d'octets.
// undefined si elle ne peut pas être faite (le message part alors sans elle).
export async function makeBlurThumb(uri: string, kind: string): Promise<string | undefined> {
  if (kind !== 'image' && kind !== 'video') return undefined;
  let frame: File | null = null;
  try {
    let source = uri;
    if (kind === 'video') {
      frame = new File((await getThumbnailAsync(uri, { time: 0 })).uri);
      source = frame.uri;
    }
    return await smallJpeg(source, BLUR_SIZE, BLUR_QUALITY);
  } catch (e) {
    log.warn('miniature floue', e);
    return undefined;
  } finally {
    if (frame) remove(frame);
  }
}

export const jpegDataUri = (base64: string) => `data:image/jpeg;base64,${base64}`;
