import { ComponentRef, ReactNode, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Message } from '../chat/database';
import { useMediaUri } from '../chat/media';
import { haptics } from '../haptics';
import { t } from '../i18n';
import { MediaViewer, Viewing } from '../screens/chat/components/MediaViewer';

// Toucher la photo de profil l'affiche en grand, depuis le rond de l'avatar. Même visionneuse que les
// photos de la conversation (glisser pour fermer, pincer, double appui), sans enregistrer ni partager :
// c'est la photo de quelqu'un d'autre. Sans photo (initiales), seule une vibration légère.
export function AvatarViewer({ photoUri, label, name, children }: { photoUri: string | null | undefined; label: string; name?: string; children: ReactNode }) {
  const photo = useMediaUri(photoUri, { scope: 'app' });
  const box = useRef<ComponentRef<typeof View>>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);

  const open = () => {
    if (!photo) {
      haptics.select();
      return;
    }
    box.current?.measureInWindow((x, y, width, height) => {
      const message = { id: 'avatar', kind: 'image', file_uri: null, file_mime: null } as unknown as Message;
      setViewing({ message, rect: { x, y, width, height }, poster: photo, size: { width: 1, height: 1 }, round: true, title: name, subtitle: t('contact.photoProfil'), hint: t('contact.photoGeste') });
    });
  };

  return (
    <>
      <Pressable onPress={open} accessibilityRole="imagebutton" accessibilityLabel={label}>
        {/* Pendant le plein écran, l'avatar d'origine est caché : en glissant pour fermer, on ne voit qu'une photo.
            Il réapparaît quand la photo est revenue exactement à sa place. */}
        <View ref={box} collapsable={false} style={viewing ? { opacity: 0 } : null}>
          {children}
        </View>
      </Pressable>
      {viewing && <MediaViewer viewing={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
