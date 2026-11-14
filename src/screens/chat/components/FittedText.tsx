import { useState } from 'react';
import { Linking, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import Reanimated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect as SvgRect, Stop } from 'react-native-svg';

import { TEXT_LINE_HEIGHT } from '../constants';
import { splitLinks } from '../format';
import { log } from '../../../log';

// Place disponible pour toute la bulle, sa hauteur réelle dans la conversation, et l'avancement de la
// sélection (0 : à sa place, 1 : sélectionné) qui pilote aussi le repli du texte.
export type TextFit = { maxHeight: number; fullHeight: number; progress: SharedValue<number> };

type Props = {
  text: string;
  style: StyleProp<TextStyle>;
  // Couleur de la bulle : le texte coupé s'y fond en bas.
  background: string;
  fit?: TextFit;
};

// Les liens du message, soulignés et ouverts dans le navigateur au toucher. Le reste du texte garde
// les gestes de la bulle (appui long, double tap, glisser pour répondre).
function LinkedText({ text }: { text: string }) {
  return splitLinks(text).map((part, index) =>
    part.url ? (
      <Text key={index} style={styles.link} onPress={() => Linking.openURL(part.url ?? '').catch((e) => log.warn('lien', e))}>
        {part.text}
      </Text>
    ) : (
      part.text
    ),
  );
}

// Sélection d'un message trop long : le texte se replie pendant que la bulle monte, et se déplie quand
// elle redescend, au même rythme puisque c'est la même valeur qui anime les deux.
export function FittedText({ text, style, background, fit }: Props) {
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);

  const measure = (textHeight: number) => {
    if (!fit || range) return;
    // Ce qui entoure le texte (marges, citation, heure) garde sa taille : seul le texte se replie.
    const room = fit.maxHeight - (fit.fullHeight - textHeight);
    const to = Math.max(TEXT_LINE_HEIGHT * 2, Math.floor(room / TEXT_LINE_HEIGHT) * TEXT_LINE_HEIGHT);
    if (to < textHeight) setRange({ from: textHeight, to });
  };

  if (!fit) return <Text style={style}><LinkedText text={text} /></Text>;
  return <Folding text={text} style={style} background={background} fit={fit} range={range} onMeasure={measure} />;
}

function Folding({ text, style, background, fit, range, onMeasure }: Props & { fit: TextFit; range: { from: number; to: number } | null; onMeasure: (height: number) => void }) {
  const progress = fit.progress;
  const height = useAnimatedStyle(() => (range ? { height: interpolate(progress.get(), [0, 1], [range.from, range.to]), overflow: 'hidden' } : {}));
  // Le fondu arrive un peu après le début du repli, quand le texte commence vraiment à être coupé.
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0.2, 0.8], [0, 1], 'clamp') }));

  return (
    <Reanimated.View style={height}>
      <Text style={style} onLayout={(event) => onMeasure(event.nativeEvent.layout.height)}>
        <LinkedText text={text} />
      </Text>
      {range && (
        <Reanimated.View pointerEvents="none" style={[styles.fade, fade]}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="textFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset={0} stopColor={background} stopOpacity={0} />
                <Stop offset={1} stopColor={background} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <SvgRect width="100%" height="100%" fill="url(#textFade)" />
          </Svg>
        </Reanimated.View>
      )}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  link: {
    textDecorationLine: 'underline',
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: TEXT_LINE_HEIGHT * 2,
  },
});
