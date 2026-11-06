import { ComponentRef, Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Dimensions, Image, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { Check, Type } from 'lucide-react-native';
import Svg, { G, Image as SvgImage, Rect, Text as SvgText } from 'react-native-svg';

import { burnOverlay } from '../../modules/pear-native';
import { VIDEO_BITRATE } from '../config';
import { createMediaStyles, radius, spacing, useMediaColors } from '../theme';
import { IconButton, useInsets } from './ui';
import { log } from '../log';

type Filter = 'none' | 'dark' | 'time' | 'date';

const FILTERS: { filter: Filter; label: string }[] = [
  { filter: 'none', label: 'Original' },
  { filter: 'dark', label: 'Sombre' },
  { filter: 'time', label: 'Heure' },
  { filter: 'date', label: 'Date' },
];

const CAPTION_FONT = 20;
const CAPTION_LINE_HEIGHT = 28;
const CAPTION_PADDING = 10;
const CAPTION_MAX_LENGTH = 160;
// Une lettre fait en moyenne un peu plus de la moitié de la taille de la police.
const CAPTION_LETTER_WIDTH = CAPTION_FONT * 0.54;
const DARK_FILTER_OPACITY = 0.42;
const STAMP_SHADOW_OPACITY = 0.45;
const TAP_DISTANCE = 10;
const SWIPE_DISTANCE = 50;

export type MediaEditorHandle = {
  // Grave le texte et le filtre dans un nouveau fichier. Sans retouche, renvoie le fichier d'origine.
  flatten: () => Promise<string>;
};

function wrapCaption(text: string, maxLetters: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= maxLetters) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function formatStamp(timestamp: number) {
  const date = new Date(timestamp);
  return {
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    date: date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

function ShadowedText({ x, y, size, weight, children }: { x: number; y: number; size: number; weight: '400' | '600'; children: string }) {
  const colors = useMediaColors();
  const shared = { fontSize: size, fontWeight: weight, textAnchor: 'middle' as const };
  return (
    <>
      <SvgText {...shared} x={x + 1} y={y + 2} fill={colors.text} opacity={STAMP_SHADOW_OPACITY}>{children}</SvgText>
      <SvgText {...shared} x={x} y={y} fill={colors.background}>{children}</SvgText>
    </>
  );
}

function EditorVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (created) => {
    created.loop = true;
    created.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />;
}

type Props = {
  uri: string;
  kind: 'image' | 'video';
  takenAt: number;
  bottomSpace: number;
  ref: Ref<MediaEditorHandle>;
};

// Tout est dessiné dans un même SVG. Une photo y est dessinée aussi. Une vidéo passe dessous :
// le SVG, transparent, devient alors le calque que Media3 incruste dans toute la vidéo.
export function MediaEditor({ uri, kind, takenAt, bottomSpace, ref }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top: topInset } = useInsets();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [filter, setFilter] = useState<Filter>('none');
  const [caption, setCaption] = useState('');
  const [captionRatio, setCaptionRatio] = useState(0.6);
  const [draft, setDraft] = useState<string | null>(null);
  const canvas = useRef<ComponentRef<typeof Svg>>(null);
  const screen = Dimensions.get('screen');

  useEffect(() => {
    const measured = kind === 'video' ? getThumbnailAsync(uri, { time: 0 }) : Image.getSize(uri);
    measured.then(({ width: measuredWidth, height: measuredHeight }) => setSize({ width: measuredWidth, height: measuredHeight })).catch((e) => log.warn('média', e));
  }, [uri, kind]);

  const fit = size ? Math.min(screen.width / size.width, screen.height / size.height) : 1;
  const width = size ? size.width * fit : screen.width;
  const height = size ? size.height * fit : screen.height;

  const lines = caption ? wrapCaption(caption, Math.floor((width - spacing.lg) / CAPTION_LETTER_WIDTH)) : [];
  const bandHeight = lines.length * CAPTION_LINE_HEIGHT + CAPTION_PADDING * 2;
  const bandTop = Math.max(0, Math.min(height - bandHeight, captionRatio * height));
  const stamp = formatStamp(takenAt);

  useImperativeHandle(ref, () => ({
    flatten: () => {
      if (filter === 'none' && !caption) return Promise.resolve(uri);
      return new Promise((resolve, reject) => {
        if (!canvas.current) {
          reject(new Error("L'image n'est pas prête."));
          return;
        }
        canvas.current.toDataURL((base64: string) => {
          const edited = new File(Paths.cache, `edited-${Date.now()}.png`);
          Promise.resolve(edited.write(base64, { encoding: 'base64' }))
            .then(() => (kind === 'video' ? burnOverlay(uri, edited.uri, VIDEO_BITRATE) : edited.uri))
            .then(resolve)
            .catch(reject);
        });
      });
    },
  }));

  const dragState = useRef({ startRatio: 0, draggingCaption: false });
  const latest = {
    down: (locationY: number) => {
      dragState.current.draggingCaption = !!caption && locationY >= bandTop && locationY <= bandTop + bandHeight;
      dragState.current.startRatio = bandTop / height;
    },
    move: (dy: number) => {
      if (dragState.current.draggingCaption) setCaptionRatio(dragState.current.startRatio + dy / height);
    },
    up: (dx: number, dy: number) => {
      const tap = Math.abs(dx) < TAP_DISTANCE && Math.abs(dy) < TAP_DISTANCE;
      if (tap) {
        setDraft(caption);
      } else if (!dragState.current.draggingCaption && Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
        // Glisser à gauche ou à droite passe au filtre voisin, comme sur Snap.
        const index = FILTERS.findIndex((item) => item.filter === filter);
        setFilter(FILTERS[(index + (dx < 0 ? 1 : -1) + FILTERS.length) % FILTERS.length].filter);
      }
    },
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => latestRef.current.down(event.nativeEvent.locationY),
      onPanResponderMove: (_event, { dy }) => latestRef.current.move(dy),
      onPanResponderRelease: (_event, { dx, dy }) => latestRef.current.up(dx, dy),
    }),
  ).current;

  const commitDraft = () => {
    if (draft !== null) setCaption(draft.trim());
    setDraft(null);
  };

  return (
    <>
      <View style={[styles.canvas, { width, height, left: (screen.width - width) / 2, top: (screen.height - height) / 2 }]}>
        {size && kind === 'video' && <EditorVideo uri={uri} />}
        {size && (
          <Svg ref={canvas} width={width} height={height}>
            {kind === 'image' && <SvgImage href={{ uri }} width={width} height={height} preserveAspectRatio="xMidYMid slice" />}
            {filter === 'dark' && <Rect width={width} height={height} fill={colors.text} opacity={DARK_FILTER_OPACITY} />}
            {(filter === 'time' || filter === 'date') && <ShadowedText x={width / 2} y={height * 0.42} size={72} weight="600">{stamp.time}</ShadowedText>}
            {filter === 'date' && <ShadowedText x={width / 2} y={height * 0.42 + 36} size={20} weight="400">{stamp.date}</ShadowedText>}
            {lines.length > 0 && (
              <G y={bandTop}>
                <Rect width={width} height={bandHeight} fill={colors.overlay} />
                {lines.map((line, index) => (
                  <SvgText
                    key={index}
                    x={width / 2}
                    y={CAPTION_PADDING + CAPTION_LINE_HEIGHT * index + CAPTION_FONT}
                    fontSize={CAPTION_FONT}
                    fill={colors.background}
                    textAnchor="middle"
                  >
                    {line}
                  </SvgText>
                ))}
              </G>
            )}
          </Svg>
        )}
        <View collapsable={false} style={StyleSheet.absoluteFill} accessibilityLabel="Toucher pour écrire, glisser pour changer de filtre" {...pan.panHandlers} />
      </View>

      <View style={[styles.textButton, { top: topInset + spacing.md }]}>
        <IconButton onPress={() => setDraft(caption)} label="Ajouter du texte" style={styles.round}>
          <Type size={24} color={colors.background} strokeWidth={1.75} />
        </IconButton>
      </View>

      <View style={[styles.filters, { bottom: bottomSpace }]}>
        {FILTERS.map(({ filter: value, label }) => (
          <Pressable
            key={value}
            onPress={() => setFilter(value)}
            accessibilityState={{ selected: filter === value }}
            style={[styles.chip, filter === value && styles.chipOn]}
          >
            <Text style={[styles.chipLabel, filter === value && styles.chipLabelOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {draft !== null && (
        <View style={styles.writing}>
          <TextInput
            autoFocus
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={commitDraft}
            submitBehavior="blurAndSubmit"
            maxLength={CAPTION_MAX_LENGTH}
            placeholder="Écrivez quelque chose"
            placeholderTextColor={colors.onDarkMuted}
            multiline
            textAlign="center"
          />
          <IconButton onPress={commitDraft} label="Valider le texte" style={styles.round}>
            <Check size={24} color={colors.background} strokeWidth={2} />
          </IconButton>
        </View>
      )}
    </>
  );
}

const useStyles = createMediaStyles((colors) => ({
  canvas: {
    position: 'absolute',
  },
  textButton: {
    position: 'absolute',
    alignSelf: 'center',
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filters: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
  },
  chipOn: {
    backgroundColor: colors.background,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.background,
  },
  chipLabelOn: {
    color: colors.text,
  },
  writing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingTop: '30%',
    gap: spacing.md,
    backgroundColor: colors.overlay,
  },
  input: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: CAPTION_FONT,
    color: colors.background,
    backgroundColor: colors.overlay,
  },
}));
