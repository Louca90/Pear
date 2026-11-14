import { useSyncExternalStore } from 'react';

import { chat } from '../../../chat/manager';

// L'avancement du transfert d'un message (0 à 1, absent hors transfert). Le composant ne se redessine que
// quand cette valeur change, pas à chaque signal du moteur de la conversation.
export function useTransferProgress(id: string) {
  return useSyncExternalStore(chat.subscribe, () => chat.getProgress(id));
}
