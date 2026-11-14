import { useEffect, useState } from 'react';
import { Image, PixelRatio, StyleSheet, View } from 'react-native';
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { StaticMapImageManager } from '@maplibre/maplibre-react-native';

import { log } from '../log';
import { timing } from '../motion';
import { createStyles, radius, useIsDark } from '../theme';
import { keepMapOffline } from './offlineMap';
import { mapStyleOf } from './pearStyle';

const ZOOM = 14;
// Une nouvelle image seulement si la position a bougé d'environ 20 m : sinon celle en cache resservira.
const ROUND = 4;
const cache = new Map<string, string>();

type Props = { latitude: number; longitude: number; width: number; height: number; live: boolean };

// Une petite carte fixe, dessinée par MapLibre à partir de la zone gardée sur le téléphone (hors réseau),
// avec un point au centre qui pulse tant que le partage est en direct. Une image plutôt qu'une carte
// interactive : elle tient dans une bulle de la conversation (liste inversée) sans rien coûter au défilement.
export function MiniMap({ latitude, longitude, width, height, live }: Props) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  // Claire ou sombre comme le thème : une image par version.
  const dark = useIsDark();
  const key = `pear-${dark ? 'sombre' : 'clair'},${latitude.toFixed(ROUND)},${longitude.toFixed(ROUND)},${width}x${height}`;
  const [uri, setUri] = useState(() => cache.get(key) ?? null);
  const shown = useSharedValue(cache.has(key) ? 1 : 0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    const known = cache.get(key);
    if (known) {
      setUri(known);
      return;
    }
    let alive = true;
    keepMapOffline();
    StaticMapImageManager.createImage({
      mapStyle: mapStyleOf(dark),
      center: [longitude, latitude],
      zoom: ZOOM,
      width: PixelRatio.getPixelSizeForLayoutSize(width),
      height: PixelRatio.getPixelSizeForLayoutSize(height),
      output: 'file',
      logo: false,
    })
      .then((made: string) => {
        cache.set(key, made);
        if (alive) setUri(made);
      })
      .catch((e: unknown) => log.warn('mini-carte', e));
    return () => {
      alive = false;
    };
    // La clé résume la position et la taille.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    cancelAnimation(pulse);
    pulse.set(0);
    if (live && !reduced) pulse.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }), -1, false));
  }, [live, reduced, pulse]);

  const imageStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const halo = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - pulse.get()), transform: [{ scale: 0.6 + 1.8 * pulse.get() }] }));

  return (
    <View style={[styles.frame, { width, height }]}>
      {uri && (
        <Reanimated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} onLoad={() => shown.set(timing(1, 240))} fadeDuration={0} />
        </Reanimated.View>
      )}
      <View pointerEvents="none" style={styles.center}>
        {live && <Reanimated.View style={[styles.halo, halo]} />}
        <View style={[styles.dot, !live && styles.dotEnded]} />
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.signatureStrong,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: colors.background,
    backgroundColor: colors.signatureStrong,
  },
  dotEnded: {
    backgroundColor: colors.textMuted,
  },
}));
