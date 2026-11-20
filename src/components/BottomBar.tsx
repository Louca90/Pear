import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { haptics } from '../haptics';
import { Camera, LucideIcon, Map as MapIcon, MessageCircle, User } from 'lucide-react-native';
import { wakeCamera } from '../screens/cameraStandby';

import { chat } from '../chat/manager';
import { useMediaUri } from '../chat/media';
import { createStyles, radius, spacing, useColors } from '../theme';
import { useNavigationBarHeight } from './ui';
import { CameraFilled, MapFilled, MessagesFilled, ProfileRing } from './TabIcons';
import { t } from '../i18n';
import { DURATION, timing } from '../motion';
import { usePermissionsMissing } from '../onboarding/permissionStatus';

export type Tab = 'home' | 'camera' | 'map' | 'profile';

type FilledIcon = typeof MessagesFilled;

// Au repos, le contour ; choisi, l'icône pleine dont les éléments s'animent.
const TABS: { tab: Tab; icon: LucideIcon; filled: FilledIcon | null; label: string }[] = [
  { tab: 'home', icon: MessageCircle, filled: MessagesFilled, label: t('onglets.messages') },
  { tab: 'camera', icon: Camera, filled: CameraFilled, label: t('onglets.appareilPhoto') },
  { tab: 'map', icon: MapIcon, filled: MapFilled, label: t('carte.titre') },
  { tab: 'profile', icon: User, filled: null, label: t('profil.titre') },
];

// La planche Accueil : des emplacements de 64 × 52 séparés de 4 points ; sous l'onglet choisi, une pastille
// aux bouts ronds de la taille de l'emplacement (pas un rond) qui glisse de l'un à l'autre.
const SLOT_WIDTH = 64;
const SLOT_HEIGHT = 52;
const SLOT_GAP = 4;
const BAR_PADDING = 6;
const ICON_SIZE = 24;
const KICK_MS = 650;
const SLIDE_MS = 300;
const SLIDE_STEP = SLOT_WIDTH + SLOT_GAP;
const PHOTO_SIZE = 30;

// La place que les écrans laissent libre sous leur contenu, pour que la barre flottante ne le cache pas.
export function useBottomBarSpace() {
  return SLOT_HEIGHT + BAR_PADDING * 2 + spacing.md * 2 + useNavigationBarHeight();
}

// L'onglet Profil montre ma photo (ou une silhouette), cerclée quand l'onglet est choisi.
function ProfileIcon({ draw }: { draw: SharedValue<number> }) {
  const permissionsMissing = usePermissionsMissing();
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  // Ma photo est chiffrée sur le disque (lot 2.3) : affichée depuis sa copie déchiffrée.
  const photo = useMediaUri(chat.getMyProfile().photo, { scope: 'app' });
  const initial = (chat.getMyProfile().name ?? '').trim().charAt(0).toUpperCase();
  return (
    <View style={styles.photoSlot}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} />
      ) : (
        <View style={styles.initial}>
          {initial ? <Text style={styles.initialText}>{initial}</Text> : <User size={ICON_SIZE - 6} color={colors.text} strokeWidth={1.75} />}
        </View>
      )}
      <ProfileRing size={PHOTO_SIZE + 6} draw={draw} />
      {permissionsMissing && <View style={styles.permissionDot} />}
    </View>
  );
}

function TabButton({ tab, icon: Icon, filled: Filled, label, active, onPress }: { tab: Tab; icon: LucideIcon; filled: FilledIcon | null; label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  // Tout sur le fil natif : le fondu contour → plein, le cercle du profil et l'animation interne.
  const fill = useSharedValue(active ? 1 : 0);
  const kick = useSharedValue(0);
  const draw = useSharedValue(active ? 1 : 0);
  const mounted = useRef(false);

  const playKick = () => {
    kick.set(0);
    kick.set(withTiming(1, { duration: KICK_MS, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }));
  };

  useEffect(() => {
    fill.set(timing(active ? 1 : 0, DURATION.small));
    draw.set(timing(active ? 1 : 0, active ? DURATION.mascot : DURATION.small));
    if (mounted.current && active) playKick();
    mounted.current = true;
  }, [active]);

  const outline = useAnimatedStyle(() => ({ opacity: 1 - fill.get() }));
  const solid = useAnimatedStyle(() => ({ opacity: fill.get() }));

  const press = () => {
    haptics.select();
    if (active) playKick();
    else onPress();
  };

  return (
    // Le doigt se pose sur l'appareil photo : la caméra commence à s'ouvrir avant même qu'il se lève.
    <Pressable onPress={press} onPressIn={tab === 'camera' && !active ? wakeCamera : undefined} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} style={styles.slot}>
      <View style={styles.icon}>
        {!Filled ? (
          <ProfileIcon draw={draw} />
        ) : (
          <>
            <Reanimated.View style={[StyleSheet.absoluteFill, outline]}>
              <Icon size={ICON_SIZE} color={colors.onDarkTrack} strokeWidth={1.75} />
            </Reanimated.View>
            <Reanimated.View style={[StyleSheet.absoluteFill, styles.filled, solid]}>
              <Filled size={ICON_SIZE} kick={kick} />
            </Reanimated.View>
          </>
        )}
      </View>
    </Pressable>
  );
}
// Une pilule flottante : un cercle pâle glisse sous l'onglet choisi, et elle reste au-dessus de la barre d'Android.
export function BottomBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const activeIndex = TABS.findIndex(({ tab }) => tab === active);
  const position = useSharedValue(activeIndex);

  useEffect(() => {
    position.set(timing(activeIndex, SLIDE_MS));
  }, [activeIndex, position]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() * SLIDE_STEP }] }));

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom: bottom + spacing.md }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        <Reanimated.View style={[styles.indicator, slide]} />
        {TABS.map(({ tab, icon, filled, label }) => (
          <TabButton key={tab} tab={tab} icon={icon} filled={filled} label={label} active={tab === active} onPress={() => onChange(tab)} />
        ))}
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    gap: SLOT_GAP,
    padding: BAR_PADDING,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    boxShadow: `0px 8px 28px ${colors.shadow}`,
  },
  // Centrée sur la zone de l'icône (plus petite que la photo) : la photo tombe pile au milieu du rond.
  photoSlot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionDot: {
    position: 'absolute',
    top: 4,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },
  initialText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
  },
  indicator: {
    position: 'absolute',
    top: BAR_PADDING,
    left: BAR_PADDING,
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
    borderRadius: SLOT_HEIGHT / 2,
    backgroundColor: colors.elevatedActive,
  },
  slot: {
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  filled: {
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
