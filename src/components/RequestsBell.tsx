import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';

import { t } from '../i18n';
import { createStyles, radius, useColors } from '../theme';
import { IconButton } from './ui';

const BADGE_MS = 240;

// La cloche de l'accueil : un badge rouge compte les demandes d'ajout en attente. Il apparaît et
// disparaît en douceur (grossit depuis le centre), sans rebond.
export function RequestsBell({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const visible = useRef(new Animated.Value(count > 0 ? 1 : 0)).current;
  // Le dernier nombre affiché reste visible pendant que le badge disparaît.
  const [shown, setShown] = useState(count);

  useEffect(() => {
    if (count > 0) setShown(count);
    Animated.timing(visible, { toValue: count > 0 ? 1 : 0, duration: BADGE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [count, visible]);

  const label = count > 0 ? t('demandes.cloche', { n: count }) : t('demandes.titre');
  return (
    <IconButton onPress={onPress} label={label}>
      <View>
        <Bell size={26} color={colors.text} strokeWidth={1.75} />
        <Animated.View pointerEvents="none" style={[styles.badge, { opacity: visible, transform: [{ scale: visible }] }]}>
          <Text style={styles.badgeText}>{shown > 9 ? '9+' : shown}</Text>
        </Animated.View>
      </View>
    </IconButton>
  );
}

const useStyles = createStyles((colors) => ({
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onMedia,
  },
}));
