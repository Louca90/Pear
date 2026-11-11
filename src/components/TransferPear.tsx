import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { t } from '../i18n';
import { createStyles, motion, radius, spacing, useColors } from '../theme';
import { Pear } from './Pear';

const SIZE = 36;

// Photo ou vidéo en cours d'envoi ou de réception : une petite poire qui mûrit dans le coin du média,
// à la place de la barre. `progress` de 0 à 1, undefined quand rien ne bouge. À la fin, la poire reste
// pleine un instant puis s'efface en fondu.
export function TransferPear({ progress }: { progress: number | undefined }) {
  const colors = useColors();
  const styles = useStyles();
  const active = progress !== undefined;
  const [mounted, setMounted] = useState(active);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) setMounted(true);
    Animated.timing(opacity, { toValue: active ? 1 : 0, duration: motion.small, delay: active ? 0 : motion.small, easing: motion.easing, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !active) setMounted(false);
    });
  }, [active, opacity]);

  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.transfert', { pourcent: Math.round((active ? progress : 1) * 100) })}
      style={[styles.pill, { opacity }]}
    >
      <Pear height={22} color={colors.onMedia} state="ripening" progress={active ? progress : 1} />
    </Animated.View>
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
