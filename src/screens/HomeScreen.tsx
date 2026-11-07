import { ComponentRef, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CheckCheck, Flame, Pin, PinOff, Plus, Trash2, Users } from 'lucide-react-native';

import {
  deleteMessages,
  describeMessage,
  getContactProfile,
  getLastMessage,
  getPendingRequests,
  getPinnedOrder,
  getStreak,
  getUnreadCounts,
  markConversationRead,
  Message,
  setPinned,
} from '../chat/database';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { PermissionBanner } from '../components/PermissionBanner';
import { RequestsBell } from '../components/RequestsBell';
import { SearchField } from '../components/SearchField';
import { Avatar, Button, Header, RowPressable, Screen } from '../components/ui';
import { t } from '../i18n';
import { log } from '../log';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors } from '../theme';
import { parisNow } from '../time';
import { ConversationActions, Rect } from './home/ConversationActions';
import { matchesSearch, previewFor, relativeTime } from './home/listFormat';

type Props = {
  contacts: Contact[];
  onAdd: () => void;
  onOpen: (contact: Contact) => void;
  onRequests: () => void;
  permissionMissing: boolean;
  onFixPermissions: () => void;
};

type Filter = 'all' | 'unread' | 'pinned' | 'pending' | 'online';

// Changement de catégorie : la pastille glisse jusqu'à la nouvelle, la liste entre en fondu du même côté.
const CHIP_MS = 260;
const LIST_SHIFT = 24;
const CHIP_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
type Item = { contact: Contact; last: Message | null; unread: number; pinned: boolean; online: boolean };

// Rafraîchit « il y a X min » tant que l'écran est affiché.
const TICK_MS = 60 * 1000;

function ConversationRow({ item, now }: { item: Item; now: number }) {
  const colors = useColors();
  const styles = useStyles();
  const { contact, last, unread, pinned, online } = item;
  const preview = previewFor(last, unread);
  const streak = getStreak(contact.publicKey);
  const bold = unread > 0;

  let line: string;
  if (contact.pending) line = t('liste.enAttenteLigne');
  else if (preview.kind === 'none') line = t('accueil.aucunMessage');
  else if (preview.kind === 'many') line = t('liste.nouveaux');
  else if (preview.kind === 'unread' && last) line = describeMessage(last);
  else if (preview.kind === 'status') line = t(preview.mine ? 'liste.envoye' : 'liste.recu', { quand: relativeTime(preview.at, now) });
  else line = '';

  return (
    <View style={styles.rowInner}>
      <View>
        <Avatar uri={getContactProfile(contact.publicKey).photo_uri} />
        {online && <View style={styles.online} accessibilityLabel={t('accueil.enLigne')} />}
      </View>
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          {pinned && <Pin size={13} color={colors.textMuted} strokeWidth={2} />}
          <Text style={[styles.name, bold && styles.bold]} numberOfLines={1}>
            {contact.name}
          </Text>
        </View>
        <Text style={[styles.preview, bold && styles.previewUnread]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <View style={styles.side}>
        {last && <Text style={[styles.time, bold && styles.bold]}>{relativeTime(last.created_at, now)}</Text>}
        <View style={styles.badges}>
          {streak > 0 && (
            <View style={styles.streak} accessibilityLabel={t('accueil.serie', { n: streak })}>
              <Flame size={14} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.streakCount}>{streak}</Text>
            </View>
          )}
          {/* 1 à 4 non lus : le nombre exact ; 5 ou plus : un point plein sans chiffre. */}
          {preview.kind === 'unread' && (
            <View style={styles.dot}>
              <Text style={styles.dotText}>{preview.count}</Text>
            </View>
          )}
          {preview.kind === 'many' && <View style={styles.dotPlain} />}
        </View>
      </View>
    </View>
  );
}

