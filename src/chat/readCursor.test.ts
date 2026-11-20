import { describe, expect, it } from '@jest/globals';

import { advancesCursor, cursorToSend, latestReadId } from './readCursor';

const m = (id: string, created_at: number, status: string, mine = 0) => ({ id, created_at, status, mine });

describe('curseur de lecture', () => {
  it('prend le dernier message reçu lu, pas les miens ni les non lus', () => {
    expect(latestReadId([m('a', 1, 'read'), m('b', 2, 'read-pending'), m('c', 3, 'delivered'), m('d', 4, 'read', 1)])).toBe('b');
    expect(latestReadId([m('c', 3, 'delivered')])).toBeNull();
  });

  it('renvoie le curseur tant qu’il n’est pas confirmé', () => {
    expect(cursorToSend('b', null)).toBe('b');
    expect(cursorToSend('b', 'a')).toBe('b');
    expect(cursorToSend('b', 'b')).toBeNull();
    expect(cursorToSend(null, null)).toBeNull();
  });

  it('un curseur plus ancien ou identique ne fait pas reculer l’état', () => {
    expect(advancesCursor(10, 5)).toBe(false);
    expect(advancesCursor(10, 10)).toBe(false);
    expect(advancesCursor(10, 11)).toBe(true);
  });
});
