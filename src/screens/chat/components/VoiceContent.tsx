import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioPlayer, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Reanimated, { interpolate, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { getSetting, Message, setSetting } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { useMediaUri } from '../../../chat/media';
import { decodeWave, parseMeta } from '../../../chat/meta';
import { PauseIcon, PlayIcon } from '../../../components/PlayIcon';
import { IconButton } from '../../../components/ui';
import { haptics } from '../../../haptics';
import { timing } from '../../../motion';
import { BubblePalette, radius, spacing } from '../../../theme';

import { SeekBar } from './SeekBar';
import { Waveform } from './Waveform';
import { MEDIA_WIDTH } from '../constants';
import { formatClock } from '../format';
import { useChatStyles } from '../styles';
import { log } from '../../../log';
import { t } from '../../../i18n';
import { useTransferProgress } from '../hooks/useTransferProgress';

// Un seul vocal à la fois : en lancer un met le précédent en pause.
let playingVoice: AudioPlayer | null = null;
// Vocaux affichés, par message : à la fin d'un vocal, le suivant (next) démarre tout seul.
const voices = new Map<string, () => void>();

// Vitesse de lecture (lot 4.2) : la même pour tous les vocaux, gardée d'un lancement à l'autre.
const RATES = [1, 1.5, 2];
const RATE_KEY = 'voice_rate';
let voiceRate: number | null = null;
const rateListeners = new Set<() => void>();

function currentRate() {
  if (voiceRate === null) {
    const saved = Number(getSetting(RATE_KEY));
    voiceRate = RATES.includes(saved) ? saved : 1;
  }
  return voiceRate;
}

function nextRate() {
  voiceRate = RATES[(RATES.indexOf(currentRate()) + 1) % RATES.length];
  setSetting(RATE_KEY, String(voiceRate));
  rateListeners.forEach((listener) => listener());
}

function useVoiceRate() {
  const [rate, setRate] = useState(currentRate);
  useEffect(() => {
    const listener = () => setRate(currentRate());
    rateListeners.add(listener);
    return () => {
      rateListeners.delete(listener);
    };
  }, []);
  return rate;
}

// Reprise de lecture (lot 4.2) : où l'on s'est arrêté dans chaque vocal (secondes), tant que l'app tourne.
// Un vocal écouté jusqu'au bout repart du début.
const resumeAt = new Map<string, number>();
const RESUME_MIN_SECONDS = 1;

const rateLabel = (rate: number) => `${String(rate).replace('.', ',')}×`;

export function VoiceContent({ message, palette, next }: { message: Message; palette: BubblePalette; next?: string }) {
  const styles = useStyles();
  // Vocal chiffré sur le disque (lot 2.3) : le lecteur lit sa copie déchiffrée.
  const source = useMediaUri(message.file_uri, { mime: message.file_mime });
  const player = useAudioPlayer(source, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  // L'avancement du transfert est lu ici : la bulle, elle, ne se redessine que si son message change.
  const progress = useTransferProgress(message.id);
  const rate = useVoiceRate();
  const bars = decodeWave(parseMeta(message.meta).wave);
  const position = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  // Pendant la lecture, la barre avance d'elle-même entre deux nouvelles du lecteur (vitesse comprise).
  const speed = progress === undefined && status.playing && status.duration > 0 ? rate / status.duration : 0;

  // La vitesse choisie s'applique à ce lecteur, tout de suite s'il est en train de lire.
  useEffect(() => {
    try {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(rate, 'high');
    } catch (e) {
      log.warn('vocal', e);
    }
  }, [player, rate, status.isLoaded]);

  // Reprise : le vocal chargé se replace là où on l'avait laissé.
  const resumed = useRef(false);
  useEffect(() => {
    if (!status.isLoaded || resumed.current) return;
    resumed.current = true;
    const at = resumeAt.get(message.id);
    if (at && status.duration > 0 && at < status.duration - RESUME_MIN_SECONDS) player.seekTo(at).catch((e) => log.warn('vocal', e));
  }, [status.isLoaded, status.duration, message.id, player]);
  useEffect(() => {
    if (!resumed.current) return;
    if (status.currentTime >= RESUME_MIN_SECONDS) resumeAt.set(message.id, status.currentTime);
  }, [status.currentTime, message.id]);

  const start = () => {
    if (playingVoice && playingVoice !== player) {
      try {
        playingVoice.pause();
      } catch {
        // Ce lecteur a déjà été libéré en quittant la conversation : rien à mettre en pause.
      }
    }
    playingVoice = player;
    // Les sons de la conversation passent l'audio en « mêlé, muet en silencieux » : un vocal reprend
    // la main (la musique se met en pause le temps de l'écoute) et se lit même en mode silencieux.
    setAudioModeAsync({ interruptionMode: 'doNotMix', playsInSilentMode: true })
      .catch((e) => log.warn('vocal', e))
      .finally(() => {
        try {
          if (playingVoice === player) player.play();
        } catch (e) {
          // Conversation quittée entre-temps : le lecteur est déjà libéré.
          log.warn('vocal', e);
        }
      });
  };

  // Référence relue à chaque rendu : la fonction enregistrée garde le lecteur et la source actuels.
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    const play = () => startRef.current();
    voices.set(message.id, play);
    return () => {
      if (voices.get(message.id) === play) voices.delete(message.id);
    };
  }, [message.id]);

  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    player.seekTo(0).catch((e) => log.warn('vocal', e));
    resumeAt.delete(message.id);
    // Vocaux enchaînés : le suivant du même auteur part tout de suite.
    if (playingVoice === player && next) voices.get(next)?.();
  }, [status.didJustFinish, player, next, message.id]);

  const toggle = () => {
    if (status.playing) player.pause();
    else start();
  };

  const seek = (ratio: number) => {
    if (status.duration > 0) player.seekTo(ratio * status.duration).catch((e) => log.warn('vocal', e));
  };

  // Nouvelle vitesse : l'étiquette se pose en fondu et passe de 0,8 à 1 (pas au premier affichage).
  const rateIn = useSharedValue(1);
  const shownRate = useRef(rate);
  useEffect(() => {
    if (shownRate.current === rate) return;
    shownRate.current = rate;
    rateIn.set(withSequence(withTiming(0, { duration: 0 }), timing(1)));
  }, [rate, rateIn]);
  const rateStyle = useAnimatedStyle(() => ({ opacity: rateIn.get(), transform: [{ scale: interpolate(rateIn.get(), [0, 1], [0.8, 1]) }] }));

  const changeRate = () => {
    haptics.select();
    nextRate();
  };

  return (
    <View style={styles.voice}>
      <IconButton onPress={toggle} label={status.playing ? t('chat.pause') : t('chat.ecouterVocal')} hitSlop={2} style={[styles.voiceButton, { backgroundColor: palette.text }]}>
        <PlayPause playing={status.playing} color={palette.background} />
      </IconButton>
      <View style={styles.voiceBody}>
        {bars ? (
          <Waveform bars={bars} position={progress ?? position} speed={speed} color={palette.text} restColor={palette.track} label={t('chat.deplacerVocal')} onSeek={seek} />
        ) : (
          <SeekBar position={progress ?? position} speed={speed} color={palette.text} trackColor={palette.track} label={t('chat.deplacerVocal')} onSeek={seek} />
        )}
        <View style={styles.voiceFooter}>
          <Text style={[styles.time, styles.clock, { color: palette.muted }]}>{formatClock(status.playing || status.currentTime > 0 ? status.currentTime : status.duration)}</Text>
          <Pressable onPress={changeRate} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('vocal.vitesse', { vitesse: rateLabel(rate) })} style={[styles.rate, { backgroundColor: palette.track }]}>
            <Reanimated.Text style={[styles.rateLabel, { color: palette.text }, rateStyle]}>
              {rateLabel(rate)}
            </Reanimated.Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Lecture ↔ pause : fondu croisé avec un quart de tour et une légère échelle, sur le fil natif.
