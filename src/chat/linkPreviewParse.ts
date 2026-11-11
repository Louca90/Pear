// Aperçu d'un lien (lot 4.3) : lecture de la page, sans dépendance au téléphone (testé avec Jest).

// Premier lien d'un texte : http(s)://… ou www.…, sans la ponctuation finale.
const LINK = /\b(?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]'"»]/i;

export function firstLink(text: string): string | null {
  const found = text.match(LINK)?.[0];
  if (!found) return null;
  return /^https?:\/\//i.test(found) ? found : `https://${found}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

// Les balises <meta> de la page : property ou name → content, dans les deux ordres d'attributs.
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attribute = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const key = attribute('property') ?? attribute('name');
    const content = attribute('content');
    if (!key || !content) continue;
    const name = (key[1] ?? key[2] ?? key[3] ?? '').toLowerCase();
    if (!tags.has(name)) tags.set(name, decodeEntities(content[1] ?? content[2] ?? content[3] ?? '').trim());
  }
  return tags;
}

export type ParsedPreview = { url: string; title: string; site: string; imageUrl: string | null };

// Le titre, le nom du site et l'adresse de l'image d'une page. null si la page n'a pas de titre.
export function parsePreview(html: string, url: string): ParsedPreview | null {
  const head = html.slice(0, 300_000);
  const tags = metaTags(head);
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = (tags.get('og:title') || tags.get('twitter:title') || (titleTag ? decodeEntities(titleTag) : '')).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const image = tags.get('og:image') || tags.get('og:image:url') || tags.get('twitter:image') || '';
  let imageUrl: string | null = null;
  if (image) {
    try {
      const resolved = new URL(image, url);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') imageUrl = resolved.toString();
    } catch {
      imageUrl = null;
    }
  }
  return { url, title: title.slice(0, 200), site: (tags.get('og:site_name') || host).slice(0, 80), imageUrl };
}
