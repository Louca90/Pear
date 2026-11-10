import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { createStyles, useColors } from '../../../theme';

import { SESSION_BROKEN, SESSION_REPAIRED, UPDATE_REQUIRED } from '../../../chat/protocol';
import { systemAction } from '../format';
import { useChatStyles } from '../styles';
import { t } from '../../../i18n';

// Les événements de la conversation : centrés, sans bulle, comme un message du système.
export function SystemRow({ message, name, hasWallpaper }: { message: Message; name: string; hasWallpaper: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const textStyle = [styles.systemText, hasWallpaper && { color: colors.onMedia }];
  if (message.text === SESSION_BROKEN) return <RepairRow contact={message.contact} name={name} hasWallpaper={hasWallpaper} />;
  const standalone = message.text === UPDATE_REQUIRED || message.text === SESSION_REPAIRED;
  const author = message.mine === 1 ? t('chat.vousAvez') : t('chat.contactA', { nom: name });
  const text = message.text === SESSION_REPAIRED ? t('chat.sessionReparee') : systemAction(message);
  return (
    <View style={[styles.systemRow, hasWallpaper && styles.metaPill]}>
      <Text style={textStyle}>{standalone ? text : `${author} ${text}`}</Text>
    </View>
  );
}

// Plusieurs messages de suite indéchiffrables : un appui relance l'échange de clés avec le contact.
function RepairRow({ contact, name, hasWallpaper }: { contact: string; name: string; hasWallpaper: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const [pending, setPending] = useState(() => chat.isRepairPending(contact));
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pending) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [pending, fade]);
  const muted = hasWallpaper ? colors.onMedia : colors.textMuted;
  return (
    <View style={[styles.repairRow, hasWallpaper && styles.metaPill]}>
      <Text style={[styles.systemText, styles.centered, { color: muted }]}>{t('chat.sessionCassee', { nom: name })}</Text>
      {pending ? (
        <Animated.Text style={[styles.systemText, styles.centered, { color: muted, opacity: fade }]}>{t('chat.reparationDemandee')}</Animated.Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.reparer')}
          hitSlop={8}
          onPress={() => {
            chat.repairConversation(contact);
            setPending(true);
          }}
          style={({ pressed }) => [styles.repairButton, pressed && styles.repairPressed]}
        >
          <Text style={[styles.repairLabel, hasWallpaper && { color: colors.onMedia }]}>{t('chat.reparer')}</Text>
        </Pressable>
      )}
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
  repairRow: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    maxWidth: 300,
  },
  centered: {
    textAlign: 'center',
  },
  repairButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  repairPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  repairLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
