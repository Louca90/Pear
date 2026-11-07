import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

import { createMediaStyles, radius, spacing, useMediaColors } from '../../theme';
import { IconButton } from '../ui';

export const TOOL_SIZE = 44;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
// Les noms des outils se montrent à l'ouverture de l'éditeur, puis s'effacent.
const LABELS_VISIBLE_MS = 1600;
const FADE_MS = 220;

export type EditorTool = { id: string; icon: LucideIcon; label: string; active?: boolean; onPress: () => void };

// La colonne d'outils, à droite, sous les boutons du haut. Elle s'efface quand un outil occupe l'écran.
export function EditorToolbar({ tools, top, hidden }: { tools: EditorTool[]; top: number; hidden: boolean }) {
  const colors = useMediaColors();
  const styles = useStyles();
  const visible = useRef(new Animated.Value(1)).current;
  const labels = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(visible, { toValue: hidden ? 0 : 1, duration: FADE_MS, easing: EASING, useNativeDriver: true }).start();
  }, [hidden, visible]);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(labels, { toValue: 1, duration: FADE_MS, easing: EASING, useNativeDriver: true }),
      Animated.delay(LABELS_VISIBLE_MS),
      Animated.timing(labels, { toValue: 0, duration: FADE_MS * 1.5, easing: EASING, useNativeDriver: true }),
    ]).start();
  }, [labels]);

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.column, { top, opacity: visible, transform: [{ translateX: visible.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}
    >
      {tools.map(({ id, icon: Icon, label, active, onPress }) => (
        <View key={id} style={styles.row}>
          <Animated.Text
            pointerEvents="none"
            style={[styles.label, { opacity: labels, transform: [{ translateX: labels.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
          >
            {label}
          </Animated.Text>
          <IconButton onPress={onPress} label={label} style={[styles.button, active && styles.buttonActive]}>
            <Icon size={22} color={active ? colors.text : colors.background} strokeWidth={1.75} />
          </IconButton>
        </View>
      ))}
    </Animated.View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  column: {
    position: 'absolute',
    right: spacing.md,
    gap: spacing.md,
    alignItems: 'flex-end',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.background,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  button: {
    width: TOOL_SIZE,
    height: TOOL_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: colors.background,
  },
}));

