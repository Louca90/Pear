import { StyleSheet, View } from 'react-native';
import Reanimated, { Extrapolation, interpolate, useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useColors } from '../theme';

// Icônes pleines de la barre du bas, dessinées à la main pour que leurs éléments bougent à l'intérieur
// (pas un simple agrandissement de l'icône). `kick` va de 0 à 1 à chaque sélection, sans rebond.
// Tout est calculé sur le fil natif (Reanimated) : rien ne saccade pendant un changement d'écran.
const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

type IconProps = { size: number; kick: SharedValue<number> };

// Une bosse douce entre `start` et `end` : from → to → from.
function bump(value: number, start: number, end: number, from: number, to: number) {
  'worklet';
  return interpolate(value, [0, start, (start + end) / 2, end, 1], [from, from, to, from, from], Extrapolation.CLAMP);
}

function TypingDot({ cx, index, kick, color }: { cx: number; index: number; kick: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => {
    const k = kick.get();
    return {
      // Apparition l'un après l'autre, puis une petite vague qui monte et redescend.
      r: interpolate(k, [0, 0.01, index * 0.12 + 0.02, index * 0.12 + 0.3, 1], [1.3, 0, 0, 1.3, 1.3], Extrapolation.CLAMP),
      cy: bump(k, 0.45 + index * 0.1, 0.8 + index * 0.1, 12, 10.6),
    };
  });
  return <AnimatedCircle cx={cx} cy={12} r={1.3} fill={color} animatedProps={props} />;
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
        <TypingDot key={cx} cx={cx} index={index} kick={kick} color={colors.elevatedActive} />
      ))}
    </Svg>
  );
}

// L'appareil photo : l'objectif se ferme puis se rouvre (l'obturateur), un reflet passe dessus.
export function CameraFilled({ size, kick }: IconProps) {
  const colors = useColors();
  const lens = useAnimatedProps(() => ({ r: bump(kick.get(), 0, 0.6, 3.5, 0.8) }));
  const glint = useAnimatedProps(() => ({ opacity: bump(kick.get(), 0.45, 1, 0, 1) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
        fill={colors.text}
        stroke={colors.text}
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      <AnimatedCircle cx={12} cy={13} r={3.5} fill={colors.elevatedActive} animatedProps={lens} />
      <AnimatedCircle cx={13.3} cy={11.7} r={0.7} fill={colors.text} opacity={0} animatedProps={glint} />
    </Svg>
  );
}

// Deux personnes pleines. Celle de derrière est un vrai aplat (plus de traits dont les bouts
// dépassaient) ; celle de devant est détourée par un liseré de la couleur du rond, pour que les deux
// silhouettes ne se mélangent pas. À la sélection, celle de derrière sort de derrière l'autre
// et celle de devant hoche la tête.
const FRONT_HEAD = { cx: 9, cy: 7.5, r: 4 };
const FRONT_BODY = 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2Z';
const BEHIND_HEAD = { cx: 16.5, cy: 8, r: 3.3 };
const BEHIND_BODY = 'M14 21v-2.6a3.9 3.9 0 0 1 3.9-3.9h.2a3.9 3.9 0 0 1 3.9 3.9V21Z';

export function ContactsFilled({ size, kick }: IconProps) {
  const colors = useColors();
  const unit = size / 24;
  // Glisse de 3 unités vers la droite et apparaît, dans la première moitié de l'animation.
  const behind = useAnimatedStyle(() => {
    const k = kick.get();
    return {
      opacity: interpolate(k, [0, 0.01, 0.1, 0.5], [1, 0, 0, 1], Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(k, [0, 0.01, 0.1, 0.55], [0, -3 * unit, -3 * unit, 0], Extrapolation.CLAMP) }],
    };
  });
  const nod = useAnimatedProps(() => ({ cy: bump(kick.get(), 0.4, 0.9, FRONT_HEAD.cy, FRONT_HEAD.cy - 1.2) }));
  const halo = useAnimatedProps(() => ({ cy: bump(kick.get(), 0.4, 0.9, FRONT_HEAD.cy, FRONT_HEAD.cy - 1.2) }));
  return (
    <View style={{ width: size, height: size }}>
      <Reanimated.View style={[StyleSheet.absoluteFill, behind]}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <G fill={colors.text}>
            <Circle {...BEHIND_HEAD} />
            <Path d={BEHIND_BODY} />
          </G>
        </Svg>
      </Reanimated.View>
      <Svg width={size} height={size} viewBox="0 0 24 24" style={StyleSheet.absoluteFill}>
        <G fill={colors.elevatedActive} stroke={colors.elevatedActive} strokeWidth={3} strokeLinejoin="round">
          <AnimatedCircle cx={FRONT_HEAD.cx} cy={FRONT_HEAD.cy} r={FRONT_HEAD.r} animatedProps={halo} />
          <Path d={FRONT_BODY} />
        </G>
        <G fill={colors.text} stroke={colors.text} strokeWidth={1} strokeLinejoin="round">
          <AnimatedCircle cx={FRONT_HEAD.cx} cy={FRONT_HEAD.cy} r={FRONT_HEAD.r} animatedProps={nod} />
          <Path d={FRONT_BODY} />
        </G>
      </Svg>
    </View>
  );
}

// Le cercle autour de la photo de profil, qui se dessine quand l'onglet est choisi.
export function ProfileRing({ size, draw }: { size: number; draw: SharedValue<number> }) {
  const colors = useColors();
  const r = size / 2 - 1;
  const length = 2 * Math.PI * r;
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - draw.get()) }));
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
        animatedProps={props}
      />
    </Svg>
  );
}
