import { NetworkManager, OfflineManager } from '@maplibre/maplibre-react-native';

import { getSetting, setSetting } from '../chat/database';
import { log } from '../log';
import { regionBounds, RegionBounds } from './region';

// La carte de Pear est hors ligne (choix du 13 nov.) : une zone est téléchargée une seule fois, à la
// demande, puis gardée sur le téléphone. Le reste du temps, MapLibre n'a pas le droit d'aller sur le
// réseau : aucune tuile ne part chercher l'endroit qu'on regarde, rien ne fuit pendant l'utilisation.
// Pendant le téléchargement, le serveur de cartes (OpenFreeMap, sans compte ni clé) voit seulement
// quelle zone est demandée, une fois.

// Le style « Positron » : noir et blanc discret, comme le reste de Pear.
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const REGION_KEY = 'map_region';
// Jusqu'au zoom 14, les tuiles vectorielles gardent rues et noms ; au-delà, la carte agrandit le 14.
const MIN_ZOOM = 4;
const MAX_ZOOM = 14;
// Rayon de la zone autour de la position : une ville et ses environs.
export const REGION_RADIUS_KM = 25;

export type MapRegion = { packId: string; bounds: RegionBounds; at: number };

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
    const value = JSON.parse(getSetting(REGION_KEY) ?? 'null') as MapRegion | null;
    return value && typeof value.packId === 'string' && Array.isArray(value.bounds) ? value : null;
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
    const region = await new Promise<MapRegion>((resolve, reject) => {
      let settled = false;
      OfflineManager.createPack(
        { mapStyle: MAP_STYLE, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, metadata: { name: 'pear' } },
        (pack, status) => {
          onProgress(Math.min(1, status.percentage / 100));
          if (status.state === 'complete' && !settled) {
            settled = true;
            resolve({ packId: pack.id, bounds, at: Date.now() });
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
    setSetting(REGION_KEY, JSON.stringify(region));
    if (previous && previous.packId !== region.packId) OfflineManager.deletePack(previous.packId).catch((e) => log.warn('carte', e));
    return region;
  } finally {
    NetworkManager.setConnected(false);
  }
}

export async function deleteRegion() {
  const region = savedRegion();
  setSetting(REGION_KEY, null);
  if (region) await OfflineManager.deletePack(region.packId).catch((e) => log.warn('carte', e));
}
