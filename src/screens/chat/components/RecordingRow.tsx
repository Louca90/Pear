import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { cancelAnimation, Easing, FadeIn, FadeInRight, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { ArrowUp, Check, Pause, Play, Square, Trash2 } from 'lucide-react-native';

import { createStyles, radius, spacing, useColors } from '../../../theme';

import { VOICE_DOT_MS } from '../constants';
import { formatClock } from '../format';
import { LIVE_BARS, VoicePhase } from '../hooks/useVoiceRecorder';
import { t } from '../../../i18n';
import { Waveform } from './Waveform';

const BAR_HEIGHT = 52;
const WAVE_HEIGHT = 30;
const LIVE_BAR_WIDTH = 3;

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
  discard: () => void;
};

// La barre d'un vocal en cours (planche « Vocal ») : elle s'étire depuis le micro et recouvre le champ.
// De gauche à droite : poubelle, pause / lecture, onde (en direct, puis la relecture), point, chrono.
// Les couleurs suivent l'état : rouge en enregistrement, grise en pause et en relecture, verte pour la
// partie écoutée ou envoyée. Tout s'anime sur Reanimated, sans rebond.
export function RecordingRow({ voice }: { voice: Voice }) {
  const colors = useColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const { phase } = voice;
  const live = phase === 'recording' || phase === 'paused';
  const sending = phase === 'sending' || phase === 'sent';
  const blink = useSharedValue(1);
  const tint = useSharedValue(live ? 1 : 0);

  useEffect(() => {
    if (reduced || phase !== 'recording') {
      cancelAnimation(blink);
      blink.set(withTiming(phase === 'recording' ? 1 : 0.35, { duration: 200 }));
      return;
    }
    blink.set(withRepeat(withSequence(withTiming(0.25, { duration: VOICE_DOT_MS, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: VOICE_DOT_MS, easing: Easing.inOut(Easing.ease) })), -1));
    return () => cancelAnimation(blink);
  }, [phase, reduced, blink]);

  // La teinte rose du côté droit pâlit en pause et s'efface à l'arrêt.
  useEffect(() => {
    tint.set(withTiming(phase === 'recording' ? 1 : phase === 'paused' ? 0.4 : 0, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [phase, tint]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.get() }));
  const dotColor = phase === 'paused' ? colors.disabled : colors.danger;
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.get() }));
  const dim = sending ? styles.dim : null;

  const main =
    phase === 'recording' ? (
      <ControlButton label={t('vocal.pause')} onPress={voice.pause}>
        <Pause size={18} color={colors.text} strokeWidth={2} />
      </ControlButton>
    ) : phase === 'paused' ? (
      <ControlButton label={t('vocal.reprendre')} onPress={voice.resume}>
        <Play size={18} color={colors.text} strokeWidth={2} />
      </ControlButton>
    ) : phase === 'playing' ? (
      <ControlButton label={t('vocal.pause')} onPress={voice.pausePlay} disabled={sending}>
        <Pause size={18} color={colors.text} strokeWidth={2} />
      </ControlButton>
    ) : (
      <ControlButton label={t('vocal.ecouter')} onPress={voice.play} disabled={sending}>
        <Play size={18} color={colors.text} strokeWidth={2} />
      </ControlButton>
    );

  return (
    <Reanimated.View entering={reduced ? FadeIn.duration(150) : FadeInRight.duration(260).easing(Easing.out(Easing.cubic))} style={styles.row}>
      <Reanimated.View pointerEvents="none" style={[styles.tint, tintStyle]} />
      <Pressable onPress={voice.discard} disabled={sending} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('chat.supprimerVocal')} style={[styles.trash, dim]}>
        <Trash2 size={20} color={colors.danger} strokeWidth={1.75} />
      </Pressable>
      <View style={dim}>{main}</View>
      <View style={styles.wave}>
        {live ? (
          <LiveWave bars={voice.bars} color={phase === 'recording' ? colors.danger : colors.disabled} />
        ) : (
          <Waveform
            bars={voice.bars}
            position={sending ? (phase === 'sent' ? 1 : voice.position) : voice.position}
            color={colors.signatureStrong}
            restColor={colors.disabled}
            label={t('chat.deplacerVocal')}
            onSeek={() => {}}
          />
        )}
      </View>
      <Reanimated.View style={[styles.dot, { backgroundColor: dotColor }, live ? dotStyle : styles.dotHidden]} />
      <Text style={styles.time} accessibilityLabel={live ? undefined : formatClock(voice.totalSeconds)}>
        {formatClock(live || phase === 'playing' ? voice.seconds : voice.totalSeconds)}
      </Text>
    </Reanimated.View>
  );
}

