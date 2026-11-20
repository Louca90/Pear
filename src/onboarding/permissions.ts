import { Linking, PermissionsAndroid, Platform } from 'react-native';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library/legacy';

import {
  canRequestPackageInstalls,
  canUseFullScreenIntent,
  openFullScreenIntentSettings,
  isIgnoringBatteryOptimizations,
  openUnknownAppSourcesSettings,
  requestIgnoreBatteryOptimizations,
} from '../../modules/pear-native';
import { getSetting } from '../chat/database';
import { askPlacePermission } from '../components/editor/ambient';
import { log } from '../log';

// Les autorisations que Pear demande. Batterie et apps inconnues s'accordent dans les réglages
// d'Android : leur état se relit au retour dans l'app.

export type PermissionId = 'notifications' | 'battery' | 'camera' | 'media' | 'location' | 'install' | 'fullScreen';
// blocked : refusée pour de bon, il faut passer par les réglages de l'app.
export type PermissionState = 'granted' | 'missing' | 'blocked';

// Ce sans quoi les messages n'arrivent pas ou Pear ne se met pas à jour : c'est ce que surveille le
// bandeau « une autorisation manque » de l'accueil. Galerie et position restent facultatives.
export const PERMISSIONS: PermissionId[] = ['notifications', 'camera', 'battery', 'install'];

// Les cartes de la prise en main, dans l'ordre de la maquette.
export const ONBOARDING_PERMISSIONS: PermissionId[] = ['notifications', 'battery', 'camera', 'media', 'location'];

// Position refusée pour de bon pendant cette session (Android ne le dit qu'au moment de la demande).
let locationBlocked = false;

export async function checkPermission(id: PermissionId): Promise<PermissionState> {
  try {
    if (id === 'notifications') {
      const { authorizationStatus } = await notifee.getNotificationSettings();
      return authorizationStatus === AuthorizationStatus.AUTHORIZED ? 'granted' : 'missing';
    }
    if (id === 'camera') {
      const [camera, microphone] = await Promise.all([Camera.getCameraPermissionsAsync(), Camera.getMicrophonePermissionsAsync()]);
      if (camera.granted && microphone.granted) return 'granted';
      return (!camera.granted && !camera.canAskAgain) || (!microphone.granted && !microphone.canAskAgain) ? 'blocked' : 'missing';
    }
    if (id === 'media') {
      const { granted, canAskAgain } = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      return granted ? 'granted' : canAskAgain ? 'missing' : 'blocked';
    }
    if (id === 'location') {
      if (Platform.OS !== 'android') return 'missing';
      if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)) return 'granted';
      return locationBlocked ? 'blocked' : 'missing';
    }
    if (id === 'battery') return isIgnoringBatteryOptimizations() ? 'granted' : 'missing';
    if (id === 'fullScreen') return canUseFullScreenIntent() ? 'granted' : 'missing';
    return canRequestPackageInstalls() ? 'granted' : 'missing';
  } catch (e) {
    log.warn('autorisation', e);
    return 'missing';
  }
}

export async function checkPermissions(ids: PermissionId[]): Promise<Partial<Record<PermissionId, PermissionState>>> {
  const states = await Promise.all(ids.map(checkPermission));
  return Object.fromEntries(ids.map((id, index) => [id, states[index]]));
}

// Les autorisations essentielles (bandeau de l'accueil).
export async function checkAllPermissions(): Promise<Partial<Record<PermissionId, PermissionState>>> {
  return checkPermissions(PERMISSIONS);
}

// Demande l'autorisation, ou ouvre le bon réglage. Renvoie l'état connu juste après (batterie et apps
// inconnues se relisent au retour dans l'app).
export async function requestPermission(id: PermissionId, state: PermissionState): Promise<PermissionState> {
  if (state === 'blocked') {
    await Linking.openSettings();
    return state;
  }
  if (id === 'notifications') {
    const { authorizationStatus } = await notifee.requestPermission();
    if (authorizationStatus === AuthorizationStatus.AUTHORIZED) return 'granted';
    // Android ne redemande plus après deux refus : la suite passe par les réglages.
    return 'blocked';
  }
  if (id === 'camera') {
    // Appareil photo puis micro (vidéos et vocaux), l'un après l'autre.
    const camera = await Camera.requestCameraPermissionsAsync();
    if (!camera.granted) return camera.canAskAgain ? 'missing' : 'blocked';
    const microphone = await Camera.requestMicrophonePermissionsAsync();
    return microphone.granted ? 'granted' : microphone.canAskAgain ? 'missing' : 'blocked';
  }
  if (id === 'media') {
    const { granted, canAskAgain } = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    return granted ? 'granted' : canAskAgain ? 'missing' : 'blocked';
  }
  if (id === 'location') {
    if (Platform.OS !== 'android') return 'missing';
    // Première fois : la même demande que le filtre Lieu (qui retient qu'elle a été faite). Ensuite,
    // c'est un appui explicite sur « Autoriser » : on redemande directement.
    if (getSetting('place_permission_asked') !== '1') return (await askPlacePermission()) ? 'granted' : 'missing';
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    locationBlocked = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
    return locationBlocked ? 'blocked' : 'missing';
  }
  if (id === 'battery') requestIgnoreBatteryOptimizations();
  else if (id === 'fullScreen') openFullScreenIntentSettings();
  else openUnknownAppSourcesSettings();
  return 'missing';
}
