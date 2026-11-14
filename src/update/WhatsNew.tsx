import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { appVersionName } from '../../modules/pear-native';
import { timing } from '../motion';
import { ChevronRight } from 'lucide-react-native';

import { Pear } from '../components/Pear';
import { Button, useInsets, useNavigationBarHeight } from '../components/ui';
import { t } from '../i18n';
import { createStyles, motion, spacing, useColors } from '../theme';
import { DEMOS } from './demos';
import { ACTIONS, WhatsNewPage } from './pages';

type Props = {
  pages: WhatsNewPage[];
  // Page de départ (Découvrir Pear).
  initial?: number;
  // Le titre en capitales en haut de la feuille (par défaut : « Nouveau dans Pear x »).
  kicker?: string;
  onClose: () => void;
};

// Pages « Quoi de neuf » au style de la prise en main : la poire, un titre, une phrase, une démo.
// Glisser ou « Suivant » ; « Passer » est toujours visible et le retour d'Android fait comme lui.
export function WhatsNew({ pages, initial = 0, kicker, onClose }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { width: screenWidth } = useWindowDimensions();
  // Les pages ont la largeur de la feuille, en retrait des bords de l'écran.
  const width = screenWidth - SHEET_MARGIN * 2;
  const { top } = useInsets();
  const bottom = useNavigationBarHeight();
  const [index, setIndex] = useState(initial);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const x = useRef(new Animated.Value(initial * width)).current;
  const appear = useRef(new Animated.Value(0)).current;
  const last = index === pages.length - 1;

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: motion.screen, easing: motion.easing, useNativeDriver: true }).start();
    if (initial > 0) scroll.current?.scrollTo({ x: initial * width, animated: false });
  }, [appear, initial, width]);

  const next = () => {
    if (last) return onClose();
    scroll.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  const sheetWidth = width;
  const version = appVersionName() ?? '';

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.scrim, { opacity: appear }]} />
      <Animated.View
        style={[
          styles.sheet,
          { top: top + SHEET_TOP, bottom: bottom + SHEET_MARGIN, opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.head}>
          <Pear height={22} color={colors.signatureStrong} />
          <Text style={styles.kicker} numberOfLines={1}>
            {(kicker ?? t('nouveautes.nouveauDans', { version })).toUpperCase()}
          </Text>
          <Text style={styles.counter}>{`${index + 1} / ${pages.length}`}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('nouveautes.passer')}>
            <Text style={styles.skipLabel}>{t('nouveautes.passer')}</Text>
          </Pressable>
        </View>
        <Animated.ScrollView
          ref={scroll}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}
          onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / sheetWidth))}
          scrollEventThrottle={16}
          style={styles.flex}
        >
          {pages.map((page, i) => {
            const Demo = page.demo ? DEMOS[page.demo] : undefined;
            const action = page.action ? ACTIONS[page.action.id] : undefined;
            // La page arrive de la droite en fondu (28 points), celle qui part s'efface.
            const distance = Animated.divide(Animated.subtract(x, i * sheetWidth), sheetWidth);
            return (
              <Animated.View
                key={i}
                style={[
                  styles.page,
                  {
                    width: sheetWidth,
                    opacity: distance.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
                    transform: [{ translateX: distance.interpolate({ inputRange: [-1, 0, 1], outputRange: [-28, 0, 28] }) }],
                  },
                ]}
              >
                <View style={styles.demo}>{Demo ? <Demo /> : <Pear height={120} color={colors.text} />}</View>
                <Text style={styles.title}>{t(page.titre)}</Text>
                <Text style={styles.text}>{t(page.texte)}</Text>
                {page.action && action && (
                  <View style={styles.action}>
                    <Button label={t(page.action.label)} icon={ChevronRight} variant="secondary" onPress={action} />
                  </View>
                )}
              </Animated.View>
            );
          })}
        </Animated.ScrollView>
        <View style={styles.footer}>
          <View style={styles.dots}>
            {pages.map((_, i) => (
              <Dot key={i} active={i === index} />
            ))}
          </View>
          <Pressable onPress={next} accessibilityRole="button" style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
            <Text style={styles.ctaLabel}>{last ? t('nouveautes.cestParti') : t('nouveautes.suivant')}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

// Un point de la pagination : la page courante s'allonge en trait (6 → 22 points) et s'éclaire.
function Dot({ active }: { active: boolean }) {
  const styles = useStyles();
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.set(timing(active ? 1 : 0, 260));
  }, [active, on]);
  const style = useAnimatedStyle(() => ({ width: 6 + 16 * on.get(), opacity: 0.3 + 0.7 * on.get() }));
  return <Reanimated.View style={[styles.dot, style]} />;
}

const SHEET_MARGIN = 10;
const SHEET_TOP = 24;

const useStyles = createStyles((colors) => ({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: SHEET_MARGIN,
    right: SHEET_MARGIN,
    borderRadius: 32,
    backgroundColor: colors.elevated,
    paddingTop: 26,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  kicker: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.signatureStrong,
  },
  counter: {
    fontSize: 13,
    color: colors.textMuted,
  },
  skipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  page: {
    paddingHorizontal: 24,
    paddingTop: 26,
    gap: spacing.sm,
  },
  demo: {
    height: 300,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  action: {
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  dots: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.text,
  },
  cta: {
    height: 52,
    paddingHorizontal: 26,
    borderRadius: 26,
    backgroundColor: colors.text,
    justifyContent: 'center',
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
}));