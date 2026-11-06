import { FlatList, Modal, Pressable, Text } from 'react-native';

import { ALL_EMOJIS } from '../../../chat/emojis';
import { useNavigationBarHeight } from '../../../components/ui';
import { createStyles, radius, spacing } from '../../../theme';

import { EMOJI_COLUMNS } from '../constants';

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.emojiOverlay} onPress={onClose}>
        <Pressable style={[styles.emojiSheet, { paddingBottom: bottom + spacing.sm }]}>
          <FlatList
            data={ALL_EMOJIS}
            numColumns={EMOJI_COLUMNS}
            keyExtractor={(emoji, index) => `${index}-${emoji}`}
            renderItem={({ item }) => (
              <Pressable onPress={() => onPick(item)} style={styles.emojiCell}>
                <Text style={styles.emojiLarge}>{item}</Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  emojiOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  emojiSheet: {
    height: '50%',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.background,
  },
  emojiCell: {
    flex: 1 / EMOJI_COLUMNS,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiLarge: {
    fontSize: 28,
  },
}));