// Les deux icônes (arrondies) restent montées l'une sur l'autre ; seule la valeur `shown` bouge.
const ICON_MS = 220;

function PlayPause({ playing, color }: { playing: boolean; color: string }) {
  const shown = useSharedValue(playing ? 1 : 0);
  useEffect(() => {
    shown.set(timing(playing ? 1 : 0, ICON_MS));
  }, [playing, shown]);
  const playStyle = useAnimatedStyle(() => {
    const p = shown.get();
    return {
      opacity: 1 - p,
      transform: [{ rotate: `${-90 * p}deg` }, { scale: interpolate(p, [0, 1], [1, 0.6]) }],
    };
  });
  const pauseStyle = useAnimatedStyle(() => {
    const p = shown.get();
    return {
      opacity: p,
      transform: [{ rotate: `${90 * (1 - p)}deg` }, { scale: interpolate(p, [0, 1], [0.6, 1]) }],
    };
  });
  return (
    <>
      <Reanimated.View style={[localStyles.icon, playStyle]}>
        <PlayIcon size={18} color={color} />
      </Reanimated.View>
      <Reanimated.View style={[localStyles.icon, pauseStyle]}>
        <PauseIcon size={18} color={color} />
      </Reanimated.View>
    </>
  );
}

const localStyles = StyleSheet.create({
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: MEDIA_WIDTH,
  },
  voiceButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    position: 'absolute',
    left: 13,
    top: 13,
    width: 18,
    height: 18,
  },
  voiceBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  voiceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  clock: {
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  rate: {
    height: 22,
    minWidth: 36,
    paddingHorizontal: 8,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

const useStyles = () => useChatStyles(localStyles);
