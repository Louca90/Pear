import { useEffect, useId, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  LayoutAnimationConfig,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type EntryExitAnimationFunction,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { EASE } from '../motion';
import { fixed } from '../theme';

// La poire de Pear en vectoriel : nette à toutes les tailles (l'icône PNG se floute en grand).
// Même dessin que assets/icon.png : corps à deux lobes, tige et deux feuilles.
// C'est un logo qui s'anime, pas un personnage : aucun visage, aucun rebond.
// Tout bouge sur le fil natif (Reanimated). Passer d'un état à l'autre se fait en fondu croisé : la
// poire qui part s'agrandit un peu en s'effaçant, celle qui arrive se pose depuis 0,88.
const VIEW_BOX = '22 6 56 88';
const VB_X = 22;
const VB_Y = 6;
const VB_W = 56;
const VB_H = 88;
export const PEAR_RATIO = VB_W / VB_H;

const BODY = 'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z';
const RIGHT_LEAF = 'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z';
const LEFT_LEAF = 'M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z';
const LEAVES = `${RIGHT_LEAF} ${LEFT_LEAF}`;
const WHOLE = `${BODY} ${LEAVES}`;

// Point d'attache des feuilles (d'où elles poussent et autour duquel elles se balancent).
const LEAF_ORIGIN = { x: 50, y: 23 };
// Les trois bouchées, sur le bord droit du corps, du haut vers le bas.
const BITES = [
  { cx: 70, cy: 48, r: 9 },
  { cx: 74, cy: 66, r: 9 },
  { cx: 66, cy: 84, r: 9 },
];
const BITE_STEPS = [0.33, 0.66, 1];
// Hauteur du corps (y = 28 à 92) pour le niveau du mûrissement.
const BODY_TOP = 28;
const BODY_BOTTOM = 92;

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
const AnimatedPath = Reanimated.createAnimatedComponent(Path);

export type PearState = 'idle' | 'bitten' | 'ripening' | 'searching' | 'resting' | 'leaf';

type Props = {
  height: number;
  color: string;
  // `idle` : fixe. `bitten` : tirer pour actualiser, bouchées selon `progress`. `ripening` :
  // transfert, la poire se remplit comme un liquide selon `progress`. `searching` : pointillés qui
  // tournent et halo qui respire. `resting` : écrans vides, respiration et feuilles qui se balancent.
  // `leaf` : la feuille droite pousse, avec un halo bref.
  state?: PearState;
  // 0 à 1, pour `bitten` et `ripening`.
  progress?: number;
  // Couleur de la feuille qui pousse et du halo de `leaf`, `signatureStrong` en pratique.
  leafColor?: string;
};

// Appelée aussi depuis le fil natif (animations d'entrée et de sortie) : c'est un worklet.
function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

const LAYER_IN: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.88 }] },
    animations: { opacity: withTiming(1, config(260)), transform: [{ scale: withTiming(1, config(260)) }] },
  };
};

const LAYER_OUT: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, config(200)), transform: [{ scale: withTiming(1.1, config(200)) }] },
  };
};

type Size = { width: number; height: number };

// Coordonnées du dessin → points à l'écran.
const toPx = (size: Size, x: number, y: number) => ({ x: ((x - VB_X) / VB_W) * size.width, y: ((y - VB_Y) / VB_H) * size.height });

export function Pear({ height, color, state = 'idle', progress = 0, leafColor }: Props) {
  const size = { width: height * PEAR_RATIO, height };
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const clamped = Math.min(1, Math.max(0, progress));
  // idle, resting et bitten partagent le même dessin : les bouchées s'y referment sans fondu.
  const layer = state === 'idle' || state === 'resting' || state === 'bitten' ? 'base' : state;
  return (
    <View style={size}>
      <LayoutAnimationConfig skipEntering>
        <Reanimated.View key={layer} entering={LAYER_IN} exiting={LAYER_OUT} style={StyleSheet.absoluteFill}>
          {layer === 'base' && <BaseLayer size={size} color={color} state={state} progress={clamped} id={id} />}
          {layer === 'searching' && <SearchingLayer size={size} color={color} />}
          {layer === 'ripening' && <RipeningLayer size={size} color={color} progress={clamped} id={id} />}
          {layer === 'leaf' && <LeafLayer size={size} color={color} leafColor={leafColor ?? color} />}
        </Reanimated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

// Un halo flou (dégradé radial) derrière la poire, plus large qu'elle. `glow` de 0 à 1.
function Glow({ size, color, glow, strength = 0.5 }: { size: Size; color: string; glow: SharedValue<number>; strength?: number }) {
  const style = useAnimatedStyle(() => ({ opacity: glow.get() * strength }));
  const gradient = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const side = Math.max(size.width, size.height) * 1.6;
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: side, height: side, left: (size.width - side) / 2, top: (size.height - side) / 2 + size.height * 0.08 }, style]}
    >
      <Svg width={side} height={side} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={gradient} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.45" stopColor={color} stopOpacity={0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill={`url(#${gradient})`} />
      </Svg>
    </Reanimated.View>
  );
}

