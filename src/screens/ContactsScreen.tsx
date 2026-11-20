import { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Reanimated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Bell, ChevronRight, Link2, MessageCircle, QrCode, ScanLine, Share2, UserPlus } from 'lucide-react-native';

import { setScreenBrightness } from '../../modules/pear-native';
import { getContactProfile, getPendingRequests } from '../chat/database';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { Avatar, Header, IconButton, RowPressable, Screen, usePressFeedback } from '../components/ui';
import { buildPairingLink, PairingLink, parsePairingLink } from '../crypto/pairing';
import { t } from '../i18n';
import { DURATION, timing } from '../motion';
import { useBackInterceptor } from '../navigation/backInterceptors';
import { Contact } from '../storage';
import { createStyles, fixed, radius, spacing, useColors } from '../theme';
import { matchesSearch } from './home/listFormat';

type Props = {
  publicKey: string;
  contacts: Contact[];
  onScan: () => void;
  onKeyReceived: (link: PairingLink) => void;
  onRequests: () => void;
  onOpenContact: (contact: Contact) => void;
  onMessage: (contact: Contact) => void;
};

// Retournement de la carte « Ajouter quelqu'un » pour montrer « Mon code ».
const FLIP_MS = 500;
// Le QR code au dos de la carte : assez grand pour se scanner de près (lien court, peu de modules).
const QR_SIZE = 160;
// Les premières lignes entrent l'une après l'autre ; les suivantes sont déjà là.
const CASCADE_ROWS = 10;
const CASCADE_STEP_MS = 35;
const CASCADE_MS = 260;

// La lettre sous laquelle ranger un nom : sans accent, en majuscule, « # » pour ce qui n'est pas une lettre.
function letterOf(name: string) {
  const first = name.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

// L'annuaire : la carte « Ajouter quelqu'un » (scanner, mon code, coller un lien), les demandes reçues,
// puis tous les contacts rangés par lettre. L'accueil, lui, reste la liste des conversations.
export function ContactsScreen({ publicKey, contacts, onScan, onKeyReceived, onRequests, onOpenContact, onMessage }: Props) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const barSpace = useBottomBarSpace();
  const [query, setQuery] = useState('');
  const requests = getPendingRequests().length;
  // Vrai à l'arrivée sur l'écran : seules ces lignes-là entrent en cascade (pas en revenant par le défilement).
  const arriving = useRef(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      arriving.current = false;
    }, CASCADE_ROWS * CASCADE_STEP_MS + CASCADE_MS);
    return () => clearTimeout(timer);
  }, []);

  const pasteLink = async () => {
    const link = parsePairingLink(await Clipboard.getStringAsync());
    if (link) onKeyReceived(link);
    else showDialog(t('app.lienNonReconnu'), t('ajout.copierLien'));
  };

  const sorted = contacts.filter((contact) => matchesSearch(contact.name, query)).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

  const header = (
    <View style={styles.header}>
      <AddCard publicKey={publicKey} onScan={onScan} onPaste={pasteLink} />
      <SearchField value={query} onChange={setQuery} placeholder={t('liste.rechercher')} />
      {requests > 0 && (
        <Pressable onPress={onRequests} style={({ pressed }) => [styles.requests, pressed && styles.pressed]}>
          <Bell size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.requestsLabel}>{t('contacts.demandes', { n: requests })}</Text>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>
      )}
    </View>
  );

  return (
    <Screen>
      <Header title={t('contacts.titre')} action={contacts.length > 0 ? <Text style={styles.count}>{contacts.length}</Text> : undefined} />
      <FlatList
        data={sorted}
        keyExtractor={(contact) => contact.publicKey}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: barSpace }}
        ListEmptyComponent={<EmptyState label={query.trim() ? t('liste.aucunTrouve') : t('contacts.aucun')} />}
        renderItem={({ item, index }) => {
          const letter = letterOf(item.name);
          const online = !item.pending && chat.isContactOnline(item.publicKey);
          return (
            <Cascade index={index} arriving={arriving.current}>
              {(index === 0 || letterOf(sorted[index - 1].name) !== letter) && <Text style={styles.letter}>{letter}</Text>}
              <RowPressable onPress={() => onOpenContact(item)} style={styles.contact}>
                <View>
                  <Avatar uri={getContactProfile(item.publicKey).photo_uri} size={44} />
                  <OnlineDot online={online} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.pending ? <Text style={styles.state}>{t('liste.enAttenteLigne')}</Text> : online ? <Text style={styles.state}>{t('liste.enLigne')}</Text> : null}
                </View>
                {!item.pending && (
                  <IconButton onPress={() => onMessage(item)} label={t('contacts.message')} style={styles.write}>
                    <MessageCircle size={20} color={colors.text} strokeWidth={1.75} />
                  </IconButton>
                )}
              </RowPressable>
            </Cascade>
          );
        }}
      />
    </Screen>
  );
}

