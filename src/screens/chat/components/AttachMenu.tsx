import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import Reanimated, { interpolateColor, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { Camera, Eye, FileText, Images, LucideIcon, MapPin, Plus, Sticker } from 'lucide-react-native';

import { PickedFile } from '../../../chat/manager';
import { Thumbnail, toPickedFile } from '../../../components/MediaPicker';
import { usePressFeedback } from '../../../components/ui';
import { haptics } from '../../../haptics';
import { t } from '../../../i18n';
import { DURATION, EASE, exitFade, timing } from '../../../motion';
import { createStyles, radius, spacing, useColors } from '../../../theme';
import { log } from '../../../log';

const BUTTON = 44;
const SHEET_MS = 300;
const TILE_MS = 320;
const TILE_FIRST_DELAY = 60;
const TILE_STEP = 28;
const RECENT_COUNT = 4;
const RECENT_STEP = 40;
// Taille des vignettes en pixels (cache partagé avec la galerie).
const RECENT_PIXELS = 256;

// Appelée depuis le fil natif : c'est un worklet.
function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// La feuille grandit depuis le bouton « + » (en bas à gauche) : fondu, montée de 24 points, échelle 0,92 → 1.
const sheetIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 24 }, { scale: 0.92 }] },
    animations: { opacity: withTiming(1, config(SHEET_MS)), transform: [{ translateY: withTiming(0, config(SHEET_MS)) }, { scale: withTiming(1, config(SHEET_MS)) }] },
  };
};

// Chaque tuile part du coin du bouton et se pose à sa place, l'une après l'autre.
function tileIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const run = (value: number) => withDelay(TILE_FIRST_DELAY + index * TILE_STEP, withTiming(value, config(TILE_MS)));
    return {
      initialValues: { opacity: 0, transform: [{ translateX: -30 }, { translateY: 40 }, { scale: 0.7 }] },
      animations: { opacity: run(1), transform: [{ translateX: run(0) }, { translateY: run(0) }, { scale: run(1) }] },
    };
  };
}

// Les photos récentes glissent depuis la droite.
function recentIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const run = (value: number) => withDelay(index * RECENT_STEP, withTiming(value, config(SHEET_MS)));
    return {
      initialValues: { opacity: 0, transform: [{ translateX: 30 }] },
      animations: { opacity: run(1), transform: [{ translateX: run(0) }] },
    };
  };
}

