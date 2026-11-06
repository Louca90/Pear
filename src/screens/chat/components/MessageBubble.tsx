import { useEffect, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Reply } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { colors, radius, spacing } from '../../../theme';

import { FileContent } from './FileContent';
import { MessageMeta } from './MessageMeta';
import { ReplyQuote } from './ReplyQuote';
import { SystemRow } from './SystemRow';
import { VoiceContent } from './VoiceContent';
import { DOUBLE_TAP_MS, LONG_PRESS_MS, SWIPE_MAX, SWIPE_REPLY, SWIPE_START } from '../constants';
import { isBareMedia } from '../format';
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
  onSelect?: (message: Message, rect: Rect) => void;
  onDoubleTap?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onJump?: (id: string) => void;
};
export function Bubble({ message, name, palettes, hidden, mediaHidden, pulse, onOpenFile, onSelect, onDoubleTap, onReply, onJump }: BubbleProps) {
  const container = useRef<ViewRef>(null);
  const lastTap = useRef(0);
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

  // Mon message glisse vers la gauche, celui de l'autre vers la droite.
  const direction = mine ? -1 : 1;
  const swipe = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const reply = useRef(onReply);
  reply.current = onReply;
  const reset = () => {
    armed.current = false;
    Animated.spring(swipe, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start();
  };
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx * direction > SWIPE_START && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        const distance = Math.max(0, Math.min(SWIPE_MAX, gesture.dx * direction));
        swipe.setValue(distance * direction);
        const reached = distance >= SWIPE_REPLY;
        if (reached !== armed.current) {
          armed.current = reached;
          if (reached) Haptics.selectionAsync().catch((e) => console.warn('Pear vibration :', e));
        }
      },
      onPanResponderRelease: () => {
        if (armed.current) reply.current?.(message);
        reset();
      },
      onPanResponderTerminate: reset,
    }),
  ).current;
  const iconRange = mine ? [-SWIPE_REPLY, -SWIPE_START] : [SWIPE_START, SWIPE_REPLY];
  const iconOutput = (hiddenValue: number, shownValue: number) => (mine ? [shownValue, hiddenValue] : [hiddenValue, shownValue]);

  const select = () => {
    container.current?.measureInWindow((x, y, width, height) => onSelect?.(message, { x, y, width, height }));
  };

  const press = () => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDoubleTap(message);
    } else {
      lastTap.current = now;
    }
  };

  if (message.kind === 'wallpaper' || message.kind === 'system') {
    return <SystemRow message={message} name={name} hasWallpaper={palettes.hasWallpaper} />;
  }

  return (
    <View
      ref={container}
      collapsable={false}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, hidden && styles.hidden]}
      {...(onReply ? swipeResponder.panHandlers : undefined)}
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
            <Text style={[styles.text, { color: palette.text }]}>{message.text}</Text>
          ) : message.kind === 'audio' && message.status !== 'receiving' ? (
            <VoiceContent message={message} palette={palette} />
          ) : (
            <FileContent message={message} palette={palette} mediaHidden={mediaHidden} onOpen={(rect) => onOpenFile?.(message, rect)} onLongPress={select} />
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
    lineHeight: 22,
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
