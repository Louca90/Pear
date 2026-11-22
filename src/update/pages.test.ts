import { describe, expect, it } from '@jest/globals';

import { MAX_PAGES, pagesByTheme, pagesFor } from './pages';

describe('pages « Quoi de neuf »', () => {
  it('une version sans page garde la popup courte', () => {
    expect(pagesFor('0.0.0')).toEqual([]);
  });

  it('4 pages au plus par version', () => {
    expect(pagesFor('1.6.0').length).toBeLessThanOrEqual(MAX_PAGES);
    expect(pagesFor('1.6.0').length).toBeGreaterThan(0);
  });

  it('Découvrir Pear range les pages par thème', () => {
    const groups = pagesByTheme();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group.pages.every((page) => page.theme === group.theme)).toBe(true);
  });
});

describe('pages d’une version corrective', () => {
  const page = { theme: 'conversation' as const, titre: 'nouveautes.transfertTitre' as const, texte: 'nouveautes.transfertTexte' as const };
  const pages = { '1.9.0': [page] };

  it('reprend les pages de sa version quand elle n’en a pas', () => {
    expect(pagesFor('1.9.1', pages)).toEqual([page]);
    expect(pagesFor('1.9.0', pages)).toEqual([page]);
  });

  it('rien pour une autre version', () => {
    expect(pagesFor('1.10.0', pages)).toEqual([]);
  });
});
