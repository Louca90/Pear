import { describe, expect, it } from '@jest/globals';

import { LOCK_DELAY_MS, shouldLock } from './lockRules';

describe('shouldLock', () => {
  it('verrouille après une minute en arrière-plan', () => {
    expect(shouldLock(true, 1000, 1000 + LOCK_DELAY_MS)).toBe(true);
  });
  it('ne verrouille pas avant une minute', () => {
    expect(shouldLock(true, 1000, 1000 + LOCK_DELAY_MS - 1)).toBe(false);
  });
  it('ne verrouille pas si le verrou est coupé ou sans passage en arrière-plan', () => {
    expect(shouldLock(false, 0, LOCK_DELAY_MS * 10)).toBe(false);
    expect(shouldLock(true, null, LOCK_DELAY_MS * 10)).toBe(false);
  });
});
