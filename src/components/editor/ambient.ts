import { PermissionsAndroid, Platform } from 'react-native';

import { batteryStatus, lastKnownLocation } from '../../../modules/pear-native';
import { getSetting, getStreakState, setSetting } from '../../chat/database';
import { loadContacts } from '../../storage';
import { nearestCity } from './cities';
import { Ambient, STAMP_VARIANTS, StampKind } from './stamps';

// Tout ce que les filtres d'ambiance lisent sur le téléphone. Rien ne sort de l'appareil : la position
// est approximative, lue localement, et la ville se trouve dans une liste embarquée (cities.ts).

// Demande l'autorisation de position approximative, une seule fois par installation (si on refuse, le
// filtre Lieu ne dessine rien et on ne redemande pas).
export async function askPlacePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
  if (await PermissionsAndroid.check(permission)) return true;
  if (getSetting('place_permission_asked') === '1') return false;
  setSetting('place_permission_asked', '1');
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

// La plus longue série en cours parmi les conversations : l'éditeur ne sait pas pour quel contact on prend la photo.
async function bestStreak(): Promise<number> {
  try {
    const contacts = await loadContacts();
    return contacts.reduce((best, contact) => Math.max(best, getStreakState(contact.publicKey).count), 0);
  } catch {
    return 0;
  }
}

// Ce que le filtre choisi a besoin de savoir, et rien d'autre (la position n'est lue que pour Lieu).
export async function readAmbient(kind: StampKind | undefined): Promise<Partial<Ambient>> {
  try {
    if (kind === 'place') {
      const position = (await askPlacePermission()) ? lastKnownLocation() : null;
      return { place: position ? nearestCity(position) : null };
    }
    if (kind === 'battery') return { battery: batteryStatus() };
    if (kind === 'streak') return { streak: await bestStreak() };
  } catch {
    // Une lecture qui échoue donne une marque vide, jamais une erreur.
  }
  return {};
}

// Le style typographique choisi pour chaque marque, gardé d'une fois sur l'autre.
const styles = new Map<StampKind, number>();

export function getStampStyle(kind: StampKind): number {
  const known = styles.get(kind);
  if (known !== undefined) return known;
  const saved = Number(getSetting(`stamp_style.${kind}`) ?? 0);
  const value = Number.isInteger(saved) && saved >= 0 && saved < STAMP_VARIANTS[kind] ? saved : 0;
  styles.set(kind, value);
  return value;
}

// Passe au style suivant, en tournant, et le renvoie.
export function nextStampStyle(kind: StampKind): number {
  const value = (getStampStyle(kind) + 1) % STAMP_VARIANTS[kind];
  styles.set(kind, value);
  setSetting(`stamp_style.${kind}`, String(value));
  return value;
}
