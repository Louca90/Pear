import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Pressable, Text, View } from 'react-native';
import { Link2, X } from 'lucide-react-native';

import type { DraftPreview } from '../../../chat/linkPreview';
import type { LinkPreview } from '../../../chat/meta';
import { jpegDataUri } from '../../../chat/thumb';
import { IconButton } from '../../../components/ui';
import { t } from '../../../i18n';
import { log } from '../../../log';
import { BubblePalette, createStyles, motion, radius, spacing, useColors } from '../../../theme';

// Aperçu d'un lien dans une bulle (lot 4.3) : tout vient du message, rien n'est demandé au site.
// Un appui ouvre le lien dans le navigateur.
export function LinkPreviewCard({ preview, palette }: { preview: LinkPreview; palette: BubblePalette }) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={() => Linking.openURL(preview.url).catch((e) => log.warn('lien', e))}
      accessibilityRole="link"
      accessibilityLabel={preview.title}
      style={[styles.card, { backgroundColor: palette.track }]}
    >
      {preview.image && <Image source={{ uri: jpegDataUri(preview.image) }} style={styles.cardImage} resizeMode="cover" />}
      <View style={styles.cardText}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
          {preview.title}
        </Text>
        {preview.site && (
          <Text style={[styles.site, { color: palette.muted }]} numberOfLines={1}>
            {preview.site}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// Au-dessus de la saisie, pendant qu'on écrit un lien : ce qui partira avec le message, et une croix
// pour envoyer le lien sans aperçu.
export function DraftPreviewCard({ draft, onDismiss }: { draft: DraftPreview; onDismiss: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [appear]);

  return (
    <Animated.View style={[styles.draft, { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {draft.preview?.image ? (
        <Image source={{ uri: jpegDataUri(draft.preview.image) }} style={styles.draftImage} resizeMode="cover" />
      ) : (
        <View style={[styles.draftImage, styles.draftIcon]}>
          {draft.loading ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Link2 size={18} color={colors.textMuted} strokeWidth={1.75} />}
        </View>
      )}
      <View style={styles.draftText}>
        <Text style={styles.draftTitle} numberOfLines={1}>
          {draft.preview?.title ?? t('lien.chargement')}
        </Text>
        <Text style={styles.draftSite} numberOfLines={1}>
          {draft.preview?.site ?? draft.url}
        </Text>
      </View>
      <IconButton onPress={onDismiss} label={t('lien.retirer')} hitSlop={8}>
        <X size={18} color={colors.textMuted} strokeWidth={1.75} />
      </IconButton>
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  card: {
    width: 240,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardImage: {
    width: 240,
    height: 126,
  },
  cardText: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  site: {
    fontSize: 12,
  },
  draft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  draftImage: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
  },
  draftIcon: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftText: {
    flex: 1,
  },
  draftTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  draftSite: {
    fontSize: 12,
    color: colors.textMuted,
  },
}));