// Les deux feuilles dans leur propre calque, pour qu'elles se balancent autour de la tige.
function Leaves({ size, color, style }: { size: Size; color: string; style?: object }) {
  const origin = toPx(size, LEAF_ORIGIN.x, LEAF_ORIGIN.y);
  return (
    <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transformOrigin: `${origin.x}px ${origin.y}px` }, style]}>
      <Svg width={size.width} height={size.height} viewBox={VIEW_BOX}>
        <Path d={LEAVES} fill={color} />
      </Svg>
    </Reanimated.View>
  );
}

function BiteHole({ bite, value }: { bite: (typeof BITES)[number]; value: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ r: bite.r * value.get() }));
  return <AnimatedCircle cx={bite.cx} cy={bite.cy} r={0} fill={fixed.black} animatedProps={props} />;
}

// idle (fixe), resting (respire, feuilles qui se balancent) et bitten (bouchées une à une).
function BaseLayer({ size, color, state, progress, id }: { size: Size; color: string; state: PearState; progress: number; id: string }) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(1);
  const sway = useSharedValue(0);
  const bites = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const count = state === 'bitten' ? BITE_STEPS.filter((step) => progress >= step - 0.005).length : 0;
  const lastCount = useRef(0);

  useEffect(() => {
    if (state !== 'resting' || reduced) {
      cancelAnimation(sway);
      sway.set(withTiming(0, config(300)));
      if (state !== 'bitten') {
        cancelAnimation(breath);
        breath.set(withTiming(1, config(300)));
      }
      return;
    }
    // Respiration lente (1 → 1,03) et feuilles qui se balancent (± 5°), décalées l'une de l'autre.
    breath.set(withRepeat(withTiming(1.03, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true));
    sway.set(withSequence(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }), withRepeat(withTiming(-1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true)));
  }, [state, reduced]);

  useEffect(() => {
    // Chaque bouchée se creuse en 180 ms et la poire se tasse un instant ; au relâchement, la poire
    // se reforme en 420 ms.
    bites.forEach((value, index) => value.set(withTiming(index < count ? 1 : 0, config(index < count ? 180 : 420))));
    if (count > lastCount.current && !reduced) breath.set(withSequence(withTiming(0.95, config(90)), withTiming(1, config(200))));
    lastCount.current = count;
  }, [count]);

  const breathStyle = useAnimatedStyle(() => ({ transform: [{ scale: breath.get() }] }));
  const swayStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${sway.get() * 5}deg` }] }));
  const mask = `bites${id}`;
  return (
    <Reanimated.View style={[size, breathStyle]}>
      <Svg width={size.width} height={size.height} viewBox={VIEW_BOX}>
        <Defs>
          <Mask id={mask} maskUnits="userSpaceOnUse" x={VB_X} y={VB_Y} width={VB_W} height={VB_H}>
            <Rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill={fixed.white} />
            {BITES.map((bite, index) => (
              <BiteHole key={bite.cx} bite={bite} value={bites[index]} />
            ))}
          </Mask>
        </Defs>
        <Path d={BODY} fill={color} mask={`url(#${mask})`} />
      </Svg>
      <Leaves size={size} color={color} style={swayStyle} />
    </Reanimated.View>
  );
}

// Connexion en cours : le contour en pointillés tourne, les feuilles et un halo respirent.
function SearchingLayer({ size, color }: { size: Size; color: string }) {
  const reduced = useReducedMotion();
  const dash = useSharedValue(0);
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    if (reduced) return;
    // 11 = période du motif « 6 5 » : chaque tour revient exactement au point de départ.
    dash.set(withRepeat(withTiming(-11, { duration: 700, easing: Easing.linear }), -1, false));
    pulse.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => {
      cancelAnimation(dash);
      cancelAnimation(pulse);
    };
  }, [reduced]);
  const outline = useAnimatedProps(() => ({ strokeDashoffset: dash.get() }));
  const leaves = useAnimatedStyle(() => ({ opacity: 0.45 + pulse.get() * 0.55 }));
  return (
    <View style={size}>
      <Glow size={size} color={color} glow={pulse} strength={0.22} />
      <Svg width={size.width} height={size.height} viewBox={VIEW_BOX}>
        <AnimatedPath d={BODY} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="6 5" strokeLinecap="round" animatedProps={outline} />
      </Svg>
      <Leaves size={size} color={color} style={leaves} />
    </View>
  );
}

