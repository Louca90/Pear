import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Image, PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import Reanimated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { Download, Eye, EyeOff, Lock, MessageCircle } from 'lucide-react-native';

import { freshLocation, lastKnownLocation } from '../../modules/pear-native';
import { getContactProfile, getLocationMessages } from '../chat/database';
import { distanceKm, formatDistance, isSharing, parseLocationText, SharedLocation } from '../chat/location';
import { chat } from '../chat/manager';
import { useMediaUri } from '../chat/media';
import { showDialog } from '../components/dialog';
import { useBottomBarSpace } from '../components/BottomBar';
import { useInsets, useNavigationBarHeight, usePressFeedback } from '../components/ui';
import { haptics } from '../haptics';
import { t } from '../i18n';
import { log } from '../log';
import { downloadRegion, keepMapOffline, MapRegion, REGION_RADIUS_KM, savedRegion } from '../map/offlineMap';
import { MapColors, mapColorsOf, mapStyleOf } from '../map/pearStyle';
import { EASE, enterUp, timing } from '../motion';
import { Contact } from '../storage';
import { createStyles, Palette, radius, spacing, useIsDark } from '../theme';

// La carte suit le thème. Sombre : l'allure de la planche « Carte » (verte, calme). Clair : la même
// carte en clair, pastilles et fiche blanches.
type MapInk = { ink: string; muted: string; signature: string; chrome: string; sheet: string; face: string; ended: string; line: string; map: MapColors };
const DARK_INK: MapInk = {
  ink: '#F2F2F0',
  muted: '#8E8E93',
  signature: '#B4CC68',
  chrome: 'rgba(11, 11, 12, 0.85)',
  sheet: 'rgba(20, 20, 22, 0.96)',
  face: '#2A2A2E',
  ended: '#5A5A60',
  line: '#222226',
  map: mapColorsOf(true),
};
const LIGHT_INK: MapInk = {
  ink: '#16181A',
  muted: '#6E6E73',
  signature: '#7E9A3A',
  chrome: 'rgba(255, 255, 255, 0.92)',
  sheet: 'rgba(255, 255, 255, 0.97)',
  face: '#E4E6DF',
  ended: '#A6A8A0',
  line: '#E6E7E2',
  map: mapColorsOf(false),
};
const darkPalette = (colors: Palette) => colors.scheme === 'dark';
function useInk() {
  return useIsDark() ? DARK_INK : LIGHT_INK;
}

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

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

// Le visage d'un contact : sa photo si on l'a, sinon son initiale, sur le gris de la planche.
function Face({ publicKey, name, size }: { publicKey: string; name: string; size: number }) {
  const ink = useInk();
  const photo = useMediaUri(getContactProfile(publicKey).photo_uri, { scope: 'app' });
  if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return <Text style={{ fontSize: size * 0.38, fontWeight: '700', color: ink.ink }}>{initialOf(name)}</Text>;
}

// Un contact sur la carte (planche) : il tombe à sa place, son halo vert pulse tant que le partage est
// en direct et il dérive à peine ; choisi, son contour passe au vert et il grossit un peu.
function ContactPin({ pin, selected, index }: { pin: Pin; selected: boolean; index: number }) {
  const styles = useStyles();
  const ink = useInk();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  const drift = useSharedValue(0);
  const chosen = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    chosen.set(timing(selected ? 1 : 0, 220));
  }, [selected, chosen]);
  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(drift);
    pulse.set(0);
    drift.set(0);
    if (!pin.live || reduced) return;
    pulse.set(withDelay(index * 300, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }), -1, false)));
    drift.set(withDelay(1000, withRepeat(withTiming(1, { duration: 2500 + index * 500, easing: Easing.inOut(Easing.sin) }), -1, true)));
  }, [pin.live, reduced, index, pulse, drift]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - pulse.get()), transform: [{ scale: 0.6 + 2 * pulse.get() }] }));
  const body = useAnimatedStyle(() => ({ transform: [{ translateX: 6 * drift.get() }, { translateY: -4 * drift.get() }] }));
  const face = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.15 * chosen.get() }] }));
  return (
    <Reanimated.View entering={enterUp(-14, 420, 120 + index * 90)} style={styles.pin}>
      <Reanimated.View style={[styles.pinBody, body]}>
        {pin.live && <Reanimated.View style={[styles.halo, halo]} />}
        <Reanimated.View style={[styles.face, { borderColor: selected ? ink.signature : pin.live ? ink.ink : ink.ended }, !pin.live && styles.faceEnded, face]}>
          <Face publicKey={pin.contact.publicKey} name={pin.contact.name} size={PIN - 6} />
        </Reanimated.View>
        <View style={styles.tag}>
          <Text style={styles.tagText} numberOfLines={1}>
            {pin.contact.name}
          </Text>
        </View>
      </Reanimated.View>
    </Reanimated.View>
  );
}

