// Teste server/api/wake.js sans Firebase : node server/test/wake.test.js
const Module = require('module');
const assert = require('assert');
const path = require.resolve('../api/wake.js');

const counters = new Map();
let pushError = null;
const pushes = [];
const fakes = {
  'firebase-admin/app': { cert: (x) => x, getApps: () => [], initializeApp: () => undefined },
  'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async (t) => { if (t !== 'ok') throw new Error('bad'); return { uid: 'u1' }; } }) },
  'firebase-admin/database': {
    getDatabase: () => ({
      ref: (key) => ({
        transaction: async (update) => {
          const next = update(counters.get(key) ?? null);
          counters.set(key, next);
          return { snapshot: { val: () => next } };
        },
      }),
    }),
  },
  'firebase-admin/messaging': { getMessaging: () => ({ send: async (m) => { if (pushError) throw pushError; pushes.push(m); } }) },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return fakes[request] ?? load.call(this, request, ...rest);
};

function call(handler, { method = 'POST', auth = 'Bearer ok', body } = {}) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      end() { resolve(this.code); },
      json() { resolve(this.code); },
    };
    handler({ method, headers: { authorization: auth }, body }, res);
  });
}

(async () => {
  const token = 'a'.repeat(150);
  // Sans variable d'environnement : 500 propre.
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  let handler = require(path);
  assert.equal(await call(handler, { body: { token } }), 500);
  delete require.cache[require.resolve(path)];

  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  handler = require(path);
  assert.equal(await call(handler, { method: 'GET' }), 405);
  assert.equal(await call(handler, { auth: 'Bearer nope', body: { token } }), 401);
  assert.equal(await call(handler, { body: { token: 'court' } }), 400);
  assert.equal(await call(handler, { body: { token, autre: 1 } }), 400);
  assert.equal(await call(handler, { body: [token] }), 400);
  assert.equal(await call(handler, { body: { token } }), 204);
  assert.deepEqual(pushes[0].data, { type: 'wake' });

  // Limite par destinataire : 20 par minute (1 appel déjà fait).
  for (let i = 0; i < 19; i++) assert.equal(await call(handler, { body: { token } }), 204);
  assert.equal(await call(handler, { body: { token } }), 429);

  // Limite par appelant : 30 par minute, même vers des destinataires différents.
  counters.clear();
  for (let i = 0; i < 30; i++) assert.equal(await call(handler, { body: { token: 'b'.repeat(120) + i } }), 204);
  assert.equal(await call(handler, { body: { token: 'c'.repeat(150) } }), 429);

  // Token expiré : 410.
  counters.clear();
  pushError = Object.assign(new Error('x'), { code: 'messaging/registration-token-not-registered' });
  assert.equal(await call(handler, { body: { token } }), 410);
  console.log('wake.js : tous les cas passent');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
