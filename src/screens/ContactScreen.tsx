import { ComponentType, useEffect, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ban, Bell, Check, ChevronRight, MapPin, MessageCircle, Palette, Search, ShieldCheck, Timer, Trash2, Volume2, VolumeX } from 'lucide-react-native';

import { ContactProfile, deleteMessages, getMediaMessages, getMutedKinds, MessageKind, setMutedKinds } from '../chat/database';
import { haptics } from '../haptics';
import type { ChatIntent } from './chat/ChatScreen';
import { chat } from '../chat/manager';
import { showDialog } from '../components/dialog';
import { AvatarViewer } from '../components/AvatarViewer';
import { Avatar, Button, Header, Screen, usePressFeedback } from '../components/ui';
import { enterUp, popIn, popOut, timing } from '../motion';
import { ContactMedia } from './contact/ContactMedia';
import { ROUTE } from './chat/constants';
import { ephemeralLabel } from './chat/format';
import { createStyles, radius, spacing, useColors } from '../theme';
import { t, TextKey } from '../i18n';

type Props = {
  initialName: string;
  // Le nom et la photo choisis par le contact lui-même.
  profile: ContactProfile;
  isNew: boolean;
  onBack: () => void;
  onSave: (name: string) => void;
  onRemove: () => void;
  blocked: boolean;
  onToggleBlock: () => void;
  contactKey: string;
  // Le code de vérification n'est plus affiché ici (demande de Louca, refonte du 13 nov.) : props gardées
  // pour ne pas toucher à App.tsx.
  code: string[];
  verified: boolean;
  onVerify: () => void;
  initialTab?: Tab;
  // Ouvre la conversation pour une action (recherche, position, éphémères), ou simplement pour écrire.
  onOpen: (intent?: ChatIntent) => void;
  onCustomize: () => void;
  onNotifications: () => void;
};

type Tab = 'profile' | 'media';

const AVATAR = 104;
const TAB_MS = 240;

// Notifications de la conversation, dans l'ordre de l'écran des notifications.
const NOTIF_KINDS: { kind: MessageKind; label: TextKey }[] = [
  { kind: 'text', label: 'notifs.messages' },
  { kind: 'image', label: 'notifs.photos' },
  { kind: 'video', label: 'notifs.videos' },
  { kind: 'audio', label: 'notifs.vocaux' },
  { kind: 'file', label: 'notifs.fichiers' },
];

function notificationsLabel(contactKey: string) {
  const muted = getMutedKinds(contactKey);
  const muteds = NOTIF_KINDS.filter(({ kind }) => muted.includes(kind));
  if (muteds.length === 0) return t('contact.notifToutes');
  if (muteds.length === NOTIF_KINDS.length) return t('contact.notifAucune');
  return t('contact.notifSauf', { liste: muteds.map(({ label }) => t(label).toLocaleLowerCase()).join(', ') });
}

// Une carte d'action sous l'avatar (Écrire…), avec l'effet d'appui commun.
function ActionCard({ icon: Icon, label, on, onPress }: { icon: ComponentType<{ size: number; color: string; strokeWidth: number }>; label: string; on?: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ checked: on }}>
      <Reanimated.View style={[styles.action, on && styles.actionOn, feedback.style]}>
        <Icon size={20} color={on ? colors.onSignature : colors.text} strokeWidth={1.8} />
        <Text style={[styles.actionLabel, on && { color: colors.onSignature }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {label}
        </Text>
      </Reanimated.View>
    </Pressable>
  );
}

// Les deux onglets, soulignés en couleur signature : le trait glisse d'un onglet à l'autre.
function Tabs({ tab, mediaCount, onChange }: { tab: Tab; mediaCount: number; onChange: (tab: Tab) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(tab === 'media' ? 1 : 0);
  useEffect(() => {
    progress.set(timing(tab === 'media' ? 1 : 0, TAB_MS));
  }, [tab, progress]);
  const text = colors.text;
  const muted = colors.textMuted;
  const underline = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() * width) / 2 }] }));
  const profileLabel = useAnimatedStyle(() => ({ color: interpolateColor(progress.get(), [0, 1], [text, muted]) }));
  const mediaLabel = useAnimatedStyle(() => ({ color: interpolateColor(progress.get(), [0, 1], [muted, text]) }));

  return (
    <View style={styles.tabs} accessibilityRole="tablist" onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
      <Pressable style={styles.tab} onPress={() => onChange('profile')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'profile' }}>
        <Reanimated.Text style={[styles.tabLabel, profileLabel]}>{t('contact.ongletProfil')}</Reanimated.Text>
      </Pressable>
      <Pressable style={styles.tab} onPress={() => onChange('media')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'media' }}>
        <Reanimated.Text style={[styles.tabLabel, mediaLabel]}>{t('contact.ongletMediasNombre', { n: mediaCount })}</Reanimated.Text>
      </Pressable>
      {width > 0 && <Reanimated.View style={[styles.underline, { width: width / 2 }, underline]} />}
    </View>
  );
}

