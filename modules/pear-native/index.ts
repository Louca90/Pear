import { AppState } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo';

export type BackEvent = { type: 'started' | 'progress' | 'cancelled' | 'invoked'; progress: number; fromRight: boolean };

declare class PearNativeModule extends NativeModule<{ onBack: (event: BackEvent) => void }> {
  burnOverlay(videoUri: string, overlayUri: string): Promise<string>;
  navigationBarHeight(): number | null;
  setBackMode(mode: 'system' | 'app' | 'default'): Promise<void>;
  completeBack(): Promise<void>;
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
