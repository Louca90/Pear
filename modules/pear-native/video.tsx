import { ComponentType } from 'react';
import { ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

// Vidéo d'appel dans une vue ordinaire (Android TextureView) : coins arrondis réels, et dessinée dans
// l'ordre des vues (une vignette passe au-dessus de la grande image). radius en points.
export type PearVideoProps = ViewProps & { streamURL: string; mirror?: boolean; radius?: number };

export const PearVideoView = requireNativeView<PearVideoProps>('PearVideo') as ComponentType<PearVideoProps>;

// Durée de l'appel en cours, tenue par le système (Chronometer d'Android) : elle continue de compter dans la
// fenêtre flottante, écran verrouillé ou Pear en arrière-plan, sans minuteur JavaScript.
export type PearChronometerProps = ViewProps & { elapsedMs: number; color?: string };

export const PearChronometer = requireNativeView<PearChronometerProps>('PearChronometer') as ComponentType<PearChronometerProps>;
