const { Buffer } = require('node:buffer');
const { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, timingSafeEqual } = require('node:crypto');

// Boîtes de demandes de pairing. Les mêmes calculs sont refaits par l'app : voir DOCS_SERVEUR.md.

// Clé publique X25519 d'un téléphone : 32 octets en base64url sans remplissage (43 caractères).
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const INBOX_ID = /^[A-Za-z0-9_-]{32}$/;
// Préfixes DER qui enveloppent une clé X25519 brute, pour l'API crypto de Node.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

// La boîte d'un téléphone : une empreinte de sa clé publique, impossible à inverser.
function inboxIdFor(publicKey) {
  return createHash('sha256').update(`pear-inbox-v1:${publicKey}`).digest('base64url').slice(0, 32);
}

// La clé X25519 du serveur est dérivée de la clé de service Firebase : aucun secret de plus à gérer.
// Elle ne change que si la clé de service est remplacée (les boîtes se réenregistrent alors seules).
function serverKeys(serviceAccount) {
  const seed = createHash('sha256').update(`pear-inbox-server-v1:${serviceAccount.private_key}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
  return { privateKey, publicKey: Buffer.from(raw).toString('base64url') };
}

// Preuve que l'appelant possède la clé privée de `publicKey` : un HMAC calculé avec le secret X25519
// partagé entre sa clé et celle du serveur. Seul le détenteur de la clé privée peut le produire.
function proofMessage(uid, publicKey, at) {
  return `pear-inbox-v1|${uid}|${publicKey}|${at}`;
}

function expectedProof(serverPrivateKey, publicKey, uid, at) {
  const peer = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'base64url')]), format: 'der', type: 'spki' });
  const shared = diffieHellman({ privateKey: serverPrivateKey, publicKey: peer });
  const key = createHash('sha256').update(shared).digest();
  return createHmac('sha256', key).update(proofMessage(uid, publicKey, at)).digest();
}

function isValidProof(serverPrivateKey, publicKey, uid, at, proof) {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return false;
  const given = Buffer.from(proof, 'base64url');
  const wanted = expectedProof(serverPrivateKey, publicKey, uid, at);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

module.exports = { PUBLIC_KEY, INBOX_ID, inboxIdFor, serverKeys, proofMessage, expectedProof, isValidProof };
