import { RefObject, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { SmilePlus } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { QUICK_REACTIONS } from '../../../chat/emojis';
import { IconButton, useNavigationBarHeight } from '../../../components/ui';
import { colors, radius, spacing } from '../../../theme';

import { EmojiPicker } from './EmojiPicker';
import { Bubble } from './MessageBubble';
import { ACTION_HEIGHT, REACTIONS_HEIGHT, SELECTION_CLOSE_MS, SELECTION_GAP, SELECTION_SPRING, SELECTION_TOP, TEXT_LINE_HEIGHT } from '../constants';
import { Action, Palettes, Rect, ViewRef } from '../types';

type SelectionProps = {
  message: Message;
  name: string;
  palettes: Palettes;
  rect: Rect;
  origin: { y: number; height: number };
  blurTarget: RefObject<ViewRef | null>;
  actions: Action[];
  onReact: (emoji: string) => void;
  onClose: () => void;
};

// Comme dans Google Messages : tout s'assombrit et se floute, le message monte et grossit,
// avec les réactions au-dessus et les actions en dessous.
export function MessageSelection({ message, name, palettes, rect, origin, blurTarget, actions, onReact, onClose }: SelectionProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [pickerOpen, setPickerOpen] = useState(false);
  const closing = useRef(false);
  const [open, setOpen] = useState(true);
  const mine = message.mine === 1;
  const bottom = useNavigationBarHeight();

  // Le message redescend à sa place, puis l'action choisie s'exécute.
  const dismiss = useRef((after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    Animated.timing(progress, { toValue: 0, duration: SELECTION_CLOSE_MS, useNativeDriver: true }).start(() => {
      onClose();
      after?.();
    });
  }).current;

  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...SELECTION_SPRING }).start();
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => back.remove();
  }, [progress, dismiss]);

  const react = (emoji: string) => {
    setPickerOpen(false);
    dismiss(() => onReact(emoji));
  };

  // Le message se place pour laisser la place aux réactions et aux actions, sans sortir de l'écran.
  const menuHeight = actions.length * ACTION_HEIGHT + spacing.sm * 2;
  const startY = rect.y - origin.y;
  // Un message trop long est raccourci ici seulement, pour que réactions et actions restent à l'écran.
  const topLimit = SELECTION_TOP + REACTIONS_HEIGHT;
  const maxHeight = Math.max(TEXT_LINE_HEIGHT * 2, origin.height - bottom - spacing.lg - menuHeight - SELECTION_GAP - topLimit);
  const shownHeight = Math.min(rect.height, maxHeight);
  const fit = rect.height > maxHeight ? { maxHeight, fullHeight: rect.height, open } : undefined;
  const lowest = origin.height - bottom - spacing.lg - menuHeight - SELECTION_GAP - shownHeight;
  const targetY = Math.max(topLimit, Math.min(startY - spacing.sm, lowest));
  const edge = mine ? styles.alignEnd : styles.alignStart;

  const appear = {
    opacity: progress,
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={40} tint="default" style={StyleSheet.absoluteFill} />
        <View style={styles.selectionDim} />
      </Animated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel="Fermer" />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.selected,
          {
            top: startY,
            left: spacing.md,
            right: spacing.md,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, targetY - startY] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) },
            ],
          },
        ]}
      >
        <Bubble message={message} name={name} palettes={palettes} fit={fit} />
      </Animated.View>

      <Animated.View style={[styles.reactionBar, edge, { top: targetY - REACTIONS_HEIGHT - spacing.sm }, appear]}>
        {QUICK_REACTIONS.map((emoji) => (
          <IconButton key={emoji} onPress={() => react(emoji)} label={emoji} hitSlop={4} style={styles.reactionOption}>
            <Text style={[styles.reactionChoice, message.my_reaction === emoji && styles.reactionActive]}>{emoji}</Text>
          </IconButton>
        ))}
        <IconButton onPress={() => setPickerOpen(true)} label="Tous les emojis" hitSlop={4} style={styles.reactionOption}>
          <SmilePlus size={24} color={colors.text} strokeWidth={1.75} />
        </IconButton>
      </Animated.View>

      <Animated.View style={[styles.actionsMenu, edge, { top: targetY + shownHeight + SELECTION_GAP }, appear]}>
        {actions.map(({ label, icon: Icon, onPress, danger }) => (
          <Pressable key={label} onPress={() => dismiss(onPress)} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
            <Icon size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.75} />
            <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
          </Pressable>
        ))}
      </Animated.View>

      {pickerOpen && <EmojiPicker onPick={react} onClose={() => setPickerOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  alignEnd: {
    right: spacing.md,
  },
  alignStart: {
    left: spacing.md,
  },
  selectionDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.selectionDim,
  },
  selected: {
    position: 'absolute',
  },
  reactionBar: {
    position: 'absolute',
    height: REACTIONS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.background,
  },
  reactionOption: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionChoice: {
    fontSize: 26,
  },
  reactionActive: {
    opacity: 0.45,
  },
  actionsMenu: {
    position: 'absolute',
    // Le fond d'appui des lignes du haut et du bas reste dans les coins arrondis du menu.
    overflow: 'hidden',
    minWidth: 200,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: ACTION_HEIGHT,
    paddingHorizontal: spacing.md,
  },
  actionPressed: {
    backgroundColor: colors.surface,
  },
  actionLabel: {
    fontSize: 16,
    color: colors.text,
  },
});
