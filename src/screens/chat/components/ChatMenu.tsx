import { ComponentType, Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { ReduceMotion, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';

import { useInsets } from '../../../components/ui';
import type { AnimatedIconProps } from '../../../components/AnimatedIcons';
import { t } from '../../../i18n';
import { DURATION, EASE, exitFade } from '../../../motion';
import { useBackInterceptor } from '../../../navigation/backInterceptors';
import { createStyles, spacing, useColors } from '../../../theme';

export type ChatMenuItem = {
  icon: ComponentType<{ size: number; color: string; strokeWidth: number }>;
  // Une icône animée (planche Icônes) : elle joue son geste une fois, à l'ouverture du menu.
  animated?: ComponentType<AnimatedIconProps>;
  label: string;
  // À droite, en gris (réglage en cours : « 1 h », « Toutes »…).
  value?: string;
  danger?: boolean;
  // Un filet au-dessus (sépare les actions destructrices).
  separated?: boolean;
  onPress: () => void;
};

const MENU_WIDTH = 268;
const OPEN_MS = 220;
const ITEM_STEP = 22;
// Hauteur de l'en-tête de la conversation, sous lequel le menu s'ouvre.
const HEADER_HEIGHT = 56;

function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// Le menu grandit depuis le bouton « 3 points » (coin en haut à droite) : fondu et échelle 0,9 → 1.
const menuIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: { opacity: withTiming(1, config(OPEN_MS)), transform: [{ scale: withTiming(1, config(OPEN_MS)) }] },
  };
};

// Les lignes descendent de 6 points l'une après l'autre.
function itemIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const run = (value: number) => withDelay(40 + index * ITEM_STEP, withTiming(value, config(OPEN_MS)));
    return { initialValues: { opacity: 0, transform: [{ translateY: -6 }] }, animations: { opacity: run(1), transform: [{ translateY: run(0) }] } };
  };
}

const scrimIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, config(200)) } };
};

// Le menu « 3 points » de la conversation : toutes ses actions, sans quitter l'écran. Un appui à côté
// ou le retour d'Android le referme ; choisir une action le referme d'abord.
export function ChatMenu({ items, onClose }: { items: ChatMenuItem[]; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const { top } = useInsets();
  useBackInterceptor(true, onClose);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Reanimated.View entering={scrimIn} exiting={exitFade(DURATION.small)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('commun.fermer')} />
      </Reanimated.View>
      <Reanimated.View entering={menuIn} exiting={exitFade(DURATION.small)} style={[styles.menu, { top: top + HEADER_HEIGHT }]} accessibilityRole="menu">
        {items.map((item, index) => {
          const color = item.danger ? colors.danger : colors.text;
          const Icon = item.icon;
          return (
            <Fragment key={item.label}>
              {item.separated && <View style={styles.separator} />}
              <Reanimated.View entering={itemIn(index)}>
                <Pressable
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item.value ? `${item.label}, ${item.value}` : item.label}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  {item.animated ? <item.animated size={19} color={color} strokeWidth={1.8} autoPlay delay={180 + index * ITEM_STEP} /> : <Icon size={19} color={color} strokeWidth={1.8} />}
                  <Text style={[styles.label, { color }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {!!item.value && <Text style={styles.value}>{item.value}</Text>}
                </Pressable>
              </Reanimated.View>
            </Fragment>
          );
        })}
      </Reanimated.View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  scrim: {
    backgroundColor: colors.overlay,
  },
  menu: {
    position: 'absolute',
    right: spacing.md,
    width: MENU_WIDTH,
    padding: 6,
    borderRadius: 22,
    backgroundColor: colors.elevated,
    boxShadow: `0px 18px 48px ${colors.shadow}`,
    transformOrigin: `${MENU_WIDTH - 22}px 0px`,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  itemPressed: {
    backgroundColor: colors.elevatedActive,
  },
  label: {
    flex: 1,
    fontSize: 15,
  },
  value: {
    fontSize: 12,
    color: colors.textMuted,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 5,
    marginHorizontal: 10,
    backgroundColor: colors.border,
  },
}));

