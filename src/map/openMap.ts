// Ouvrir la carte depuis n'importe où (une bulle de la conversation n'a pas accès à la navigation) :
// App.tsx écoute et change d'écran.
type Listener = (focus: string | null) => void;
const listeners = new Set<Listener>();

export function onOpenMap(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// focus : la clé du contact à montrer en premier (null : la carte de tout le monde).
export function openMap(focus: string | null = null) {
  for (const listener of listeners) listener(focus);
}
