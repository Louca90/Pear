const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { createHash } = require('node:crypto');

// Limites par minute, gardées dans Firebase : elles survivent au redémarrage des instances Vercel.
// Par appelant (un compte anonyme), et par destinataire (pour qu'on ne puisse pas bombarder un téléphone
// même en créant des comptes à la chaîne).
const MAX_CALLS_PER_CALLER = 30;
const MAX_CALLS_PER_TARGET = 20;
const MINUTE_MS = 60000;
// Un token FCM : lettres, chiffres, deux-points, tirets et soulignés.
const FCM_TOKEN = /^[A-Za-z0-9:_-]{100,4096}$/;
const DEFAULT_DATABASE_URL = 'https://pear-2c275-default-rtdb.europe-west1.firebasedatabase.app';

// La clé de service vit uniquement dans les variables d'environnement de Vercel. Si elle manque ou est
// illisible, la fonction répond 500 avec un message clair au lieu de planter au démarrage.
let setupError = null;
if (!getApps().length) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT manquante');
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL,
    });
  } catch (error) {
    setupError = error.message;
    console.error('Configuration du serveur de réveil :', setupError);
  }
}

// Compte un appel dans rateLimits/{kind}/{id} : { minute, count }. Un seul nœud par appelant ou
// destinataire, remis à zéro à chaque nouvelle minute : la base ne grossit pas.
async function overLimit(kind, id, max) {
  const minute = Math.floor(Date.now() / MINUTE_MS);
  const result = await getDatabase()
    .ref(`rateLimits/${kind}/${id}`)
    .transaction((current) => (current && current.minute === minute ? { minute, count: current.count + 1 } : { minute, count: 1 }));
  return result.snapshot.val().count > max;
}

// Le destinataire est désigné par l'empreinte de son token : le token lui-même n'est jamais stocké.
function targetId(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

module.exports = async (req, res) => {
  if (setupError) return res.status(500).json({ error: 'Serveur de réveil mal configuré' });
  if (req.method !== 'POST') return res.status(405).end();

  // Seule une app connectée à notre projet Firebase peut demander un réveil.
  const idToken = (req.headers.authorization || '').replace(/^Bearer /, '');
  let uid;
  try {
    uid = (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return res.status(401).end();
  }

  // Un objet avec un seul champ token, rien d'autre.
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'token')) return res.status(400).end();
  const token = body.token;
  if (typeof token !== 'string' || !FCM_TOKEN.test(token)) return res.status(400).end();

  try {
    if ((await overLimit('caller', uid, MAX_CALLS_PER_CALLER)) || (await overLimit('target', targetId(token), MAX_CALLS_PER_TARGET))) {
      return res.status(429).end();
    }
  } catch (error) {
    // Base injoignable : on ne bloque pas le réveil pour autant.
    console.error('Limite de débit indisponible :', error.code || error.message);
  }

  try {
    // Push "data-only" : il réveille l'app mais ne contient ni message ni expéditeur.
    await getMessaging().send({
      token,
      data: { type: 'wake' },
      android: { priority: 'high', ttl: 120000 },
    });
    return res.status(204).end();
  } catch (error) {
    // On ne journalise jamais le token du destinataire.
    if (error.code === 'messaging/registration-token-not-registered') return res.status(410).end();
    console.error('Echec du push :', error.code);
    return res.status(502).end();
  }
};
