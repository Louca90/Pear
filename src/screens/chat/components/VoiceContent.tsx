import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AudioPlayer, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { IconButton } from '../../../components/ui';
import { BubblePalette, radius, spacing } from '../../../theme';

import { SeekBar } from './SeekBar';
import { formatClock } from '../format';
import { useChatStyles } from '../styles';
import { log } from '../../../log';

// Un seul vocal à la fois : en lancer un met le précédent en pause.
let playingVoice: AudioPlayer | null = null;

export function VoiceContent({ message, palette }: { message: Message; palette: BubblePalette }) {
  const styles = useStyles();
  const player = useAudioPlayer(message.file_uri ?? null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const progress = chat.getProgress(message.id);
  const position = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    player.seekTo(0).catch((e) => log.warn('vocal', e));
  }, [status.didJustFinish, player]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (playingVoice && playingVoice !== player) {
      try {
        playingVoice.pause();
      } catch {
        // Ce lecteur a déjà été libéré en quittant la conversation : rien à mettre en pause.
      }
    }
    playingVoice = player;
    player.play();
  };

  const seek = (ratio: number) => {
    if (status.duration > 0) player.seekTo(ratio * status.duration).catch((e) => log.warn('vocal', e));
  };

  return (
    <View style={styles.voice}>
      <IconButton onPress={toggle} label={status.playing ? 'Mettre en pause' : 'Écouter le vocal'} hitSlop={2} style={[styles.voiceButton, { backgroundColor: palette.track }]}>
        {status.playing ? (
          <Pause size={18} color={palette.text} fill={palette.text} strokeWidth={1.75} />
        ) : (
          <Play size={18} color={palette.text} fill={palette.text} strokeWidth={1.75} />
        )}
      </IconButton>
      <View style={styles.voiceBody}>
        <SeekBar position={progress ?? position} color={palette.text} trackColor={palette.track} label="Se déplacer dans le vocal" onSeek={seek} />
        <Text style={[styles.time, { color: palette.muted }]}>{formatClock(status.playing || status.currentTime > 0 ? status.currentTime : status.duration)}</Text>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: 220,
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
});

const useStyles = () => useChatStyles(localStyles);
