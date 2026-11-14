import type { ComponentType } from 'react';
import type { AnimatedIconProps } from '../../components/AnimatedIcons';
import { ComponentRef } from 'react';
import { View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

import { BubblePalette } from '../../theme';

export type MetaTone = { text: string; muted: string };

export type Palettes = { mine: BubblePalette; theirs: BubblePalette; hasWallpaper: boolean };

export type Rect = { x: number; y: number; width: number; height: number };
export type ViewRef = ComponentRef<typeof View>;

// animated : l'icône animée de la planche Icônes, qui joue son geste à l'ouverture de la sélection.
export type Action = { label: string; icon: LucideIcon; animated?: ComponentType<AnimatedIconProps>; onPress: () => void; danger?: boolean };
