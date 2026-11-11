import type { Message } from '../database';
import { ttlOf } from '../ephemeral';
import { parseMeta } from '../meta';

// Ce qui part d'un message, tel qu'il est écrit dans le canal chiffré. Sans dépendance aux autres
// modules du manager : utilisé par l'envoi direct (outbox), le push (wake) et le relais.

// Un message texte tel qu'il part, en direct comme par push. withMeta : false pour l'alléger.
export function textPayload(message: Message, withMeta = true): Record<string, unknown> {
  const ttl = ttlOf(message);
  return {
    type: 'message',
    id: message.id,
    text: message.text,
    reply_to: message.reply_to,
    ...(message.forwarded ? { forwarded: true } : {}),
    ...(ttl ? { ttl } : {}),
    ...(withMeta && message.meta ? { meta: parseMeta(message.meta) } : {}),
  };
}

// Ce qu'une offre de fichier ajoute pour les éphémères et la vue unique (lot 4.7).
export function fileExtras(message: Message): Record<string, unknown> {
  const ttl = ttlOf(message);
  return { ...(ttl ? { ttl } : {}), ...(message.view_once ? { once: true } : {}) };
}
