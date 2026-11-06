import { StyleSheet, Text, View } from 'react-native';

import { Message } from '../../../chat/database';
import { colors } from '../../../theme';

import { systemAction } from '../format';
import { sharedStyles } from '../styles';

// Les événements de la conversation : centrés, sans bulle, comme un message du système.
export function SystemRow({ message, name, hasWallpaper }: { message: Message; name: string; hasWallpaper: boolean }) {
  const author = message.mine === 1 ? 'Vous avez' : `${name} a`;
  return (
    <View style={[styles.systemRow, hasWallpaper && styles.metaPill]}>
      <Text style={[styles.systemText, hasWallpaper && { color: colors.background }]}>{`${author} ${systemAction(message)}`}</Text>
    </View>
  );
}

const localStyles = StyleSheet.create({
  systemRow: {
    alignSelf: 'center',
    paddingVertical: 2,
  },
  systemText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});

const styles = { ...sharedStyles, ...localStyles };
