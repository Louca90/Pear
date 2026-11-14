import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { t } from '../i18n';
import { timing } from '../motion';
import { createStyles, radius, useColors } from '../theme';
import { BellIcon } from './AnimatedIcons';
import { IconButton } from './ui';

const DOT_MS = 240;

// La cloche de l'accueil (planche Accueil) : un bouton rond ; un point vert signale des demandes d'ajout
// en attente. Le battant oscille quand une nouvelle demande arrive, et à chaque appui.
export function RequestsBell({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [ring, setRing] = useState(0);
  const previous = useRef(count);
  const visible = useSharedValue(count > 0 ? 1 : 0);

  useEffect(() => {
    visible.set(timing(count > 0 ? 1 : 0, DOT_MS));
    if (count > previous.current) setRing((value) => value + 1);
    previous.current = count;
  }, [count, visible]);

  const dot = useAnimatedStyle(() => ({ opacity: visible.get(), transform: [{ scale: 0.6 + 0.4 * visible.get() }] }));
  const label = count > 0 ? t('demandes.cloche', { n: count }) : t('demandes.titre');
  return (
    <IconButton
      onPress={() => {
        setRing((value) => value + 1);
        onPress();
      }}
      label={label}
      style={styles.button}
    >
      <View>
        <BellIcon size={20} color={colors.text} play={ring} />
        <Reanimated.View pointerEvents="none" style={[styles.dot, dot]} />
      </View>
    </IconButton>
  );
}

const useStyles = createStyles((colors) => ({
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.signatureStrong,
  },
}));
