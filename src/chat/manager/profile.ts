import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { deleteOldAvatars, getContactProfile, getSetting, setContactProfileField, setSetting } from '../database';
import { deleteStoredFile, exportCopy, storeOutgoingFile } from '../files';

import { ChatCore } from './core';
import { sendEvent } from './outbox';
import { sendFile } from './transfers';
import { FILE_ID_BYTES, PROFILE_NAME, PROFILE_PHOTO, PROFILE_VERSION } from './types';

export function getMyProfile() {
  return { name: getSetting(PROFILE_NAME), photo: getSetting(PROFILE_PHOTO) };
}

export async function saveProfile(core: ChatCore, name: string, photoUri: string | null) {
  const current = getMyProfile();
  let photo = photoUri;
  if (photoUri && photoUri !== current.photo) {
    photo = await storeOutgoingFile(photoUri, to_base64(randombytes_buf(FILE_ID_BYTES)));
  }
  if (current.photo && current.photo !== photo) deleteStoredFile(current.photo);
  setSetting(PROFILE_NAME, name || null);
  setSetting(PROFILE_PHOTO, photo);
  setSetting(PROFILE_VERSION, to_base64(randombytes_buf(16)));
  core.names.forEach((_, contact) => shareProfile(core, contact));
  core.notify();
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
    .catch((e) => console.warn('Pear photo de profil :', e));
}
