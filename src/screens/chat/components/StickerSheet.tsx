import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';

import { deleteSticker, listStickers, Sticker } from '../../../chat/stickers';
import { showDialog } from '../../../components/dialog';
import { MediaPicker } from '../../../components/MediaPicker';
import { useNavigationBarHeight } from '../../../components/ui';
import { haptics } from '../../../haptics';
import { t } from '../../../i18n';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { LONG_PRESS_MS } from '../constants';
import { StickerCutter } from './StickerCutter';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const COLUMNS = 4;

// Mes stickers (lot 4.9) : un appui envoie, un appui long propose de supprimer. La première case en
// crée un : on choisit une photo, puis on entoure au doigt ce qu'on veut garder.
export function StickerSheet({ onSend, onClose }: { onSend: (sticker: Sticker) => void; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const bottom = useNavigationBarHeight();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const [stickers, setStickers] = useState(listStickers);
  const [picking, setPicking] = useState(false);
  const [cutting, setCutting] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const cell = width > 0 ? Math.floor((width - spacing.lg * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS) : 0;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true }).start(() => {
      onClose();
      then?.();
    });
  };

  const confirmDelete = (sticker: Sticker) => {
    haptics.action();
    showDialog(t('stickers.supprimerQuestion'), undefined, [
      {
        label: t('commun.supprimer'),
        style: 'danger',
        onPress: () => {
          deleteSticker(sticker.id);
          setStickers(listStickers());
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.sheet, { paddingBottom: bottom + spacing.md }, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] }]}
      >
        <Pressable onPress={() => close()} style={styles.header} accessibilityLabel={t('commun.fermer')}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('stickers.titre')}</Text>
        </Pressable>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={t('stickers.nouveau')} style={({ pressed }) => [styles.cell, styles.add, { width: cell, height: cell }, pressed && styles.pressed]}>
            <Plus size={24} color={colors.text} strokeWidth={1.75} />
          </Pressable>
          {stickers.map((sticker) => (
            <Pressable
              key={sticker.id}
              onPress={() => close(() => onSend(sticker))}
              onLongPress={() => confirmDelete(sticker)}
              delayLongPress={LONG_PRESS_MS}
              accessibilityRole="button"
              accessibilityLabel={t('stickers.envoyer')}
              style={({ pressed }) => [styles.cell, { width: cell, height: cell }, pressed && styles.pressed]}
            >
              <Image source={{ uri: sticker.uri }} style={{ width: cell - 8, height: cell - 8 }} resizeMode="contain" />
            </Pressable>
          ))}
        </ScrollView>
        {stickers.length === 0 && <Text style={styles.empty}>{t('stickers.vide')}</Text>}
      </Animated.View>
      {picking && (
        <MediaPicker
          single
          onClose={() => setPicking(false)}
          onPick={([file]) => {
            setPicking(false);
            if (file) setCutting(file.uri);
          }}
        />
      )}
      {cutting && (
        <StickerCutter
          sourceUri={cutting}
          onClose={() => setCutting(null)}
          onDone={() => {
            setCutting(null);
            setStickers(listStickers());
          }}
        />
      )}
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: spacing.lg,
  },
  scroll: {
    maxHeight: 340,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cell: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
  },
}));
