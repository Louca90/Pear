const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { timingSafeEqual } = require('node:crypto');

// Partagé par les fonctions de server/api (Vercel ne déploie comme fonctions que les fichiers de api/).

const MINUTE_MS = 60000;
const DEFAULT_DATABASE_URL = 'https://pear-2c275-default-rtdb.europe-west1.firebasedatabase.app';

// La clé de service vit uniquement dans les variables d'environnement de Vercel. Si elle manque ou est
// illisible, les fonctions répondent 500 avec un message clair au lieu de planter au démarrage.
let setupError = null;
let serviceAccount = null;
let app = null;
const databaseURL = process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL;
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT manquante');
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  app = getApps()[0] || initializeApp({ credential: cert(serviceAccount), databaseURL });
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

// Appel de la tâche planifiée : Vercel envoie `Authorization: Bearer $CRON_SECRET`. Sans secret configuré,
// personne ne passe (mieux vaut un nettoyage arrêté qu'une porte ouverte).
function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.authorization || '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Les clés directes d'un nœud, sans rien télécharger de ce qu'il contient (`shallow=true` de l'API REST, que
// le SDK admin ne propose pas). Sert à parcourir le relais sans lire les morceaux de fichiers.
async function shallowKeys(path) {
  const { access_token: token } = await app.options.credential.getAccessToken();
  const response = await fetch(`${databaseURL}/${path}.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Lecture de ${path} : ${response.status}`);
  const data = await response.json();
  return data && typeof data === 'object' ? Object.keys(data) : [];
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
  isCron,
  shallowKeys,
  overLimit,
  readBody,
};
