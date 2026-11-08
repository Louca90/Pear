import { AppState } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo';
import { log } from '../../src/log';
import { t } from '../../src/i18n';

export type BackEvent = { type: 'started' | 'progress' | 'cancelled' | 'invoked'; progress: number; fromRight: boolean };
export type DownloadProgress = { received: number; total: number };
export type Insets = { top: number; bottom: number };
// Les retouches d'une vidéo (lot 10). matrix : 4 × 4 par colonnes, appliquée à (R, G, B, 1).
export type VideoEdit = { overlayUri?: string; matrix?: number[]; startMs?: number; endMs?: number; mute?: boolean; speed?: number; bitrate: number };

export type SharedMedia = { uri: string; mime: string; size: number };

declare class PearNativeModule extends NativeModule<{ onBack: (event: BackEvent) => void; onDownloadProgress: (event: DownloadProgress) => void; onInsetsChange: (event: Insets) => void; onShare: () => void }> {
  takeSharedMedia?(): Promise<SharedMedia[]>;
  burnOverlay(videoUri: string, overlayUri: string, bitrate: number): Promise<string>;
  editVideo?(videoUri: string, edit: VideoEdit): Promise<string>;
  captureView?(tag: number, outputUri: string, scale: number): Promise<string>;
  navigationBarHeight(): number | null;
  systemInsets(): Insets | null;
  watchInsets(): Promise<void>;
  setBackMode(mode: 'system' | 'app' | 'default'): Promise<void>;
  completeBack(): Promise<void>;
  backHookAvailable(): boolean;
  appVersionCode(): number | null;
  appVersionName(): string | null;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  canRequestPackageInstalls(): boolean;
  openUnknownAppSourcesSettings(): boolean;
  downloadFile(url: string, fileUri: string): Promise<void>;
  sha256File(fileUri: string): Promise<string>;
  resizeImage(inputUri: string, outputUri: string, maxSize: number, quality: number): Promise<string>;
  installApk(fileUri: string): void;
  reloadApp(): Promise<void>;
  setScreenBrightness?(value: number): Promise<void>;
}

const PearNative = requireNativeModule<PearNativeModule>('PearNative');

export function setBackMode(mode: 'system' | 'app' | 'default') {
  return PearNative.setBackMode(mode);
}

// Faux si la lecture du retour de React Native par réflexion ne marche plus (après une mise à jour de RN).
export function backHookAvailable() {
  return PearNative.backHookAvailable();
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

export function isIgnoringBatteryOptimizations(): boolean {
  return PearNative.isIgnoringBatteryOptimizations();
}

// Fenêtre système pour passer la batterie de Pear en « sans restriction ».
export function requestIgnoreBatteryOptimizations() {
  return PearNative.requestIgnoreBatteryOptimizations();
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

// Réduit une image : plus grand côté maxSize pixels, JPEG de qualité quality (0 à 100).
export function resizeImage(inputUri: string, outputUri: string, maxSize: number, quality: number) {
  return PearNative.resizeImage(inputUri, outputUri, maxSize, quality);
}

export function sha256File(fileUri: string) {
  return PearNative.sha256File(fileUri);
}

// Ouvre l'installeur d'Android sur cet APK.
export function installApk(fileUri: string) {
  PearNative.installApk(fileUri);
}

// Incruste une image transparente dans toute la vidéo, sur le téléphone. Renvoie le nouveau fichier.
export function burnOverlay(videoUri: string, overlayUri: string, bitrate: number) {
  return PearNative.burnOverlay(videoUri, overlayUri, bitrate);
}

// Photos et vidéos partagées vers Pear depuis une autre app (lot 12), copiées dans le cache. Vide sinon.
export function takeSharedMedia(): Promise<SharedMedia[]> {
  return PearNative.takeSharedMedia ? PearNative.takeSharedMedia() : Promise.resolve([]);
}

// Un partage arrivé pendant que Pear est ouvert.
export function addShareListener(listener: () => void) {
  return PearNative.addListener('onShare', listener);
}

// Luminosité de l'écran (0 à 1, -1 = celle du téléphone). Sans effet sur un APK plus ancien.
export function setScreenBrightness(value: number) {
  return PearNative.setScreenBrightness?.(value) ?? Promise.resolve();
}

// Une vue dessinée dans une image PNG (calques de l'éditeur). Demande l'APK du lot 10.3.
export function captureView(tag: number, outputUri: string, scale: number): Promise<string> {
  if (!PearNative.captureView) return Promise.reject(new Error(t('editeur.majPourTextes')));
  return PearNative.captureView(tag, outputUri, scale);
}

// Un APK d'avant le lot 10 ne sait que poser le calque : les autres retouches sont alors ignorées.
export function editVideo(videoUri: string, edit: VideoEdit): Promise<string> {
  if (PearNative.editVideo) return PearNative.editVideo(videoUri, edit);
  log.warn('vidéo', 'APK sans editVideo : seul le calque est appliqué');
  return edit.overlayUri ? PearNative.burnOverlay(videoUri, edit.overlayUri, edit.bitrate) : Promise.resolve(videoUri);
}

// En attendant de pouvoir lire les vraies valeurs : la barre d'état courante et la barre à 3 boutons, la plus haute.
const INSETS_FALLBACK: Insets = { top: 24, bottom: 48 };
let insets: Insets = PearNative.systemInsets() ?? INSETS_FALLBACK;
const insetsListeners = new Set<() => void>();

function setInsets(next: Insets | null) {
  if (!next || (next.top === insets.top && next.bottom === insets.bottom)) return;
  insets = next;
  insetsListeners.forEach((listener) => listener());
}

// Le natif prévient à chaque changement (déverrouillage, passage des gestes aux boutons…). Au retour
// dans l'app, on relit aussi les valeurs, au cas où l'événement serait passé pendant l'arrière-plan.
PearNative.addListener('onInsetsChange', setInsets);
PearNative.watchInsets().catch((e) => log.warn('marges', e));
AppState.addEventListener('change', (state) => {
  if (state === 'active') setInsets(PearNative.systemInsets());
});

export function subscribeInsets(listener: () => void) {
  insetsListeners.add(listener);
  return () => {
    insetsListeners.delete(listener);
  };
}

export function getInsets() {
  return insets;
}

export function navigationBarHeight() {
  return insets.bottom;
}

// Recharge l'interface de Pear (après un changement de langue).
export function reloadApp() {
  return PearNative.reloadApp();
}
