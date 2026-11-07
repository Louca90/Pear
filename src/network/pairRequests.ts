import { getIdToken } from '@react-native-firebase/auth';
import { get, getDatabase, ref, remove } from '@react-native-firebase/database';
import { getMessaging, subscribeToTopic } from '@react-native-firebase/messaging';

import { inboxIdFor } from '../crypto/inbox';
import { Identity } from '../crypto/pairing';
import { openPairRequest, PairRequestContent, sealPairRequest } from '../crypto/pairRequest';
import { log } from '../log';
import { wakeUrl } from '../remoteConfig';
import { currentUser, registerInbox } from './tokens';

// Demandes de pairing à sens unique (voir DOCS_SERVEUR.md) : on dépose une demande scellée dans la
// boîte du contact par le serveur, et on lit la nôtre dans Firebase.

export type ReceivedRequest = { id: string; at: number; content: PairRequestContent };

// 'sent' : déposée ; 'limited' : trop de demandes, on réessaiera ; 'failed' : réseau ou serveur.
export async function sendPairRequest(identity: Identity, name: string, contact: string): Promise<'sent' | 'limited' | 'failed'> {
  try {
    const user = await currentUser();
    const response = await fetch(wakeUrl().replace(/\/wake$/, '/pair-request'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getIdToken(user)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, inboxId: inboxIdFor(contact), sealed: sealPairRequest(identity, name, contact) }),
    });
    if (response.ok) return 'sent';
    if (response.status === 429 || response.status === 507) return 'limited';
    log.warn('demande de pairing refusée', response.status);
    return 'failed';
  } catch (e) {
    log.warn('demande de pairing', e);
    return 'failed';
  }
}

// Lit et vide notre boîte. Une demande illisible (pas pour nous, modifiée) est supprimée aussi.
export async function fetchPairRequests(identity: Identity): Promise<ReceivedRequest[]> {
  const inboxId = await registerInbox(identity);
  const entries: Record<string, { data?: unknown; at?: unknown }> = (await get(ref(getDatabase(), `requests/${inboxId}`))).val() ?? {};
  const received: ReceivedRequest[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    const content = openPairRequest(identity, entry?.data);
    if (content) received.push({ id, at: typeof entry.at === 'number' ? entry.at : Date.now(), content });
    await remove(ref(getDatabase(), `requests/${inboxId}/${id}`)).catch((e) => log.warn('suppression de la demande', e));
  }
  return received;
}

// Les demandes arrivent par un push sur ce topic, même app fermée.
export async function subscribePairTopic(identity: Identity) {
  const inboxId = await registerInbox(identity);
  await subscribeToTopic(getMessaging(), `pair_${inboxId}`);
}
