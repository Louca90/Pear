import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Linking } from 'react-native';
import { Easing, ReduceMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { AudioPlayer, createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';

import { encodeWave } from '../../../chat/meta';
import { showDialog } from '../../../components/dialog';
import { haptics } from '../../../haptics';
import { t } from '../../../i18n';
import { VOICE_MIN_MS } from '../constants';

// Le micro grossit un peu quand on le maintient, puis revient, sans dépasser.
const SETTLE = { duration: 200, easing: Easing.bezier(0.2, 0.8, 0.2, 1), reduceMotion: ReduceMotion.System };

// Enregistrement d'un vocal : un appui sur le micro lance l'enregistrement. Phases : idle → recording ⇄ paused → review ⇄ playing → sending → sent.
// Le niveau du micro est relevé 10 fois par seconde : c'est la forme d'onde, en direct puis envoyée.
const LEVEL_EVERY_MS = 100;
const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
// Combien de barres de l'onde en direct, et de la relecture.
export const LIVE_BARS = 30;
// Sous cette durée, supprimer ne demande pas de confirmation.
const CONFIRM_AFTER_MS = 5000;
const SENT_MS = 1500;

export type VoicePhase = 'idle' | 'recording' | 'paused' | 'review' | 'playing' | 'sending' | 'sent';

const levelToRatio = (level: number) => Math.max(0, Math.min(1, (level + 50) / 50));

// Les niveaux de tout l'enregistrement, ramenés à LIVE_BARS barres de 0 à 1 (le plus fort de chaque tranche).
export function reduceLevels(levels: number[], count = LIVE_BARS): number[] {
  if (levels.length === 0) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, bar) => {
    const from = Math.floor((bar * levels.length) / count);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / count));
    let peak = -160;
    for (let index = from; index < to && index < levels.length; index += 1) peak = Math.max(peak, levels[index]);
    return levelToRatio(peak);
  });
}

