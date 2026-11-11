import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, Text, View } from 'react-native';
import { Pencil, Play, Reply, X } from 'lucide-react-native';

import { describeMessage, Message } from '../../../chat/database';
import { useMediaPreview } from '../../../chat/media';
import { IconButton } from '../../../components/ui';
import { t } from '../../../i18n';
import { createStyles, radius, spacing, useColors } from '../../../theme';

const OPEN_MS = 220;
const CLOSE_MS = 180;

type Mode = { kind: 'reply' | 'edit'; message: Message };

// Miniature d'une photo ou d'une vidéo citée.
export function Thumbnail({ message, size = 40 }: { message: Message; size?: number }) {
  const colors = useColors();
  const styles = useStyles();
  // Photo déchiffrée ou miniature de la vidéo (lot 2.3).
  const uri = useMediaPreview(message);
  if (!uri) return null;
  return (
    <View style={[styles.thumbnail, { width: size, height: size }]}>
      <Image source={{ uri }} style={styles.thumbnailImage} resizeMode="cover" />
      {message.kind === 'video' && (
        <View style={styles.thumbnailPlay}>
          <Play size={12} color={colors.onMedia} fill={colors.onMedia} strokeWidth={1.75} />
        </View>
      )}
    </View>
  );
}

// Au-dessus de la saisie : la réponse en cours (ou la modification). La carte s'ouvre en glissant vers
// le haut (hauteur et fondu) et se referme de même ; la liste s'ajuste sans saut.
export function ComposerModeCard({ mode, name, onCancel, onJump }: { mode: Mode | null; name: string; onCancel: () => void; onJump: (id: string) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [shown, setShown] = useState<Mode | null>(mode);
  const [height, setHeight] = useState(0);
  const open = useRef(new Animated.Value(mode ? 1 : 0)).current;

  useEffect(() => {
    if (mode) setShown(mode);
    Animated.timing(open, { toValue: mode ? 1 : 0, duration: mode ? OPEN_MS : CLOSE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !mode) setShown(null);
    });
  }, [mode, open]);

  if (!shown) return null;
  const { kind, message } = shown;
  const author = message.mine === 1 ? t('chat.vousMeme') : name;
  const media = message.kind === 'image' || message.kind === 'video';

  return (
    <Animated.View style={[styles.wrapper, { height: height ? open.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) : undefined, opacity: open }]}>
      <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)} style={styles.measure}>
        <Pressable
          onPress={() => kind === 'reply' && onJump(message.id)}
          style={({ pressed }) => [styles.card, pressed && kind === 'reply' && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={kind === 'reply' ? t('chat.repondreA', { nom: author }) : t('chat.modifierMessage')}
        >
          <View style={[styles.accent, { backgroundColor: message.mine === 1 ? colors.accent : colors.textMuted }]} />
          {kind === 'edit' ? <Pencil size={16} color={colors.text} strokeWidth={1.75} /> : <Reply size={16} color={colors.text} strokeWidth={1.75} />}
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {kind === 'edit' ? t('chat.modifierMessage') : t('chat.repondreA', { nom: author })}
            </Text>
            <Text style={styles.preview} numberOfLines={2}>{describeMessage(message)}</Text>
          </View>
          {media && <Thumbnail message={message} />}
          <IconButton onPress={onCancel} label={t('commun.annuler')} style={styles.close}>
            <X size={16} color={colors.text} strokeWidth={2} />
          </IconButton>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  wrapper: {
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  measure: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
  accent: {
    alignSelf: 'stretch',
    width: 4,
    marginRight: 4,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  preview: {
    fontSize: 13,
    color: colors.textMuted,
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.elevatedActive,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.elevatedActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
