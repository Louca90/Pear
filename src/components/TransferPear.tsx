import { useEffect, useState } from 'react';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { t } from '../i18n';
import { EASE } from '../motion';
import { TransferAnimation } from '../screens/chat/hooks/useTransferAnimation';
import { createStyles, radius, spacing, useColors } from '../theme';
import { Pear } from './Pear';

const SIZE = 56;
const PEAR_HEIGHT = 40;
const FADE_MS = 220;

function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// Photo, vidéo ou album en cours d'envoi ou de réception : une pastille dans le coin du média, avec la poire
// « Envoi » qui se remplit au pourcentage du fichier, puis passe à « Vérifié » (useTransferAnimation).
// La pastille et la poire suivent le mode : claires en clair, sombres en sombre (planches « Icône Pépins »).
export function TransferPear({ transfer, small = false }: { transfer: TransferAnimation; small?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const [mounted, setMounted] = useState(transfer.visible);
  const shown = useSharedValue(transfer.visible ? 1 : 0);

  useEffect(() => {
    if (transfer.visible) {
      setMounted(true);
      shown.set(withTiming(1, config(FADE_MS)));
      return;
    }
    shown.set(withTiming(0, config(FADE_MS)));
    const timer = setTimeout(() => setMounted(false), FADE_MS + 20);
    return () => clearTimeout(timer);
  }, [transfer.visible, shown]);

  const pill = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ scale: 0.85 + shown.get() * 0.15 }] }));

  if (!mounted) return null;
  return (
    <Reanimated.View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.transfert', { pourcent: Math.round(transfer.progress * 100) })}
      style={[styles.pill, small && styles.small, pill]}
    >
      <Pear
        height={small ? PEAR_HEIGHT * 0.65 : PEAR_HEIGHT}
        color={colors.text}
        state={transfer.confirmed ? 'leaf' : 'ripening'}
        progress={transfer.progress}
        leafColor={colors.signatureStrong}
      />
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
    backgroundColor: colors.elevated,
    boxShadow: `0px 4px 14px ${colors.shadow}`,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
