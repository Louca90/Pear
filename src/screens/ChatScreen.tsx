import { useEffect, useState, useSyncExternalStore } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUp, Check, CheckCheck, Info, MessageCircle } from 'lucide-react-native';

import { Header, Screen } from '../components/ui';
import { getMessages, Message, MessageStatus } from '../chat/database';
import { chat, MAX_TEXT_LENGTH } from '../chat/manager';
import { RouteType } from '../network/peer';
import { colors, radius, spacing } from '../theme';

// Place de la barre de navigation Android, la plus haute étant celle à 3 boutons.
const NAVIGATION_BAR_SPACE = 48;

const ROUTE: Record<RouteType, string> = {
  host: 'Connecté, sur le même réseau',
  srflx: 'Connecté, direct par internet',
  relay: 'Connecté, par un serveur relais',
};

// 1 coche : pas encore reçu. 2 coches grises : reçu par l'autre. 2 coches blanches : conversation ouverte par l'autre.
function statusIcon(status: MessageStatus) {
  if (status === 'read') return { Icon: CheckCheck, color: colors.background, label: 'Lu' };
  if (status === 'delivered') return { Icon: CheckCheck, color: colors.onDarkMuted, label: 'Reçu' };
  return { Icon: Check, color: colors.onDarkMuted, label: 'Pas encore reçu' };
}

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
};

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function Bubble({ message }: { message: Message }) {
  const mine = message.mine === 1;
  const { Icon: StatusIcon, color: statusColor, label: statusLabel } = statusIcon(message.status);
  const foreground = mine ? colors.background : colors.text;
  const secondary = mine ? colors.onDarkMuted : colors.textMuted;
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      <Text style={[styles.text, { color: foreground }]}>{message.text}</Text>
      <View style={styles.meta}>
        <Text style={[styles.time, { color: secondary }]}>{formatTime(message.created_at)}</Text>
        {mine && (
          <StatusIcon
            size={14}
            color={statusColor}
            strokeWidth={1.75}
            accessibilityLabel={statusLabel}
          />
        )}
      </View>
    </View>
  );
}

export function ChatScreen({ contactKey, name, onBack, onInfo }: Props) {
  const [draft, setDraft] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const messages = getMessages(contactKey);
  const { status, route } = chat.getLink(contactKey);
  const online = chat.isOnline();
  const subtitle = !online
    ? 'Vous êtes hors ligne'
    : status === 'connected'
      ? route ? ROUTE[route] : 'Connecté'
      : 'Votre contact est hors ligne';

  useEffect(() => {
    chat.setOpenConversation(contactKey);
    return () => chat.setOpenConversation(null);
  }, [contactKey]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    chat.send(contactKey, text);
    setDraft('');
  };

  return (
    <Screen edgeToEdgeBottom>
      <Header
        title={name}
        subtitle={subtitle}
        onBack={onBack}
        action={
          <Pressable onPress={onInfo} hitSlop={12} accessibilityLabel="Informations du contact">
            <Info size={24} color={colors.text} strokeWidth={1.75} />
          </Pressable>
        }
      />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <MessageCircle size={28} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyText}>Vos messages restent sur vos deux téléphones.</Text>
          </View>
        ) : (
          <FlatList
            inverted
            style={styles.flex}
            data={messages}
            keyExtractor={(message) => message.id}
            renderItem={({ item }) => <Bubble message={item} />}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}
        <View style={[styles.composer, { paddingBottom: keyboardOpen ? spacing.sm : NAVIGATION_BAR_SPACE }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.textMuted}
            maxLength={MAX_TEXT_LENGTH}
            multiline
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim()}
            accessibilityLabel="Envoyer"
            style={({ pressed }) => [styles.send, !draft.trim() && styles.sendDisabled, pressed && styles.pressed]}
          >
            <ArrowUp size={20} color={colors.background} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.text,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
  time: {
    fontSize: 12,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    backgroundColor: colors.disabled,
  },
  pressed: {
    opacity: 0.6,
  },
});
