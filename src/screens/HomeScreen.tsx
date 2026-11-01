import { useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus, User, Users } from 'lucide-react-native';

import { getLastMessage } from '../chat/database';
import { chat } from '../chat/manager';
import { Button, Header, Screen } from '../components/ui';
import { Contact } from '../storage';
import { colors, radius, spacing } from '../theme';

type Props = {
  contacts: Contact[];
  onAdd: () => void;
  onOpen: (contact: Contact) => void;
};

export function HomeScreen({ contacts, onAdd, onOpen }: Props) {
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  if (contacts.length === 0) {
    return (
      <Screen>
        <Header title="Pear" />
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Users size={28} color={colors.text} strokeWidth={1.75} />
          </View>
          <Text style={styles.emptyTitle}>Aucun contact</Text>
          <Text style={styles.emptyText}>Ajoutez une personne en scannant son QR code.</Text>
          <Button label="Ajouter un contact" icon={Plus} onPress={onAdd} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="Pear"
        action={
          <Pressable onPress={onAdd} hitSlop={12} accessibilityLabel="Ajouter un contact">
            <Plus size={24} color={colors.text} strokeWidth={1.75} />
          </Pressable>
        }
      />
      <FlatList
        data={contacts}
        keyExtractor={(contact) => contact.publicKey}
        renderItem={({ item }) => {
          const last = getLastMessage(item.publicKey);
          const online = chat.getLink(item.publicKey).status === 'connected';
          const unread = last?.mine === 0 && last.status === 'delivered';
          return (
            <Pressable
              onPress={() => onOpen(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.avatar}>
                <User size={20} color={colors.text} strokeWidth={1.75} />
                {online && <View style={styles.online} accessibilityLabel="En ligne" />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                  {!last ? 'Aucun message' : last.mine === 1 ? `Vous : ${last.text}` : last.text}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  online: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: colors.text,
  },
  rowText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  preview: {
    fontSize: 14,
    color: colors.textMuted,
  },
  previewUnread: {
    color: colors.text,
    fontWeight: '700',
  },
});
