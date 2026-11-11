import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';

import { fixed, motion } from '../theme';

// La poire de Pear en vectoriel : nette à toutes les tailles (l'icône PNG se floute en grand).
// Même dessin que assets/icon.png : corps à deux lobes, tige et deux feuilles.
// C'est un logo qui s'anime, pas un personnage : aucun visage, aucun rebond.
const VIEW_BOX = '22 6 56 88';
const VB_X = 22;
const VB_Y = 6;
const VB_W = 56;
const VB_H = 88;
export const PEAR_RATIO = VB_W / VB_H;

const BODY = 'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z';
const RIGHT_LEAF = 'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z';
const LEFT_LEAF = 'M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z';
const WHOLE = `${BODY} ${RIGHT_LEAF} ${LEFT_LEAF}`;

// Point d'attache de la feuille droite (d'où elle pousse).
const LEAF_ORIGIN = { x: 52, y: 22 };
// Les trois bouchées, sur le bord droit du corps, du haut vers le bas.
const BITES = [
  { cx: 70, cy: 48, r: 9 },
  { cx: 74, cy: 66, r: 9 },
  { cx: 66, cy: 84, r: 9 },
];
const BITE_STEPS = [0.33, 0.66, 1];
// Hauteur du corps (y = 28 à 92) pour le remplissage du mûrissement.
const BODY_TOP = 28;
const BODY_BOTTOM = 92;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type PearState = 'idle' | 'bitten' | 'ripening' | 'searching' | 'resting' | 'leaf';

type Props = {
  height: number;
  color: string;
  // `idle` : fixe. `bitten` : tirer pour actualiser, bouchées selon `progress`. `ripening` :
  // téléchargement, remplissage selon `progress`. `searching` : pointillés qui tournent.
  // `resting` : écrans vides, respiration à peine visible. `leaf` : la feuille droite pousse.
  state?: PearState;
  // 0 à 1, pour `bitten` et `ripening`.
  progress?: number;
  // Couleur de la feuille qui pousse (`leaf`), `signatureStrong` en pratique.
  leafColor?: string;
};

