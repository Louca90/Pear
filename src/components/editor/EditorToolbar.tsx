import { ComponentType, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { t } from '../../i18n';
import { DURATION, timing } from '../../motion';
import { createMediaStyles, spacing, useMediaColors } from '../../theme';
import { usePressFeedback } from '../ui';

// Hauteur de la barre (outil compris son léger relèvement), pour poser les panneaux juste au-dessus.
export const TOOLBAR_HEIGHT = 70;
const ICON_SIZE = 22;
// L'outil choisi se relève de 2 points.
const LIFT = 2;
// La barre s'efface (fondu et glissement vers le bas) quand un outil plein écran l'a remplacée.
const HIDE_SHIFT = 14;

export type ToolIconProps = { size?: number; color?: string; strokeWidth?: number };

export type EditorTool = {
  id: string;
  icon: ComponentType<ToolIconProps>;
  label: string;
  // Un réglage en place (son coupé, vidéo découpée, filtre choisi…) : l'outil reste allumé en blanc.
  on?: boolean;
  onPress: () => void;
};

// L'icône de la catégorie Ambiance : trois cercles qui se chevauchent, au trait comme les autres outils.
export function AmbianceIcon({ size = 24, color, strokeWidth = 1.8 }: ToolIconProps) {
  const line = { fill: 'none', stroke: color, strokeWidth };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8} r={5} {...line} />
      <Circle cx={8.5} cy={15} r={5} {...line} />
      <Circle cx={15.5} cy={15} r={5} {...line} />
    </Svg>
  );
}

function ToolButton({ tool, selected }: { tool: EditorTool; selected: boolean }) {
  const colors = useMediaColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const progress = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    progress.set(timing(selected ? 1 : 0, DURATION.small));
  }, [selected, progress]);

  const rest = tool.on ? colors.background : colors.onDarkMuted;
  const lit = colors.signature;
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -LIFT * progress.get() }] }));
  const restIcon = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const litIcon = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const label = useAnimatedStyle(() => ({ color: interpolateColor(progress.get(), [0, 1], [rest, lit]) }));
  const Icon = tool.icon;

  return (
    <Pressable
      onPress={tool.onPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={tool.label}
      accessibilityState={{ selected, checked: tool.on }}
      hitSlop={4}
    >
      <Reanimated.View style={[styles.tool, feedback.style, lift]}>
        {/* Deux icônes superposées, en fondu croisé : la couleur change sur le fil natif. */}
        <View style={styles.icon}>
          <Reanimated.View style={[StyleSheet.absoluteFill, restIcon]}>
            <Icon size={ICON_SIZE} color={rest} strokeWidth={1.8} />
          </Reanimated.View>
          <Reanimated.View style={[StyleSheet.absoluteFill, litIcon]}>
            <Icon size={ICON_SIZE} color={lit} strokeWidth={1.8} />
          </Reanimated.View>
        </View>
        <Reanimated.Text numberOfLines={1} style={[styles.label, label]}>
          {tool.label}
        </Reanimated.Text>
      </Reanimated.View>
    </Pressable>
  );
}

// La barre d'outils du bas : une icône et son nom sous chaque outil ; l'outil choisi passe en couleur
// signature et se relève un peu. Elle défile si les outils ne tiennent pas (vidéo : huit outils).
// `bottom` : où la barre se pose ; `inset` : la place laissée dessous, dans la barre, pour celle d'Android.
export function EditorToolbar({ tools, selected, bottom, inset, hidden }: { tools: EditorTool[]; selected: string | null; bottom: number; inset: number; hidden: boolean }) {
  const styles = useStyles();
  const visible = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    visible.set(timing(hidden ? 0 : 1, DURATION.small));
  }, [hidden, visible]);
  const shown = useAnimatedStyle(() => ({ opacity: visible.get(), transform: [{ translateY: HIDE_SHIFT * (1 - visible.get()) }] }));

  return (
    <Reanimated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.bar, inset === 0 && styles.floating, { bottom, paddingBottom: inset }, shown]} accessibilityLabel={t('editeur.outils')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {tools.map((tool) => (
          <ToolButton key={tool.id} tool={tool} selected={selected === tool.id} />
        ))}
      </ScrollView>
    </Reanimated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.overlay,
  },
  // Posée au-dessus d'un bouton de l'écran parent : une pastille arrondie plutôt qu'une bande.
  floating: {
    left: spacing.sm,
    right: spacing.sm,
    borderRadius: 22,
    overflow: 'hidden',
  },
  row: {
    flexGrow: 1,
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
    paddingTop: 8,
    paddingBottom: 6,
  },
  tool: {
    minWidth: 60,
    minHeight: 52,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
}));