export function useVoiceRecorder(onRecorded: (uri: string, seconds: number, wave?: string) => Promise<boolean | void> | void, onTooShort: () => void) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const levels = useRef<number[]>([]);
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const phaseRef = useRef<VoicePhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(() => reduceLevels([]));
  const [position, setPosition] = useState(0);
  const scale = useSharedValue(1);
  const segmentStart = useRef(0);
  const doneMs = useRef(0);
  const fileUri = useRef<string | null>(null);
  const totalMs = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhase = (next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const recordedMs = () => doneMs.current + (phaseRef.current === 'recording' ? Date.now() - segmentStart.current : 0);

  // Pendant l'enregistrement : le chrono et le niveau du micro (un seul minuteur).
  useEffect(() => {
    if (phase !== 'recording') return;
    const meter = setInterval(() => {
      setElapsed(recordedMs());
      try {
        const level = recorder.getStatus().metering;
        if (typeof level === 'number') {
          levels.current.push(level);
          setBars((current) => [...current.slice(1), levelToRatio(level)]);
        }
      } catch {
        // Enregistreur arrêté entre-temps : rien à relever.
      }
    }, LEVEL_EVERY_MS);
    return () => clearInterval(meter);
  }, [phase]);

  // Pendant l'écoute : l'avancement, relevé dans le lecteur.
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = setInterval(() => {
      const current = player.current;
      if (!current) return;
      const total = current.duration > 0 ? current.duration : totalMs.current / 1000;
      setPosition(total > 0 ? Math.min(1, current.currentTime / total) : 0);
      if (!current.playing && current.currentTime >= total - 0.05) {
        // Fin de l'écoute : retour en relecture, au début.
        current.seekTo(0).catch(() => {});
        setPosition(0);
        setPhase('review');
      }
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  const releasePlayer = () => {
    try {
      player.current?.remove();
    } catch {
      // Déjà libéré.
    }
    player.current = null;
  };

  // Tout se range quand on quitte la conversation.
  useEffect(
    () => () => {
      releasePlayer();
      if (sentTimer.current) clearTimeout(sentTimer.current);
    },
    [],
  );

  const reset = () => {
    scale.set(1);
    releasePlayer();
    levels.current = [];
    doneMs.current = 0;
    totalMs.current = 0;
    fileUri.current = null;
    setElapsed(0);
    setPosition(0);
    setBars(reduceLevels([]));
    setPhase('idle');
  };

  const begin = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        showDialog(t('chat.microRefuse'), t('chat.microRefuseAide'), [
          { label: t('commun.ouvrirReglages'), onPress: () => Linking.openSettings() },
          { label: t('commun.annuler'), style: 'cancel' },
        ]);
        scale.set(withTiming(1, SETTLE));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      levels.current = [];
      doneMs.current = 0;
      segmentStart.current = Date.now();
      setBars(reduceLevels([]));
      setElapsed(0);
      setPhase('recording');
      haptics.action();
      // Le micro quitte l'écran pendant l'enregistrement : il reprend sa taille tout de suite.
      scale.set(1);
    } catch (e) {
      scale.set(withTiming(1, SETTLE));
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  const pause = () => {
    if (phaseRef.current !== 'recording') return;
    doneMs.current += Date.now() - segmentStart.current;
    try {
      recorder.pause();
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
    setElapsed(doneMs.current);
    setPhase('paused');
    haptics.select();
  };

  const resume = () => {
    if (phaseRef.current !== 'paused') return;
    try {
      recorder.record();
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
      return;
    }
    segmentStart.current = Date.now();
    setPhase('recording');
    haptics.select();
  };

  // Arrête l'enregistrement : le vocal reste sur le téléphone, on peut le réécouter avant de l'envoyer.
  const stop = async () => {
    if (phaseRef.current !== 'recording' && phaseRef.current !== 'paused') return;
    const duration = recordedMs();
    doneMs.current = duration;
    totalMs.current = duration;
    setPhase('review');
    setElapsed(duration);
    haptics.action();
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (duration < VOICE_MIN_MS) {
        reset();
        onTooShort();
        return;
      }
      fileUri.current = recorder.uri;
      setBars(reduceLevels(levels.current));
    } catch (e) {
      reset();
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  const play = () => {
    if (phaseRef.current !== 'review' || !fileUri.current) return;
    try {
      player.current ??= createAudioPlayer(fileUri.current, { updateInterval: 100 });
      player.current.play();
      setPhase('playing');
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  // Le bouton lecture pendant l'enregistrement : l'enregistrement s'arrête, puis le vocal se fait écouter.
  const stopAndListen = async () => {
    if (phaseRef.current !== 'recording' && phaseRef.current !== 'paused') return;
    await stop();
    play();
  };

  const pausePlay = () => {
    if (phaseRef.current !== 'playing') return;
    player.current?.pause();
    setPhase('review');
  };

  const send = async () => {
    if (phaseRef.current !== 'review' && phaseRef.current !== 'playing') return;
    const uri = fileUri.current;
    if (!uri) return;
    player.current?.pause();
    setPhase('sending');
    haptics.action();
    try {
      const ok = await onRecorded(uri, Math.round(totalMs.current / 1000), encodeWave(levels.current));
      if (ok === false) {
        // L'envoi a échoué : le vocal n'est pas perdu, on revient à la relecture.
        setPhase('review');
        return;
      }
      setPhase('sent');
      haptics.success();
      sentTimer.current = setTimeout(reset, SENT_MS);
    } catch {
      setPhase('review');
    }
  };

  const discardNow = async () => {
    try {
      if (phaseRef.current === 'recording' || phaseRef.current === 'paused') await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      // Rien à arrêter.
    }
    reset();
  };

  // Supprimer : sans question pour un vocal de moins de 5 s, avec une courte confirmation sinon.
  const discard = () => {
    const phaseNow = phaseRef.current;
    if (phaseNow === 'idle' || phaseNow === 'sending' || phaseNow === 'sent') return;
    const long = (phaseNow === 'recording' || phaseNow === 'paused' ? recordedMs() : totalMs.current) >= CONFIRM_AFTER_MS;
    if (!long) {
      discardNow();
      return;
    }
    showDialog(t('vocal.supprimerQuestion'), t('vocal.supprimerAide'), [
      { label: t('commun.supprimer'), style: 'danger', onPress: discardNow },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  // L'app passe en arrière-plan ou l'écran se verrouille : l'enregistrement se met en pause, rien ne se perd.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      if (phaseRef.current === 'recording') pause();
      else if (phaseRef.current === 'playing') pausePlay();
    });
    return () => subscription.remove();
  }, []);

  // Un appui sur le micro lance l'enregistrement ; il grossit à peine sous le doigt.
  const pressIn = () => {
    if (phaseRef.current === 'idle') scale.set(withTiming(1.12, SETTLE));
  };
  const pressOut = () => scale.set(withTiming(1, SETTLE));
  const start = () => {
    if (phaseRef.current !== 'idle') return;
    Keyboard.dismiss();
    begin();
  };

  return { phase, seconds: Math.round((phase === 'playing' ? position * totalMs.current : elapsed) / 1000), totalSeconds: Math.round(totalMs.current / 1000), bars, position, scale, pressIn, pressOut, start, pause, resume, stop, stopAndListen, play, pausePlay, send, discard };
}
