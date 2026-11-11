import { describe, expect, it } from '@jest/globals';

import { ftsQuery, likePattern, searchExcerpt, searchWords } from './search';

describe('recherche de messages', () => {
  it('découpe la recherche en mots, sans la ponctuation', () => {
    expect(searchWords('  Rendez-vous à 18h !')).toEqual(['rendez', 'vous', 'à', '18h']);
    expect(searchWords('"*:()')).toEqual([]);
  });

  it('construit une requête FTS5 où rien n’est un opérateur', () => {
    expect(ftsQuery('bonj NOT "x" OR')).toBe('"bonj"* "not"* "x"* "or"*');
    expect(ftsQuery('   ')).toBe('');
  });

  it('neutralise les caractères spéciaux de LIKE', () => {
    expect(likePattern(' 100%_ok ')).toBe('%100\\%\\_ok%');
  });

  it('montre un extrait autour du mot trouvé', () => {
    const text = 'a'.repeat(100) + ' la clé est sous le pot ' + 'b'.repeat(100);
    const excerpt = searchExcerpt(text, 'cle');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('clé est sous');
    expect(searchExcerpt('Salut toi', 'salut')).toBe('Salut toi');
  });
});
