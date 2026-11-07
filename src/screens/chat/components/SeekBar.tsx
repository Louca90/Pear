import { useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { radius } from '../../../theme';

import { SEEK_THUMB_SIZE } from '../constants';
import { ViewRef } from '../types';

type SeekBarProps = {
  position: number;
  color: string;
  trackColor: string;
  label: string;
  onSeek: (ratio: number) => void;
};

// Une fois la barre attrapée, le doigt peut aller n'importe où : la position suit seulement sa place à l'horizontale.
// Bloquer le geste natif empêche aussi la liste de défiler, jusqu'à ce qu'on lâche.
export function SeekBar({ position, color, trackColor, label, onSeek }: SeekBarProps) {
  const area = useRef<ViewRef>(null);
  const origin = useRef(0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const thumb = useRef(new Animated.Value(1)).current;
  const trackWidth = Math.max(0, width - SEEK_THUMB_SIZE);
  const shown = dragging ?? position;

  const growThumb = (toValue: number) => Animated.spring(thumb, { toValue, useNativeDriver: true, overshootClamping: true, damping: 12, stiffness: 320 }).start();

  const seekTo = (pageX: number) => {
    if (trackWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, (pageX - origin.current - SEEK_THUMB_SIZE / 2) / trackWidth));
    setDragging(ratio);
    onSeek(ratio);
  };

  const end = () => {
    setDragging(null);
    growThumb(1);
  };

  return (
    <View
      ref={area}
      collapsable={false}
      style={styles.seekArea}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        const { pageX, locationX } = event.nativeEvent;
        origin.current = pageX - locationX;
        growThumb(1.4);
        seekTo(pageX);
        return true;
      }}
      onResponderMove={(event) => seekTo(event.nativeEvent.pageX)}
      onResponderRelease={end}
      onResponderTerminate={end}
      accessibilityLabel={label}
    >
      <View pointerEvents="none" style={[styles.seekTrack, { backgroundColor: trackColor }]}>
        <View style={[styles.seekBar, { width: `${shown * 100}%`, backgroundColor: color }]} />
      </View>
      <Animated.View
        pointerEvents="none"
        style={[styles.seekThumb, { left: shown * trackWidth, backgroundColor: color, transform: [{ scale: thumb }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  seekArea: {
    height: 44,
    justifyContent: 'center',
  },
  seekTrack: {
    marginHorizontal: SEEK_THUMB_SIZE / 2,
    height: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  seekBar: {
    height: 4,
  },
  seekThumb: {
    position: 'absolute',
    top: (44 - SEEK_THUMB_SIZE) / 2,
    width: SEEK_THUMB_SIZE,
    height: SEEK_THUMB_SIZE,
    borderRadius: radius.full,
  },
});
