const { getDatabase, ServerValue } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

const { getSetupError, overLimit, readBody, verifyCaller } = require('../lib/firebase');
const { INBOX_ID } = require('../lib/inbox');

// POST { v, inboxId, sealed } : dépose une demande de pairing dans la boîte du destinataire et le
// prévient par un push sur son topic. `sealed` est une boîte scellée libsodium (clé et pseudo de
// l'expéditeur) : le serveur ne peut pas la lire.
const MAX_SEALED_LENGTH = 2800; // environ 2 Ko une fois décodé
const SEALED = /^[A-Za-z0-9+/=_-]+$/;
const MAX_CALLS_PER_CALLER = 5;
const MAX_CALLS_PER_INBOX = 10;
// Au-delà, la boîte est pleine : les demandes attendent que le destinataire en lise ou en supprime.
const MAX_PENDING_PER_INBOX = 50;
const EXPIRY_MS = 7 * 24 * 3600000;

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur mal configuré' });
  if (req.method !== 'POST') return res.status(405).end();
  const uid = await verifyCaller(req);
  if (!uid) return res.status(401).end();

  const body = readBody(req, ['v', 'inboxId', 'sealed']);
  if (!body || body.v !== 1 || typeof body.inboxId !== 'string' || !INBOX_ID.test(body.inboxId)) return res.status(400).end();
  if (typeof body.sealed !== 'string' || body.sealed.length > MAX_SEALED_LENGTH || !SEALED.test(body.sealed)) return res.status(413).end();

  try {
    if ((await overLimit('pairCaller', uid, MAX_CALLS_PER_CALLER)) || (await overLimit('pairInbox', body.inboxId, MAX_CALLS_PER_INBOX))) {
      return res.status(429).end();
    }
  } catch (error) {
    console.error('Limite de débit indisponible :', error.code || error.message);
  }

  const inbox = getDatabase().ref(`requests/${body.inboxId}`);
  // Les demandes expirées partent au passage (la tâche quotidienne fait le reste).
  const pending = (await inbox.once('value')).val() || {};
  const expired = Object.entries(pending).filter(([, request]) => !request || Date.now() - request.at > EXPIRY_MS);
  if (expired.length) await inbox.update(Object.fromEntries(expired.map(([id]) => [id, null])));
  if (Object.keys(pending).length - expired.length >= MAX_PENDING_PER_INBOX) return res.status(507).end();

  await inbox.push({ v: 1, data: body.sealed, at: ServerValue.TIMESTAMP });

  try {
    await getMessaging().send({ topic: `pair_${body.inboxId}`, data: { type: 'pair', v: '1' }, android: { priority: 'high', ttl: EXPIRY_MS } });
  } catch (error) {
    // La demande est enregistrée : le destinataire la verra à sa prochaine ouverture de Pear.
    console.error('Echec du push de demande :', error.code);
  }
  return res.status(204).end();
};
