import { getIdToken } from '@react-native-firebase/auth';
import { get, getDatabase, ref, remove, set } from '@react-native-firebase/database';

import { log } from '../log';
import { wakeUrl } from '../remoteConfig';
import { currentUser } from './tokens';

// Relais des fichiers par la Realtime Database (voir DOCS_SERVEUR.md) : le serveur réserve l'envoi,
// puis le téléphone écrit et lit lui-même les morceaux chiffrés sous relay/{id}/chunks/{n}.

export const RELAY_MAX_BYTES = 25 * 1024 * 1024;
// Même taille que le serveur : un fichier de `size` octets fait ceil(size / RELAY_CHUNK_BYTES) morceaux.
export const RELAY_CHUNK_BYTES = 512 * 1024;

export type Reservation = { id: string; chunks: number };

// null : refusé (trop de fichiers aujourd'hui, budget du mois atteint) ou serveur injoignable.
export async function reserveRelay(size: number): Promise<Reservation | null> {
  try {
    const user = await currentUser();
    const response = await fetch(wakeUrl().replace(/\/wake$/, '/relay'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getIdToken(user)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, size }),
    });
    if (!response.ok) {
      log.warn('relais refusé', response.status);
      return null;
    }
    const { id, chunks } = await response.json();
    return { id, chunks };
  } catch (e) {
    log.warn('relais', e);
    return null;
  }
}

export async function uploadRelayChunk(id: string, index: number, data: string) {
  await set(ref(getDatabase(), `relay/${id}/chunks/${index}`), data);
}

// null si le morceau n'existe pas (fichier expiré ou envoi incomplet).
export async function downloadRelayChunk(id: string, index: number): Promise<string | null> {
  await currentUser();
  const value = (await get(ref(getDatabase(), `relay/${id}/chunks/${index}`))).val();
  return typeof value === 'string' ? value : null;
}

export async function deleteRelay(id: string) {
  await remove(ref(getDatabase(), `relay/${id}`)).catch((e) => log.warn('suppression du relais', e));
}
