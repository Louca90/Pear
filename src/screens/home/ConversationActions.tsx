import { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

import { t } from '../../i18n';
import { createStyles, radius, spacing, useColors } from '../../theme';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const MENU_GAP = spacing.sm;
const ITEM_HEIGHT = 48;

export type ConversationAction = { label: string; icon: LucideIcon; onPress: () => void; danger?: boolean };
export type Rect = { x: number; y: number; width: number; height: number };

type Props = {
  rect: Rect;
  // La ligne telle qu'affichée dans la liste, recopiée au-dessus du fond assombri.
  row: ReactNode;
  actions: ConversationAction[];
  onClose: () => void;
};

// Appui long sur une conversation : la ligne se soulève sur un fond assombri et un petit menu apparaît
// dessous (ou dessus s'il n'y a pas la place), comme la sélection d'un message.
export function ConversationActions({ rect, row, actions, onClose }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const menuHeight = actions.length * ITEM_HEIGHT + spacing.sm * 2;
  const below = rect.y + rect.height + MENU_GAP + menuHeight < height - spacing.lg;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) =>
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      onClose();
      then?.();
    });

  const menuTop = below ? rect.y + rect.height + MENU_GAP : rect.y - MENU_GAP - menuHeight;
  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={() => close()}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.lifted,
          { top: rect.y, left: rect.x, width: rect.width, height: rect.height },
        ]}
      >
        {row}
        {/* Le liseré reste dans la ligne : elle ne grandit plus, rien ne dépasse de l'écran. */}
        <Animated.View pointerEvents="none" style={[styles.ring, { opacity: progress }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.menu,
          { top: menuTop, left: rect.x + spacing.md },
          {
            opacity: progress,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [below ? -8 : 8, 0] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
      >
        {actions.map(({ label, icon: Icon, onPress, danger }) => (
          <Pressable key={label} onPress={() => close(onPress)} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
            <Icon size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.75} />
            <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  dim: {
    backgroundColor: colors.overlay,
  },
  lifted: {
    position: 'absolute',
    borderRadius: radius.md,
    backgroundColor: colors.elevated,
    overflow: 'hidden',
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  menu: {
    position: 'absolute',
    minWidth: 220,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.elevated,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: ITEM_HEIGHT,
    paddingHorizontal: spacing.md,
  },
  label: {
    fontSize: 16,
    color: colors.text,
  },
  danger: {
    color: colors.danger,
  },
  pressed: {
    opacity: 0.6,
  },
}));
