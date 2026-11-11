// Le verrou de l'app : il se referme après une minute passée en arrière-plan.
export const LOCK_DELAY_MS = 60_000;

export function shouldLock(enabled: boolean, backgroundedAt: number | null, now: number): boolean {
  return enabled && backgroundedAt !== null && now - backgroundedAt >= LOCK_DELAY_MS;
}
