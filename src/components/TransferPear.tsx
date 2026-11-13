import { useEffect, useRef, useState } from 'react';
import Reanimated, { ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { t } from '../i18n';
import { EASE } from '../motion';
import { createStyles, radius, spacing, useColors } from '../theme';
import { Pear } from './Pear';

const SIZE = 48;
const RING = 2.5;
const RING_R = SIZE / 2 - RING;
const RING_LENGTH = 2 * Math.PI * RING_R;
// Le temps de voir la feuille pousser, une fois le transfert fini, avant que la pastille s'efface.
const DONE_MS = 900;

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// Photo ou vidéo en cours d'envoi ou de réception, dans le coin du média : une poire qui se remplit
// comme un liquide, entourée d'un anneau qui se trace avec l'avancement. À la fin, l'anneau se ferme,
// la feuille pousse avec un halo, puis la pastille s'efface en se réduisant un peu.
// `progress` de 0 à 1, undefined quand rien ne bouge.
export function TransferPear({ progress }: { progress: number | undefined }) {
  const colors = useColors();
  const styles = useStyles();
  const active = progress !== undefined;
  const [mounted, setMounted] = useState(active);
  const [done, setDone] = useState(false);
  const wasActive = useRef(active);
  const shown = useSharedValue(active ? 1 : 0);
  const ring = useSharedValue(progress ?? 0);

  useEffect(() => {
    if (active) {
      setMounted(true);
      setDone(false);
      shown.set(withTiming(1, config(220)));
      ring.set(withTiming(progress, config(320)));
    } else if (wasActive.current) {
      // Fini : anneau complet, feuille, puis fondu.
      setDone(true);
      ring.set(withTiming(1, config(240)));
      shown.set(withDelay(DONE_MS, withTiming(0, config(220))));
      const timer = setTimeout(() => setMounted(false), DONE_MS + 240);
      wasActive.current = false;
      return () => clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active, progress]);

  const pill = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ scale: 0.85 + shown.get() * 0.15 }] }));
  const arc = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - ring.get()) }));

  if (!mounted) return null;
  return (
    <Reanimated.View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.transfert', { pourcent: Math.round((active ? progress : 1) * 100) })}
      style={[styles.pill, pill]}
    >
      <Svg width={SIZE} height={SIZE} style={styles.ring}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RING_R} fill="none" stroke={colors.onMedia} strokeOpacity={0.25} strokeWidth={RING} />
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RING_R}
          fill="none"
          stroke={done ? colors.signatureStrong : colors.onMedia}
          strokeWidth={RING}
          strokeLinecap="round"
          strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
          animatedProps={arc}
        />
      </Svg>
      <Pear height={26} color={colors.onMedia} state={done ? 'leaf' : 'ripening'} progress={active ? progress : 1} leafColor={colors.signatureStrong} />
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  pill: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: SIZE,
    height: SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
}));
