import { usePullGesture } from '../../../components/pull';

// Geste des messages éphémères : volontaire, impossible à faire par accident. En bas de la conversation,
// maintenir le doigt immobile (1,2 s pour activer, 0,8 s pour désactiver : un anneau se remplit), puis
// glisser vers le haut jusqu'à la cible et relâcher dessus. Relâcher avant ou ailleurs annule. Voir components/pull.tsx.
export const EPHEMERAL_ARM_ON = { holdMs: 1200, distance: 120 };
export const EPHEMERAL_ARM_OFF = { holdMs: 800, distance: 72 };

export function useEphemeralPull(canPull: () => boolean, onToggle: () => void, active: boolean) {
  return usePullGesture({ dir: -1, canPull, onTrigger: onToggle, arm: active ? EPHEMERAL_ARM_OFF : EPHEMERAL_ARM_ON });
}
