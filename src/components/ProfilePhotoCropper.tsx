import { ComponentRef, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Image, Modal, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { File, Paths } from 'expo-file-system';

import { captureView } from '../../modules/pear-native';
import { showDialog } from './dialog';
import { CropPanel } from './editor/CropPanel';
import { Crop, cropGeometry, fullRect } from './editor/crop';
import { t } from '../i18n';
import { log } from '../log';
import { useInsets } from './ui';

// Côté de la copie cachée, en points, et taille maximale du fichier produit (réduit ensuite à la
// taille d'un avatar par saveProfile).
const EXPORT_POINTS = 320;
const EXPORT_PIXELS = 1080;

type Size = { width: number; height: number };
type Props = { uri: string; onDone: (uri: string) => void; onCancel: () => void };

// Photo de profil : avant de l'enregistrer, on la recadre en carré (un cercle montre ce qui restera)
// et on peut la tourner. Le carré gardé est dessiné dans une vue cachée, puis enregistré tel quel.
export function ProfilePhotoCropper({ uri, onDone, onCancel }: Props) {
  const { bottom } = useInsets();
  const [size, setSize] = useState<Size | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const exportRoot = useRef<ComponentRef<typeof View>>(null);

  useEffect(() => {
    Image.getSize(uri)
      .then(({ width, height }) => setSize({ width, height }))
      .catch((e) => {
        log.warn('photo de profil', e);
        onCancel();
      });
  }, [uri, onCancel]);

  const square = { width: EXPORT_POINTS, height: EXPORT_POINTS };
  const geometry = size && crop ? cropGeometry(size, crop, square) : null;

  // Le recadrage choisi : la copie cachée est dessinée, puis capturée deux images plus tard.
  useEffect(() => {
    if (!geometry) return;
    const scale = Math.min(geometry.pixelsPerPoint, EXPORT_PIXELS / EXPORT_POINTS);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const tag = findNodeHandle(exportRoot.current);
        if (!tag) {
          log.warn('photo de profil', 'vue de recadrage introuvable, photo gardée entière');
          onDone(uri);
          return;
        }
        const output = new File(Paths.cache, `profil-${Date.now()}.png`).uri;
        captureView(tag, output, Math.max(1, scale)).then((result) => {
          log.info('photo de profil', `recadrée ${Math.round(EXPORT_POINTS * scale)} px`);
          onDone(result);
        }, (e) => {
          log.warn('photo de profil', e);
          showDialog(t('profil.photoImpossible'), e instanceof Error ? e.message : String(e));
          onCancel();
        });
      }),
    );
    // Une seule capture par recadrage validé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        {geometry && (
          <View ref={exportRoot} collapsable={false} pointerEvents="none" style={[styles.export, square]}>
            <Image
              source={{ uri }}
              resizeMode="stretch"
              style={{
                position: 'absolute',
                left: geometry.image.left,
                top: geometry.image.top,
                width: geometry.image.width,
                height: geometry.image.height,
                transform: [{ rotate: `${geometry.image.rotation}deg` }],
              }}
            />
          </View>
        )}
        {/* Pendant la capture, la copie reste cachée sous un fond noir (captureView dessine la vue elle-même). */}
        {crop && <View style={[StyleSheet.absoluteFill, styles.root]} />}
        {size && !crop && <CropPanel uri={uri} image={size} crop={{ rotation: 0, rect: fullRect(size, 0, 1) }} lockedAspect="1:1" bottom={bottom} onDone={setCrop} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  // Hors de l'écran mais dessinée : captureView lit la vue elle-même.
  export: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
    opacity: 1,
  },
});
