import { useEffect, useRef, useState } from 'react';

import { Message } from '../../../chat/database';

// L'animation « Envoi » de la poire, pilotée par le vrai transfert (planche « Icône Pépins ») :
// - le niveau suit le pourcentage réel du fichier (avec seulement un petit départ, START) ; un transfert
//   déjà fini (petit fichier, connexion directe) se remplit en douceur jusqu'en haut avant de confirmer ;
// - à la fin, la poire finit de se remplir puis passe d'« Envoi » à « Vérifié » (CONFIRM_MS), et s'efface ;
// - un envoi parti en attente (contact hors ligne) sans aucune progression se retire au bout de STALL_MS
//   au lieu de rester bloqué.
// Seuls les transferts qui commencent pendant que la conversation est ouverte sont animés (pas les vieux
// messages au chargement).
const MIN_MS = 900;
// Le petit départ visible tant que le vrai pourcentage n'a pas encore bougé.
const START = 0.08;
// Le temps laissé à la poire pour finir de se remplir à l'écran avant « Vérifié ».
const FILL_MS = 800;
const CONFIRM_MS = 1600;
const STALL_MS = 4000;
const TICK_MS = 80;
const FRESH_MS = 10_000;

export type TransferAnimation = { visible: boolean; progress: number; confirmed: boolean };

const inFlight = (message: Message) => message.status === 'sending' || message.status === 'receiving';

export function useTransferAnimation(message: Message, real: number | undefined): TransferAnimation {
  const fresh = Date.now() - message.created_at < FRESH_MS && inFlight(message);
  const [phase, setPhase] = useState<'idle' | 'running' | 'confirm'>(real !== undefined || fresh ? 'running' : 'idle');
  const [shown, setShown] = useState(real ?? 0);
  const startedAt = useRef(Date.now());
  const sawProgress = useRef(real !== undefined);
  const finishedAt = useRef(0);
  const latest = useRef({ real, message });
  latest.current = { real, message };

  // Un transfert reprend (ou commence) : la poire revient.
  useEffect(() => {
    if (real === undefined) return;
    sawProgress.current = true;
    if (phase === 'idle') {
      startedAt.current = Date.now();
      finishedAt.current = 0;
      setShown(0);
      setPhase('running');
    }
  }, [real, phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      const { real: now, message: current } = latest.current;
      const elapsed = Date.now() - startedAt.current;
      const finished = now === undefined && (sawProgress.current || !inFlight(current));
      // Pendant le transfert : le vrai pourcentage, avec seulement un petit départ. Fini : tout en haut.
      const target = finished ? 1 : Math.max(Math.min(START, (elapsed / MIN_MS) * START), now ?? 0);
      setShown((value) => Math.max(value, target));
      if (finished && !finishedAt.current) finishedAt.current = Date.now();
      // « Vérifié » quand la poire a eu le temps d'être pleine à l'écran.
      if (finished && elapsed >= MIN_MS && Date.now() - finishedAt.current >= FILL_MS) {
        setPhase('confirm');
      } else if (!finished && !sawProgress.current && elapsed > STALL_MS) {
        // Parti en attente, rien ne bouge : on n'affiche pas une poire figée.
        setPhase('idle');
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'confirm') return;
    const timer = setTimeout(() => {
      sawProgress.current = false;
      setPhase('idle');
    }, CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return { visible: phase !== 'idle', progress: phase === 'confirm' ? 1 : shown, confirmed: phase === 'confirm' };
}
