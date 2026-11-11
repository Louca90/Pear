import { memo, ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Forward, Reply } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { createStyles, ephemeralBubble, radius, spacing, useColors } from '../../../theme';

import { AlbumGrid, albumHeight } from './AlbumGrid';
import { FileContent } from './FileContent';
import { LinkPreviewCard } from './LinkPreview';
import { LocationContent } from './LocationContent';
import { parseMeta } from '../../../chat/meta';
import { FittedText, TextFit } from './FittedText';
import { MessageMeta } from './MessageMeta';
import { ReplyQuote } from './ReplyQuote';
import { t } from '../../../i18n';
import { SystemRow } from './SystemRow';
import { VoiceContent } from './VoiceContent';
import { LIKE, LONG_PRESS_MS, MEDIA_WIDTH, SWIPE_REPLY, SWIPE_START, TEXT_LINE_HEIGHT } from '../constants';
import { emojiOnly, isBareMedia, isMediaDeleted } from '../format';
import { LikeBurst, useReactionAppear } from '../../../components/LikeAnimation';
import { useDoubleTap } from '../hooks/useDoubleTap';
import { useSwipeReply } from '../hooks/useSwipeReply';
import { GroupPosition } from '../../../chat/grouping';
import { Avatar } from '../../../components/ui';
import { useChatStyles } from '../styles';
import { Palettes, Rect, ViewRef } from '../types';

// Sans bulle, l'heure et les coches sont posées sur le fond : sur une image, elles gardent leur propre pastille sombre.

type BubbleProps = {
  message: Message;
  name: string;
  palettes: Palettes;
  hidden?: boolean;
  mediaHidden?: boolean;
  // Change quand on saute vers ce message : il grossit un instant pour qu'on le repère.
  pulse?: number;
  onOpenFile?: (message: Message, rect: Rect) => void;
  onPrepareFile?: (message: Message) => void;
  onAcceptFile?: (message: Message) => void;
  onRefuseFile?: (message: Message) => void;
  // measure relit la position de la bulle au moment voulu (après la fermeture du clavier, par exemple).
  onSelect?: (message: Message, measure: (done: (rect: Rect) => void) => void) => void;
  onDoubleTap?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onJump?: (id: string) => void;
  // Sélection d'un message très long : le texte se replie pour tenir à l'écran.
  fit?: TextFit;
  // Place dans son groupe de bulles (lot 8.13) ; absente (sélection), la bulle est seule.
  position?: GroupPosition;
  // Photo du contact, à côté du dernier message reçu d'un groupe.
  avatar?: string | null;
  // Faux dans la sélection : la bulle se place exactement là où elle était, sans marge.
  spaced?: boolean;
  onShowReactions?: (message: Message) => void;
  // Sélection : l'heure et les coches d'un message qui n'en montre pas (milieu d'un groupe) s'ouvrent
  // avec cette valeur (0 → 1), au lieu d'apparaître d'un coup.
  metaReveal?: Animated.Value;
  // Vocal à lancer quand celui-ci se termine (vocaux enchaînés).
  nextVoice?: string;
  // Album (lot 4.5) : le message le plus récent (lead) dessine la grille de tous, les autres rien.
  album?: { lead: boolean; members: Message[] } | null;
  // Le média ouvert dans la visionneuse (case d'album à effacer le temps de l'ouverture).
  viewingId?: string;
};

// La ligne heure/coches qui s'ouvre : sa hauteur passe de 0 à sa taille réelle, en fondu.
function RevealMeta({ value, children }: { value: Animated.Value; children: ReactNode }) {
  const [height, setHeight] = useState(0);
  return (
    <Animated.View style={{ height: value.interpolate({ inputRange: [0, 1], outputRange: [0, height] }), opacity: value, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, right: 0 }} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
        {children}
      </View>
    </Animated.View>
  );
}

// Coins des bulles : grands partout, petits côté auteur là où la bulle touche sa voisine du groupe.
const BIG_CORNER = 20;
const SMALL_CORNER = 6;
const GROUP_GAP = 2;
const BETWEEN_GROUPS = 10;
const AVATAR_SIZE = 28;
const FLEETING_BORDER = 1.5;
// Emoji seul, en grand et sans bulle : plus il y en a, plus ils rapetissent.
const EMOJI_SIZES = [0, 48, 40, 34];

