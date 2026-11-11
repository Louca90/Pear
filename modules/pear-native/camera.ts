import type { ComponentType, Ref } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';

// L'appareil photo de Pear, directement sur CameraX (PearCameraView.kt). expo-camera ne sert plus qu'au
// scanner de QR code et aux autorisations.

export type Lens = { id: string; facing: 'back' | 'front'; fieldOfView: number; minZoom: number; maxZoom: number };
export type CameraReady = { minZoom: number; maxZoom: number };
export type CapturedPhoto = { uri: string; width: number; height: number };

export type PearCameraHandle = {
  takePicture(maxSize: number, quality: number): Promise<CapturedPhoto>;
  // Se résout avec le fichier quand la vidéo s'arrête (stopRecording), même après un changement de caméra.
  startRecording(): Promise<string>;
  stopRecording(): Promise<void>;
  // Zoom envoyé directement au natif (geste), sans repasser par React.
  setZoom(zoom: number): Promise<void>;
};

export type PearCameraProps = ViewProps & {
  facing: 'back' | 'front';
  cameraId?: string | null;
  zoom: number;
  torch: boolean;
  flash: boolean;
  mute: boolean;
  videoBitrate: number;
  active?: boolean;
  onReady?: (event: NativeSyntheticEvent<CameraReady>) => void;
  onFrame?: (event: NativeSyntheticEvent<{ ms: number }>) => void;
  onCameraError?: (event: NativeSyntheticEvent<{ message: string }>) => void;
  ref?: Ref<PearCameraHandle>;
};

const PearCamera = requireNativeModule<{ lenses(): Lens[]; hasLastFrame(): boolean }>('PearCamera');

export const PearCameraView = requireNativeView<PearCameraProps>('PearCamera') as ComponentType<PearCameraProps>;

// Une image de la fois d'avant est gardée côté natif : l'aperçu peut s'afficher floue tout de suite.
export function hasLastCameraFrame(): boolean {
  try {
    return PearCamera.hasLastFrame();
  } catch {
    return false;
  }
}

// Le bouton grand-angle : sur une caméra multiple (S24), un simple zoom sous ×1 ; sinon, s'il existe,
// l'objectif ultra grand-angle séparé (A33), dont on montre le rapport d'angle avec la caméra principale.
export type WideLens = { zoom: number; cameraId: string | null; label: number };

let cached: WideLens | null | undefined;

export function wideLens(): WideLens | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const backs = PearCamera.lenses().filter((lens) => lens.facing === 'back');
    const main = backs[0];
    if (main && main.minZoom < 0.95) {
      cached = { zoom: main.minZoom, cameraId: null, label: Math.round(main.minZoom * 10) / 10 };
    } else if (main) {
      const wider = backs.filter((lens) => lens.id !== main.id && lens.fieldOfView > main.fieldOfView * 1.25).sort((a, b) => b.fieldOfView - a.fieldOfView)[0];
      if (wider) cached = { zoom: 1, cameraId: wider.id, label: Math.round((main.fieldOfView / wider.fieldOfView) * 10) / 10 };
    }
  } catch {
    cached = null;
  }
  return cached;
}
