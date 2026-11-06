import { Text, View } from 'react-native';

import { Message } from '../../../chat/database';
import { createStyles, useColors } from '../../../theme';

import { UPDATE_REQUIRED } from '../../../chat/protocol';
import { systemAction } from '../format';
import { useChatStyles } from '../styles';
import { t } from '../../../i18n';

// Les événements de la conversation : centrés, sans bulle, comme un message du système.
export function SystemRow({ message, name, hasWallpaper }: { message: Message; name: string; hasWallpaper: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const author = message.mine === 1 ? t('chat.vousAvez') : t('chat.contactA', { nom: name });
  return (
    <View style={[styles.systemRow, hasWallpaper && styles.metaPill]}>
      <Text style={[styles.systemText, hasWallpaper && { color: colors.onMedia }]}>{message.text === UPDATE_REQUIRED ? systemAction(message) : `${author} ${systemAction(message)}`}</Text>
    </View>
  );
}

const useLocalStyles = createStyles((colors) => ({
  systemRow: {
    alignSelf: 'center',
    paddingVertical: 2,
  },
  systemText: {
    fontSize: 12,
    color: colors.textMuted,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
