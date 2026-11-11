import { File, Paths } from 'expo-file-system';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { resizeImage } from '../../../modules/pear-native';

import { deleteOldAvatars, getContactProfile, getSetting, setContactProfileField, setSetting } from '../database';
import { deleteStoredFile } from '../files';
import { exportCopy, storeOutgoingFile } from '../media';

import { ChatCore } from './core';
import { sendEvent } from './outbox';
import { sendFile } from './transfers';
import { FILE_ID_BYTES, PROFILE_NAME, PROFILE_PHOTO, PROFILE_VERSION } from './types';
import { log } from '../../log';

const AVATAR_MAX_SIZE = 512;
const AVATAR_QUALITY = 82;

export function getMyProfile() {
  return { name: getSetting(PROFILE_NAME), photo: getSetting(PROFILE_PHOTO) };
}

export async function saveProfile(core: ChatCore, name: string, photoUri: string | null) {
  const current = getMyProfile();
  let photo = photoUri;
  if (photoUri && photoUri !== current.photo) {
    // Réduite avant d'être gardée et envoyée : une photo trop lourde serait refusée par les contacts
    // (photo de profil limitée à 2 Mo), et elle passe plus vite.
    const small = new File(Paths.cache, `avatar-${to_base64(randombytes_buf(8))}.jpg`).uri;
    const source = await resizeImage(photoUri, small, AVATAR_MAX_SIZE, AVATAR_QUALITY).catch((e) => {
      log.warn('réduction de la photo de profil', e);
      return photoUri;
    });
    photo = await storeOutgoingFile(source, to_base64(randombytes_buf(FILE_ID_BYTES)));
  }
  if (current.photo && current.photo !== photo) deleteStoredFile(current.photo);
  setSetting(PROFILE_NAME, name || null);
  setSetting(PROFILE_PHOTO, photo);
  setSetting(PROFILE_VERSION, to_base64(randombytes_buf(16)));
  core.names.forEach((_, contact) => shareProfile(core, contact));
  core.notify();
}

// Un contact qui vient d'accepter notre demande : notre profil lui est renvoyé (le premier envoi a pu
// partir avant qu'il nous ait enregistré).
export function reshareProfile(core: ChatCore, contact: string) {
  setContactProfileField(contact, 'sent_version', null);
  shareProfile(core, contact);
}

export function shareProfile(core: ChatCore, contact: string) {
  const version = getSetting(PROFILE_VERSION);
  if (!version || getContactProfile(contact).sent_version === version) return;
  setContactProfileField(contact, 'sent_version', version);
  const { name, photo } = getMyProfile();
  sendEvent(core, contact, { action: 'profile', id: '', name, hasPhoto: photo !== null });
  deleteOldAvatars(contact, 1, null);
  if (!photo) return;
  // Une copie par contact : l'envoi déplace le fichier qu'il reçoit.
  exportCopy(photo, `avatar-${to_base64(randombytes_buf(8))}.jpg`)
    .then((uri) => sendFile(core, contact, { uri, name: 'avatar.jpg', size: 0, mime: 'image/jpeg', kind: 'avatar' }))
    .catch((e) => log.warn('photo de profil', e));
}
