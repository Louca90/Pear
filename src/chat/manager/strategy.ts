import { getPinnedContacts, getRecentContacts } from '../database';

import { connect } from './connections';
import { ChatCore } from './core';

// Quelles connexions directes garder ouvertes. Une connexion par contact coûte de la batterie et des
// données (battement de cœur toutes les 4 s) : on ne garde que celles qui servent.
// Les messages vers un contact non connecté partent quand même, chiffrés dans un push.

const MAX_CONNECTIONS = 8;
const RECENT_MS = 24 * 3600 * 1000;

// Par ordre de priorité : la conversation ouverte, les échanges en cours, les contacts épinglés, ceux
// avec qui on a parlé dans les dernières 24 h. Au-delà de 8, les moins prioritaires attendent.
export function reconcile(core: ChatCore) {
  const identity = core.identity;
  if (!identity) return;
  const now = Date.now();
  const pinned = getPinnedContacts();
  const recent = getRecentContacts(now - RECENT_MS);
  const priority = (contact: string) => {
    if (contact === core.openConversation) return 4;
    if ((core.keepUntil.get(contact) ?? 0) > now) return 3;
    if (pinned.has(contact)) return 2;
    return recent.has(contact) ? 1 : 0;
  };
  const wanted = [...core.names.keys()]
    .filter((contact) => priority(contact) > 0)
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, MAX_CONNECTIONS);
  const keep = new Set(wanted);

  for (const [contact, link] of core.links) {
    if (keep.has(contact)) continue;
    link.peer.stop();
    core.links.delete(contact);
  }
  for (const contact of wanted) {
    if (!core.links.has(contact)) connect(core, identity, contact);
  }
}
