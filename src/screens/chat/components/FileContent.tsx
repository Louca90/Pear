import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { FileText, Images, Mic, Play } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { formatSize, videoThumbnail } from '../../../chat/files';
import { chat } from '../../../chat/manager';
import { BubblePalette, colors, radius, spacing } from '../../../theme';

import { LONG_PRESS_MS } from '../constants';
import { isBareMedia } from '../format';
import { sharedStyles } from '../styles';
import { Rect, ViewRef } from '../types';

function VideoPreview({ message }: { message: Message }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    videoThumbnail(message.id, message.file_uri ?? '')
      .then((uri) => {
        if (!cancelled) setThumbnail(uri);
      })
      .catch((e) => console.warn('Pear miniature :', e));
    return () => {
      cancelled = true;
    };
  }, [message.id, message.file_uri]);

  return (
    <View style={styles.video}>
      {thumbnail && <Image source={{ uri: thumbnail }} style={styles.image} resizeMode="cover" />}
      <View style={styles.playButton}>
        <Play size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} />
      </View>
    </View>
  );
}

export function FileContent({ message, palette, mediaHidden, onOpen, onLongPress }: { message: Message; palette: BubblePalette; mediaHidden?: boolean; onOpen: (rect: Rect) => void; onLongPress: () => void }) {
  const media = useRef<ViewRef>(null);
  const bare = isBareMedia(message);
  const foreground = bare ? colors.text : palette.text;
  const secondary = bare ? colors.textMuted : palette.muted;
  const progress = chat.getProgress(message.id);

  return (
    <Pressable
      ref={media}
      onPress={() => media.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }))}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      disabled={message.status === 'receiving'}
      style={mediaHidden && styles.hidden}
    >
      {bare && message.kind === 'image' ? (
        <Image source={{ uri: message.file_uri ?? undefined }} style={styles.image} resizeMode="cover" />
      ) : bare ? (
        <VideoPreview message={message} />
      ) : (
        <View style={styles.fileRow}>
          {message.kind === 'video' ? (
            <Play size={24} color={foreground} strokeWidth={1.75} />
          ) : message.kind === 'audio' ? (
            <Mic size={24} color={foreground} strokeWidth={1.75} />
          ) : message.kind === 'image' ? (
            <Images size={24} color={foreground} strokeWidth={1.75} />
          ) : (
            <FileText size={24} color={foreground} strokeWidth={1.75} />
          )}
          <View style={styles.fileText}>
            <Text style={[styles.fileName, { color: foreground }]} numberOfLines={1}>{message.text}</Text>
            <Text style={[styles.time, { color: secondary }]}>{formatSize(message.file_size ?? 0)}</Text>
          </View>
        </View>
      )}
      {progress !== undefined && (
        <View style={[styles.progressTrack, { backgroundColor: bare ? colors.border : palette.track }]}>
          <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%`, backgroundColor: foreground }]} />
        </View>
      )}
    </Pressable>
  );
}

const localStyles = StyleSheet.create({
  video: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
    backgroundColor: colors.onDarkTrack,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 180,
  },
  fileText: {
    flexShrink: 1,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '500',
  },
  progressTrack: {
    height: 3,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressBar: {
    height: 3,
  },
});

const styles = { ...sharedStyles, ...localStyles };
