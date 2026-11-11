import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Animated, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';

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
  onClose: () => void;
};

// Pages « Quoi de neuf » au style de la prise en main : la poire, un titre, une phrase, une démo.
// Glisser ou « Suivant » ; « Passer » est toujours visible et le retour d'Android fait comme lui.
export function WhatsNew({ pages, initial = 0, onClose }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { width } = useWindowDimensions();
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

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  const next = () => {
    if (last) return onClose();
    scroll.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.screen, { opacity: appear }]}>
        <View style={[styles.top, { paddingTop: top + spacing.sm }]}>
          <Pear height={72} color={colors.text} />
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('nouveautes.passer')} style={[styles.skip, { top: top + spacing.sm }]}>
            <Text style={styles.skipLabel}>{t('nouveautes.passer')}</Text>
          </Pressable>
        </View>
        <Animated.ScrollView
          ref={scroll}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}
          onMomentumScrollEnd={settle}
          scrollEventThrottle={16}
          style={styles.flex}
        >
          {pages.map((page, i) => {
            const Demo = page.demo ? DEMOS[page.demo] : undefined;
            const action = page.action ? ACTIONS[page.action.id] : undefined;
            // La page qui part s'efface pendant que la suivante arrive : fondu glissé, comme la prise en main.
            const distance = Animated.divide(Animated.subtract(x, i * width), width);
            return (
              <Animated.View key={i} style={[styles.page, { width, opacity: distance.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }) }]}>
                <View style={styles.demo}>{Demo ? <Demo /> : <Pear height={140} color={colors.text} />}</View>
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
        <View style={[styles.footer, { paddingBottom: bottom + spacing.lg }]}>
          <View style={styles.dots}>
            {pages.map((_, i) => {
              const range = [(i - 1) * width, i * width, (i + 1) * width];
              return (
                <Animated.View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      opacity: x.interpolate({ inputRange: range, outputRange: [0.25, 1, 0.25], extrapolate: 'clamp' }),
                      transform: [{ scale: x.interpolate({ inputRange: range, outputRange: [1, 1.4, 1], extrapolate: 'clamp' }) }],
                    },
                  ]}
                />
              );
            })}
          </View>
          <Button label={last ? t('nouveautes.termine') : t('nouveautes.suivant')} icon={last ? Check : ChevronRight} onPress={next} />
        </View>
      </Animated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  top: {
    alignItems: 'center',
  },
  skip: {
    position: 'absolute',
    right: spacing.lg,
    paddingVertical: spacing.sm,
  },
  skipLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textMuted,
  },
  page: {
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  demo: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.textMuted,
  },
  action: {
    marginTop: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.text,
  },
}));
