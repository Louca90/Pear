import { useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Size, STICKER_SIZE, StickerLayer } from './layers';

const APPEAR_MS = 220;

// Un emoji placé par son centre, tourné et agrandi autour de lui. À l'arrivée, il apparaît en fondu en
// grandissant un peu, sans rebond. La copie cachée de l'export ne s'anime pas.
export function StickerLayerView({ layer, size, onMeasure, hidden, animated }: { layer: StickerLayer; size: Size | undefined; onMeasure?: (id: string, size: Size) => void; hidden?: boolean; animated?: boolean }) {
  const appear = useSharedValue(animated ? 0 : 1);
  useEffect(() => {
    if (animated) appear.set(withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) }));
  }, [animated, appear]);
  const visible = !!size && !hidden;
  const { scale, rotation } = layer;
  const dx = size ? layer.x - size.width / 2 : 0;
  const dy = size ? layer.y - size.height / 2 : 0;
  const grow = useAnimatedStyle(() => ({
    opacity: visible ? appear.get() : 0,
    transform: [{ translateX: dx }, { translateY: dy }, { rotate: `${rotation}rad` }, { scale: (0.7 + 0.3 * appear.get()) * scale }],
  }));

  return (
    <Reanimated.View
      pointerEvents="none"
      onLayout={onMeasure && (({ nativeEvent }) => onMeasure(layer.id, { width: nativeEvent.layout.width, height: nativeEvent.layout.height }))}
      style={[
        styles.layer,
        grow,
      ]}
    >
      <Text style={styles.emoji}>{layer.emoji}</Text>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  emoji: {
    fontSize: STICKER_SIZE,
    lineHeight: Math.round(STICKER_SIZE * 1.2),
    textAlign: 'center',
  },
});
