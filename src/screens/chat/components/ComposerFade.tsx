import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect as SvgRect, Stop } from 'react-native-svg';

import { useColors } from '../../../theme';

import { COMPOSER_FADE_HEIGHT, COMPOSER_FADE_STOPS } from '../constants';

// Le fond s'efface doucement vers la zone de saisie. Placé sous la liste, il ne couvre jamais les messages.
export function ComposerFade() {
  const colors = useColors();
  return (
    <View pointerEvents="none" style={styles.composerFade}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="composerFade" x1="0" y1="0" x2="0" y2="1">
            {COMPOSER_FADE_STOPS.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={colors.background} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <SvgRect width="100%" height="100%" fill="url(#composerFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  composerFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Dépasse un peu sous la saisie : sur certains écrans, un arrondi laisserait voir le fond sur un pixel.
    bottom: -2,
    height: COMPOSER_FADE_HEIGHT,
  },
});
