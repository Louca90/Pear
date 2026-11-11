// Ce qu'un message transporte en plus de son texte ou de son fichier (vague 4) : rangé en JSON dans la
// colonne meta, et envoyé chiffré avec le message. Tout ce qui vient de l'autre téléphone repasse par
// sanitizeMeta : rien n'est gardé sans avoir été vérifié et borné.

export type LinkPreview = {
  url: string;
  title: string;
  site?: string;
  // Petite image JPEG en base64, préparée par l'expéditeur.
  image?: string;
};

export type MessageMeta = {
  // Forme d'onde d'un vocal (lot 4.2) : un chiffre hexadécimal par barre.
  wave?: string;
  // Miniature floue (lot 4.4) : JPEG de 32 points en base64, affichée pendant la réception.
  thumb?: string;
  // Aperçu d'un lien (lot 4.3), préparé par l'expéditeur.
  preview?: LinkPreview;
  // Sticker maison (lot 4.9) : image affichée sans cadre.
  sticker?: boolean;
};

export const WAVE_BARS = 32;
const MAX_THUMB_CHARS = 4000;
const MAX_PREVIEW_IMAGE_CHARS = 16000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const isBase64 = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && BASE64.test(value);

function sanitizePreview(value: unknown): LinkPreview | null {
  if (value === null || typeof value !== 'object') return null;
  const { url, title, site, image } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url.length > 2000 || !/^https?:\/\//i.test(url)) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  return {
    url,
    title: title.slice(0, 200),
    ...(typeof site === 'string' && site.trim() ? { site: site.slice(0, 80) } : {}),
    ...(isBase64(image, MAX_PREVIEW_IMAGE_CHARS) ? { image } : {}),
  };
}

// Ne garde que les champs connus et valides. null s'il ne reste rien.
export function sanitizeMeta(value: unknown): MessageMeta | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const meta: MessageMeta = {};
  if (typeof input.wave === 'string' && new RegExp(`^[0-9a-f]{${WAVE_BARS}}$`).test(input.wave)) meta.wave = input.wave;
  if (isBase64(input.thumb, MAX_THUMB_CHARS)) meta.thumb = input.thumb;
  const preview = sanitizePreview(input.preview);
  if (preview) meta.preview = preview;
  if (input.sticker === true) meta.sticker = true;
  return Object.keys(meta).length > 0 ? meta : null;
}

// La colonne meta d'un message, relue. Toujours un objet.
export function parseMeta(raw: string | null | undefined): MessageMeta {
  if (!raw) return {};
  try {
    return sanitizeMeta(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

export function encodeMeta(meta: MessageMeta | null | undefined): string | null {
  const clean = sanitizeMeta(meta);
  return clean ? JSON.stringify(clean) : null;
}

// --- Forme d'onde d'un vocal ---

// Niveaux du micro (dB, de -160 à 0) relevés pendant l'enregistrement → WAVE_BARS barres de 0 à 15.
// Chaque barre prend le niveau le plus fort de sa tranche ; -50 dB et moins = silence.
export function encodeWave(levels: number[]): string | undefined {
  if (levels.length === 0) return undefined;
  const FLOOR = -50;
  let wave = '';
  for (let bar = 0; bar < WAVE_BARS; bar += 1) {
    const from = Math.floor((bar * levels.length) / WAVE_BARS);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / WAVE_BARS));
    let peak = -160;
    for (let index = from; index < to && index < levels.length; index += 1) peak = Math.max(peak, levels[index]);
    const ratio = Math.max(0, Math.min(1, (peak - FLOOR) / -FLOOR));
    wave += Math.round(ratio * 15).toString(16);
  }
  return wave;
}

// Les barres, de 0 à 1. null si la forme d'onde est absente ou invalide.
export function decodeWave(wave: string | undefined): number[] | null {
  if (!wave || wave.length !== WAVE_BARS) return null;
  const bars = [...wave].map((char) => parseInt(char, 16) / 15);
  return bars.some(Number.isNaN) ? null : bars;
}
