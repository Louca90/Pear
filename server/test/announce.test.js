// Teste server/api/announce.js sans Firebase : node server/test/announce.test.js
const assert = require('assert');
const { state, loadHandler, call, reset } = require('./harness');

(async () => {
  const secret = 'secret-annonce-0123456789';
  const code = async (options) => (await call(handler, { auth: `Bearer ${secret}`, ...options })).code;

  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  let handler = loadHandler('announce');
  assert.equal(await code({ body: { version: '1.6.0', versionCode: 9 } }), 500);

  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  delete process.env.ANNOUNCE_SECRET;
  handler = loadHandler('announce');
  // Sans secret configuré, personne n'est accepté, même avec un en-tête vide ou « Bearer undefined ».
  assert.equal(await code({ auth: 'Bearer undefined', body: { version: '1.6.0', versionCode: 9 } }), 401);
  assert.equal(await code({ auth: '', body: { version: '1.6.0', versionCode: 9 } }), 401);

  process.env.ANNOUNCE_SECRET = secret;
  handler = loadHandler('announce');
  assert.equal(await code({ method: 'GET' }), 405);
  assert.equal(await code({ auth: 'Bearer faux', body: { version: '1.6.0', versionCode: 9 } }), 401);
  assert.equal(await code({ auth: 'Bearer ok', body: { version: '1.6.0', versionCode: 9 } }), 401);
  assert.equal(state.pushes.length, 0);

  assert.equal(await code({ body: { version: '1.6', versionCode: 9 } }), 400);
  assert.equal(await code({ body: { version: '1.6.0', versionCode: '9' } }), 400);
  assert.equal(await code({ body: { version: '1.6.0', versionCode: 9, texte: 'x' } }), 400);
  assert.equal(await code({ body: [] }), 400);
  assert.equal(state.pushes.length, 0);

  assert.equal(await code({ body: { version: '1.6.0', versionCode: 9 } }), 204);
  assert.equal(state.pushes[0].topic, 'updates');
  assert.deepEqual(state.pushes[0].data, { type: 'update', v: '1', version: '1.6.0', versionCode: '9' });

  reset();
  state.pushError = Object.assign(new Error('x'), { code: 'messaging/internal-error' });
  assert.equal(await code({ body: { version: '1.6.0', versionCode: 9 } }), 502);
  console.log('announce : ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
