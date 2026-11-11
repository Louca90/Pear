// Position en direct (lot 4.8) : règles sans dépendance au téléphone, testées avec Jest.
// Un partage est un message de type « location » dont le texte est ce JSON, mis à jour à chaque
// nouvelle position. Les positions ne voyagent que par la connexion directe (chiffrées par le ratchet),
// jamais par push ni par le relais : sans connexion, rien ne part et rien n'attend sur un serveur.

export const LOCATION_DURATIONS = [15 * 60, 3600, 8 * 3600] as const;
// Durée la plus longue acceptée d'un contact, avec une marge pour une horloge décalée.
const MAX_SHARE_MS = (8 * 3600 + 600) * 1000;

export type SharedLocation = {
  latitude: number;
  longitude: number;
  // Heure de cette position (horloge de celui qui partage).
  at: number;
  // Fin du partage. Passée (ou égale à at) : le partage est terminé.
  until: number;
};

const isCoordinate = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

// Une position reçue de l'autre téléphone, ou relue dans la base. null si un champ n'est pas valide.
export function parseLocation(value: unknown): SharedLocation | null {
  if (value === null || typeof value !== 'object') return null;
  const { latitude, longitude, at, until } = value as Record<string, unknown>;
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180) || !isTime(at) || !isTime(until)) return null;
  // Une fin trop lointaine est ramenée à la durée maximale.
  return { latitude, longitude, at, until: Math.min(until, at + MAX_SHARE_MS) };
}

export function parseLocationText(text: string): SharedLocation | null {
  try {
    return parseLocation(JSON.parse(text));
  } catch {
    return null;
  }
}

export const locationText = (location: SharedLocation) => JSON.stringify(location);

export const isSharing = (location: SharedLocation, now: number) => location.until > now && location.until > location.at;

const RAD = Math.PI / 180;

export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = (b.latitude - a.latitude) * RAD;
  const dLon = (b.longitude - a.longitude) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Cap de a vers b, en degrés depuis le nord (0 à 360, sens des aiguilles d'une montre).
export function bearing(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLon = (b.longitude - a.longitude) * RAD;
  const y = Math.sin(dLon) * Math.cos(b.latitude * RAD);
  const x = Math.cos(a.latitude * RAD) * Math.sin(b.latitude * RAD) - Math.sin(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const COMPASS = ['n', 'ne', 'e', 'se', 's', 'so', 'o', 'no'] as const;
export type CompassPoint = (typeof COMPASS)[number];

export function compassPoint(degrees: number): CompassPoint {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

// « 800 m », « 3,4 km », « 120 km » : la position est approximative, on n'affiche pas plus fin que 100 m.
export function formatDistance(km: number, decimal = ','): string {
  if (km < 1) return `${Math.max(100, Math.round((km * 1000) / 100) * 100)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', decimal)} km`;
  return `${Math.round(km)} km`;
}

// Lien « geo: » : ouvre la position dans l'app de cartes du téléphone, au choix de la personne.
export const geoLink = ({ latitude, longitude }: { latitude: number; longitude: number }) => `geo:${latitude.toFixed(5)},${longitude.toFixed(5)}?q=${latitude.toFixed(5)},${longitude.toFixed(5)}`;