// Le « + » de la saisie : il tourne en « × » et s'inverse (fond clair sur sombre) quand le menu est ouvert.
export function AttachButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.set(timing(open ? 1 : 0, 260));
  }, [open, progress]);
  const surface = colors.surface;
  const ink = colors.text;
  const back = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.get(), [0, 1], [surface, ink]) }));
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${45 * progress.get()}deg` }] }));
  const darkIcon = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const lightIcon = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return (
    <Pressable
      onPress={onToggle}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={open ? t('commun.fermer') : t('chat.joindre')}
      accessibilityState={{ expanded: open }}
    >
      <Reanimated.View style={[styles.button, back, feedback.style]}>
        <Reanimated.View style={[styles.icon, turn]}>
          <Reanimated.View style={[StyleSheet.absoluteFill, darkIcon]}>
            <Plus size={22} color={colors.text} strokeWidth={2} />
          </Reanimated.View>
          <Reanimated.View style={[StyleSheet.absoluteFill, lightIcon]}>
            <Plus size={22} color={colors.background} strokeWidth={2} />
          </Reanimated.View>
        </Reanimated.View>
      </Reanimated.View>
    </Pressable>
  );
}

// Le voile sur la conversation, menu ouvert : un appui referme le menu.
export function AttachScrim({ onClose }: { onClose: () => void }) {
  const styles = useStyles();
  return (
    <Reanimated.View entering={fadeIn} exiting={exitFade(DURATION.small)} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('commun.fermer')} />
    </Reanimated.View>
  );
}

const fadeIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, config(220)) } };
};

function Tile({ icon: Icon, label, primary, index, onPress }: { icon: LucideIcon; label: string; primary?: boolean; index: number; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  return (
    <Reanimated.View entering={tileIn(index)} style={styles.tilePlace}>
      <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label}>
        <Reanimated.View style={[styles.tile, feedback.style]}>
          <View style={[styles.bubble, primary && styles.bubblePrimary]}>
            <Icon size={22} color={primary ? colors.onSignature : colors.text} strokeWidth={1.8} />
          </View>
          <Text style={styles.tileLabel} numberOfLines={1}>
            {label}
          </Text>
        </Reanimated.View>
      </Pressable>
    </Reanimated.View>
  );
}

// Les dernières photos et vidéos, seulement si la galerie est déjà permise (jamais de demande ici).
function useRecentAssets() {
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  useEffect(() => {
    let alive = true;
    MediaLibrary.getPermissionsAsync(false, ['photo', 'video'])
      .then(async ({ granted }) => {
        if (!granted) return;
        const page = await MediaLibrary.getAssetsAsync({ first: RECENT_COUNT, mediaType: ['photo', 'video'], sortBy: [['creationTime', false]] });
        if (alive) setAssets(page.assets);
      })
      .catch((e) => log.warn('récents', e));
    return () => {
      alive = false;
    };
  }, []);
  return assets;
}

function Recent({ asset, index, order, onToggle }: { asset: MediaLibrary.Asset; index: number; order: number; onToggle: (asset: MediaLibrary.Asset) => void }) {
  const styles = useStyles();
  const picked = useSharedValue(order > 0 ? 1 : 0);
  useEffect(() => {
    picked.set(timing(order > 0 ? 1 : 0, DURATION.small));
  }, [order, picked]);
  const ring = useAnimatedStyle(() => ({ opacity: picked.get() }));
  return (
    <Reanimated.View entering={recentIn(index)} style={styles.recentPlace}>
      <Pressable onPress={() => onToggle(asset)} accessibilityRole="button" accessibilityLabel={asset.filename} accessibilityState={{ selected: order > 0 }} style={styles.recent}>
        <Thumbnail asset={asset} size={RECENT_PIXELS} style={StyleSheet.absoluteFill} />
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.recentRing, ring]}>
          <View style={styles.recentBadge}>
            <Text style={styles.recentBadgeText}>{order > 0 ? order : ''}</Text>
          </View>
        </Reanimated.View>
      </Pressable>
    </Reanimated.View>
  );
}

type SheetProps = {
  onPhotos: () => void;
  onFile: () => void;
  // Absents (notes à moi-même) : le choix n'est pas proposé.
  onLocation?: () => void;
  onStickers?: () => void;
  // Appareil photo de Pear : la photo part directement à ce contact.
  onCamera?: () => void;
  // Galerie avec la vue unique déjà choisie.
  onOnce?: () => void;
  onSendRecent: (files: PickedFile[]) => void;
};

// Le menu Joindre : les photos récentes (un appui les choisit, « Envoyer » les envoie ensemble), puis
// une tuile par type de pièce jointe.
export function AttachSheet({ onPhotos, onFile, onLocation, onStickers, onCamera, onOnce, onSendRecent }: SheetProps) {
  const styles = useStyles();
  const recent = useRecentAssets();
  const [selected, setSelected] = useState<MediaLibrary.Asset[]>([]);
  const toggle = (asset: MediaLibrary.Asset) => {
    haptics.select();
    setSelected((current) => (current.some(({ id }) => id === asset.id) ? current.filter(({ id }) => id !== asset.id) : [...current, asset]));
  };
  const sendRecent = () => {
    try {
      onSendRecent(selected.map(toPickedFile));
    } catch (e) {
      log.warn('récents', e);
    }
  };
  const tiles = [
    { icon: Images, label: t('chat.galerie'), primary: true, onPress: onPhotos },
    ...(onCamera ? [{ icon: Camera, label: t('chat.appareil'), onPress: onCamera }] : []),
    { icon: FileText, label: t('chat.fichier'), onPress: onFile },
    ...(onLocation ? [{ icon: MapPin, label: t('position.court'), onPress: onLocation }] : []),
    ...(onOnce ? [{ icon: Eye, label: t('chat.uneFois'), onPress: onOnce }] : []),
    ...(onStickers ? [{ icon: Sticker, label: t('stickers.titre'), onPress: onStickers }] : []),
  ];

  return (
    <Reanimated.View entering={sheetIn} exiting={exitFade(DURATION.small)} style={styles.sheet} accessibilityLabel={t('chat.joindre')}>
      {recent.length > 0 && (
        <>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('chat.recents')}</Text>
            <Pressable onPress={selected.length > 0 ? sendRecent : onPhotos} hitSlop={8} accessibilityRole="button">
              <Text style={styles.sheetLink}>{selected.length > 0 ? t('galerie.envoyerN', { n: selected.length }) : t('chat.toutGalerie')}</Text>
            </Pressable>
          </View>
          <View style={styles.recents}>
            {recent.map((asset, index) => (
              <Recent key={asset.id} asset={asset} index={index} order={selected.findIndex(({ id }) => id === asset.id) + 1} onToggle={toggle} />
            ))}
          </View>
        </>
      )}
      <View style={styles.tiles}>
        {tiles.map((tile, index) => (
          <Tile key={tile.label} index={index} {...tile} />
        ))}
      </View>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 22,
    height: 22,
  },
  scrim: {
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: '100%',
    marginBottom: spacing.sm,
    borderRadius: 28,
    backgroundColor: colors.elevated,
    padding: spacing.lg,
    gap: spacing.lg,
    boxShadow: `0px 8px 24px ${colors.shadow}`,
    // La feuille grandit depuis le coin du bouton « + ».
    transformOrigin: '30px 100%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  sheetLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.signatureStrong,
  },
  recents: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: -spacing.sm,
  },
  recentPlace: {
    flex: 1,
  },
  recent: {
    height: 86,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  recentRing: {
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: colors.signatureStrong,
    alignItems: 'flex-end',
    padding: 5,
  },
  recentBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.signatureStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  recentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onSignature,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  tilePlace: {
    width: '33.333%',
  },
  tile: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  bubble: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubblePrimary: {
    backgroundColor: colors.signature,
  },
  tileLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
}));
