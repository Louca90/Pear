import { ReactNode, useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { GestureDetector, useExclusiveGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';

import { timing } from '../../motion';
import { t } from '../../i18n';

// L'écran partagé par le contact, chez celui qui le regarde : deux doigts pincent pour zoomer (autour du
// point pincé), un doigt déplace l'image zoomée, un double appui zoome à l'endroit touché ou revient à la
// taille normale, un simple appui garde son rôle (masquer / remettre les commandes). Tout sur le fil
// natif ; les retours se font avec la courbe de Pear, sans rebond. L'image ne sort jamais du cadre.
// La vidéo (RTCView, une SurfaceView) suit l'échelle et le déplacement de ses parents depuis Android 10.

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const SETTLE_MS = 240;
// Élan d'un lâcher pendant le déplacement (secondes projetées).
const INERTIA = 0.12;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function ZoomableShare({ onTap, children }: { onTap: () => void; children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Au début d'un pincement : échelle, déplacement et point pincé (par rapport au centre).
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const pinching = useSharedValue(false);
  // Après un pincement, le doigt restant reprend le déplacement d'où l'image est (pas de saut).
  const panFromX = useSharedValue(0);
  const panFromY = useSharedValue(0);
  const rebase = useSharedValue(false);
  const halfW = useSharedValue(width / 2);
  const halfH = useSharedValue(height / 2);

  // L'écran change de taille (rotation, fenêtre flottante) : on revient à la taille normale.
  useEffect(() => {
    halfW.set(width / 2);
    halfH.set(height / 2);
    scale.set(timing(1, SETTLE_MS));
    x.set(timing(0, SETTLE_MS));
    y.set(timing(0, SETTLE_MS));
  }, [width, height, halfW, halfH, scale, x, y]);

  // Va vers une échelle et un déplacement, ramenés dans le cadre (en dessous de 1,05 : taille normale).
  const settle = (toScale: number, toX: number, toY: number) => {
    'worklet';
    const s = toScale < 1.05 ? 1 : clamp(toScale, 1, MAX_ZOOM);
    const limitX = (s - 1) * halfW.get();
    const limitY = (s - 1) * halfH.get();
    scale.set(timing(s, SETTLE_MS));
    x.set(timing(clamp(toX, -limitX, limitX), SETTLE_MS));
    y.set(timing(clamp(toY, -limitY, limitY), SETTLE_MS));
  };

  // Le pincement compte une fois les deux doigts posés (activé), pas dès le premier doigt.
  const pinch = usePinchGesture({
    onActivate: (event) => {
      'worklet';
      pinching.set(true);
      startScale.set(scale.get());
      startX.set(x.get());
      startY.set(y.get());
      focalX.set(event.focalX - halfW.get());
      focalY.set(event.focalY - halfH.get());
    },
    onUpdate: (event) => {
      'worklet';
      // Le point de l'image sous les doigts au début du pincement reste sous les doigts.
      const s = clamp(startScale.get() * event.scale, 0.8, MAX_ZOOM * 1.15);
      const ratio = s / startScale.get();
      const fx = event.focalX - halfW.get();
      const fy = event.focalY - halfH.get();
      scale.set(s);
      x.set(fx - ratio * (focalX.get() - startX.get()));
      y.set(fy - ratio * (focalY.get() - startY.get()));
    },
    onFinalize: () => {
      'worklet';
      if (!pinching.get()) return;
      pinching.set(false);
      rebase.set(true);
      settle(scale.get(), x.get(), y.get());
    },
  });

  const pan = usePanGesture({
    maxPointers: 2,
    onBegin: () => {
      'worklet';
      panFromX.set(x.get());
      panFromY.set(y.get());
      rebase.set(false);
    },
    onUpdate: (event) => {
      'worklet';
      if (pinching.get() || scale.get() <= 1) return;
      if (rebase.get()) {
        panFromX.set(x.get() - event.translationX);
        panFromY.set(y.get() - event.translationY);
        rebase.set(false);
      }
      const limitX = (scale.get() - 1) * halfW.get();
      const limitY = (scale.get() - 1) * halfH.get();
      x.set(clamp(panFromX.get() + event.translationX, -limitX, limitX));
      y.set(clamp(panFromY.get() + event.translationY, -limitY, limitY));
    },
    onDeactivate: (event) => {
      'worklet';
      if (pinching.get() || scale.get() <= 1) return;
      settle(scale.get(), x.get() + event.velocityX * INERTIA, y.get() + event.velocityY * INERTIA);
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (event) => {
      'worklet';
      if (scale.get() > 1.01) {
        settle(1, 0, 0);
        return;
      }
      // Le point touché reste sous le doigt.
      const fx = event.x - halfW.get();
      const fy = event.y - halfH.get();
      settle(DOUBLE_TAP_ZOOM, fx - DOUBLE_TAP_ZOOM * fx, fy - DOUBLE_TAP_ZOOM * fy);
    },
  });

  const singleTap = useTapGesture({
    runOnJS: true,
    onActivate: () => onTap(),
  });

  // Le simple appui attend que le double appui ait échoué.
  const taps = useExclusiveGestures(doubleTap, singleTap);
  const gesture = useSimultaneousGestures(pinch, pan, taps);

  const zoomed = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View collapsable={false} accessibilityLabel={t('appel.zoomEcran')} style={[StyleSheet.absoluteFill, styles.clip]}>
        <Reanimated.View style={[StyleSheet.absoluteFill, zoomed]}>{children}</Reanimated.View>
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