// La surface du liquide : une vague qui avance, à la hauteur `progress`. Plate tout en bas et tout en
// haut, pour que la poire vide et la poire pleine restent nettes.
function wavePath(progress: number, phase: number, shift: number) {
  'worklet';
  const top = BODY_TOP - 2;
  const bottom = BODY_BOTTOM + 2;
  const level = bottom - progress * (bottom - top);
  const amplitude = 2.4 * Math.min(1, progress * 6) * Math.min(1, (1 - progress) * 6);
  let d = `M ${VB_X} ${bottom}`;
  for (let x = VB_X; x <= VB_X + VB_W; x += 4) {
    const y = level + amplitude * Math.sin(((x - VB_X) / VB_W) * Math.PI * 3 + (phase + shift) * Math.PI * 2);
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return `${d} L ${VB_X + VB_W} ${bottom} Z`;
}

// Transfert : la poire se remplit comme un liquide (deux vagues décalées), les feuilles se colorent
// à la fin et un halo s'allume une fois pleine.
function RipeningLayer({ size, color, progress, id }: { size: Size; color: string; progress: number; id: string }) {
  const reduced = useReducedMotion();
  const level = useSharedValue(progress);
  const phase = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    level.set(withTiming(progress, config(320)));
    if (progress >= 1) glow.set(withSequence(withTiming(1, config(240)), withDelay(200, withTiming(0, config(700)))));
  }, [progress]);
  useEffect(() => {
    if (reduced) return;
    phase.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(phase);
  }, [reduced]);
  const front = useAnimatedProps(() => ({ d: wavePath(level.get(), phase.get(), 0) }));
  const back = useAnimatedProps(() => ({ d: wavePath(Math.min(1, level.get() + 0.03), phase.get(), 0.45) }));
  const leaves = useAnimatedStyle(() => ({ opacity: interpolate(level.get(), [0.85, 1], [0, 1], Extrapolation.CLAMP) }));
  const frontClip = `front${id}`;
  const backClip = `back${id}`;
  return (
    <View style={size}>
      <Glow size={size} color={color} glow={glow} strength={0.45} />
      <Svg width={size.width} height={size.height} viewBox={VIEW_BOX}>
        <Defs>
          <ClipPath id={backClip}>
            <AnimatedPath d={wavePath(progress, 0, 0.45)} animatedProps={back} />
          </ClipPath>
          <ClipPath id={frontClip}>
            <AnimatedPath d={wavePath(progress, 0, 0)} animatedProps={front} />
          </ClipPath>
        </Defs>
        <Path d={WHOLE} fill={color} opacity={0.22} />
        <Path d={BODY} fill={color} opacity={0.45} clipPath={`url(#${backClip})`} />
        <Path d={BODY} fill={color} clipPath={`url(#${frontClip})`} />
      </Svg>
      <Leaves size={size} color={color} style={leaves} />
    </View>
  );
}

// Vérifié : la feuille droite pousse en se dépliant, un halo de sa couleur s'allume puis s'éteint.
function LeafLayer({ size, color, leafColor }: { size: Size; color: string; leafColor: string }) {
  const grow = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    grow.set(withDelay(80, withTiming(1, config(520))));
    glow.set(withDelay(240, withSequence(withTiming(1, config(260)), withTiming(0, config(800)))));
  }, []);
  const origin = toPx(size, 52, 22);
  const leafStyle = useAnimatedStyle(() => ({
    opacity: grow.get() > 0 ? 1 : 0,
    transform: [{ rotate: `${(1 - grow.get()) * -35}deg` }, { scale: grow.get() }],
  }));
  return (
    <View style={size}>
      <Glow size={size} color={leafColor} glow={glow} strength={0.5} />
      <Svg width={size.width} height={size.height} viewBox={VIEW_BOX} style={styles.layer}>
        <Path d={`${BODY} ${LEFT_LEAF}`} fill={color} />
      </Svg>
      <Reanimated.View style={[styles.layer, { transformOrigin: `${origin.x}px ${origin.y}px` }, leafStyle]}>
        <Svg width={size.width} height={size.height} viewBox={VIEW_BOX}>
          <Path d={RIGHT_LEAF} fill={leafColor} />
        </Svg>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
