import { ComponentRef, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { haptics } from '../haptics';
import { CheckCheck, Pin, PinOff, Plus, ShieldCheck, Trash2 } from 'lucide-react-native';

import {
  deleteMessages,
  describeMessage,
  getContactProfile,
  getDraft,
  getLastMessage,
  getPendingRequests,
  getPinnedOrder,
  getStreakState,
  getUnreadCounts,
  markConversationRead,
  Message,
  searchMessages,
  setPinned,
} from '../chat/database';
import { MessageHitRow } from '../components/MessageHits';
import { isSelf, SELF } from '../chat/self';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { EmptyState } from '../components/EmptyState';
import { Pear } from '../components/Pear';
import { PermissionBanner } from '../components/PermissionBanner';
import { OnlineRing, useRingArrival } from '../components/OnlineRing';
import { RequestsBell } from '../components/RequestsBell';
import { SearchField } from '../components/SearchField';
import { StreakFlame } from '../components/StreakFlame';
import { Avatar, Button, Header, RowPressable, Screen } from '../components/ui';
import { t } from '../i18n';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors } from '../theme';
import { parisNow } from '../time';
import { ConversationActions, Rect } from './home/ConversationActions';
import { SwipeRow } from './home/SwipeRow';
import { usePullRefresh } from './home/usePullRefresh';
import { PullPear, PullView } from '../components/pull';
import { matchesSearch, previewFor, relativeTime, ringDelay } from './home/listFormat';

type Props = {
  contacts: Contact[];
  onAdd: () => void;
  // messageId : ouvrir la conversation sur ce message (résultat de recherche).
  onOpen: (contact: Contact, messageId?: string) => void;
  onRequests: () => void;
  permissionMissing: boolean;
  onFixPermissions: () => void;
};

type Filter = 'all' | 'unread' | 'pinned' | 'pending' | 'online';

// Changement de catégorie : la pastille glisse jusqu'à la nouvelle, la liste entre en fondu du même côté.
const CHIP_MS = 260;
const LIST_SHIFT = 24;
const CHIP_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
type Item = {
  contact: Contact;
  last: Message | null;
  unread: number;
  pinned: boolean;
  online: boolean;
  typing: boolean;
  draft: string;
  photo: string | null;
  streakCount: number;
  streakToday: boolean;
};
type RowProps = { item: Item; now: number; index: number; arriving: boolean };

// Une ligne ne se redessine que si ce qu'elle affiche a changé : l'accueil est prévenu à chaque signal
// du moteur (« écrit… », avancement d'un transfert, même dans une autre conversation).
function sameRow(previous: RowProps, next: RowProps) {
  if (previous.now !== next.now || previous.index !== next.index || previous.arriving !== next.arriving) return false;
  const a = previous.item;
  const b = next.item;
  const lastSame =
    a.last === b.last ||
    (!!a.last && !!b.last && (Object.keys(a.last) as (keyof Message)[]).every((key) => a.last?.[key] === b.last?.[key]));
  return (
    lastSame &&
    a.contact.publicKey === b.contact.publicKey &&
    a.contact.name === b.contact.name &&
    a.contact.pending === b.contact.pending &&
    a.contact.verified === b.contact.verified &&
    a.unread === b.unread &&
    a.pinned === b.pinned &&
    a.online === b.online &&
    a.typing === b.typing &&
    a.draft === b.draft &&
    a.photo === b.photo &&
    a.streakCount === b.streakCount &&
    a.streakToday === b.streakToday
  );
}

// Rafraîchit « il y a X min » tant que l'écran est affiché.
const TICK_MS = 60 * 1000;

