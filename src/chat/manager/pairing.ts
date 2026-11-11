import { fetchPairRequests, sendPairRequest, subscribePairTopic } from '../../network/pairRequests';
import { activateContact, addPairingRequest, setContactVerified, blockKey, getContactState, getSetting, isBlocked, setRequestState, setSetting } from '../database';
import { clearPairNotification, showPairNotification } from '../notifications';

import { ChatCore } from './core';
import { sendEvent } from './outbox';
import { getMyProfile } from './profile';
import { log } from '../../log';

// Pairing à sens unique : A scanne B, A envoie une demande, B accepte (ou refuse, ou bloque).
// Tant que B n'a pas accepté, B est chez A un contact « en attente ».

const SENT_SETTING = 'pair_requests_sent';
// Une demande en attente est redéposée chaque jour : elle ne périme pas tant que A attend.
const RESEND_MS = 24 * 3600 * 1000;

function sentAt(): Record<string, number> {
  try {
    return JSON.parse(getSetting(SENT_SETTING) ?? '{}');
  } catch {
    return {};
  }
}

// A vient d'enregistrer B (ou réessaie) : dépose la demande dans la boîte de B.
export async function requestPairing(core: ChatCore, contact: string) {
  if (!core.identity) return;
  const result = await sendPairRequest(core.identity, getMyProfile().name ?? '', contact);
  if (result === 'sent') setSetting(SENT_SETTING, JSON.stringify({ ...sentAt(), [contact]: Date.now() }));
}

// Au lancement : s'abonner au topic des demandes, lire la boîte, redéposer les demandes en attente.
export async function startPairing(core: ChatCore, pendingContacts: string[]) {
  if (!core.identity) return;
  await subscribePairTopic(core.identity).catch((e) => log.warn('abonnement aux demandes', e));
  await syncPairRequests(core);
  const sent = sentAt();
  for (const contact of pendingContacts) {
    if (Date.now() - (sent[contact] ?? 0) > RESEND_MS) await requestPairing(core, contact);
  }
}

// Lit les demandes reçues. Celles d'un contact déjà enregistré ou bloqué sont ignorées, sans badge.
// Si on attendait nous-mêmes que ce contact accepte (scans croisés), c'est accepté des deux côtés.
export async function syncPairRequests(core: ChatCore) {
  if (!core.identity) return;
  const received = await fetchPairRequests(core.identity);
  let changed = false;
  for (const { id, at, content } of received) {
    const key = content.publicKey;
    if (key === core.identity.publicKey || isBlocked(key)) continue;
    const state = getContactState(key);
    if (state === 'active') continue;
    if (state === 'pending') {
      activateContact(key);
      // Chacun a scanné le code de l'autre : c'est la vérification en face à face.
      setContactVerified(key);
      acceptPairing(core, key);
      core.contactsChanged();
      continue;
    }
    addPairingRequest({ id, from_key: key, name: content.name, at });
    showPairNotification(key, content.name).catch((e) => log.warn('notification', e));
    changed = true;
  }
  if (changed) core.notify();
}

// B accepte : A le saura par un message chiffré (en direct, ou par push même app fermée).
export function acceptPairing(core: ChatCore, contact: string) {
  setRequestState(contact, 'accepted');
  clearPairNotification(contact);
  sendEvent(core, contact, { action: 'accepted', id: '' });
}

export function declinePairing(core: ChatCore, contact: string) {
  setRequestState(contact, 'declined');
  clearPairNotification(contact);
  core.notify();
}

export function blockPairing(core: ChatCore, contact: string) {
  blockKey(contact);
  declinePairing(core, contact);
}