// Mon point : vert avec un halo qui pulse ; gris en mode discret.
function MeDot({ hidden }: { hidden: boolean }) {
  const styles = useStyles();
  const ink = useInk();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.cubic) }), -1, false));
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: hidden ? 0 : 0.55 * (1 - pulse.get()), transform: [{ scale: 0.6 + 2 * pulse.get() }] }));
  return (
    <View style={styles.me} accessibilityLabel={t('carte.toi')}>
      <Reanimated.View style={[styles.meHalo, halo]} />
      <View style={[styles.meDot, { backgroundColor: hidden ? ink.ended : ink.signature }]} />
    </View>
  );
}

function RoundButton({ onPress, label, active, children }: { onPress: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  const styles = useStyles();
  const feedback = usePressFeedback();
  const lit = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    lit.set(timing(active ? 1 : 0, 220));
  }, [active, lit]);
  const light = useAnimatedStyle(() => ({ opacity: lit.get() }));
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Reanimated.View style={[styles.round, feedback.style]}>
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.roundLit, light]} />
        {children}
      </Reanimated.View>
    </Pressable>
  );
}

// L'avatar de la fiche se pose en tournant à peine (0,6 et -12° vers sa place), à chaque contact choisi.
const avatarIn: EntryExitAnimationFunction = () => {
  'worklet';
  const config = { duration: 360, easing: EASE, reduceMotion: ReduceMotion.System };
  return {
    initialValues: { transform: [{ scale: 0.6 }, { rotate: '-12deg' }] },
    animations: { transform: [{ scale: withTiming(1, config) }, { rotate: withTiming('0deg', config) }] },
  };
};

// La fiche du bas rejoue son entrée : fondu, 14 points de montée, échelle 0,97 → 1.
const cardIn: EntryExitAnimationFunction = () => {
  'worklet';
  const config = { duration: 320, easing: EASE, reduceMotion: ReduceMotion.System };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 14 }, { scale: 0.97 }] },
    animations: { opacity: withTiming(1, config), transform: [{ translateY: withTiming(0, config) }, { scale: withTiming(1, config) }] },
  };
};

type Props = { contacts: Contact[]; focus: string | null; onBack: () => void; onOpenChat: (publicKey: string) => void };
// La carte est un onglet : plus de flèche retour, et la fiche se pose au-dessus de la barre du bas.

