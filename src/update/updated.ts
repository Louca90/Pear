import { appVersionCode, appVersionName } from '../../modules/pear-native';
import { getSetting, setSetting } from '../chat/database';
import { LATEST_RELEASE_URL } from './updates';
import { parseRelease } from './release';
import notes from './release-notes.json';

// Le dernier versionCode pour lequel le popup « Pear est à jour ! » a été vu.
const LAST_SEEN_KEY = 'last_seen_version_code';
export const RELEASES_PAGE = 'https://github.com/Louca90/Pear/releases/tag/';

export type UpdatedInfo = { version: string; summary: string | null; pageUrl: string };

// Après une mise à jour, renvoie de quoi remplir le popup ; null s'il n'y a rien à montrer.
// Installation toute neuve : on retient la version sans rien afficher. Mais une identité déjà là
// sans version retenue, c'est le premier APK avec cette fonction installé par-dessus l'ancien.
export function pendingUpdatedInfo(identityExisted: boolean): UpdatedInfo | null {
  const installed = appVersionCode();
  if (installed === null) return null;
  const lastSeen = getSetting(LAST_SEEN_KEY);
  if (lastSeen === null && !identityExisted) {
    setSetting(LAST_SEEN_KEY, String(installed));
    return null;
  }
  if (lastSeen !== null && Number(lastSeen) >= installed) return null;
  const version = appVersionName() ?? notes.version;
  return {
    version,
    summary: notes.versionCode === installed ? notes.summary : null,
    pageUrl: `${RELEASES_PAGE}v${version}`,
  };
}

export function markUpdateSeen() {
  const installed = appVersionCode();
  if (installed !== null) setSetting(LAST_SEEN_KEY, String(installed));
}

// Résumé absent de l'APK : on tente la release publiée, sinon le popup n'affiche que la version et le lien.
export async function fetchSummary(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    const release = response.ok ? parseRelease(await response.json()) : null;
    return release && release.versionCode === appVersionCode() ? release.summary : null;
  } catch {
    return null;
  }
}
