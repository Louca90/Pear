import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Phone, PhoneMissed, Video } from 'lucide-react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { parseEphemeralSystem } from '../../../chat/ephemeral';
import { callRecordText, parseCallRecord } from '../../../chat/callText';
import { Pear } from '../../../components/Pear';
import { createStyles, useColors } from '../../../theme';

import { SESSION_BROKEN, SESSION_REPAIRED, UPDATE_REQUIRED } from '../../../chat/protocol';
import { ephemeralLabel, systemAction } from '../format';
import { useChatStyles } from '../styles';
import { t } from '../../../i18n';

// Les événements de la conversation : centrés, sans bulle, comme un message du système.
export function SystemRow({ message, name, hasWallpaper }: { message: Message; name: string; hasWallpaper: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const textStyle = [styles.systemText, hasWallpaper && { color: colors.onMedia }];
  if (message.text === SESSION_BROKEN) return <RepairRow contact={message.contact} name={name} hasWallpaper={hasWallpaper} />;
  const call = message.kind === 'system' ? parseCallRecord(message.text) : null;
  if (call) {
    // Appel (vague 5) : une petite icône et l'issue, en rouge pour un appel manqué.
    const missed = call.outcome === 'missed';
    const color = hasWallpaper ? colors.onMedia : missed ? colors.danger : colors.textMuted;
    const Icon = missed ? PhoneMissed : call.video ? Video : Phone;
    return (
      <View style={[styles.systemRow, hasWallpaper && styles.metaPill, styles.withIcon]}>
        <Icon size={13} color={color} strokeWidth={2} />
        <Text style={[textStyle, { color }]}>{callRecordText(call)}</Text>
      </View>
    );
  }
  const standalone = message.text === UPDATE_REQUIRED || message.text === SESSION_REPAIRED;
  const author = message.mine === 1 ? t('chat.vousAvez') : t('chat.contactA', { nom: name });
  const text = message.text === SESSION_REPAIRED ? t('chat.sessionReparee') : systemAction(message);
  // Messages éphémères activés ou coupés : la petite poire du geste devant la phrase, pleine si le
  // mode est en marche, en contour pâle s'il est coupé.
  const ephemeral = parseEphemeralSystem(message.text);
  return (
    <View style={[styles.systemRow, hasWallpaper && styles.metaPill, ephemeral !== null && styles.withIcon]}>
      {ephemeral !== null && (
        <View>
          <Pear height={13} color={hasWallpaper ? colors.onMedia : ephemeral ? colors.signatureStrong : colors.textMuted} />
        </View>
      )}
      <Text style={textStyle}>{ephemeral !== null ? (ephemeral ? t('ephemere.ligne', { duree: ephemeralLabel(ephemeral) }) : t('ephemere.ligneCoupe')) : standalone ? text : `${author} ${text}`}</Text>
    </View>
  );
}

// Plusieurs messages de suite indéchiffrables : un appui relance l'échange de clés avec le contact.
function RepairRow({ contact, name, hasWallpaper }: { contact: string; name: string; hasWallpaper: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const [pending, setPending] = useState(() => chat.isRepairPending(contact));
  const muted = hasWallpaper ? colors.onMedia : colors.textMuted;
  return (
    <View style={[styles.repairRow, hasWallpaper && styles.metaPill]}>
      <Text style={[styles.systemText, styles.centered, { color: muted }]}>{t('chat.sessionCassee', { nom: name })}</Text>
      {pending ? (
        <Reanimated.Text entering={FadeIn.duration(180)} style={[styles.systemText, styles.centered, { color: muted }]}>{t('chat.reparationDemandee')}</Reanimated.Text>
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
  withIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconOff: {
    opacity: 0.5,
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
