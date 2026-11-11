// Recherche dans les messages (lot 4.1) : fonctions pures, testées avec Jest.

// Les mots d'une recherche : lettres et chiffres, le reste sépare. Au plus 8 mots de 40 caractères.
export function searchWords(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((word) => word.slice(0, 40));
}

// La requête FTS5 : tous les mots, chacun pris comme un début de mot (« bonj » trouve « bonjour »).
// Chaque mot est entre guillemets : rien de ce que l'on tape n'est lu comme un opérateur.
export function ftsQuery(query: string): string {
  return searchWords(query)
    .map((word) => `"${word}"*`)
    .join(' ');
}

// Le motif LIKE de secours (SQLite sans FTS5) : le texte tel quel, caractères spéciaux neutralisés.
export function likePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Un extrait d'une ligne autour du premier mot trouvé, avec « … » si le texte est coupé.
export function searchExcerpt(text: string, query: string, radius = 36): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const folded = fold(flat);
  let at = -1;
  for (const word of searchWords(query)) {
    const found = folded.indexOf(fold(word));
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  // Les accents retirés peuvent décaler la position de quelques caractères : sans importance pour un extrait.
  const start = at <= radius ? 0 : at - radius;
  const end = Math.min(flat.length, Math.max(at, 0) + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
