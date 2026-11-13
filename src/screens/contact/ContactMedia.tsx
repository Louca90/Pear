import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Reanimated, { interpolateColor, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { File as FsFile } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { Message } from '../../chat/database';
import { formatSize } from '../../chat/files';
import { exportCopy, openMedia as openStoredMedia, retainOpenedMedia, useMediaPreview, videoThumbnail } from '../../chat/media';
import { showDialog } from '../../components/dialog';
import { PlayIcon } from '../../components/PlayIcon';
import { usePressFeedback } from '../../components/ui';
import { dateLocale, t } from '../../i18n';
import { EmptyState } from '../../components/EmptyState';
import { DURATION, EASE, enterUp, timing } from '../../motion';
import { createStyles, radius, spacing, useColors } from '../../theme';
import { MediaViewer, Viewing } from '../chat/components/MediaViewer';
import { dayLabel } from '../chat/format';

type ViewRef = ComponentRef<typeof View>;

const COLUMNS = 3;
const GAP = 3;
const APPEAR_MS = 220;
// Cascade d'apparition : seulement les premières cases (et lignes de fichiers), 25 ms d'écart.
const CASCADE = 12;
const CASCADE_STEP = 25;

type Kind = 'media' | 'files';

// Apparition d'une case : fondu et échelle 0,94 → 1, après `delay`.
function tileIn(delay: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const run = (value: number) => withDelay(delay, withTiming(value, { duration: 240, easing: EASE, reduceMotion: ReduceMotion.System }));
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.94 }] },
      animations: { opacity: run(1), transform: [{ scale: run(1) }] },
    };
  };
}

// L'extension affichée dans la pastille d'un fichier (PDF, ZIP…).
function extension(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5).toUpperCase() : '';
}

// Une case de la grille : la photo, ou l'image de la vidéo avec la petite icône de lecture arrondie.
function Tile({ message, size, index, onOpen }: { message: Message; size: number; index: number; onOpen: (message: Message, view: ViewRef | null) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const view = useRef<ViewRef>(null);
  // Photo déchiffrée ou miniature de la vidéo (lot 2.3).
  const poster = useMediaPreview(message);
  const appear = useSharedValue(0);
  const imageStyle = useAnimatedStyle(() => ({ opacity: appear.get() }));

  return (
    <Reanimated.View entering={index < CASCADE ? tileIn(index * CASCADE_STEP) : undefined}>
      <Pressable ref={view} onPress={() => onOpen(message, view.current)} style={{ width: size, height: size }}>
        <View style={styles.tileBackground} />
        {poster && (
          <Reanimated.Image
            source={{ uri: poster }}
            style={[styles.tileImage, imageStyle]}
            resizeMode="cover"
            onLoad={() => appear.set(timing(1, APPEAR_MS))}
          />
        )}
        {message.kind === 'video' && (
          <View style={styles.play}>
            <PlayIcon size={10} color={colors.onMedia} />
          </View>
        )}
      </Pressable>
    </Reanimated.View>
  );
}

// Un sous-filtre (« Photos et vidéos », « Fichiers ») : le fond et le texte changent en fondu.
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const progress = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    progress.set(timing(on ? 1 : 0, DURATION.small));
  }, [on, progress]);
  const { surface, text, textMuted, background } = colors;
  const chipStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.get(), [0, 1], [surface, text]) }));
  const labelStyle = useAnimatedStyle(() => ({ color: interpolateColor(progress.get(), [0, 1], [textMuted, background]) }));
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Reanimated.View style={[styles.chip, chipStyle, feedback.style]}>
        <Reanimated.Text style={[styles.chipLabel, labelStyle]}>{label}</Reanimated.Text>
      </Reanimated.View>
    </Pressable>
  );
}

// L'onglet « Médias » du profil d'un contact : photos et vidéos envoyées et reçues, puis les fichiers.
// Les messages sont lus par ContactScreen (le nombre s'affiche dans l'onglet).
export function ContactMedia({ messages }: { messages: Message[] }) {
  const styles = useStyles();
  const [kind, setKind] = useState<Kind>('media');
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // Les médias déchiffrés pour la grille sont effacés du cache en quittant la fiche (lot 2.3).
  useEffect(() => retainOpenedMedia(), []);
  const media = messages.filter((message) => message.kind === 'image' || message.kind === 'video');
  const files = messages.filter((message) => message.kind === 'file');
  // Mesurée sur la grille elle-même, arrondie vers le bas : trois cases tiennent toujours sur une ligne
  // (avec la largeur de l'écran, un arrondi en trop renvoyait la troisième à la ligne).
  const [gridWidth, setGridWidth] = useState(0);
  const tileSize = Math.floor((gridWidth - GAP * (COLUMNS - 1)) / COLUMNS);

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
  const now = Date.now();
  const locale = dateLocale();

  return (
    <View>
      <View style={styles.kinds}>
        <Chip label={t('contact.filtrePhotosVideos')} on={kind === 'media'} onPress={() => setKind('media')} />
        <Chip label={t('contact.filtreFichiers')} on={kind === 'files'} onPress={() => setKind('files')} />
      </View>
      <Reanimated.View key={kind} entering={enterUp(10, 240)}>
        {shown.length === 0 ? (
          <EmptyState label={kind === 'media' ? t('contact.aucunMedia') : t('contact.aucunFichier')} />
        ) : kind === 'media' ? (
          <View style={styles.grid} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)}>
            {tileSize > 0 && media.map((message, index) => (
              <Tile key={message.id} message={message} size={tileSize} index={index} onOpen={openMedia} />
            ))}
          </View>
        ) : (
          <View style={styles.files}>
            {files.map((message, index) => (
              <Reanimated.View key={message.id} entering={index < CASCADE ? enterUp(8, 240, index * CASCADE_STEP) : undefined}>
                <Pressable onPress={() => openFile(message)} style={({ pressed }) => [styles.file, pressed && styles.pressed]}>
                  <View style={styles.fileIcon}>
                    <Text style={styles.fileExt} numberOfLines={1}>{extension(message.text)}</Text>
                  </View>
                  <View style={styles.fileText}>
                    <Text style={styles.fileName} numberOfLines={1}>{message.text}</Text>
                    <Text style={styles.fileMeta} numberOfLines={1}>
                      {[
                        message.mine ? t('contact.envoye') : t('contact.recu'),
                        message.file_size ? formatSize(message.file_size) : null,
                        dayLabel(message.created_at, now, locale),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              </Reanimated.View>
            ))}
          </View>
        )}
      </Reanimated.View>
      {viewing && <MediaViewer viewing={viewing} onClose={() => setViewing(null)} />}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  kinds: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 12,
  },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  // La grille va d'un bord à l'autre de l'écran, cases serrées.
  grid: {
    marginHorizontal: -spacing.md,
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
    right: 6,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  files: {
    gap: spacing.sm,
  },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fileIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileExt: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.signatureStrong,
  },
  fileText: {
    flex: 1,
  },
  fileName: {
    fontSize: 15,
    color: colors.text,
  },
  fileMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
}));
