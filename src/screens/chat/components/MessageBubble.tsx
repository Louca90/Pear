import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Reply } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { colors, radius, spacing } from '../../../theme';

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
import { sharedStyles } from '../styles';
import { MetaTone, Palettes, Rect, ViewRef } from '../types';

// Sans bulle, l'heure et les coches sont posées sur le fond : sur une image, elles gardent leur propre pastille sombre.
const PLAIN_TONE: MetaTone = { text: colors.text, muted: colors.textMuted };
const ON_WALLPAPER_TONE: MetaTone = { text: colors.background, muted: colors.onDarkMuted };

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
  onSelect?: (message: Message, rect: Rect) => void;
  onDoubleTap?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onJump?: (id: string) => void;
  // Sélection d'un message très long : le texte se replie pour tenir à l'écran.
  fit?: TextFit;
};

export function Bubble({ message, name, palettes, hidden, mediaHidden, pulse, onOpenFile, onPrepareFile, onSelect, onDoubleTap, onReply, onJump, fit }: BubbleProps) {
  const container = useRef<ViewRef>(null);
  const mine = message.mine === 1;
  const bare = isBareMedia(message);
  const palette = mine ? palettes.mine : palettes.theirs;
  const reactions = [message.their_reaction, message.my_reaction].filter(Boolean);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.08, duration: 160, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 200 }),
    ]).start();
  }, [pulse, scale]);

  const { swipe, panHandlers: swipeHandlers } = useSwipeReply(message, mine, onReply);
  const iconRange = mine ? [-SWIPE_REPLY, -SWIPE_START] : [SWIPE_START, SWIPE_REPLY];
  const iconOutput = (hiddenValue: number, shownValue: number) => (mine ? [shownValue, hiddenValue] : [hiddenValue, shownValue]);

  const select = () => {
    container.current?.measureInWindow((x, y, width, height) => onSelect?.(message, { x, y, width, height }));
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
      <Animated.View style={[mine ? styles.rowMine : styles.rowTheirs, { transform: [{ translateX: swipe }, { scale }] }]}>
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
            <FileContent message={message} palette={palette} mediaHidden={mediaHidden} onOpen={(rect) => onOpenFile?.(message, rect)} onLongPress={select} onDoubleTap={onDoubleTap && (() => onDoubleTap(message))} onPrepare={onPrepareFile && (() => onPrepareFile(message))} />
          )}
          {bare ? (
            <MessageMeta message={message} tone={palettes.hasWallpaper ? ON_WALLPAPER_TONE : PLAIN_TONE} pill={palettes.hasWallpaper} />
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

const localStyles = StyleSheet.create({
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
});

const styles = { ...sharedStyles, ...localStyles };
