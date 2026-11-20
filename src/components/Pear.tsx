import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, ClipPath, Defs, G, Mask, Path, Rect } from 'react-native-svg';

import { fixed, useColors } from '../theme';

// L'icône « Pépins » : une poire coupée en deux, peau verte, chair pâle, deux pépins reliés par un lien
// en pointillés (la connexion pair à pair). C'est un logo qui s'anime, pas un personnage : aucun visage,
// aucun rebond (tous les ressorts sont amortis à fond). Chaque propriété est une valeur animée qui part de
// sa valeur ACTUELLE : changer d'état en plein milieu d'une transition repart de là, sans saut. Tout
// bouge sur le fil natif (Reanimated), jamais de setState par image.
const VB_X = 12;
const VB_Y = 4;
const VB_W = 76;
const VB_H = 92;
const VIEW_BOX = `${VB_X} ${VB_Y} ${VB_W} ${VB_H}`;
export const PEAR_RATIO = VB_W / VB_H;

const BODY = 'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z';
const STEM = 'M50 22.5 L50 29';
const RIGHT_LEAF = 'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z';
const LEFT_LEAF = 'M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z';
const LEAF_ORIGIN = { x: 50, y: 23 };
const BODY_TOP = 28;
const BODY_BOTTOM = 92;
const SKIN_WIDTH = 7;
// Les trois bouchées (rayon 9) sur le bord droit.
const BITES = [
  { cx: 70, cy: 48 },
  { cx: 74, cy: 66 },
  { cx: 66, cy: 84 },
];
const BITE_R = 9;
const BITE_STEPS = [0.33, 0.66, 1];
// Le lien : courbe entre les deux pépins (centrés en 50 ± 9, 70), point de contrôle en haut.
const SEED_Y = 70;
const SEED_HALF = 9;
const LINK_TOP = 62;
const SEED_RX = 4.2;
const SEED_RY = 6.4;
const DOT_PERIOD = 3.4;

// Couleurs de l'état « Inactif ».
const REST = { skin: '#C9CCC2', flesh: '#ECEDE8', ink: '#8E8E93' };
const FLESH = '#F1F6DE';
const SEED_GREEN = '#7E9A3A';

export type PearState = 'idle' | 'bitten' | 'ripening' | 'searching' | 'resting' | 'leaf';

type Props = {
  height: number;
  // Tige et feuilles (noir en clair, clair en sombre, ou la couleur d'un fond coloré).
  color: string;
  // idle : normal. resting : écrans vides (respire). searching : connexion (pointillés qui tournent).
  // ripening : envoi, la poire se remplit selon `progress`. bitten : tirer pour actualiser, bouchées
  // selon `progress`. leaf : vérifié (la feuille droite repousse).
  state?: PearState;
  // 0 à 1, pour `bitten` et `ripening`.
  progress?: number;
  // Couleur de la feuille qui repousse (`leaf`), `signatureStrong` en pratique.
  leafColor?: string;
};

// Les ressorts de la planche « Icône Pépins » (raideur, amortissement) : défaut 170/26, doux 90/19, lent 55/15,
// couleurs 140/24, rebond léger 260/17 (pépins, feuille, bouchées, lien), tressaillement 300/14.
type Spring = readonly [number, number];
function spring([stiffness, damping]: Spring) {
  'worklet';
  return { stiffness, damping, mass: 1, reduceMotion: ReduceMotion.System };
}
const SP = { base: [170, 26], soft: [90, 19], slow: [55, 15], color: [140, 24], nudge: [260, 17], shake: [300, 14] } as const;

type Targets = {
  rest: number; // 0 normal, 1 inactif (couleurs)
  body: number; // opacité du corps
  outline: number; // contour en pointillés
  level: number; // niveau du liquide
  link: number; // longueur du lien (0 à 1)
  linkOpacity: number;
  gap: number; // écart des pépins
  seed: number; // taille des pépins
  thick: number; // épaisseur du lien
  searchW: number; // 1 pendant la recherche
  ripen: number; // 1 pendant l'envoi (graine qui circule)
  leafGreen: number;
};

