import { ReactNode, RefObject, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, interpolate, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
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
import { ACTION_HEIGHT, REACTIONS_HEIGHT, SELECTION_CLOSE_MS, SELECTION_GAP } from '../constants';
import { Action, Palettes, Rect, ViewRef } from '../types';
import { t } from '../../../i18n';

// Grossissement léger du message soulevé.
const LIFT_SCALE = 1.03;
// Place gardée sous un message de milieu de groupe pour sa ligne heure/coches, qui s'ouvre.
const META_ROOM = 22;
const META_MS = 220;
const OPEN_MS = 320;
// Courbe douce, sans dépassement (planche « Sélection d'un message »).
const CURVE = Easing.bezier(0.2, 0.8, 0.2, 1);
const timing = (duration: number) => ({ duration, easing: CURVE, reduceMotion: ReduceMotion.System });

// Un texte trop long se replie pour tenir ; un média trop haut garde un aperçu qui défile.
export const canFold = (message: Message) => message.kind === 'text';

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

// Apparition décalée d'un élément d'une liste (émojis, lignes du menu) : chacun a sa part de
// l'avancement de la sélection, le suivant commence un peu après. À la fermeture, l'ordre s'inverse.
function Staggered({ progress, index, count, from, span, kind, children }: { progress: SharedValue<number>; index: number; count: number; from: number; span: number; kind: 'emoji' | 'rowStart' | 'rowEnd'; children: ReactNode }) {
  const step = Math.min(0.06, (1 - from - span) / Math.max(1, count - 1));
  const begin = from + index * step;
  const end = begin + span;
  const style = useAnimatedStyle(() => {
    const amount = interpolate(progress.get(), [begin, end], [0, 1], 'clamp');
    if (kind === 'emoji') return { opacity: amount, transform: [{ translateY: 8 * (1 - amount) }, { scale: 0.5 + 0.5 * amount }] };
    return { opacity: amount, transform: [{ translateX: (kind === 'rowEnd' ? 8 : -8) * (1 - amount) }] };
  });
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

// Sélection d'un message (planche « Sélection d'un message ») : le fond se floute et s'assombrit, le
// message monte de sa place et grossit de 3 %, les réactions sortent du coin de la bulle (émojis l'un
// après l'autre) et le menu se déplie dessous, ligne par ligne. Un texte trop long se replie pendant la
// montée pour tenir entre les deux, coupé par un fondu ; un message au milieu d'un groupe ouvre sa
// ligne heure / coches. Tout passe par Reanimated, sur le fil de l'interface.
export function MessageSelection({ message, name, palettes, position, avatar, rect, origin, clip, blurTarget, actions, onReact, onClose }: SelectionProps) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useSharedValue(0);
  const metaReveal = useSharedValue(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closing = useRef(false);
  const mine = message.mine === 1;

  const dismiss = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    metaReveal.set(withTiming(0, timing(SELECTION_CLOSE_MS)));
    progress.set(withTiming(0, timing(SELECTION_CLOSE_MS)));
    setTimeout(() => {
      onClose();
      after?.();
    }, SELECTION_CLOSE_MS);
  };

  useEffect(() => {
    progress.set(withTiming(1, timing(OPEN_MS)));
    metaReveal.set(withDelay(80, withTiming(1, timing(META_MS))));
  }, [progress, metaReveal]);

  // Le retour ferme la sélection sans quitter la conversation.
  useBackInterceptor(true, () => dismiss());

  const react = (emoji: string) => {
    setPickerOpen(false);
    dismiss(() => onReact(emoji));
  };

  const metaRoom = metaRoomFor(position);
  const { areaTop, areaBottom, previewHeight, tooLong, startY, targetY } = selectionLayout(rect, origin, clip, actions.length, metaRoom);
  const fold = tooLong && canFold(message);
  // Média trop haut : son original reste dans la conversation, l'aperçu apparaît en fondu par-dessus.
  const preview = tooLong && !fold;
  const edge = mine ? styles.alignEnd : styles.alignStart;
  const side = mine ? 'right' : 'left';

  const scrim = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0, 0.7], [0, 1], 'clamp') }));
  const lifted = useAnimatedStyle(() => {
    const p = progress.get();
    if (preview) return { opacity: p, transform: [{ scale: 0.97 + 0.03 * p }] };
    return { opacity: 1, transform: [{ translateY: (targetY - startY) * p }, { scale: 1 + (LIFT_SCALE - 1) * p }] };
  });
  const bar = useAnimatedStyle(() => {
    const amount = interpolate(progress.get(), [0.05, 0.6], [0, 1], 'clamp');
    return { opacity: amount, transform: [{ scale: 0.6 + 0.4 * amount }] };
  });
  const menu = useAnimatedStyle(() => {
    const amount = interpolate(progress.get(), [0.12, 0.65], [0, 1], 'clamp');
    return { opacity: amount, transform: [{ translateY: -6 * (1 - amount) }, { scale: 0.92 + 0.08 * amount }] };
  });

  const fit = fold ? { maxHeight: previewHeight - metaRoom, fullHeight: rect.height, progress } : undefined;
  const bubble = <Bubble message={message} name={name} palettes={palettes} position={position} avatar={avatar} spaced={false} metaReveal={metaReveal} fit={fit} />;
  const reactionCount = QUICK_REACTIONS.length + 1;
  const place = preview ? { top: targetY - areaTop, height: previewHeight } : fold ? { top: startY - areaTop } : { top: startY - areaTop, height: previewHeight };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Reanimated.View style={[StyleSheet.absoluteFill, scrim]}>
        <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={40} tint="default" style={StyleSheet.absoluteFill} />
        <View style={styles.selectionDim} />
      </Reanimated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel={t('commun.fermer')} />

      {/* Le message reste dans la zone de la conversation pendant qu'il monte. */}
      <View pointerEvents="box-none" style={[styles.clip, { top: areaTop, height: areaBottom - areaTop }]}>
        <Reanimated.View pointerEvents={preview ? 'auto' : 'none'} style={[styles.selected, { transformOrigin: side }, place, lifted]}>
          {preview ? (
            <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {bubble}
            </ScrollView>
          ) : (
            bubble
          )}
        </Reanimated.View>
      </View>

      <Reanimated.View style={[styles.reactionBar, edge, { top: targetY - REACTIONS_HEIGHT - spacing.sm, transformOrigin: `${side} bottom` }, bar]}>
        {QUICK_REACTIONS.map((emoji, index) => (
          <Staggered key={emoji} progress={progress} index={index} count={reactionCount} from={0.15} span={0.45} kind="emoji">
            <IconButton onPress={() => react(emoji)} label={emoji} hitSlop={4} style={[styles.reactionOption, message.my_reaction === emoji && styles.reactionChosen]}>
              <Text style={styles.reactionChoice}>{emoji}</Text>
            </IconButton>
          </Staggered>
        ))}
        <Staggered progress={progress} index={QUICK_REACTIONS.length} count={reactionCount} from={0.15} span={0.45} kind="emoji">
          <IconButton onPress={() => setPickerOpen(true)} label={t('chat.tousEmojis')} hitSlop={4} style={styles.reactionOption}>
            <SmilePlus size={24} color={colors.text} strokeWidth={1.75} />
          </IconButton>
        </Staggered>
      </Reanimated.View>

      <Reanimated.View style={[styles.actionsMenu, edge, { top: targetY + previewHeight + SELECTION_GAP, transformOrigin: `${side} top` }, menu]}>
        {actions.map(({ label, icon: Icon, animated: AnimatedIcon, onPress, danger }, index) => (
          <Staggered key={label} progress={progress} index={index} count={actions.length} from={0.3} span={0.4} kind={mine ? 'rowEnd' : 'rowStart'}>
            <Pressable onPress={() => dismiss(onPress)} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
              {AnimatedIcon ? <AnimatedIcon size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.75} autoPlay delay={200 + index * 40} /> : <Icon size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.75} />}
              <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
            </Pressable>
          </Staggered>
        ))}
      </Reanimated.View>

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