export function ContactScreen({ initialName, profile, isNew, initialTab = 'profile', onBack, onSave, onRemove, blocked, onToggleBlock, contactKey, verified, onOpen, onCustomize, onNotifications }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [name, setName] = useState(initialName);
  const [tab, setTab] = useState<Tab>(initialTab);
  // Couper le son = toutes les notifications de ce contact coupées d'un coup.
  const [muted, setMuted] = useState(() => !isNew && getMutedKinds(contactKey).length === NOTIF_KINDS.length);
  const toggleMute = () => {
    haptics.action();
    const next = !muted;
    setMutedKinds(contactKey, next ? NOTIF_KINDS.map(({ kind }) => kind) : []);
    setMuted(next);
  };
  const [messages] = useState(() => (isNew ? [] : getMediaMessages(contactKey)));
  // Présence du contact : l'écran suit les changements de connexion.
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  // Le grand avatar apparaît en s'agrandissant doucement (0,9 → 1).
  const appear = useSharedValue(0);
  useEffect(() => {
    appear.set(timing(1, 280));
  }, [appear]);
  const avatarStyle = useAnimatedStyle(() => ({ opacity: appear.get(), transform: [{ scale: 0.9 + 0.1 * appear.get() }] }));

  const online = chat.isContactOnline(contactKey);
  const { route, status } = chat.getLink(contactKey);
  const presence = !chat.isOnline()
    ? t('chat.vousHorsLigne')
    : online
      ? route ? t('contact.enLigneVia', { route: ROUTE[route] }) : t('chat.connecte')
      : status === 'connecting'
        ? t('contact.connexion')
        : t('chat.contactHorsLigne');

  const ephemeral = isNew ? null : chat.getEphemeral(contactKey);
  const renamed = name.trim() !== initialName && name.trim().length > 0;

  const confirmBlock = () => {
    showDialog(t('statut.bloquerQuestion'), t('statut.bloquerAide'), [
      { label: t('demandes.bloquer'), style: 'danger', onPress: onToggleBlock },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  const confirmClear = () => {
    showDialog(t('liste.supprimerQuestion'), t('liste.supprimerAide', { nom: initialName }), [
      {
        label: t('commun.supprimer'),
        style: 'danger',
        onPress: () => {
          deleteMessages(contactKey);
          chat.refresh();
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  const confirmRemove = () => {
    showDialog(t('contact.supprimerQuestion'), t('contact.supprimerAide'), [
      { label: t('commun.supprimer'), style: 'danger', onPress: onRemove },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  const nameField = (
    <View style={styles.nameBox}>
      <Text style={styles.label}>{t('contact.nom')}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={t('contact.nomContact')}
        placeholderTextColor={colors.textMuted}
        maxLength={40}
      />
    </View>
  );

  if (isNew) {
    return (
      <Screen>
        <Header title={t('contact.nouveau')} onBack={onBack} />
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {nameField}
            <Button label={t('commun.enregistrer')} icon={Check} onPress={() => onSave(name.trim() || t('app.contact'))} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  const rows = [
    { icon: ShieldCheck, color: colors.signatureStrong, label: t('contact.chiffrement'), sub: verified ? t('contact.verifie') : t('contact.chiffrementAide') },
    { icon: Timer, color: colors.text, label: t('contact.ephemeres'), sub: ephemeral ? ephemeralLabel(ephemeral) : t('contact.ephemeresCoupes'), onPress: () => onOpen('ephemeral') },
    { icon: Bell, color: colors.text, label: t('contact.notifications'), sub: notificationsLabel(contactKey), onPress: onNotifications },
    { icon: Trash2, color: colors.text, label: t('contact.vider'), sub: t('contact.viderAide'), onPress: confirmClear },
  ];

  return (
    <Screen>
      <Header title="" onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.identity}>
            <Reanimated.View style={avatarStyle}>
              <AvatarViewer photoUri={profile.photo_uri} label={t('contact.photoGrand')} name={initialName}>
                <Avatar uri={profile.photo_uri} size={AVATAR} />
              </AvatarViewer>
              {online && <Reanimated.View entering={popIn()} exiting={popOut()} style={styles.onlineDot} />}
            </Reanimated.View>
            <Text style={styles.name} numberOfLines={1}>{initialName}</Text>
            {profile.name && profile.name !== initialName && <Text style={styles.chosenName} numberOfLines={1}>{profile.name}</Text>}
            <Reanimated.Text key={presence} entering={enterUp(0)} style={[styles.presence, online && styles.presenceOnline]} numberOfLines={1}>
              {presence}
            </Reanimated.Text>
          </View>

          {/* Six actions, en deux rangées de trois ; elles arrivent l'une après l'autre. */}
          <View style={styles.actions}>
            {[
              { icon: MessageCircle, label: t('contact.ecrire'), onPress: () => onOpen() },
              { icon: Search, label: t('contact.rechercher'), onPress: () => onOpen('search') },
              { icon: Palette, label: t('contact.actionPersonnaliser'), onPress: onCustomize },
              { icon: MapPin, label: t('contact.maPosition'), onPress: () => onOpen('location') },
              { icon: muted ? VolumeX : Volume2, label: muted ? t('contact.silencieux') : t('contact.couperSon'), on: muted, onPress: toggleMute },
              { icon: Timer, label: t('contact.actionEphemeres'), on: !!ephemeral, onPress: () => onOpen('ephemeral') },
            ].map((action, index) => (
              <Reanimated.View key={index} entering={enterUp(10, 280, 60 + index * 35)} style={styles.actionSlot}>
                <ActionCard icon={action.icon} label={action.label} on={action.on} onPress={action.onPress} />
              </Reanimated.View>
            ))}
          </View>

          <Tabs tab={tab} mediaCount={messages.length} onChange={setTab} />

          <Reanimated.View key={tab} entering={enterUp(10, TAB_MS)} style={styles.tabContent}>
            {tab === 'media' ? (
              <ContactMedia messages={messages} />
            ) : (
              <>
                <View style={styles.card}>
                  {rows.map(({ icon: Icon, color, label, sub, onPress }, index) => (
                    <Pressable key={label} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.rowPressed]}>
                      <Icon size={20} color={color} strokeWidth={1.8} />
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>{label}</Text>
                        <Text style={styles.rowSub}>{sub}</Text>
                      </View>
                      {onPress && <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />}
                    </Pressable>
                  ))}
                </View>

                <View style={styles.card}>
                  {nameField}
                  {renamed && (
                    <Reanimated.View entering={enterUp(6)} exiting={popOut()} style={styles.save}>
                      <Button label={t('commun.enregistrer')} icon={Check} onPress={() => onSave(name.trim())} />
                    </Reanimated.View>
                  )}
                </View>

                <BlockButton blocked={blocked} onPress={blocked ? onToggleBlock : confirmBlock} />

                <Pressable onPress={confirmRemove} style={styles.remove} hitSlop={8} accessibilityRole="button">
                  <Trash2 size={18} color={colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.removeLabel}>{t('contact.supprimer')}</Text>
                </Pressable>
              </>
            )}
          </Reanimated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// Bloquer en rouge (danger) ; débloquer, une fois bloqué, en couleur normale.
function BlockButton({ blocked, onPress }: { blocked: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const color = blocked ? colors.text : colors.danger;
  const label = blocked ? t('statut.debloquerContact') : t('statut.bloquerContact');
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label}>
      <Reanimated.View style={[styles.block, feedback.style]}>
        <Ban size={18} color={color} strokeWidth={1.8} />
        <Text style={[styles.blockLabel, { color }]}>{label}</Text>
      </Reanimated.View>
    </Pressable>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  identity: {
    alignItems: 'center',
    gap: 6,
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 4,
    borderColor: colors.background,
    backgroundColor: colors.signatureStrong,
  },
  name: {
    marginTop: spacing.sm,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
  },
  chosenName: {
    fontSize: 14,
    color: colors.textMuted,
  },
  presence: {
    fontSize: 13,
    color: colors.textMuted,
  },
  presenceOnline: {
    color: colors.signatureStrong,
  },
  // Deux rangées de trois.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 18,
  },
  actionSlot: {
    flexBasis: '30%',
    flexGrow: 1,
  },
  actionOn: {
    backgroundColor: colors.signature,
  },
  action: {
    height: 64,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionLabel: {
    fontSize: 11,
    color: colors.text,
  },
  tabs: {
    flexDirection: 'row',
    marginTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  underline: {
    position: 'absolute',
    left: 0,
    bottom: -1,
    height: 2,
    backgroundColor: colors.signatureStrong,
  },
  tabContent: {
    paddingTop: spacing.md,
    gap: 10,
  },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.elevatedActive,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  nameBox: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  input: {
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  save: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  block: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  blockLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  removeLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
}));
