import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { ReduceMotion, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';

import { deleteSticker, listStickers, Sticker } from '../../../chat/stickers';
import { showDialog } from '../../../components/dialog';
import { MediaPicker } from '../../../components/MediaPicker';
import { Sheet } from '../../../components/Sheet';
import { haptics } from '../../../haptics';
import { t } from '../../../i18n';
import { EASE } from '../../../motion';
import { createStyles, useColors } from '../../../theme';

import { LONG_PRESS_MS } from '../constants';
import { StickerCutter } from './StickerCutter';

const COLUMNS = 4;
const GAP = 8;
const SIDE = 18;

// Les cases arrivent par vagues, de gauche à droite puis ligne par ligne, en grandissant à peine.
function cellIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const config = { duration: 260, easing: EASE, reduceMotion: ReduceMotion.System };
    const delay = 60 + (Math.floor(index / COLUMNS) + (index % COLUMNS)) * 35;
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.85 }] },
      animations: { opacity: withDelay(delay, withTiming(1, config)), transform: [{ scale: withDelay(delay, withTiming(1, config)) }] },
    };
  };
}

// Mes stickers (lot 4.9, feuille du bas commune) : un appui envoie, un appui long propose de supprimer.
// La première case en crée un : on choisit une photo, puis on entoure au doigt ce qu'on veut garder.
export function StickerSheet({ onSend, onClose }: { onSend: (sticker: Sticker) => void; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [stickers, setStickers] = useState(listStickers);
  const [picking, setPicking] = useState(false);
  const [cutting, setCutting] = useState<string | null>(null);
  const cell = Math.floor((width - SIDE * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

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
    <Sheet title={t('stickers.titre')} onClose={onClose}>
      {(close) => (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
            <Reanimated.View entering={cellIn(0)}>
              <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={t('stickers.nouveau')} style={({ pressed }) => [styles.cell, styles.add, { width: cell, height: cell }, pressed && styles.pressed]}>
                <View style={styles.plus}>
                  <Plus size={20} color={colors.onSignature} strokeWidth={2.4} />
                </View>
              </Pressable>
            </Reanimated.View>
            {stickers.map((sticker, index) => (
              <Reanimated.View key={sticker.id} entering={cellIn(index + 1)}>
                <Pressable
                  onPress={() => close(() => onSend(sticker))}
                  onLongPress={() => confirmDelete(sticker)}
                  delayLongPress={LONG_PRESS_MS}
                  accessibilityRole="button"
                  accessibilityLabel={t('stickers.envoyer')}
                  style={({ pressed }) => [styles.cell, { width: cell, height: cell }, pressed && styles.pressed]}
                >
                  <Image source={{ uri: sticker.uri }} style={{ width: cell - 12, height: cell - 12 }} resizeMode="contain" />
                </Pressable>
              </Reanimated.View>
            ))}
          </ScrollView>
          {stickers.length === 0 && <Text style={styles.empty}>{t('stickers.vide')}</Text>}
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
        </>
      )}
    </Sheet>
  );
}

const useStyles = createStyles((colors) => ({
  scroll: { maxHeight: 360 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: { borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  add: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: 'transparent' },
  plus: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.signature },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  empty: { fontSize: 14, lineHeight: 19, textAlign: 'center', color: colors.textMuted },
}));
