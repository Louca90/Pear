import { describe, expect, it } from '@jest/globals';

import { decideOffer, PENDING_QUOTA_BYTES } from './limits';

const MB = 1024 * 1024;

describe('decideOffer', () => {
  it('accepte sans rien demander sous la limite de chaque type', () => {
    expect(decideOffer('image', 5 * MB, 0)).toBe('accept');
    expect(decideOffer('video', 99 * MB, 0)).toBe('accept');
    expect(decideOffer('avatar', 1 * MB, 0)).toBe('accept');
    expect(decideOffer('wallpaper', 9 * MB, 0)).toBe('accept');
  });

  it('demande au-dessus de la limite pour une photo, une vidéo ou un fichier', () => {
    expect(decideOffer('image', 30 * MB, 0)).toBe('ask');
    expect(decideOffer('video', 140 * MB, 0)).toBe('ask');
    expect(decideOffer('file', 1500 * MB, 0)).toBe('ask');
  });

  it('refuse une photo de profil ou un fond d’écran trop lourd', () => {
    expect(decideOffer('avatar', 3 * MB, 0)).toBe('refuse');
    expect(decideOffer('wallpaper', 11 * MB, 0)).toBe('refuse');
  });

  it('demande quand le contact a déjà trop de fichiers en attente', () => {
    expect(decideOffer('image', 5 * MB, PENDING_QUOTA_BYTES - MB)).toBe('ask');
    expect(decideOffer('avatar', 1 * MB, PENDING_QUOTA_BYTES)).toBe('refuse');
  });
});
