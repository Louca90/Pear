// Curseur de lecture : au lieu d'un accusé par message, le lecteur dit « j'ai lu jusqu'à ce message ».
// L'expéditeur marque comme lus tous ses messages jusqu'à celui-là, jamais en arrière, et le lecteur
// renvoie son curseur tant que l'expéditeur ne l'a pas confirmé : un accusé perdu ne laisse plus de trou.

export type ReadCandidate = { id: string; created_at: number; mine: number; status: string };

// Le plus récent des messages reçus que j'ai lus (le curseur courant du lecteur), ou null.
export function latestReadId(messages: ReadCandidate[]): string | null {
  let best: ReadCandidate | null = null;
  for (const message of messages) {
    if (message.mine !== 0 || (message.status !== 'read' && message.status !== 'read-pending')) continue;
    if (!best || message.created_at > best.created_at) best = message;
  }
  return best?.id ?? null;
}

// Faut-il (re)envoyer le curseur ? Oui s'il existe et n'est pas celui que l'expéditeur a confirmé.
export function cursorToSend(latest: string | null, confirmed: string | null): string | null {
  return latest && latest !== confirmed ? latest : null;
}

// Un curseur ne fait qu'avancer : un plus ancien que celui déjà appliqué est ignoré.
export function advancesCursor(currentAt: number, nextAt: number): boolean {
  return nextAt > currentAt;
}
