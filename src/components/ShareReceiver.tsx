import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { addShareListener, setShareShortcuts, SharedMedia, takeSharedMedia } from '../../modules/pear-native';
import { getContactProfile, getLastMessage } from '../chat/database';
import { openMedia } from '../chat/media';
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
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const sendRef = useRef<(items: SharedMedia[], keys: string[]) => Promise<void>>(async () => {});

  const check = useCallback(() => {
    takeSharedMedia()
      .then((items) => {
        if (items.length === 0) return;
        // Choisi directement dans le menu Partager : le contact est déjà connu, pas de sélecteur.
        const target = items[0].contact;
        if (target && contactsRef.current.some((contact) => contact.publicKey === target && !contact.pending)) void sendRef.current(items, [target]);
        else setShared(items);
      })
      .catch((e) => log.warn('partage reçu', e));
  }, []);

  // Les 4 contacts les plus récents sont proposés directement dans le menu Partager d'Android.
  const recent = contacts
    .filter((contact) => !contact.pending)
    .map((contact) => ({ key: contact.publicKey, name: contact.name, at: getLastMessage(contact.publicKey)?.created_at ?? 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 4);
  // Chaque raccourci porte la photo de profil du contact : le menu Partager l'affiche en grand, avec la
  // petite icône de Pear en badge. La photo, chiffrée sur le disque, est lue depuis sa copie déchiffrée.
  const recentJson = JSON.stringify(recent.map(({ key, name }) => ({ key, name, photo: getContactProfile(key).photo_uri })));
  useEffect(() => {
    if (!ready) return;
    const wanted: { key: string; name: string; photo: string | null }[] = JSON.parse(recentJson);
    let cancelled = false;
    Promise.all(
      wanted.map(async ({ key, name, photo }) => {
        try {
          const path = photo ? decodeURI((await openMedia(photo, { scope: 'app' })).replace(/^file:[/][/]/, '')) : undefined;
          return { key, name, photo: path };
        } catch (e) {
          log.warn('photo du raccourci', e);
          return { key, name };
        }
      }),
    )
      .then((shortcuts) => (cancelled ? undefined : setShareShortcuts(shortcuts)))
      .catch((e) => log.warn('raccourcis de partage', e));
    return () => {
      cancelled = true;
    };
  }, [ready, recentJson]);

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

  const sendTo = async (items: SharedMedia[], keys: string[]) => {
    try {
      for (const [index, key] of keys.entries()) {
        for (const item of items) {
          // L'envoi déplace le fichier du cache : chaque contact sauf le dernier reçoit une copie.
          const video = item.mime.startsWith('video/');
          await chat.sendFile(key, {
            uri: item.uri,
            name: video ? 'video.mp4' : 'photo.jpg',
            size: item.size,
            mime: item.mime,
            kind: video ? 'video' : 'image',
            keepSource: index < keys.length - 1,
          });
        }
      }
      if (keys[0]) onSent(keys[0]);
    } catch (e) {
      showDialog(t('chat.envoiImpossible'), String(e));
    }
  };
  sendRef.current = sendTo;
  const send = (keys: string[]) => {
    const items = shared;
    setShared(null);
    return sendTo(items, keys);
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
