import { describe, expect, it } from '@jest/globals';

import type { Message } from '../../chat/database';

import { dayLabel, emojiOnly, formatClock, formatTime, isBareMedia, isMediaDeleted, nextVoice, splitLinks, systemAction } from './format';

function message(fields: Partial<Message>): Message {
  return {
    id: 'id',
    contact: 'contact',
    mine: 0,
    text: '',
    status: 'delivered',
    created_at: 0,
    kind: 'text',
    file_uri: 'file:///media',
    file_size: null,
    file_mime: null,
    file_key: null,
    reply_to: null,
    edited: 0,
    my_reaction: null,
    their_reaction: null,
    ...fields,
  };
}

describe('formatTime', () => {
  it('affiche les heures et minutes sur deux chiffres', () => {
    expect(formatTime(new Date(2026, 0, 5, 7, 3).getTime())).toBe('07:03');
    expect(formatTime(new Date(2026, 0, 5, 23, 59).getTime())).toBe('23:59');
  });
});

describe('formatClock', () => {
  it('affiche minutes et secondes', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.6)).toBe('0:10');
    expect(formatClock(125)).toBe('2:05');
  });

  it('ne descend jamais sous zéro', () => {
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('isBareMedia', () => {
  it('affiche sans bulle les photos et vidéos reçues en entier', () => {
    expect(isBareMedia(message({ kind: 'image' }))).toBe(true);
    expect(isBareMedia(message({ kind: 'video', status: 'read' }))).toBe(true);
  });

  it('garde la bulle pendant la réception et pour les autres types', () => {
    expect(isBareMedia(message({ kind: 'image', status: 'receiving' }))).toBe(false);
    expect(isBareMedia(message({ kind: 'video', status: 'offered' }))).toBe(false);
    expect(isBareMedia(message({ kind: 'image', mine: 1, status: 'refused' }))).toBe(false);
    expect(isBareMedia(message({ kind: 'file' }))).toBe(false);
    expect(isBareMedia(message({ kind: 'text' }))).toBe(false);
  });
});

describe('systemAction', () => {
  it('décrit le fond de discussion', () => {
    expect(systemAction(message({ kind: 'wallpaper' }))).toBe('changé le fond de discussion');
    expect(systemAction(message({ kind: 'system', text: '' }))).toBe('retiré le fond de discussion');
  });

  it('décrit un média enregistré, de mon côté et du sien', () => {
    expect(systemAction(message({ kind: 'system', mine: 1, text: 'saved:video' }))).toBe('enregistré une vidéo sur votre téléphone');
    expect(systemAction(message({ kind: 'system', text: 'saved:image:yours' }))).toBe('enregistré votre photo sur son téléphone');
    expect(systemAction(message({ kind: 'system', text: 'saved:image:theirs' }))).toBe('enregistré sa photo sur son téléphone');
  });
});

describe('splitLinks', () => {
  it('repère les liens sans la ponctuation finale', () => {
    expect(splitLinks('voir https://pear.fr/a?b=1. merci')).toEqual([
      { text: 'voir ' },
      { text: 'https://pear.fr/a?b=1', url: 'https://pear.fr/a?b=1' },
      { text: '. merci' },
    ]);
  });

  it('ajoute https:// aux liens www et laisse le texte simple intact', () => {
    expect(splitLinks('www.exemple.com')).toEqual([{ text: 'www.exemple.com', url: 'https://www.exemple.com' }]);
    expect(splitLinks('rien à voir')).toEqual([{ text: 'rien à voir' }]);
  });
});

describe('isMediaDeleted', () => {
  it('reconnaît un média dont le fichier a été supprimé, pas un texte ni un média en cours', () => {
    expect(isMediaDeleted(message({ kind: 'image', file_uri: null }))).toBe(true);
    expect(isMediaDeleted(message({ kind: 'audio', file_uri: null, status: 'read' }))).toBe(true);
    expect(isMediaDeleted(message({ kind: 'image' }))).toBe(false);
    expect(isMediaDeleted(message({ kind: 'text', file_uri: null }))).toBe(false);
    expect(isMediaDeleted(message({ kind: 'video', file_uri: null, status: 'offered' }))).toBe(false);
    expect(isBareMedia(message({ kind: 'image', file_uri: null }))).toBe(false);
  });
});

describe('emojiOnly', () => {
  it('compte 1 à 3 emojis seuls, assemblages et drapeaux compris', () => {
    expect(emojiOnly('😀')).toBe(1);
    expect(emojiOnly(' 😀 👍🏽 ')).toBe(2);
    expect(emojiOnly('👨‍👩‍👧')).toBe(1);
    expect(emojiOnly('🇫🇷❤️🔥')).toBe(3);
  });

  it('refuse le texte, les chiffres et plus de 3 emojis', () => {
    expect(emojiOnly('ok 😀')).toBe(0);
    expect(emojiOnly('12')).toBe(0);
    expect(emojiOnly('😀😀😀😀')).toBe(0);
    expect(emojiOnly('')).toBe(0);
  });
});

describe('nextVoice', () => {
  const voice = (id: string, mine = 0, fields: Partial<Message> = {}) => message({ id, kind: 'audio', mine, ...fields });

  it('enchaîne sur le vocal juste en dessous, du même auteur', () => {
    // Liste inversée : l'index 0 est le plus récent.
    const list = [voice('c'), voice('b'), voice('a')];
    expect(nextVoice(list, 2)).toBe('b');
    expect(nextVoice(list, 1)).toBe('c');
    expect(nextVoice(list, 0)).toBeUndefined();
  });

  it("s'arrête sur un autre auteur, un texte ou un vocal pas encore arrivé", () => {
    expect(nextVoice([voice('b', 1), voice('a')], 1)).toBeUndefined();
    expect(nextVoice([message({ id: 'b' }), voice('a')], 1)).toBeUndefined();
    expect(nextVoice([voice('b', 0, { status: 'receiving' }), voice('a')], 1)).toBeUndefined();
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 10, 10, 15).getTime();
  it("dit aujourd'hui et hier, puis la date", () => {
    expect(dayLabel(new Date(2026, 10, 10, 1).getTime(), now, 'fr-FR')).toBe("Aujourd'hui");
    expect(dayLabel(new Date(2026, 10, 9, 23).getTime(), now, 'fr-FR')).toBe('Hier');
    expect(dayLabel(new Date(2025, 0, 2).getTime(), now, 'fr-FR')).toContain('2025');
  });
});
