import { Pressable, StyleSheet, Text } from 'react-native';

import { describeMessage, getMessage, Message } from '../../../chat/database';
import { BubblePalette, radius, spacing } from '../../../theme';
import { t } from '../../../i18n';

export function ReplyQuote({ message, name, palette, onJump }: { message: Message; name: string; palette: BubblePalette; onJump?: (id: string) => void }) {
  const original = message.reply_to ? getMessage(message.reply_to, message.contact) : null;
  if (!message.reply_to) return null;
  const author = original ? (original.mine === 1 ? t('chat.vous') : name) : '';
  return (
    <Pressable
      onPress={() => original && onJump?.(original.id)}
      accessibilityLabel={t('chat.voirOrigine')}
      style={[styles.quote, { backgroundColor: palette.track }]}
    >
      {original && <Text style={[styles.quoteAuthor, { color: palette.text }]} numberOfLines={1}>{author}</Text>}
      <Text style={[styles.quoteText, { color: palette.muted }]} numberOfLines={2}>
        {original ? describeMessage(original) : t('chat.messageSupprime')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quote: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginBottom: 6,
  },
  quoteAuthor: {
    fontSize: 13,
    fontWeight: '600',
  },
  quoteText: {
    fontSize: 13,
  },
});
