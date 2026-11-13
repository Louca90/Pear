import { useEffect } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Lock, Trash2 } from 'lucide-react-native';

import { IconButton } from '../../../components/ui';
import { popIn } from '../../../motion';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { VOICE_CANCEL_DISTANCE, VOICE_DOT_MS } from '../constants';
import { formatClock } from '../format';
import { t } from '../../../i18n';

// Onde « en direct » : des barres qui respirent et défilent vers la gauche. Le motif se répète toutes
// les PATTERN barres : quand le défilement revient à zéro (fin d'un tour d'horloge), rien ne saute.
const LIVE_BARS = 40;
const LIVE_BAR_WIDTH = 3;
const LIVE_BAR_GAP = 2;
const LIVE_HEIGHT = 24;
const PATTERN = 12;
const LIVE_LOOP_MS = 1200;
const NUDGE_MS = 800;
const NUDGE_DISTANCE = 6;
// Sans niveau du micro, l'onde garde une amplitude moyenne.
const DEFAULT_LEVEL = 0.6;

function LiveBar({ index, clock, level, color }: { index: number; clock: SharedValue<number>; level: SharedValue<number>; color: string }) {
  const slot = index % PATTERN;
  const phase = ((slot * 7) % PATTERN) / PATTERN;
  // Vitesse entière : la barre i et la barre i + PATTERN se retrouvent dans le même état à chaque tour.
  const turns = 1 + (slot % 2);
  const style = useAnimatedStyle(() => {
    const breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * (clock.get() * turns + phase));
    const amplitude = 0.3 + 0.7 * level.get();
    return { transform: [{ scaleY: 0.2 + 0.8 * amplitude * breath }] };
  });
  return <Reanimated.View style={[localStyles.liveBar, { backgroundColor: color }, style]} />;
}

function LiveWave({ level, color }: { level?: SharedValue<number>; color: string }) {
  const reduced = useReducedMotion();
  const clock = useSharedValue(0);
  const fallback = useSharedValue(DEFAULT_LEVEL);
  useEffect(() => {
    if (reduced) return;
    clock.set(withRepeat(withTiming(1, { duration: LIVE_LOOP_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(clock);
  }, [clock, reduced]);
  const scroll = useAnimatedStyle(() => ({ transform: [{ translateX: -clock.get() * PATTERN * (LIVE_BAR_WIDTH + LIVE_BAR_GAP) }] }));
  return (
    <View style={localStyles.liveFrame} pointerEvents="none">
      <Reanimated.View style={[localStyles.liveRow, scroll]}>
        {Array.from({ length: LIVE_BARS }, (_, index) => (
          <LiveBar key={index} index={index} clock={clock} level={level ?? fallback} color={color} />
        ))}
      </Reanimated.View>
    </View>
  );
}

// Ligne d'enregistrement d'un vocal (refonte, planche « Vocaux ») : point rouge qui clignote, chrono,
// onde en direct, puis « ‹ Annuler » qui se balance pour inviter à glisser. Au fil du glissé vers la
// gauche, l'onde s'efface et « Lâchez pour annuler » prend la place. Verrouillé : poubelle et cadenas.
export function RecordingRow({
  seconds,
  locked,
  dragX,
  level,
  onDiscard,
}: {
  seconds: number;
  locked: boolean;
  dragX: Animated.Value;
  // Niveau du micro de 0 à 1 (useVoiceRecorder → liveLevel) ; facultatif.
  level?: SharedValue<number>;
  onDiscard: () => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const blink = useSharedValue(1);
  const nudge = useSharedValue(0);
  const cancelRange = { inputRange: [-VOICE_CANCEL_DISTANCE, -VOICE_CANCEL_DISTANCE * 0.5], extrapolate: 'clamp' as const };

  useEffect(() => {
    if (reduced) return;
    blink.set(
      withRepeat(
        withSequence(
          withTiming(0.25, { duration: VOICE_DOT_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: VOICE_DOT_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(blink);
  }, [blink, reduced]);

  useEffect(() => {
    if (reduced || locked) {
      cancelAnimation(nudge);
      nudge.set(0);
      return;
    }
    nudge.set(
      withRepeat(
        withSequence(
          withTiming(-NUDGE_DISTANCE, { duration: NUDGE_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: NUDGE_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(nudge);
  }, [nudge, reduced, locked]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.get() }));
  const nudgeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.get() }] }));

  return (
    <View style={styles.recordingRow}>
      {locked && (
        <Reanimated.View entering={popIn()}>
          <IconButton onPress={onDiscard} label={t('chat.supprimerVocal')} hitSlop={8}>
            <Trash2 size={20} color={colors.danger} strokeWidth={1.75} />
          </IconButton>
        </Reanimated.View>
      )}
      <Reanimated.View style={[styles.recordingDot, dotStyle]} />
      <Text style={styles.recordingTime}>{formatClock(seconds)}</Text>
      <Animated.View style={[styles.wave, !locked && { opacity: dragX.interpolate({ ...cancelRange, outputRange: [0, 1] }) }]}>
        <LiveWave level={level} color={colors.text} />
      </Animated.View>
      {locked ? (
        <Reanimated.View entering={popIn()} style={styles.recordingLock} accessibilityLabel={t('chat.vocalVerrouille')}>
          <Lock size={18} color={colors.text} strokeWidth={1.75} />
        </Reanimated.View>
      ) : (
        <View style={styles.recordingHints} accessibilityLabel={t('chat.glisserAnnuler')}>
          <Animated.View
            style={{
              opacity: dragX.interpolate({ ...cancelRange, outputRange: [0, 1] }),
              transform: [{ translateX: dragX.interpolate({ ...cancelRange, outputRange: [-14, 0] }) }],
            }}
          >
            <Reanimated.Text numberOfLines={1} style={[styles.recordingHint, nudgeStyle]}>
              {t('vocal.annulerCourt')}
            </Reanimated.Text>
          </Animated.View>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.recordingHint,
              styles.releaseHint,
              { color: colors.danger },
              {
                opacity: dragX.interpolate({ ...cancelRange, outputRange: [1, 0] }),
                transform: [{ translateX: dragX.interpolate({ ...cancelRange, outputRange: [0, 14] }) }],
              },
            ]}
          >
            {t('chat.lacherAnnuler')}
          </Animated.Text>
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  liveFrame: {
    flex: 1,
    height: LIVE_HEIGHT,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LIVE_BAR_GAP,
    height: LIVE_HEIGHT,
  },
  liveBar: {
    width: LIVE_BAR_WIDTH,
    height: LIVE_HEIGHT,
    borderRadius: LIVE_BAR_WIDTH / 2,
  },
});

const useStyles = createStyles((colors) => ({
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  recordingDot: {
    width: 9,
    height: 9,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
  },
  recordingTime: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  wave: {
    flex: 1,
    height: LIVE_HEIGHT,
  },
  recordingLock: {
    alignItems: 'flex-end',
  },
  recordingHints: {
    height: 20,
    justifyContent: 'center',
  },
  recordingHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
  },
  releaseHint: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 200,
    textAlignVertical: 'center',
  },
}));
