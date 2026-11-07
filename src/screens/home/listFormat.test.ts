import { describe, expect, it } from '@jest/globals';

import { matchesSearch, previewFor, relativeTime } from './listFormat';

describe('liste des conversations', () => {
  const last = (mine: number) => ({ mine, created_at: 1000 });

  it('applique la règle des non-lus : nombre exact jusqu’à 4, puis « +4 nouveaux messages »', () => {
    expect(previewFor(null, 0)).toEqual({ kind: 'none' });
    expect(previewFor(last(0), 1)).toEqual({ kind: 'unread', count: 1 });
    expect(previewFor(last(0), 4)).toEqual({ kind: 'unread', count: 4 });
    expect(previewFor(last(0), 5)).toEqual({ kind: 'many' });
    expect(previewFor(last(0), 30)).toEqual({ kind: 'many' });
  });

  it('remplace l’aperçu par « Envoyé / Reçu il y a » une fois la conversation lue', () => {
    expect(previewFor(last(1), 0)).toEqual({ kind: 'status', mine: true, at: 1000 });
    expect(previewFor(last(0), 0)).toEqual({ kind: 'status', mine: false, at: 1000 });
  });

  it('formate l’heure relative', () => {
    const now = Date.UTC(2026, 10, 7, 12, 0);
    expect(relativeTime(now - 20 * 1000, now)).toBe('à l’instant');
    expect(relativeTime(now - 5 * 60 * 1000, now)).toBe('il y a 5 min');
    expect(relativeTime(now - 2 * 3600 * 1000, now)).toBe('il y a 2 h');
    expect(relativeTime(now - 3 * 24 * 3600 * 1000, now)).toBe('il y a 3 j');
    expect(relativeTime(now - 10 * 24 * 3600 * 1000, now)).toMatch(/28 oct/);
  });

  it('cherche sans tenir compte des accents ni des majuscules', () => {
    expect(matchesSearch('Élodie', 'elodie')).toBe(true);
    expect(matchesSearch('Élodie', 'LOD')).toBe(true);
    expect(matchesSearch('Élodie', 'marc')).toBe(false);
    expect(matchesSearch('Élodie', '  ')).toBe(true);
  });
});
