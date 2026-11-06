import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Check, CheckCheck } from 'lucide-react-native';

import { Message, MessageStatus } from '../../../chat/database';

import { formatTime } from '../format';
import { useChatStyles } from '../styles';
import { MetaTone } from '../types';
import { t } from '../../../i18n';

// 1 coche : pas encore reçu. 2 coches grises : reçu par l'autre. 2 coches contrastées : conversation ouverte par l'autre.
function statusIcon(status: MessageStatus, tone: MetaTone) {
  if (status === 'read') return { Icon: CheckCheck, color: tone.text, label: t('chat.lu') };
  if (status === 'delivered') return { Icon: CheckCheck, color: tone.muted, label: t('chat.recu') };
  return { Icon: Check, color: tone.muted, label: t('chat.pasRecu') };
}

export function MessageMeta({ message, tone, pill }: { message: Message; tone: MetaTone; pill?: boolean }) {
  const styles = useStyles();
  const { Icon: StatusIcon, color: statusColor, label: statusLabel } = statusIcon(message.status, tone);
  const pop = useRef(new Animated.Value(1)).current;
  const lastStatus = useRef(message.status);

  // Quand la coche change, surtout quand le message passe à « lu », elle saute pour qu'on le voie.
  useEffect(() => {
    if (lastStatus.current === message.status) return;
    lastStatus.current = message.status;
    Animated.sequence([
      Animated.timing(pop, { toValue: message.status === 'read' ? 1.9 : 1.4, duration: 140, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 240 }),
    ]).start();
  }, [message.status, pop]);

  return (
    <View style={[styles.meta, pill && styles.metaPill]}>
      {message.edited === 1 && <Text style={[styles.time, { color: tone.muted }]}>{t('chat.modifie')}</Text>}
      <Text style={[styles.time, { color: tone.muted }]}>{formatTime(message.created_at)}</Text>
      {message.mine === 1 && (
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <StatusIcon size={14} color={statusColor} strokeWidth={1.75} accessibilityLabel={statusLabel} />
        </Animated.View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
});

const useStyles = () => useChatStyles(localStyles);
