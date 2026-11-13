import Svg, { Path, Rect } from 'react-native-svg';

// Lecture et pause aux coins arrondis, dans la même famille que les autres icônes (jamais le triangle
// pointu). Choix de Louca du 13 nov. 2026.
const PLAY = 'M8 5.6v12.8a1.2 1.2 0 0 0 1.8 1.03l10.4-6.4a1.2 1.2 0 0 0 0-2.06L9.8 4.57A1.2 1.2 0 0 0 8 5.6Z';

export function PlayIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PLAY} fill={color} />
    </Svg>
  );
}

export function PauseIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={6} y={4.5} width={4} height={15} rx={1.4} fill={color} />
      <Rect x={14} y={4.5} width={4} height={15} rx={1.4} fill={color} />
    </Svg>
  );
}
