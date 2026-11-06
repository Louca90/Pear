import { describe, expect, it } from '@jest/globals';

import { isSupportedVersion, PROTOCOL_VERSION } from './protocol';

describe('version du protocole', () => {
  it('lit les messages des anciens téléphones (sans v) et de la version actuelle', () => {
    expect(isSupportedVersion({ type: 'message' })).toBe(true);
    expect(isSupportedVersion({ type: 'message', v: PROTOCOL_VERSION })).toBe(true);
  });

  it('refuse une version plus récente ou mal formée', () => {
    expect(isSupportedVersion({ type: 'message', v: PROTOCOL_VERSION + 1 })).toBe(false);
    expect(isSupportedVersion({ type: 'message', v: '1' })).toBe(false);
  });
});
