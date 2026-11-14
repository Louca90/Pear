import { NetworkManager, OfflineManager } from '@maplibre/maplibre-react-native';

import { getSetting, setSetting } from '../chat/database';
import { log } from '../log';
import { regionBounds, RegionBounds } from './region';

// La carte de Pear est hors ligne (choix du 13 nov.) : une zone est téléchargée une seule fois, à la
// demande, puis gardée sur le téléphone. Le reste du temps, MapLibre n'a pas le droit d'aller sur le
// réseau : aucune tuile ne part chercher l'endroit qu'on regarde, rien ne fuit pendant l'utilisation.
// Pendant le téléchargement, le serveur de cartes (OpenFreeMap, sans compte ni clé) voit seulement
// quelle zone est demandée, une fois.

// « Positron » en clair, « Dark » en sombre : discrets, comme le reste de Pear. Les deux styles partagent
// les mêmes tuiles : la seconde zone ne télécharge presque que le style lui-même.
export const MAP_STYLES = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
export const mapStyleFor = (dark: boolean) => (dark ? MAP_STYLES.dark : MAP_STYLES.light);
const REGION_KEY = 'map_region';
// Jusqu'au zoom 14, les tuiles vectorielles gardent rues et noms ; au-delà, la carte agrandit le 14.
const MIN_ZOOM = 4;
const MAX_ZOOM = 14;
// Rayon de la zone autour de la position : une ville et ses environs.
export const REGION_RADIUS_KM = 25;

// packIds : une zone par style (clair, sombre). packId : ancien format (un seul style).
export type MapRegion = { packIds: string[]; bounds: RegionBounds; at: number };

// Par défaut, hors réseau : appelé au lancement de chaque carte.
export function keepMapOffline() {
  try {
    NetworkManager.setConnected(false);
  } catch (e) {
    log.warn('carte', e);
  }
}

export function savedRegion(): MapRegion | null {
  try {
    const value = JSON.parse(getSetting(REGION_KEY) ?? 'null') as (MapRegion & { packId?: string }) | null;
    if (!value || !Array.isArray(value.bounds)) return null;
    const packIds = Array.isArray(value.packIds) ? value.packIds : typeof value.packId === 'string' ? [value.packId] : [];
    return packIds.length > 0 ? { packIds, bounds: value.bounds, at: value.at } : null;
  } catch {
    return null;
  }
}

// Télécharge la zone autour de `center` (rayon REGION_RADIUS_KM). `onProgress` reçoit 0 à 1. La zone
// précédente est effacée une fois la nouvelle complète.
export async function downloadRegion(center: { latitude: number; longitude: number }, onProgress: (fraction: number) => void): Promise<MapRegion> {
  const bounds = regionBounds(center, REGION_RADIUS_KM);
  const previous = savedRegion();
  NetworkManager.setConnected(true);
  try {
    const styles = [MAP_STYLES.light, MAP_STYLES.dark];
    const packIds: string[] = [];
    for (const [index, mapStyle] of styles.entries()) {
      // Le premier style compte pour 90 % (il apporte les tuiles), le second pour le reste.
      const from = index === 0 ? 0 : 0.9;
      const span = index === 0 ? 0.9 : 0.1;
      packIds.push(await downloadPack(mapStyle, bounds, (fraction) => onProgress(from + fraction * span)));
    }
    const region: MapRegion = { packIds, bounds, at: Date.now() };
    setSetting(REGION_KEY, JSON.stringify(region));
    for (const id of previous?.packIds ?? []) if (!packIds.includes(id)) OfflineManager.deletePack(id).catch((e) => log.warn('carte', e));
    return region;
  } finally {
    NetworkManager.setConnected(false);
  }
}

function downloadPack(mapStyle: string, bounds: RegionBounds, onProgress: (fraction: number) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    OfflineManager.createPack(
      { mapStyle, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, metadata: { name: 'pear' } },
      (pack, status) => {
        onProgress(Math.min(1, status.percentage / 100));
        if (status.state === 'complete' && !settled) {
          settled = true;
          resolve(pack.id);
        }
      },
      (_pack, error) => {
        if (settled) return;
        settled = true;
        reject(new Error(error.message));
      },
    ).catch((e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}
export async function deleteRegion() {
  const region = savedRegion();
  setSetting(REGION_KEY, null);
  for (const id of region?.packIds ?? []) await OfflineManager.deletePack(id).catch((e) => log.warn('carte', e));
}
