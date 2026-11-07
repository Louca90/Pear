import { Pressable, StyleSheet, Text, View } from 'react-native';

import { describeMessage, getMessage, Message } from '../../../chat/database';
import { BubblePalette, radius, spacing } from '../../../theme';
import { t } from '../../../i18n';
import { Thumbnail } from './ComposerModeCard';

// La citation en haut d'une bulle de réponse : barre d'accent, auteur, 2 lignes au plus et miniature
// pour une photo ou une vidéo. Un appui amène au message d'origine ; supprimé, la citation reste grisée.
export function ReplyQuote({ message, name, palette, onJump }: { message: Message; name: string; palette: BubblePalette; onJump?: (id: string) => void }) {
  const original = message.reply_to ? getMessage(message.reply_to, message.contact) : null;
  if (!message.reply_to) return null;
  const author = original ? (original.mine === 1 ? t('chat.vous') : name) : '';
  const media = original && (original.kind === 'image' || original.kind === 'video') && original.file_uri;
  return (
    <Pressable
      onPress={() => original && onJump?.(original.id)}
      disabled={!original}
      accessibilityLabel={t('chat.voirOrigine')}
      style={[styles.quote, { backgroundColor: palette.track }]}
    >
      <View style={[styles.accent, { backgroundColor: original ? palette.text : palette.muted }]} />
      <View style={styles.text}>
        {original && <Text style={[styles.quoteAuthor, { color: palette.text }]} numberOfLines={1}>{author}</Text>}
        <Text style={[styles.quoteText, { color: palette.muted }, !original && styles.deleted]} numberOfLines={2}>
          {original ? describeMessage(original) : t('chat.messageSupprime')}
        </Text>
      </View>
      {media && <Thumbnail message={original} size={36} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingRight: 6,
    borderRadius: radius.sm,
    marginBottom: 6,
    overflow: 'hidden',
  },
  accent: {
    alignSelf: 'stretch',
    width: 3,
  },
  text: {
    flexShrink: 1,
  },
  quoteAuthor: {
    fontSize: 13,
    fontWeight: '600',
  },
  quoteText: {
    fontSize: 13,
  },
  deleted: {
    fontStyle: 'italic',
  },
});
