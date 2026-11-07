import { RefObject, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { SmilePlus } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { QUICK_REACTIONS } from '../../../chat/emojis';
import { GroupPosition } from '../../../chat/grouping';
import { IconButton } from '../../../components/ui';
import { useBackInterceptor } from '../../../navigation/backInterceptors';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { EmojiPicker } from './EmojiPicker';
import { Bubble } from './MessageBubble';
import { ACTION_HEIGHT, REACTIONS_HEIGHT, SELECTION_CLOSE_MS, SELECTION_EASING, SELECTION_GAP, SELECTION_OPEN_MS } from '../constants';
import { Action, Palettes, Rect, ViewRef } from '../types';
import { t } from '../../../i18n';

// Grossissement léger du message soulevé.
const LIFT_SCALE = 1.03;
// Place gardée sous un message de milieu de groupe pour sa ligne heure/coches, qui s'ouvre.
const META_ROOM = 22;
const META_MS = 200;

// La disposition de la sélection, aussi utilisée par la conversation : un message trop long pour la
// place disponible est montré dans un aperçu qui défile, et son original reste à sa place dessous.
export function selectionLayout(rect: Rect, origin: { y: number }, clip: { top: number; bottom: number }, actionCount: number, metaRoom: number) {
  const areaTop = clip.top - origin.y;
  const areaBottom = clip.bottom - origin.y;
  const menuHeight = actionCount * ACTION_HEIGHT + spacing.sm * 2;
  const previewTop = areaTop + spacing.sm + REACTIONS_HEIGHT + spacing.sm;
  const previewBottom = areaBottom - spacing.sm - menuHeight - SELECTION_GAP;
  const needed = rect.height + metaRoom;
  const previewHeight = Math.max(ACTION_HEIGHT, Math.min(needed, previewBottom - previewTop));
  const startY = rect.y - origin.y;
  return {
    areaTop,
    areaBottom,
    previewHeight,
    tooLong: needed > previewHeight,
    startY,
    targetY: Math.max(previewTop, Math.min(startY, previewBottom - previewHeight)),
  };
}

export const metaRoomFor = (position: GroupPosition) => (position === 'first' || position === 'middle' ? META_ROOM : 0);

type SelectionProps = {
  message: Message;
  name: string;
  palettes: Palettes;
  // La bulle telle qu'elle est dans la conversation : place dans son groupe et photo du contact.
  position: GroupPosition;
  avatar: string | null;
  rect: Rect;
  origin: { y: number; height: number };
  // La zone de la conversation (entre la barre du haut et la saisie, au-dessus du clavier s'il est
  // ouvert), en coordonnées de la fenêtre : le message, les réactions et les actions y restent.
  clip: { top: number; bottom: number };
  blurTarget: RefObject<ViewRef | null>;
  actions: Action[];
  onReact: (emoji: string) => void;
  onClose: () => void;
};

// Sélection d'un message : le fond se floute et s'assombrit, le message monte légèrement, les réactions
// restent fixées au-dessus et les actions en dessous. Un message trop long s'affiche dans un aperçu à
// hauteur limitée qu'on fait défiler (au lieu d'être replié). Toutes les animations passent par le
// pilote natif : position, taille et fondus restent fluides, clavier ouvert ou non.
export function MessageSelection({ message, name, palettes, position, avatar, rect, origin, clip, blurTarget, actions, onReact, onClose }: SelectionProps) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useRef(new Animated.Value(0)).current;
  // Piloté en JS : il anime une hauteur (la ligne heure/coches qui s'ouvre).
  const metaReveal = useRef(new Animated.Value(0)).current;
  const [pickerOpen, setPickerOpen] = useState(false);
  const closing = useRef(false);
  const mine = message.mine === 1;

  const dismiss = useRef((after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(metaReveal, { toValue: 0, duration: SELECTION_CLOSE_MS, easing: SELECTION_EASING, useNativeDriver: false }).start();
    Animated.timing(progress, { toValue: 0, duration: SELECTION_CLOSE_MS, easing: SELECTION_EASING, useNativeDriver: true }).start(() => {
      onClose();
      after?.();
    });
  }).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: SELECTION_OPEN_MS, easing: SELECTION_EASING, useNativeDriver: true }).start();
    Animated.timing(metaReveal, { toValue: 1, duration: META_MS, delay: 60, easing: SELECTION_EASING, useNativeDriver: false }).start();
  }, [progress, metaReveal]);

  // Le retour ferme la sélection sans quitter la conversation.
  useBackInterceptor(true, () => dismiss());

  const react = (emoji: string) => {
    setPickerOpen(false);
    dismiss(() => onReact(emoji));
  };

  const { areaTop, areaBottom, previewHeight, tooLong, startY, targetY } = selectionLayout(rect, origin, clip, actions.length, metaRoomFor(position));
  const edge = mine ? styles.alignEnd : styles.alignStart;

  const appear = {
    opacity: progress,
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
  };

  const bubble = <Bubble message={message} name={name} palettes={palettes} position={position} avatar={avatar} spaced={false} metaReveal={metaReveal} />;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={40} tint="default" style={StyleSheet.absoluteFill} />
        <View style={styles.selectionDim} />
      </Animated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel={t('commun.fermer')} />

      {/* Le message reste dans la zone de la conversation pendant qu'il monte. */}
      <View pointerEvents="box-none" style={[styles.clip, { top: areaTop, height: areaBottom - areaTop }]}>
        <Animated.View
          pointerEvents={tooLong ? 'auto' : 'none'}
          style={[
            styles.selected,
            {
              height: previewHeight,
              // Message court : il monte depuis sa place. Message long : son original reste dans la
              // conversation et l'aperçu apparaît (puis disparaît) en fondu par-dessus, sans saut.
              ...(tooLong
                ? {
                    top: targetY - areaTop,
                    opacity: progress,
                    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
                  }
                : {
                    top: startY - areaTop,
                    transform: [
                      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, targetY - startY] }) },
                      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, LIFT_SCALE] }) },
                    ],
                  }),
            },
          ]}
        >
          {tooLong ? (
            <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {bubble}
            </ScrollView>
          ) : (
            bubble
          )}
        </Animated.View>
      </View>

      <Animated.View style={[styles.reactionBar, edge, { top: targetY - REACTIONS_HEIGHT - spacing.sm }, appear]}>
        {QUICK_REACTIONS.map((emoji) => (
          <IconButton key={emoji} onPress={() => react(emoji)} label={emoji} hitSlop={4} style={[styles.reactionOption, message.my_reaction === emoji && styles.reactionChosen]}>
            <Text style={styles.reactionChoice}>{emoji}</Text>
          </IconButton>
        ))}
        <IconButton onPress={() => setPickerOpen(true)} label={t('chat.tousEmojis')} hitSlop={4} style={styles.reactionOption}>
          <SmilePlus size={24} color={colors.text} strokeWidth={1.75} />
        </IconButton>
      </Animated.View>

      <Animated.View style={[styles.actionsMenu, edge, { top: targetY + previewHeight + SELECTION_GAP }, appear]}>
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

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
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
  clip: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  selected: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    overflow: 'hidden',
  },
  reactionBar: {
    position: 'absolute',
    height: REACTIONS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
  },
  reactionOption: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // La réaction déjà mise : un rond discret derrière (la toucher l'enlève).
  reactionChosen: {
    backgroundColor: colors.elevatedActive,
  },
  reactionChoice: {
    fontSize: 26,
  },
  actionsMenu: {
    position: 'absolute',
    // Le fond d'appui des lignes du haut et du bas reste dans les coins arrondis du menu.
    overflow: 'hidden',
    minWidth: 200,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.elevated,
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
}));