// Une ligne de la liste : à l'arrivée sur l'écran, les premières montent en fondu l'une après l'autre.
// Pas d'animation d'entrée de Reanimated sur une ligne de FlatList (rejouée à chaque remontage) : la
// valeur part de 1 dès que l'écran est installé.
function Cascade({ index, arriving, children }: { index: number; arriving: boolean; children: ReactNode }) {
  const [animate] = useState(() => arriving && index < CASCADE_ROWS);
  const shown = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (animate) shown.set(withDelay(index * CASCADE_STEP_MS, timing(1, CASCADE_MS)));
    // Une seule fois, au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: (1 - shown.get()) * 8 }] }));
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

// Le point « en ligne » au coin de l'avatar, qui apparaît et disparaît en fondu.
function OnlineDot({ online }: { online: boolean }) {
  const styles = useStyles();
  const shown = useSharedValue(online ? 1 : 0);
  useEffect(() => {
    shown.set(timing(online ? 1 : 0, DURATION.small));
  }, [online, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ scale: 0.6 + 0.4 * shown.get() }] }));
  return <Reanimated.View pointerEvents="none" accessibilityLabel={online ? t('liste.enLigne') : undefined} style={[styles.dot, style]} />;
}

// Un des trois boutons de la carte.
function CardButton({ label, icon: Icon, primary, onPress }: { label: string; icon: typeof ScanLine; primary?: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const color = primary ? colors.onAccent : colors.text;
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} style={styles.flex}>
      <Reanimated.View style={[styles.cardButton, primary && styles.cardButtonPrimary, feedback.style]}>
        <Icon size={20} color={color} strokeWidth={1.8} />
        <Text style={[styles.cardButtonLabel, { color }, primary && styles.cardButtonLabelPrimary]} numberOfLines={1}>
          {label}
        </Text>
      </Reanimated.View>
    </Pressable>
  );
}

