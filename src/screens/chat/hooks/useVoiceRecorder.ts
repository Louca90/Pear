import { useEffect, useRef, useState } from 'react';
import { Keyboard, Linking } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import { Easing, ReduceMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { haptics } from '../../../haptics';
import { encodeWave } from '../../../chat/meta';

import { showDialog } from '../../../components/dialog';

import { VOICE_CANCEL_DISTANCE, VOICE_LOCK_DISTANCE, VOICE_MIN_MS } from '../constants';
import { t } from '../../../i18n';

// Le micro revient à sa place (ou grossit) en douceur, sans dépasser.
const SETTLE = { duration: 200, easing: Easing.bezier(0.2, 0.8, 0.2, 1), reduceMotion: ReduceMotion.System };

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
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const lockProgress = useSharedValue(0);
  const scale = useSharedValue(1);
  const liveLevel = useSharedValue(0);
  const phaseRef = useRef<'idle' | 'holding' | 'locked'>('idle');
  const startedAt = useRef(0);
  const fingerDown = useRef(false);
  const overCancel = useRef(false);
  const tapWhileLocked = useRef(false);

  const changePhase = (next: 'idle' | 'holding' | 'locked') => {
    phaseRef.current = next;
    setPhase(next);
  };

  const settle = (value: SharedValue<number>, toValue: number) => value.set(withTiming(toValue, SETTLE));

  useEffect(() => {
    if (phase === 'idle') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    const meter = setInterval(() => {
      try {
        const level = recorder.getStatus().metering;
        if (typeof level === 'number') {
          levels.current.push(level);
          // Niveau affiché par l'onde « en direct » (RecordingRow) : -50 dB ou moins = silence, 0 dB = plein.
          liveLevel.set(withTiming(Math.max(0, Math.min(1, (level + 50) / 50)), { duration: LEVEL_EVERY_MS, easing: Easing.linear }));
        }
      } catch {
        // Enregistreur arrêté entre-temps : rien à relever.
      }
    }, LEVEL_EVERY_MS);
    return () => {
      clearInterval(timer);
      clearInterval(meter);
      liveLevel.set(0);
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
    dragX.set(sideways ? Math.min(0, dx) : 0);
    dragY.set(sideways ? 0 : Math.min(0, dy));
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

  // Le geste (gesture-handler) : le doigt posé démarre, ses déplacements glissent vers la poubelle ou
  // le cadenas, le doigt levé (ou le geste interrompu) termine. La logique reste en JS (autorisation,
  // enregistreur, vibrations) ; le micro suit le doigt par des valeurs Reanimated.
  const latest = useRef({ press, move, release });
  latest.current = { press, move, release };
  const gesture = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    onBegin: () => {
      Keyboard.dismiss();
      latest.current.press();
    },
    onUpdate: (event) => latest.current.move(event.translationX, event.translationY),
    onFinalize: () => latest.current.release(),
  });

  return { phase, seconds, dragX, dragY, lockProgress, scale, liveLevel, gesture, discard: () => stop(false) };
}