function groupCorners(position: GroupPosition, mine: boolean) {
  const side = mine ? 'Right' : 'Left';
  const top = position === 'middle' || position === 'last' ? SMALL_CORNER : BIG_CORNER;
  const bottom = position === 'middle' || position === 'first' ? SMALL_CORNER : BIG_CORNER;
  return { borderRadius: BIG_CORNER, [`borderTop${side}Radius`]: top, [`borderBottom${side}Radius`]: bottom };
}

// Les messages déjà affichés : seuls ceux qui arrivent pendant que la conversation est ouverte
// (envoyés ou reçus) font leur entrée, pas ceux qu'on retrouve en défilant.
const shownIds = new Set<string>();
const POP_MS = 240;

export function markMessagesShown(ids: string[]) {
  for (const id of ids) shownIds.add(id);
}

// Deux messages relus de la base sont deux objets différents : ils sont comparés champ par champ.
function sameMessage(a: Message, b: Message) {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof Message)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

// Une bulle ne se redessine que si quelque chose qu'elle affiche a changé. Sans ça, chaque lettre
// tapée et chaque signal du moteur (« écrit… », avancement d'un transfert) redessinait toutes les
// bulles à l'écran. Ce qui change sans passer par les props (avancement, message cité) est suivi par
// le composant qui l'affiche.
function sameBubble(previous: BubbleProps, next: BubbleProps) {
  const keys = Object.keys(next) as (keyof BubbleProps)[];
  if (keys.length !== Object.keys(previous).length) return false;
  return keys.every((key) => {
    if (key === 'message') return sameMessage(previous.message, next.message);
    if (key === 'album') {
      const a = previous.album;
      const b = next.album;
      if (!a || !b) return a === b;
      return a.lead === b.lead && a.members.length === b.members.length && a.members.every((member, index) => sameMessage(member, b.members[index]));
    }
    return previous[key] === next[key];
  });
}

export const Bubble = memo(BubbleView, sameBubble);