const ConversationRow = memo(function ConversationRow({ item, now, index, arriving }: RowProps) {
  const colors = useColors();
  const styles = useStyles();
  const { contact, last, unread, pinned, online, typing, draft } = item;
  const preview = previewFor(last, unread);
  const bold = unread > 0;

  let line: string;
  if (isSelf(contact.publicKey) && !draft) line = last ? describeMessage(last) : t('notes.vide');
  else if (contact.pending) line = t('liste.enAttenteLigne');
  else if (typing) line = t('chat.ecrit');
  else if (draft) line = t('liste.brouillon', { texte: draft.replace(/\s+/g, ' ').trim() });
  else if (preview.kind === 'none') line = t('accueil.aucunMessage');
  else if (preview.kind === 'many') line = t('liste.nouveaux');
  else if (preview.kind === 'unread' && last) line = describeMessage(last);
  else if (preview.kind === 'status') line = t(preview.mine ? 'liste.envoye' : 'liste.recu', { quand: relativeTime(preview.at, now) });
  else line = '';

  return (
    <View style={styles.rowInner}>
      <OnlineRing online={online} size={44} delay={ringDelay(index)} trace={arriving}>
        <Avatar uri={item.photo} notes={isSelf(contact.publicKey)} />
      </OnlineRing>
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          {pinned && <Pin size={13} color={colors.textMuted} strokeWidth={2} />}
          <Text style={[styles.name, bold && styles.bold]} numberOfLines={1}>
            {contact.name}
          </Text>
          {contact.verified && <ShieldCheck size={14} color={colors.signatureStrong} strokeWidth={2} accessibilityLabel={t('contact.verifie')} />}
          <StreakFlame id={contact.publicKey} count={item.streakCount} lit={item.streakToday} size={15} />
        </View>
        <Text style={[styles.preview, bold && styles.previewUnread] } numberOfLines={1}>
          {line}
        </Text>
      </View>
      <View style={styles.side}>
        {last && <Text style={[styles.time, bold && styles.bold]}>{relativeTime(last.created_at, now)}</Text>}
        <View style={styles.badges}>
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
}, sameRow);

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
  const arriving = useRingArrival();
  const [selected, setSelected] = useState<{ item: Item; rect: Rect } | null>(null);
  const rows = useRef(new Map<string, ComponentRef<typeof View>>());

  useEffect(() => {
    const timer = setInterval(() => setNow(parisNow()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Tirer pour actualiser : relance tout de suite les connexions en attente et remet les heures à jour.
  const pull = usePullRefresh(() => {
    chat.retryAll();
    setNow(parisNow());
  });

  const unreadCounts = getUnreadCounts();
  const pinnedOrder = getPinnedOrder();
  // Notes à moi-même (lot 4.6) : une conversation comme les autres dans la liste, sans réseau.
  const items: Item[] = [...contacts, { publicKey: SELF, name: t('notes.titre') }].map((contact) => {
    const streak = getStreakState(contact.publicKey);
    return {
    contact,
    photo: getContactProfile(contact.publicKey).photo_uri,
    streakCount: streak.count,
    streakToday: streak.today,
    last: getLastMessage(contact.publicKey),
    unread: unreadCounts.get(contact.publicKey) ?? 0,
    pinned: pinnedOrder.includes(contact.publicKey),
    online: chat.isContactOnline(contact.publicKey),
    typing: chat.isTyping(contact.publicKey),
    draft: getDraft(contact.publicKey),
    };
  });
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
  // Recherche (lot 4.1) : sous les conversations dont le nom correspond, les messages qui contiennent
  // les mots cherchés, toutes conversations confondues.
  const byKey = new Map(items.map(({ contact }) => [contact.publicKey, contact]));
  const messageHits = useMemo(() => (query.trim().length >= 2 ? searchMessages(query) : []), [query]).filter((hit) => byKey.has(hit.contact));
  const emptyLabel = messageHits.length > 0 ? '' : query.trim()
    ? t('liste.aucunTrouve')
    : { all: t('accueil.aucunMessage'), unread: t('liste.aucunNonLu'), pinned: t('liste.aucunEpingle'), pending: t('liste.aucunEnAttente'), online: t('liste.aucunEnLigne') }[filter];

  const select = (item: Item) => {
    haptics.action();
    rows.current.get(item.contact.publicKey)?.measureInWindow((x, y, width, height) => setSelected({ item, rect: { x, y, width, height } }));
  };

  const togglePin = (item: Item) => {
    if (!setPinned(item.contact.publicKey, !item.pinned)) showDialog(t('liste.limiteEpingles'), t('liste.limiteEpinglesAide'));
    chat.refresh();
  };

  const markRead = (item: Item) => {
    markConversationRead(item.contact.publicKey);
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
          <View style={styles.emptyPear}>
            <Pear height={56} color={colors.textMuted} state="resting" />
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
      <PullView gesture={pull.gesture} offset={pull.offset} indicator={<PullPear offset={pull.offset} dir={1} kind="bitten" busy={pull.busy} />}>
      <Animated.FlatList
        style={{ opacity: listIn, transform: [{ translateX: listFrom }] }}
        data={visible}
        {...pull.listProps}
        contentContainerStyle={{ paddingBottom: barSpace }}
        keyExtractor={(item) => item.contact.publicKey}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={emptyLabel ? <EmptyState key={emptyLabel} label={emptyLabel} /> : undefined}
        ListFooterComponent={
          messageHits.length > 0 ? (
            <View>
              <Text style={styles.hitsTitle}>{t('recherche.messages')}</Text>
              {messageHits.map((hit) => {
                const contact = byKey.get(hit.contact);
                return contact ? <MessageHitRow key={`${hit.contact}:${hit.id}`} hit={hit} name={contact.name} query={query} onPress={() => onOpen(contact, hit.id)} /> : null;
              })}
            </View>
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <View
            ref={(view) => {
              if (view) rows.current.set(item.contact.publicKey, view);
              else rows.current.delete(item.contact.publicKey);
            }}
            collapsable={false}
          >
            {isSelf(item.contact.publicKey) ? (
              // Mes notes : ni épingle ni « lu » à glisser, seulement ouvrir (et vider, par appui long).
              <RowPressable onPress={() => onOpen(item.contact)} onLongPress={item.last ? () => select(item) : undefined} style={styles.row}>
                <ConversationRow item={item} now={now} index={index} arriving={false} />
              </RowPressable>
            ) : (
              <SwipeRow pinned={item.pinned} canMarkRead={item.unread > 0} onPin={() => togglePin(item)} onMarkRead={() => markRead(item)}>
                <RowPressable onPress={() => onOpen(item.contact)} onLongPress={() => select(item)} style={styles.row}>
                  <ConversationRow item={item} now={now} index={index} arriving={arriving.current} />
                </RowPressable>
              </SwipeRow>
            )}
          </View>
        )}
      />
      </PullView>
      {selected && (
        <ConversationActions
          rect={selected.rect}
          row={
            <View style={styles.row}>
              <ConversationRow item={selected.item} now={now} index={0} arriving={false} />
            </View>
          }
          onClose={() => setSelected(null)}
          actions={isSelf(selected.item.contact.publicKey) ? [{ label: t('liste.supprimer'), icon: Trash2, danger: true, onPress: () => confirmDelete(selected.item) }] : [
            { label: selected.item.pinned ? t('liste.desepingler') : t('liste.epingler'), icon: selected.item.pinned ? PinOff : Pin, onPress: () => togglePin(selected.item) },
            ...(selected.item.unread > 0
              ? [
                  {
                    label: t('liste.marquerLu'),
                    icon: CheckCheck,
                    onPress: () => markRead(selected.item),
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
  emptyPear: {
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
  hitsTitle: {
    marginTop: spacing.lg,
    marginBottom: 4,
    paddingHorizontal: spacing.lg,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
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
