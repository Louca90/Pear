import { useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { randombytes_buf, to_hex } from 'react-native-libsodium';

import { log } from '../log';
import { getSetting, setSetting } from './database';
import { firstLink, parsePreview } from './linkPreviewParse';
import type { LinkPreview } from './meta';
import { smallJpeg } from './thumb';

// Aperçu des liens (lot 4.3). C'est l'expéditeur qui lit la page, sur son téléphone, quand il écrit un
// lien : le titre et une petite image partent chiffrés avec le message. Le destinataire ne contacte
// jamais le site. Réglage « Aperçu des liens » : coupé, aucune page n'est lue.

const TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// L'image doit tenir dans le message : deux essais, du plus net au plus léger.
const IMAGE_STEPS = [
  { size: 240, quality: 60 },
  { size: 160, quality: 45 },
];
const MAX_IMAGE_CHARS = 16000;
// Tant qu'on tape : la page n'est lue qu'une fois le lien stable.
const DEBOUNCE_MS = 700;

export const linkPreviewsEnabled = () => getSetting('link_previews') !== '0';

export function setLinkPreviewsEnabled(value: boolean) {
  setSetting('link_previews', value ? null : '0');
}

async function fetchWithTimeout(url: string, accept: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Sans cookies ni identifiant : le site ne voit qu'une visite anonyme.
    return await fetch(url, { signal: controller.signal, credentials: 'omit', headers: { Accept: accept } });
  } finally {
    clearTimeout(timer);
  }
}

const tooBig = (response: Response, max: number) => Number(response.headers.get('content-length') ?? 0) > max;

async function fetchImage(url: string): Promise<string | undefined> {
  const response = await fetchWithTimeout(url, 'image/*');
  if (!response.ok || tooBig(response, MAX_IMAGE_BYTES) || !(response.headers.get('content-type') ?? '').startsWith('image/')) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return undefined;
  const original = new File(Paths.cache, `pear-link-${to_hex(randombytes_buf(8))}`);
  try {
    original.create({ overwrite: true });
    original.write(bytes);
    for (const step of IMAGE_STEPS) {
      const image = await smallJpeg(original.uri, step.size, step.quality);
      if (image.length <= MAX_IMAGE_CHARS) return image;
    }
    return undefined;
  } finally {
    if (original.exists) original.delete();
  }
}

// Lit la page et prépare son aperçu. null si la page ne répond pas, n'est pas du HTML ou n'a pas de titre.
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const response = await fetchWithTimeout(url, 'text/html');
  if (!response.ok || tooBig(response, MAX_PAGE_BYTES) || !(response.headers.get('content-type') ?? '').includes('html')) return null;
  const parsed = parsePreview(await response.text(), url);
  if (!parsed) return null;
  let image: string | undefined;
  if (parsed.imageUrl) {
    image = await fetchImage(parsed.imageUrl).catch((e) => {
      log.warn('image du lien', e);
      return undefined;
    });
  }
  return { url: parsed.url, title: parsed.title, site: parsed.site, ...(image ? { image } : {}) };
}

export type DraftPreview = { url: string; preview: LinkPreview | null; loading: boolean };

// L'aperçu du premier lien du brouillon. dismiss le retire (croix) : ce lien-là ne sera plus proposé
// dans ce brouillon.
export function useDraftPreview(draft: string, active: boolean): { current: DraftPreview | null; dismiss: () => void } {
  const [state, setState] = useState<DraftPreview | null>(null);
  const dismissed = useRef(new Set<string>());
  const cache = useRef(new Map<string, LinkPreview | null>());
  const url = active ? firstLink(draft) : null;

  useEffect(() => {
    if (!draft) dismissed.current.clear();
  }, [draft]);

  useEffect(() => {
    if (!url || dismissed.current.has(url) || !linkPreviewsEnabled()) {
      setState(null);
      return;
    }
    if (cache.current.has(url)) {
      const preview = cache.current.get(url) ?? null;
      setState(preview ? { url, preview, loading: false } : null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setState({ url, preview: null, loading: true });
      fetchLinkPreview(url)
        .catch((e) => {
          log.warn('aperçu du lien', e);
          return null;
        })
        .then((preview) => {
          cache.current.set(url, preview);
          if (!cancelled) setState(preview ? { url, preview, loading: false } : null);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  return {
    current: state && state.url === url ? state : null,
    dismiss: () => {
      if (url) dismissed.current.add(url);
      setState(null);
    },
  };
}
