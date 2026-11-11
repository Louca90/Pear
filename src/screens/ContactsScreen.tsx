import { useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Bell, ChevronRight, ClipboardPaste, MessageCircle, QrCode, ScanLine } from 'lucide-react-native';

import { getContactProfile, getPendingRequests } from '../chat/database';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { OnlineRing, useRingArrival } from '../components/OnlineRing';
import { MyQrSheet } from '../components/MyQrSheet';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { Avatar, Button, Header, IconButton, RowPressable, Screen } from '../components/ui';
import { PairingLink, parsePairingLink } from '../crypto/pairing';
import { t } from '../i18n';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors } from '../theme';
import { matchesSearch, ringDelay } from './home/listFormat';

type Props = {
  publicKey: string;
  contacts: Contact[];
  onScan: () => void;
  onKeyReceived: (link: PairingLink) => void;
  onRequests: () => void;
  onOpenContact: (contact: Contact) => void;
  onMessage: (contact: Contact) => void;
};

// L'annuaire : montrer son code, scanner ou coller un lien, les demandes reçues, puis tous les contacts
// par ordre alphabétique. L'accueil, lui, reste la liste des conversations.
export function ContactsScreen({ publicKey, contacts, onScan, onKeyReceived, onRequests, onOpenContact, onMessage }: Props) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const barSpace = useBottomBarSpace();
  const [query, setQuery] = useState('');
  const [showingCode, setShowingCode] = useState(false);
  const requests = getPendingRequests().length;
  const arriving = useRingArrival();

  const pasteLink = async () => {
    const link = parsePairingLink(await Clipboard.getStringAsync());
    if (link) onKeyReceived(link);
    else showDialog(t('app.lienNonReconnu'), t('ajout.copierLien'));
  };

  const sorted = contacts.filter((contact) => matchesSearch(contact.name, query)).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

  const header = (
    <View style={styles.header}>
      <SearchField value={query} onChange={setQuery} placeholder={t('liste.rechercher')} />
      <View style={styles.actions}>
        <Button label={t('contacts.montrerQr')} icon={QrCode} onPress={() => setShowingCode(true)} />
        <View style={styles.row2}>
          <View style={styles.flex}>
            <Button label={t('contacts.scanner')} icon={ScanLine} variant="secondary" onPress={onScan} />
          </View>
          <View style={styles.flex}>
            <Button label={t('ajout.coller')} icon={ClipboardPaste} variant="secondary" onPress={pasteLink} />
          </View>
        </View>
      </View>
      {requests > 0 && (
        <Pressable onPress={onRequests} style={({ pressed }) => [styles.requests, pressed && styles.pressed]}>
          <Bell size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.requestsLabel}>{t('contacts.demandes', { n: requests })}</Text>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>
      )}
      <Text style={styles.section}>{t('contacts.tous', { n: contacts.length })}</Text>
    </View>
  );

  return (
    <Screen>
      <Header title={t('contacts.titre')} />
      <FlatList
        data={sorted}
        keyExtractor={(contact) => contact.publicKey}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: barSpace }}
        ListEmptyComponent={<EmptyState label={query.trim() ? t('liste.aucunTrouve') : t('contacts.aucun')} />}
        renderItem={({ item, index }) => (
          <RowPressable onPress={() => onOpenContact(item)} style={styles.contact}>
            <OnlineRing online={!item.pending && chat.isContactOnline(item.publicKey)} size={40} delay={ringDelay(index)} trace={arriving.current}>
              <Avatar uri={getContactProfile(item.publicKey).photo_uri} size={40} />
            </OnlineRing>
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.pending && <Text style={styles.state}>{t('liste.enAttenteLigne')}</Text>}
            </View>
            {!item.pending && (
              <IconButton onPress={() => onMessage(item)} label={t('contacts.message')}>
                <MessageCircle size={22} color={colors.text} strokeWidth={1.75} />
              </IconButton>
            )}
          </RowPressable>
        )}
      />
      <MyQrSheet visible={showingCode} publicKey={publicKey} onClose={() => setShowingCode(false)} />
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  header: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  row2: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  requestsLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  section: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.lg - spacing.sm,
    paddingVertical: spacing.sm,
  },
  name: {
    fontSize: 16,
    color: colors.text,
  },
  state: {
    fontSize: 13,
    color: colors.textMuted,
  },

  pressed: {
    opacity: 0.6,
  },
}));
