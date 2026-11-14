import { Pressable, Text, View } from 'react-native';
import Reanimated, { ReduceMotion, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { Sheet } from '../../../components/Sheet';
import { Avatar } from '../../../components/ui';
import { dateLocale, t } from '../../../i18n';
import { EASE } from '../../../motion';
import { createStyles } from '../../../theme';
import { formatTime } from '../format';

function when(at: number | null | undefined) {
  if (!at) return '';
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? formatTime(at) : `${date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })} · ${formatTime(at)}`;
}

// Chaque ligne arrive un peu après la précédente ; l'émoji se pose en grandissant à peine.
function rowIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const config = { duration: 240, easing: EASE, reduceMotion: ReduceMotion.System };
    const run = (value: number) => withDelay(80 + index * 40, withTiming(value, config));
    return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: run(1), transform: [{ translateY: run(0) }] } };
  };
}
function emojiIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const config = { duration: 280, easing: EASE, reduceMotion: ReduceMotion.System };
    return { initialValues: { transform: [{ scale: 0.6 }] }, animations: { transform: [{ scale: withDelay(160 + index * 40, withTiming(1, config)) }] } };
  };
}

// Qui a réagi, avec quoi et quand (feuille du bas commune). Toucher sa propre réaction la retire.
export function ReactionsSheet({ message, name, avatar, onClose }: { message: Message; name: string; avatar: string | null; onClose: () => void }) {
  const styles = useStyles();

  const rows = [
    message.my_reaction && { mine: true, emoji: message.my_reaction, at: message.my_reaction_at, who: t('chat.vous'), photo: chat.getMyProfile().photo },
    message.their_reaction && { mine: false, emoji: message.their_reaction, at: message.their_reaction_at, who: name, photo: avatar },
  ].filter(Boolean) as { mine: boolean; emoji: string; at?: number | null; who: string; photo: string | null }[];

  return (
    <Sheet title={t('reactions.titre')} onClose={onClose}>
      {(close) => (
        <View style={styles.list}>
          {rows.map((row, index) => (
            <Reanimated.View key={row.mine ? 'mine' : 'theirs'} entering={rowIn(index)}>
              <Pressable
                disabled={!row.mine}
                onPress={() => close(() => chat.react(message.contact, message.id, row.emoji))}
                accessibilityRole={row.mine ? 'button' : undefined}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Avatar uri={row.photo} size={44} />
                <View style={styles.text}>
                  <Text style={styles.who} numberOfLines={1}>
                    {row.who}
                  </Text>
                  <Text style={[styles.meta, row.mine && styles.remove]}>{row.mine ? t('reactions.retirer') : when(row.at)}</Text>
                </View>
                <View style={styles.side}>
                  <Reanimated.View entering={emojiIn(index)} style={styles.emojiBubble}>
                    <Text style={styles.emoji}>{row.emoji}</Text>
                  </Reanimated.View>
                  {row.mine && !!row.at && <Text style={styles.meta}>{when(row.at)}</Text>}
                </View>
              </Pressable>
            </Reanimated.View>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const useStyles = createStyles((colors) => ({
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  text: { flex: 1 },
  who: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, marginTop: 2, color: colors.textMuted },
  remove: { color: colors.danger, fontWeight: '600' },
  side: { alignItems: 'flex-end', gap: 2 },
  emojiBubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated },
  emoji: { fontSize: 24 },
}));
