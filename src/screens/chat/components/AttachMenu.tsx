import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FileText, Images } from 'lucide-react-native';

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
  // 0 fermé, 1 ouvert : la largeur suit (pilote JS), les choix arrivent ensuite.
  progress: Animated.Value;
  // La place à couvrir : le trombone et le champ de texte.
  width: number;
  open: boolean;
  onToggle: () => void;
  onPhotos: () => void;
  onFile: () => void;
};

// Le rond gris du trombone s'allonge vers la droite, à la même hauteur, jusqu'à couvrir le champ de
// texte : il devient le fond des deux choix, et le trombone devient une croix.
export function AttachPill({ progress, width, open, onToggle, onPhotos, onFile }: PillProps) {
  const colors = useColors();
  const styles = useStyles();

  const options = [
    { icon: Images, label: t('chat.photos'), onPress: onPhotos },
    { icon: FileText, label: t('chat.fichier'), onPress: onFile },
  ];
  const appear = (index: number) => {
    const range = index === 0 ? [0.35, 0.8] : [0.5, 0.95];
    return {
      opacity: progress.interpolate({ inputRange: range, outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateX: progress.interpolate({ inputRange: range, outputRange: [-10, 0], extrapolate: 'clamp' }) }],
    };
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.pill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: [BUTTON, Math.max(BUTTON, width)] }) }]}
    >
      {/* Pendant l'ouverture, les choix ne prennent pas d'appui : seulement une fois là. */}
      <View pointerEvents={open ? 'box-none' : 'none'} style={styles.options}>
        {options.map(({ icon: Icon, label, onPress }, index) => (
          <Animated.View key={label} style={[styles.optionPlace, appear(index)]}>
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}>
              <Icon size={18} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.label} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
      </View>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={open ? t('commun.fermer') : t('chat.joindre')} style={styles.button}>
        <AttachIcon progress={progress} color={colors.text} />
      </Pressable>
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  pill: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: BUTTON,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
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
