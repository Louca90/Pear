// libsodium en JavaScript doit finir de se charger avant le premier test.
const { beforeAll, jest } = require('@jest/globals');
const sodium = require('libsodium-wrappers-sumo');

beforeAll(async () => {
  await sodium.ready;
});

// L'app lit sa langue au démarrage ; les tests attendent du français quelle que soit la langue de la machine.
jest.mock('expo-secure-store', () => ({ getItem: () => 'fr', setItemAsync: async () => undefined }));
