import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FileText, Images } from 'lucide-react-native';

import { createStyles, spacing, useColors } from '../../../theme';
import { t } from '../../../i18n';

export type AttachAnchor = { x: number; y: number; width: number; height: number };

type AttachMenuProps = {
  open: boolean;
  // Le bouton trombone, mesuré dans la fenêtre : le menu naît exactement de lui.
  anchor: AttachAnchor | null;
  onClose: () => void;
  onPhotos: () => void;
  onFile: () => void;
};

const OPEN_MS = 320;
const CLOSE_MS = 240;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const CLOSE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

const BUTTON = 44;
const ROW = 48;
const PANEL_WIDTH = 196;
const PANEL_PADDING = 6;
const PANEL_HEIGHT = BUTTON + ROW * 2 + PANEL_PADDING;
const RADIUS = BUTTON / 2;

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Le trombone de lucide (24 × 24) et sa longueur, pour l'effacer trait par trait.
const PAPERCLIP = 'm16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551';
const PAPERCLIP_LENGTH = 86;
const CROSS_A = 'M18 6 6 18';
const CROSS_B = 'm6 6 12 12';
const CROSS_LENGTH = 17;

// Le trombone se défait pendant qu'une croix se dessine à sa place (et l'inverse à la fermeture).
function MorphIcon({ progress, color }: { progress: Animated.Value; color: string }) {
  const part = (from: number, to: number, start: number, end: number) =>
    progress.interpolate({ inputRange: [from, to], outputRange: [start, end], extrapolate: 'clamp' });
  const stroke = { stroke: color, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Animated.View style={{ transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <AnimatedPath d={PAPERCLIP} {...stroke} strokeDasharray={`${PAPERCLIP_LENGTH} ${PAPERCLIP_LENGTH}`} strokeDashoffset={part(0, 0.55, 0, -PAPERCLIP_LENGTH)} />
        <AnimatedPath d={CROSS_A} {...stroke} strokeDasharray={`${CROSS_LENGTH} ${CROSS_LENGTH}`} strokeDashoffset={part(0.35, 0.75, CROSS_LENGTH, 0)} />
        <AnimatedPath d={CROSS_B} {...stroke} strokeDasharray={`${CROSS_LENGTH} ${CROSS_LENGTH}`} strokeDashoffset={part(0.55, 0.95, CROSS_LENGTH, 0)} />
      </Svg>
    </Animated.View>
  );
}

// Le fond rond du trombone s'étire vers le haut et la droite pour devenir le fond des deux choix ;
// le trombone devient une croix. Un appui ailleurs (ou sur la croix, ou Retour) le referme à l'envers.
export function AttachMenu({ open, anchor, onClose, onPhotos, onFile }: AttachMenuProps) {
  const colors = useColors();
  const styles = useStyles();
  // Largeur et hauteur animées : le pilote JS, pour tout le menu (une seule valeur, un seul pilote).
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);
  const [place, setPlace] = useState(anchor);

  useEffect(() => {
    if (open) {
      setPlace(anchor);
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: false }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: CLOSE_EASING, useNativeDriver: false }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, anchor, progress]);

  if (!mounted || !place) return null;

  const left = place.x + (place.width - BUTTON) / 2;
  const bottom = place.y + (place.height + BUTTON) / 2;
  const grow = (start: number, end: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [start, end] });

  // Les deux choix arrivent quand le fond a pris de la place, l'un après l'autre.
  const appear = (index: number) => {
    const from = index === 0 ? 0.35 : 0.5;
    const range = [from, from + 0.45];
    return {
      opacity: progress.interpolate({ inputRange: range, outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateY: progress.interpolate({ inputRange: range, outputRange: [10, 0], extrapolate: 'clamp' }) }],
    };
  };

  const options = [
    { icon: Images, label: t('chat.photos'), onPress: onPhotos },
    { icon: FileText, label: t('chat.fichier'), onPress: onFile },
  ];

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('commun.fermer')} />
      <Animated.View
        style={[
          styles.panel,
          {
            left,
            top: grow(bottom - BUTTON, bottom - PANEL_HEIGHT),
            width: grow(BUTTON, PANEL_WIDTH),
            height: grow(BUTTON, PANEL_HEIGHT),
            backgroundColor: progress.interpolate({ inputRange: [0, 1], outputRange: [colors.surface, colors.elevated] }),
          },
        ]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shadowEdge, { opacity: progress }]} />
        {options.map(({ icon: Icon, label, onPress }, index) => (
          <Animated.View key={label} style={[styles.rowPlace, { bottom: BUTTON + ROW * index }, appear(index)]}>
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <Icon size={20} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.label} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('commun.fermer')} style={styles.closeCell}>
          <MorphIcon progress={progress} color={colors.text} />
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  panel: {
    position: 'absolute',
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  // Un liseré qui apparaît avec le menu : il se détache du fond de la conversation.
  shadowEdge: {
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowPlace: {
    position: 'absolute',
    left: PANEL_PADDING,
    width: PANEL_WIDTH - PANEL_PADDING * 2,
    height: ROW,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: RADIUS - PANEL_PADDING,
  },
  rowPressed: {
    backgroundColor: colors.elevatedActive,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  closeCell: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: BUTTON,
    height: BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
