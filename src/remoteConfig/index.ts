import { getSetting, setSetting } from '../chat/database';
import { ICE_SERVERS, REMOTE_CONFIG_PUBLIC_KEY, REMOTE_CONFIG_TIMEOUT_MS, REMOTE_CONFIG_URL, WAKE_URL } from '../config';
import { log } from '../log';
import { IceServer, isNewer, RemoteConfig, verifyRemoteConfig } from './parse';

// La dernière configuration acceptée est gardée signée dans les réglages et revérifiée à la lecture.
// Sans elle (premier lancement, fichier injoignable), les valeurs écrites dans src/config.ts s'appliquent.
const SETTING_KEY = 'remote_config';

let current: RemoteConfig | null | undefined;

function loaded(): RemoteConfig | null {
  if (current !== undefined) return current;
  try {
    const saved = getSetting(SETTING_KEY);
    current = saved ? verifyRemoteConfig(JSON.parse(saved), REMOTE_CONFIG_PUBLIC_KEY) : null;
  } catch (e) {
    log.warn('configuration distante en cache', e);
    current = null;
  }
  return current;
}

export function wakeUrl(): string {
  return loaded()?.wakeUrl ?? WAKE_URL;
}

export function iceServers(): IceServer[] {
  return loaded()?.iceServers ?? ICE_SERVERS;
}

// Au lancement. Un échec ne change rien : on garde la configuration actuelle.
export async function refreshRemoteConfig() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch(REMOTE_CONFIG_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return;
    const file: unknown = await response.json();
    const next = verifyRemoteConfig(file, REMOTE_CONFIG_PUBLIC_KEY);
    if (!next) {
      log.warn('configuration distante refusée : signature ou contenu non valide');
      return;
    }
    if (!isNewer(next, loaded())) return;
    setSetting(SETTING_KEY, JSON.stringify(file));
    current = next;
    log.info('configuration distante', next.version);
  } catch (e) {
    log.warn('configuration distante', e);
  } finally {
    clearTimeout(timeout);
  }
}
