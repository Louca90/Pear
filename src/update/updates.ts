import { useSyncExternalStore } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import { addDownloadListener, appVersionCode, canRequestPackageInstalls, downloadFile, installApk, openUnknownAppSourcesSettings, sha256File } from '../../modules/pear-native';
import { isReleaseSigned, parseRelease, Release } from './release';
import { log } from '../log';
import { t } from '../i18n';
import { LATEST_RELEASE_URL, RELEASES_LIST_URL, REMOTE_CONFIG_PUBLIC_KEY, UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_TIMEOUT_MS } from '../config';
import { getSetting, setSetting } from '../chat/database';
import { chooseRelease } from './channel';

export { LATEST_RELEASE_URL };

// Après ce nombre d'échecs d'installation de suite, l'écran propose « Continuer pour cette fois ».
export const MAX_INSTALL_FAILURES = 3;

export type CheckStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'offline';
export type DownloadPhase = 'idle' | 'permission' | 'downloading' | 'verifying' | 'installing' | 'failed';

type UpdateState = {
  status: CheckStatus;
  release: Release | null;
  phase: DownloadPhase;
  // Entre 0 et 1 pendant le téléchargement.
  progress: number;
  error: string | null;
  // Échecs d'installation de suite pour cette version, et « Continuer pour cette fois » (jusqu'au prochain lancement).
  failures: number;
  skipped: boolean;
  // En debug, l'écran bloquant ne s'affiche que si on le demande, pour le tester.
  preview: boolean;
  // Une version de test ne bloque jamais : elle s'installe seulement si on la choisit.
  testAccepted: boolean;
};

let state: UpdateState = { status: 'idle', release: null, phase: 'idle', progress: 0, error: null, failures: 0, skipped: false, preview: false, testAccepted: false };
let lastCheck = 0;
const listeners = new Set<() => void>();

function set(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateState() {
  return useSyncExternalStore(subscribe, () => state);
}

// Bloque l'app tant que la mise à jour n'est pas installée. Jamais en debug, sauf aperçu demandé.
export function isBlocking(current: UpdateState) {
  return current.status === 'available' && current.release !== null && !current.skipped && (!current.release.prerelease || current.testAccepted) && (!__DEV__ || current.preview);
}

export function canSkipUpdate(current: UpdateState) {
  return current.failures >= MAX_INSTALL_FAILURES;
}

export function skipUpdateOnce() {
  if (canSkipUpdate(state)) set({ skipped: true });
}

export function previewUpdateScreen(show: boolean) {
  set({ preview: show });
}

// Programme testeur (désactivé par défaut) : recevoir aussi les versions de test.
export function testerEnabled() {
  return getSetting('tester_program') === '1';
}

export function setTesterEnabled(on: boolean) {
  setSetting('tester_program', on ? '1' : null);
  set({ testAccepted: false });
  checkForUpdate(true).catch(() => undefined);
}

// Installer la version de test proposée : seul ce choix la fait passer à l'écran d'installation.
export function acceptTestUpdate() {
  if (state.release?.prerelease) {
    setSetting('tester_installed', String(state.release.versionCode));
    set({ testAccepted: true });
  }
}

// L'app installée est-elle une version de test ?
export function isTestBuild() {
  return getSetting('tester_installed') === String(appVersionCode() ?? -1);
}

function installedVersionCode() {
  return appVersionCode() ?? 0;
}

// Hors ligne ou GitHub injoignable : rien n'est bloqué, on réessaiera plus tard.
export async function checkForUpdate(force = false) {
  if (state.status === 'checking') return;
  if (!force && Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastCheck = Date.now();
  set({ status: 'checking' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const tester = testerEnabled();
    const response = await fetch(tester ? RELEASES_LIST_URL : LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
    let release: Release | null = null;
    if (response.ok) {
      const json = await response.json();
      if (tester && Array.isArray(json)) {
        // Programme testeur : la stable et la version de test, la stable plus récente passe devant.
        const all = json.map((item) => parseRelease(item, { allowPrerelease: true })).filter((item): item is Release => item !== null);
        release = chooseRelease(all, installedVersionCode(), true, REMOTE_CONFIG_PUBLIC_KEY);
      } else {
        const parsed = parseRelease(json);
        if (parsed && !isReleaseSigned(parsed, REMOTE_CONFIG_PUBLIC_KEY)) log.warn('mise à jour', 'release ignorée : signature absente ou fausse');
        else release = parsed;
      }
    }
    if (release && release.versionCode > installedVersionCode()) {
      set({ status: 'available', release, ...(state.release?.versionCode === release.versionCode ? {} : { failures: 0, skipped: false, testAccepted: false }) });
    } else {
      set({ status: 'upToDate', release });
      cleanupDownloads();
    }
  } catch (e) {
    log.warn('mise à jour', e);
    set({ status: 'offline' });
  } finally {
    clearTimeout(timeout);
  }
}

function updatesDirectory() {
  return new Directory(Paths.cache, 'updates');
}

function cleanupDownloads() {
  try {
    const directory = updatesDirectory();
    if (directory.exists) directory.delete();
  } catch (e) {
    log.warn('mise à jour', e);
  }
}

export function getInstallPermission() {
  return canRequestPackageInstalls();
}

// Ouvre le réglage d'Android. L'écran relance startUpdate au retour dans l'app.
export function requestInstallPermission() {
  openUnknownAppSourcesSettings();
}

// Le rejet d'une fonction native arrive sous la forme « Call to function … Caused by: … » : on montre
// une phrase compréhensible à la place.
function readableError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const code = /refusé \((\d{3})\)/.exec(message)?.[1];
  if (code && Number(code) >= 500) return t('maj.serveurIndisponible');
  if (code) return `${t('maj.connexionCoupee')} (${code})`;
  if (/Call to function|IOException|SocketTimeout|UnknownHost|Reprise/.test(message)) return t('maj.connexionCoupee');
  return message;
}

// Télécharge (en reprenant un fichier partiel), vérifie l'empreinte publiée, puis ouvre l'installeur.
export async function startUpdate() {
  const release = state.release;
  if (!release || state.phase === 'downloading' || state.phase === 'verifying') return;
  if (!canRequestPackageInstalls()) {
    set({ phase: 'permission', error: null });
    return;
  }
  const directory = updatesDirectory();
  if (!directory.exists) directory.create({ intermediates: true });
  const file = new File(directory, `pear-${release.versionCode}.apk`);
  const subscription = addDownloadListener(({ received, total }) => {
    set({ progress: total > 0 ? Math.min(1, received / total) : 0 });
  });
  try {
    if (!file.exists || file.size !== release.apkSize) {
      set({ phase: 'downloading', progress: file.exists ? file.size / release.apkSize : 0, error: null });
      await downloadFile(release.apkUrl, file.uri);
    }
    // L'empreinte est signée (isReleaseSigned) : un fichier qui ne la respecte pas n'est jamais installé.
    set({ phase: 'verifying' });
    const hash = await sha256File(file.uri);
    if (hash !== release.sha256) {
      // Fichier abîmé ou modifié : on le supprime pour repartir de zéro au prochain essai.
      file.delete();
      throw new Error(t('maj.fichierAbime'));
    }
    set({ phase: 'installing', progress: 1 });
    installApk(file.uri);
  } catch (e) {
    log.warn('mise à jour', e);
    set({ phase: 'failed', error: readableError(e), failures: state.failures + 1 });
  } finally {
    subscription.remove();
  }
}
