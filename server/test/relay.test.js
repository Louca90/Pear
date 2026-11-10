// Teste server/api/relay.js et le nettoyage du relais sans Firebase : node server/test/relay.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { state, get, loadHandler, call, reset } = require('./harness');

// Évalue le texte réel de database.rules.json sur une base fictive (pas le moteur Firebase, mais les mêmes
// expressions : `data`, `newData`, `auth`, `$n`, `.child()`, `.parent()`, `.matches()`).
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8')).rules;
Object.defineProperty(String.prototype, 'matches', { value: function (re) { return re.test(String(this)); }, configurable: true });
function snapshot(tree, keys) {
  const node = keys.reduce((n, k) => (n == null ? undefined : n[k]), tree);
  return {
    val: () => (node === undefined ? null : node),
    exists: () => node != null,
    child: (p) => snapshot(tree, [...keys, ...String(p).split('/').filter(Boolean)]),
    parent: () => snapshot(tree, keys.slice(0, -1)),
  };
}
const allows = (expr, vars) => new Function(...Object.keys(vars), `return (${expr});`)(...Object.values(vars));
const canWriteChunk = (tree, id, n, uid = 'u1') =>
  allows(rules.relay.$id.chunks.$n['.write'], { auth: { uid }, data: snapshot(tree, ['relay', id, 'chunks', n]), $n: n });
const canDelete = (tree, id) =>
  allows(rules.relay.$id['.write'], { auth: { uid: 'u2' }, data: snapshot(tree, ['relay', id]), newData: snapshot({}, ['x']), $id: id });