// « Ajouter quelqu'un » : Scanner, Mon code, Lien. « Mon code » retourne la carte (sur le fil natif)
// et montre le QR code au dos, noir sur blanc quel que soit le thème (même donnée que MyQrSheet).
function AddCard({ publicKey, onScan, onPaste }: { publicKey: string; onScan: () => void; onPaste: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [flipped, setFlipped] = useState(false);
  const turn = useSharedValue(0);
  const name = chat.getMyProfile().name;
  const link = buildPairingLink(publicKey, name);

  useEffect(() => {
    turn.set(timing(flipped ? 180 : 0, FLIP_MS));
  }, [flipped, turn]);
  useBackInterceptor(flipped, () => setFlipped(false));

  // Luminosité au maximum tant que le code est montré, pour qu'il se scanne bien.
  useEffect(() => {
    if (!flipped) return;
    setScreenBrightness(1).catch(() => {});
    return () => {
      setScreenBrightness(-1).catch(() => {});
    };
  }, [flipped]);

  // Chaque face cache l'autre à mi-course (90°) : backfaceVisibility seule n'est pas fiable sur Android.
  const front = useAnimatedStyle(() => ({
    opacity: turn.get() < 90 ? 1 : 0,
    transform: [{ perspective: 900 }, { rotateY: `${turn.get()}deg` }],
  }));
  const back = useAnimatedStyle(() => ({
    opacity: turn.get() >= 90 ? 1 : 0,
    transform: [{ perspective: 900 }, { rotateY: `${turn.get() - 180}deg` }],
  }));

  return (
    <View style={styles.cardPlace}>
      <Reanimated.View pointerEvents={flipped ? 'none' : 'auto'} importantForAccessibility={flipped ? 'no-hide-descendants' : 'auto'} style={[styles.face, styles.front, front]}>
        <View style={styles.cardTitleRow}>
          <View style={styles.cardIcon}>
            <UserPlus size={22} color={colors.onSignature} strokeWidth={1.9} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{t('contacts.ajouter')}</Text>
            <Text style={styles.cardText}>{t('contacts.ajouterAide')}</Text>
          </View>
        </View>
        <View style={styles.cardButtons}>
          <CardButton label={t('contacts.scanner')} icon={ScanLine} onPress={onScan} />
          <CardButton label={t('contacts.monCode')} icon={QrCode} primary onPress={() => setFlipped(true)} />
          <CardButton label={t('contacts.lien')} icon={Link2} onPress={onPaste} />
        </View>
      </Reanimated.View>
      <Reanimated.View pointerEvents={flipped ? 'auto' : 'none'} importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'} style={[styles.face, styles.backFace, back]}>
        <View accessibilityRole="image" accessibilityLabel={t('qr.titre')}>
          <QRCode value={link} size={QR_SIZE} ecl="L" color={fixed.black} backgroundColor={fixed.white} />
        </View>
        <View style={styles.backText}>
          {!!name && (
            <Text style={styles.backName} numberOfLines={1}>
              {name}
            </Text>
          )}
          <Text style={styles.backHelp}>{t('contacts.codeAide')}</Text>
          <View style={styles.backButtons}>
            <Pressable onPress={() => setFlipped(false)} accessibilityRole="button" accessibilityLabel={t('commun.retour')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Text style={styles.backButtonLabel}>{t('commun.retour')}</Text>
            </Pressable>
            <Pressable onPress={() => Share.share({ message: link })} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('ajout.partager')} style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}>
              <Share2 size={18} color={fixed.black} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>
      </Reanimated.View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  header: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  count: {
    fontSize: 14,
    color: colors.textMuted,
  },
  cardPlace: {
    marginHorizontal: spacing.lg - 4,
    minHeight: QR_SIZE + 36,
  },
  face: {
    borderRadius: 24,
    padding: 18,
    backfaceVisibility: 'hidden',
  },
  front: {
    flex: 1,
    minHeight: QR_SIZE + 36,
    gap: 14,
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  backFace: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: fixed.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.signature,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardButton: {
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  cardButtonPrimary: {
    backgroundColor: colors.accent,
  },
  cardButtonLabel: {
    fontSize: 12,
  },
  cardButtonLabelPrimary: {
    fontWeight: '600',
  },
  backText: {
    flex: 1,
    gap: 10,
  },
  backName: {
    fontSize: 16,
    fontWeight: '700',
    color: fixed.black,
  },
  backHelp: {
    fontSize: 13,
    lineHeight: 18,
    color: fixed.black,
    opacity: 0.7,
  },
  backButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: fixed.black,
    justifyContent: 'center',
  },
  backButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: fixed.white,
  },
  shareButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
  letter: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.signatureStrong,
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
    paddingBottom: 4,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.lg - spacing.sm,
    paddingVertical: spacing.sm,
  },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.background,
    backgroundColor: colors.signatureStrong,
  },
  name: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  state: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  write: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
}));
