import { useRef, useSyncExternalStore } from 'react';
import { Image, ImageStyle, Pressable, StyleProp, Text, View } from 'react-native';
import { FileText, Images, Mic, Play } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { formatSize } from '../../../chat/files';
import { useMediaPreview } from '../../../chat/media';
import { parseMeta } from '../../../chat/meta';
import { jpegDataUri } from '../../../chat/thumb';
import { chat } from '../../../chat/manager';
import { Pear } from '../../../components/Pear';
import { TransferPear } from '../../../components/TransferPear';
import { BubblePalette, createStyles, radius, spacing, useColors } from '../../../theme';

import { LONG_PRESS_MS, MEDIA_WIDTH } from '../constants';
import { isBareMedia, isMediaDeleted, isSticker } from '../format';
import { useChatStyles } from '../styles';
import { Rect, ViewRef } from '../types';
import { t } from '../../../i18n';

// style : la taille d'une case d'album (lot 4.5), à la place du carré de 220 points.
export function VideoPreview({ message, style }: { message: Message; style?: StyleProp<ImageStyle> }) {
  const styles = useStyles();
  const colors = useColors();
  // Miniature gardée chiffrée (lot 2.3), déchiffrée pour l'affichage.
  const thumbnail = useMediaPreview(message);

  return (
    <View style={[styles.video, style]}>
      {thumbnail && <Image source={{ uri: thumbnail }} style={[styles.image, style]} resizeMode="cover" />}
      <View style={styles.playButton}>
        <Play size={24} color={colors.onMedia} fill={colors.onMedia} strokeWidth={1.75} />
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

// Photo chiffrée sur le disque (lot 2.3) : affichée depuis sa copie déchiffrée.
export function ImagePreview({ message, style }: { message: Message; style?: StyleProp<ImageStyle> }) {
  const styles = useStyles();
  const source = useMediaPreview(message);
  // Un sticker garde sa forme : entier, sur fond transparent, sans coins arrondis.
  if (isSticker(message)) return source ? <Image source={{ uri: source }} style={styles.sticker} resizeMode="contain" /> : <View style={styles.sticker} />;
  if (source) return <Image source={{ uri: source }} style={[styles.image, style]} resizeMode="cover" />;
  // Le temps du déchiffrement : la miniature floue, si le message en a une.
  const thumb = parseMeta(message.meta).thumb;
  return thumb ? <BlurThumb thumb={thumb} style={style} /> : <View style={[styles.image, style]} />;
}

// Miniature floue (lot 4.4) : la toute petite image reçue avec l'offre, agrandie et floutée, pendant
// que le fichier arrive.
export function BlurThumb({ thumb, label, style }: { thumb: string; label?: string; style?: StyleProp<ImageStyle> }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.video, style]}>
      <Image source={{ uri: jpegDataUri(thumb) }} style={[styles.image, style]} resizeMode="cover" blurRadius={6} />
      {label && (
        <View style={[styles.metaPill, styles.thumbLabel]}>
          <Text style={[styles.time, { color: colors.onMedia }]}>{label}</Text>
        </View>
      )}
    </View>
  );
}