// La carte des contacts qui me partagent leur position (planche « Carte ») : hors ligne, la zone gardée
// sur le téléphone ; la fiche du bas rejoue son entrée quand on choisit un autre contact.
export function MapScreen({ contacts, focus, onBack, onOpenChat }: Props) {
  const styles = useStyles();
  const ink = useInk();
  const dark = useIsDark();
  const { top } = useInsets();
  const bottom = useNavigationBarHeight() + useBottomBarSpace();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    keepMapOffline();
    const timer = setInterval(() => AppState.currentState === 'active' && setNow(Date.now()), TICK_MS);
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
  const hidden = sharingWith.length === 0;
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
    if (hidden) {
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

  // La zone se centre sur ma position, sans rien partager : la dernière connue, sinon une position
  // fraîche demandée au téléphone (sur un téléphone où rien ne l'a encore demandée, Android n'en a aucune).
  const download = async () => {
    if (progress !== null) return;
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION).catch(() => null);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      showDialog(t('carte.sansPosition'), t('carte.sansPositionAide'));
      return;
    }
    // Le bouton montre déjà le téléchargement pendant qu'on cherche la position.
    setProgress(0);
    const center = await freshLocation();
    if (!center) {
      setProgress(null);
      showDialog(t('carte.sansPosition'), t('carte.sansPositionAide'));
      return;
    }
    setMe(center);
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
    const parts = pin.live
      ? [t('carte.enDirect'), away ? t('position.aDistance', { distance: away }) : null, ago(now - pin.location.at)]
      : [t('carte.partagee', { quand: ago(now - pin.location.at) }), away ? t('position.aDistance', { distance: away }) : null];
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <View style={styles.screen}>
      {region && start ? (
        <Map style={StyleSheet.absoluteFill} mapStyle={mapStyleOf(dark)} logo={false} compass={false} attribution touchPitch={false} touchRotate={false}>
          <Camera ref={camera} initialViewState={{ center: [start.longitude, start.latitude], zoom: 13.5 }} />
          {me && (
            <Marker id="me" lngLat={[me.longitude, me.latitude]}>
              <MeDot hidden={hidden} />
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

      <Reanimated.View entering={enterUp(-10, 300)} style={[styles.header, { top: top + spacing.sm }]}>
        <View style={styles.titlePill}>
          <Text style={styles.title}>{t('carte.titre')}</Text>
        </View>
        <RoundButton onPress={goDiscreet} label={hidden ? t('carte.discret') : t('carte.discret')} active={hidden}>
          {hidden ? <EyeOff size={20} color={ink.map.background} strokeWidth={1.9} /> : <Eye size={20} color={ink.ink} strokeWidth={1.9} />}
        </RoundButton>
      </Reanimated.View>

      <Reanimated.View entering={cardIn} style={[styles.sheet, { bottom: bottom + 26 }]}>
        {!region ? (
          <View style={styles.download}>
            <Text style={styles.cardTitle}>{t('carte.telechargerTitre')}</Text>
            <Text style={styles.cardText}>{t('carte.telechargerAide', { km: REGION_RADIUS_KM })}</Text>
            {progress === null ? (
              <Pressable onPress={download} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                <Download size={18} color={ink.map.background} strokeWidth={1.9} />
                <Text style={styles.primaryLabel}>{t('carte.telecharger')}</Text>
              </Pressable>
            ) : (
              <View style={styles.progress} accessibilityLiveRegion="polite" accessibilityLabel={`${Math.round(progress * 100)} %`}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            )}
          </View>
        ) : chosen ? (
          <Reanimated.View key={chosen.contact.publicKey} entering={cardIn} style={styles.card}>
            <Reanimated.View entering={avatarIn} style={styles.cardAvatar}>
              <Face publicKey={chosen.contact.publicKey} name={chosen.contact.name} size={48} />
            </Reanimated.View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {chosen.contact.name}
              </Text>
              <Text style={styles.cardText} numberOfLines={1}>
                {detail(chosen)}
              </Text>
            </View>
            <Pressable onPress={() => onOpenChat(chosen.contact.publicKey)} accessibilityRole="button" accessibilityLabel={t('contact.ecrire')} style={({ pressed }) => [styles.write, pressed && styles.pressed]}>
              <MessageCircle size={19} color={ink.map.background} strokeWidth={1.9} />
            </Pressable>
          </Reanimated.View>
        ) : (
          <Text style={styles.cardText}>{t('carte.personne')}</Text>
        )}
        <View style={styles.footer}>
          <Lock size={14} color={ink.signature} strokeWidth={2} />
          <Text style={styles.footerText}>{hidden ? t('carte.footerDiscret') : t('carte.footer', { n: sharingWith.length })}</Text>
        </View>
      </Reanimated.View>
    </View>
  );
}

const useStyles = createStyles((colors) => {
  const p = darkPalette(colors) ? DARK_INK : LIGHT_INK;
  return {
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: p.map.background },
  blank: { backgroundColor: p.map.background },
  header: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 44, height: 44, borderRadius: radius.full, overflow: 'hidden', backgroundColor: p.chrome, alignItems: 'center', justifyContent: 'center' },
  roundLit: { backgroundColor: p.ink },
  titlePill: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: p.chrome },
  title: { fontSize: 15, fontWeight: '600', color: p.ink },
  sheet: { position: 'absolute', left: 10, right: 10, padding: spacing.md, gap: 12, borderRadius: 26, backgroundColor: p.sheet },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardAvatar: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: p.face, alignItems: 'center', justifyContent: 'center' },
  download: { gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: p.ink },
  cardText: { fontSize: 13, lineHeight: 18, marginTop: 2, color: p.muted },
  write: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: p.ink, alignItems: 'center', justifyContent: 'center' },
  primary: { height: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.ink },
  primaryLabel: { fontSize: 15, fontWeight: '600', color: p.map.background },
  progress: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: p.line },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: p.signature },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: p.line },
  footerText: { flex: 1, fontSize: 12, color: p.muted },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  pin: { width: PIN + 40, height: PIN + 24, alignItems: 'center' },
  pinBody: { alignItems: 'center' },
  halo: { position: 'absolute', top: 0, width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: p.signature },
  face: { width: PIN, height: PIN, borderRadius: PIN / 2, borderWidth: 3, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: p.face },
  faceEnded: { opacity: 0.7 },
  tag: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9, backgroundColor: p.chrome },
  tagText: { fontSize: 11, fontWeight: '600', color: p.ink },
  me: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  meHalo: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: p.signature },
  meDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: p.map.background },
  };
});
