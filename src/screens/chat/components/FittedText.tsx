import { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect as SvgRect, Stop } from 'react-native-svg';

import { SELECTION_CLOSE_MS, SELECTION_SPRING, TEXT_LINE_HEIGHT } from '../constants';

// Place disponible pour toute la bulle, et sa hauteur réelle dans la conversation.
// open passe à false à la fermeture : le texte se déplie en redescendant à sa place.
export type TextFit = { maxHeight: number; fullHeight: number; open: boolean };

type Props = {
  text: string;
  style: StyleProp<TextStyle>;
  // Couleur de la bulle : le texte coupé s'y fond en bas.
  background: string;
  fit?: TextFit;
};

// Sélection d'un message trop long : le texte part de sa vraie hauteur et se replie, en même temps que
// la bulle monte, jusqu'à tenir à l'écran. La coupure s'efface en fondu dans la couleur de la bulle.
export function FittedText({ text, style, background, fit }: Props) {
  const height = useRef(new Animated.Value(0)).current;
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!range) return;
    height.setValue(range.from);
    Animated.spring(height, { toValue: range.to, useNativeDriver: false, ...SELECTION_SPRING }).start();
  }, [range, height]);

  const open = fit?.open ?? true;
  useEffect(() => {
    if (range && !open) Animated.timing(height, { toValue: range.from, duration: SELECTION_CLOSE_MS, useNativeDriver: false }).start();
  }, [open, range, height]);

  const measure = (textHeight: number) => {
    if (!fit || range) return;
    // Ce qui entoure le texte (marges, citation, heure) garde sa taille : seul le texte se replie.
    const room = fit.maxHeight - (fit.fullHeight - textHeight);
    const to = Math.max(TEXT_LINE_HEIGHT * 2, Math.floor(room / TEXT_LINE_HEIGHT) * TEXT_LINE_HEIGHT);
    if (to < textHeight) setRange({ from: textHeight, to });
  };

  if (!fit) return <Text style={style}>{text}</Text>;

  return (
    <Animated.View style={range && { height, overflow: 'hidden' }}>
      <Text style={style} onLayout={(event) => measure(event.nativeEvent.layout.height)}>{text}</Text>
      {range && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fade, { opacity: height.interpolate({ inputRange: [range.to, range.from], outputRange: [1, 0], extrapolate: 'clamp' }) }]}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="textFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset={0} stopColor={background} stopOpacity={0} />
                <Stop offset={1} stopColor={background} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <SvgRect width="100%" height="100%" fill="url(#textFade)" />
          </Svg>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: TEXT_LINE_HEIGHT * 2,
  },
});
