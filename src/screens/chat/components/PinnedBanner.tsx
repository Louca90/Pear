import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Pin } from 'lucide-react-native';

import { describeMessage, Message } from '../../../chat/database';
import { t } from '../../../i18n';
import { createStyles, radius, spacing, useColors } from '../../../theme';

const APPEAR_MS = 220;

// Bandeau des messages épinglés, posé en haut de la conversation sans la décaler. Un appui amène au
// message affiché, puis passe au suivant (du plus récent au plus ancien).
export function PinnedBanner({ messages, onJump }: { messages: Message[]; onJump: (id: string) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [index, setIndex] = useState(0);
  // Le dernier contenu reste affiché pendant que le bandeau disparaît.
  const [shown, setShown] = useState(messages);
  const appear = useSharedValue(messages.length > 0 ? 1 : 0);
  const textFade = useSharedValue(1);
  const bannerStyle = useAnimatedStyle(() => ({ opacity: appear.get(), transform: [{ translateY: -8 * (1 - appear.get()) }] }));
  const textStyle = useAnimatedStyle(() => ({ opacity: textFade.get() }));

  useEffect(() => {
    if (messages.length > 0) {
      setShown(messages);
      appear.set(withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) }));
    } else {
      const clear = () => setShown([]);
      appear.set(
        withTiming(0, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) scheduleOnRN(clear);
        }),
      );
    }
  }, [messages, appear]);

  const current = shown[Math.min(index, shown.length - 1)];
  if (!current) return null;

  const press = () => {
    onJump(current.id);
    if (shown.length < 2) return;
    textFade.set(0);
    setIndex((value) => (value + 1) % shown.length);
    textFade.set(withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) }));
  };

  return (
    <Reanimated.View
      pointerEvents="box-none"
      style={[styles.wrapper, bannerStyle]}
    >
      <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={t('chat.messageEpingle')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.icon}>
          <Pin size={16} color={colors.text} strokeWidth={1.75} />
        </View>
        <Reanimated.View style={[styles.text, textStyle]}>
          <Text style={styles.title}>
            {shown.length > 1 ? t('chat.messageEpingleN', { i: Math.min(index, shown.length - 1) + 1, n: shown.length }) : t('chat.messageEpingle')}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>{describeMessage(current)}</Text>
        </Reanimated.View>
        {shown.length > 1 && (
          <View style={styles.dots}>
            {shown.map((message, position) => (
              <View key={message.id} style={[styles.dot, position === Math.min(index, shown.length - 1) && styles.dotOn]} />
            ))}
          </View>
        )}
      </Pressable>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  wrapper: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.md,
    right: spacing.md,
    zIndex: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.elevated,
    boxShadow: `0px 4px 16px ${colors.shadow}`,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.elevatedActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  preview: {
    fontSize: 14,
    color: colors.textMuted,
  },
  dots: {
    gap: 3,
  },
  dot: {
    width: 3,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  dotOn: {
    backgroundColor: colors.text,
  },
}));
