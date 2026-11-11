import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioPlayer, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';

import { getSetting, Message, setSetting } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { useMediaUri } from '../../../chat/media';
import { decodeWave, parseMeta } from '../../../chat/meta';
import { IconButton } from '../../../components/ui';
import { haptics } from '../../../haptics';
import { BubblePalette, radius, spacing } from '../../../theme';

import { SeekBar } from './SeekBar';
import { Waveform } from './Waveform';
import { MEDIA_WIDTH } from '../constants';
import { formatClock } from '../format';
import { useChatStyles } from '../styles';
import { log } from '../../../log';
import { t } from '../../../i18n';

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
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const progress = chat.getProgress(message.id);
  const rate = useVoiceRate();
  const bars = decodeWave(parseMeta(message.meta).wave);
  const position = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

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

  const changeRate = () => {
    haptics.select();
    nextRate();
  };

  return (
    <View style={styles.voice}>
      <IconButton onPress={toggle} label={status.playing ? t('chat.pause') : t('chat.ecouterVocal')} hitSlop={2} style={[styles.voiceButton, { backgroundColor: palette.track }]}>
        {status.playing ? (
          <Pause size={18} color={palette.text} fill={palette.text} strokeWidth={1.75} />
        ) : (
          <Play size={18} color={palette.text} fill={palette.text} strokeWidth={1.75} />
        )}
      </IconButton>
      <View style={styles.voiceBody}>
        {bars ? (
          <Waveform bars={bars} position={progress ?? position} color={palette.text} restColor={palette.track} label={t('chat.deplacerVocal')} onSeek={seek} />
        ) : (
          <SeekBar position={progress ?? position} color={palette.text} trackColor={palette.track} label={t('chat.deplacerVocal')} onSeek={seek} />
        )}
        <View style={styles.voiceFooter}>
          <Text style={[styles.time, { color: palette.muted }]}>{formatClock(status.playing || status.currentTime > 0 ? status.currentTime : status.duration)}</Text>
          <Pressable onPress={changeRate} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('vocal.vitesse', { vitesse: rateLabel(rate) })} style={[styles.rate, { backgroundColor: palette.track }]}>
            <Text style={[styles.rateLabel, { color: palette.text }]}>{rateLabel(rate)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: MEDIA_WIDTH,
  },
  voiceButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBody: {
    flex: 1,
  },
  voiceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rate: {
    minWidth: 38,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  rateLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});

const useStyles = () => useChatStyles(localStyles);
