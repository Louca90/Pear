// Regroupement des bulles (lot 8.13). Deux messages voisins vont ensemble s'ils sont du même auteur,
// du même jour, à moins de GROUP_GAP_MS l'un de l'autre et de la même session (quand les deux en ont
// une : les anciens messages n'en ont pas et se regroupent sur l'écart de temps seul).
export const GROUP_GAP_MS = 2 * 60 * 1000;

export type GroupPosition = 'single' | 'first' | 'middle' | 'last';

type Groupable = { mine: number; kind: string; created_at: number; conn_session?: number | null };

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function sameGroup(a: Groupable, b: Groupable) {
  if (a.kind === 'system' || a.kind === 'wallpaper' || b.kind === 'system' || b.kind === 'wallpaper') return false;
  if (a.mine !== b.mine) return false;
  if (Math.abs(a.created_at - b.created_at) >= GROUP_GAP_MS || !sameDay(a.created_at, b.created_at)) return false;
  return a.conn_session == null || b.conn_session == null || a.conn_session === b.conn_session;
}

// La liste de la conversation est inversée : l'index 0 est le plus récent (en bas de l'écran). Le
// voisin du dessus est donc l'index + 1, celui du dessous l'index - 1.
export function groupPosition(messages: Groupable[], index: number): GroupPosition {
  const message = messages[index];
  const above = messages[index + 1];
  const below = messages[index - 1];
  const withAbove = !!above && sameGroup(message, above);
  const withBelow = !!below && sameGroup(message, below);
  if (withAbove && withBelow) return 'middle';
  if (withAbove) return 'last';
  if (withBelow) return 'first';
  return 'single';
}

// Session de connexion : un identifiant par contact et par canal (connexion directe, ou à distance :
// notification, relais, envoi hors ligne). Il change après GROUP_GAP_MS sans message, et à chaque
// nouvelle connexion directe (voir forget).
export class SessionTracker {
  private sessions = new Map<string, { id: number; at: number }>();

  current(contact: string, channel: 'direct' | 'remote', now = Date.now()) {
    const key = `${contact}|${channel}`;
    const last = this.sessions.get(key);
    const id = last && now - last.at < GROUP_GAP_MS ? last.id : now;
    this.sessions.set(key, { id, at: now });
    return id;
  }

  // Une nouvelle connexion directe ouvre une nouvelle session.
  forget(contact: string) {
    this.sessions.delete(`${contact}|direct`);
  }
}
