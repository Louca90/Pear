import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Pause, Play, Trash2 } from 'lucide-react-native';

import { createStyles, fixed, radius, useColors } from '../../../theme';

import { VOICE_DOT_MS } from '../constants';
import { formatClock } from '../format';
import { LIVE_BARS, VoicePhase } from '../hooks/useVoiceRecorder';
import { t } from '../../../i18n';

// La barre d'un vocal (planche « Vocal · enregistrer, écouter, envoyer (animé) ») : le micro s'étire en
// pilule vers la gauche, le bouton reste dedans (rouge en enregistrement, vert ensuite). De gauche à
// droite : poubelle, pause / lecture (rond blanc), onde, point, chrono, bouton. Le contenu apparaît
// après l'ouverture et s'efface avant la fermeture. Courbes douces, jamais de rebond.
const HEIGHT = 52;
const BUTTON = 44;
const WAVE_HEIGHT = 28;
const BAR_WIDTH = 3;
const PLAYED_LIGHT = '#566E1C';
const PLAYED_DARK = '#B4CC68';
const OPEN_MS = 320;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
// Ordre de la planche : la barre s'ouvre (40 ms) avant son contenu (150 ms), la teinte à 80 ms, le point à 220 ms.
const DELAY = { bar: 40, tint: 80, content: 150, dot: 220 };

type Voice = {
  phase: VoicePhase;
  seconds: number;
  totalSeconds: number;
  bars: number[];
  position: number;
  pause: () => void;
  resume: () => void;
  play: () => void;
  pausePlay: () => void;
  stop: () => void;
  stopAndListen: () => void;
  send: () => void;
  discard: () => void;
};

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
const AnimatedPath = Reanimated.createAnimatedComponent(Path);

