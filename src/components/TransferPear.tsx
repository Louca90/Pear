import { useEffect, useRef, useState } from 'react';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { t } from '../i18n';
import { EASE } from '../motion';
import { createStyles, fixed, radius, spacing, useColors } from '../theme';
import { Pear } from './Pear';

const SIZE = 56;
const PEAR_HEIGHT = 40;
// Le temps de voir la poire pleine, une fois le transfert fini, avant que la pastille s'efface.
const FULL_MS = 500;

function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// Photo ou vidéo en cours d'envoi ou de réception, dans le coin du média : une grande poire qui se
// remplit comme un liquide, en suivant le pourcentage. À la fin, elle reste pleine un instant puis la
// pastille s'efface. `progress` de 0 à 1, undefined quand rien ne bouge.
export function TransferPear({ progress }: { progress: number | undefined }) {
  const colors = useColors();
  const styles = useStyles();
  const active = progress !== undefined;
  const [mounted, setMounted] = useState(active);
  const wasActive = useRef(active);
  const shown = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    if (active) {
      setMounted(true);
      shown.set(withTiming(1, config(220)));
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    shown.set(withDelay(FULL_MS, withTiming(0, config(220))));
    const timer = setTimeout(() => setMounted(false), FULL_MS + 240);
    return () => clearTimeout(timer);
  }, [active]);

  const pill = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ scale: 0.85 + shown.get() * 0.15 }] }));

  if (!mounted) return null;
  return (
    <Reanimated.View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.transfert', { pourcent: Math.round((active ? progress : 1) * 100) })}
      style={[styles.pill, pill]}
    >
      <Pear height={PEAR_HEIGHT} color={colors.onMedia} background={fixed.black} state="ripening" progress={active ? progress : 1} />
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
}));
