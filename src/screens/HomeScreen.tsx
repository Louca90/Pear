import { QrCode } from 'lucide-react-native';
import { BlurTargetView } from 'expo-blur';
import { PinIcon, TrashIcon } from '../components/AnimatedIcons';
import { ComponentRef, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import Reanimated, { LayoutAnimationConfig, useAnimatedStyle, useSharedValue, Easing, ReduceMotion, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
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
import { OnlineRing, useRingArrival } from '../components/OnlineRing';
import { RequestsBell } from '../components/RequestsBell';
import { SearchField } from '../components/SearchField';
import { Avatar, Button, Header, IconButton, RowPressable, Screen } from '../components/ui';
import { t } from '../i18n';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors } from '../theme';
import { parisNow } from '../time';
import { ConversationActions, Rect } from './home/ConversationActions';
import { SwipeRow } from './home/SwipeRow';
import { usePullRefresh } from './home/usePullRefresh';
import { PullPear, PullView } from '../components/pull';
import { matchesSearch, previewFor, relativeTime, ringDelay } from './home/listFormat';
import { popIn, popOut, reflow, timing } from '../motion';

type Props = {
  contacts: Contact[];
  onAdd: () => void;
  // messageId : ouvrir la conversation sur ce message (résultat de recherche).
  onOpen: (contact: Contact, messageId?: string) => void;
  onRequests: () => void;
  // Le bouton QR code (à l'ancienne place du bouton Carte).
  onQr: () => void;
};

type Filter = 'all' | 'unread' | 'pinned' | 'pending' | 'online';

// Changement de catégorie : la pastille glisse jusqu'à la nouvelle, la liste entre en fondu du même côté.
const CHIP_MS = 260;
const LIST_SHIFT = 24;
type Item = {
  contact: Contact;
  last: Message | null;
  unread: number;
  pinned: boolean;
  online: boolean;
  typing: boolean;
  draft: string;
  photo: string | null;
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
    a.photo === b.photo
  );
}

// Rafraîchit « il y a X min » tant que l'écran est affiché.
const TICK_MS = 60 * 1000;

// Épinglée : la punaise apparaît en tournant (planche « Liste · maintenir une conversation »).
const pinIn: EntryExitAnimationFunction = () => {
  'worklet';
  const config = { duration: 360, easing: Easing.bezier(0.2, 0.8, 0.2, 1), reduceMotion: ReduceMotion.System };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.3 }, { rotate: '-40deg' }] },
    animations: { opacity: withTiming(1, config), transform: [{ scale: withTiming(1, config) }, { rotate: withTiming('0deg', config) }] },
  };
};

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
      <OnlineRing online={online} size={52} delay={ringDelay(index)} trace={arriving}>
        <Avatar uri={item.photo} size={52} notes={isSelf(contact.publicKey)} />
      </OnlineRing>
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          {pinned && (
            <Reanimated.View entering={pinIn}>
              <Pin size={13} color={colors.textMuted} strokeWidth={2} />
            </Reanimated.View>
          )}
          <Text style={[styles.name, bold && styles.bold]} numberOfLines={1}>
            {contact.name}
          </Text>
          {contact.verified && <ShieldCheck size={14} color={colors.signatureStrong} strokeWidth={2} accessibilityLabel={t('contact.verifie')} />}
        </View>
        <Text style={[styles.preview, bold && styles.previewUnread]} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <View style={styles.side}>
        {last && <Text style={[styles.time, bold && styles.timeUnread]}>{relativeTime(last.created_at, now)}</Text>}
        {/* Les pastilles apparaissent et disparaissent en fondu (pas à l'ouverture de l'écran). */}
        <LayoutAnimationConfig skipEntering>
          <View style={styles.badges}>
            {/* 1 à 4 non lus : le nombre exact ; 5 ou plus : un point plein sans chiffre. */}
            {preview.kind === 'unread' && (
              <Reanimated.View key="count" entering={popIn()} exiting={popOut()} style={styles.dot}>
                <Text style={styles.dotText}>{preview.count}</Text>
              </Reanimated.View>
            )}
            {preview.kind === 'many' && <Reanimated.View key="many" entering={popIn()} exiting={popOut()} style={styles.dotPlain} />}
          </View>
        </LayoutAnimationConfig>
      </View>
    </View>
  );
}, sameRow);

