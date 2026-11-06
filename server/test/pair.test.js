// Teste inbox.js, pair-request.js et cleanup.js sans Firebase : node server/test/pair.test.js
const assert = require('assert');
const { createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync } = require('node:crypto');
const { state, get, loadHandler, call, reset } = require('./harness');

const SPKI_PREFIX_LENGTH = 12;

// Un téléphone : une clé X25519, comme celle de l'app.
function phone() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX_LENGTH);
  return { privateKey, publicKey: Buffer.from(raw).toString('base64url') };
}

// La preuve telle que l'app la calculera (voir DOCS_SERVEUR.md).
function proof(device, serverKey, uid, at) {
  const server = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(serverKey, 'base64url')]), format: 'der', type: 'spki' });
  const key = createHash('sha256').update(diffieHellman({ privateKey: device.privateKey, publicKey: server })).digest();
  return createHmac('sha256', key).update(`pear-inbox-v1|${uid}|${device.publicKey}|${at}`).digest('base64url');
}

(async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ private_key: 'clé de test' });
  const inbox = loadHandler('inbox');
  const pair = loadHandler('pair-request');
  const cleanup = loadHandler('cleanup');

  // --- inbox.js ---
  const { payload } = await call(inbox, { method: 'GET' });
  const serverKey = payload.serverKey;
  assert.match(serverKey, /^[A-Za-z0-9_-]{43}$/);

  const alice = phone();
  const at = Date.now();
  const register = (device, options = {}) =>
    call(inbox, { auth: `Bearer ok${options.uid ?? 'alice'}`, body: { v: 1, publicKey: device.publicKey, at: options.at ?? at, proof: options.proof ?? proof(device, serverKey, options.uid ?? 'alice', options.at ?? at) } });

  assert.equal((await call(inbox, { auth: 'Bearer faux', body: {} })).code, 401);
  assert.equal((await call(inbox, { auth: 'Bearer okalice', body: { v: 1, publicKey: 'court', at, proof: 'x' } })).code, 400);
  // Preuve datée de plus de 5 minutes : refusée.
  assert.equal((await register(alice, { at: at - 10 * 60000 })).code, 400);
  // Quelqu'un qui connaît seulement la clé publique (le QR) ne peut pas prendre la boîte.
  const mallory = phone();
  assert.equal((await register(alice, { uid: 'mallory', proof: proof(mallory, serverKey, 'mallory', at) })).code, 403);
  // Preuve calculée pour un autre compte : refusée.
  assert.equal((await register(alice, { uid: 'mallory', proof: proof(alice, serverKey, 'alice', at) })).code, 403);

  const registered = await register(alice);
  assert.equal(registered.code, 200);
  const inboxId = registered.payload.inboxId;
  assert.equal(get(`inboxOwners/${inboxId}/uid`), 'alice');
  // Réinstallation (nouveau compte anonyme, même clé) : la boîte change de propriétaire.
  assert.equal((await register(alice, { uid: 'alice2' })).code, 200);
  assert.equal(get(`inboxOwners/${inboxId}/uid`), 'alice2');

  // --- pair-request.js ---
  const request = (options = {}) => call(pair, { auth: `Bearer ok${options.uid ?? 'bob'}`, body: options.body ?? { v: 1, inboxId, sealed: 'c2NlbGxl' } });
  assert.equal((await call(pair, { auth: 'Bearer faux', body: {} })).code, 401);
  assert.equal((await request({ body: { v: 1, inboxId: 'pas-une-boite', sealed: 'abc' } })).code, 400);
  assert.equal((await request({ body: { v: 1, inboxId, sealed: 'A'.repeat(2801) } })).code, 413);
  assert.equal((await request({ body: { v: 1, inboxId, sealed: 'abc', autre: 1 } })).code, 400);

  assert.equal((await request()).code, 204);
  const stored = Object.values(get(`requests/${inboxId}`));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].data, 'c2NlbGxl');
  assert.equal(state.pushes.at(-1).topic, `pair_${inboxId}`);
  assert.deepEqual(state.pushes.at(-1).data, { type: 'pair', v: '1' });

  // Spam d'un même expéditeur : 5 par minute.
  for (let i = 0; i < 4; i++) assert.equal((await request()).code, 204);
  assert.equal((await request()).code, 429);
  // Spam vers une même boîte depuis plusieurs comptes : 10 par minute.
  for (let i = 0; i < 5; i++) assert.equal((await request({ uid: `spam${i}` })).code, 204);
  assert.equal((await request({ uid: 'spam-encore' })).code, 429);

  // Boîte pleine (50 demandes en attente) : refus jusqu'à ce que le destinataire fasse le tri.
  reset();
  for (let i = 0; i < 50; i++) state.db.requests = { ...state.db.requests, [inboxId]: { ...(state.db.requests?.[inboxId] ?? {}), [`r${i}`]: { v: 1, data: 'x', at: Date.now() } } };
  assert.equal((await request({ uid: 'carol' })).code, 507);
  // Les demandes expirées libèrent la place au passage.
  state.db.requests[inboxId].r0.at = Date.now() - 8 * 24 * 3600000;
  assert.equal((await request({ uid: 'dave' })).code, 204);
  assert.equal(get(`requests/${inboxId}/r0`), undefined);

  // --- cleanup.js ---
  reset();
  state.db = {
    requests: { [inboxId]: { old: { v: 1, data: 'x', at: Date.now() - 8 * 24 * 3600000 }, fresh: { v: 1, data: 'y', at: Date.now() } } },
    rateLimits: { caller: { u1: { minute: 1, count: 3 }, u2: { minute: Math.floor(Date.now() / 60000), count: 1 } } },
  };
  assert.equal((await call(cleanup, { method: 'POST' })).code, 405);
  const cleaned = await call(cleanup, { method: 'GET' });
  assert.equal(cleaned.payload.removed, 2);
  assert.deepEqual(Object.keys(get(`requests/${inboxId}`)), ['fresh']);
  assert.deepEqual(Object.keys(get('rateLimits/caller')), ['u2']);

  console.log('inbox.js, pair-request.js, cleanup.js : tous les cas passent');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
