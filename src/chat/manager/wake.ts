import { fetchContactToken } from '../../network/tokens';
import { PushResult, sendPush } from '../../network/wake';
import { deleteContactToken, getContactToken, getOutboxEvents, getUndelivered, setContactToken } from '../database';
import { encodePushPayload } from '../pushPayload';

import { ChatCore } from './core';
import { pushKeysFor, sealSecure } from './secure';
import { WAKE_INTERVAL_MS } from './types';
import { log } from '../../log';

// Pas plus de pushs d'un coup : le serveur limite à 20 par minute et par destinataire.
const MAX_PUSHES_PER_ROUND = 5;
// Les accusés reçus en rafale partent dans un seul push.
const ACK_DELAY_MS = 300;

// Le contact n'est pas connecté : ce qui attend part chiffré dans un push. Le destinataire l'affiche
// tout de suite, même app fermée. Ce qui ne tient pas dans un push (fichier, texte très long) déclenche
// un simple réveil : l'autre téléphone se connecte et le reçoit en direct.
export function wakeIfNeeded(core: ChatCore, contact: string) {
  if (!core.online || core.links.get(contact)?.status === 'connected') return;
  if (getUndelivered(contact).length === 0 && getOutboxEvents(contact).length === 0) return;
  resolveToken(core, contact)
    .then((token) => (token ? pushPending(core, contact, token) : undefined))
    .catch((e) => log.warn('push', e));
}

// Le token du contact : celui reçu en direct, sinon celui qu'il a publié (chiffré) dans Firebase. Relu
// au plus une fois par minute, par exemple après un token périmé.
async function resolveToken(core: ChatCore, contact: string) {
  const known = getContactToken(contact);
  if (known) return known;
  if (!core.identity || Date.now() - (core.tokenFetches.get(contact) ?? 0) < WAKE_INTERVAL_MS) return null;
  core.tokenFetches.set(contact, Date.now());
  const fresh = await fetchContactToken(core.identity, contact);
  if (fresh) setContactToken(contact, fresh);
  return fresh;
}

// Envoie tout de suite ce qui attend, et attend la fin (réponse depuis une notification, app fermée :
// Android peut arrêter l'app juste après).
export async function deliverNow(core: ChatCore, contact: string) {
  if (core.links.get(contact)?.status === 'connected') return;
  const token = await resolveToken(core, contact);
  if (token) await pushPending(core, contact, token);
}

async function pushPending(core: ChatCore, contact: string, token: string) {
  const keys = pushKeysFor(core, contact);
  let needsWake = false;
  let sent = 0;
  const send = async (id: string, message: Record<string, unknown>) => {
    if (core.pushed.has(id)) return true;
    if (sent >= MAX_PUSHES_PER_ROUND) return false;
    const payload = encodePushPayload(keys.tag, keys.key, sealSecure(core, contact, message));
    if (!payload) {
      needsWake = true;
      return true;
    }
    core.pushed.add(id);
    sent += 1;
    return handleResult(core, contact, await sendPush(token, 'msg', payload), id);
  };

  for (const message of getUndelivered(contact)) {
    if (message.kind !== 'text') {
      needsWake = true;
      continue;
    }
    if (!(await send(message.id, { type: 'message', id: message.id, text: message.text, reply_to: message.reply_to }))) return;
  }
  for (const event of getOutboxEvents(contact)) {
    if (!(await send(event.id, { type: 'event', eventId: event.id, ...JSON.parse(event.payload) }))) return;
  }
  if (needsWake && Date.now() - (core.lastWake.get(contact) ?? 0) >= WAKE_INTERVAL_MS) {
    core.lastWake.set(contact, Date.now());
    handleResult(core, contact, await sendPush(token, 'wake', keys.tag));
  }
}

// Renvoie false s'il faut arrêter d'envoyer pour l'instant.
function handleResult(core: ChatCore, contact: string, result: PushResult, id?: string) {
  if (result === 'sent') return true;
  if (id) core.pushed.delete(id);
  if (result === 'expired') {
    // Le token ne sert plus : on l'oublie. Le prochain essai relit celui que le contact a publié.
    deleteContactToken(contact);
    log.info('token du contact périmé', contact.slice(0, 6));
  }
  return false;
}

// Un message reçu sans connexion (par push) est confirmé par push aussi : l'expéditeur voit « reçu »
// même si les deux apps restent fermées.
export function queuePushAck(core: ChatCore, contact: string, ack: { id?: string; eventId?: string }) {
  let pending = core.pushAcks.get(contact);
  if (!pending) {
    pending = { ids: new Set(), events: new Set() };
    core.pushAcks.set(contact, pending);
  }
  if (ack.id) pending.ids.add(ack.id);
  if (ack.eventId) pending.events.add(ack.eventId);
  clearTimeout(core.pushAckTimer);
  core.pushAckTimer = setTimeout(() => {
    core.pushAckFlush = flushPushAcks(core);
  }, ACK_DELAY_MS);
}

// Attendue par le réveil en arrière-plan avant de rendre la main à Android.
export async function settlePushAcks(core: ChatCore) {
  await new Promise((resolve) => setTimeout(resolve, ACK_DELAY_MS + 50));
  await core.pushAckFlush;
}

async function flushPushAcks(core: ChatCore) {
  const all = [...core.pushAcks];
  core.pushAcks.clear();
  for (const [contact, { ids, events }] of all) {
    // Connecté entre-temps : les accusés sont déjà partis en direct.
    if (core.links.get(contact)?.status === 'connected') continue;
    const token = await resolveToken(core, contact);
    if (!token) continue;
    const keys = pushKeysFor(core, contact);
    const payload = encodePushPayload(keys.tag, keys.key, sealSecure(core, contact, { type: 'acks', ids: [...ids], events: [...events] }));
    if (payload) handleResult(core, contact, await sendPush(token, 'msg', payload));
  }
}

// Le token voyage dans la connexion chiffrée : ni le QR code ni Firebase ne le transportent.
export function shareToken(core: ChatCore, contact?: string) {
  if (!core.myToken) return;
  const message = { type: 'token', token: core.myToken };
  if (contact) core.links.get(contact)?.peer.send(message);
  else core.links.forEach((link) => link.peer.send(message));
}
