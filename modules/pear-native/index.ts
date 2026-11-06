import { AppState } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo';

export type BackEvent = { type: 'started' | 'progress' | 'cancelled' | 'invoked'; progress: number; fromRight: boolean };
export type DownloadProgress = { received: number; total: number };

declare class PearNativeModule extends NativeModule<{ onBack: (event: BackEvent) => void; onDownloadProgress: (event: DownloadProgress) => void }> {
  burnOverlay(videoUri: string, overlayUri: string): Promise<string>;
  navigationBarHeight(): number | null;
  setBackMode(mode: 'system' | 'app' | 'default'): Promise<void>;
  completeBack(): Promise<void>;
  appVersionCode(): number | null;
  appVersionName(): string | null;
  canRequestPackageInstalls(): boolean;
  openUnknownAppSourcesSettings(): boolean;
  downloadFile(url: string, fileUri: string): Promise<void>;
  sha256File(fileUri: string): Promise<string>;
  installApk(fileUri: string): void;
}

const PearNative = requireNativeModule<PearNativeModule>('PearNative');

export function setBackMode(mode: 'system' | 'app' | 'default') {
  return PearNative.setBackMode(mode);
}

export function completeBack() {
  return PearNative.completeBack();
}

export function addBackListener(listener: (event: BackEvent) => void) {
  return PearNative.addListener('onBack', listener);
}

// Le versionCode de l'APK installé. null si l'app n'est pas encore prête.
export function appVersionCode() {
  return PearNative.appVersionCode();
}

export function appVersionName() {
  return PearNative.appVersionName();
}

export function canRequestPackageInstalls() {
  return PearNative.canRequestPackageInstalls();
}

// Ouvre le réglage « Installer des apps inconnues » de Pear.
export function openUnknownAppSourcesSettings() {
  return PearNative.openUnknownAppSourcesSettings();
}

// Télécharge dans fileUri en reprenant un fichier partiel. La progression arrive par addDownloadListener.
export function downloadFile(url: string, fileUri: string) {
  return PearNative.downloadFile(url, fileUri);
}

export function addDownloadListener(listener: (event: DownloadProgress) => void) {
  return PearNative.addListener('onDownloadProgress', listener);
}

export function sha256File(fileUri: string) {
  return PearNative.sha256File(fileUri);
}

// Ouvre l'installeur d'Android sur cet APK.
export function installApk(fileUri: string) {
  PearNative.installApk(fileUri);
}

// Incruste une image transparente dans toute la vidéo, sur le téléphone. Renvoie le nouveau fichier.
export function burnOverlay(videoUri: string, overlayUri: string) {
  return PearNative.burnOverlay(videoUri, overlayUri);
}

// En attendant de pouvoir lire la vraie valeur : la place de la barre à 3 boutons, la plus haute.
const NAVIGATION_BAR_FALLBACK = 48;
let navigationBar: number | null = null;

// La barre change si on passe des gestes aux boutons dans les réglages : on la relit au retour dans l'app.
AppState.addEventListener('change', () => {
  navigationBar = null;
});

export function navigationBarHeight() {
  navigationBar ??= PearNative.navigationBarHeight();
  return navigationBar ?? NAVIGATION_BAR_FALLBACK;
}
