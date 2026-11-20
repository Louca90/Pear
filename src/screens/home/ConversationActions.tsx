import { ComponentRef, ReactNode, RefObject, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { Easing, interpolateColor, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import { LucideIcon } from 'lucide-react-native';
import type { ComponentType } from 'react';
import type { AnimatedIconProps } from '../../components/AnimatedIcons';

import { useBottomBarSpace } from '../../components/BottomBar';
import { t } from '../../i18n';
import { useBackInterceptor } from '../../navigation/backInterceptors';
import { createStyles, spacing, useColors } from '../../theme';

// Planche « Liste · maintenir une conversation » : 260 ms pour le voile et le flou, 380 ms pour le menu,
// les actions arrivent une à une (60 ms puis 35 ms d'écart). Courbe douce, sans dépassement.
const OPEN_MS = 260;
const MENU_MS = 380;
const CLOSE_MS = 200;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const MENU_GAP = 10;
const ITEM_HEIGHT = 52;
const MENU_PADDING = 10;
// Un filet avant « Supprimer » : l'action dangereuse est séparée des autres.
const SEPARATOR = 9;
const MENU_WIDTH = 236;
const ITEM_FIRST_MS = 60;
const ITEM_STEP_MS = 35;
const CARD_RADIUS = 20;
// Le flou (6 px sur la planche) et le voile sombre du reste de l'écran.
const BLUR = 30;

// animated : l'icône animée de la planche Icônes, qui joue son geste à l'ouverture.
export type ConversationAction = { label: string; icon: LucideIcon; animated?: ComponentType<AnimatedIconProps>; onPress: () => void; danger?: boolean };
export type Rect = { x: number; y: number; width: number; height: number };

type Props = {
  rect: Rect;
  // La ligne telle qu'affichée dans la liste, recopiée dans la carte.
  row: ReactNode;
  actions: ConversationAction[];
  // Le contenu de l'accueil, flouté derrière la carte.
  blurTarget: RefObject<ComponentRef<typeof View> | null>;
  onClose: () => void;
};

// Appui long abouti : la ligne devient une carte qui reste à SA place et à sa taille, alignée sur la
// recherche ; le reste de l'écran se floute et s'assombrit ; un menu s'ouvre juste sous la carte (au-dessus
// si la ligne est en bas), depuis son coin. Posé dans l'écran (pas une fenêtre à part) pour pouvoir flouter.
export function ConversationActions({ rect, row, actions, blurTarget, onClose }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const root = useRef<ComponentRef<typeof View>>(null);
  // La position de cette couche dans la fenêtre : la ligne a été mesurée dans la fenêtre.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const shown = useSharedValue(0);
  const menu = useSharedValue(0);
  const closing = useRef(false);

  const barSpace = useBottomBarSpace();
  const card = { x: spacing.lg, y: rect.y, width: width - spacing.lg * 2, height: rect.height };
  // D'où part la carte : la ligne telle qu'elle est à la fin du maintien (en retrait de 8, rétrécie à 97 %).
  const rowX = rect.x + spacing.sm;
  const rowW = rect.width - spacing.sm * 2;
  const start = { x: rowX + rowW * 0.015, y: rect.y + rect.height * 0.015, width: rowW * 0.97, height: rect.height * 0.97 };
  const menuHeight = actions.length * ITEM_HEIGHT + MENU_PADDING * 2 + SEPARATOR;
  // Le menu ne touche jamais le bas de l'écran ni la barre d'onglets.
  const below = rect.y + rect.height + MENU_GAP + menuHeight < height - barSpace - 24;
  const menuTop = below ? card.y + card.height + MENU_GAP : card.y - MENU_GAP - menuHeight;

  useEffect(() => {
    if (!origin) return;
    const config = { easing: EASE, reduceMotion: ReduceMotion.System };
    shown.set(withTiming(1, { duration: OPEN_MS, ...config }));
    menu.set(withTiming(1, { duration: MENU_MS, ...config }));
  }, [origin, shown, menu]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    const done = () => {
      onClose();
      then?.();
    };
    menu.set(withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }));
    shown.set(
      withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(done);
      }),
    );
  };
  useBackInterceptor(true, () => close());

  const veil = useAnimatedStyle(() => ({ opacity: shown.get() }));
  // La ligne s'agrandit en carte : position, taille, fond et ombre suivent l'ouverture, sans à-coup.
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  const lifted = useAnimatedStyle(() => {
    const p = shown.get();
    return {
      left: start.x + (card.x - start.x) * p - ox,
      top: start.y + (card.y - start.y) * p - oy,
      width: start.width + (card.width - start.width) * p,
      height: start.height + (card.height - start.height) * p,
      backgroundColor: interpolateColor(p, [0, 1], [colors.surface, colors.elevated]),
      boxShadow: `0px ${Math.round(18 * p)}px ${Math.round(40 * p)}px ${colors.shadow}`,
    };
  });
  const rowStyle = useAnimatedStyle(() => ({
    paddingHorizontal: 16 + (12 - 16) * shown.get(),
    transform: [{ scale: 0.97 + 0.03 * shown.get() }],
  }));
  // Le menu grandit depuis son coin haut gauche (bas gauche s'il est au-dessus).
  const menuStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, menu.get() * 2),
    transform: [{ scale: reduced ? 1 : 0.88 + 0.12 * menu.get() }],
  }));

  return (
    <View
      ref={root}
      style={StyleSheet.absoluteFill}
      onLayout={() => root.current?.measureInWindow((x, y) => setOrigin({ x, y }))}
    >
      {origin && (
        <>
          <Reanimated.View style={[StyleSheet.absoluteFill, veil]}>
            <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={BLUR} tint="default" style={StyleSheet.absoluteFill} />
            <View style={styles.dim} />
          </Reanimated.View>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
          <Reanimated.View pointerEvents="none" style={[styles.card, lifted]}>
            {/* La ligne, avec 12 de marge intérieure à l'arrivée (planche) : rien n'est rogné sur les bords. */}
            <Reanimated.View style={[styles.cardRow, rowStyle]}>{row}</Reanimated.View>
          </Reanimated.View>
          <Reanimated.View
            style={[
              styles.menu,
              { top: menuTop - origin.y, left: card.x - origin.x, transformOrigin: below ? 'left top' : 'left bottom' },
              menuStyle,
            ]}
          >
            {actions.map(({ label, icon: Icon, animated: Animated_, onPress, danger }, index) => (
              <ActionItem key={label} index={index}>
                {danger && index > 0 && <View style={styles.separator} />}
                <Pressable onPress={() => close(onPress)} style={({ pressed }) => [styles.item, pressed && styles.pressed]} accessibilityRole="menuitem">
                  {Animated_ ? (
                    <Animated_ size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.8} autoPlay delay={200 + index * 40} />
                  ) : (
                    <Icon size={20} color={danger ? colors.danger : colors.text} strokeWidth={1.8} />
                  )}
                  <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
                </Pressable>
              </ActionItem>
            ))}
          </Reanimated.View>
        </>
      )}
    </View>
  );
}

// Une action du menu : elle monte en fondu, l'une après l'autre.
function ActionItem({ index, children }: { index: number; children: ReactNode }) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.set(withDelay(ITEM_FIRST_MS + index * ITEM_STEP_MS, withTiming(1, { duration: 220, easing: EASE, reduceMotion: ReduceMotion.System })));
  }, [shown, index]);
  const style = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: -6 * (1 - shown.get()) }] }));
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

const useStyles = createStyles((colors) => ({
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  card: {
    position: 'absolute',
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardRow: {
    flex: 1,
    justifyContent: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
    marginHorizontal: 12,
    backgroundColor: colors.border,
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    padding: MENU_PADDING,
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    boxShadow: `0px 18px 40px ${colors.shadow}`,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: ITEM_HEIGHT,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  danger: {
    color: colors.danger,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
}));
