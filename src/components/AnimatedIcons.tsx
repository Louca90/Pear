import { ReactNode, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { timing } from '../motion';
import { useColors } from '../theme';

// Les icônes de la planche « Icônes » : chacune garde son dessin, un seul de ses éléments bouge, une
// fois, au moment de l'action (moins de 300 ms, aucun rebond). Les tracés sont ceux de lucide, sur 24.
// La partie qui bouge est un calque à part (une vue animée sur le fil natif), posé sur le reste.
//
// play : un nombre qui augmente à chaque action (l'icône joue son geste) ; autoPlay : une fois à
// l'apparition, après `delay` ms (dans un menu qui s'ouvre, par exemple).

// away (envoi) : l'avion part et ne revient pas (posé par-dessus un autre bouton, il disparaît).
export type AnimatedIconProps = { size?: number; color?: string; strokeWidth?: number; play?: number; autoPlay?: boolean; delay?: number; accent?: string; away?: boolean };

function useTrigger(play: number | undefined, autoPlay: boolean | undefined, delay: number, run: (delay: number) => void) {
  const reduced = useReducedMotion();
  const first = useRef(true);
  useEffect(() => {
    if (reduced) return;
    if (first.current) {
      first.current = false;
      if (autoPlay) run(delay);
      return;
    }
    run(0);
    // Seul le changement de `play` relance le geste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);
}

function Layer({ size, style, children }: { size: number; style?: object; children: ReactNode }) {
  return (
    <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {children}
      </Svg>
    </Reanimated.View>
  );
}

function useStroke(color: string | undefined, strokeWidth: number) {
  const colors = useColors();
  return { stroke: color ?? colors.text, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
}

// Une valeur qui va de 0 à 1 puis revient à 0 (aller-retour).
function bounceBack(value: SharedValue<number>, out: number, back: number, delay: number) {
  value.set(withDelay(delay, withSequence(timing(1, out), timing(0, back))));
}

// Envoyer : l'avion part en haut à droite, puis revient de l'autre côté.
export function SendIcon({ size = 24, color, strokeWidth = 1.75, play, autoPlay, delay = 0, away }: AnimatedIconProps) {
  const line = useStroke(color, strokeWidth);
  const flight = useSharedValue(0);
  useTrigger(play, autoPlay, delay, (wait) => {
    flight.set(withDelay(wait, away ? timing(1, 220) : withSequence(timing(1, 140), timing(2, 0), timing(3, 160))));
  });
  const unit = size / 24;
  const style = useAnimatedStyle(() => {
    const step = flight.get();
    // 0 → 1 : part ; 1 → 2 : passe de l'autre côté sans se voir ; 2 → 3 : revient à sa place.
    const shift = step <= 1 ? step * 9 : step <= 2 ? -9 : (step - 3) * 9;
    const opacity = step <= 1 ? 1 - step : step <= 2 ? 0 : step - 2;
    return { opacity: step >= 3 ? 1 : opacity, transform: [{ translateX: shift * unit }, { translateY: -shift * unit }] };
  });
  return (
    <View style={{ width: size, height: size }}>
      <Layer size={size} style={style}>
        <Path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" {...line} />
        <Path d="m21.854 2.147-10.94 10.939" {...line} />
      </Layer>
    </View>
  );
}

// Vocal : deux petites ondes vertes s'allument de chaque côté du micro.
export function MicIcon({ size = 24, color, strokeWidth = 1.75, play, autoPlay, delay = 0, accent }: AnimatedIconProps) {
  const colors = useColors();
  const line = useStroke(color, strokeWidth);
  const waves = useSharedValue(0);
  useTrigger(play, autoPlay, delay, (wait) => bounceBack(waves, 120, 380, wait));
  const style = useAnimatedStyle(() => ({ opacity: waves.get() }));
  return (
    <View style={{ width: size, height: size }}>
      <Layer size={size}>
        <Rect x={9} y={2} width={6} height={12} rx={3} {...line} />
        <Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" {...line} />
      </Layer>
      <Layer size={size} style={style}>
        <Path d="M2 8v4M22 8v4" {...line} stroke={accent ?? colors.signatureStrong} />
      </Layer>
    </View>
  );
}

// Supprimer : le couvercle se soulève et revient.
export function TrashIcon({ size = 24, color, strokeWidth = 1.75, play, autoPlay, delay = 0 }: AnimatedIconProps) {
  const line = useStroke(color, strokeWidth);
  const lid = useSharedValue(0);
  useTrigger(play, autoPlay, delay, (wait) => bounceBack(lid, 120, 180, wait));
  const unit = size / 24;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * unit * lid.get() }, { rotate: `${-12 * lid.get()}deg` }],
  }));
  return (
    <View style={{ width: size, height: size }}>
      <Layer size={size}>
        <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" {...line} />
      </Layer>
      <Layer size={size} style={[style, { transformOrigin: `${3 * unit}px ${6 * unit}px` }]}>
        <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...line} />
      </Layer>
    </View>
  );
}

