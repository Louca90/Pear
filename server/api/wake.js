const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

// La clé de service vit uniquement dans les variables d'environnement de Vercel.
if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

const MAX_CALLS_PER_MINUTE = 30;
const calls = new Map();

// Limite simple par utilisateur. La mémoire disparaît avec l'instance Vercel : c'est un frein, pas une garantie.
function isRateLimited(uid) {
  const now = Date.now();
  const recent = (calls.get(uid) || []).filter((time) => now - time < 60000);
  recent.push(now);
  calls.set(uid, recent);
  return recent.length > MAX_CALLS_PER_MINUTE;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // Seule une app connectée à notre projet Firebase peut demander un réveil.
  const idToken = (req.headers.authorization || '').replace(/^Bearer /, '');
  let uid;
  try {
    uid = (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return res.status(401).end();
  }
  if (isRateLimited(uid)) return res.status(429).end();

  const token = req.body && req.body.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return res.status(400).end();

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
