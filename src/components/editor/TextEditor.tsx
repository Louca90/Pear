import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { haptics } from '../../haptics';

import { t, TextKey } from '../../i18n';
import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';
import { useInsets } from '../ui';
import { TEXT_BACKGROUNDS, TEXT_COLORS, TEXT_FONTS, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TextBackground, TextFont, TextLayer } from './layers';
import { FONT_STYLES, textLook } from './TextLayerView';
import { VerticalSlider } from './VerticalSlider';

const OPEN_MS = 160;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const SLIDER_HEIGHT = 220;
const MAX_LENGTH = 200;

const FONT_LABELS: Record<TextFont, TextKey> = {
  classic: 'editeur.policeClassique',
  strong: 'editeur.policeForte',
  elegant: 'editeur.policeElegante',
  typewriter: 'editeur.policeMachine',
  hand: 'editeur.policeManuscrite',
};
const BACKGROUND_LABELS: Record<TextBackground, TextKey> = {
  none: 'editeur.fondAucun',
  solid: 'editeur.fondPlein',
  soft: 'editeur.fondVoile',
};

function vibrate() {
  haptics.select();
}

type Props = { layer: TextLayer; maxWidth: number; onDone: (layer: TextLayer) => void };

// Écrire ou modifier un texte, comme sur Snap ou Instagram : la police en haut, la taille à gauche,
// les couleurs au-dessus du clavier, le texte au milieu tel qu'il sera posé.
export function TextEditor({ layer, maxWidth, onDone }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top } = useInsets();
  const [draft, setDraft] = useState(layer);
  const [keyboard, setKeyboard] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setKeyboard(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [progress]);

  const finish = () => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    Animated.timing(progress, { toValue: 0, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start(() => onDone({ ...draft, text: draft.text.trim() }));
  };

  const change = (fields: Partial<TextLayer>) => setDraft((current) => ({ ...current, ...fields }));
  const nextBackground = () => {
    vibrate();
    change({ background: TEXT_BACKGROUNDS[(TEXT_BACKGROUNDS.indexOf(draft.background) + 1) % TEXT_BACKGROUNDS.length] });
  };
  const look = textLook(draft.font, draft.color, draft.background, draft.size);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={finish} accessibilityLabel={t('editeur.termine')} />

      <View style={[styles.topRow, { top: top + spacing.md }]}>
        <Pressable onPress={nextBackground} style={[styles.backgroundButton, draft.background !== 'none' && styles.backgroundButtonOn]} accessibilityLabel={t(BACKGROUND_LABELS[draft.background])}>
          <Text style={[styles.backgroundIcon, draft.background !== 'none' && { color: colors.text }]}>A</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('editeur.termine')} onPress={finish} style={styles.done}>
          <Text style={styles.doneLabel}>{t('editeur.termine')}</Text>
        </Pressable>
      </View>

      <View style={[styles.fonts, { top: top + spacing.md + 44 + spacing.md }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fontsContent} keyboardShouldPersistTaps="always">
          {TEXT_FONTS.map((font) => (
            <Pressable
              key={font}
              onPress={() => {
                vibrate();
                change({ font });
              }}
              accessibilityRole="button"
              accessibilityLabel={t(FONT_LABELS[font])}
              accessibilityState={{ selected: draft.font === font }}
              style={[styles.fontChip, draft.font === font && styles.fontChipOn]}
            >
              <Text style={[styles.fontLabel, FONT_STYLES[font], draft.font === font && { color: colors.text }]}>{t(FONT_LABELS[font])}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={[styles.sliderWrap, { top: top + 170 }]}>
        <VerticalSlider value={draft.size} min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} height={SLIDER_HEIGHT} label={t('editeur.taille')} onChange={(size) => change({ size })} />
      </View>

      <View pointerEvents="box-none" style={[styles.center, { paddingBottom: keyboard + 72 }]}>
        <View style={[look.box, { maxWidth }]}>
          <TextInput
            autoFocus
            multiline
            value={draft.text}
            onChangeText={(text) => change({ text })}
            maxLength={MAX_LENGTH}
            placeholder={t('editeur.ecrire')}
            placeholderTextColor={colors.onDarkMuted}
            style={[look.text, styles.input]}
            selectionColor={draft.color}
          />
        </View>
      </View>

      <View style={[styles.colors, { bottom: keyboard + spacing.md }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorsContent} keyboardShouldPersistTaps="always">
          {TEXT_COLORS.map((color) => (
            <Pressable
              key={color}
              onPress={() => {
                vibrate();
                change({ color });
              }}
              accessibilityRole="button" accessibilityLabel={t('editeur.couleur', { n: TEXT_COLORS.indexOf(color) + 1 })}
              accessibilityState={{ selected: draft.color === color }}
              style={[styles.color, { backgroundColor: color }, draft.color === color && styles.colorOn]}
            />
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  topRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backgroundButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backgroundButtonOn: {
    backgroundColor: colors.background,
  },
  backgroundIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.background,
  },
  done: {
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  doneLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  fonts: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  fontsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  fontChip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
  },
  fontChipOn: {
    backgroundColor: colors.background,
  },
  fontLabel: {
    fontSize: 15,
    color: colors.background,
  },
  sliderWrap: {
    position: 'absolute',
    left: spacing.md,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 56,
  },
  input: {
    minWidth: 40,
    padding: 0,
  },
  colors: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  colorsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
    alignItems: 'center',
    height: 44,
  },
  color: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  colorOn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
  },
}));