export function FileContent({ message, palette, mediaHidden, onOpen, onLongPress, onPrepare, onAccept, onRefuse }: FileContentProps) {
  const styles = useStyles();
  const colors = useColors();
  const media = useRef<ViewRef>(null);
  const bare = isBareMedia(message);
  const foreground = bare ? colors.text : palette.text;
  const secondary = bare ? colors.textMuted : palette.muted;
  // L'avancement du transfert est lu ici : la bulle, elle, ne se redessine que si son message change.
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const progress = chat.getProgress(message.id);
  const open = () => media.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }));
  // Photo ou vidéo pas encore arrivée (ou proposée) : sa miniature floue à la place de la ligne de fichier.
  const waiting = message.status === 'receiving' || message.status === 'offered';
  // Vue unique (lot 4.7) : jamais d'aperçu. L'expéditeur ne peut pas la rouvrir ; le destinataire, une fois.
  const once = message.view_once ?? 0;
  const onceLocked = once > 0 && (message.mine === 1 || once === 2 || !message.file_uri);
  const onceDetail =
    message.status === 'receiving' || message.status === 'offered'
      ? formatSize(message.file_size ?? 0)
      : once === 2
        ? t('unique.ouverte')
        : message.mine === 1
          ? t(message.status === 'sending' ? 'unique.envoi' : 'unique.envoyee')
          : t('unique.voir');
  const thumb = waiting && (message.kind === 'image' || message.kind === 'video') ? parseMeta(message.meta).thumb : undefined;
  // Un média affiché (photo, vidéo, miniature floue) montre son transfert par la poire qui mûrit dans
  // son coin ; une ligne de fichier, par la poire à la place de l'icône et la barre dessous.
  // Proposé, pas encore accepté : une ligne compacte (petite miniature floue, nom, taille) au-dessus
  // des deux boutons, au lieu du grand carré, qui prenait tout l'écran sur un petit téléphone.
  const offered = message.status === 'offered';
  const onMedia = once === 0 && (bare || (!!thumb && !offered));

  return (
    <Pressable
      ref={media}
      onPress={open}
      onPressIn={onPrepare}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      disabled={message.status === 'receiving' || message.status === 'offered' || message.status === 'refused' || isMediaDeleted(message) || onceLocked}
      style={mediaHidden && styles.hidden}
    >
      {once > 0 ? (
        <View style={styles.fileRow}>
          <View style={[styles.onceBadge, { borderColor: foreground }, once === 2 && styles.onceSpent]}>
            <Text style={[styles.onceDigit, { color: foreground }]}>1</Text>
          </View>
          <View style={styles.fileText}>
            <Text style={[styles.fileName, { color: foreground }]} numberOfLines={1}>{message.kind === 'video' ? t('unique.video') : t('unique.photo')}</Text>
            <Text style={[styles.time, { color: secondary }]}>
              {onceDetail}
              {message.status === 'refused' ? (message.mine === 1 ? t('chat.refuseParContact') : t('chat.refuse')) : ''}
            </Text>
          </View>
        </View>
      ) : bare && message.kind === 'image' ? (
        <ImagePreview message={message} />
      ) : bare ? (
        <View pointerEvents="none">
          <VideoPreview message={message} />
        </View>
      ) : thumb && !offered ? (
        <BlurThumb thumb={thumb} label={formatSize(message.file_size ?? 0)} />
      ) : (
        <View style={styles.fileRow}>
          {thumb ? (
            <Image source={{ uri: jpegDataUri(thumb) }} style={styles.offerThumb} resizeMode="cover" blurRadius={3} />
          ) : progress !== undefined ? (
            <View style={styles.fileIcon}>
              <Pear height={24} color={foreground} state="ripening" progress={progress} />
            </View>
          ) : message.kind === 'video' ? (
            <Play size={24} color={foreground} strokeWidth={1.75} />
          ) : message.kind === 'audio' ? (
            <Mic size={24} color={foreground} strokeWidth={1.75} />
          ) : message.kind === 'image' ? (
            <Images size={24} color={foreground} strokeWidth={1.75} />
          ) : (
            <FileText size={24} color={foreground} strokeWidth={1.75} />
          )}
          <View style={styles.fileText}>
            <Text style={[styles.fileName, { color: foreground }]} numberOfLines={1} ellipsizeMode="middle">
              {thumb ? (message.kind === 'video' ? t('apercu.video') : t('apercu.photo')) : message.text}
            </Text>
            <Text style={[styles.time, { color: secondary }]}>
              {isMediaDeleted(message) ? t('stockage.mediaSupprime') : formatSize(message.file_size ?? 0)}
              {message.status === 'refused' ? (message.mine === 1 ? t('chat.refuseParContact') : t('chat.refuse')) : ''}
            </Text>
          </View>
        </View>
      )}
      {message.status === 'offered' && message.mine === 0 && (
        <View style={styles.offerActions}>
          <Pressable onPress={onAccept} accessibilityRole="button" style={[styles.offerButton, { backgroundColor: palette.text }]}>
            <Text style={[styles.offerLabel, { color: palette.background }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t('chat.recevoir')}</Text>
          </Pressable>
          <Pressable onPress={onRefuse} accessibilityRole="button" style={[styles.offerButton, { backgroundColor: palette.track }]}>
            <Text style={[styles.offerLabel, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t('chat.refuser')}</Text>
          </Pressable>
        </View>
      )}
      {onMedia && <TransferPear progress={progress} />}
      {progress !== undefined && !onMedia && (
        <View style={[styles.progressTrack, { backgroundColor: bare ? colors.border : palette.track }]}>
          <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%`, backgroundColor: foreground }]} />
        </View>
      )}
    </Pressable>
  );
}

const useLocalStyles = createStyles((colors) => ({
  video: {
    width: MEDIA_WIDTH,
    height: MEDIA_WIDTH,
    borderRadius: radius.md,
    backgroundColor: colors.onDarkTrack,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  offerThumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
  },
  image: {
    width: MEDIA_WIDTH,
    height: MEDIA_WIDTH,
    borderRadius: radius.md,
  },
  sticker: {
    width: 140,
    height: 140,
  },
  onceBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    borderWidth: 1.75,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceSpent: {
    opacity: 0.45,
  },
  onceDigit: {
    fontSize: 13,
    fontWeight: '700',
  },
  thumbLabel: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
  },
  offerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  offerButton: {
    flex: 1,
    height: 36,
    paddingHorizontal: spacing.sm,
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
    minWidth: Math.min(180, MEDIA_WIDTH),
  },
  fileIcon: {
    width: 24,
    alignItems: 'center',
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
}));

const useStyles = () => useChatStyles(useLocalStyles());
