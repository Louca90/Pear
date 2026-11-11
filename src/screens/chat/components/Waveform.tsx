import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ViewRef } from '../types';

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const HEIGHT = 44;
const MIN_BAR = 3;
const MAX_BAR = 28;

type Props = {
  // Hauteur de chaque barre, de 0 à 1.
  bars: number[];
  // Part déjà écoutée, de 0 à 1.
  position: number;
  color: string;
  restColor: string;
  label: string;
  onSeek: (ratio: number) => void;
};

// Forme d'onde d'un vocal (lot 4.2) : les barres déjà écoutées prennent la couleur du texte. Toucher ou
// glisser déplace la lecture, comme sur la barre simple (SeekBar).
export function Waveform({ bars, position, color, restColor, label, onSeek }: Props) {
  const area = useRef<ViewRef>(null);
  const origin = useRef(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const width = bars.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const shown = dragging ?? position;

  const seekTo = (pageX: number) => {
    const ratio = Math.max(0, Math.min(1, (pageX - origin.current) / width));
    setDragging(ratio);
    onSeek(ratio);
  };

  return (
    <View
      ref={area}
      collapsable={false}
      style={[styles.area, { width }]}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        const { pageX, locationX } = event.nativeEvent;
        origin.current = pageX - locationX;
        seekTo(pageX);
      }}
      onResponderMove={(event) => seekTo(event.nativeEvent.pageX)}
      onResponderRelease={() => setDragging(null)}
      onResponderTerminate={() => setDragging(null)}
      accessibilityLabel={label}
    >
      {bars.map((level, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={[styles.bar, { height: MIN_BAR + level * (MAX_BAR - MIN_BAR), backgroundColor: (index + 0.5) / bars.length <= shown ? color : restColor }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
});
