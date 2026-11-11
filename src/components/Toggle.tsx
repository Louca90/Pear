import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable } from 'react-native';

import { createStyles, fixed, radius, useColors } from '../theme';

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const THUMB = 22;
const TOGGLE_MS = 180;

// Interrupteur : le rond glisse et le fond se colore, sans rebond. Couleurs du thème : activé, fond
// d'accent et rond de la couleur lisible dessus (noir sur blanc en sombre, blanc sur noir en clair) ;
// désactivé, fond discret et rond contrasté.
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  const colors = useColors();
  const styles = useStyles();
  const on = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(on, { toValue: value ? 1 : 0, duration: TOGGLE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, on]);

  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
    >
      <Animated.View
        style={[
          styles.track,
          {
            backgroundColor: on.interpolate({ inputRange: [0, 1], outputRange: [colors.elevatedActive, colors.accent] }),
            borderColor: on.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.accent] }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: on.interpolate({ inputRange: [0, 1], outputRange: [colors.scheme === 'dark' ? colors.textMuted : fixed.white, colors.onAccent] }),
              transform: [{ translateX: on.interpolate({ inputRange: [0, 1], outputRange: [0, TRACK_WIDTH - THUMB - 6] }) }],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const useStyles = createStyles(() => ({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.full,
    padding: 2,
    borderWidth: 1,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.full,
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.25)',
  },
}));
