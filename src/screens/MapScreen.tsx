import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { ArrowLeft, Download, Eye, EyeOff, Lock, MessageCircle } from 'lucide-react-native';

import { lastKnownLocation } from '../../modules/pear-native';
import { getContactProfile, getLocationMessages } from '../chat/database';
import { distanceKm, formatDistance, isSharing, parseLocationText, SharedLocation } from '../chat/location';
import { chat } from '../chat/manager';
import { showDialog } from '../components/dialog';
import { Avatar, useInsets, useNavigationBarHeight, usePressFeedback } from '../components/ui';
import { haptics } from '../haptics';
import { t } from '../i18n';
import { log } from '../log';
import { downloadRegion, keepMapOffline, mapStyleFor, MapRegion, REGION_RADIUS_KM, savedRegion } from '../map/offlineMap';
import { enterUp, timing } from '../motion';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors, useIsDark } from '../theme';

// Une position terminée reste sur la carte (grisée) pendant ce temps.
const ENDED_VISIBLE_MS = 24 * 3600 * 1000;
const PIN = 48;
const TICK_MS = 15 * 1000;

type Pin = { contact: Contact; location: SharedLocation; live: boolean };

function ago(ms: number) {
  if (ms < 60_000) return t('position.aLinstant');
  if (ms < 3600_000) return t('position.ilYaMin', { n: Math.floor(ms / 60_000) });
  return t('position.ilYaH', { n: Math.floor(ms / 3600_000) });
}

// La dernière position reçue de chaque contact.
function pinsFor(contacts: Contact[], now: number): Pin[] {
  const seen = new Set<string>();
  const pins: Pin[] = [];
  for (const message of getLocationMessages()) {
    if (message.mine !== 0 || seen.has(message.contact)) continue;
    seen.add(message.contact);
    const contact = contacts.find((item) => item.publicKey === message.contact);
    const location = parseLocationText(message.text);
    if (!contact || !location) continue;
    const live = isSharing(location, now);
    if (!live && now - location.at > ENDED_VISIBLE_MS) continue;
    pins.push({ contact, location, live });
  }
  return pins;
}

// Un contact sur la carte : son avatar dans un rond, cerclé de vert s'il est choisi ; un halo pulse tant
// que le partage est en direct ; il tombe à sa place en arrivant.
function ContactPin({ pin, selected, index }: { pin: Pin; selected: boolean; index: number }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  const chosen = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    chosen.set(timing(selected ? 1 : 0, 220));
  }, [selected, chosen]);
  useEffect(() => {
    cancelAnimation(pulse);
    pulse.set(0);
    if (pin.live && !reduced) pulse.set(withDelay(index * 300, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }), -1, false)));
  }, [pin.live, reduced, index, pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - pulse.get()), transform: [{ scale: 0.6 + 2 * pulse.get() }] }));
  const face = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.15 * chosen.get() }] }));
  return (
    <Reanimated.View entering={enterUp(-14, 420, 120 + index * 90)} style={styles.pin}>
      {pin.live && <Reanimated.View style={[styles.halo, halo]} />}
      <Reanimated.View style={[styles.face, selected ? styles.faceSelected : pin.live ? styles.faceLive : styles.faceEnded, face]}>
        <Avatar uri={getContactProfile(pin.contact.publicKey).photo_uri} size={PIN - 6} />
      </Reanimated.View>
      <View style={styles.tag}>
        <Text style={styles.tagText} numberOfLines={1}>
          {pin.contact.name}
        </Text>
      </View>
    </Reanimated.View>
  );
}

// Mon point, vert (ou gris en mode discret), qui pulse doucement.
function MeDot({ hidden }: { hidden: boolean }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.cubic) }), -1, false));
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: hidden ? 0 : 0.5 * (1 - pulse.get()), transform: [{ scale: 0.6 + 1.8 * pulse.get() }] }));
  return (
    <View style={styles.me} accessibilityLabel={t('carte.toi')}>
      <Reanimated.View style={[styles.meHalo, halo]} />
      <View style={[styles.meDot, hidden && styles.meDotHidden]} />
    </View>
  );
}

function RoundButton({ onPress, label, active, children }: { onPress: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  const styles = useStyles();
  const feedback = usePressFeedback();
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Reanimated.View style={[styles.round, active && styles.roundActive, feedback.style]}>{children}</Reanimated.View>
    </Pressable>
  );
}

