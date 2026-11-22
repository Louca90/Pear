import { AppState } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo';
import { log } from '../../src/log';
import { t } from '../../src/i18n';

export type BackEvent = { type: 'started' | 'progress' | 'cancelled' | 'invoked'; progress: number; fromRight: boolean };
export type DownloadProgress = { received: number; total: number };
export type Insets = { top: number; bottom: number };
// Les retouches d'une vidéo (lot 10). matrix : 4 × 4 par colonnes, appliquée à (R, G, B, 1).
export type VideoEdit = { overlayUri?: string; matrix?: number[]; startMs?: number; endMs?: number; mute?: boolean; speed?: number; bitrate: number };

export type SharedMedia = { uri: string; mime: string; size: number; contact?: string };

declare class PearNativeModule extends NativeModule<{ onBack: (event: BackEvent) => void; onDownloadProgress: (event: DownloadProgress) => void; onInsetsChange: (event: Insets) => void; onShare: () => void; onHeadset: (event: { kind: Headset }) => void; onPip: (event: { active: boolean }) => void; onCallHangUp: () => void }> {
  takeSharedMedia?(): Promise<SharedMedia[]>;
  setShareShortcuts?(contacts: { key: string; name: string; photo?: string }[]): Promise<void>;
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
  batteryStatus?(): { level: number; charging: boolean } | null;
  lastKnownLocation?(): { latitude: number; longitude: number } | null;
  currentLocation?(timeoutMs: number): Promise<{ latitude: number; longitude: number } | null>;
  requestIgnoreBatteryOptimizations(): boolean;
  canRequestPackageInstalls(): boolean;
  openUnknownAppSourcesSettings(): boolean;
  canUseFullScreenIntent?(): boolean;
  openFullScreenIntentSettings?(): boolean;
  downloadFile(url: string, fileUri: string): Promise<void>;
  sha256File(fileUri: string): Promise<string>;
  resizeImage(inputUri: string, outputUri: string, maxSize: number, quality: number): Promise<string>;
  blurCover?(inputUri: string, outputUri: string, video: boolean): Promise<string>;
  installApk(fileUri: string): void;
  reloadApp(): Promise<void>;
  setScreenBrightness?(value: number): Promise<void>;
  imageSize?(uri: string): Promise<{ width: number; height: number }>;
  thumbnail?(id: string, video: boolean, size: number): Promise<string>;
  setSecureWindow?(enabled: boolean): Promise<void>;
  authenticate?(title: string): Promise<'ok' | 'cancelled' | 'unavailable'>;
  setIncognitoKeyboard?(tag: number): Promise<void>;
  cropImage?(inputUri: string, outputUri: string, rect: number[], rotation: number, maxSize: number, quality: number): Promise<string>;
  setCallAudio?(route: string): void;
  startRinging?(): void;
  stopRinging?(): void;
  showOverLock?(on: boolean): Promise<void>;
  callHeadset?(): string;
  callOutputs?(): CallOutput[];
  setCallOutput?(id: number): void;
  setCallPip?(enabled: boolean, width: number, height: number): Promise<void>;
  closeCallPip?(): Promise<void>;
  startCallService?(info: Record<string, string | number | boolean>): boolean | void;
  stopCallService?(): void;
  setVideoCorner?(tag: number, radius: number): Promise<boolean>;
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

// Niveau de la batterie. null avec un ancien APK.
export function batteryStatus(): { level: number; charging: boolean } | null {
  return PearNative.batteryStatus?.() ?? null;
}

// Dernière position connue, approximative. null sans autorisation ou avec un ancien APK.
export function lastKnownLocation(): { latitude: number; longitude: number } | null {
  return PearNative.lastKnownLocation?.() ?? null;
}

// La dernière position connue, sinon une position fraîche demandée au téléphone (au plus timeoutMs).
// Sur un téléphone où rien n'a encore demandé la position, Android n'en a aucune en mémoire.
export async function freshLocation(timeoutMs = 15000): Promise<{ latitude: number; longitude: number } | null> {
  const known = lastKnownLocation();
  if (known) return known;
  try {
    return (await PearNative.currentLocation?.(timeoutMs)) ?? null;
  } catch {
    return null;
  }
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
// Les notifications plein écran (appel entrant téléphone verrouillé) : autorisation spéciale d'Android 14+.
export function canUseFullScreenIntent(): boolean {
  return PearNative.canUseFullScreenIntent?.() ?? true;
}

export function openFullScreenIntentSettings() {
  return PearNative.openFullScreenIntentSettings?.() ?? false;
}

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
// Les contacts récents dans le menu Partager d'Android (lot 2.6).
export function setShareShortcuts(contacts: { key: string; name: string; photo?: string }[]) {
  return PearNative.setShareShortcuts?.(contacts) ?? Promise.resolve();
}

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

// Couverture floue d'une notification (lot 2.7) : null sur un APK plus ancien, la notification reste alors sans image.
export const blurCover = PearNative.blurCover ? (inputUri: string, outputUri: string, video: boolean) => PearNative.blurCover!(inputUri, outputUri, video) : null;

// Vignette de la galerie (MediaStore), mise en cache : null sur un APK plus ancien.
export const thumbnail = PearNative.thumbnail ? (id: string, video: boolean, size: number) => PearNative.thumbnail!(id, video, size) : null;

// Photo de profil : la taille vue (EXIF appliqué) et le recadrage natif, hors du fil de l'interface.
// Absents d'un APK plus ancien : null, l'appelant garde alors la photo entière.
export const nativeImageSize = PearNative.imageSize ? (uri: string) => PearNative.imageSize!(uri) : null;
export function cropImage(inputUri: string, outputUri: string, rect: { x: number; y: number; width: number; height: number }, rotation: number, maxSize: number, quality: number) {
  if (!PearNative.cropImage) return Promise.resolve(inputUri);
  return PearNative.cropImage(inputUri, outputUri, [rect.x, rect.y, rect.width, rect.height], rotation, maxSize, quality);
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

// Bloque les captures d'écran et l'aperçu des apps récentes. Sans effet sur un APK plus ancien.
export function setSecureWindow(enabled: boolean) {
  return PearNative.setSecureWindow?.(enabled) ?? Promise.resolve();
}

// Demande l'empreinte, le visage ou le code du téléphone. "unavailable" : aucun verrou réglé ou APK plus ancien.
export function authenticate(title: string): Promise<'ok' | 'cancelled' | 'unavailable'> {
  return PearNative.authenticate?.(title) ?? Promise.resolve('unavailable');
}

// Le clavier n'apprend pas ce qui s'écrit dans cette saisie (tag React de la vue).
export function setIncognitoKeyboard(tag: number) {
  return PearNative.setIncognitoKeyboard?.(tag) ?? Promise.resolve();
}

// Recharge l'interface de Pear (après un changement de langue).
export function reloadApp() {
  return PearNative.reloadApp();
}

// --- Appels (vague 5). Sans effet sur un APK plus ancien. ---

export type CallRoute = 'off' | 'earpiece' | 'speaker' | 'auto-earpiece' | 'auto-speaker';
// Une sortie audio disponible pendant l'appel (liste d'Android) ; name vide pour l'écouteur et le haut-parleur.
export type CallOutputType = 'earpiece' | 'speaker' | 'bluetooth' | 'wired' | 'usb';
export type CallOutput = { id: number; type: CallOutputType; name: string; active: boolean };
// Le casque qui remplace l'écouteur pendant un appel ; '' sans casque.
export type Headset = 'bluetooth' | 'wired' | '';

export function callHeadset(): Headset {
  const kind = PearNative.callHeadset?.();
  return kind === 'bluetooth' || kind === 'wired' ? kind : '';
}

// Les sorties audio disponibles, et laquelle est active.
export function callOutputs(): CallOutput[] {
  try {
    return PearNative.callOutputs?.() ?? [];
  } catch {
    return [];
  }
}

export function setCallOutput(id: number) {
  PearNative.setCallOutput?.(id);
}

// Un casque arrive ou part pendant l'appel (le son y bascule tout seul).
export function addHeadsetListener(listener: (kind: Headset) => void) {
  return PearNative.addListener('onHeadset', (event) => listener(event.kind));
}

// Son de l'appel : écouteur (écran éteint contre l'oreille, un casque passe avant), haut-parleur, ou fin d'appel.
export function setCallAudio(route: CallRoute) {
  PearNative.setCallAudio?.(route);
}

// Sonnerie du téléphone en boucle, avec vibration ; rien en mode silencieux, vibration seule en vibreur.
export function startRinging() {
  PearNative.startRinging?.();
}

export function stopRinging() {
  PearNative.stopRinging?.();
}

// L'écran de l'appel passe par-dessus le verrouillage du téléphone et l'allume.
export function showOverLock(on: boolean) {
  return PearNative.showOverLock?.(on) ?? Promise.resolve();
}

// Fenêtre flottante de l'appel (Android 12 et plus) : quitter Pear pendant l'appel l'ouvre, au format donné.
export function setCallPip(enabled: boolean, width = 9, height = 16) {
  return PearNative.setCallPip?.(enabled, width, height) ?? Promise.resolve();
}

// Ferme la fenêtre flottante (fin de l'appel).
export function closeCallPip() {
  return PearNative.closeCallPip?.() ?? Promise.resolve();
}

// Pear passe dans la fenêtre flottante, ou en sort.
export function addPipListener(listener: (active: boolean) => void) {
  return PearNative.addListener('onPip', (event) => listener(event.active));
}

export type CallServiceInfo = { name: string; photo: string; video: boolean; startedAt: number; text: string; channelName: string; hangUpLabel: string };

// Notification de l'appel en cours au format appel d'Android (Now Bar de Samsung) ; false avec un ancien
// APK, ou si Android refuse de lancer le service (un APK d'avant la 1.9.1 ne renvoie rien : lancé).
export function startCallService(info: CallServiceInfo) {
  if (!PearNative.startCallService) return false;
  return PearNative.startCallService(info) !== false;
}

export function stopCallService() {
  PearNative.stopCallService?.();
}

// Raccrocher depuis la notification ou la Now Bar.
export function addCallHangUpListener(listener: () => void) {
  return PearNative.addListener('onCallHangUp', listener);
}

// Arrondit les coins d'une vidéo RTCView (tag React de la vue), en points.
export function setVideoCorner(tag: number, radius: number) {
  return PearNative.setVideoCorner?.(tag, radius) ?? Promise.resolve(false);
}
