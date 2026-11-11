import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, Text, View } from 'react-native';
import { File as FsFile } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { File, Play } from 'lucide-react-native';

import { getMediaMessages, Message } from '../../chat/database';
import { formatSize } from '../../chat/files';
import { exportCopy, openMedia as openStoredMedia, retainOpenedMedia, useMediaPreview, videoThumbnail } from '../../chat/media';
import { showDialog } from '../../components/dialog';
import { t } from '../../i18n';
import { EmptyState } from '../../components/EmptyState';
import { createStyles, radius, spacing, useColors } from '../../theme';
import { MediaViewer, Viewing } from '../chat/components/MediaViewer';

type ViewRef = ComponentRef<typeof View>;

const COLUMNS = 3;
const GAP = 2;
const APPEAR_MS = 220;

type Kind = 'media' | 'files';

// Une case de la grille : la photo, ou l'image de la vidéo avec un petit triangle.
function Tile({ message, size, onOpen }: { message: Message; size: number; onOpen: (message: Message, view: ViewRef | null) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const view = useRef<ViewRef>(null);
  // Photo déchiffrée ou miniature de la vidéo (lot 2.3).
  const poster = useMediaPreview(message);
  const appear = useRef(new Animated.Value(0)).current;

  return (
    <Pressable ref={view} onPress={() => onOpen(message, view.current)} style={{ width: size, height: size }}>
      <View style={styles.tileBackground} />
      {poster && (
        <Animated.Image
          source={{ uri: poster }}
          style={[styles.tileImage, { opacity: appear }]}
          resizeMode="cover"
          onLoad={() => Animated.timing(appear, { toValue: 1, duration: APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()}
        />
      )}
      {message.kind === 'video' && (
        <View style={styles.play}>
          <Play size={12} color={colors.onMedia} fill={colors.onMedia} strokeWidth={1.75} />
        </View>
      )}
    </Pressable>
  );
}

// L'onglet « Médias » du profil d'un contact : photos et vidéos envoyées et reçues, puis les fichiers.
export function ContactMedia({ contactKey }: { contactKey: string }) {
  const colors = useColors();
  const styles = useStyles();
  const [messages] = useState(() => getMediaMessages(contactKey));
  const [kind, setKind] = useState<Kind>('media');
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // Les médias déchiffrés pour la grille sont effacés du cache en quittant la fiche (lot 2.3).
  useEffect(() => retainOpenedMedia(), []);
  const fade = useRef(new Animated.Value(1)).current;
  const media = messages.filter((message) => message.kind === 'image' || message.kind === 'video');
  const files = messages.filter((message) => message.kind === 'file');
  // Mesurée sur la grille elle-même, arrondie vers le bas : trois cases tiennent toujours sur une ligne
  // (avec la largeur de l'écran, un arrondi en trop renvoyait la troisième à la ligne).
  const [gridWidth, setGridWidth] = useState(0);
  const tileSize = Math.floor((gridWidth - GAP * (COLUMNS - 1)) / COLUMNS);

  const choose = (next: Kind) => {
    if (next === kind) return;
    fade.setValue(0);
    setKind(next);
    Animated.timing(fade, { toValue: 1, duration: APPEAR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

  const openMedia = (message: Message, view: ViewRef | null) => {
    view?.measureInWindow(async (x, y, width, height) => {
      try {
        const uri = message.file_uri ?? '';
        const poster = message.kind === 'video' ? await videoThumbnail(message.id, uri) : await openStoredMedia(uri, { mime: message.file_mime });
        setViewing({ message, rect: { x, y, width, height }, poster, size: await Image.getSize(poster) });
      } catch (e) {
        showDialog(t('chat.ouvertureImpossible'), String(e));
      }
    });
  };

  const openFile = async (message: Message) => {
    try {
      const copy = new FsFile(await exportCopy(message.file_uri ?? '', message.text));
      const mimeType = message.file_mime ?? undefined;
      if (await copy.canPreview({ mimeType })) await copy.preview({ title: message.text, mimeType });
      else await Sharing.shareAsync(copy.uri, { mimeType, dialogTitle: message.text });
    } catch (e) {
      showDialog(t('chat.ouvertureImpossible'), String(e));
    }
  };

  const shown = kind === 'media' ? media : files;

  return (
    <View>
      <View style={styles.kinds}>
        {(['media', 'files'] as const).map((value) => (
          <Pressable key={value} onPress={() => choose(value)} style={[styles.kind, kind === value && styles.kindOn]}>
            <Text style={[styles.kindLabel, kind === value && styles.kindLabelOn]}>
              {value === 'media' ? t('contact.photosVideos', { n: media.length }) : t('contact.fichiers', { n: files.length })}
            </Text>
          </Pressable>
        ))}
      </View>
      <Animated.View style={{ opacity: fade }}>
        {shown.length === 0 ? (
          <EmptyState label={kind === 'media' ? t('contact.aucunMedia') : t('contact.aucunFichier')} />
        ) : kind === 'media' ? (
          <View style={styles.grid} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)}>
            {tileSize > 0 && media.map((message) => (
              <Tile key={message.id} message={message} size={tileSize} onOpen={openMedia} />
            ))}
          </View>
        ) : (
          files.map((message) => (
            <Pressable key={message.id} onPress={() => openFile(message)} style={({ pressed }) => [styles.file, pressed && styles.pressed]}>
              <View style={styles.fileIcon}>
                <File size={20} color={colors.text} strokeWidth={1.75} />
              </View>
              <View style={styles.fileText}>
                <Text style={styles.fileName} numberOfLines={1}>{message.text}</Text>
                <Text style={styles.fileMeta}>
                  {[message.mine ? t('contact.envoye') : t('contact.recu'), message.file_size ? formatSize(message.file_size) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </Animated.View>
      {viewing && <MediaViewer viewing={viewing} onClose={() => setViewing(null)} />}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  kinds: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  kind: {
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  kindOn: {
    backgroundColor: colors.accent,
  },
  kindLabel: {
    fontSize: 14,
    color: colors.text,
  },
  kindLabelOn: {
    color: colors.onAccent,
    fontWeight: '600',
  },
  grid: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: GAP,
    rowGap: GAP,
  },
  tileBackground: {
    ...({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const),
    backgroundColor: colors.surface,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  play: {
    position: 'absolute',
    top: 6,
    right: 6,
  },

  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileText: {
    flex: 1,
  },
  fileName: {
    fontSize: 15,
    color: colors.text,
  },
  fileMeta: {
    fontSize: 13,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.6,
  },
}));
