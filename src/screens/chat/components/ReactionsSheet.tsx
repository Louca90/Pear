import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { Avatar, useNavigationBarHeight } from '../../../components/ui';
import { t } from '../../../i18n';
import { createStyles, radius, spacing } from '../../../theme';
import { formatTime } from '../format';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

function when(at: number | null | undefined) {
  if (!at) return '';
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? formatTime(at) : `${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${formatTime(at)}`;
}

// Qui a réagi, avec quoi et quand. Toucher sa propre réaction la retire.
export function ReactionsSheet({ message, name, avatar, onClose }: { message: Message; name: string; avatar: string | null; onClose: () => void }) {
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true }).start(() => {
      onClose();
      then?.();
    });
  };

  const rows = [
    message.my_reaction && { mine: true, emoji: message.my_reaction, at: message.my_reaction_at, who: t('chat.vous'), photo: chat.getMyProfile().photo },
    message.their_reaction && { mine: false, emoji: message.their_reaction, at: message.their_reaction_at, who: name, photo: avatar },
  ].filter(Boolean) as { mine: boolean; emoji: string; at?: number | null; who: string; photo: string | null }[];

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: bottom + spacing.md },
          { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }] },
        ]}
      >
        <Pressable onPress={() => close()} style={styles.header} accessibilityLabel={t('commun.fermer')}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('reactions.titre')}</Text>
        </Pressable>
        {rows.map((row) => (
          <Pressable
            key={row.mine ? 'mine' : 'theirs'}
            disabled={!row.mine}
            onPress={() => close(() => chat.react(message.contact, message.id, row.emoji))}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Avatar uri={row.photo} size={40} />
            <View style={styles.text}>
              <Text style={styles.who}>{row.who}</Text>
              <Text style={styles.meta}>{row.mine ? t('reactions.retirer') : when(row.at)}</Text>
            </View>
            <View style={styles.side}>
              <Text style={styles.emoji}>{row.emoji}</Text>
              {row.mine && !!row.at && <Text style={styles.meta}>{when(row.at)}</Text>}
            </View>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
  },
  who: {
    fontSize: 16,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textMuted,
  },
  side: {
    alignItems: 'flex-end',
  },
  emoji: {
    fontSize: 26,
  },
}));
