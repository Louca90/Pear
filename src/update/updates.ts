import { useSyncExternalStore } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import { addDownloadListener, appVersionCode, canRequestPackageInstalls, downloadFile, installApk, openUnknownAppSourcesSettings, sha256File } from '../../modules/pear-native';
import { parseRelease, Release } from './release';
import { log } from '../log';

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/Louca90/Pear/releases/latest';
// Au premier plan, GitHub n'est pas interrogé plus souvent que ça.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10000;

export type CheckStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'offline';
export type DownloadPhase = 'idle' | 'permission' | 'downloading' | 'verifying' | 'installing' | 'failed';

type UpdateState = {
  status: CheckStatus;
  release: Release | null;
  phase: DownloadPhase;
  // Entre 0 et 1 pendant le téléchargement.
  progress: number;
  error: string | null;
  // En debug, l'écran bloquant ne s'affiche que si on le demande, pour le tester.
  preview: boolean;
};

let state: UpdateState = { status: 'idle', release: null, phase: 'idle', progress: 0, error: null, preview: false };
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
  return current.status === 'available' && current.release !== null && (!__DEV__ || current.preview);
}

export function previewUpdateScreen(show: boolean) {
  set({ preview: show });
}

function installedVersionCode() {
  return appVersionCode() ?? 0;
}

// Hors ligne ou GitHub injoignable : rien n'est bloqué, on réessaiera plus tard.
export async function checkForUpdate(force = false) {
  if (state.status === 'checking') return;
  if (!force && Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = Date.now();
  set({ status: 'checking' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
    const release = response.ok ? parseRelease(await response.json()) : null;
    if (release && release.versionCode > installedVersionCode()) {
      set({ status: 'available', release });
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
    if (release.sha256) {
      set({ phase: 'verifying' });
      const hash = await sha256File(file.uri);
      if (hash !== release.sha256) {
        // Fichier abîmé ou modifié : on le supprime pour repartir de zéro au prochain essai.
        file.delete();
        throw new Error('Le fichier téléchargé ne correspond pas à la mise à jour publiée.');
      }
    }
    set({ phase: 'installing', progress: 1 });
    installApk(file.uri);
  } catch (e) {
    log.warn('mise à jour', e);
    set({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
  } finally {
    subscription.remove();
  }
}
