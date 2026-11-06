const { getDatabase } = require('firebase-admin/database');

const { getSetupError } = require('../lib/firebase');

// Tâche quotidienne (server/vercel.json) : supprime les demandes de pairing de plus de 7 jours et les
// compteurs de débit d'une minute passée. Sans danger si quelqu'un l'appelle : elle n'efface que du périmé.
const EXPIRY_MS = 7 * 24 * 3600000;
const MINUTE_MS = 60000;

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur mal configuré' });
  if (req.method !== 'GET') return res.status(405).end();
  const database = getDatabase();
  const now = Date.now();
  const updates = {};

  const requests = (await database.ref('requests').once('value')).val() || {};
  for (const [inboxId, inbox] of Object.entries(requests)) {
    for (const [id, request] of Object.entries(inbox || {})) {
      if (!request || now - request.at > EXPIRY_MS) updates[`requests/${inboxId}/${id}`] = null;
    }
  }

  const minute = Math.floor(now / MINUTE_MS);
  const limits = (await database.ref('rateLimits').once('value')).val() || {};
  for (const [kind, counters] of Object.entries(limits)) {
    for (const [id, counter] of Object.entries(counters || {})) {
      if (!counter || counter.minute < minute) updates[`rateLimits/${kind}/${id}`] = null;
    }
  }

  if (Object.keys(updates).length) await database.ref().update(updates);
  return res.status(200).json({ removed: Object.keys(updates).length });
};