// Les conversations : recherche, catégories, épingles en haut, puis les plus récentes.
export function HomeScreen({ contacts, onAdd, onOpen, onRequests, permissionMissing, onFixPermissions }: Props) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const barSpace = useBottomBarSpace();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const chipLayouts = useRef(new Map<Filter, { x: number; width: number }>()).current;
  const pillX = useRef(new Animated.Value(0)).current;
  const pillWidth = useRef(new Animated.Value(0)).current;
  const listIn = useRef(new Animated.Value(1)).current;
  const listFrom = useRef(new Animated.Value(0)).current;

  const choose = (next: Filter) => {
    if (next === filter) return;
    const order = filters.map(({ value }) => value);
    const side = order.indexOf(next) > order.indexOf(filter) ? 1 : -1;
    const target = chipLayouts.get(next);
    if (target) {
      Animated.parallel([
        Animated.timing(pillX, { toValue: target.x, duration: CHIP_MS, easing: CHIP_EASING, useNativeDriver: false }),
        Animated.timing(pillWidth, { toValue: target.width, duration: CHIP_MS, easing: CHIP_EASING, useNativeDriver: false }),
      ]).start();
    }
    listIn.setValue(0);
    listFrom.setValue(side * LIST_SHIFT);
    Animated.parallel([
      Animated.timing(listIn, { toValue: 1, duration: CHIP_MS, easing: CHIP_EASING, useNativeDriver: true }),
      Animated.timing(listFrom, { toValue: 0, duration: CHIP_MS, easing: CHIP_EASING, useNativeDriver: true }),
    ]).start();
    setFilter(next);
  };
  const [now, setNow] = useState(parisNow);
  const [selected, setSelected] = useState<{ item: Item; rect: Rect } | null>(null);
  const rows = useRef(new Map<string, ComponentRef<typeof View>>());

  useEffect(() => {
    const timer = setInterval(() => setNow(parisNow()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const unreadCounts = getUnreadCounts();
  const pinnedOrder = getPinnedOrder();
  const items: Item[] = contacts.map((contact) => ({
    contact,
    last: getLastMessage(contact.publicKey),
    unread: unreadCounts.get(contact.publicKey) ?? 0,
    pinned: pinnedOrder.includes(contact.publicKey),
    online: chat.getLink(contact.publicKey).status === 'connected',
  }));
  // Épinglées d'abord (dans leur ordre), puis la conversation la plus récente en haut.
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned) return pinnedOrder.indexOf(a.contact.publicKey) - pinnedOrder.indexOf(b.contact.publicKey);
    return (b.last?.created_at ?? 0) - (a.last?.created_at ?? 0) || a.contact.name.localeCompare(b.contact.name);
  });

  const unreadConversations = items.filter((item) => item.unread > 0).length;
  const visible = items.filter(
    (item) =>
      matchesSearch(item.contact.name, query) &&
      (filter === 'all' ||
        (filter === 'unread' && item.unread > 0) ||
        (filter === 'pinned' && item.pinned) ||
        (filter === 'pending' && item.contact.pending) ||
        (filter === 'online' && item.online)),
  );

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: t('liste.toutes') },
    { value: 'unread', label: unreadConversations > 0 ? `${t('liste.nonLus')} ${unreadConversations}` : t('liste.nonLus') },
    { value: 'pinned', label: t('liste.epingles') },
    { value: 'pending', label: t('liste.enAttente') },
    { value: 'online', label: t('liste.enLigne') },
  ];
  const emptyLabel = query.trim()
    ? t('liste.aucunTrouve')
    : { all: t('accueil.aucunMessage'), unread: t('liste.aucunNonLu'), pinned: t('liste.aucunEpingle'), pending: t('liste.aucunEnAttente'), online: t('liste.aucunEnLigne') }[filter];

  const select = (item: Item) => {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch((e) => log.warn('vibration', e));
    rows.current.get(item.contact.publicKey)?.measureInWindow((x, y, width, height) => setSelected({ item, rect: { x, y, width, height } }));
  };

  const togglePin = (item: Item) => {
    if (!setPinned(item.contact.publicKey, !item.pinned)) showDialog(t('liste.limiteEpingles'), t('liste.limiteEpinglesAide'));
    chat.refresh();
  };

  const confirmDelete = (item: Item) =>
    showDialog(t('liste.supprimerQuestion'), t('liste.supprimerAide', { nom: item.contact.name }), [
      {
        label: t('commun.supprimer'),
        style: 'danger',
        onPress: () => {
          deleteMessages(item.contact.publicKey);
          chat.refresh();
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);

  const profileButton = <RequestsBell count={getPendingRequests().length} onPress={onRequests} />;

  if (contacts.length === 0) {
    return (
      <Screen>
        <Header title="Pear" action={profileButton} />
        <PermissionBanner visible={permissionMissing} onPress={onFixPermissions} />
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Users size={28} color={colors.text} strokeWidth={1.75} />
          </View>
          <Text style={styles.emptyTitle}>{t('accueil.aucunContact')}</Text>
          <Text style={styles.emptyText}>{t('accueil.aucunContactAide')}</Text>
          <Button label={t('accueil.ajouterContact')} icon={Plus} onPress={onAdd} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Pear" action={profileButton} />
      <PermissionBanner visible={permissionMissing} onPress={onFixPermissions} />
      <SearchField value={query} onChange={setQuery} placeholder={t('liste.rechercher')} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Animated.View style={[styles.chipPill, { left: pillX, width: pillWidth }]} />
          {filters.map((option) => {
            const active = option.value === filter;
            return (
              <Pressable
                key={option.value}
                onPress={() => choose(option.value)}
                onLayout={({ nativeEvent: { layout } }) => {
                  chipLayouts.set(option.value, { x: layout.x, width: layout.width });
                  if (active) {
                    pillX.setValue(layout.x);
                    pillWidth.setValue(layout.width);
                  }
                }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <Animated.FlatList
        style={{ opacity: listIn, transform: [{ translateX: listFrom }] }}
        data={visible}
        contentContainerStyle={{ paddingBottom: barSpace }}
        keyExtractor={(item) => item.contact.publicKey}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.listEmpty}>{emptyLabel}</Text>}
        renderItem={({ item }) => (
          <View
            ref={(view) => {
              if (view) rows.current.set(item.contact.publicKey, view);
              else rows.current.delete(item.contact.publicKey);
            }}
            collapsable={false}
          >
            <RowPressable onPress={() => onOpen(item.contact)} onLongPress={() => select(item)} style={styles.row}>
              <ConversationRow item={item} now={now} />
            </RowPressable>
          </View>
        )}
      />
      {selected && (
        <ConversationActions
          rect={selected.rect}
          row={
            <View style={styles.row}>
              <ConversationRow item={selected.item} now={now} />
            </View>
          }
          onClose={() => setSelected(null)}
          actions={[
            { label: selected.item.pinned ? t('liste.desepingler') : t('liste.epingler'), icon: selected.item.pinned ? PinOff : Pin, onPress: () => togglePin(selected.item) },
            ...(selected.item.unread > 0
              ? [
                  {
                    label: t('liste.marquerLu'),
                    icon: CheckCheck,
                    onPress: () => {
                      markConversationRead(selected.item.contact.publicKey);
                      chat.refresh();
                    },
                  },
                ]
              : []),
            { label: t('liste.supprimer'), icon: Trash2, danger: true, onPress: () => confirmDelete(selected.item) },
          ]}
        />
      )}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
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
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  // Transparente : c'est la pastille, qui glisse dessous, qui la colore.
  chipActive: {
    backgroundColor: 'transparent',
  },
  chipPill: {
    position: 'absolute',
    top: spacing.md,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  chipLabel: {
    fontSize: 14,
    color: colors.text,
  },
  chipLabelActive: {
    color: colors.onAccent,
    fontWeight: '600',
  },
  listEmpty: {
    textAlign: 'center',
    fontSize: 15,
    color: colors.textMuted,
    marginTop: spacing.lg,
  },
  row: {
    // La ligne est en retrait des bords pour que son fond d'appui arrondi reste visible ; le texte garde son alignement.
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.lg - spacing.sm,
    paddingVertical: spacing.md,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  bold: {
    fontWeight: '700',
    color: colors.text,
  },
  preview: {
    fontSize: 14,
    color: colors.textMuted,
  },
  previewUnread: {
    color: colors.text,
    fontWeight: '600',
  },
  side: {
    alignItems: 'flex-end',
    gap: 4,
  },
  time: {
    fontSize: 12,
    color: colors.textMuted,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 20,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  streakCount: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  dot: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onAccent,
  },
  dotPlain: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
}));