function BubbleView({ message, name, palettes, hidden, mediaHidden, pulse, onOpenFile, onPrepareFile, onAcceptFile, onRefuseFile, onSelect, onDoubleTap, onReply, onJump, fit, position, avatar, spaced = true, onShowReactions, metaReveal, nextVoice, album, viewingId }: BubbleProps) {
  const styles = useStyles();
  const colors = useColors();
  const container = useRef<ViewRef>(null);
  const mine = message.mine === 1;
  // Une citation ou un transfert gardent la bulle : l'emoji seul n'y est pas mis en grand.
  const emojis = message.kind === 'text' && !message.reply_to && message.forwarded !== 1 ? emojiOnly(message.text) : 0;
  const bare = !!album || isBareMedia(message) || emojis > 0;
  // Message éphémère : bulle vide cernée de pointillés, pour le distinguer de ceux qui restent.
  const fleeting = message.expires_at ? ephemeralBubble(mine ? palettes.mine : palettes.theirs, colors) : null;
  const palette = fleeting ?? (mine ? palettes.mine : palettes.theirs);
  // Un album montre les réactions de tous ses médias.
  const reactions = (album ? album.members : [message]).flatMap((member) => [member.their_reaction, member.my_reaction]).filter(Boolean);
  const linkPreview = message.kind === 'text' && message.meta ? parseMeta(message.meta).preview : undefined;
  const scale = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(shownIds.has(message.id) ? 1 : 0)).current;

  // Arrivée : fondu, légère montée et zoom de 96 % à 100 %, sans rebond.
  useEffect(() => {
    if (shownIds.has(message.id)) return;
    shownIds.add(message.id);
    Animated.timing(pop, { toValue: 1, duration: POP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [message.id, pop]);

  // Message rejoint (citation, épinglé) : il grossit un peu puis revient doucement.
  useEffect(() => {
    if (!pulse) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [pulse, scale]);

  const { swipe, panHandlers: swipeHandlers } = useSwipeReply(message, mine, onReply);
  const iconRange = mine ? [-SWIPE_REPLY, -SWIPE_START] : [SWIPE_START, SWIPE_REPLY];
  const iconOutput = (hiddenValue: number, shownValue: number) => (mine ? [shownValue, hiddenValue] : [hiddenValue, shownValue]);

  const select = () => {
    onSelect?.(message, (done) => container.current?.measureInWindow((x, y, width, height) => done({ x, y, width, height })));
  };
  // Appui long sur une case d'album : ce média-là est sélectionné, seul, à la place de la grille (sa
  // bulle fait 220 points de haut, quelle que soit la hauteur de la grille).
  const selectMember = (member: Message) => {
    const gridHeight = albumHeight(album?.members.length ?? 0);
    onSelect?.(member, (done) => container.current?.measureInWindow((x, y, width, height) => done({ x, y, width, height: height - gridHeight + MEDIA_WIDTH })));
  };

  // Like : un petit cœur s'envole du coin de la bulle (double appui, ou like reçu conversation ouverte).
  const [burst, setBurst] = useState(0);
  const press = useDoubleTap(
    onDoubleTap &&
      (() => {
        // Le double appui met le cœur, puis l'enlève : le petit cœur ne s'envole qu'à l'ajout.
        if (message.my_reaction !== LIKE) setBurst(Date.now());
        onDoubleTap(message);
      }),
  );
  const previousTheirs = useRef(message.their_reaction);
  useEffect(() => {
    if (message.their_reaction && message.their_reaction !== previousTheirs.current) setBurst(Date.now());
    previousTheirs.current = message.their_reaction;
  }, [message.their_reaction]);
  // Le badge garde ses réactions le temps de disparaître.
  const lastReactions = useRef(reactions);
  if (reactions.length > 0) lastReactions.current = reactions;
  const badge = useReactionAppear(reactions.length > 0);

  if (album && !album.lead) return null;
  if (message.kind === 'wallpaper' || message.kind === 'system') {
    return (
      <View style={position && styles.systemSpacing}>
        <SystemRow message={message} name={name} hasWallpaper={palettes.hasWallpaper} />
      </View>
    );
  }
  const meta = bare ? (
    <MessageMeta message={message} tone={palettes.hasWallpaper ? { text: colors.onMedia, muted: colors.onDarkMuted } : { text: colors.text, muted: colors.textMuted }} pill={palettes.hasWallpaper} />
  ) : (
    <MessageMeta message={message} tone={palette} />
  );
  const place = position ?? 'single';
  const endsGroup = place === 'last' || place === 'single';
  // Espace avec la bulle du dessus : collée dans un groupe, aérée entre deux groupes.
  const spacingTop = position && spaced ? { marginTop: place === 'middle' || place === 'last' ? GROUP_GAP : BETWEEN_GROUPS } : null;

  return (
    <View
      ref={container}
      collapsable={false}
      style={[styles.row, mine ? styles.rowMine : [styles.rowTheirs, position && styles.withAvatar], spacingTop, hidden && styles.hidden]}
      {...swipeHandlers}
    >
      {onReply && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeIcon,
            mine ? styles.swipeIconMine : styles.swipeIconTheirs,
            {
              opacity: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0, 1), extrapolate: 'clamp' }),
              transform: [
                { scale: swipe.interpolate({ inputRange: iconRange, outputRange: iconOutput(0.4, 1), extrapolate: 'clamp' }) },
                { rotate: swipe.interpolate({ inputRange: iconRange, outputRange: mine ? ['0deg', '-60deg'] : ['60deg', '0deg'], extrapolate: 'clamp' }) },
              ],
            },
          ]}
        >
          <Reply size={18} color={colors.text} strokeWidth={1.75} />
        </Animated.View>
      )}
      {!mine && position && <View style={styles.avatarSlot}>{endsGroup && <Avatar uri={avatar} size={AVATAR_SIZE} />}</View>}
      <Animated.View
        style={[
          mine ? styles.rowMine : styles.rowTheirs,
          {
            opacity: pop,
            transform: [
              { translateX: swipe },
              { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
              { scale: Animated.multiply(scale, pop.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] })) },
            ],
          },
        ]}
      >
        <Pressable
          onPress={press}
          onLongPress={select}
          delayLongPress={LONG_PRESS_MS}
          style={bare ? styles.bare : [styles.bubble, groupCorners(place, mine), { backgroundColor: palette.background }, fleeting && styles.fleeting, fleeting && { borderColor: fleeting.border }]}
        >
          {message.forwarded === 1 && (
            <View style={[styles.forwarded, bare && styles.forwardedBare]}>
              <Forward size={13} color={bare ? colors.textMuted : palette.muted} strokeWidth={1.75} />
              <Text style={[styles.forwardedLabel, { color: bare ? colors.textMuted : palette.muted }]}>{t('transfert.mention')}</Text>
            </View>
          )}
          <ReplyQuote message={message} name={name} palette={palette} onJump={onJump} />
          {album ? (
            <AlbumGrid members={album.members} viewingId={viewingId} onOpen={(member, rect) => onOpenFile?.(member, rect)} onLongPress={selectMember} onPrepare={onPrepareFile} />
          ) : emojis > 0 ? (
            <Text style={{ fontSize: EMOJI_SIZES[emojis], lineHeight: EMOJI_SIZES[emojis] * 1.2 }}>{message.text.trim()}</Text>
          ) : message.kind === 'text' ? (
            <>
              <FittedText text={message.text} style={[styles.text, { color: palette.text }]} background={palette.background} fit={fit} />
              {/* Pas dans la sélection d'un message replié : la carte n'y aurait pas sa place. */}
              {linkPreview && !fit && <LinkPreviewCard preview={linkPreview} palette={palette} />}
            </>
          ) : message.kind === 'location' ? (
            <LocationContent message={message} palette={palette} />
          ) : message.kind === 'audio' && message.status !== 'receiving' && !isMediaDeleted(message) ? (
            <VoiceContent message={message} palette={palette} next={nextVoice} />
          ) : (
            <FileContent message={message} palette={palette} mediaHidden={mediaHidden} onOpen={(rect) => onOpenFile?.(message, rect)} onLongPress={select} onPrepare={onPrepareFile && (() => onPrepareFile(message))} onAccept={onAcceptFile && (() => onAcceptFile(message))} onRefuse={onRefuseFile && (() => onRefuseFile(message))} />
          )}
          {/* L'heure et l'état, une seule fois par groupe : sous le dernier message. */}
          {endsGroup ? meta : metaReveal ? <RevealMeta value={metaReveal}>{meta}</RevealMeta> : null}
        </Pressable>
        {badge.shown && (
          <Animated.View style={badge.style}>
            <Pressable onPress={() => onShowReactions?.(message)} disabled={!onShowReactions} hitSlop={6} style={[styles.reactions, bare && styles.reactionsBare]} accessibilityLabel={t('reactions.titre')}>
              {lastReactions.current.map((emoji, index) => (
                <Text key={index} style={styles.reactionEmoji}>{emoji}</Text>
              ))}
            </Pressable>
          </Animated.View>
        )}
        <LikeBurst token={burst} style={mine ? styles.burstMine : styles.burstTheirs} />
      </Animated.View>
    </View>
  );
}

