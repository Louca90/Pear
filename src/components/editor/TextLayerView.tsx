import { StyleSheet, Text, TextStyle, View } from 'react-native';

import { readableOn, Size, TextBackground, TextFont, TextLayer } from './layers';

// Les polices du système Android : rien à télécharger, toujours là.
export const FONT_STYLES: Record<TextFont, TextStyle> = {
  classic: { fontFamily: 'sans-serif', fontWeight: '600' },
  strong: { fontFamily: 'sans-serif-black', fontWeight: '900', letterSpacing: -0.5 },
  elegant: { fontFamily: 'serif', fontStyle: 'italic' },
  typewriter: { fontFamily: 'monospace', fontWeight: '500' },
  hand: { fontFamily: 'cursive', fontWeight: '700' },
};

const SOFT_BACKGROUND = 'rgba(0, 0, 0, 0.55)';

// Le texte lui-même, selon sa police, sa couleur et son fond.
export function textLook(font: TextFont, color: string, background: TextBackground, size: number): { box: object; text: TextStyle } {
  const text: TextStyle = { ...FONT_STYLES[font], fontSize: size, lineHeight: Math.round(size * 1.25), textAlign: 'center' };
  if (background === 'solid') return { box: { backgroundColor: color, ...styles.boxed, borderRadius: size * 0.35 }, text: { ...text, color: readableOn(color) } };
  if (background === 'soft') return { box: { backgroundColor: SOFT_BACKGROUND, ...styles.boxed, borderRadius: size * 0.35 }, text: { ...text, color } };
  return { box: styles.bare, text: { ...text, color, ...styles.shadow } };
}

type Props = {
  layer: TextLayer;
  maxWidth: number;
  // Le calque se mesure une fois posé : sa taille sert à le placer par son centre et à le toucher.
  size: Size | undefined;
  onMeasure?: (id: string, size: Size) => void;
  hidden?: boolean;
};

// Placé par son centre : la vue est décalée de la moitié de sa taille, puis tournée et agrandie autour
// de son centre (l'origine des transformations de React Native).
export function TextLayerView({ layer, maxWidth, size, onMeasure, hidden }: Props) {
  const look = textLook(layer.font, layer.color, layer.background, layer.size);
  return (
    <View
      pointerEvents="none"
      onLayout={onMeasure && (({ nativeEvent }) => onMeasure(layer.id, { width: nativeEvent.layout.width, height: nativeEvent.layout.height }))}
      style={[
        styles.layer,
        { maxWidth, opacity: size && !hidden ? 1 : 0 },
        size && {
          transform: [{ translateX: layer.x - size.width / 2 }, { translateY: layer.y - size.height / 2 }, { rotate: `${layer.rotation}rad` }, { scale: layer.scale }],
        },
        look.box,
      ]}
    >
      <Text style={look.text}>{layer.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  boxed: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  bare: {
    paddingHorizontal: 4,
  },
  shadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
