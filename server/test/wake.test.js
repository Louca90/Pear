// Teste server/api/wake.js sans Firebase : node server/test/wake.test.js
const assert = require('assert');
const { state, loadHandler, call, reset } = require('./harness');

(async () => {
  const token = 'a'.repeat(150);
  const code = async (options) => (await call(handler, options)).code;

  // Sans variable d'environnement : 500 propre.
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  let handler = loadHandler('wake');
  assert.equal(await code({ body: { token } }), 500);

  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  handler = loadHandler('wake');
  assert.equal(await code({ method: 'GET' }), 405);
  assert.equal(await code({ auth: 'Bearer nope', body: { token } }), 401);
  assert.equal(await code({ body: { token: 'court' } }), 400);
  assert.equal(await code({ body: { token, autre: 1 } }), 400);
  assert.equal(await code({ body: [token] }), 400);

  // Les apps d'avant le lot 3 n'envoient que le token : réveil simple, TTL court.
  assert.equal(await code({ body: { token } }), 204);
  assert.deepEqual(state.pushes[0].data, { type: 'wake', v: '1' });
  assert.equal(state.pushes[0].android.ttl, 5 * 60000);

  // Message chiffré dans le push : TTL long ; trop gros, version inconnue ou réveil avec contenu : 400.
  assert.equal(await code({ body: { token, v: 1, type: 'msg', payload: 'QUJD' } }), 204);
  assert.deepEqual(state.pushes[1].data, { type: 'msg', v: '1', payload: 'QUJD' });
  assert.equal(state.pushes[1].android.ttl, 7 * 24 * 3600000);
  assert.equal(await code({ body: { token, type: 'msg', payload: 'A'.repeat(3501) } }), 400);
  assert.equal(await code({ body: { token, type: 'msg', payload: '<script>' } }), 400);
  assert.equal(await code({ body: { token, v: 2 } }), 400);
  assert.equal(await code({ body: { token, type: 'wake', payload: 'A'.repeat(65) } }), 400);
  assert.equal(await code({ body: { token, type: 'msg', payload: 'tag~a.b~c.d' } }), 204);
  assert.equal(await code({ body: { token, type: 'pair' } }), 400);

  // Limite par destinataire : 20 par minute (3 appels déjà faits).
  for (let i = 0; i < 17; i++) assert.equal(await code({ body: { token } }), 204);
  assert.equal(await code({ body: { token } }), 429);

  // Limite par appelant : 30 par minute, même vers des destinataires différents.
  reset();
  for (let i = 0; i < 30; i++) assert.equal(await code({ body: { token: 'b'.repeat(120) + i } }), 204);
  assert.equal(await code({ body: { token: 'c'.repeat(150) } }), 429);

  // Token expiré : 410.
  reset();
  state.pushError = Object.assign(new Error('x'), { code: 'messaging/registration-token-not-registered' });
  assert.equal(await code({ body: { token } }), 410);
  console.log('wake.js : tous les cas passent');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
