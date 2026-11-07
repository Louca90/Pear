import { useRef } from 'react';
import { PanResponder, View } from 'react-native';

import { createMediaStyles, radius } from '../../theme';
import { clamp } from './layers';

const THUMB = 22;

// Un curseur vertical (taille du texte, épaisseur du pinceau) : glisser vers le haut augmente.
export function VerticalSlider({ value, min, max, height, label, onChange }: { value: number; min: number; max: number; height: number; label: string; onChange: (value: number) => void }) {
  const styles = useStyles();
  const latest = useRef({ onChange, min, max, height });
  latest.current = { onChange, min, max, height };
  const fromY = (y: number) => {
    const current = latest.current;
    current.onChange(Math.round(current.min + (1 - clamp(y / current.height, 0, 1)) * (current.max - current.min)));
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: ({ nativeEvent }) => fromY(nativeEvent.locationY),
      onPanResponderMove: ({ nativeEvent }) => fromY(nativeEvent.locationY),
    }),
  ).current;
  const ratio = (value - min) / (max - min);
  return (
    <View style={[styles.slider, { height }]} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value }} {...pan.panHandlers}>
      <View pointerEvents="none" style={[styles.track, { height }]} />
      <View pointerEvents="none" style={[styles.thumb, { top: (1 - ratio) * height - THUMB / 2 }]} />
    </View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  slider: {
    width: 36,
    alignItems: 'center',
  },
  track: {
    width: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.background,
  },
}));
