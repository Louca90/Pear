// Ce que l'expéditeur voit sous un message pas encore distribué. Honnête : rien ne promet que le
// message arrivera, la livraison dépend du téléphone du contact.

// « Réessayer » apparaît quand rien n'est parti depuis ce délai.
export const RETRY_AFTER_MS = 5 * 60 * 1000;
// Pas plus de 3 nouveaux essais à la main par heure et par conversation. Seuls comptent ceux qui sont
// vraiment partis du téléphone : appuyer sans réseau ne consomme rien.
export const MAX_MANUAL_RETRIES = 3;
export const MANUAL_RETRY_WINDOW_MS = 60 * 60 * 1000;

// Un push accepté arrive en quelques secondes sur un téléphone connecté, qui renvoie aussitôt son
// accusé. Sans accusé après ce délai (ou après un deuxième essai), le téléphone du contact n'a pas de
// connexion (ou il est éteint).
export const UNREACHABLE_AFTER_MS = 30 * 1000;

export type PendingMessage = { status: string; created_at: number; last_attempt_at?: number | null; attempts?: number };

// sending : le contact est connecté, l'envoi se fait. waiting : un essai est parti (push accepté,
// relais), on attend son téléphone. not-sent : rien n'a pu partir (pas de réseau, serveur injoignable).
export type PendingState = { kind: 'sending' } | { kind: 'waiting'; lastTry: number } | { kind: 'not-sent'; offline: boolean };

export function pendingState(message: PendingMessage, contactConnected: boolean, online: boolean): PendingState | null {
  if (message.status !== 'sending') return null;
  if (contactConnected) return { kind: 'sending' };
  if (message.last_attempt_at) return { kind: 'waiting', lastTry: message.last_attempt_at };
  return { kind: 'not-sent', offline: !online };
}

// Ce qu'on écrit sous le message. « Envoi… » tant que le téléphone du contact n'a pas reçu le message
// (son accusé fait passer le message à « Distribué »), même quand le push est déjà parti.
// sending : « Envoi… ». unreachable : « Envoi… », mais le contact n'a pas de connexion.
// offline : notre téléphone n'a pas de connexion. not-sent : rien n'a pu partir (serveur injoignable).
export type PendingLabel = 'sending' | 'unreachable' | 'offline' | 'not-sent';

export function pendingLabel(state: PendingState, message: PendingMessage, now: number): PendingLabel {
  if (state.kind === 'sending') return 'sending';
  if (state.kind === 'not-sent') return state.offline ? 'offline' : 'not-sent';
  return now >= unreachableAt(state, message) ? 'unreachable' : 'sending';
}

// Le moment où un message en attente passe à « pas de connexion chez le contact ».
export function unreachableAt(state: PendingState, message: PendingMessage) {
  if (state.kind !== 'waiting') return Infinity;
  if ((message.attempts ?? 0) >= 2) return state.lastTry;
  return state.lastTry + UNREACHABLE_AFTER_MS;
}

export function recentRetries(times: number[], now: number) {
  return times.filter((at) => now - at < MANUAL_RETRY_WINDOW_MS);
}

// Le moment où « Réessayer » apparaîtra (null : jamais, le message n'attend pas ou le plafond est atteint).
export function retryAvailableAt(message: PendingMessage, contactConnected: boolean, retries: number[], now: number): number | null {
  if (message.status !== 'sending' || contactConnected) return null;
  if (recentRetries(retries, now).length >= MAX_MANUAL_RETRIES) return null;
  return (message.last_attempt_at ?? message.created_at) + RETRY_AFTER_MS;
}

export function canRetry(message: PendingMessage, contactConnected: boolean, retries: number[], now: number) {
  const at = retryAvailableAt(message, contactConnected, retries, now);
  return at !== null && now >= at;
}

// Un envoi direct qui a pu partir, un push que le serveur a accepté : c'est un essai. Un échec sur le
// téléphone (pas de réseau, serveur injoignable, limite atteinte) n'en est pas un.
export function countsAsAttempt(result: boolean | 'sent' | 'expired' | 'limited' | 'failed') {
  return result === true || result === 'sent';
}
