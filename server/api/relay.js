const { randomBytes } = require('node:crypto');
const { getDatabase, ServerValue } = require('firebase-admin/database');

const { getSetupError, readBody, verifyCaller } = require('../lib/firebase');
const { CHUNK_BYTES, monthOf } = require('../lib/relay');

// Relais des fichiers quand les deux téléphones ne peuvent pas se joindre en direct (voir DOCS_SERVEUR.md).
// POST { v: 1, size } : réserve un envoi. Le téléphone écrit ensuite lui-même les morceaux chiffrés dans
// relay/{id}/chunks/{n} : les règles Firebase n'autorisent que ce compte, et seulement les numéros listés
// dans meta/slots. Réponse : { v, id, chunks, chunkBytes }.

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PER_DAY = 20;
// Le plafond gratuit de téléchargement (10 Go par mois) est partagé avec la signalisation : le relais
// s'arrête bien avant pour ne jamais empêcher les téléphones de se connecter. La taille est comptée dès la
// réservation (une rafale dans la journée ne dépasse pas le plafond), puis le nettoyage rend ce qui n'a
// jamais été envoyé.
const MONTHLY_BUDGET_BYTES = 6 * 1024 * 1024 * 1024;

const day = () => new Date().toISOString().slice(0, 10);
const month = () => monthOf(Date.now());

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur mal configuré' });
  if (req.method !== 'POST') return res.status(405).end();
  const uid = await verifyCaller(req);
  if (!uid) return res.status(401).end();

  const body = readBody(req, ['v', 'size']);
  if (!body || body.v !== 1 || !Number.isSafeInteger(body.size) || body.size <= 0) return res.status(400).end();
  if (body.size > MAX_FILE_BYTES) return res.status(413).end();

  const database = getDatabase();
  const today = day();
  const daily = await database
    .ref(`rateLimits/relayDay/${uid}`)
    .transaction((current) => (current && current.day === today ? { day: today, count: current.count + 1 } : { day: today, count: 1 }));
  if (daily.snapshot.val().count > MAX_PER_DAY) return res.status(429).end();

  const usage = await database.ref(`relayUsage/${month()}`).transaction((bytes) => (bytes || 0) + body.size);
  if (usage.snapshot.val() > MONTHLY_BUDGET_BYTES) {
    await database.ref(`relayUsage/${month()}`).transaction((bytes) => Math.max(0, (bytes || 0) - body.size));
    return res.status(507).end();
  }

  const id = randomBytes(16).toString('base64url');
  const chunks = Math.ceil(body.size / CHUNK_BYTES);
  // `slots` : les seuls morceaux que les règles laissent écrire. `last` (en texte pour les règles) : le
  // dernier morceau, sans lequel un téléphone ne peut pas supprimer le fichier (voir database.rules.json).
  const slots = Object.fromEntries(Array.from({ length: chunks }, (_, n) => [n, true]));
  await database.ref(`relay/${id}/meta`).set({ owner: uid, size: body.size, chunks, slots, last: String(chunks - 1), at: ServerValue.TIMESTAMP });
  return res.status(200).json({ v: 1, id, chunks, chunkBytes: CHUNK_BYTES });
};
