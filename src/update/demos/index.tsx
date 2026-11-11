import { ComponentType, ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Bell, Search } from 'lucide-react-native';

import { Pear } from '../../components/Pear';
import { Button } from '../../components/ui';
import { t } from '../../i18n';
import { StatusTicks } from '../../screens/chat/components/MessageMeta';
import { TypingBubble } from '../../screens/chat/components/TypingBubble';
import { bubblePalette, createStyles, ephemeralBubble, motion, radius, spacing, useColors } from '../../theme';
import { PhoneFrame } from './PhoneFrame';

// Fait tourner une valeur parmi `values`, une à chaque `ms`.
function useCycle<T>(values: T[], ms: number): T {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % values.length), ms);
    return () => clearInterval(timer);
  }, [values.length, ms]);
  return values[index];
}

const STATUSES = ['sending', 'delivered', 'read'] as const;

// Une bulle qui passe de « envoyé » à « reçu » puis « lu » : les vraies coches de la conversation.
function ReadDemo() {
  const colors = useColors();
  const styles = useStyles();
  const status = useCycle([...STATUSES], 1600);
  const palette = bubblePalette(colors.bubbleMine);
  return (
    <PhoneFrame>
      <View style={[styles.bubble, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.text, fontSize: 14 }}>Salut !</Text>
        <View style={styles.meta}>
          <StatusTicks status={status} tone={{ text: palette.text, muted: palette.muted }} />
        </View>
      </View>
    </PhoneFrame>
  );
}

// La vraie bulle « écrit… » qui apparaît et disparaît.
function TypingDemo() {
  const colors = useColors();
  const typing = useCycle([true, true, false], 1500);
  return (
    <PhoneFrame>
      <TypingBubble typing={typing} palette={bubblePalette(colors.bubbleTheirs)} />
    </PhoneFrame>
  );
}

// Le bouton principal dans la couleur signature.
function SignatureDemo() {
  return (
    <PhoneFrame>
      <Button label="OK" icon={Bell} onPress={() => {}} />
    </PhoneFrame>
  );
}

