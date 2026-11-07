import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Reply } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { FileContent } from './FileContent';
import { FittedText, TextFit } from './FittedText';
import { MessageMeta } from './MessageMeta';
import { ReplyQuote } from './ReplyQuote';
import { SystemRow } from './SystemRow';
import { VoiceContent } from './VoiceContent';
import { LONG_PRESS_MS, SWIPE_REPLY, SWIPE_START, TEXT_LINE_HEIGHT } from '../constants';
import { isBareMedia } from '../format';
import { useDoubleTap } from '../hooks/useDoubleTap';
import { useSwipeReply } from '../hooks/useSwipeReply';
import { useChatStyles } from '../styles';
import { Palettes, Rect, ViewRef } from '../types';

// Sans bulle, l'heure et les coches sont posées sur le fond : sur une image, elles gardent leur propre pastille sombre.

type BubbleProps = {
  message: Message;
  name: string;
  palettes: Palettes;
  hidden?: boolean;
  mediaHidden?: boolean;
  // Change quand on saute vers ce message : il grossit un instant pour qu'on le repère.
  pulse?: number;
  onOpenFile?: (message: Message, rect: Rect) => void;
  onPrepareFile?: (message: Message) => void;
  onAcceptFile?: (message: Message) => void;
  onRefuseFile?: (message: Message) => void;
  // measure relit la position de la bulle au moment voulu (après la fermeture du clavier, par exemple).
  onSelect?: (message: Message, measure: (done: (rect: Rect) => void) => void) => void;
  onDoubleTap?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onJump?: (id: string) => void;
  // Sélection d'un message très long : le texte se replie pour tenir à l'écran.
  fit?: TextFit;
};

// Les messages déjà affichés : seuls ceux qui arrivent pendant que la conversation est ouverte
// (envoyés ou reçus) font leur entrée, pas ceux qu'on retrouve en défilant.
const shownIds = new Set<string>();
const POP_MS = 240;

export function markMessagesShown(ids: string[]) {
  for (const id of ids) shownIds.add(id);
}

export function Bubble({ message, name, palettes, hidden, mediaHidden, pulse, onOpenFile, onPrepareFile, onAcceptFile, onRefuseFile, onSelect, onDoubleTap, onReply, onJump, fit }: BubbleProps) {
  const styles = useStyles();
  const colors = useColors();
  const container = useRef<ViewRef>(null);
  const mine = message.mine === 1;
  const bare = isBareMedia(message);
  const palette = mine ? palettes.mine : palettes.theirs;
  const reactions = [message.their_reaction, message.my_reaction].filter(Boolean);
  const scale = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(shownIds.has(message.id) ? 1 : 0)).current;

  // Arrivée : fondu, légère montée et zoom de 96 % à 100 %, sans rebond.
  useEffect(() => {
    if (shownIds.has(message.id)) return;
    shownIds.add(message.id);
    Animated.timing(pop, { toValue: 1, duration: POP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [message.id, pop]);

  // Message rejoint (citation, épinglé) : il grossit un peu puis revient doucement.
  useEffect(() => {
    if (!pulse) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [pulse, scale]);

  const { swipe, panHandlers: swipeHandlers } = useSwipeReply(message, mine, onReply);
  const iconRange = mine ? [-SWIPE_REPLY, -SWIPE_START] : [SWIPE_START, SWIPE_REPLY];
  const iconOutput = (hiddenValue: number, shownValue: number) => (mine ? [shownValue, hiddenValue] : [hiddenValue, shownValue]);

  const select = () => {
    onSelect?.(message, (done) => container.current?.measureInWindow((x, y, width, height) => done({ x, y, width, height })));
  };

  const press = useDoubleTap(onDoubleTap && (() => onDoubleTap(message)));

  if (message.kind === 'wallpaper' || message.kind === 'system') {
    return <SystemRow message={message} name={name} hasWallpaper={palettes.hasWallpaper} />;
  }

  return (
    <View
      ref={container}
      collapsable={false}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, hidden && styles.hidden]}
      {...swipeHandlers}
    >
      {onReply && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeIcon,
            mine ? styles.swipeIconMine : styles.swipeIconTheirs,
            {
              opacity: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0, 1), extrapolate: 'clamp' }),
              transform: [
                { scale: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0.4, 1), extrapolate: 'clamp' }) },
                { rotate: swipe.interpolate({ inputRange: iconRange, outputRange: mine ? ['0deg', '-60deg'] : ['60deg', '0deg'], extrapolate: 'clamp' }) },
              ],
            },
          ]}
        >
          <Reply size={18} color={colors.text} strokeWidth={1.75} />
        </Animated.View>
      )}
      <Animated.View
        style={[
          mine ? styles.rowMine : styles.rowTheirs,
          {
            opacity: pop,
            transform: [
              { translateX: swipe },
              { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
              { scale: Animated.multiply(scale, pop.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] })) },
            ],
          },
        ]}
      >
        <Pressable
          onPress={press}
          onLongPress={select}
          delayLongPress={LONG_PRESS_MS}
          style={bare ? styles.bare : [styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: palette.background }]}
        >
          <ReplyQuote message={message} name={name} palette={palette} onJump={onJump} />
          {message.kind === 'text' ? (
            <FittedText text={message.text} style={[styles.text, { color: palette.text }]} background={palette.background} fit={fit} />
          ) : message.kind === 'audio' && message.status !== 'receiving' ? (
            <VoiceContent message={message} palette={palette} />
          ) : (
            <FileContent message={message} palette={palette} mediaHidden={mediaHidden} onOpen={(rect) => onOpenFile?.(message, rect)} onLongPress={select} onPrepare={onPrepareFile && (() => onPrepareFile(message))} onAccept={onAcceptFile && (() => onAcceptFile(message))} onRefuse={onRefuseFile && (() => onRefuseFile(message))} />
          )}
          {bare ? (
            <MessageMeta message={message} tone={palettes.hasWallpaper ? { text: colors.onMedia, muted: colors.onDarkMuted } : { text: colors.text, muted: colors.textMuted }} pill={palettes.hasWallpaper} />
          ) : (
            <MessageMeta message={message} tone={palette} />
          )}
        </Pressable>
        {reactions.length > 0 && (
          <View style={styles.reactions}>
            {reactions.map((emoji, index) => (
              <Text key={index} style={styles.reactionEmoji}>{emoji}</Text>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const useLocalStyles = createStyles((colors) => ({
  row: {
    maxWidth: '80%',
  },
  rowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  swipeIcon: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  swipeIconMine: {
    right: spacing.sm,
  },
  swipeIconTheirs: {
    left: spacing.sm,
  },
  bare: {
    alignItems: 'flex-end',
    gap: 2,
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  mine: {
    borderBottomRightRadius: 4,
  },
  theirs: {
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: TEXT_LINE_HEIGHT,
  },
  reactions: {
    flexDirection: 'row',
    gap: 2,
    marginTop: -6,
    marginHorizontal: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reactionEmoji: {
    fontSize: 14,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
