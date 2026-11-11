import { describe, expect, it } from '@jest/globals';
import { albumAt } from './grouping';

import { GROUP_GAP_MS, groupPosition, sameGroup, SessionTracker } from './grouping';

const at = new Date(2026, 10, 7, 12, 0, 0).getTime();
const msg = (fields: Partial<{ mine: number; kind: string; created_at: number; conn_session: number | null }> = {}) => ({
  mine: 1,
  kind: 'text',
  created_at: at,
  conn_session: 1,
  ...fields,
});

describe('sameGroup', () => {
  it('groupe deux messages du même auteur, proches et de la même session', () => {
    expect(sameGroup(msg(), msg({ created_at: at + 30_000 }))).toBe(true);
  });

  it('sépare auteurs différents, écart trop grand, autre session et messages système', () => {
    expect(sameGroup(msg(), msg({ mine: 0 }))).toBe(false);
    expect(sameGroup(msg(), msg({ created_at: at + GROUP_GAP_MS }))).toBe(false);
    expect(sameGroup(msg(), msg({ conn_session: 2 }))).toBe(false);
    expect(sameGroup(msg(), msg({ kind: 'system' }))).toBe(false);
  });

  it('sans session (anciens messages), groupe sur l’écart de temps seul', () => {
    expect(sameGroup(msg({ conn_session: null }), msg({ conn_session: 5, created_at: at + 1000 }))).toBe(true);
  });
});

describe('groupPosition (liste inversée : index 0 = le plus récent)', () => {
  it('donne premier, milieu, dernier et seul', () => {
    // De bas en haut : 3 messages groupés, puis un message de l'autre.
    const list = [msg({ created_at: at + 2000 }), msg({ created_at: at + 1000 }), msg({ created_at: at }), msg({ mine: 0, created_at: at - 1000 })];
    expect(groupPosition(list, 0)).toBe('last');
    expect(groupPosition(list, 1)).toBe('middle');
    expect(groupPosition(list, 2)).toBe('first');
    expect(groupPosition(list, 3)).toBe('single');
  });
});

describe('SessionTracker', () => {
  it('garde la session tant que les messages se suivent, en ouvre une après une pause ou une connexion', () => {
    const sessions = new SessionTracker();
    const first = sessions.current('a', 'direct', at);
    expect(sessions.current('a', 'direct', at + 60_000)).toBe(first);
    expect(sessions.current('a', 'direct', at + 60_000 + GROUP_GAP_MS)).not.toBe(first);
    const second = sessions.current('a', 'direct', at + 10 * GROUP_GAP_MS);
    sessions.forget('a');
    expect(sessions.current('a', 'direct', at + 10 * GROUP_GAP_MS + 1000)).not.toBe(second);
    expect(sessions.current('a', 'remote', at)).not.toBe(sessions.current('b', 'remote', at + 1));
  });
});

describe('albumAt', () => {
  const media = (id: string, album: string | null, extra: Record<string, unknown> = {}) => ({ id, mine: 1, kind: 'image', status: 'delivered', album, file_uri: 'file:///x', ...extra });
  // Liste inversée : le plus récent d'abord.
  const list = [media('c', 'A'), media('b', 'A'), media('a', 'A'), { ...media('t', null), kind: 'text' }, media('seul', 'B')];

  it('regroupe les médias voisins du même album, le plus récent dessine la grille', () => {
    expect(albumAt(list, 0)).toEqual({ lead: true, members: [list[2], list[1], list[0]] });
    expect(albumAt(list, 1)?.lead).toBe(false);
    expect(albumAt(list, 2)?.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('laisse en bulle un message hors album ou seul dans le sien', () => {
    expect(albumAt(list, 3)).toBeNull();
    expect(albumAt(list, 4)).toBeNull();
  });

  it('ne fait pas de grille si un média attend un accord, est refusé ou supprimé', () => {
    expect(albumAt([media('b', 'A', { status: 'offered' }), media('a', 'A')], 1)).toBeNull();
    expect(albumAt([media('b', 'A', { file_uri: null }), media('a', 'A')], 0)).toBeNull();
    expect(albumAt([media('b', 'A', { status: 'receiving' }), media('a', 'A')], 0)?.members).toHaveLength(2);
  });

  it('ne mélange pas les médias de deux auteurs', () => {
    expect(albumAt([media('b', 'A', { mine: 0 }), media('a', 'A')], 0)).toBeNull();
  });
});