function targets(state: PearState, progress: number): Targets {
  const base: Targets = { rest: 0, body: 1, outline: 0, level: 1, link: 1, linkOpacity: 1, gap: 1, seed: 1, thick: 2.1, searchW: 0, ripen: 0, leafGreen: 0 };
  switch (state) {
    case 'resting':
      return { ...base, rest: 1, link: 0, linkOpacity: 0, gap: 1.32, seed: 0.86 };
    case 'searching':
      return { ...base, body: 0.14, outline: 1, level: 1, link: 0.5, searchW: 1 };
    case 'ripening':
      return { ...base, level: progress, ripen: 1 };
    case 'leaf':
      return { ...base, gap: 0.74, seed: 1.08, thick: 2.7, leafGreen: 1 };
    default:
      return base;
  }
}

// Qui bouge en premier : les délais (ms) de chaque famille de propriétés selon le passage de `from` à `to`.
function plan(from: PearState, to: PearState) {
  const d = { level: 0, color: 0, outline: 0, body: 0, seeds: 0, link: 0, leaf: 0 };
  if (from === 'ripening') {
    // Le liquide finit de monter (ou se vide) avant le reste.
    d.color = d.outline = d.body = d.seeds = d.link = d.leaf = 340;
  }
  if (from === 'searching') {
    // Les pointillés se ressoudent avant que la poire se remplisse ou change.
    d.level = d.color = d.seeds = d.link = d.leaf = 160;
  }
  if (from === 'resting') {
    // La couleur revient d'abord, puis les pépins se rapprochent.
    d.seeds = d.link = d.leaf = 200;
  }
  if (to === 'leaf') d.leaf = Math.max(d.leaf, 120);
  return d;
}

