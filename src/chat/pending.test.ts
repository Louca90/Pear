import { describe, expect, it } from '@jest/globals';

import { canRetry, countsAsAttempt, MAX_MANUAL_RETRIES, pendingLabel, pendingState, RETRY_AFTER_MS, retryAvailableAt, UNREACHABLE_AFTER_MS } from './pending';

const NOW = 1_000_000_000;
const message = (extra: object = {}) => ({ status: 'sending', created_at: NOW - 1000, last_attempt_at: null as number | null, ...extra });

describe('état d’un message en attente', () => {
  it('contact connecté : envoi en cours', () => {
    expect(pendingState(message(), true, true)).toEqual({ kind: 'sending' });
  });

  it('un essai est parti : en attente du contact, avec son heure', () => {
    expect(pendingState(message({ last_attempt_at: NOW - 60_000 }), false, true)).toEqual({ kind: 'waiting', lastTry: NOW - 60_000 });
  });

  it('rien n’est parti : pas encore envoyé, et pourquoi si le téléphone est hors ligne', () => {
    expect(pendingState(message(), false, true)).toEqual({ kind: 'not-sent', offline: false });
    expect(pendingState(message(), false, false)).toEqual({ kind: 'not-sent', offline: true });
  });

  it('rien à afficher pour un message distribué', () => {
    expect(pendingState(message({ status: 'delivered' }), false, true)).toBeNull();
  });
});

describe('essais', () => {
  it('un essai échoué sur le téléphone ne compte pas', () => {
    expect(countsAsAttempt(false)).toBe(false);
    expect(countsAsAttempt('failed')).toBe(false);
    expect(countsAsAttempt('limited')).toBe(false);
    expect(countsAsAttempt('expired')).toBe(false);
    expect(countsAsAttempt(true)).toBe(true);
    expect(countsAsAttempt('sent')).toBe(true);
  });
});

describe('Réessayer', () => {
  it('apparaît quand rien n’est parti depuis quelques minutes', () => {
    const recent = message({ last_attempt_at: NOW - 60_000 });
    expect(canRetry(recent, false, [], NOW)).toBe(false);
    expect(retryAvailableAt(recent, false, [], NOW)).toBe(NOW - 60_000 + RETRY_AFTER_MS);
    expect(canRetry(message({ last_attempt_at: NOW - RETRY_AFTER_MS }), false, [], NOW)).toBe(true);
  });

  it('sans aucun essai, compté depuis l’envoi', () => {
    expect(canRetry(message({ created_at: NOW - RETRY_AFTER_MS - 1 }), false, [], NOW)).toBe(true);
  });

  it('jamais pour un message distribué ni pendant que le contact est connecté', () => {
    const old = { created_at: NOW - 2 * RETRY_AFTER_MS };
    expect(canRetry(message({ ...old, status: 'delivered' }), false, [], NOW)).toBe(false);
    expect(canRetry(message(old), true, [], NOW)).toBe(false);
  });

  it('plafonné par heure, sur les seuls essais partis', () => {
    const old = message({ created_at: NOW - 2 * RETRY_AFTER_MS });
    const full = Array.from({ length: MAX_MANUAL_RETRIES }, (_, index) => NOW - index * 60_000);
    expect(canRetry(old, false, full, NOW)).toBe(false);
    // Plus d'une heure après, ils ne comptent plus.
    expect(canRetry(old, false, full, NOW + 61 * 60_000)).toBe(true);
  });
});

describe('libellé sous un message en attente', () => {
  const label = (extra: object, connected: boolean, online: boolean, now = NOW) => {
    const msg = message(extra);
    const state = pendingState(msg, connected, online);
    return state && pendingLabel(state, msg, now);
  };

  it('« Envoi… » tant que le téléphone du contact n’a pas reçu le message, même si le push est parti', () => {
    expect(label({}, true, true)).toBe('sending');
    expect(label({ last_attempt_at: NOW - 5_000, attempts: 1 }, false, true)).toBe('sending');
  });

  it('pas d’accusé après le délai, ou un deuxième essai : le contact n’a pas de connexion', () => {
    expect(label({ last_attempt_at: NOW - UNREACHABLE_AFTER_MS, attempts: 1 }, false, true)).toBe('unreachable');
    expect(label({ last_attempt_at: NOW - 1_000, attempts: 2 }, false, true)).toBe('unreachable');
  });

  it('notre téléphone sans connexion, ou rien n’a pu partir', () => {
    expect(label({}, false, false)).toBe('offline');
    expect(label({}, false, true)).toBe('not-sent');
  });
});
