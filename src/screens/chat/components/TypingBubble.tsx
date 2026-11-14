import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Reanimated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Avatar } from '../../../components/ui';
import { EASE } from '../../../motion';
import { BubblePalette, createStyles, motion, spacing } from '../../../theme';
import { t } from '../../../i18n';

const DOT = 7;
const CYCLE_MS = 1200;
const STAGGER_MS = 160;

// Un point : il s'allume puis s'éteint, décalé du précédent, et monte de 3 points au même moment.
function Dot({ index, pulse, color }: { index: number; pulse: SharedValue<number>; color: string }) {
  const styles = useStyles();
  const start = (index * STAGGER_MS) / CYCLE_MS;
  const reduced = motion.reduced;
  const style = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0.6 };
    const p = pulse.get();
    return {
      opacity: interpolate(p, [0, start, start + 0.2, start + 0.4, 1], [0.3, 0.3, 1, 0.3, 0.3]),
      transform: [{ translateY: interpolate(p, [0, start, start + 0.2, start + 0.4, 1], [0, 0, -3, 0, 0]) }],
    };
  });
  return <Reanimated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

// « écrit… » dans la liste : une bulle du contact avec trois points qui s'allument tour à tour.
// Elle apparaît et disparaît en fondu (180 ms), sans rien pousser d'autre.
export function TypingBubble({ typing, palette, avatar }: { typing: boolean; palette: BubblePalette; avatar?: string | null }) {
  const styles = useStyles();
  const [shown, setShown] = useState(typing);
  const appear = useSharedValue(typing ? 1 : 0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (typing) setShown(true);
    const hide = () => setShown(false);
    appear.set(
      withTiming(typing ? 1 : 0, { duration: motion.small, easing: EASE }, (finished) => {
        if (finished && !typing) scheduleOnRN(hide);
      }),
    );
  }, [typing, appear]);

  useEffect(() => {
    if (!shown || motion.reduced) return;
    pulse.set(0);
    pulse.set(withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(pulse);
  }, [shown, pulse]);

  const rowStyle = useAnimatedStyle(() => ({ opacity: appear.get(), transform: [{ translateY: 6 * (1 - appear.get()) }] }));

  if (!shown) return null;
  return (
    <Reanimated.View accessibilityLabel={t('chat.ecrit')} style={[styles.row, rowStyle]}>
      <View style={styles.avatarSlot}>
        <Avatar uri={avatar} size={28} />
      </View>
      <View style={[styles.bubble, { backgroundColor: palette.background }]}>
        {[0, 1, 2].map((index) => (
          <Dot key={index} index={index} pulse={pulse} color={palette.muted} />
        ))}
      </View>
    </Reanimated.View>
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
