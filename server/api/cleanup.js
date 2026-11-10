const { getDatabase } = require('firebase-admin/database');

const { getSetupError, isCron, shallowKeys } = require('../lib/firebase');

// Tâche quotidienne (server/vercel.json) : supprime les demandes de pairing de plus de 7 jours et les
// compteurs de débit d'une minute passée, et les tokens publiés il y a plus de 60 jours (un téléphone actif
// republie le sien tous les 30 jours). Réservée au cron de Vercel (`Authorization: Bearer $CRON_SECRET`) :
// chaque appel lit la base, ce qui compte dans le quota gratuit de téléchargement.
const EXPIRY_MS = 7 * 24 * 3600000;
const MINUTE_MS = 60000;
const TOKEN_EXPIRY_MS = 60 * 24 * 3600000;
// Fichiers relayés : supprimés à 7 jours, et à 24 h s'ils n'ont jamais été envoyés en entier.
const RELAY_EXPIRY_MS = 7 * 24 * 3600000;
const RELAY_INCOMPLETE_MS = 24 * 3600000;

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur mal configuré' });
  if (req.method !== 'GET') return res.status(405).end();
  if (!isCron(req)) return res.status(401).end();
  const database = getDatabase();
  const now = Date.now();
  const updates = {};

  const requests = (await database.ref('requests').once('value')).val() || {};
  for (const [inboxId, inbox] of Object.entries(requests)) {
    for (const [id, request] of Object.entries(inbox || {})) {
      if (!request || now - request.at > EXPIRY_MS) updates[`requests/${inboxId}/${id}`] = null;
    }
  }

  const tokens = (await database.ref('tokens').once('value')).val() || {};
  for (const [inboxId, entries] of Object.entries(tokens)) {
    for (const [tag, entry] of Object.entries(entries || {})) {
      if (!entry || now - entry.at > TOKEN_EXPIRY_MS) updates[`tokens/${inboxId}/${tag}`] = null;
    }
  }

  // Relais : jamais les morceaux eux-mêmes (jusqu'à 25 Mo par fichier). Les identifiants et les numéros de
  // morceaux se listent en `shallow`, et seule la fiche `meta` de chaque fichier est lue.
  await Promise.all(
    (await shallowKeys('relay')).map(async (id) => {
      const meta = (await database.ref(`relay/${id}/meta`).once('value')).val();
      const age = meta ? now - meta.at : Infinity;
      let expired = !(age <= RELAY_EXPIRY_MS);
      if (!expired && age > RELAY_INCOMPLETE_MS) expired = (await shallowKeys(`relay/${id}/chunks`)).length < meta.chunks;
      if (expired) updates[`relay/${id}`] = null;
    }),
  );

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
