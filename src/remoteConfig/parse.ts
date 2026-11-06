import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/curves/utils.js';

// Configuration distante : quelques réglages non secrets qu'on peut changer sans publier d'APK.
// Le fichier est signé avec une clé Ed25519 gardée hors du dépôt (scripts/sign-config.mjs) : sans la
// signature, quelqu'un qui modifie le fichier pourrait rediriger les jetons de réveil vers son serveur.

export type IceServer = { urls: string; username?: string; credential?: string };

export type RemoteConfig = {
  // Croît à chaque signature : une ancienne version, même correctement signée, est refusée.
  version: number;
  wakeUrl: string;
  iceServers: IceServer[];
};

// Le texte signé commence par ce préfixe : une signature faite pour autre chose ne peut pas servir ici.
export const SIGNING_PREFIX = 'pear-remote-config-v1\n';

const MAX_ICE_SERVERS = 10;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(value);
}

function isIceServer(value: unknown): value is IceServer {
  if (!value || typeof value !== 'object') return false;
  const server = value as Record<string, unknown>;
  const optional = (field: unknown) => field === undefined || (typeof field === 'string' && field.length <= 200);
  return (
    typeof server.urls === 'string' &&
    /^(stun|turn|turns):[^\s]{1,200}$/.test(server.urls) &&
    optional(server.username) &&
    optional(server.credential)
  );
}

function asConfig(value: unknown): RemoteConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Record<string, unknown>;
  if (typeof config.version !== 'number' || !Number.isSafeInteger(config.version) || config.version < 1) return null;
  if (!isHttpsUrl(config.wakeUrl)) return null;
  if (!Array.isArray(config.iceServers) || config.iceServers.length === 0 || config.iceServers.length > MAX_ICE_SERVERS) return null;
  if (!config.iceServers.every(isIceServer)) return null;
  return {
    version: config.version,
    wakeUrl: config.wakeUrl,
    iceServers: config.iceServers.map(({ urls, username, credential }) => ({ urls, username, credential })),
  };
}

// Vérifie la signature puis le contenu. Renvoie null au moindre doute : l'app garde alors sa configuration.
// Le fichier publié est { "payload": "<JSON en texte>", "signature": "<hex>" }.
export function verifyRemoteConfig(file: unknown, publicKeyHex: string): RemoteConfig | null {
  if (!file || typeof file !== 'object') return null;
  const { payload, signature } = file as Record<string, unknown>;
  if (typeof payload !== 'string' || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return null;
  try {
    const message = new TextEncoder().encode(SIGNING_PREFIX + payload);
    if (!ed25519.verify(hexToBytes(signature), message, hexToBytes(publicKeyHex))) return null;
    return asConfig(JSON.parse(payload));
  } catch {
    return null;
  }
}

// La configuration reçue ne remplace l'actuelle que si elle est plus récente.
export function isNewer(next: RemoteConfig, current: RemoteConfig | null) {
  return !current || next.version > current.version;
}
