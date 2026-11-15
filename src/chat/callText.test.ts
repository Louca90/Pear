import { describe, expect, it } from '@jest/globals';

import { formatCallDuration, parseCallRecord } from './callText';

describe('lignes d’appel', () => {
  it('lit les lignes écrites à la fin d’un appel', () => {
    expect(parseCallRecord('call:done:v:125')).toEqual({ outcome: 'done', video: true, seconds: 125 });
    expect(parseCallRecord('call:missed:a')).toEqual({ outcome: 'missed', video: false, seconds: null });
    expect(parseCallRecord('call:network:a')?.outcome).toBe('network');
  });

  it('ignore les autres messages système', () => {
    expect(parseCallRecord('saved:image:yours')).toBeNull();
    expect(parseCallRecord('call:autre:a')).toBeNull();
    expect(parseCallRecord('call:done:x:3')).toBeNull();
  });

  it('écrit la durée en minutes et secondes', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(42)).toBe('0:42');
    expect(formatCallDuration(187)).toBe('3:07');
    expect(formatCallDuration(3729)).toBe('1:02:09');
  });
});
