import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import { haptics } from '../haptics';
import { Camera, LucideIcon, MessageCircle, User, Users } from 'lucide-react-native';

import { chat } from '../chat/manager';
import { useMediaUri } from '../chat/media';
import { createStyles, radius, spacing, useColors } from '../theme';
import { useNavigationBarHeight } from './ui';
import { CameraFilled, ContactsFilled, MessagesFilled, ProfileRing } from './TabIcons';
import { t } from '../i18n';

export type Tab = 'home' | 'camera' | 'contacts' | 'profile';

type FilledIcon = typeof MessagesFilled;

// Au repos, le contour ; choisi, l'icône pleine dont les éléments s'animent.
const TABS: { tab: Tab; icon: LucideIcon; filled: FilledIcon | null; label: string }[] = [
  { tab: 'home', icon: MessageCircle, filled: MessagesFilled, label: t('onglets.messages') },
  { tab: 'camera', icon: Camera, filled: CameraFilled, label: t('onglets.appareilPhoto') },
  { tab: 'contacts', icon: Users, filled: ContactsFilled, label: t('contacts.titre') },
  { tab: 'profile', icon: User, filled: null, label: t('profil.titre') },
];

const SLOT_WIDTH = 76;
const SLOT_HEIGHT = 60;
const BAR_PADDING = 6;
const ICON_SIZE = 26;
const KICK_MS = 650;
const SLIDE_MS = 300;
// Glisse vite puis se pose doucement, sans dépasser l'onglet.
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const PHOTO_SIZE = 30;

// La place que les écrans laissent libre sous leur contenu, pour que la barre flottante ne le cache pas.
export function useBottomBarSpace() {
  return SLOT_HEIGHT + BAR_PADDING * 2 + spacing.md * 2 + useNavigationBarHeight();
}

// L'onglet Profil montre ma photo (ou une silhouette), cerclée quand l'onglet est choisi.
function ProfileIcon({ draw }: { draw: Animated.Value }) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  // Ma photo est chiffrée sur le disque (lot 2.3) : affichée depuis sa copie déchiffrée.
  const photo = useMediaUri(chat.getMyProfile().photo, { scope: 'app' });
  return (
    <View style={styles.photoSlot}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} />
      ) : (
        <User size={ICON_SIZE - 4} color={colors.text} strokeWidth={1.75} />
      )}
      <ProfileRing size={PHOTO_SIZE + 6} draw={draw} />
    </View>
  );
}

function TabButton({ tab, icon: Icon, filled: Filled, label, active, onPress }: { tab: Tab; icon: LucideIcon; filled: FilledIcon | null; label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const fill = useRef(new Animated.Value(active ? 1 : 0)).current;
  // Pilotées en JS : elles animent des attributs SVG (rayon, position, tracé).
  const kick = useRef(new Animated.Value(0)).current;
  const draw = useRef(new Animated.Value(active ? 1 : 0)).current;
  const mounted = useRef(false);

  const playKick = () => {
    kick.setValue(0);
    Animated.timing(kick, { toValue: 1, duration: KICK_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();
  };

  useEffect(() => {
    Animated.timing(fill, { toValue: active ? 1 : 0, duration: 180, useNativeDriver: true }).start();
    Animated.timing(draw, { toValue: active ? 1 : 0, duration: active ? 420 : 180, easing: SLIDE_EASING, useNativeDriver: false }).start();
    if (mounted.current && active) playKick();
    mounted.current = true;
  }, [active]);

  const press = () => {
    haptics.select();
    if (active) playKick();
    else onPress();
  };

  return (
    <Pressable onPress={press} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} style={styles.slot}>
      <View style={styles.icon}>
        {!Filled ? (
          <ProfileIcon draw={draw} />
        ) : (
          <>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
              <Icon size={ICON_SIZE} color={colors.onDarkTrack} strokeWidth={1.75} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.filled, { opacity: fill }]}>
              <Filled size={ICON_SIZE} kick={kick} />
            </Animated.View>
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
  const position = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.timing(position, { toValue: activeIndex, duration: SLIDE_MS, easing: SLIDE_EASING, useNativeDriver: true }).start();
  }, [activeIndex, position]);

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom: bottom + spacing.md }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        <Animated.View
          style={[
            styles.indicator,
            {
              transform: [
                { translateX: position.interpolate({ inputRange: [0, TABS.length - 1], outputRange: [0, SLOT_WIDTH * (TABS.length - 1)] }) },
              ],
            },
          ]}
        />
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
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
  },
  indicator: {
    position: 'absolute',
    top: BAR_PADDING,
    left: BAR_PADDING + (SLOT_WIDTH - SLOT_HEIGHT) / 2,
    width: SLOT_HEIGHT,
    height: SLOT_HEIGHT,
    borderRadius: radius.full,
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
