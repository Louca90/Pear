import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

import { useSmoothProgress } from '../hooks/useSmoothProgress';
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
  // Part de la durée parcourue par seconde pendant la lecture (0 en pause).
  speed?: number;
  color: string;
  restColor: string;
  label: string;
  onSeek: (ratio: number) => void;
};

function Bars({ bars, color }: { bars: number[]; color: string }) {
  return (
    <>
      {bars.map((level, index) => (
        <View key={index} style={[styles.bar, { height: MIN_BAR + level * (MAX_BAR - MIN_BAR), backgroundColor: color }]} />
      ))}
    </>
  );
}

// Forme d'onde d'un vocal (lot 4.2). Les barres sont dessinées deux fois : grises dessous, de la couleur
// du texte dessus, dans un cadre dont la largeur suit la lecture sur le fil natif. La partie écoutée
// avance ainsi en continu, au pixel près, au lieu de colorer les barres une à une. Toucher ou glisser
// déplace la lecture, comme sur la barre simple (SeekBar).
export function Waveform({ bars, position, speed = 0, color, restColor, label, onSeek }: Props) {
  const area = useRef<ViewRef>(null);
  const origin = useRef(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const width = bars.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const shown = useSmoothProgress(position, dragging === null ? speed : 0, dragging);
  const played = useAnimatedStyle(() => ({ width: shown.get() * width }));

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
      <View pointerEvents="none" style={styles.row}>
        <Bars bars={bars} color={restColor} />
      </View>
      <Reanimated.View pointerEvents="none" style={[styles.clip, played]}>
        <View style={[styles.row, { width }]}>
          <Bars bars={bars} color={color} />
        </View>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    height: HEIGHT,
    justifyContent: 'center',
  },
  row: {
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
  },
  clip: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: HEIGHT,
    overflow: 'hidden',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
});
