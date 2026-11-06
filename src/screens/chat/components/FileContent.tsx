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
import { log } from '../../../log';

function VideoPreview({ message }: { message: Message }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    videoThumbnail(message.id, message.file_uri ?? '')
      .then((uri) => {
        if (!cancelled) setThumbnail(uri);
      })
      .catch((e) => log.warn('miniature', e));
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

type FileContentProps = {
  message: Message;
  palette: BubblePalette;
  mediaHidden?: boolean;
  onOpen: (rect: Rect) => void;
  onLongPress: () => void;
  // Appelé dès que le doigt touche le média : la visionneuse prépare l'image pendant la fenêtre du double appui.
  onPrepare?: () => void;
  // Fichier trop lourd proposé par l'autre : on le reçoit ou on le refuse.
  onAccept?: () => void;
  onRefuse?: () => void;
};

export function FileContent({ message, palette, mediaHidden, onOpen, onLongPress, onPrepare, onAccept, onRefuse }: FileContentProps) {
  const media = useRef<ViewRef>(null);
  const bare = isBareMedia(message);
  const foreground = bare ? colors.text : palette.text;
  const secondary = bare ? colors.textMuted : palette.muted;
  const progress = chat.getProgress(message.id);
  const open = () => media.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }));

  return (
    <Pressable
      ref={media}
      onPress={open}
      onPressIn={onPrepare}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      disabled={message.status === 'receiving' || message.status === 'offered' || message.status === 'refused'}
      style={mediaHidden && styles.hidden}
    >
      {bare && message.kind === 'image' ? (
        <Image source={{ uri: message.file_uri ?? undefined }} style={styles.image} resizeMode="cover" />
      ) : bare ? (
        <View pointerEvents="none">
          <VideoPreview message={message} />
        </View>
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
            <Text style={[styles.time, { color: secondary }]}>
              {formatSize(message.file_size ?? 0)}
              {message.status === 'refused' ? (message.mine === 1 ? ' · Refusé par ton contact' : ' · Refusé') : ''}
            </Text>
          </View>
        </View>
      )}
      {message.status === 'offered' && message.mine === 0 && (
        <View style={styles.offerActions}>
          <Pressable onPress={onAccept} accessibilityRole="button" style={[styles.offerButton, { backgroundColor: palette.text }]}>
            <Text style={[styles.offerLabel, { color: palette.background }]}>Recevoir</Text>
          </Pressable>
          <Pressable onPress={onRefuse} accessibilityRole="button" style={[styles.offerButton, { backgroundColor: palette.track }]}>
            <Text style={[styles.offerLabel, { color: palette.text }]}>Refuser</Text>
          </Pressable>
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
  offerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  offerButton: {
    flex: 1,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerLabel: {
    fontSize: 14,
    fontWeight: '600',
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
