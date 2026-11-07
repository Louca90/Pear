import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { addShareListener, SharedMedia, takeSharedMedia } from '../../modules/pear-native';
import { chat } from '../chat/manager';
import { t } from '../i18n';
import { log } from '../log';
import { Contact } from '../storage';
import { ContactPickerSheet } from './ContactPickerSheet';
import { showDialog } from './dialog';

// Photos et vidéos partagées vers Pear depuis la galerie ou une autre app (lot 12) : on choisit un ou
// plusieurs contacts, chacun reçoit sa propre copie, chiffrée avec sa propre clé, puis la conversation
// s'ouvre. Rien ne part sans ce choix.
export function ShareReceiver({ contacts, ready, onSent }: { contacts: Contact[]; ready: boolean; onSent: (publicKey: string) => void }) {
  const [shared, setShared] = useState<SharedMedia[] | null>(null);

  const check = useCallback(() => {
    takeSharedMedia()
      .then((items) => {
        if (items.length > 0) setShared(items);
      })
      .catch((e) => log.warn('partage reçu', e));
  }, []);

  useEffect(() => {
    if (!ready) return;
    check();
    const share = addShareListener(check);
    const state = AppState.addEventListener('change', (next) => next === 'active' && check());
    return () => {
      share.remove();
      state.remove();
    };
  }, [ready, check]);

  if (!shared) return null;

  const send = async (keys: string[]) => {
    const items = shared;
    setShared(null);
    try {
      for (const [index, key] of keys.entries()) {
        for (const item of items) {
          // L'envoi déplace le fichier du cache : chaque contact sauf le dernier reçoit une copie.
          let uri = item.uri;
          if (index < keys.length - 1) {
            const copy = new File(Paths.cache, `partage-${to_base64(randombytes_buf(8))}`);
            await new File(item.uri).copy(copy);
            uri = copy.uri;
          }
          const video = item.mime.startsWith('video/');
          await chat.sendFile(key, { uri, name: video ? 'video.mp4' : 'photo.jpg', size: item.size, mime: item.mime, kind: video ? 'video' : 'image' });
        }
      }
      if (keys[0]) onSent(keys[0]);
    } catch (e) {
      showDialog(t('chat.envoiImpossible'), String(e));
    }
  };

  return (
    <ContactPickerSheet
      title={shared.length > 1 ? t('partage.envoyerPlusieurs', { n: shared.length }) : t('partage.envoyer')}
      contacts={contacts.filter((contact) => !contact.pending)}
      onSend={send}
      onClose={() => setShared(null)}
    />
  );
}
