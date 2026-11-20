import { useEffect, useRef, useState } from 'react';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { t } from '../i18n';
import { EASE } from '../motion';
import { createStyles, radius, spacing, useColors } from '../theme';
import { Pear } from './Pear';

const SIZE = 56;
const PEAR_HEIGHT = 40;
// Une fois le transfert fini : la poire passe d'« Envoi » à « Vérifié » (la feuille repousse en vert, les
// pépins se serrent, planche « Icône Pépins »), on la voit un instant, puis la pastille s'efface.
const FULL_MS = 1100;

function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// Photo ou vidéo en cours d'envoi ou de réception, dans le coin du média : une grande poire qui se
// remplit comme un liquide, en suivant le pourcentage. À la fin, elle reste pleine un instant puis la
// pastille s'efface. `progress` de 0 à 1, undefined quand rien ne bouge.
// small : la version des cases d'un album (pastille plus petite).
export function TransferPear({ progress, small = false }: { progress: number | undefined; small?: boolean }) {
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
      style={[styles.pill, small && styles.small, pill]}
    >
      <Pear height={small ? PEAR_HEIGHT * 0.65 : PEAR_HEIGHT} color={colors.onMedia} state={active ? 'ripening' : 'leaf'} progress={active ? progress : 1} leafColor={colors.signatureStrong} />
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  small: {
    width: SIZE * 0.65,
    height: SIZE * 0.65,
    top: 6,
    left: 6,
  },
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