const PIN_HEAD = 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';

// Épingler : la tête de l'épingle s'enfonce de 3 points.
export function PinIcon({ size = 24, color, strokeWidth = 1.75, play, autoPlay, delay = 0 }: AnimatedIconProps) {
  const line = useStroke(color, strokeWidth);
  const push = useSharedValue(0);
  useTrigger(play, autoPlay, delay, (wait) => bounceBack(push, 120, 180, wait));
  const unit = size / 24;
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: 3 * unit * push.get() }] }));
  return (
    <View style={{ width: size, height: size }}>
      <Layer size={size}>
        <Path d="M12 17v5" {...line} />
      </Layer>
      <Layer size={size} style={style}>
        <Path d={PIN_HEAD} {...line} />
      </Layer>
    </View>
  );
}

// Demandes : le battant de la cloche oscille (gauche, droite, puis s'arrête).
export function BellIcon({ size = 24, color, strokeWidth = 1.75, play, autoPlay, delay = 0 }: AnimatedIconProps) {
  const line = useStroke(color, strokeWidth);
  const swing = useSharedValue(0);
  useTrigger(play, autoPlay, delay, (wait) => {
    swing.set(withDelay(wait, withSequence(timing(-1.6, 70), timing(1.6, 90), timing(-0.8, 70), timing(0, 70))));
  });
  const unit = size / 24;
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: swing.get() * unit }] }));
  return (
    <View style={{ width: size, height: size }}>
      <Layer size={size}>
        <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" {...line} />
      </Layer>
      <Layer size={size} style={style}>
        <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" {...line} />
      </Layer>
    </View>
  );
}

// Menu : les trois points s'allument l'un après l'autre.
export function DotsIcon({ size = 24, color, play, autoPlay, delay = 0 }: AnimatedIconProps) {
  const colors = useColors();
  const fill = color ?? colors.text;
  const dots = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  useTrigger(play, autoPlay, delay, (wait) => dots.forEach((dot, index) => dot.set(withDelay(wait + index * 60, withSequence(timing(1, 90), timing(0, 150))))));
  const styles = dots.map((dot) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: 1 - 0.7 * dot.get() })),
  );
  return (
    <View style={{ width: size, height: size }}>
      {[5, 12, 19].map((cy, index) => (
        <Layer key={cy} size={size} style={styles[index]}>
          <Circle cx={12} cy={cy} r={1.6} fill={fill} />
        </Layer>
      ))}
    </View>
  );
}

// Verrou : le voyant vert au cœur du cadenas s'allume.
export function LockIcon({ size = 24, color, strokeWidth = 1.75, play, autoPlay, delay = 0, accent }: AnimatedIconProps) {
  const colors = useColors();
  const line = useStroke(color, strokeWidth);
  const light = useSharedValue(0);
  useTrigger(play, autoPlay, delay, (wait) => bounceBack(light, 120, 420, wait));
  const style = useAnimatedStyle(() => ({ opacity: light.get() }));
  return (
    <View style={{ width: size, height: size }}>
      <Layer size={size}>
        <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...line} />
        <Rect x={5} y={11} width={14} height={10} rx={2} {...line} />
      </Layer>
      <Layer size={size} style={style}>
        <Circle cx={12} cy={16} r={1.6} fill={accent ?? colors.signatureStrong} />
      </Layer>
    </View>
  );
}