// L'onde en direct : chaque nouveau niveau du micro arrive à droite et pousse les autres vers la gauche.
function LiveWave({ bars, color }: { bars: number[]; color: string }) {
  return (
    <View style={localStyles.live} pointerEvents="none">
      {bars.slice(-LIVE_BARS).map((level, index) => (
        <View key={index} style={[localStyles.liveBar, { height: 3 + level * (WAVE_HEIGHT - 3), backgroundColor: color }]} />
      ))}
    </View>
  );
}

function ControlButton({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

// Le bouton rond à droite de la barre : rouge avec un carré « arrêter » pendant l'enregistrement, vert
// avec une flèche « envoyer » en relecture, un anneau pendant l'envoi, puis une coche.
export function VoiceActionButton({ phase, onStop, onSend }: { phase: VoicePhase; onStop: () => void; onSend: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const tone = useSharedValue(0);
  useEffect(() => {
    tone.set(withTiming(phase === 'recording' || phase === 'paused' ? 0 : 1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [phase, tone]);
  const background = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(tone.get(), [0, 1], [colors.danger, colors.signatureStrong]) }));
  const recording = phase === 'recording' || phase === 'paused';
  const label = recording ? t('vocal.arreter') : t('chat.envoyerVocal');
  return (
    <Pressable onPress={recording ? onStop : onSend} disabled={phase === 'sending' || phase === 'sent'} accessibilityRole="button" accessibilityLabel={label} style={styles.action}>
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.actionFill, background]} />
      <Reanimated.View key={phase === 'recording' || phase === 'paused' ? 'stop' : phase === 'sending' ? 'ring' : phase === 'sent' ? 'check' : 'send'} entering={FadeIn.duration(180)} style={styles.actionIcon}>
        {recording ? (
          <Square size={16} color="#FFFFFF" fill="#FFFFFF" strokeWidth={2} />
        ) : phase === 'sending' ? (
          <ActivityIndicator size="small" color={colors.onSignature} />
        ) : phase === 'sent' ? (
          <Check size={22} color={colors.onSignature} strokeWidth={2.5} />
        ) : (
          <ArrowUp size={22} color={colors.onSignature} strokeWidth={2.2} />
        )}
      </Reanimated.View>
    </Pressable>
  );
}

const localStyles = StyleSheet.create({
  live: {
    flex: 1,
    height: WAVE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    overflow: 'hidden',
  },
  liveBar: {
    width: LIVE_BAR_WIDTH,
    borderRadius: LIVE_BAR_WIDTH / 2,
  },
});

const useStyles = createStyles((colors) => ({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: BAR_HEIGHT,
    paddingHorizontal: spacing.sm,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  // Un léger fond rose du côté droit pendant l'enregistrement.
  tint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '55%',
    backgroundColor: colors.dangerSoft,
    opacity: 0,
  },
  trash: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  control: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: {
    flex: 1,
    height: WAVE_HEIGHT,
    justifyContent: 'center',
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: radius.full,
  },
  dotHidden: {
    opacity: 0,
  },
  time: {
    minWidth: 38,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  dim: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFill: {
    borderRadius: radius.full,
  },
  actionIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
