import { fetchContactToken } from '../../network/tokens';
import { PushResult, sendPush } from '../../network/wake';
import { deleteContactToken, getContactToken, getOutboxEvents, getSetting, getUndelivered, Message, setContactToken } from '../database';
import { encodePushPayload } from '../pushPayload';
import { parseMeta } from '../meta';

import { ChatCore } from './core';
import { offlineRoute } from '../packets';
import { countsAsAttempt } from '../pending';
import { noteAttempt, pushKeysFor, sealedText, sealSecure } from './secure';
import { textPayload } from './payloads';
import { WAKE_INTERVAL_MS } from './types';
import { log } from '../../log';

// Pas plus de pushs d'un coup : le serveur limite à 20 par minute et par destinataire.
const MAX_PUSHES_PER_ROUND = 5;
// Les accusés reçus en rafale partent dans un seul push.
const ACK_DELAY_MS = 300;

// Réglage « Relais des fichiers » : activé tant qu'il n'a pas été coupé. Il sert aussi aux textes trop
// longs pour un push.
export const isRelayEnabled = () => getSetting('relay_enabled') !== '0';

// Le push d'un texte : son enveloppe gardée (jamais rechiffrée), null s'il ne tient pas dans un push.
export function textPushPayload(core: ChatCore, contact: string, message: Message): string | null {
  const keys = pushKeysFor(core, contact);
  return encodePushPayload(keys.tag, keys.key, sealedText(core, contact, message));
}

// Le contact n'est pas connecté : ce qui attend part chiffré dans un push. Le destinataire l'affiche
// tout de suite, même app fermée. Un texte trop long pour un push passe par le relais (relay.ts) ; un
// fichier déclenche en plus un simple réveil : l'autre téléphone se connecte et le reçoit en direct.
export function wakeIfNeeded(core: ChatCore, contact: string) {
  if (!core.online || core.links.get(contact)?.status === 'connected') return;
  if (getUndelivered(contact).length === 0 && getOutboxEvents(contact).length === 0) return;
  resolveToken(core, contact)
    .then((token) => (token ? pushPending(core, contact, token) : undefined))
    .catch((e) => log.warn('push', e));
}

// Le token du contact : celui reçu en direct, sinon celui qu'il a publié (chiffré) dans Firebase. Relu
// au plus une fois par minute, par exemple après un token périmé.
export async function resolveToken(core: ChatCore, contact: string) {
  const known = getContactToken(contact);
  if (known) return known;
  if (!core.identity || Date.now() - (core.tokenFetches.get(contact) ?? 0) < WAKE_INTERVAL_MS) return null;
  core.tokenFetches.set(contact, Date.now());
  const fresh = await fetchContactToken(core.identity, contact);
  if (fresh) setContactToken(contact, fresh);
  return fresh;
}

// Prévient le contact d'un changement (supprimé, bloqué, débloqué) : en direct s'il est connecté,
// sinon par push. Fonctionne aussi pour un contact qu'on vient de retirer de la liste.
export async function sendStatusNow(core: ChatCore, contact: string, state: 'removed' | 'blocked' | 'unblocked') {
  const message = { type: 'status', state };
  const peer = core.links.get(contact)?.peer;
  if (peer?.isOpen()) {
    peer.send({ type: 'ratchet', ...sealSecure(core, contact, message) });
    return;
  }
  const token = await resolveToken(core, contact);
  if (!token) return;
  const keys = pushKeysFor(core, contact);
  const payload = encodePushPayload(keys.tag, keys.key, sealSecure(core, contact, message));
  if (payload) handleResult(core, contact, await sendPush(token, 'msg', payload));
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
  let sent = 0;
  // Ce qui ne tient pas dans un push demande un réveil. Pour les messages listés ici (fichiers…), un
  // réveil accepté compte comme un essai.
  let needsWake = false;
  const waking: string[] = [];
  // payload : le push déjà préparé ; messageId : le message dont c'est un essai (pas pour un événement).
  const send = async (id: string, payload: string, messageId?: string) => {
    if (core.pushed.has(id)) return true;
    if (sent >= MAX_PUSHES_PER_ROUND) return false;
    core.pushed.add(id);
    sent += 1;
    const result = await sendPush(token, 'msg', payload);
    if (messageId && countsAsAttempt(result)) noteAttempt(core, contact, messageId);
    return handleResult(core, contact, result, id);
  };

  for (const message of getUndelivered(contact)) {
    if (message.kind !== 'text') {
      waking.push(message.id);
      continue;
    }
    const payload = textPushPayload(core, contact, message);
    const route = offlineRoute(payload, isRelayEnabled());
    if (payload) {
      if (!(await send(message.id, payload, message.id))) return;
    } else if (route === 'wake') {
      // Relais coupé : le même texte allégé (aperçu de lien sans son image) s'il tient dans un push,
      // sinon il attend la connexion directe. Le texte complet reste celui envoyé en direct.
      waking.push(message.id);
      const meta = message.meta ? parseMeta(message.meta) : null;
      if (meta?.preview?.image && !core.pushed.has(message.id) && sent < MAX_PUSHES_PER_ROUND) {
        const lighter = { ...textPayload(message, false), meta: { ...meta, preview: { ...meta.preview, image: undefined } } };
        const light = encodePushPayload(keys.tag, keys.key, sealSecure(core, contact, lighter));
        if (light && !(await send(message.id, light, message.id))) return;
      }
    }
    // route === 'relay' : relayPending (relay.ts) le dépose chiffré dans le relais ; le réveil permet
    // en plus une connexion directe si l'autre téléphone la prend avant.
    else needsWake = true;
  }
  for (const event of getOutboxEvents(contact)) {
    // Vérifié avant de chiffrer : chaque chiffrement d'un événement consomme une clé du ratchet.
    if (core.pushed.has(event.id)) continue;
    if (sent >= MAX_PUSHES_PER_ROUND) return;
    const payload = encodePushPayload(keys.tag, keys.key, sealSecure(core, contact, { type: 'event', eventId: event.id, ...JSON.parse(event.payload) }));
    if (!payload) {
      // Trop gros pour un push : il partira en direct, sans être rechiffré à chaque tour.
      core.pushed.add(event.id);
      needsWake = true;
      continue;
    }
    if (!(await send(event.id, payload))) return;
  }
  if ((needsWake || waking.length > 0) && Date.now() - (core.lastWake.get(contact) ?? 0) >= WAKE_INTERVAL_MS) {
    core.lastWake.set(contact, Date.now());
    const result = await sendPush(token, 'wake', keys.tag);
    if (countsAsAttempt(result)) waking.forEach((id) => noteAttempt(core, contact, id));
    handleResult(core, contact, result);
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