export function Pear({ height, color, state = 'idle', progress = 0, leafColor }: Props) {
  const width = height * PEAR_RATIO;
  const size = { width, height };
  const clamped = Math.min(1, Math.max(0, progress));

  // --- Respiration (resting) : échelle 1 → 1,02 → 1 sur 3 s, sur le fil natif. ---
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state !== 'resting' || motion.reduced) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1.02, duration: 1500, easing: motion.easing, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 1500, easing: motion.easing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, breath]);

  // --- Pointillés (searching) : le contour tourne lentement, sans à-coup. ---
  const dash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'searching' || motion.reduced) {
      dash.setValue(0);
      return;
    }
    // 11 = période du motif « 6 5 » : un tour complet revient exactement au point de départ.
    const loop = Animated.loop(Animated.timing(dash, { toValue: -11, duration: 900, easing: (v) => v, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [state, dash]);

  // --- Bouchées (bitten) : le doigt les fait apparaître ; au retour à idle, la poire se reforme. ---
  const bite = useRef(new Animated.Value(1)).current;
  const wasBitten = useRef(false);
  useEffect(() => {
    if (state === 'bitten') {
      bite.setValue(1);
      wasBitten.current = true;
      return;
    }
    if (wasBitten.current) {
      wasBitten.current = false;
      bite.setValue(1);
      Animated.timing(bite, { toValue: 0, duration: motion.mascot, easing: motion.easing, useNativeDriver: false }).start();
    }
  }, [state, bite]);
  // Combien de bouchées sont visibles : figées à la dernière valeur pendant la reformation.
  const biteCount = useRef(0);
  if (state === 'bitten') biteCount.current = BITE_STEPS.filter((step) => clamped >= step - 0.005).length;
  const showBites = state === 'bitten' || wasBitten.current;

  // --- Mûrissement (ripening) : le remplissage monte de bas en haut, sur le fil natif. ---
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'ripening') {
      fill.setValue(0);
      return;
    }
    Animated.timing(fill, { toValue: clamped, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [state, clamped, fill]);
  const bodyTopPx = ((BODY_TOP - VB_Y) / VB_H) * height;
  const bodyHeightPx = ((BODY_BOTTOM - BODY_TOP) / VB_H) * height;
  // Le cadre (overflow hidden) descend de (1 - p) × corps, et la poire qu'il contient remonte
  // d'autant : seul le bas reste visible.
  const reveal = fill.interpolate({ inputRange: [0, 1], outputRange: [bodyHeightPx, 0] });
  const unreveal = fill.interpolate({ inputRange: [0, 1], outputRange: [-bodyHeightPx, 0] });

  // --- Feuille (leaf) : la feuille droite pousse depuis son point d'attache. ---
  const leaf = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'leaf') {
      leaf.setValue(0);
      return;
    }
    leaf.setValue(0);
    Animated.timing(leaf, { toValue: 1, duration: motion.mascot, easing: motion.easing, useNativeDriver: true }).start();
  }, [state, leaf]);
  const leafOriginX = ((LEAF_ORIGIN.x - VB_X) / VB_W) * width;
  const leafOriginY = ((LEAF_ORIGIN.y - VB_Y) / VB_H) * height;

  if (state === 'searching') {
    return (
      <View style={size}>
        <Svg width={width} height={height} viewBox={VIEW_BOX}>
          <AnimatedPath d={BODY} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="6 5" strokeDashoffset={dash} strokeLinecap="round" />
          <Path d={`${RIGHT_LEAF} ${LEFT_LEAF}`} fill={color} />
        </Svg>
      </View>
    );
  }

  if (state === 'ripening') {
    return (
      <View style={size}>
        <Svg width={width} height={height} viewBox={VIEW_BOX} style={styles.layer}>
          <Path d={WHOLE} fill={color} opacity={0.25} />
        </Svg>
        <Animated.View style={[styles.layer, { top: bodyTopPx, height: bodyHeightPx, overflow: 'hidden', transform: [{ translateY: reveal }] }]}>
          <Animated.View style={{ transform: [{ translateY: unreveal }] }}>
            <Svg width={width} height={height} viewBox={VIEW_BOX} style={{ marginTop: -bodyTopPx }}>
              <Path d={BODY} fill={color} />
            </Svg>
          </Animated.View>
        </Animated.View>
      </View>
    );
  }

  if (state === 'leaf') {
    return (
      <View style={size}>
        <Svg width={width} height={height} viewBox={VIEW_BOX} style={styles.layer}>
          <Path d={`${BODY} ${LEFT_LEAF}`} fill={color} />
        </Svg>
        <Animated.View style={[styles.layer, { transformOrigin: `${leafOriginX}px ${leafOriginY}px`, transform: [{ scale: leaf }] }]}>
          <Svg width={width} height={height} viewBox={VIEW_BOX}>
            <Path d={RIGHT_LEAF} fill={leafColor ?? color} />
          </Svg>
        </Animated.View>
      </View>
    );
  }

  // idle, resting, bitten (et la reformation après bitten).
  return (
    <Animated.View style={[size, { transform: [{ scale: breath }] }]}>
      <Svg width={width} height={height} viewBox={VIEW_BOX}>
        {showBites ? (
          <Defs>
            <Mask id="bites" maskUnits="userSpaceOnUse" x={VB_X} y={VB_Y} width={VB_W} height={VB_H}>
              <Rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill={fixed.white} />
              {BITES.slice(0, biteCount.current).map((b) => (
                <AnimatedCircle key={b.cx} cx={b.cx} cy={b.cy} r={Animated.multiply(bite, b.r)} fill={fixed.black} />
              ))}
            </Mask>
          </Defs>
        ) : null}
        <Path d={BODY} fill={color} mask={showBites ? 'url(#bites)' : undefined} />
        <Path d={`${RIGHT_LEAF} ${LEFT_LEAF}`} fill={color} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
