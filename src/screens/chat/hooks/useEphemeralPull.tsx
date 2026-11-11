import { usePullGesture } from '../../../components/pull';

// Geste des messages éphémères (lot 4.7) : en bas de la conversation, tirer vers le haut. La liste
// monte avec le doigt (96 points au plus) ; relâcher au-delà de 72 points bascule le mode, avant tout
// revient en 180 ms. Voir components/pull.tsx.
export function useEphemeralPull(canPull: () => boolean, onToggle: () => void) {
  return usePullGesture({ dir: -1, canPull, onTrigger: onToggle });
}
