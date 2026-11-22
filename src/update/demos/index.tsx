import { ComponentType, ReactNode, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Reanimated, { cancelAnimation, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { EASE } from '../../motion';
import Svg, { Circle } from 'react-native-svg';
import { Bell, Search } from 'lucide-react-native';

import { Pear } from '../../components/Pear';
import { Button } from '../../components/ui';
import { t } from '../../i18n';
import { StatusTicks } from '../../screens/chat/components/MessageMeta';
import { TypingBubble } from '../../screens/chat/components/TypingBubble';
import { bubblePalette, createStyles, ephemeralBubble, motion, radius, spacing, useColors } from '../../theme';
import { PhoneFrame } from './PhoneFrame';
import { DISCOVER_DEMOS } from './discover';
import { V19_DEMOS } from './v19';

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
  const opacity = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    opacity.set(withTiming(shown ? 1 : 0, { duration: motion.small, easing: EASE }));
  }, [shown, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
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
  const badge = useSharedValue(1);
  useEffect(() => {
    badge.set(withTiming(opened ? 0.45 : 1, { duration: motion.small, easing: EASE }));
  }, [opened, badge]);
  const badgeStyle = useAnimatedStyle(() => ({ opacity: badge.get() }));
  return (
    <PhoneFrame>
      <View style={[styles.bubble, styles.once, { backgroundColor: palette.background }]}>
        <Reanimated.View style={[styles.onceBadge, { borderColor: palette.text }, badgeStyle]}>
          <Text style={[styles.onceDigit, { color: palette.text }]}>1</Text>
        </Reanimated.View>
        <View>
          <Text style={{ color: palette.text, fontSize: 14, fontWeight: '500' }}>{t('unique.photo')}</Text>
          <Text style={{ color: palette.muted, fontSize: 12 }}>{opened ? t('unique.ouverte') : t('unique.voir')}</Text>
        </View>
      </View>
    </PhoneFrame>
  );
}

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
const CUT_RADIUS = 46;
const CUT_LENGTH = 2 * Math.PI * CUT_RADIUS;

// Stickers : le doigt entoure le sujet, puis le sticker se détache, un peu plus grand.
function StickerDemo() {
  const colors = useColors();
  const styles = useStyles();
  const cut = useSharedValue(0);
  const lift = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) {
      cut.set(1);
      return;
    }
    // Un cycle : le trait entoure (1,1 s), le sticker se détache, reste, revient, puis une courte pause.
    const ease = (duration: number) => ({ duration, easing: EASE });
    const now = { duration: 0 };
    const held = motion.mascot + 900 + motion.small;
    cut.set(withRepeat(withSequence(withTiming(1, ease(1100)), withDelay(held, withTiming(0, now)), withDelay(300, withTiming(0, now))), -1));
    lift.set(withRepeat(withSequence(withDelay(1100, withTiming(1, ease(motion.mascot))), withDelay(900, withTiming(0, ease(motion.small))), withDelay(300, withTiming(0, now))), -1));
    return () => {
      cancelAnimation(cut);
      cancelAnimation(lift);
    };
  }, [cut, lift]);
  const lineStyle = useAnimatedStyle(() => ({ opacity: 1 - lift.get() }));
  const stickerStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.18 * lift.get() }] }));
  const circleProps = useAnimatedProps(() => ({ strokeDashoffset: CUT_LENGTH * (1 - cut.get()) }));
  return (
    <PhoneFrame>
      <View style={styles.cutArea}>
        <Reanimated.View style={[styles.cutLine, lineStyle]}>
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
              animatedProps={circleProps}
              transform="rotate(-90 55 55)"
            />
          </Svg>
        </Reanimated.View>
        <Reanimated.View style={stickerStyle}>
          <Pear height={62} color={colors.text} />
        </Reanimated.View>
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
  ...DISCOVER_DEMOS,
  ...V19_DEMOS,
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
