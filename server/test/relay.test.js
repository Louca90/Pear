// Teste server/api/relay.js et le nettoyage du relais sans Firebase : node server/test/relay.test.js
const assert = require('assert');
const { state, get, loadHandler, call, reset } = require('./harness');

(async () => {
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

  // 20 envois par jour et par compte.
  for (let i = 0; i < 19; i++) assert.equal((await reserve(10)).code, 200);
  assert.equal((await reserve(10)).code, 429);

  // Budget mensuel : le relais s'arrête avant le plafond gratuit partagé avec la signalisation.
  reset();
  state.db.relayUsage = { [new Date().toISOString().slice(0, 7)]: 6 * 1024 * 1024 * 1024 - 100 };
  assert.equal((await reserve(1000, 'u2')).code, 507);
  assert.equal((await reserve(50, 'u2')).code, 200);

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
