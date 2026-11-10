import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/curves/utils.js';

// Lecture d'une release GitHub de Pear. Format attendu (voir RELEASE.md) : un tag vX.Y.Z, un APK
// pear-X.Y.Z.apk en pièce jointe, et dans la description une section « ## Résumé », puis les lignes
// « versionCode: N », « sha256: <empreinte> » et « signature: <hex> » (Ed25519, clé de la configuration
// distante, sur versionCode et sha256 : sans elle, la release est ignorée).

export type Release = {
  tag: string;
  version: string;
  versionCode: number;
  sha256: string | null;
  signature: string | null;
  summary: string;
  pageUrl: string;
  apkUrl: string;
  apkSize: number;
};

const SUMMARY_FALLBACK_LINES = 5;

export function parseVersionCode(body: string): number | null {
  const match = body.match(/^\s*versionCode:\s*(\d+)\s*$/im);
  return match ? Number(match[1]) : null;
}

export function parseSha256(body: string): string | null {
  const match = body.match(/^\s*sha256:\s*([0-9a-f]{64})\s*$/im);
  return match ? match[1].toLowerCase() : null;
}

export function parseSignature(body: string): string | null {
  const match = body.match(/^\s*signature:\s*([0-9a-f]{128})\s*$/im);
  return match ? match[1].toLowerCase() : null;
}

// Le texte signé par scripts/release.mjs : le préfixe empêche de réutiliser une autre signature.
export const RELEASE_SIGNING_PREFIX = 'pear-release-v1\n';

export function releaseSigningMessage(versionCode: number, sha256: string) {
  return new TextEncoder().encode(`${RELEASE_SIGNING_PREFIX}${versionCode}\n${sha256}`);
}

// Une release sans empreinte ou sans signature valide n'est jamais proposée : quelqu'un qui publierait un
// APK sur le dépôt sans la clé privée ne pourrait pas le faire installer.
export function isReleaseSigned(release: Release, publicKeyHex: string): boolean {
  if (!release.sha256 || !release.signature) return false;
  try {
    return ed25519.verify(hexToBytes(release.signature), releaseSigningMessage(release.versionCode, release.sha256), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

// La section « Résumé » jusqu'au titre suivant. Sans elle, les premières lignes de la description.
export function extractSummary(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s*r[ée]sum[ée]\s*$/i.test(line.trim()));
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,6}\s/.test(line.trim()));
    const section = (end >= 0 ? rest.slice(0, end) : rest).join('\n').trim();
    if (section) return section;
  }
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^(versionCode|sha256|signature):/i.test(line))
    .slice(0, SUMMARY_FALLBACK_LINES)
    .join('\n');
}

// Renvoie null si la release ne suit pas le format : elle est alors ignorée, sans jamais bloquer l'app.
export function parseRelease(json: unknown): Release | null {
  if (!json || typeof json !== 'object') return null;
  const data = json as Record<string, unknown>;
  const tag = typeof data.tag_name === 'string' ? data.tag_name : null;
  const body = typeof data.body === 'string' ? data.body : '';
  const pageUrl = typeof data.html_url === 'string' ? data.html_url : null;
  if (!tag || !pageUrl || data.draft === true || data.prerelease === true) return null;

  const versionCode = parseVersionCode(body);
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const apk = assets.find(
    (asset): asset is { browser_download_url: string; size: number; name: string } =>
      !!asset &&
      typeof asset.name === 'string' &&
      asset.name.toLowerCase().endsWith('.apk') &&
      typeof asset.browser_download_url === 'string' &&
      typeof asset.size === 'number',
  );
  if (versionCode === null || !apk || !apk.browser_download_url.startsWith('https://')) return null;

  return {
    tag,
    version: tag.replace(/^v/i, ''),
    versionCode,
    sha256: parseSha256(body),
    signature: parseSignature(body),
    summary: extractSummary(body),
    pageUrl,
    apkUrl: apk.browser_download_url,
    apkSize: apk.size,
  };
}
