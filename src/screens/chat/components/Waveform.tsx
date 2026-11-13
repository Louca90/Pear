import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

import { useSmoothProgress } from '../hooks/useSmoothProgress';
import { ViewRef } from '../types';

const BAR_GAP = 2;
const MIN_BAR_WIDTH = 2;
const MAX_BAR_WIDTH = 3.5;
const HEIGHT = 30;
const MIN_BAR = 3;
const MAX_BAR = 28;
// La zone de toucher déborde au-dessus et au-dessous des barres (44 points en tout).
const TOUCH_SLOP = { top: 7, bottom: 7, left: 0, right: 0 };

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

function Bars({ bars, color, barWidth }: { bars: number[]; color: string; barWidth: number }) {
  return (
    <>
      {bars.map((level, index) => (
        <View key={index} style={{ width: barWidth, borderRadius: barWidth / 2, height: MIN_BAR + level * (MAX_BAR - MIN_BAR), backgroundColor: color }} />
      ))}
    </>
  );
}

// Forme d'onde d'un vocal (lot 4.2). Les barres sont dessinées deux fois : grises dessous, de la couleur
// du texte dessus, dans un cadre dont la largeur suit la lecture sur le fil natif. La partie écoutée
// avance ainsi en continu, au pixel près, au lieu de colorer les barres une à une. Toucher ou glisser
// déplace la lecture, comme sur la barre simple (SeekBar).
// Refonte (lot 4 de la section 3) : les barres occupent toute la largeur donnée par la bulle.
export function Waveform({ bars, position, speed = 0, color, restColor, label, onSeek }: Props) {
  const area = useRef<ViewRef>(null);
  const origin = useRef(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [available, setAvailable] = useState(0);
  const count = Math.max(1, bars.length);
  const natural = count * (MAX_BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const barWidth = available > 0 ? Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, (available - BAR_GAP * (count - 1)) / count)) : 3;
  const width = count * (barWidth + BAR_GAP) - BAR_GAP;
  const shown = useSmoothProgress(position, dragging === null ? speed : 0, dragging);
  const played = useAnimatedStyle(() => ({ width: shown.get() * width }));

  const seekTo = (pageX: number) => {
    const ratio = Math.max(0, Math.min(1, (pageX - origin.current) / width));
    setDragging(ratio);
    onSeek(ratio);
  };

  return (
    <View style={styles.frame} onLayout={(event) => setAvailable(Math.min(natural, event.nativeEvent.layout.width))}>
      <View
        ref={area}
        collapsable={false}
        hitSlop={TOUCH_SLOP}
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
          <Bars bars={bars} color={restColor} barWidth={barWidth} />
        </View>
        <Reanimated.View pointerEvents="none" style={[styles.clip, played]}>
          <View style={[styles.row, { width }]}>
            <Bars bars={bars} color={color} barWidth={barWidth} />
          </View>
        </Reanimated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    height: HEIGHT,
  },
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
});
