import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text } from 'react-native';
import { ArrowDown } from 'lucide-react-native';

import { createStyles, radius, spacing, useColors } from '../../../theme';

// Juste au-dessus de la barre de saisie, centré : apparaît quand des messages arrivent pendant qu'on est remonté.
export function NewMessagesButton({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(count);

  useEffect(() => {
    if (count > 0) setShown(count);
    Animated.timing(appear, { toValue: count > 0 ? 1 : 0, duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [count, appear]);

  const label = shown === 1 ? '1 nouveau message' : `${shown} nouveaux messages`;

  return (
    <Animated.View
      pointerEvents={count > 0 ? 'auto' : 'none'}
      style={[
        styles.wrap,
        { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] },
      ]}
    >
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.button}>
        <ArrowDown size={18} color={colors.background} strokeWidth={2} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  wrap: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    boxShadow: `0px 4px 16px ${colors.shadow}`,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
  },
}));
