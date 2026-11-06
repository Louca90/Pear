import { ComponentRef } from 'react';
import { View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

import { BubblePalette } from '../../theme';

export type MetaTone = { text: string; muted: string };

export type Palettes = { mine: BubblePalette; theirs: BubblePalette; hasWallpaper: boolean };

export type Rect = { x: number; y: number; width: number; height: number };
export type ViewRef = ComponentRef<typeof View>;

export type Action = { label: string; icon: LucideIcon; onPress: () => void; danger?: boolean };
