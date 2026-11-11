import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Linking, PanResponder } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { haptics } from '../../../haptics';
import { encodeWave } from '../../../chat/meta';

import { showDialog } from '../../../components/dialog';

import { VOICE_CANCEL_DISTANCE, VOICE_LOCK_DISTANCE, VOICE_MIN_MS } from '../constants';
import { t } from '../../../i18n';

// Maintenir le micro enregistre, lâcher envoie. Glisser à gauche annule, glisser vers le haut verrouille :
// le doigt est alors libre, et on choisit ensuite d'envoyer ou de supprimer.
// Le niveau du micro est relevé 10 fois par seconde : il dessine la forme d'onde envoyée avec le vocal.
const LEVEL_EVERY_MS = 100;
const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

export function useVoiceRecorder(onRecorded: (uri: string, seconds: number, wave?: string) => void, onTooShort: () => void) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const levels = useRef<number[]>([]);
  const [phase, setPhase] = useState<'idle' | 'holding' | 'locked'>('idle');
  const [seconds, setSeconds] = useState(0);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const lockProgress = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const phaseRef = useRef<'idle' | 'holding' | 'locked'>('idle');
  const startedAt = useRef(0);
  const fingerDown = useRef(false);
  const overCancel = useRef(false);
  const tapWhileLocked = useRef(false);

  const changePhase = (next: 'idle' | 'holding' | 'locked') => {
    phaseRef.current = next;
    setPhase(next);
  };

  const settle = (value: Animated.Value, toValue: number) =>
    Animated.spring(value, { toValue, useNativeDriver: true, overshootClamping: true, damping: 15, stiffness: 240 }).start();

  useEffect(() => {
    if (phase === 'idle') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    const meter = setInterval(() => {
      try {
        const level = recorder.getStatus().metering;
        if (typeof level === 'number') levels.current.push(level);
      } catch {
        // Enregistreur arrêté entre-temps : rien à relever.
      }
    }, LEVEL_EVERY_MS);
    return () => {
      clearInterval(timer);
      clearInterval(meter);
    };
  }, [phase === 'idle']);

  const begin = async () => {
    overCancel.current = false;
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        showDialog(t('chat.microRefuse'), t('chat.microRefuseAide'), [
          { label: t('commun.ouvrirReglages'), onPress: () => Linking.openSettings() },
          { label: t('commun.annuler'), style: 'cancel' },
        ]);
        return;
      }
      // Le doigt a pu se lever pendant la demande d'autorisation : dans ce cas, rien ne s'enregistre.
      if (!fingerDown.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!fingerDown.current) return;
      recorder.record();
      levels.current = [];
      startedAt.current = Date.now();
      changePhase('holding');
      haptics.action();
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  const stop = async (send: boolean) => {
    const duration = Date.now() - startedAt.current;
    changePhase('idle');
    settle(dragX, 0);
    settle(dragY, 0);
    settle(lockProgress, 0);
    settle(scale, 1);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!send) return;
      if (duration < VOICE_MIN_MS) onTooShort();
      else if (recorder.uri) onRecorded(recorder.uri, Math.round(duration / 1000), encodeWave(levels.current));
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  const press = () => {
    fingerDown.current = true;
    if (phaseRef.current === 'locked') {
      tapWhileLocked.current = true;
      return;
    }
    settle(scale, 1.3);
    begin();
  };

  const move = (dx: number, dy: number) => {
    if (phaseRef.current !== 'holding') return;
    // Un seul axe à la fois : soit vers la poubelle, soit vers le cadenas.
    const sideways = Math.abs(dx) >= Math.abs(dy);
    dragX.setValue(sideways ? Math.min(0, dx) : 0);
    dragY.setValue(sideways ? 0 : Math.min(0, dy));
    const cancelling = sideways && dx < -VOICE_CANCEL_DISTANCE;
    if (cancelling !== overCancel.current) {
      overCancel.current = cancelling;
      if (cancelling) haptics.select();
    }
    if (!sideways && dy < -VOICE_LOCK_DISTANCE) {
      changePhase('locked');
      overCancel.current = false;
      haptics.action();
      settle(dragX, 0);
      settle(dragY, 0);
      settle(scale, 1);
      settle(lockProgress, 1);
    }
  };

  const release = () => {
    fingerDown.current = false;
    if (phaseRef.current === 'locked') {
      if (tapWhileLocked.current) {
        tapWhileLocked.current = false;
        stop(true);
      }
      return;
    }
    if (phaseRef.current === 'holding') {
      stop(!overCancel.current);
    } else {
      settle(scale, 1);
      onTooShort();
    }
  };

  const latest = useRef({ press, move, release });
  latest.current = { press, move, release };
  const panHandlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        Keyboard.dismiss();
        latest.current.press();
      },
      onPanResponderMove: (_event, { dx, dy }) => latest.current.move(dx, dy),
      onPanResponderRelease: () => latest.current.release(),
      onPanResponderTerminate: () => latest.current.release(),
    }),
  ).current.panHandlers;

  return { phase, seconds, dragX, dragY, lockProgress, scale, panHandlers, discard: () => stop(false) };
}