const useLocalStyles = createStyles((colors) => ({
  row: {
    maxWidth: '80%',
  },
  forwarded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  forwardedBare: {
    marginBottom: 4,
  },
  forwardedLabel: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  rowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  swipeIcon: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  swipeIconMine: {
    right: spacing.sm,
  },
  swipeIconTheirs: {
    left: spacing.sm,
  },
  bare: {
    alignItems: 'flex-end',
    gap: 2,
  },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  // Le contour prend sa place sur la marge intérieure : la bulle garde exactement sa taille.
  fleeting: {
    borderWidth: FLEETING_BORDER,
    borderStyle: 'dashed',
    paddingHorizontal: spacing.md - FLEETING_BORDER,
    paddingVertical: 10 - FLEETING_BORDER,
  },
  mine: {
    borderBottomRightRadius: 4,
  },
  theirs: {
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: TEXT_LINE_HEIGHT,
  },
  reactions: {
    flexDirection: 'row',
    gap: 2,
    marginTop: -6,
    marginHorizontal: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Photo ou vidéo sans bulle : l'heure est juste dessous, le badge passe en dessous au lieu de la recouvrir.
  reactionsBare: {
    marginTop: 4,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  systemSpacing: {
    marginTop: BETWEEN_GROUPS,
  },
  withAvatar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  avatarSlot: {
    width: AVATAR_SIZE,
    marginBottom: 2,
  },
  burstMine: {
    top: 4,
    left: -14,
  },
  burstTheirs: {
    top: 4,
    right: -14,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
