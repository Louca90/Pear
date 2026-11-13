import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { DURATION, timing } from '../motion';
import { createStyles, fixed, radius, useColors } from '../theme';

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const THUMB = 22;
// Course du rond : la piste moins le rond, sa marge intérieure (2) et sa bordure (1) de chaque côté.
const TRAVEL = TRACK_WIDTH - THUMB - 6;

// Interrupteur : le rond glisse et le fond se colore en fondu, sur le fil natif, sans rebond.
// Couleurs du thème : activé, fond d'accent et rond de la couleur lisible dessus (noir sur blanc en
// sombre, blanc sur noir en clair) ; désactivé, fond discret et rond contrasté.
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  const colors = useColors();
  const styles = useStyles();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.set(timing(value ? 1 : 0, DURATION.small));
  }, [value, on]);

  const offTrack = colors.elevatedActive;
  const offBorder = colors.border;
  const offThumb = colors.scheme === 'dark' ? colors.textMuted : fixed.white;
  const accent = colors.accent;
  const onAccent = colors.onAccent;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [offTrack, accent]),
    borderColor: interpolateColor(on.get(), [0, 1], [offBorder, accent]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [offThumb, onAccent]),
    transform: [{ translateX: on.get() * TRAVEL }],
  }));

  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
    >
      <Reanimated.View style={[styles.track, trackStyle]}>
        <Reanimated.View style={[styles.thumb, thumbStyle]} />
      </Reanimated.View>
    </Pressable>
  );
}

const useStyles = createStyles(() => ({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.full,
    padding: 2,
    borderWidth: 1,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.full,
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.25)',
  },
}));
