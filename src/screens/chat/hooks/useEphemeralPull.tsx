import { usePullGesture } from '../../../components/pull';

// Geste des messages éphémères : le même qu'avant (en bas de la conversation, tirer vers le haut), mais plus
// long à déclencher pour ne jamais l'activer par erreur : tirer de 140 points, puis rester au bout 0,5 s
// pendant que l'anneau se remplit ; lâcher avant ne fait rien. Désactiver est un peu plus court.
// Voir components/pull.tsx.
export const EPHEMERAL_ARM_ON = { holdMs: 500, distance: 140 };
export const EPHEMERAL_ARM_OFF = { holdMs: 300, distance: 110 };

export function useEphemeralPull(canPull: () => boolean, onToggle: () => void, active: boolean) {
  return usePullGesture({ dir: -1, canPull, onTrigger: onToggle, arm: active ? EPHEMERAL_ARM_OFF : EPHEMERAL_ARM_ON });
}