// Un pépin : une ellipse inclinée, dessinée en polygone pour suivre son écart et sa taille sur le fil natif.
function seedPath(cx: number, tilt: number, scale: number) {
  'worklet';
  const rx = SEED_RX * scale;
  const ry = SEED_RY * scale;
  const cos = Math.cos((tilt * Math.PI) / 180);
  const sin = Math.sin((tilt * Math.PI) / 180);
  let d = '';
  for (let i = 0; i < 20; i += 1) {
    const a = (i / 20) * Math.PI * 2;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${(cx + x * cos - y * sin).toFixed(2)} ${(SEED_Y + x * sin + y * cos).toFixed(2)} `;
  }
  return `${d}Z`;
}

// La surface du liquide : une vague qui avance, à la hauteur `level`. Plate en bas et en haut.
// Le liquide : une vague fixe et répétée, dessinée une seule fois (ligne de base à y = 0, pleine vers le bas).
// On ne fait que la déplacer : horizontalement d'une longueur d'onde en boucle (la vague avance), verticalement
// selon le niveau (c'est le dessous qui monte). Le détourage ne change jamais de forme : Android n'a rien à
// reconstruire, et tout bouge sur le fil natif, sans à-coup.
const WAVE_LENGTH = (VB_W * 2) / 3;
// `matrix` est la prop native des groupes de react-native-svg (non typée côté TypeScript).
type NativeG = { opacity?: number };
const WAVE_AMPLITUDE = 2.4;
function staticWave(shift: number) {
  const from = VB_X - WAVE_LENGTH * 2;
  const to = VB_X + VB_W + WAVE_LENGTH * 2;
  let d = `M ${from} 200`;
  for (let x = from; x <= to; x += 2) {
    const y = WAVE_AMPLITUDE * Math.sin(((x - VB_X) / WAVE_LENGTH) * Math.PI * 2 + shift * Math.PI * 2);
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return `${d} L ${to} 200 Z`;
}
const WAVE_FRONT = staticWave(0);
const WAVE_BACK = staticWave(0.45);
// La hauteur de la ligne de base pour un niveau de 0 (vide) à 1 (plein), crêtes comprises.
function liquidY(level: number) {
  'worklet';
  const top = BODY_TOP - WAVE_AMPLITUDE - 1;
  const bottom = BODY_BOTTOM + WAVE_AMPLITUDE + 1;
  return bottom - Math.max(0, Math.min(1, level)) * (bottom - top);
}


const AnimatedPath = Reanimated.createAnimatedComponent(Path);
const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
const AnimatedG = Reanimated.createAnimatedComponent(G);

export function Pear({ height, color, state = 'idle', progress = 0, leafColor }: Props) {
  const colors = useColors();
  // Deux versions, choisies par le mode (planche « Nouvelle icône de l'app ») : la peau prend le vert
  // signature du mode (#9DB84A en clair, #B4CC68 en sombre), la chair reste pâle et les pépins noirs dessus ;
  // la tige, les feuilles et ce qui n'est pas sur la chair prennent la couleur de texte du mode (`color`).
  const ink = color;
  const reduced = useReducedMotion();
  const width = height * PEAR_RATIO;
  const clamped = Math.min(1, Math.max(0, progress));
  // Sous ~20 points, les pointillés et la peau fine disparaîtraient : lien plein, peau plus épaisse.
  const small = height < 20;
  const id = useRef(`p${Math.random().toString(36).slice(2, 8)}`).current;

  // Une valeur animée par propriété.
  const rest = useSharedValue(0);
  const body = useSharedValue(1);
  const outline = useSharedValue(0);
  // L'écart entre les pointillés du contour : 0 (trait plein) à 5 (« 6 5 ») ; le contour se casse puis se ressoude.
  const gapLine = useSharedValue(0);
  const level = useSharedValue(state === 'ripening' ? clamped : 1);
  const link = useSharedValue(1);
  const linkOpacity = useSharedValue(1);
  const gap = useSharedValue(1);
  const seed = useSharedValue(1);
  const thick = useSharedValue(2.1);
  const searchW = useSharedValue(0);
  const ripen = useSharedValue(0);
  const leafGreen = useSharedValue(0);
  const leafGrow = useSharedValue(1);
  const bite0 = useSharedValue(0);
  const bite1 = useSharedValue(0);
  const bite2 = useSharedValue(0);
  const shake = useSharedValue(0);
  // En boucle.
  const breath = useSharedValue(0);
  const sway = useSharedValue(0);
  const dash = useSharedValue(0);
  const dots = useSharedValue(0);
  const wobble = useSharedValue(0);
  const pulse = useSharedValue(0);
  const wave = useSharedValue(0);
  const travel = useSharedValue(0);

  const previous = useRef<PearState>(state);
  const bites = [bite0, bite1, bite2];

  const move = (value: { set: (v: number) => void }, target: number, delay: number, k: Spring) => {
    if (reduced) value.set(withDelay(0, withTiming(target, { duration: 160 })));
    else value.set(withDelay(delay, withSpring(target, spring(k))));
  };

  // Changement d'état : chaque propriété part de sa valeur actuelle vers sa nouvelle cible.
  useEffect(() => {
    const t = targets(state, clamped);
    const d = plan(previous.current, state);
    move(rest, t.rest, d.color, SP.color);
    move(body, t.body, d.body, SP.base);
    move(outline, t.outline, d.outline, SP.base);
    // Vers « Connexion », le contour se casse après 220 ms ; en le quittant, il se ressoude tout de suite.
    move(gapLine, state === 'searching' ? 5 : 0, state === 'searching' ? 220 : 0, SP.base);
    move(level, t.level, d.level, state === 'ripening' ? SP.slow : SP.slow);
    move(link, t.link, d.link, SP.soft);
    move(linkOpacity, t.linkOpacity, d.link, SP.soft);
    move(gap, t.gap, d.seeds, SP.nudge);
    move(seed, t.seed, d.seeds, SP.nudge);
    move(thick, t.thick, d.link, SP.nudge);
    move(searchW, t.searchW, d.outline, SP.soft);
    move(ripen, t.ripen, d.level, SP.soft);
    move(leafGreen, t.leafGreen, d.leaf, SP.color);
    // La feuille droite se replie puis repousse en entrant dans « Vérifié ».
    if (state === 'leaf' && previous.current !== 'leaf') {
      leafGrow.set(0);
      move(leafGrow, 1, 120, SP.nudge);
    }
    if (state !== 'bitten') bites.forEach((value) => move(value, 0, 0, SP.base));
    previous.current = state;
  }, [state]);

  // Le niveau d'envoi et les bouchées suivent `progress`.
  useEffect(() => {
    if (state === 'ripening') move(level, clamped, 0, SP.slow);
    if (state === 'bitten') {
      const filled = BITE_STEPS.filter((step) => clamped >= step - 0.005).length;
      bites.forEach((value, index) => move(value, index < filled ? 1 : 0, index < filled ? index * 140 : 0, SP.nudge));
      if (filled > 0 && !reduced) shake.set(withSequence(withTiming(1, { duration: 90 }), withSpring(0, spring(SP.shake))));
    }
  }, [clamped, state]);

  // Les boucles : seulement quand l'état les demande, et jamais en « réduire les animations ».
  useEffect(() => {
    if (reduced) return;
    const linear = (ms: number) => withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
    const sine = (ms: number) => withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true);
    if (state === 'resting') {
      breath.set(sine(1600));
      sway.set(sine(2400));
    }
    if (state === 'searching') {
      dash.set(withRepeat(withTiming(-11, { duration: 700, easing: Easing.linear }), -1, false));
      wobble.set(sine(700));
      pulse.set(sine(900));
    }
    if (state === 'searching' || state === 'ripening') dots.set(linear(520));
    if (state === 'ripening') {
      wave.set(linear(1400));
      // La graine de données va d'un pépin à l'autre, toujours dans le même sens.
      travel.set(linear(900));
    }
    return () => {
      [breath, sway, dash, dots, wobble, pulse, wave, travel].forEach((value) => {
        cancelAnimation(value);
        value.set(0);
      });
    };
  }, [state, reduced]);

  const skinColor = (r: number) => {
    'worklet';
    return interpolateColor(r, [0, 1], [colors.signatureStrong, REST.skin]);
  };

  // Le corps : peau (contour de 7 découpé par BODY lui-même), chair, avec le niveau du liquide.
  const fleshProps = useAnimatedProps(() => ({ fill: interpolateColor(rest.get(), [0, 1], [FLESH, REST.flesh]), opacity: body.get() }));
  const skinProps = useAnimatedProps(() => ({ stroke: skinColor(rest.get()), opacity: body.get() }));
  const baseProps = useAnimatedProps(() => ({ opacity: 0.3 * ripen.get() }));
  // Les formes de découpe (liquide, vague arrière, lien, bouchées) ne peuvent pas être animées image par
  // image : sur Android, react-native-svg ne redessine pas un détourage ou un masque dont la forme change par
  // animatedProps (la poire restait vide, et « Vérifié » sans contour). Elles sont donc recalculées par
  // React, à partir d'une copie des valeurs animées, seulement quand elles bougent.
  const [cut, setCut] = useState({ link: 1, b0: 0, b1: 0, b2: 0 });
  useAnimatedReaction(
    () => ({
      link: Math.round(link.get() * 50) / 50,
      b0: Math.round(bite0.get() * 25) / 25,
      b1: Math.round(bite1.get() * 25) / 25,
      b2: Math.round(bite2.get() * 25) / 25,
    }),
    (next, previous) => {
      if (!previous || next.link !== previous.link || next.b0 !== previous.b0 || next.b1 !== previous.b1 || next.b2 !== previous.b2) {
        scheduleOnRN(setCut, next);
      }
    },
  );
  // Le liquide se déplace (matrice du groupe) ; la poire, dedans, est remise à sa place par le déplacement
  // inverse : seule la découpe bouge. La vague avance en boucle pendant l'envoi (wave, 1,4 s par période).
  const frontMove = useAnimatedProps(() => ({ matrix: [1, 0, 0, 1, -wave.get() * WAVE_LENGTH, liquidY(level.get())] } as NativeG));
  const frontBack = useAnimatedProps(() => ({ matrix: [1, 0, 0, 1, wave.get() * WAVE_LENGTH, -liquidY(level.get())] } as NativeG));
  const backMove = useAnimatedProps(() => ({ opacity: 0.45 * ripen.get(), matrix: [1, 0, 0, 1, -wave.get() * WAVE_LENGTH, liquidY(Math.min(1, level.get() + 0.03))] } as NativeG));
  const backBack = useAnimatedProps(() => ({ matrix: [1, 0, 0, 1, wave.get() * WAVE_LENGTH, -liquidY(Math.min(1, level.get() + 0.03))] } as NativeG));
  const revealHalf = SEED_HALF * 1.4 * cut.link + 0.01;
  // Le contour en pointillés de « Connexion » est du vert de la peau (planche).
  const outlineProps = useAnimatedProps(() => ({ strokeDashoffset: dash.get(), opacity: outline.get(), strokeDasharray: [6, Math.max(0.01, gapLine.get())], stroke: skinColor(rest.get()) }));

  // Les pépins : l'écart oscille pendant la recherche (± 24 %), la taille suit l'état.
  const gapNow = () => {
    'worklet';
    return gap.get() * (1 + 0.24 * searchW.get() * (wobble.get() * 2 - 1));
  };
  // Contraste : sur la chair pâle, les pépins et le lien sont noirs ; quand la chair n'est plus derrière eux
  // (« Connexion », où la poire s'efface, ou « Envoi » tant que le liquide n'a pas atteint les pépins), ils
  // prennent l'encre de l'écran, choisie pour se lire sur son fond : jamais noir sur noir.
  const seedInk = () => {
    'worklet';
    const liquid = Math.max(0, Math.min(1, (level.get() - 0.38) / 0.12));
    const cover = body.get() * (1 - ripen.get()) + liquid * ripen.get();
    const onFlesh = interpolateColor(Math.max(0, Math.min(1, (cover - 0.2) / 0.6)), [0, 1], [ink, fixed.black]);
    return interpolateColor(rest.get(), [0, 1], [onFlesh, REST.ink]);
  };
  const seedLeft = useAnimatedProps(() => ({ d: seedPath(50 - SEED_HALF * gapNow(), -18, seed.get()), fill: seedInk() }));
  const seedRight = useAnimatedProps(() => ({ d: seedPath(50 + SEED_HALF * gapNow(), 18, seed.get()), fill: seedInk() }));
  // Le lien : une ligne de points qui défilent, révélée du centre vers les pépins.
  const linkProps = useAnimatedProps(() => {
    const half = SEED_HALF * gapNow();
    return {
      d: `M${50 - half} ${SEED_Y} Q50 ${LINK_TOP} ${50 + half} ${SEED_Y}`,
      strokeWidth: thick.get(),
      strokeDashoffset: -dots.get() * DOT_PERIOD,
      opacity: linkOpacity.get() * (state === 'searching' ? 0.6 + 0.4 * pulse.get() : 1),
      stroke: seedInk(),
    };
  });
  // La graine verte qui va d'un pépin à l'autre en suivant la courbe du lien.
  const travelProps = useAnimatedProps(() => {
    const half = SEED_HALF * gapNow();
    const u = travel.get();
    const x = (1 - u) * (1 - u) * (50 - half) + 2 * (1 - u) * u * 50 + u * u * (50 + half);
    const y = (1 - u) * (1 - u) * SEED_Y + 2 * (1 - u) * u * LINK_TOP + u * u * SEED_Y;
    return { cx: x, cy: y, opacity: ripen.get() * Math.sin(Math.PI * u) };
  });

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + 0.03 * breath.get() - 0.04 * shake.get() },
      { translateX: shake.get() * 0.6 },
    ],
  }));
  // Les feuilles : elles se balancent (± 5°), respirent en recherche, et la droite repousse.
  const leavesStyle = useAnimatedStyle(() => ({
    opacity: state === 'searching' ? 0.45 + 0.55 * pulse.get() : 1,
    transform: [{ rotate: `${(sway.get() * 2 - 1) * 5 * (state === 'resting' ? 1 : 0)}deg` }],
  }));
  const rightLeafStyle = useAnimatedStyle(() => ({
    opacity: leafGrow.get() > 0 ? 1 : 0,
    transform: [{ rotate: `${(1 - leafGrow.get()) * -35}deg` }, { scale: leafGrow.get() }],
  }));
  const rightLeafProps = useAnimatedProps(() => ({
    fill: interpolateColor(leafGreen.get(), [0, 1], [color, leafColor ?? colors.signatureStrong]),
  }));
  const ox = ((LEAF_ORIGIN.x - VB_X) / VB_W) * width;
  const oy = ((LEAF_ORIGIN.y - VB_Y) / VB_H) * height;
  const innerInk = state === 'resting' ? REST.ink : color;
  const outerColor = state === 'resting' ? REST.ink : color;

  const clipBody = `body${id}`;
  // Un identifiant neuf à chaque changement de forme : Android garde un détourage en mémoire tant que son
  // identifiant ne change pas, même si son contenu change.
  const clipLiquid = `liquid${id}`;
  const clipBack = `back${id}`;
  const clipLink = `link${id}-${Math.round(cut.link * 50)}`;
  const maskBites = `bites${id}-${Math.round(cut.b0 * 25)}-${Math.round(cut.b1 * 25)}-${Math.round(cut.b2 * 25)}`;
  const skinWidth = small ? SKIN_WIDTH + 3 : SKIN_WIDTH;

  return (
    <View style={{ width, height }}>
      <Reanimated.View style={[StyleSheet.absoluteFill, bodyStyle]}>
        <Svg width={width} height={height} viewBox={VIEW_BOX}>
          <Defs>
            <ClipPath id={clipBody}>
              <Path d={BODY} />
            </ClipPath>
            {/* La clé suit la forme : le détourage est reconstruit à chaque changement, sinon Android le garde. */}
            <ClipPath id={clipBack}>
              <Path d={WAVE_BACK} />
            </ClipPath>
            <ClipPath id={clipLiquid}>
              <Path d={WAVE_FRONT} />
            </ClipPath>
            <ClipPath id={clipLink}>
              <Rect key={revealHalf} x={50 - revealHalf} y={VB_Y} width={revealHalf * 2} height={VB_H} />
            </ClipPath>
            <Mask id={maskBites} maskUnits="userSpaceOnUse" x={VB_X} y={VB_Y} width={VB_W} height={VB_H}>
              <Rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill={fixed.white} />
              {BITES.map((bite, index) => (
                <Circle key={`${bite.cx}:${[cut.b0, cut.b1, cut.b2][index]}`} cx={bite.cx} cy={bite.cy} r={BITE_R * [cut.b0, cut.b1, cut.b2][index]} fill={fixed.black} />
              ))}
            </Mask>
          </Defs>
          <G mask={`url(#${maskBites})`}>
            {/* Envoi : la poire vide reste visible en fond (30 %), le liquide la remplit par-dessus (planche). */}
            <AnimatedG animatedProps={baseProps}>
              <AnimatedPath d={BODY} animatedProps={fleshProps} />
              <G clipPath={`url(#${clipBody})`}>
                <AnimatedPath d={BODY} fill="none" strokeWidth={skinWidth} animatedProps={skinProps} />
              </G>
            </AnimatedG>
            <AnimatedG animatedProps={backMove} clipPath={`url(#${clipBack})`}>
              <AnimatedG animatedProps={backBack}>
                <AnimatedPath d={BODY} animatedProps={fleshProps} />
                <G clipPath={`url(#${clipBody})`}>
                  <AnimatedPath d={BODY} fill="none" strokeWidth={skinWidth} animatedProps={skinProps} />
                </G>
              </AnimatedG>
            </AnimatedG>
            <AnimatedG animatedProps={frontMove} clipPath={`url(#${clipLiquid})`}>
              <AnimatedG animatedProps={frontBack}>
                <AnimatedPath d={BODY} animatedProps={fleshProps} />
                <G clipPath={`url(#${clipBody})`}>
                  <AnimatedPath d={BODY} fill="none" strokeWidth={skinWidth} animatedProps={skinProps} />
                </G>
              </AnimatedG>
            </AnimatedG>
          </G>
          <AnimatedPath d={BODY} fill="none" strokeWidth={2.6} strokeLinecap="round" animatedProps={outlineProps} />
          <AnimatedPath fill={innerInk} animatedProps={seedLeft} />
          <AnimatedPath fill={innerInk} animatedProps={seedRight} />
          <G clipPath={`url(#${clipLink})`}>
            <AnimatedPath fill="none" strokeLinecap="round" strokeDasharray={small ? undefined : `0.01 ${DOT_PERIOD}`} animatedProps={linkProps} />
          </G>
          <AnimatedCircle r={2.1} fill={SEED_GREEN} animatedProps={travelProps} />
        </Svg>
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transformOrigin: `${ox}px ${oy}px` }, leavesStyle]}>
          <Svg width={width} height={height} viewBox={VIEW_BOX}>
            <Path d={STEM} stroke={outerColor} strokeWidth={3.2} strokeLinecap="round" />
            <Path d={LEFT_LEAF} fill={outerColor} />
          </Svg>
          <Reanimated.View style={[StyleSheet.absoluteFill, { transformOrigin: `${((52 - VB_X) / VB_W) * width}px ${((22 - VB_Y) / VB_H) * height}px` }, rightLeafStyle]}>
            <Svg width={width} height={height} viewBox={VIEW_BOX}>
              <AnimatedPath d={RIGHT_LEAF} animatedProps={rightLeafProps} />
            </Svg>
          </Reanimated.View>
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
}

