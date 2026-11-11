import { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { t } from '../i18n';
import { useColors } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const STROKE = 2;
const GAP = 2;
const TRACE_MS = 420;
const FADE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

// Un écran qui affiche des anneaux : ceux présents à l'arrivée se tracent, ceux qui apparaissent ensuite
// (un contact se connecte pendant qu'on regarde la liste) entrent en simple fondu.
export function useRingArrival() {
  const arriving = useRef(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      arriving.current = false;
    }, 1200);
    return () => clearTimeout(timer);
  }, []);
  return arriving;
}

type Props = {
  online: boolean;
  size: number;
  // Rang de la ligne dans la liste : décale le tracé de 40 ms par ligne.
  delay?: number;
  // Vrai tant que l'écran vient d'arriver : l'anneau se trace au lieu de apparaître en fondu.
  trace: boolean;
  children: ReactNode;
};

// L'avatar, entouré d'un anneau de 2 points en poire foncée quand le contact est en ligne.
export function OnlineRing({ online, size, delay = 0, trace, children }: Props) {
  const colors = useColors();
  const outer = size + (GAP + STROKE) * 2;
  const radius = (outer - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useRef(new Animated.Value(online && !trace ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(online ? 1 : 0)).current;
  const wasOnline = useRef(false);

  useEffect(() => {
    if (online && !wasOnline.current) {
      if (trace) {
        progress.setValue(0);
        opacity.setValue(1);
        Animated.timing(progress, { toValue: 1, duration: TRACE_MS, delay, easing: EASING, useNativeDriver: false }).start();
      } else {
        progress.setValue(1);
        opacity.setValue(0);
        Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: EASING, useNativeDriver: true }).start();
      }
    } else if (!online) {
      opacity.setValue(0);
      progress.setValue(0);
    }
    wasOnline.current = online;
    // `trace` est lu seulement quand l'état en ligne change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return (
    <View accessibilityLabel={online ? t('accueil.enLigne') : undefined}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.ring, { top: -(GAP + STROKE), left: -(GAP + STROKE), width: outer, height: outer, opacity }]}>
        <Svg width={outer} height={outer}>
          <AnimatedCircle
            cx={outer / 2}
            cy={outer / 2}
            r={radius}
            stroke={colors.signatureStrong}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
            rotation={-90}
            originX={outer / 2}
            originY={outer / 2}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
  },
});
