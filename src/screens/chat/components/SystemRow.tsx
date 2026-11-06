import { Text, View } from 'react-native';

import { Message } from '../../../chat/database';
import { createStyles, useColors } from '../../../theme';

import { systemAction } from '../format';
import { useChatStyles } from '../styles';

// Les événements de la conversation : centrés, sans bulle, comme un message du système.
export function SystemRow({ message, name, hasWallpaper }: { message: Message; name: string; hasWallpaper: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const author = message.mine === 1 ? 'Vous avez' : `${name} a`;
  return (
    <View style={[styles.systemRow, hasWallpaper && styles.metaPill]}>
      <Text style={[styles.systemText, hasWallpaper && { color: colors.onMedia }]}>{`${author} ${systemAction(message)}`}</Text>
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
