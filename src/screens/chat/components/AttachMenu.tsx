import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { FileText, Images } from 'lucide-react-native';

import { useBackInterceptor } from '../../../navigation/backInterceptors';
import { createStyles, useColors } from '../../../theme';
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

const OPEN_MS = 380;
const CLOSE_MS = 280;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const CLOSE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

const BUTTON = 44;
const ROW = 48;
const PAD = 6;
const GAP = 10;
const PANEL_HEIGHT = ROW * 2 + PAD * 2;
const PANEL_RADIUS = 20;
const ROW_PADDING = 12;
const ICON = 20;
const ICON_GAP = 12;
// Le col liquide entre le rond et la bulle : sa demi-largeur aux deux bouts et au plus fin.
const NECK_END = 12;
const NECK_THIN = 7;

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Le trombone de lucide (24 × 24) et sa longueur, pour l'effacer trait par trait.
const PAPERCLIP = 'm16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551';
const PAPERCLIP_LENGTH = 86;
const CROSS_A = 'M18 6 6 18';
const CROSS_B = 'm6 6 12 12';
const CROSS_LENGTH = 17;

// Les libellés ne changent pas pendant la session : la largeur mesurée une fois sert ensuite d'emblée.
let measuredWidth = 0;

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

function mixColor(from: string, to: string, amount: number) {
  const parse = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null);
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return amount < 0.5 ? from : to;
  return `rgb(${a.map((value, i) => Math.round(lerp(value, b[i], amount))).join(', ')})`;
}

function roundedRect(x: number, y: number, width: number, height: number, r: number) {
  return `M${x + r} ${y}H${x + width - r}A${r} ${r} 0 0 1 ${x + width} ${y + r}V${y + height - r}A${r} ${r} 0 0 1 ${x + width - r} ${y + height}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + height - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

// La forme entière, dans un cadre dont le rond occupe le coin bas gauche : le rond reste, la bulle
// s'en détache vers le haut en s'élargissant, et un col aux bords creusés les relie, comme une goutte
// qui s'étire.
function liquidShape(amount: number, panelWidth: number, height: number) {
  const r = BUTTON / 2;
  const cx = r;
  const cy = height - r;
  const circle = `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
  const width = lerp(BUTTON, panelWidth, amount);
  const panelHeight = lerp(BUTTON, PANEL_HEIGHT, amount);
  const bottom = lerp(height, height - BUTTON - GAP, amount);
  const top = bottom - panelHeight;
  const radius = Math.min(lerp(r, PANEL_RADIUS, amount), panelHeight / 2, width / 2);
  const panel = roundedRect(0, top, width, panelHeight, radius);
  // Le col n'existe que quand la bulle est sortie du rond.
  const neckTop = bottom - 4;
  const neckBottom = cy - r * 0.55;
  if (neckBottom - neckTop < 1) return [circle, panel];
  const thin = lerp(NECK_END, NECK_THIN, amount);
  const span = neckBottom - neckTop;
  const neck =
    `M${cx - NECK_END} ${neckTop}` +
    `C${cx - thin} ${neckTop + span * 0.35} ${cx - thin} ${neckTop + span * 0.65} ${cx - NECK_END} ${neckBottom}` +
    `H${cx + NECK_END}` +
    `C${cx + thin} ${neckTop + span * 0.65} ${cx + thin} ${neckTop + span * 0.35} ${cx + NECK_END} ${neckTop}Z`;
  return [circle, panel, neck];
}

