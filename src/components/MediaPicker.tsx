import { useEffect, useState } from 'react';
import { FlatList, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { ArrowLeft, ArrowUp, Images, Play, Settings, X } from 'lucide-react-native';

import { PickedFile } from '../chat/manager';
import { createStyles, radius, spacing, useColors } from '../theme';
import { showDialog } from './dialog';
import { Button, IconButton, useInsets, useNavigationBarHeight } from './ui';
import { log } from '../log';
import { t } from '../i18n';

type Section = 'photos' | 'videos' | 'albums';
type AlbumRow = { album: MediaLibrary.Album; cover: string | null };

const SECTIONS: { section: Section; label: string }[] = [
  { section: 'photos', label: t('chat.photos') },
  { section: 'videos', label: t('galerie.videos') },
  { section: 'albums', label: t('galerie.albums') },
];

const COLUMNS = 3;
const PAGE_SIZE = 60;

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// asset.uri suffit : getAssetInfoAsync lit aussi la position GPS et exigerait une autorisation de localisation.
function toPickedFile(asset: MediaLibrary.Asset): PickedFile {
  return {
    uri: asset.uri,
    name: asset.filename,
    size: new File(asset.uri).size ?? 0,
    mime: null,
    kind: asset.mediaType === MediaLibrary.MediaType.video ? 'video' : 'image',
  };
}

function AssetTile({ asset, order, onPress }: { asset: MediaLibrary.Asset; order: number; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const video = asset.mediaType === MediaLibrary.MediaType.video;
  return (
    <Pressable onPress={onPress} accessibilityLabel={asset.filename} accessibilityState={{ selected: order > 0 }} style={styles.tile}>
      <Image source={{ uri: asset.uri }} style={styles.tileImage} resizeMode="cover" />
      {video && (
        <View style={styles.duration}>
          <Play size={10} color={colors.onMedia} fill={colors.onMedia} strokeWidth={1.75} />
          <Text style={styles.durationText}>{formatDuration(asset.duration)}</Text>
        </View>
      )}
      {order > 0 && <View style={styles.tileSelected} />}
      <View style={[styles.badge, order > 0 && styles.badgeOn]}>
        {order > 0 && <Text style={styles.badgeText}>{order}</Text>}
      </View>
    </Pressable>
  );
}

function AssetGrid({ section, album, selected, onToggle }: { section: Section; album: MediaLibrary.Album | null; selected: MediaLibrary.Asset[]; onToggle: (asset: MediaLibrary.Asset) => void }) {
  const styles = useStyles();
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [next, setNext] = useState<string | null>(null);

  const load = async (after?: string) => {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after,
      album: album ?? undefined,
      mediaType: album ? ['photo', 'video'] : section === 'videos' ? ['video'] : ['photo'],
      sortBy: [['creationTime', false]],
    });
    setAssets((current) => (after ? [...current, ...page.assets] : page.assets));
    setNext(page.hasNextPage ? page.endCursor : null);
  };

  useEffect(() => {
    load().catch((e) => log.warn('galerie', e));
  }, [section, album]);

  return (
    <FlatList
      data={assets}
      numColumns={COLUMNS}
      keyExtractor={(asset) => asset.id}
      columnWrapperStyle={styles.gridRow}
      contentContainerStyle={styles.grid}
      onEndReachedThreshold={1}
      onEndReached={() => {
        if (next) load(next).catch((e) => log.warn('galerie', e));
      }}
      renderItem={({ item }) => (
        <AssetTile
          asset={item}
          order={selected.findIndex((asset) => asset.id === item.id) + 1}
          onPress={() => onToggle(item)}
        />
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>{t('galerie.vide')}</Text>}
    />
  );
}

function AlbumList({ onOpen }: { onOpen: (album: MediaLibrary.Album) => void }) {
  const styles = useStyles();
  const [rows, setRows] = useState<AlbumRow[]>([]);

  useEffect(() => {
    MediaLibrary.getAlbumsAsync()
      .then((albums) =>
        Promise.all(
          albums
            .filter((album) => album.assetCount > 0)
            .map(async (album) => {
              const { assets } = await MediaLibrary.getAssetsAsync({ first: 1, album, mediaType: ['photo', 'video'], sortBy: [['creationTime', false]] });
              return { album, cover: assets[0]?.uri ?? null };
            }),
        ),
      )
      .then(setRows)
      .catch((e) => log.warn('albums', e));
  }, []);

  return (
    <FlatList
      data={rows}
      numColumns={2}
      keyExtractor={({ album }) => album.id}
      columnWrapperStyle={styles.albumRow}
      contentContainerStyle={styles.albums}
      renderItem={({ item: { album, cover } }) => (
        <Pressable onPress={() => onOpen(album)} style={styles.album}>
          {cover ? <Image source={{ uri: cover }} style={styles.albumCover} resizeMode="cover" /> : <View style={styles.albumCover} />}
          <Text style={styles.albumTitle} numberOfLines={1}>{album.title}</Text>
          <Text style={styles.albumCount}>{album.assetCount}</Text>
        </Pressable>
      )}
    />
  );
}

type PickerProps = {
  onPick: (files: PickedFile[]) => void;
  onClose: () => void;
  // Une seule photo (fond d'écran…) : un appui la choisit, sans onglet vidéos.
  single?: boolean;
};

// Notre propre galerie : photos, vidéos et albums, sans quitter l'app. La permission n'est demandée qu'ici.
export function MediaPicker({ onPick, onClose, single }: PickerProps) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const { top: topInset } = useInsets();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [section, setSection] = useState<Section>('photos');
  const [album, setAlbum] = useState<MediaLibrary.Album | null>(null);
  const [selected, setSelected] = useState<MediaLibrary.Asset[]>([]);

  useEffect(() => {
    MediaLibrary.requestPermissionsAsync(false, ['photo', 'video'])
      .then(({ granted }) => setAllowed(granted))
      .catch((e) => {
        log.warn('galerie', e);
        setAllowed(false);
      });
  }, []);

  const toggle = (asset: MediaLibrary.Asset) => {
    if (single) {
      if (asset.mediaType !== MediaLibrary.MediaType.video) onPick([toPickedFile(asset)]);
      return;
    }
    setSelected((current) => (current.some(({ id }) => id === asset.id) ? current.filter(({ id }) => id !== asset.id) : [...current, asset]));
  };

  const send = () => {
    try {
      onPick(selected.map(toPickedFile));
    } catch (e) {
      showDialog(t('chat.envoiImpossible'), String(e));
    }
  };

  const back = () => (album ? setAlbum(null) : onClose());

  return (
    <Modal visible animationType="slide" onRequestClose={back} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.screen, { paddingTop: topInset }]}>
        <View style={styles.header}>
          <IconButton onPress={back} label={album ? t('galerie.retourAlbums') : t('commun.fermer')}>
            {album ? <ArrowLeft size={24} color={colors.text} strokeWidth={1.75} /> : <X size={24} color={colors.text} strokeWidth={1.75} />}
          </IconButton>
          <Text style={styles.title} numberOfLines={1}>{album ? album.title : t('galerie.titre')}</Text>
        </View>

        {allowed === false ? (
          <View style={styles.denied}>
            <Images size={28} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyText}>{t('galerie.autoriser')}</Text>
            <Button label={t('commun.ouvrirReglages')} icon={Settings} onPress={() => Linking.openSettings()} />
          </View>
        ) : allowed === null ? null : (
          <>
            {!album && (
              <View style={styles.sections}>
                {SECTIONS.filter(({ section: value }) => !single || value !== 'videos').map(({ section: value, label }) => (
                  <Pressable key={value} onPress={() => setSection(value)} accessibilityState={{ selected: section === value }} style={[styles.section, section === value && styles.sectionOn]}>
                    <Text style={[styles.sectionLabel, section === value && styles.sectionLabelOn]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {section === 'albums' && !album ? (
              <AlbumList onOpen={setAlbum} />
            ) : (
              <AssetGrid section={section} album={album} selected={selected} onToggle={toggle} />
            )}
          </>
        )}

        {selected.length > 0 && (
          <View style={[styles.sendWrapper, { bottom: bottom + spacing.md }]}>
            <IconButton onPress={send} label={t('galerie.envoyerElements', { n: selected.length })} hitSlop={0} style={styles.send}>
              <Text style={styles.sendLabel}>{t('galerie.envoyerN', { n: selected.length })}</Text>
              <ArrowUp size={20} color={colors.onAccent} strokeWidth={2} />
            </IconButton>
          </View>
        )}
      </View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  sections: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  section: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  sectionOn: {
    backgroundColor: colors.accent,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  sectionLabelOn: {
    color: colors.onAccent,
  },
  grid: {
    gap: 2,
    paddingBottom: 96,
  },
  gridRow: {
    gap: 2,
  },
  tile: {
    flex: 1 / COLUMNS,
    aspectRatio: 1,
    backgroundColor: colors.surface,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileSelected: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.selectionDim,
  },
  duration: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  durationText: {
    fontSize: 11,
    color: colors.onMedia,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: {
    backgroundColor: colors.accent,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onAccent,
  },
  albums: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: 96,
  },
  albumRow: {
    gap: spacing.md,
  },
  album: {
    flex: 1 / 2,
  },
  albumCover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  albumTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  albumCount: {
    fontSize: 13,
    color: colors.textMuted,
  },
  denied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    padding: spacing.lg,
  },
  sendWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  sendLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.onAccent,
  },
}));
