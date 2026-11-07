import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { t } from '../i18n';
import { createStyles, useColors } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Orange vif une fois la journée validée (les deux ont envoyé une photo ou une vidéo aujourd'hui).
const FLAME = '#FF7A1A';
const FLAME_CORE = '#FFC94D';
const WAKE_MS = 520;
const FLARE_MS = 260;
const OUT_MS = 360;

// Le dernier état vu de chaque série, pour animer ce qui a changé depuis (même en revenant sur l'écran).
const seen = new Map<string, { count: number; lit: boolean }>();

// La flamme d'une série. Grise tant que la journée n'est pas validée, orange ensuite : la couleur
// passe de l'une à l'autre et le cœur jaune apparaît (la flamme « s'éveille »). Quand la série
// augmente, la flamme s'élève un peu et le chiffre défile ; perdue, elle redevient grise et s'éteint.
export function StreakFlame({ id, count, lit, size = 16 }: { id: string; count: number; lit: boolean; size?: number }) {
  const colors = useColors();
  const styles = useStyles();
  const previous = useRef(seen.get(id) ?? { count, lit }).current;
  const [shownCount, setShownCount] = useState(previous.count || count);
  const [visible, setVisible] = useState(previous.count > 0 || count > 0);
  // Pilotées en JS : elles colorent des tracés SVG.
  const glow = useRef(new Animated.Value(previous.lit && previous.count > 0 ? 1 : 0)).current;
  const presence = useRef(new Animated.Value(previous.count > 0 ? 1 : 0)).current;
  const flare = useRef(new Animated.Value(0)).current;
  const roll = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const before = seen.get(id) ?? previous;
    seen.set(id, { count, lit });
    if (count === 0) {
      // Série perdue : grise, puis elle rétrécit et disparaît.
      Animated.sequence([
        Animated.timing(glow, { toValue: 0, duration: OUT_MS / 2, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(presence, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
      ]).start(({ finished }) => finished && setVisible(false));
      return;
    }
    setVisible(true);
    Animated.timing(presence, { toValue: 1, duration: OUT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    Animated.timing(glow, { toValue: lit ? 1 : 0, duration: WAKE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    if (count !== before.count) {
      // Le chiffre défile : l'ancien monte et s'efface, le nouveau arrive d'en dessous.
      roll.setValue(0);
      setShownCount(count);
      Animated.timing(roll, { toValue: 1, duration: FLARE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }
    if (count > before.count || (lit && !before.lit)) {
      flare.setValue(0);
      Animated.sequence([
        Animated.timing(flare, { toValue: 1, duration: FLARE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(flare, { toValue: 0, duration: FLARE_MS * 1.4, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      ]).start();
    }
  }, [id, count, lit, glow, presence, flare, roll, previous]);

  if (!visible) return null;
  const outer = glow.interpolate({ inputRange: [0, 1], outputRange: [colors.textMuted, FLAME] });

  return (
    <Animated.View
      accessibilityLabel={t('accueil.serie', { n: shownCount })}
      style={[
        styles.row,
        {
          opacity: presence,
          transform: [{ scale: presence.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        },
      ]}
    >
      <Animated.View
        style={{
          transform: [
            { translateY: flare.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
            { scale: flare.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
          ],
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <AnimatedPath
            d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
            fill={outer}
          />
          <AnimatedPath
            d="M12 21.2a3.4 3.4 0 0 1-3.4-3.4c0-1.6 1-2.6 1.8-3.6.3 1.1 1 1.8 1.7 1.8.9 0 1.6-1.1 1.4-2.6 1.3 1 2.5 2.5 2.5 4.4a4 4 0 0 1-4 3.4z"
            fill={FLAME_CORE}
            opacity={glow}
          />
        </Svg>
      </Animated.View>
      <View style={styles.countBox}>
        <Animated.Text
          style={[
            styles.count,
            {
              color: glow.interpolate({ inputRange: [0, 1], outputRange: [colors.textMuted, colors.text] }),
              opacity: roll,
              transform: [{ translateY: roll.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
            },
          ]}
        >
          {shownCount}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const useStyles = createStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  countBox: {
    overflow: 'hidden',
  },
  count: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
}));