// Le trombone se défait pendant qu'une croix se dessine à sa place (et l'inverse à la fermeture).
function MorphIcon({ progress, color }: { progress: Animated.Value; color: string }) {
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

// Posé dans l'écran (pas de Modal) : le clavier reste ouvert et le bouton ne bouge pas. Un appui
// ailleurs que sur les deux choix (ou sur la croix, ou Retour) referme à l'envers.
export function AttachMenu({ open, anchor, onClose, onPhotos, onFile }: AttachMenuProps) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useRef(new Animated.Value(0)).current;
  const layer = useRef<ComponentRef<typeof View>>(null);
  const [amount, setAmount] = useState(0);
  const [mounted, setMounted] = useState(open);
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null);
  const [contentWidth, setContentWidth] = useState(measuredWidth);

  useBackInterceptor(open, onClose);

  // La forme est recalculée à chaque image de l'animation (un petit SVG).
  useEffect(() => {
    const id = progress.addListener(({ value }) => setAmount(value));
    return () => progress.removeListener(id);
  }, [progress]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Une fois posé : la place du bouton dans ce calque.
  useEffect(() => {
    if (!mounted || !open || !anchor) return;
    layer.current?.measureInWindow((x, y) => setPlace({ x: anchor.x - x + (anchor.width - BUTTON) / 2, y: anchor.y - y + (anchor.height - BUTTON) / 2 }));
  }, [mounted, open, anchor]);

  // L'ouverture attend la place et la largeur du texte ; la fermeture démonte à la fin.
  useEffect(() => {
    if (open && place && contentWidth > 0) {
      Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: false }).start();
    } else if (!open && mounted) {
      Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: CLOSE_EASING, useNativeDriver: false }).start(({ finished }) => {
        if (!finished) return;
        setMounted(false);
        setPlace(null);
      });
    }
  }, [open, place, contentWidth, mounted, progress]);

  if (!mounted) return null;

  const options = [
    { icon: FileText, label: t('chat.fichier'), onPress: onFile },
    { icon: Images, label: t('chat.photos'), onPress: onPhotos },
  ];

  const measureRow = (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    if (width > measuredWidth) {
      measuredWidth = width;
      setContentWidth(width);
    }
  };

  const panelWidth = Math.max(BUTTON * 2, contentWidth + PAD * 2);
  const frameHeight = BUTTON + GAP + PANEL_HEIGHT;
  const shapes = liquidShape(amount, panelWidth, frameHeight);
  const fill = mixColor(colors.surface, colors.elevated, amount);

  // Fichier en haut, Photos juste au-dessus du bouton : Photos arrive en premier.
  const appear = (index: number) => {
    const from = index === 1 ? 0.4 : 0.52;
    const range = [from, Math.min(1, from + 0.42)];
    return {
      opacity: progress.interpolate({ inputRange: range, outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateY: progress.interpolate({ inputRange: range, outputRange: [8, 0], extrapolate: 'clamp' }) }],
    };
  };

  return (
    <View ref={layer} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('commun.fermer')} />

      {/* Les choix mesurés hors de la vue, à leur largeur naturelle : la bulle s'ajuste au texte. */}
      <View pointerEvents="none" style={styles.measure}>
        {options.map(({ icon: Icon, label }) => (
          <View key={label} onLayout={measureRow} style={styles.row}>
            <Icon size={ICON} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.label}>{label}</Text>
          </View>
        ))}
      </View>

      {place && (
        <View pointerEvents="box-none" style={[styles.frame, { left: place.x, top: place.y + BUTTON - frameHeight, width: panelWidth, height: frameHeight }]}>
          <Svg pointerEvents="none" width={panelWidth} height={frameHeight + 4} style={styles.shape}>
            {/* Une ombre douce, un liseré, puis le fond : le liseré ne reste visible qu'au bord de l'ensemble. */}
            <G opacity={amount} translateY={2}>
              {shapes.map((d, index) => (
                <Path key={index} d={d} fill={colors.shadow} />
              ))}
            </G>
            <G opacity={amount}>
              {shapes.map((d, index) => (
                <Path key={index} d={d} fill="none" stroke={colors.border} strokeWidth={1.5} />
              ))}
            </G>
            {shapes.map((d, index) => (
              <Path key={index} d={d} fill={fill} />
            ))}
          </Svg>

          {options.map(({ icon: Icon, label, onPress }, index) => (
            <Animated.View key={label} style={[styles.rowPlace, { top: PAD + ROW * index, width: panelWidth - PAD * 2 }, appear(index)]}>
              <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.row, styles.rowFill, pressed && styles.rowPressed]}>
                <Icon size={ICON} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.label} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            </Animated.View>
          ))}

          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('commun.fermer')} style={styles.closeCell}>
            <MorphIcon progress={progress} color={colors.text} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  frame: {
    position: 'absolute',
  },
  shape: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
    alignItems: 'flex-start',
  },
  rowPlace: {
    position: 'absolute',
    left: PAD,
    height: ROW,
  },
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ICON_GAP,
    paddingHorizontal: ROW_PADDING,
  },
  rowFill: {
    borderRadius: PANEL_RADIUS - PAD,
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
