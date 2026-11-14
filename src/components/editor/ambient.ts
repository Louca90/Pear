import { PermissionsAndroid, Platform } from 'react-native';

import { batteryStatus, lastKnownLocation } from '../../../modules/pear-native';
import { getSetting, setSetting } from '../../chat/database';
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


// Ce que le filtre choisi a besoin de savoir, et rien d'autre (la position n'est lue que pour Lieu).
export async function readAmbient(kind: StampKind | undefined): Promise<Partial<Ambient>> {
  try {
    if (kind === 'place') {
      const position = (await askPlacePermission()) ? lastKnownLocation() : null;
      return { place: position ? nearestCity(position) : null };
    }
    if (kind === 'battery') return { battery: batteryStatus() };
  } catch {
    // Une lecture qui échoue donne une marque vide, jamais une erreur.
  }
  return {};
}

// Pour les vignettes de la rangée Ambiance : ce qui se lit sans rien demander. La batterie, et la ville
// seulement si la position est déjà permise (jamais de demande d'autorisation ici). Rien ne sort du
// téléphone : la marque n'est gravée que si on choisit le filtre.
export async function peekAmbient(): Promise<Partial<Ambient>> {
  const found: Partial<Ambient> = {};
  try {
    found.battery = batteryStatus();
  } catch {
    // Batterie illisible : la vignette montre une icône.
  }
  try {
    if (Platform.OS === 'android' && (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION))) {
      const position = lastKnownLocation();
      if (position) found.place = nearestCity(position);
    }
  } catch {
    // Position illisible : la vignette montre une icône.
  }
  return found;
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
