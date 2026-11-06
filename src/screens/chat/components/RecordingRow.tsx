import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Lock, Trash2 } from 'lucide-react-native';

import { IconButton } from '../../../components/ui';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { VOICE_CANCEL_DISTANCE, VOICE_DOT_MS } from '../constants';
import { formatClock } from '../format';
import { t } from '../../../i18n';

// Le texte passe en fondu de l'un à l'autre, au fil du glissé.
export function RecordingRow({ seconds, locked, dragX, onDiscard }: { seconds: number; locked: boolean; dragX: Animated.Value; onDiscard: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const pulse = useRef(new Animated.Value(1)).current;
  const lockAppear = useRef(new Animated.Value(0)).current;
  const cancelRange = { inputRange: [-VOICE_CANCEL_DISTANCE, -VOICE_CANCEL_DISTANCE * 0.5], extrapolate: 'clamp' as const };

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: VOICE_DOT_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: VOICE_DOT_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    Animated.spring(lockAppear, { toValue: locked ? 1 : 0, useNativeDriver: true, damping: 12, stiffness: 240 }).start();
  }, [locked, lockAppear]);

  return (
    <View style={styles.recordingRow}>
      {locked && (
        <IconButton onPress={onDiscard} label={t('chat.supprimerVocal')} hitSlop={8}>
          <Trash2 size={20} color={colors.danger} strokeWidth={1.75} />
        </IconButton>
      )}
      <Animated.View style={[styles.recordingDot, { opacity: pulse }]} />
      <Text style={styles.recordingTime}>{formatClock(seconds)}</Text>
      {locked ? (
        <Animated.View style={[styles.recordingLock, { opacity: lockAppear, transform: [{ scale: lockAppear }] }]} accessibilityLabel={t('chat.vocalVerrouille')}>
          <Lock size={18} color={colors.text} strokeWidth={1.75} />
        </Animated.View>
      ) : (
        <View style={styles.recordingHints}>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.recordingHint,
              {
                opacity: dragX.interpolate({ ...cancelRange, outputRange: [0, 1] }),
                transform: [{ translateX: dragX.interpolate({ ...cancelRange, outputRange: [-14, 0] }) }],
              },
            ]}
          >
            {t('chat.glisserAnnuler')}
          </Animated.Text>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.recordingHint,
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

const useStyles = createStyles((colors) => ({
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
  },
  recordingTime: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  recordingLock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  recordingHints: {
    flex: 1,
    height: 20,
  },
  recordingHint: {
    ...StyleSheet.absoluteFill,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'right',
  },
}));