(async () => {
  // Règles : un morceau ne s'écrit que dans une place réservée (meta/slots), par le compte qui a réservé.
  const ID = 'A'.repeat(22);
  const reserved = (extra = {}) => ({
    relay: { [ID]: { meta: { owner: 'u1', size: 3 * 512 * 1024, chunks: 3, slots: { 0: true, 1: true, 2: true }, last: '2', at: 0 }, ...extra } },
  });
  assert.equal(canWriteChunk(reserved(), ID, '0'), true);
  assert.equal(canWriteChunk(reserved(), ID, '2'), true);
  for (const n of ['3', '99', '01']) assert.equal(canWriteChunk(reserved(), ID, n), false);
  assert.equal(canWriteChunk(reserved(), ID, '0', 'u2'), false);
  assert.equal(canWriteChunk(reserved({ chunks: { 0: 'x' } }), ID, '0'), false);
  assert.equal(canWriteChunk({}, ID, '0'), false);
  // Réservation d'avant les `slots` : ancienne règle, pour ne pas bloquer un envoi en cours.
  const legacy = { relay: { [ID]: { meta: { owner: 'u1', size: 10, chunks: 1, at: 0 } } } };
  assert.equal(canWriteChunk(legacy, ID, '5'), true);
  // Un téléphone ne supprime qu'un fichier complet (sinon le budget ne pourrait plus être rendu).
  assert.equal(canDelete(reserved({ chunks: { 0: 'x', 1: 'x' } }), ID), false);
  assert.equal(canDelete(reserved({ chunks: { 0: 'x', 1: 'x', 2: 'x' } }), ID), true);
  assert.equal(canDelete(legacy, ID), true);
  assert.equal(canDelete({}, ID), true);

  process.env.CRON_SECRET = 'secret-cron';
  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  const relay = loadHandler('relay');
  const cleanup = loadHandler('cleanup');
  const reserve = (size, uid = 'u1') => call(relay, { auth: `Bearer ok${uid}`, body: { v: 1, size } });

  assert.equal((await call(relay, { method: 'GET' })).code, 405);
  assert.equal((await call(relay, { auth: 'Bearer faux', body: { v: 1, size: 10 } })).code, 401);
  assert.equal((await reserve(0)).code, 400);
  assert.equal((await call(relay, { body: { v: 1, size: 10, autre: 1 } })).code, 400);
  // Au-delà de 25 Mo : le fichier attendra une connexion directe.
  assert.equal((await reserve(25 * 1024 * 1024 + 1)).code, 413);

  const ok = await reserve(1024 * 1024 + 1);
  assert.equal(ok.code, 200);
  assert.match(ok.payload.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(ok.payload.chunks, 3);
  assert.equal(get(`relay/${ok.payload.id}/meta/owner`), 'u1');
  assert.deepEqual(Object.keys(get(`relay/${ok.payload.id}/meta/slots`)), ['0', '1', '2']);
  assert.equal(get(`relay/${ok.payload.id}/meta/last`), '2');
  // La fiche écrite par le serveur passe les règles : morceaux 0 à 2 oui, 3 non.
  assert.equal(canWriteChunk(state.db, ok.payload.id, '2'), true);
  assert.equal(canWriteChunk(state.db, ok.payload.id, '3'), false);

  // 20 envois par jour et par compte.
  for (let i = 0; i < 19; i++) assert.equal((await reserve(10)).code, 200);
  assert.equal((await reserve(10)).code, 429);

  // Budget mensuel : le relais s'arrête avant le plafond gratuit partagé avec la signalisation.
  reset();
  state.db.relayUsage = { [new Date().toISOString().slice(0, 7)]: 6 * 1024 * 1024 * 1024 - 100 };
  assert.equal((await reserve(1000, 'u2')).code, 507);
  assert.equal((await reserve(50, 'u2')).code, 200);

  // Budget rendu : une réservation jamais envoyée (ou à moitié) est remboursée au nettoyage suivant.
  reset();
  const MB = 1024 * 1024;
  const thisMonth = new Date().toISOString().slice(0, 7);
  state.db.relayUsage = { [thisMonth]: 6 * 1024 * MB - 30 * MB };
  const big = await reserve(25 * MB, 'u3');
  assert.equal(big.code, 200);
  assert.equal((await reserve(10 * MB, 'u4')).code, 507);
  const half = await reserve(3 * MB, 'u5');
  assert.equal(half.code, 200);
  state.db.relay[half.payload.id].chunks = { 0: 'x' };
  // 25 h plus tard : rien d'envoyé pour le premier, 1 morceau sur 6 pour le second.
  const realNow = Date.now;
  Date.now = () => realNow() + 25 * 3600000;
  try {
    assert.equal((await call(cleanup, { method: 'GET', auth: 'Bearer secret-cron' })).payload.removed, 2);
  } finally {
    Date.now = realNow;
  }
  assert.equal(get(`relayUsage/${thisMonth}`), 6 * 1024 * MB - 30 * MB + 512 * 1024);
  assert.equal((await reserve(10 * MB, 'u4')).code, 200);

  // Nettoyage : complet et récent gardé ; incomplet de plus de 24 h et tout fichier de plus de 7 jours supprimés.
  reset();
  const now = Date.now();
  state.db.relay = {
    recent: { meta: { owner: 'u', size: 10, chunks: 1, at: now }, chunks: { 0: 'x' } },
    incomplet: { meta: { owner: 'u', size: 10, chunks: 2, at: now - 25 * 3600000 }, chunks: { 0: 'x' } },
    vieux: { meta: { owner: 'u', size: 10, chunks: 1, at: now - 8 * 24 * 3600000 }, chunks: { 0: 'x' } },
  };
  const cleaned = await call(cleanup, { method: 'GET', auth: 'Bearer secret-cron' });
  assert.equal(cleaned.payload.removed, 2);
  assert.deepEqual(Object.keys(get('relay')), ['recent']);
  // Aucun morceau lu : seulement les fiches `meta`.
  assert.ok(state.reads.every((path) => !/chunks/.test(path)));

  // Accès : sans secret, avec un mauvais, ou sans CRON_SECRET configuré, rien n'est supprimé.
  state.db.relay.vieux = { meta: { owner: 'u', size: 10, chunks: 1, at: now - 8 * 24 * 3600000 }, chunks: { 0: 'x' } };
  for (const auth of ['', 'Bearer faux', 'Bearer okcron', 'Bearer ok']) assert.equal((await call(cleanup, { method: 'GET', auth })).code, 401);
  assert.ok(get('relay/vieux'));
  delete process.env.CRON_SECRET;
  assert.equal((await call(loadHandler('cleanup'), { method: 'GET', auth: 'Bearer undefined' })).code, 401);
  assert.ok(get('relay/vieux'));
  console.log('relay.js : tous les cas passent');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
