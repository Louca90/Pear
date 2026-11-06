const { getMessaging } = require('firebase-admin/messaging');
const { createHash } = require('node:crypto');

const { getSetupError, overLimit, readBody, verifyCaller } = require('../lib/firebase');

// Limites par minute, gardées dans Firebase : elles survivent au redémarrage des instances Vercel.
// Par appelant (un compte anonyme), et par destinataire (pour qu'on ne puisse pas bombarder un téléphone
// même en créant des comptes à la chaîne).
const MAX_CALLS_PER_CALLER = 30;
const MAX_CALLS_PER_TARGET = 20;
// Un token FCM : lettres, chiffres, deux-points, tirets et soulignés.
const FCM_TOKEN = /^[A-Za-z0-9:_-]{100,4096}$/;
// FCM limite un push à 4 Ko : l'enveloppe chiffrée garde de la marge pour le reste.
const MAX_PAYLOAD_LENGTH = 3500;
// base64url, points et tildes (voir src/chat/pushPayload.ts dans l'app).
const PAYLOAD = /^[A-Za-z0-9+/=_.~-]+$/;
// Un réveil simple peut porter l'étiquette du contact, pour ne réveiller que sa conversation.
const MAX_WAKE_TAG_LENGTH = 64;
// Un simple réveil n'a plus d'intérêt après quelques minutes ; un message ou un fichier, si (FCM garde
// jusqu'à 4 semaines un push pour un téléphone éteint).
const TTL_MS = { wake: 5 * 60000, msg: 7 * 24 * 3600000, file: 7 * 24 * 3600000 };
const PROTOCOL_VERSION = 1;

// Le destinataire est désigné par l'empreinte de son token : le token lui-même n'est jamais stocké.
function targetId(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

// Corps : { token, v?, type?, payload? }. Les apps d'avant le lot 3 n'envoient que { token } (réveil).
function parse(req) {
  const body = readBody(req, ['token', 'v', 'type', 'payload']);
  if (!body) return null;
  const { token, v = 1, type = 'wake', payload } = body;
  if (typeof token !== 'string' || !FCM_TOKEN.test(token)) return null;
  if (!Number.isInteger(v) || v < 1 || v > PROTOCOL_VERSION) return null;
  if (!(type in TTL_MS)) return null;
  const maxLength = type === 'wake' ? MAX_WAKE_TAG_LENGTH : MAX_PAYLOAD_LENGTH;
  if (payload !== undefined && (typeof payload !== 'string' || payload.length > maxLength || !PAYLOAD.test(payload))) return null;
  return { token, v, type, payload };
}

module.exports = async (req, res) => {
  if (getSetupError()) return res.status(500).json({ error: 'Serveur de réveil mal configuré' });
  if (req.method !== 'POST') return res.status(405).end();
  const uid = await verifyCaller(req);
  if (!uid) return res.status(401).end();
  const request = parse(req);
  if (!request) return res.status(400).end();

  try {
    if ((await overLimit('caller', uid, MAX_CALLS_PER_CALLER)) || (await overLimit('target', targetId(request.token), MAX_CALLS_PER_TARGET))) {
      return res.status(429).end();
    }
  } catch (error) {
    // Base injoignable : on ne bloque pas le réveil pour autant.
    console.error('Limite de débit indisponible :', error.code || error.message);
  }

  try {
    // Push "data-only" : il réveille l'app. Le contenu éventuel est chiffré de bout en bout.
    const data = { type: request.type, v: String(request.v) };
    if (request.payload) data.payload = request.payload;
    await getMessaging().send({ token: request.token, data, android: { priority: 'high', ttl: TTL_MS[request.type] } });
    return res.status(204).end();
  } catch (error) {
    // On ne journalise jamais le token du destinataire.
    if (error.code === 'messaging/registration-token-not-registered') return res.status(410).end();
    console.error('Echec du push :', error.code);
    return res.status(502).end();
  }
};