// Un élément qui apparaît ou s'efface en fondu (180 ms), sans changer la mise en page.
function Fade({ shown, children }: { shown: boolean; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [shown, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const STEPS = [0, 1, 2, 3, 4, 5];

// Recherche : le mot se tape lettre par lettre, sans accent, et le résultat accentué apparaît.
function SearchDemo() {
  const colors = useColors();
  const styles = useStyles();
  const step = useCycle(STEPS, 550);
  const typed = 'elo'.slice(0, Math.min(3, step));
  return (
    <PhoneFrame>
      <View style={styles.field}>
        <Search size={15} color={colors.textMuted} strokeWidth={1.75} />
        <Text style={styles.fieldText}>{typed}</Text>
        <View style={styles.caret} />
      </View>
      <Fade shown={step >= 2}>
        <View style={styles.hit}>
          <View style={styles.hitAvatar} />
          <Text style={styles.hitText}>
            <Text style={styles.hitMatch}>Élo</Text>die
          </Text>
        </View>
      </Fade>
    </PhoneFrame>
  );
}

// Messages éphémères : la poire se remplit comme sous le doigt, puis le mode s'active (la bulle
// passe en pointillés et la conversation l'annonce).
function EphemeralDemo() {
  const colors = useColors();
  const styles = useStyles();
  const step = useCycle(STEPS, 650);
  const on = step >= 3;
  const normal = bubblePalette(colors.bubbleMine);
  const fleeting = ephemeralBubble(normal, colors);
  const palette = on ? fleeting : normal;
  return (
    <PhoneFrame>
      <View style={[styles.bubble, styles.outlined, { backgroundColor: palette.background, borderColor: on ? fleeting.border : normal.background }, on && styles.dashed]}>
        <Text style={{ color: palette.text, fontSize: 14 }}>OK</Text>
      </View>
      <Fade shown={on}>
        <View style={styles.system}>
          <Pear height={12} color={colors.signatureStrong} />
          <Text style={styles.systemText}>{t('ephemere.apercuActive')}</Text>
        </View>
      </Fade>
      <Fade shown={!on && step > 0}>
        <View style={styles.centered}>
          <Pear height={32} color={colors.text} state="ripening" progress={on ? 1 : step / 2} />
        </View>
      </Fade>
    </PhoneFrame>
  );
}

// Vue unique : la photo attend, puis elle a été ouverte et ne se rouvre plus.
function OnceDemo() {
  const colors = useColors();
  const styles = useStyles();
  const opened = useCycle([false, false, true], 1300);
  const palette = bubblePalette(colors.bubbleTheirs);
  const badge = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(badge, { toValue: opened ? 0.45 : 1, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [opened, badge]);
  return (
    <PhoneFrame>
      <View style={[styles.bubble, styles.once, { backgroundColor: palette.background }]}>
        <Animated.View style={[styles.onceBadge, { borderColor: palette.text, opacity: badge }]}>
          <Text style={[styles.onceDigit, { color: palette.text }]}>1</Text>
        </Animated.View>
        <View>
          <Text style={{ color: palette.text, fontSize: 14, fontWeight: '500' }}>{t('unique.photo')}</Text>
          <Text style={{ color: palette.muted, fontSize: 12 }}>{opened ? t('unique.ouverte') : t('unique.voir')}</Text>
        </View>
      </View>
    </PhoneFrame>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const CUT_RADIUS = 46;
const CUT_LENGTH = 2 * Math.PI * CUT_RADIUS;

// Stickers : le doigt entoure le sujet, puis le sticker se détache, un peu plus grand.
function StickerDemo() {
  const colors = useColors();
  const styles = useStyles();
  const cut = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (motion.reduced) {
      cut.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cut, { toValue: 1, duration: 1100, easing: motion.easing, useNativeDriver: false }),
        Animated.timing(lift, { toValue: 1, duration: motion.mascot, easing: motion.easing, useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(lift, { toValue: 0, duration: motion.small, easing: motion.easing, useNativeDriver: true }),
        Animated.timing(cut, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(300),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cut, lift]);
  return (
    <PhoneFrame>
      <View style={styles.cutArea}>
        <Animated.View style={[styles.cutLine, { opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          <Svg width={110} height={110} viewBox="0 0 110 110">
            <AnimatedCircle
              cx={55}
              cy={55}
              r={CUT_RADIUS}
              fill="none"
              stroke={colors.signatureStrong}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={CUT_LENGTH}
              strokeDashoffset={cut.interpolate({ inputRange: [0, 1], outputRange: [CUT_LENGTH, 0] })}
              transform="rotate(-90 55 55)"
            />
          </Svg>
        </Animated.View>
        <Animated.View style={{ transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }}>
          <Pear height={62} color={colors.text} />
        </Animated.View>
      </View>
    </PhoneFrame>
  );
}

const BITES = [0, 0.34, 0.68, 1, 1, 0];

// Tirer pour actualiser : une bouchée par tiers du geste, puis la poire se reforme.
function RefreshDemo() {
  const colors = useColors();
  const styles = useStyles();
  const progress = useCycle(BITES, 600);
  return (
    <PhoneFrame>
      <View style={styles.centered}>
        <Pear height={56} color={colors.text} state={progress > 0 ? 'bitten' : 'idle'} progress={progress} />
      </View>
      <View style={styles.lines}>
        <View style={styles.line} />
        <View style={[styles.line, styles.lineShort]} />
      </View>
    </PhoneFrame>
  );
}

// Nom de démo (champ `demo` de release-notes.json) → composant.
export const DEMOS: Record<string, ComponentType> = {
  lu: ReadDemo,
  ecrit: TypingDemo,
  signature: SignatureDemo,
  recherche: SearchDemo,
  ephemere: EphemeralDemo,
  unique: OnceDemo,
  stickers: StickerDemo,
  actualiser: RefreshDemo,
};

const useStyles = createStyles((colors) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  fieldText: {
    fontSize: 14,
    color: colors.text,
  },
  caret: {
    width: 1.5,
    height: 16,
    marginLeft: -4,
    backgroundColor: colors.signatureStrong,
  },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  hitAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  hitText: {
    fontSize: 15,
    color: colors.text,
  },
  hitMatch: {
    fontWeight: '700',
  },
  outlined: {
    borderWidth: 1.5,
  },
  dashed: {
    borderStyle: 'dashed',
  },
  system: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  systemText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  centered: {
    alignItems: 'center',
  },
  once: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  onceBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    borderWidth: 1.75,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceDigit: {
    fontSize: 13,
    fontWeight: '700',
  },
  cutArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
  },
  cutLine: {
    position: 'absolute',
  },
  lines: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  line: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  lineShort: {
    width: '60%',
  },
  bubble: {
    alignSelf: 'flex-end',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  meta: {
    alignItems: 'flex-end',
    marginTop: 2,
  },
}));
