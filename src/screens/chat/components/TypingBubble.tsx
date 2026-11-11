import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { Avatar } from '../../../components/ui';
import { BubblePalette, createStyles, motion, spacing } from '../../../theme';
import { t } from '../../../i18n';

const DOT = 7;
const CYCLE_MS = 1200;
const STAGGER_MS = 160;

// « écrit… » dans la liste : une bulle du contact avec trois points qui s'allument tour à tour.
// Elle apparaît et disparaît en fondu (180 ms), sans rien pousser d'autre.
export function TypingBubble({ typing, palette, avatar }: { typing: boolean; palette: BubblePalette; avatar?: string | null }) {
  const styles = useStyles();
  const [shown, setShown] = useState(typing);
  const appear = useRef(new Animated.Value(typing ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (typing) setShown(true);
    const animation = Animated.timing(appear, { toValue: typing ? 1 : 0, duration: motion.small, easing: motion.easing, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished && !typing) setShown(false);
    });
    return () => animation.stop();
  }, [typing, appear]);

  useEffect(() => {
    if (!shown || motion.reduced) return;
    pulse.setValue(0);
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [shown, pulse]);

  if (!shown) return null;
  // Chaque point s'allume puis s'éteint, décalé du précédent.
  const dotOpacity = (index: number) => {
    const start = (index * STAGGER_MS) / CYCLE_MS;
    const peak = start + 0.2;
    const end = start + 0.4;
    return motion.reduced ? 0.6 : pulse.interpolate({ inputRange: [0, start, peak, end, 1], outputRange: [0.3, 0.3, 1, 0.3, 0.3] });
  };

  return (
    <Animated.View
      accessibilityLabel={t('chat.ecrit')}
      style={[styles.row, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}
    >
      <View style={styles.avatarSlot}>
        <Avatar uri={avatar} size={28} />
      </View>
      <View style={[styles.bubble, { backgroundColor: palette.background }]}>
        {[0, 1, 2].map((index) => (
          <Animated.View key={index} style={[styles.dot, { backgroundColor: palette.muted, opacity: dotOpacity(index) }]} />
        ))}
      </View>
    </Animated.View>
  );
}

const useStyles = createStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 10,
  },
  avatarSlot: {
    width: 28,
    marginBottom: 2,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: 20,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
}));
