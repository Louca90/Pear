import { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { File, Paths } from 'expo-file-system';

import { cropImage, nativeImageSize } from '../../modules/pear-native';
import { showDialog } from './dialog';
import { CropPanel } from './editor/CropPanel';
import { Crop, fullRect } from './editor/crop';
import { t } from '../i18n';
import { log } from '../log';
import { useInsets } from './ui';

// Taille du carré produit : saveProfile le réduit ensuite à la taille d'un avatar.
const OUTPUT_PIXELS = 1080;
const OUTPUT_QUALITY = 92;

type Size = { width: number; height: number };
type Props = { uri: string; onClose: () => void; onDone: (uri: string) => void };

// Photo de profil : avant de l'enregistrer, on la recadre en carré (un cercle montre ce qui restera)
// et on peut la tourner. « Terminé » ferme tout de suite ; le recadrage se fait en natif, hors du fil
// de l'interface, puis la photo arrive (onDone).
export function ProfilePhotoCropper({ uri, onClose, onDone }: Props) {
  const { bottom } = useInsets();
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    // La taille vue (orientation EXIF comprise) : le cadre doit avoir les proportions de l'image affichée.
    const measure = nativeImageSize ? nativeImageSize(uri) : Image.getSize(uri);
    measure
      .then(({ width, height }) => setSize({ width, height }))
      .catch((e) => {
        log.warn('photo de profil', e);
        onClose();
      });
    // Mesurée une seule fois par photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const finish = (crop: Crop) => {
    onClose();
    const output = new File(Paths.cache, `profil-${Date.now()}.jpg`).uri;
    cropImage(uri, output, crop.rect, crop.rotation, OUTPUT_PIXELS, OUTPUT_QUALITY).then(onDone, (e) => {
      log.warn('photo de profil', e);
      showDialog(t('profil.photoImpossible'), e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        {size && <CropPanel uri={uri} image={size} crop={{ rotation: 0, rect: fullRect(size, 0, 1) }} lockedAspect="1:1" bottom={bottom} onDone={finish} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
