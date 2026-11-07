import { Animated } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useColors } from '../theme';

// Icônes pleines de la barre du bas, dessinées à la main pour que leurs éléments bougent à l'intérieur
// (pas un simple agrandissement de l'icône). `kick` va de 0 à 1 à chaque sélection, sans rebond.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

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
        d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"
        fill={colors.text}
        stroke={colors.text}
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {[8, 12, 16].map((cx, index) => (
        <AnimatedCircle
          key={cx}
          cx={cx}
          cy={bump(kick, index * 0.18, index * 0.18 + 0.45, 12, 10.4)}
          r={bump(kick, index * 0.18, index * 0.18 + 0.45, 1.3, 1.7)}
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

// Deux personnes : celle de derrière sort de derrière la première, qui hoche la tête.
// Le contour de la personne de devant, couleur du rond, la détache de celle de derrière.
export function ContactsFilled({ size, kick }: IconProps) {
  const colors = useColors();
  const behind = kick.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0, -3.5, 0, 0], extrapolate: 'clamp' });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedG x={behind}>
        <Circle cx={16.5} cy={7.5} r={3.2} fill={colors.text} />
        <Path d="M13 21v-2.2a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4V21Z" fill={colors.text} />
      </AnimatedG>
      <G stroke={colors.elevatedActive} strokeWidth={1.75} fill={colors.text}>
        <AnimatedCircle cx={9} cy={bump(kick, 0.35, 0.85, 7, 5.8)} r={4} />
        <Path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2Z" strokeLinejoin="round" />
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
