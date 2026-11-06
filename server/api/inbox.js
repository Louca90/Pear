const { getDatabase } = require('firebase-admin/database');

const { getServiceAccount, getSetupError, overLimit, readBody, verifyCaller } = require('../lib/firebase');
const { PUBLIC_KEY, inboxIdFor, isValidProof, serverKeys } = require('../lib/inbox');

// GET : la clé publique du serveur, pour calculer la preuve.
// POST { v, publicKey, at, proof } : enregistre (ou reprend après une réinstallation) la boîte de
// demandes de pairing de ce téléphone. Répond { inboxId }.
const MAX_CALLS_PER_CALLER = 10;
// La preuve est datée : une preuve interceptée ne sert plus après quelques minutes.
const PROOF_MAX_AGE_MS = 5 * 60000;

let keys = null;

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur mal configuré' });
  keys ??= serverKeys(getServiceAccount());
  if (req.method === 'GET') return res.status(200).json({ v: 1, serverKey: keys.publicKey });
  if (req.method !== 'POST') return res.status(405).end();
  const uid = await verifyCaller(req);
  if (!uid) return res.status(401).end();

  const body = readBody(req, ['v', 'publicKey', 'at', 'proof']);
  if (!body || body.v !== 1 || typeof body.publicKey !== 'string' || !PUBLIC_KEY.test(body.publicKey)) return res.status(400).end();
  if (!Number.isSafeInteger(body.at) || Math.abs(Date.now() - body.at) > PROOF_MAX_AGE_MS) return res.status(400).end();

  try {
    if (await overLimit('inboxCaller', uid, MAX_CALLS_PER_CALLER)) return res.status(429).end();
  } catch (error) {
    console.error('Limite de débit indisponible :', error.code || error.message);
  }

  if (!isValidProof(keys.privateKey, body.publicKey, uid, body.at, body.proof)) return res.status(403).end();

  // La preuve montre que l'appelant possède la clé : il devient (ou redevient) le propriétaire.
  const inboxId = inboxIdFor(body.publicKey);
  await getDatabase().ref(`inboxOwners/${inboxId}`).set({ uid, at: Date.now() });
  return res.status(200).json({ v: 1, inboxId });
};