type Props = { contacts: Contact[]; focus: string | null; onBack: () => void; onOpenChat: (publicKey: string) => void };

// La carte des contacts qui me partagent leur position (planche « Carte ») : hors ligne, la zone gardée
// sur le téléphone ; la fiche du bas rejoue son entrée quand on choisit un autre contact.
export function MapScreen({ contacts, focus, onBack, onOpenChat }: Props) {
  const colors = useColors();
  const dark = useIsDark();
  const styles = useStyles();
  const { top } = useInsets();
  const bottom = useNavigationBarHeight();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    keepMapOffline();
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const [region, setRegion] = useState<MapRegion | null>(savedRegion);
  const [progress, setProgress] = useState<number | null>(null);
  const [me, setMe] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)
      .then((granted) => granted && setMe(lastKnownLocation()))
      .catch((e) => log.warn('carte', e));
  }, [now]);

  const pins = useMemo(() => pinsFor(contacts, now), [contacts, now]);
  const [selected, setSelected] = useState<string | null>(focus ?? pins[0]?.contact.publicKey ?? null);
  const chosen = pins.find((pin) => pin.contact.publicKey === selected) ?? pins[0] ?? null;
  const sharingWith = contacts.filter((contact) => chat.isSharingLocation(contact.publicKey));
  const camera = useRef<CameraRef>(null);

  const start = chosen?.location ?? me ?? (region ? { longitude: (region.bounds[0] + region.bounds[2]) / 2, latitude: (region.bounds[1] + region.bounds[3]) / 2 } : null);

  const choose = (pin: Pin) => {
    if (pin.contact.publicKey === selected) return;
    haptics.select();
    setSelected(pin.contact.publicKey);
    camera.current?.easeTo({ center: [pin.location.longitude, pin.location.latitude], duration: 420 });
  };

  // Mode discret : tous mes partages en cours s'arrêtent (chacun reçoit « partage terminé »).
  const goDiscreet = () => {
    if (sharingWith.length === 0) {
      showDialog(t('carte.discret'), t('carte.discretRien'));
      return;
    }
    showDialog(t('carte.discret'), t('carte.discretAide', { n: sharingWith.length }), [
      {
        label: t('carte.discretOk'),
        onPress: () => {
          haptics.action();
          for (const contact of sharingWith) chat.stopLocation(contact.publicKey);
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  const download = async () => {
    let center = lastKnownLocation();
    if (!center) {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION).catch(() => null);
      if (granted === PermissionsAndroid.RESULTS.GRANTED) center = lastKnownLocation();
    }
    if (!center) {
      showDialog(t('carte.sansPosition'), t('carte.sansPositionAide'));
      return;
    }
    setProgress(0);
    try {
      setRegion(await downloadRegion(center, setProgress));
      haptics.success();
    } catch (e) {
      log.warn('carte', e);
      showDialog(t('carte.echec'), t('carte.echecAide'));
    } finally {
      setProgress(null);
    }
  };

  const detail = (pin: Pin) => {
    const away = me ? formatDistance(distanceKm(me, pin.location), t('position.virgule')) : null;
    const parts = [pin.live ? t('carte.enDirect') : t('carte.partagee', { quand: ago(now - pin.location.at) }), away ? t('position.aDistance', { distance: away }) : null, pin.live ? ago(now - pin.location.at) : null];
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <View style={styles.screen}>
      {region && start ? (
        <Map style={StyleSheet.absoluteFill} mapStyle={mapStyleFor(dark)} logo={false} compass={false} attribution touchPitch={false}>
          <Camera ref={camera} initialViewState={{ center: [start.longitude, start.latitude], zoom: 13 }} />
          {me && (
            <Marker id="me" lngLat={[me.longitude, me.latitude]}>
              <MeDot hidden={sharingWith.length === 0} />
            </Marker>
          )}
          {pins.map((pin, index) => (
            <Marker key={pin.contact.publicKey} id={pin.contact.publicKey} lngLat={[pin.location.longitude, pin.location.latitude]} onPress={() => choose(pin)}>
              <ContactPin pin={pin} selected={pin.contact.publicKey === chosen?.contact.publicKey} index={index} />
            </Marker>
          ))}
        </Map>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.blank]} />
      )}

      <View style={[styles.header, { top: top + spacing.sm }]}>
        <RoundButton onPress={onBack} label={t('commun.retour')}>
          <ArrowLeft size={20} color={colors.text} strokeWidth={1.9} />
        </RoundButton>
        <View style={styles.titlePill}>
          <Text style={styles.title}>{t('carte.titre')}</Text>
        </View>
        <RoundButton onPress={goDiscreet} label={t('carte.discret')} active={sharingWith.length === 0}>
          {sharingWith.length === 0 ? <EyeOff size={20} color={colors.background} strokeWidth={1.9} /> : <Eye size={20} color={colors.text} strokeWidth={1.9} />}
        </RoundButton>
      </View>

      <View style={[styles.sheet, { bottom: bottom + spacing.md }]}>
        {!region ? (
          <Reanimated.View entering={enterUp(16, 320)} style={styles.download}>
            <Text style={styles.cardTitle}>{t('carte.telechargerTitre')}</Text>
            <Text style={styles.cardText}>{t('carte.telechargerAide', { km: REGION_RADIUS_KM })}</Text>
            {progress === null ? (
              <Pressable onPress={download} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                <Download size={18} color={colors.onSignature} strokeWidth={1.9} />
                <Text style={styles.primaryLabel}>{t('carte.telecharger')}</Text>
              </Pressable>
            ) : (
              <View style={styles.progress} accessibilityLiveRegion="polite" accessibilityLabel={`${Math.round(progress * 100)} %`}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            )}
          </Reanimated.View>
        ) : chosen ? (
          // La clé change à chaque contact : la fiche rejoue son entrée (fondu, 14 points de montée).
          <Reanimated.View key={chosen.contact.publicKey} entering={enterUp(14, 320)} style={styles.card}>
            <Avatar uri={getContactProfile(chosen.contact.publicKey).photo_uri} size={48} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {chosen.contact.name}
              </Text>
              <Text style={styles.cardText} numberOfLines={1}>
                {detail(chosen)}
              </Text>
            </View>
            <Pressable onPress={() => onOpenChat(chosen.contact.publicKey)} accessibilityRole="button" accessibilityLabel={t('contact.ecrire')} style={({ pressed }) => [styles.write, pressed && styles.pressed]}>
              <MessageCircle size={19} color={colors.background} strokeWidth={1.9} />
            </Pressable>
          </Reanimated.View>
        ) : (
          <Text style={styles.cardText}>{t('carte.personne')}</Text>
        )}
        <View style={styles.footer}>
          <Lock size={14} color={colors.signatureStrong} strokeWidth={2} />
          <Text style={styles.footerText}>{sharingWith.length === 0 ? t('carte.footerDiscret') : t('carte.footer', { n: sharingWith.length })}</Text>
        </View>
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  blank: { backgroundColor: colors.surface },
  header: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0px 4px 14px ${colors.shadow}`,
  },
  roundActive: { backgroundColor: colors.text },
  titlePill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    boxShadow: `0px 4px 14px ${colors.shadow}`,
  },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    padding: spacing.md,
    gap: 12,
    borderRadius: 26,
    backgroundColor: colors.elevated,
    boxShadow: `0px 10px 30px ${colors.shadow}`,
  },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  download: { gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  cardText: { fontSize: 13, lineHeight: 18, color: colors.textMuted },
  write: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.signature,
  },
  primaryLabel: { fontSize: 15, fontWeight: '600', color: colors.onSignature },
  progress: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surface },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.signatureStrong },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerText: { flex: 1, fontSize: 12, color: colors.textMuted },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  // Épingles
  pin: { width: PIN, height: PIN + 22, alignItems: 'center' },
  halo: { position: 'absolute', top: 0, width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: colors.signatureStrong },
  face: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    overflow: 'hidden',
  },
  faceLive: { borderColor: colors.background },
  faceEnded: { borderColor: colors.textMuted, opacity: 0.7 },
  faceSelected: { borderColor: colors.signatureStrong },
  tag: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9,
    backgroundColor: colors.elevated,
  },
  tagText: { fontSize: 11, fontWeight: '600', color: colors.text },
  me: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  meHalo: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: colors.signatureStrong },
  meDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.background, backgroundColor: colors.signatureStrong },
  meDotHidden: { backgroundColor: colors.textMuted },
}));
