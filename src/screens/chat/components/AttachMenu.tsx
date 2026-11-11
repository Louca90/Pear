import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FileText, Images, MapPin, Sticker } from 'lucide-react-native';

import { createStyles, radius, spacing, useColors } from '../../../theme';
import { t } from '../../../i18n';

export const ATTACH_OPEN_MS = 300;
export const ATTACH_CLOSE_MS = 220;
export const ATTACH_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
export const ATTACH_CLOSE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

const BUTTON = 44;
const ICON = 20;

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Le trombone de lucide (24 × 24) et sa longueur, pour l'effacer trait par trait.
const PAPERCLIP = 'm16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551';
const PAPERCLIP_LENGTH = 86;
const CROSS_A = 'M18 6 6 18';
const CROSS_B = 'm6 6 12 12';
const CROSS_LENGTH = 17;

// Le trombone se défait pendant qu'une croix se dessine à sa place (et l'inverse à la fermeture).
export function AttachIcon({ progress, color }: { progress: Animated.Value; color: string }) {
  const part = (from: number, to: number, start: number, end: number) => progress.interpolate({ inputRange: [from, to], outputRange: [start, end], extrapolate: 'clamp' });
  const stroke = { stroke: color, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Animated.View style={{ transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }}>
      <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
        <AnimatedPath d={PAPERCLIP} {...stroke} strokeDasharray={`${PAPERCLIP_LENGTH} ${PAPERCLIP_LENGTH}`} strokeDashoffset={part(0, 0.55, 0, -PAPERCLIP_LENGTH)} />
        <AnimatedPath d={CROSS_A} {...stroke} strokeDasharray={`${CROSS_LENGTH} ${CROSS_LENGTH}`} strokeDashoffset={part(0.35, 0.75, CROSS_LENGTH, 0)} />
        <AnimatedPath d={CROSS_B} {...stroke} strokeDasharray={`${CROSS_LENGTH} ${CROSS_LENGTH}`} strokeDashoffset={part(0.55, 0.95, CROSS_LENGTH, 0)} />
      </Svg>
    </Animated.View>
  );
}

type PillProps = {
  // 0 fermé, 1 ouvert : le trombone devient une croix (pilote JS, tracés SVG).
  progress: Animated.Value;
  // La même progression sur le fil natif : le fond s'allonge, les choix arrivent ensuite.
  slide: Animated.Value;
  // La place à couvrir : le trombone et le champ de texte.
  width: number;
  open: boolean;
  onToggle: () => void;
  onPhotos: () => void;
  onFile: () => void;
  // Absents (notes à moi-même) : le choix n'est pas proposé.
  onLocation?: () => void;
  onStickers?: () => void;
};

// Le rond gris du trombone s'allonge vers la droite, à la même hauteur, jusqu'à couvrir le champ de
// texte : il devient le fond des deux choix, et le trombone devient une croix.
export function AttachPill({ progress, slide, width, open, onToggle, onPhotos, onFile, onLocation, onStickers }: PillProps) {
  const colors = useColors();
  const styles = useStyles();

  const full = Math.max(BUTTON, width);
  const options = [
    { icon: Images, label: t('chat.photos'), onPress: onPhotos },
    { icon: FileText, label: t('chat.fichier'), onPress: onFile },
    ...(onStickers ? [{ icon: Sticker, label: t('stickers.titre'), onPress: onStickers }] : []),
    ...(onLocation ? [{ icon: MapPin, label: t('position.court'), onPress: onLocation }] : []),
  ];
  // À plus de deux choix, le nom passe sous l'icône, en petit : tout tient sur la largeur du champ.
  const compact = options.length > 2;
  const appear = (index: number) => {
    // Les choix arrivent l'un après l'autre, le dernier juste avant la fin.
    const start = 0.35 + (index * 0.15) / Math.max(1, options.length - 1);
    const range = [start, start + 0.45];
    return {
      opacity: slide.interpolate({ inputRange: range, outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateX: slide.interpolate({ inputRange: range, outputRange: [-10, 0], extrapolate: 'clamp' }) }],
    };
  };

  return (
    <View pointerEvents="box-none" style={[styles.pill, { width: full }]}>
      {/* Le fond : deux bouts ronds et un milieu plat. Le bout droit glisse et le milieu s'étire depuis la
          gauche, sans jamais déformer les arrondis (rien ne change de largeur : tout reste sur le fil natif). */}
      <View pointerEvents="none" style={styles.background}>
        <View style={styles.cap} />
        <Animated.View style={[styles.middle, { width: Math.max(0, full - BUTTON), transform: [{ translateX: -(full - BUTTON) / 2 }, { scaleX: slide }, { translateX: (full - BUTTON) / 2 }] }]} />
        <Animated.View style={[styles.cap, { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, full - BUTTON] }) }] }]} />
      </View>
      {/* Pendant l'ouverture, les choix ne prennent pas d'appui : seulement une fois là. */}
      <View pointerEvents={open ? 'box-none' : 'none'} style={styles.options}>
        {options.map(({ icon: Icon, label, onPress }, index) => (
          <Animated.View key={label} style={[styles.optionPlace, compact && styles.optionPlaceCompact, appear(index)]}>
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.option, compact && styles.optionCompact, pressed && styles.optionPressed]}>
              <Icon size={18} color={colors.text} strokeWidth={1.75} />
              <Text style={[styles.label, compact && styles.labelCompact]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
      </View>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={open ? t('commun.fermer') : t('chat.joindre')} style={styles.button}>
        <AttachIcon progress={progress} color={colors.text} />
      </Pressable>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  pill: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: BUTTON,
  },
  background: {
    ...StyleSheet.absoluteFill,
  },
  cap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  middle: {
    position: 'absolute',
    left: BUTTON / 2,
    top: 0,
    height: BUTTON,
    backgroundColor: colors.surface,
  },
  button: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BUTTON,
    height: BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    ...StyleSheet.absoluteFill,
    left: BUTTON,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 4,
  },
  optionPlace: {
    flexShrink: 1,
  },
  option: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 12,
    borderRadius: radius.full,
  },
  optionPlaceCompact: {
    flex: 1,
  },
  optionCompact: {
    height: 40,
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 2,
  },
  labelCompact: {
    fontSize: 10,
    flexShrink: 0,
  },
  optionPressed: {
    backgroundColor: colors.elevatedActive,
  },
  label: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
}));
