import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Plus, User, Users } from 'lucide-react-native';

import { Button, Header, Screen } from '../components/ui';
import { Contact } from '../storage';
import { colors, radius, spacing } from '../theme';

type Props = {
  contacts: Contact[];
  onAdd: () => void;
  onOpen: (contact: Contact) => void;
};

export function HomeScreen({ contacts, onAdd, onOpen }: Props) {
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
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <User size={20} color={colors.text} strokeWidth={1.75} />
            </View>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
        )}
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
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
});
