import { ComponentRef, ReactNode, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Message } from '../chat/database';
import { useMediaUri } from '../chat/media';
import { haptics } from '../haptics';
import { MediaViewer, Viewing } from '../screens/chat/components/MediaViewer';

// Toucher la photo de profil l'affiche en grand, depuis le rond de l'avatar. Même visionneuse que les
// photos de la conversation (glisser pour fermer, pincer, double appui), sans enregistrer ni partager :
// c'est la photo de quelqu'un d'autre. Sans photo (initiales), seule une vibration légère.
export function AvatarViewer({ photoUri, label, children }: { photoUri: string | null | undefined; label: string; children: ReactNode }) {
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
      setViewing({ message, rect: { x, y, width, height }, poster: photo, size: { width: 1, height: 1 }, round: true });
    });
  };

  return (
    <>
      <Pressable onPress={open} accessibilityRole="imagebutton" accessibilityLabel={label}>
        <View ref={box} collapsable={false}>
          {children}
        </View>
      </Pressable>
      {viewing && <MediaViewer viewing={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
