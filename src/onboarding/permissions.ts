import { Linking } from 'react-native';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { Camera } from 'expo-camera';

import {
  canRequestPackageInstalls,
  isIgnoringBatteryOptimizations,
  openUnknownAppSourcesSettings,
  requestIgnoreBatteryOptimizations,
} from '../../modules/pear-native';
import { log } from '../log';

// Les autorisations dont Pear a besoin pour que les messages arrivent et que les mises à jour
// s'installent. Batterie et apps inconnues s'accordent dans les réglages d'Android : leur état se relit
// au retour dans l'app.

export type PermissionId = 'notifications' | 'camera' | 'battery' | 'install';
// blocked : refusée pour de bon, il faut passer par les réglages de l'app.
export type PermissionState = 'granted' | 'missing' | 'blocked';

export const PERMISSIONS: PermissionId[] = ['notifications', 'camera', 'battery', 'install'];

export async function checkPermission(id: PermissionId): Promise<PermissionState> {
  try {
    if (id === 'notifications') {
      const { authorizationStatus } = await notifee.getNotificationSettings();
      return authorizationStatus === AuthorizationStatus.AUTHORIZED ? 'granted' : 'missing';
    }
    if (id === 'camera') {
      const { granted, canAskAgain } = await Camera.getCameraPermissionsAsync();
      return granted ? 'granted' : canAskAgain ? 'missing' : 'blocked';
    }
    if (id === 'battery') return isIgnoringBatteryOptimizations() ? 'granted' : 'missing';
    return canRequestPackageInstalls() ? 'granted' : 'missing';
  } catch (e) {
    log.warn('autorisation', e);
    return 'missing';
  }
}

export async function checkAllPermissions(): Promise<Record<PermissionId, PermissionState>> {
  const states = await Promise.all(PERMISSIONS.map(checkPermission));
  return Object.fromEntries(PERMISSIONS.map((id, index) => [id, states[index]])) as Record<PermissionId, PermissionState>;
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
    const { granted, canAskAgain } = await Camera.requestCameraPermissionsAsync();
    return granted ? 'granted' : canAskAgain ? 'missing' : 'blocked';
  }
  if (id === 'battery') requestIgnoreBatteryOptimizations();
  else openUnknownAppSourcesSettings();
  return 'missing';
}
