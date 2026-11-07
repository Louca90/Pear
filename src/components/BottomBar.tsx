import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Camera, LucideIcon, MessageCircle, QrCode, User } from 'lucide-react-native';
import { Circle } from 'react-native-svg';

import { chat } from '../chat/manager';
import { createStyles, radius, spacing, useColors } from '../theme';
import { useNavigationBarHeight } from './ui';
import { log } from '../log';
import { t } from '../i18n';

export type Tab = 'add' | 'home' | 'camera' | 'profile';

const TABS: { tab: Tab; icon: LucideIcon; label: string }[] = [
  { tab: 'add', icon: QrCode, label: t('onglets.monCode') },
  { tab: 'home', icon: MessageCircle, label: t('onglets.messages') },
  { tab: 'camera', icon: Camera, label: t('onglets.appareilPhoto') },
  { tab: 'profile', icon: User, label: t('profil.titre') },
];

const SLOT_WIDTH = 76;
const SLOT_HEIGHT = 60;
const BAR_PADDING = 6;
const ICON_SIZE = 26;
const KICK_MS = 520;
const SLIDE_MS = 300;
// Glisse vite puis se pose doucement, sans dépasser l'onglet.
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const PHOTO_SIZE = 30;

// La place que les écrans laissent libre sous leur contenu, pour que la barre flottante ne le cache pas.
export function useBottomBarSpace() {
  return SLOT_HEIGHT + BAR_PADDING * 2 + spacing.md * 2 + useNavigationBarHeight();
}

// Chaque icône a son propre geste au toucher : le QR tremble, la bulle se balance, l'appareil se tasse.
function kickTransform(tab: Tab, kick: Animated.Value) {
  const range = (outputRange: number[]) => kick.interpolate({ inputRange: [0, 0.3, 0.65, 1], outputRange });
  const turn = (outputRange: string[]) => kick.interpolate({ inputRange: [0, 0.3, 0.65, 1], outputRange });
  if (tab === 'add') return [{ scale: range([1, 0.8, 1.14, 1]) }, { rotate: turn(['0deg', '-8deg', '6deg', '0deg']) }];
  if (tab === 'profile') return [{ scale: range([1, 0.86, 1, 1]) }];
  if (tab === 'home') return [{ translateY: range([0, -7, 1, 0]) }, { rotate: turn(['0deg', '-14deg', '7deg', '0deg']) }];
  return [{ scale: range([1, 0.72, 1.16, 1]) }];
}

// Le détail qui bouge dans l'icône remplie : la ligne de scan du QR, l'obturateur de l'appareil photo.
function KickDetail({ tab, kick }: { tab: Tab; kick: Animated.Value }) {
  const styles = useStyles();
  if (tab === 'add') {
    return (
      <Animated.View
        style={[
          styles.scanLine,
          {
            opacity: kick.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateY: kick.interpolate({ inputRange: [0, 1], outputRange: [-ICON_SIZE / 2, ICON_SIZE / 2] }) }],
          },
        ]}
      />
    );
  }
  if (tab === 'camera') {
    return (
      <Animated.View
        style={[styles.shutter, { transform: [{ scale: kick.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [0, 1, 1, 0] }) }] }]}
      />
    );
  }
  return null;
}

// Le contenu blanc de l'icône remplie : l'objectif de l'appareil, les trois points de la bulle.
function FilledDetails({ tab }: { tab: Tab }) {
  const colors = useColors();
  if (tab === 'camera') return <Circle cx={12} cy={13} r={3.5} fill={colors.elevatedActive} stroke="none" />;
  if (tab === 'home') {
    return (
      <>
        {[8, 12, 16].map((cx) => (
          <Circle key={cx} cx={cx} cy={12} r={1.3} fill={colors.elevatedActive} stroke="none" />
        ))}
      </>
    );
  }
  return null;
}

// L'onglet Profil montre ma photo (ou une silhouette), cerclée quand l'onglet est choisi.
function ProfileIcon({ fill }: { fill: Animated.Value }) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const photo = chat.getMyProfile().photo;
  return (
    <View style={styles.photoSlot}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} />
      ) : (
        <User size={ICON_SIZE - 4} color={colors.text} strokeWidth={1.75} />
      )}
      <Animated.View pointerEvents="none" style={[styles.photoRing, { opacity: fill }]} />
    </View>
  );
}

function TabButton({ tab, icon: Icon, label, active, onPress }: { tab: Tab; icon: LucideIcon; label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const fill = useRef(new Animated.Value(active ? 1 : 0)).current;
  const kick = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  const playKick = () => {
    kick.setValue(0);
    Animated.timing(kick, { toValue: 1, duration: KICK_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };

  useEffect(() => {
    Animated.timing(fill, { toValue: active ? 1 : 0, duration: 180, useNativeDriver: true }).start();
    if (mounted.current && active) playKick();
    mounted.current = true;
  }, [active]);

  const press = () => {
    Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
    if (active) playKick();
    else onPress();
  };

  return (
    <Pressable onPress={press} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} style={styles.slot}>
      <Animated.View style={[styles.icon, { transform: kickTransform(tab, kick) }]}>
        {tab === 'profile' ? (
          <ProfileIcon fill={fill} />
        ) : (
          <>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
              <Icon size={ICON_SIZE} color={colors.onDarkTrack} strokeWidth={1.75} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.filled, { opacity: fill }]}>
              <Icon size={ICON_SIZE} color={colors.text} fill={colors.text} strokeWidth={1.75}>
                <FilledDetails tab={tab} />
              </Icon>
              <KickDetail tab={tab} kick={kick} />
            </Animated.View>
          </>
        )}
      </Animated.View>
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
        {TABS.map(({ tab, icon, label }) => (
          <TabButton key={tab} tab={tab} icon={icon} label={label} active={tab === active} onPress={() => onChange(tab)} />
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
  photoRing: {
    position: 'absolute',
    width: PHOTO_SIZE + 4,
    height: PHOTO_SIZE + 4,
    borderRadius: (PHOTO_SIZE + 4) / 2,
    borderWidth: 2,
    borderColor: colors.text,
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
  scanLine: {
    position: 'absolute',
    left: 1,
    right: 1,
    height: 2,
    backgroundColor: colors.background,
  },
  shutter: {
    position: 'absolute',
    top: (13 / 24) * ICON_SIZE - 5,
    left: ICON_SIZE / 2 - 5,
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.text,
  },
}));