export function RecordingRow({ voice }: { voice: Voice }) {
  const colors = useColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const { phase } = voice;
  const recording = phase === 'recording';
  const live = recording || phase === 'paused';
  const sending = phase === 'sending';
  const sent = phase === 'sent';
  const [width, setWidth] = useState(0);

  const open = useSharedValue(0);
  const content = useSharedValue(0);
  const tint = useSharedValue(0);
  const tone = useSharedValue(0);
  const dot = useSharedValue(0);
  const blink = useSharedValue(1);
  const sweep = useSharedValue(1);
  const prog = useSharedValue(0);
  const stopO = useSharedValue(0);
  const arrowO = useSharedValue(0);
  const ringO = useSharedValue(0);
  const ring = useSharedValue(0);
  const checkO = useSharedValue(0);

  const timing = (ms: number, delay = 0) => (value: number) => (reduced ? withTiming(value, { duration: 120 }) : withDelay(delay, withTiming(value, { duration: ms, easing: EASE })));

  // Ouverture et fermeture de la pilule, apparition du contenu.
  useEffect(() => {
    const go = timing(OPEN_MS, sent ? 200 : DELAY.bar);
    open.set(go(sent ? 0 : 1));
    content.set(sent ? withTiming(0, { duration: 160 }) : timing(200, DELAY.content)(1));
  }, [sent]);

  useEffect(() => {
    tint.set(timing(260, recording || phase === 'paused' ? DELAY.tint : 0)(recording ? 1 : phase === 'paused' ? 0.5 : 0));
    dot.set(timing(200, live ? DELAY.dot : 0)(live ? 1 : 0));
    tone.set(timing(260)(live ? 0 : 1));
    stopO.set(timing(200)(live ? 1 : 0));
    arrowO.set(timing(200)(phase === 'review' || phase === 'playing' ? 1 : 0));
    ringO.set(timing(200)(sending ? 1 : 0));
    checkO.set(timing(240, sent ? 380 : 0)(sent ? 1 : 0));
    // L'onde passe du rouge au gris de gauche à droite (600 ms) à l'arrêt.
    if (phase === 'review') {
      sweep.set(0);
      sweep.set(withTiming(1, { duration: 600, easing: Easing.linear }));
    }
    // L'anneau avance pendant l'envoi, puis se remplit.
    if (sending) {
      ring.set(0.04);
      ring.set(withTiming(0.88, { duration: 5000, easing: Easing.out(Easing.quad) }));
    } else if (sent) ring.set(withTiming(1, { duration: 200 }));
    else ring.set(0);
  }, [phase]);

  useEffect(() => {
    if (reduced || phase !== 'recording') {
      cancelAnimation(blink);
      blink.set(withTiming(1, { duration: 160 }));
      return;
    }
    blink.set(withRepeat(withSequence(withTiming(0.3, { duration: VOICE_DOT_MS, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: VOICE_DOT_MS, easing: Easing.inOut(Easing.ease) })), -1));
    return () => cancelAnimation(blink);
  }, [phase, reduced, blink]);

  // La tête de lecture : l'avancement relevé dans le lecteur, lissé.
  useEffect(() => {
    prog.set(withTiming(sent ? 1 : voice.position, { duration: 110, easing: Easing.linear }));
  }, [voice.position, sent]);

  const pill = useAnimatedStyle(() => ({ width: BUTTON + 8 + (Math.max(0, width) - BUTTON - 8) * open.get() }));
  const bg = useAnimatedStyle(() => ({ opacity: interpolate(open.get(), [0, 0.15, 1], [0, 1, 1]) }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.get() }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.get() }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.get() * blink.get(), transform: [{ scale: 0.4 + 0.6 * dot.get() }] }));
  const button = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(tone.get(), [0, 1], [colors.danger, colors.signatureStrong]) }));
  const stopStyle = useAnimatedStyle(() => ({ opacity: stopO.get(), transform: [{ rotate: `${(1 - stopO.get()) * 90}deg` }, { scale: 0.4 + 0.6 * stopO.get() }] }));
  const arrowStyle = useAnimatedStyle(() => ({ opacity: arrowO.get(), transform: [{ translateY: (1 - arrowO.get()) * 8 }, { scale: 0.4 + 0.6 * arrowO.get() }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringO.get() }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, checkO.get() * 3), transform: [{ scale: 0.4 + 0.6 * checkO.get() }] }));
  const ringProps = useAnimatedProps(() => ({ strokeDasharray: `${Math.max(0.02, ring.get()) * 75.4} 75.4` }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: 19 * (1 - checkO.get()) }));
  const dim = sending || sent ? styles.dim : null;
  const played = colors.scheme === 'dark' ? PLAYED_DARK : PLAYED_LIGHT;

  const mainPress = live ? voice.stop : voice.send;
  const mainLabel = live ? t('vocal.arreter') : t('chat.envoyerVocal');
  // Lecture / pause sert à écouter le vocal, jamais à reprendre l'enregistrement : pendant l'enregistrement,
  // un appui l'arrête et fait écouter ce qui est enregistré.
  const playPress = live ? voice.stopAndListen : phase === 'playing' ? voice.pausePlay : voice.play;
  const playLabel = phase === 'playing' ? t('vocal.pause') : t('vocal.ecouter');
  const showPause = phase === 'playing';

  return (
    <View style={styles.area} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Reanimated.View style={[styles.pill, pill]}>
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg, bg]} />
        {/* Le dégradé rose est dessiné à la taille finale, ancré à droite : la pilule le découvre en s'ouvrant. */}
        <Reanimated.View pointerEvents="none" style={[styles.tint, { width }, tintStyle]}>
          <Svg width={Math.max(1, width)} height={HEIGHT}>
            <Defs>
              <LinearGradient id="tint" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0.35" stopColor={colors.dangerSoft} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.dangerSoft} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={Math.max(1, width)} height={HEIGHT} fill="url(#tint)" />
          </Svg>
        </Reanimated.View>

        <Reanimated.View style={[styles.content, contentStyle]} pointerEvents={sent ? 'none' : 'auto'}>
          <Pressable onPress={voice.discard} disabled={sending || sent} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('chat.supprimerVocal')} style={[styles.trash, dim]}>
            <Trash2 size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={playPress} disabled={sending || sent} accessibilityRole="button" accessibilityLabel={playLabel} style={({ pressed }) => [styles.round, dim, pressed && styles.pressed]}>
            {showPause ? <Pause size={18} color={colors.text} fill={colors.text} strokeWidth={2} /> : <Play size={18} color={colors.text} fill={colors.text} strokeWidth={2} />}
          </Pressable>
          <View style={styles.wave}>
            <Wave bars={voice.bars} live={live} paused={phase === 'paused'} sweep={sweep} prog={prog} sending={sending || sent} played={played} />
          </View>
          <Reanimated.View style={[styles.dot, { backgroundColor: phase === 'paused' ? colors.disabled : colors.danger }, dotStyle]} />
          <Text style={styles.time} accessibilityLabel={live ? undefined : formatClock(voice.totalSeconds)}>
            {formatClock(live || phase === 'playing' ? voice.seconds : voice.totalSeconds)}
          </Text>
        </Reanimated.View>

        <Pressable onPress={mainPress} disabled={sending || sent} accessibilityRole="button" accessibilityLabel={mainLabel} style={styles.buttonWrap}>
          <Reanimated.View style={[styles.button, button]}>
            <Reanimated.View style={[styles.icon, stopStyle]}>
              <View style={styles.square} />
            </Reanimated.View>
            <Reanimated.View style={[styles.icon, arrowStyle]}>
              <Svg width={44} height={44} viewBox="0 0 44 44">
                <Path d="M22 30V14M15.5 20.5L22 14l6.5 6.5" fill="none" stroke={colors.onSignature} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Reanimated.View>
            <Reanimated.View style={[styles.icon, ringStyle]}>
              <Svg width={44} height={44} viewBox="0 0 44 44">
                <Circle cx={22} cy={22} r={12} fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth={2.4} />
                <AnimatedCircle cx={22} cy={22} r={12} fill="none" stroke={colors.onSignature} strokeWidth={2.4} strokeLinecap="round" transform="rotate(-90 22 22)" animatedProps={ringProps} />
                <Circle cx={22} cy={22} r={2.2} fill={colors.onSignature} />
              </Svg>
            </Reanimated.View>
            <Reanimated.View style={[styles.icon, checkStyle]}>
              <Svg width={44} height={44} viewBox="0 0 44 44">
                <AnimatedPath d="M15.5 22.5l4.5 4.5 8.5-9" fill="none" stroke={colors.onSignature} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="19 19" animatedProps={checkProps} />
              </Svg>
            </Reanimated.View>
          </Reanimated.View>
        </Pressable>
      </Reanimated.View>
    </View>
  );
}

