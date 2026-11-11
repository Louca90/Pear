import { describe, expect, it } from '@jest/globals';

import { trailingMediaRun } from './mediaRun';

const photo = { kind: 'image', mine: 0 };
const video = { kind: 'video', mine: 0 };
const text = { kind: 'text', mine: 0 };
const mine = { kind: 'image', mine: 1 };

describe('trailingMediaRun', () => {
  it('compte les médias reçus à la suite', () => {
    expect(trailingMediaRun([text, photo, photo, video], 3)).toEqual({ start: 1, photos: 2, videos: 1 });
  });
  it('s\'arrête au premier message qui n\'est pas un média reçu', () => {
    expect(trailingMediaRun([photo, mine, photo], 2)).toEqual({ start: 2, photos: 1, videos: 0 });
  });
  it('rien quand le dernier message reçu est un texte', () => {
    expect(trailingMediaRun([photo, text], 1)).toBeNull();
    expect(trailingMediaRun([], -1)).toBeNull();
  });
});
