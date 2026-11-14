// La zone de carte gardée sur le téléphone : un carré autour d'un point. Fonctions pures, testées.

// [ouest, sud, est, nord], en degrés (ordre de MapLibre).
export type RegionBounds = [number, number, number, number];

const KM_PER_DEGREE = 111.32;

export function regionBounds(center: { latitude: number; longitude: number }, radiusKm: number): RegionBounds {
  const dLat = radiusKm / KM_PER_DEGREE;
  // Les méridiens se rapprochent vers les pôles : un degré de longitude couvre moins de kilomètres.
  const cos = Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  const dLon = radiusKm / (KM_PER_DEGREE * cos);
  const clampLat = (value: number) => Math.max(-85, Math.min(85, value));
  return [center.longitude - dLon, clampLat(center.latitude - dLat), center.longitude + dLon, clampLat(center.latitude + dLat)];
}

export function insideRegion(bounds: RegionBounds, point: { latitude: number; longitude: number }) {
  const [west, south, east, north] = bounds;
  return point.longitude >= west && point.longitude <= east && point.latitude >= south && point.latitude <= north;
}
