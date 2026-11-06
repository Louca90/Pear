// libsodium en JavaScript doit finir de se charger avant le premier test.
const sodium = require('libsodium-wrappers-sumo');

beforeAll(async () => {
  await sodium.ready;
});
