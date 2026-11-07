import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';

import { Size, STICKER_SIZE, StickerLayer } from './layers';

const APPEAR_MS = 220;

// Un emoji placé par son centre, tourné et agrandi autour de lui. À l'arrivée, il apparaît en fondu en
// grandissant un peu, sans rebond. La copie cachée de l'export ne s'anime pas.
export function StickerLayerView({ layer, size, onMeasure, hidden, animated }: { layer: StickerLayer; size: Size | undefined; onMeasure?: (id: string, size: Size) => void; hidden?: boolean; animated?: boolean }) {
  const appear = useRef(new Animated.Value(animated ? 0 : 1)).current;
  useEffect(() => {
    if (animated) Animated.timing(appear, { toValue: 1, duration: APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [animated, appear]);

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onMeasure && (({ nativeEvent }) => onMeasure(layer.id, { width: nativeEvent.layout.width, height: nativeEvent.layout.height }))}
      style={[
        styles.layer,
        { opacity: size && !hidden ? appear : 0 },
        size && {
          transform: [
            { translateX: layer.x - size.width / 2 },
            { translateY: layer.y - size.height / 2 },
            { rotate: `${layer.rotation}rad` },
            { scale: Animated.multiply(appear.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }), layer.scale) },
          ],
        },
      ]}
    >
      <Text style={styles.emoji}>{layer.emoji}</Text>
    </Animated.View>
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