// Les conversations : recherche, catégories, épingles en haut, puis les plus récentes.
export function HomeScreen({ contacts, onAdd, onOpen, onRequests, onQr }: Props) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const barSpace = useBottomBarSpace();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const chipLayouts = useRef(new Map<Filter, { x: number; width: number }>()).current;
  const chipScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const chipRowWidth = useRef(0);
  // Sur le fil natif : la pastille (absolue, sans enfant : sa largeur peut s'animer) et le fondu de la liste.
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const listIn = useSharedValue(1);
  const listFrom = useSharedValue(0);
  const pillStyle = useAnimatedStyle(() => ({ width: pillWidth.get(), transform: [{ translateX: pillX.get() }] }));
  const listStyle = useAnimatedStyle(() => ({ opacity: listIn.get(), transform: [{ translateX: listFrom.get() }] }));

  const choose = (next: Filter) => {
    if (next === filter) return;
    const order = filters.map(({ value }) => value);
    const side = order.indexOf(next) > order.indexOf(filter) ? 1 : -1;
    const target = chipLayouts.get(next);
    if (target) {
      pillX.set(timing(target.x, CHIP_MS));
      pillWidth.set(timing(target.width, CHIP_MS));
      // La catégorie choisie reste entièrement visible : la rangée défile pour la centrer.
      chipScroll.current?.scrollTo({ x: Math.max(0, target.x + target.width / 2 - chipRowWidth.current / 2), animated: true });
    }
    haptics.select();
    listIn.set(0);
    listFrom.set(side * LIST_SHIFT);
    listIn.set(timing(1, CHIP_MS));
    listFrom.set(timing(0, CHIP_MS));
    setFilter(next);
  };
  const [now, setNow] = useState(parisNow);
  const arriving = useRingArrival();
  const [selected, setSelected] = useState<{ item: Item; rect: Rect } | null>(null);
  const rows = useRef(new Map<string, ComponentRef<typeof View>>());
  const blurTarget = useRef<ComponentRef<typeof View>>(null);

  useEffect(() => {
    // Pas de redessin en arrière-plan : le minuteur ne fait rien tant que l'app n'est pas affichée.
    const timer = setInterval(() => AppState.currentState === 'active' && setNow(parisNow()), TICK_MS);
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
    return {
    contact,
    photo: getContactProfile(contact.publicKey).photo_uri,
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

  // En-tête : la poire, « Messages », le QR code (ajouter quelqu'un : Mon code / Scanner) et les demandes.
  // Un seul bouton pour ajouter : le « + » faisait la même chose que le QR code.
  const logo = <Pear height={30} color={colors.text} />;
  const profileButton = (
    <View style={styles.headerActions}>
      <IconButton onPress={onQr} label={t('qr.titre')} style={styles.mapButton}>
        <QrCode size={20} color={colors.text} strokeWidth={1.75} />
      </IconButton>
      <RequestsBell count={getPendingRequests().length} onPress={onRequests} />
    </View>
  );
  const title = t('onglets.messages');
  // Sections, seulement sur « Toutes » sans recherche : les épinglées, puis les récentes.
  const sectioned = filter === 'all' && !query.trim() && visible.some((item) => item.pinned);
  const firstRecent = visible.find((item) => !item.pinned)?.contact.publicKey;

  if (contacts.length === 0) {
    return (
      <Screen>
        <Header title={title} avatar={logo} action={profileButton} />
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
      <BlurTargetView ref={blurTarget} style={styles.flex}>
      <Header title={title} avatar={logo} action={profileButton} />
      <SearchField value={query} onChange={setQuery} placeholder={t('liste.rechercher')} />
      <View>
        <ScrollView
          ref={chipScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          onLayout={({ nativeEvent: { layout } }) => {
            chipRowWidth.current = layout.width;
          }}
        >
          <Reanimated.View style={[styles.chipPill, pillStyle]} />
          {filters.map((option) => {
            const active = option.value === filter;
            return (
              <Pressable
                key={option.value}
                onPress={() => choose(option.value)}
                onLayout={({ nativeEvent: { layout } }) => {
                  chipLayouts.set(option.value, { x: layout.x, width: layout.width });
                  if (active) {
                    pillX.set(layout.x);
                    pillWidth.set(layout.width);
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
      <PullView gesture={pull.gesture} offset={pull.offset} indicator={<PullPear offset={pull.offset} dir={1} kind="bitten" busy={pull.busy} size={54} />}>
      <Reanimated.FlatList
        style={listStyle}
        data={visible}
        // Une conversation qui remonte ou qu'on épingle glisse jusqu'à sa nouvelle place.
        itemLayoutAnimation={reflow}
        {...pull.listProps}
        contentContainerStyle={{ paddingBottom: barSpace }}
        keyExtractor={(item) => item.contact.publicKey}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
          <View>
            {sectioned && index === 0 && <Text style={styles.section}>{t('liste.sectionEpinglees')}</Text>}
            {sectioned && item.contact.publicKey === firstRecent && <Text style={styles.section}>{t('liste.sectionRecentes')}</Text>}
            {/* Seule la ligne est mesurée (pas le titre de section au-dessus) : la carte de sélection s'y pose exactement. */}
            <View
              ref={(view) => {
                if (view) rows.current.set(item.contact.publicKey, view);
                else rows.current.delete(item.contact.publicKey);
              }}
              collapsable={false}
            >
            {isSelf(item.contact.publicKey) ? (
              // Mes notes : ni épingle ni « lu » à glisser, seulement ouvrir (et vider, par appui long).
              <RowPressable onPress={() => onOpen(item.contact)} onLongPress={item.last ? () => select(item) : undefined} holdMs={420} style={styles.row}>
                <ConversationRow item={item} now={now} index={index} arriving={false} />
              </RowPressable>
            ) : (
              <SwipeRow pinned={item.pinned} canMarkRead={item.unread > 0} onPin={() => togglePin(item)} onMarkRead={() => markRead(item)}>
                <RowPressable onPress={() => onOpen(item.contact)} onLongPress={() => select(item)} holdMs={420} style={styles.row}>
                  <ConversationRow item={item} now={now} index={index} arriving={arriving.current} />
                </RowPressable>
              </SwipeRow>
            )}
            </View>
          </View>
        )}
      />
      </PullView>
      </BlurTargetView>
      {selected && (
        <ConversationActions
          blurTarget={blurTarget}
          rect={selected.rect}
          row={<ConversationRow item={selected.item} now={now} index={0} arriving={false} />}
          onClose={() => setSelected(null)}
          actions={isSelf(selected.item.contact.publicKey) ? [{ label: t('liste.supprimer'), icon: Trash2, animated: TrashIcon, danger: true, onPress: () => confirmDelete(selected.item) }] : [
            { label: selected.item.pinned ? t('liste.desepingler') : t('liste.epingler'), icon: selected.item.pinned ? PinOff : Pin, animated: selected.item.pinned ? undefined : PinIcon, onPress: () => togglePin(selected.item) },
            ...(selected.item.unread > 0
              ? [
                  {
                    label: t('liste.marquerLu'),
                    icon: CheckCheck,
                    onPress: () => markRead(selected.item),
                  },
                ]
              : []),
            { label: t('liste.supprimer'), icon: Trash2, animated: TrashIcon, danger: true, onPress: () => confirmDelete(selected.item) },
          ]}
        />
      )}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
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
  // Les catégories sont des onglets en texte ; un trait de la couleur signature glisse sous l'actif.
  chip: {
    height: 32,
    marginRight: spacing.md,
    justifyContent: 'center',
  },
  chipActive: {},
  chipPill: {
    position: 'absolute',
    left: 0,
    top: spacing.md + 30,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.signatureStrong,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  chipLabelActive: {
    color: colors.text,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 4,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 13,
    color: colors.textMuted,
  },
  // Non lu : l'heure passe en couleur signature, comme la pastille.
  timeUnread: {
    fontWeight: '600',
    color: colors.signatureStrong,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 20,
  },
  dot: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    backgroundColor: colors.signatureStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSignature,
  },
  dotPlain: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    backgroundColor: colors.signatureStrong,
  },
}));
