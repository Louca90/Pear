import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
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
  const appear = useRef(new Animated.Value(messages.length > 0 ? 1 : 0)).current;
  const textFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (messages.length > 0) {
      setShown(messages);
      Animated.timing(appear, { toValue: 1, duration: APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(appear, { toValue: 0, duration: APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown([]);
      });
    }
  }, [messages, appear]);

  const current = shown[Math.min(index, shown.length - 1)];
  if (!current) return null;

  const press = () => {
    onJump(current.id);
    if (shown.length < 2) return;
    textFade.setValue(0);
    setIndex((value) => (value + 1) % shown.length);
    Animated.timing(textFade, { toValue: 1, duration: APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }]}
    >
      <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={t('chat.messageEpingle')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.icon}>
          <Pin size={16} color={colors.text} strokeWidth={1.75} />
        </View>
        <Animated.View style={[styles.text, { opacity: textFade }]}>
          <Text style={styles.title}>
            {shown.length > 1 ? t('chat.messageEpingleN', { i: Math.min(index, shown.length - 1) + 1, n: shown.length }) : t('chat.messageEpingle')}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>{describeMessage(current)}</Text>
        </Animated.View>
        {shown.length > 1 && (
          <View style={styles.dots}>
            {shown.map((message, position) => (
              <View key={message.id} style={[styles.dot, position === Math.min(index, shown.length - 1) && styles.dotOn]} />
            ))}
          </View>
        )}
      </Pressable>
    </Animated.View>
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
