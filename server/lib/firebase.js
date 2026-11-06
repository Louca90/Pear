const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

// Partagé par les fonctions de server/api (Vercel ne déploie comme fonctions que les fichiers de api/).

const MINUTE_MS = 60000;
const DEFAULT_DATABASE_URL = 'https://pear-2c275-default-rtdb.europe-west1.firebasedatabase.app';

// La clé de service vit uniquement dans les variables d'environnement de Vercel. Si elle manque ou est
// illisible, les fonctions répondent 500 avec un message clair au lieu de planter au démarrage.
let setupError = null;
let serviceAccount = null;
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT manquante');
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount), databaseURL: process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL });
  }
} catch (error) {
  setupError = error.message;
  console.error('Configuration du serveur :', setupError);
}

// Seule une app connectée à notre projet Firebase peut appeler les fonctions. Renvoie l'uid, ou null.
async function verifyCaller(req) {
  const idToken = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    return (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return null;
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

// Un objet JSON qui n'a que les champs prévus (les autres sont refusés), ou null.
function readBody(req, allowed) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !allowed.includes(key))) return null;
  return body;
}

module.exports = {
  getSetupError: () => setupError,
  getServiceAccount: () => serviceAccount,
  verifyCaller,
  overLimit,
  readBody,
};
