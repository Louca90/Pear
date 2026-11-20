import Reanimated, { Extrapolation, interpolate, useAnimatedProps, type SharedValue } from 'react-native-reanimated';
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

// Le tracé exact de l'icône au repos (Users de Lucide), dans le même style : la personne de devant
// se remplit, celle de derrière garde ses deux traits, identiques au contour. À la sélection, ces
// deux traits se redessinent l'un après l'autre et la personne de devant hoche la tête.
const FRONT_HEAD = { cx: 9, cy: 7, r: 4 };
const FRONT_BODY = 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2Z';
const BEHIND_HEAD = 'M16 3.13a4 4 0 0 1 0 7.75';
const BEHIND_BODY = 'M22 21v-2a4 4 0 0 0-3-3.87';
// Longueurs un peu au-dessus des vraies (≈ 10,5 et ≈ 6,3).
const BEHIND_HEAD_LENGTH = 11;
const BEHIND_BODY_LENGTH = 7;

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

// Un trait qui se redessine entre `start` et `end`. Le trou du pointillé est plus long que le trait :
// effacé, il ne laisse aucun bout arrondi visible (c'étaient les petits points qui dépassaient).
function RedrawnStroke({ d, length, start, end, kick, color }: { d: string; length: number; start: number; end: number; kick: SharedValue<number>; color: string }) {
  const hidden = length + 1;
  const props = useAnimatedProps(() => ({
    strokeDashoffset: interpolate(kick.get(), [0, 0.01, start, end, 1], [0, hidden, hidden, 0, 0], Extrapolation.CLAMP),
  }));
  return (
    <AnimatedPath
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={`${length} ${length + 2}`}
      strokeDashoffset={0}
      animatedProps={props}
    />
  );
}

export function ContactsFilled({ size, kick }: IconProps) {
  const colors = useColors();
  const nod = useAnimatedProps(() => ({ cy: bump(kick.get(), 0.35, 0.85, FRONT_HEAD.cy, FRONT_HEAD.cy - 1.2) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <RedrawnStroke d={BEHIND_HEAD} length={BEHIND_HEAD_LENGTH} start={0.05} end={0.5} kick={kick} color={colors.text} />
      <RedrawnStroke d={BEHIND_BODY} length={BEHIND_BODY_LENGTH} start={0.3} end={0.75} kick={kick} color={colors.text} />
      <G fill={colors.text} stroke={colors.text} strokeWidth={1.75} strokeLinejoin="round">
        <AnimatedCircle cx={FRONT_HEAD.cx} cy={FRONT_HEAD.cy} r={FRONT_HEAD.r} animatedProps={nod} />
        <Path d={FRONT_BODY} />
      </G>
    </Svg>
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

// La carte dépliée : pleine, ses deux plis se tracent l'un après l'autre à chaque sélection.
const MAP_BODY = 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z';
const FOLD_LENGTH = 15;

function Fold({ d, start, end, kick, color }: { d: string; start: number; end: number; kick: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: FOLD_LENGTH * interpolate(kick.get(), [0, start, (start + end) / 2, end, 1], [0, 0, 1, 0, 0], Extrapolation.CLAMP) }));
  return <AnimatedPath d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeDasharray={`${FOLD_LENGTH} ${FOLD_LENGTH}`} animatedProps={props} />;
}

export function MapFilled({ size, kick }: IconProps) {
  const colors = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={MAP_BODY} fill={colors.text} stroke={colors.text} strokeWidth={1.75} strokeLinejoin="round" />
      <Fold d="M15 5.764v15" start={0.1} end={0.55} kick={kick} color={colors.elevated} />
      <Fold d="M9 3.236v15" start={0.3} end={0.75} kick={kick} color={colors.elevated} />
    </Svg>
  );
}
