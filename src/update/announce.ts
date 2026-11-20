// L'annonce d'une nouvelle version (push du topic « updates », envoyé par /api/announce) : la version à
// annoncer, ou null si le push est mal formé ou n'apporte rien de plus récent que la version installée.
const VERSION = /^\d+\.\d+\.\d+$/;

export function announcedVersion(data: { version?: unknown; versionCode?: unknown }, installedCode: number | null): string | null {
  const version = String(data.version ?? '');
  const versionCode = Number(data.versionCode);
  if (!VERSION.test(version) || !Number.isInteger(versionCode)) return null;
  return versionCode > (installedCode ?? 0) ? version : null;
}
