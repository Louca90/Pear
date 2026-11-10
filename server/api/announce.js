const { getMessaging } = require('firebase-admin/messaging');
const { timingSafeEqual } = require('node:crypto');

const { getSetupError, readBody } = require('../lib/firebase');

// Annonce une nouvelle version à tous les téléphones abonnés au topic « updates » (appelée par
// `node scripts/release.mjs publish`). Réservée à Louca : `Authorization: Bearer $ANNOUNCE_SECRET`.
// Le push ne porte que des numéros de version : le texte de la notification est composé dans l'app, dans la
// langue du téléphone, et l'app revérifie la release signée avant de proposer quoi que ce soit.
const TOPIC = 'updates';
const VERSION = /^\d+\.\d+\.\d+$/;
const TTL_MS = 7 * 24 * 3600000;

function isAnnouncer(req) {
  const secret = process.env.ANNOUNCE_SECRET;
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.authorization || '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur mal configuré' });
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAnnouncer(req)) return res.status(401).end();
  const body = readBody(req, ['version', 'versionCode']);
  if (!body || typeof body.version !== 'string' || !VERSION.test(body.version)) return res.status(400).end();
  if (!Number.isInteger(body.versionCode) || body.versionCode < 1) return res.status(400).end();

  try {
    await getMessaging().send({
      topic: TOPIC,
      data: { type: 'update', v: '1', version: body.version, versionCode: String(body.versionCode) },
      android: { priority: 'high', ttl: TTL_MS },
    });
    return res.status(204).end();
  } catch (error) {
    console.error("Echec de l'annonce :", error.code);
    return res.status(502).end();
  }
};
