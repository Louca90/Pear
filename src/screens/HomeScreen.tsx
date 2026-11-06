import { useSyncExternalStore } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Flame, Plus, Users } from 'lucide-react-native';

import { describeMessage, getContactProfile, getLastMessage, getStreak } from '../chat/database';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { Avatar, Button, Header, IconButton, RowPressable, Screen } from '../components/ui';
import { Contact } from '../storage';
import { colors, radius, spacing } from '../theme';

type Props = {
  contacts: Contact[];
  onAdd: () => void;
  onOpen: (contact: Contact) => void;
  onProfile: () => void;
};

export function HomeScreen({ contacts, onAdd, onOpen, onProfile }: Props) {
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const barSpace = useBottomBarSpace();

  const profileButton = (
    <IconButton onPress={onProfile} label="Mon profil">
      <Avatar uri={chat.getMyProfile().photo} size={32} />
    </IconButton>
  );

  if (contacts.length === 0) {
    return (
      <Screen>
        <Header title="Pear" action={profileButton} />
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
        action={profileButton}
      />
      <FlatList
        data={contacts}
        contentContainerStyle={{ paddingBottom: barSpace }}
        keyExtractor={(contact) => contact.publicKey}
        renderItem={({ item }) => {
          const last = getLastMessage(item.publicKey);
          const online = chat.getLink(item.publicKey).status === 'connected';
          const unread = last?.mine === 0 && last.status === 'delivered';
          const streak = getStreak(item.publicKey);
          return (
            <RowPressable onPress={() => onOpen(item)} style={styles.row}>
              <View>
                <Avatar uri={getContactProfile(item.publicKey).photo_uri} />
                {online && <View style={styles.online} accessibilityLabel="En ligne" />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                  {!last ? 'Aucun message' : last.mine === 1 ? `Vous : ${describeMessage(last)}` : describeMessage(last)}
                </Text>
              </View>
              {streak > 0 && (
                <View style={styles.streak} accessibilityLabel={`Série de ${streak} jours`}>
                  <Flame size={16} color={colors.text} strokeWidth={1.75} />
                  <Text style={styles.streakCount}>{streak}</Text>
                </View>
              )}
            </RowPressable>
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
    // La ligne est en retrait des bords pour que son fond d'appui arrondi reste visible ; le texte garde son alignement.
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.lg - spacing.sm,
    paddingVertical: spacing.md,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  streakCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
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
