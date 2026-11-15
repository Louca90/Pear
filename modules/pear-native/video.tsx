import { ComponentType } from 'react';
import { ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

// Vidéo d'appel dans une vue ordinaire (Android TextureView) : coins arrondis réels, et dessinée dans
// l'ordre des vues (une vignette passe au-dessus de la grande image). radius en points.
export type PearVideoProps = ViewProps & { streamURL: string; mirror?: boolean; radius?: number };

export const PearVideoView = requireNativeView<PearVideoProps>('PearVideo') as ComponentType<PearVideoProps>;
