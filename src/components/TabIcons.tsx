import { Animated } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useColors } from '../theme';

// Icônes pleines de la barre du bas, dessinées à la main pour que leurs éléments bougent à l'intérieur
// (pas un simple agrandissement de l'icône). `kick` va de 0 à 1 à chaque sélection, sans rebond.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

type IconProps = { size: number; kick: Animated.Value };

// Une bosse douce entre `start` et `end` : 0 → 1 → 0.
function bump(kick: Animated.Value, start: number, end: number, from: number, to: number) {
  const middle = (start + end) / 2;
  return kick.interpolate({ inputRange: [0, start, middle, end, 1], outputRange: [from, from, to, from, from], extrapolate: 'clamp' });
}

// La bulle : ses trois points s'écrivent l'un après l'autre, comme quelqu'un qui tape.
export function MessagesFilled({ size, kick }: IconProps) {
  const colors = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719Z"
        fill={colors.text}
        stroke={colors.text}
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {[8, 12, 16].map((cx, index) => (
        <AnimatedCircle
          key={cx}
          cx={cx}
          // Apparition l'un après l'autre (0 → 1,3), puis une petite vague qui monte et redescend.
          r={kick.interpolate({ inputRange: [0, 0.01, index * 0.12 + 0.02, index * 0.12 + 0.3, 1], outputRange: [1.3, 0, 0, 1.3, 1.3], extrapolate: 'clamp' })}
          cy={bump(kick, 0.45 + index * 0.1, 0.8 + index * 0.1, 12, 10.6)}
          fill={colors.elevatedActive}
        />
      ))}
    </Svg>
  );
}

// L'appareil photo : l'objectif se ferme puis se rouvre (l'obturateur), un reflet passe dessus.
export function CameraFilled({ size, kick }: IconProps) {
  const colors = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
        fill={colors.text}
        stroke={colors.text}
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      <AnimatedCircle cx={12} cy={13} r={bump(kick, 0, 0.6, 3.5, 0.8)} fill={colors.elevatedActive} />
      <AnimatedCircle cx={13.3} cy={11.7} r={0.7} fill={colors.text} opacity={bump(kick, 0.45, 1, 0, 1)} />
    </Svg>
  );
}

// Le tracé exact de l'icône au repos (Users de Lucide) : la personne de devant se remplit et hoche
// la tête, celle de derrière garde ses deux traits, qui se redessinent l'un après l'autre.
const BEHIND_HEAD = 'M16 3.13a4 4 0 0 1 0 7.75';
const BEHIND_BODY = 'M22 21v-2a4 4 0 0 0-3-3.87';
const BEHIND_HEAD_LENGTH = 12.5;
const BEHIND_BODY_LENGTH = 7;

export function ContactsFilled({ size, kick }: IconProps) {
  const colors = useColors();
  // Effacé dès le départ, puis redessiné : la tête de 0,05 à 0,5, le corps de 0,3 à 0,75.
  const drawn = (length: number, start: number, end: number) =>
    kick.interpolate({ inputRange: [0, 0.01, start, end, 1], outputRange: [0, length, length, 0, 0], extrapolate: 'clamp' });
  const behind = { fill: 'none', stroke: colors.text, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedPath d={BEHIND_HEAD} {...behind} strokeDasharray={`${BEHIND_HEAD_LENGTH} ${BEHIND_HEAD_LENGTH}`} strokeDashoffset={drawn(BEHIND_HEAD_LENGTH, 0.05, 0.5)} />
      <AnimatedPath d={BEHIND_BODY} {...behind} strokeDasharray={`${BEHIND_BODY_LENGTH} ${BEHIND_BODY_LENGTH}`} strokeDashoffset={drawn(BEHIND_BODY_LENGTH, 0.3, 0.75)} />
      <G fill={colors.text} stroke={colors.text} strokeWidth={1.75} strokeLinejoin="round">
        <AnimatedCircle cx={9} cy={bump(kick, 0.35, 0.85, 7, 5.8)} r={4} />
        <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2Z" />
      </G>
    </Svg>
  );
}

// Le cercle autour de la photo de profil, qui se dessine quand l'onglet est choisi.
export function ProfileRing({ size, draw }: { size: number; draw: Animated.Value }) {
  const colors = useColors();
  const r = size / 2 - 1;
  const length = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={colors.text}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${length} ${length}`}
        strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [length, 0] })}
      />
    </Svg>
  );
}