// L'onde : en direct, chaque niveau du micro arrive à droite ; à l'arrêt, elle passe du rouge au gris de
// gauche à droite ; à l'écoute, ce qui est passé se colore ; à l'envoi, tout se remplit.
function Wave({ bars, live, paused, sweep, prog, sending, played }: { bars: number[]; live: boolean; paused: boolean; sweep: SharedValue<number>; prog: SharedValue<number>; sending: boolean; played: string }) {
  const colors = useColors();
  const list = bars.slice(-LIVE_BARS);
  return (
    <View style={localStyles.wave} pointerEvents="none">
      {list.map((level, index) => (
        <WaveBar key={index} index={index} count={list.length} level={level} live={live} paused={paused} sweep={sweep} prog={prog} sending={sending} red={colors.danger} grey={colors.disabled} played={played} />
      ))}
    </View>
  );
}

function WaveBar({ index, count, level, live, paused, sweep, prog, sending, red, grey, played }: { index: number; count: number; level: number; live: boolean; paused: boolean; sweep: SharedValue<number>; prog: SharedValue<number>; sending: boolean; red: string; grey: string; played: string }) {
  const style = useAnimatedStyle(() => {
    if (live) return { backgroundColor: red, opacity: paused ? 0.55 : 1 };
    const grey_ = interpolateColor(Math.max(0, Math.min(1, (sweep.get() * 1.4 - index / count) * 4)), [0, 1], [red, grey]);
    const done = (index + 0.5) / count <= prog.get() || (sending && prog.get() >= 0);
    return { backgroundColor: done && prog.get() > 0 ? played : grey_, opacity: 1 };
  });
  return <Reanimated.View style={[localStyles.bar, { height: 3 + level * (WAVE_HEIGHT - 4) }, style]} />;
}

const localStyles = StyleSheet.create({
  wave: {
    flex: 1,
    height: WAVE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    overflow: 'hidden',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
});

const useStyles = createStyles((colors) => ({
  area: {
    flex: 1,
    height: HEIGHT,
    alignItems: 'flex-end',
  },
  pill: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  bg: {
    backgroundColor: colors.surface,
  },
  tint: {
    position: 'absolute',
    top: 0,
    right: 0,
    height: HEIGHT,
  },
  content: {
    position: 'absolute',
    left: 6,
    right: BUTTON + 10,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trash: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0px 1px 3px ${colors.shadow}`,
  },
  wave: {
    flex: 1,
    height: WAVE_HEIGHT,
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  time: {
    minWidth: 36,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  buttonWrap: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: BUTTON,
    height: BUTTON,
  },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BUTTON,
    height: BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  square: {
    width: 11,
    height: 11,
    borderRadius: 2.6,
    backgroundColor: fixed.white,
  },
  dim: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
}));
