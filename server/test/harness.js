// Faux Firebase pour tester les fonctions de server/api sans réseau.
const Module = require('module');

const state = {
  // Base de données : un objet imbriqué, comme la Realtime Database.
  db: {},
  pushes: [],
  pushError: null,
  nextId: 0,
};

function get(path) {
  return path.split('/').filter(Boolean).reduce((node, key) => (node == null ? undefined : node[key]), state.db);
}

function set(path, value) {
  const keys = path.split('/').filter(Boolean);
  let node = state.db;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  if (value === null) delete node[keys[keys.length - 1]];
  else node[keys[keys.length - 1]] = value;
}

const resolveTimestamps = (value) => JSON.parse(JSON.stringify(value), (key, v) => (v && v['.sv'] === 'timestamp' ? Date.now() : v));

function ref(path = '') {
  return {
    transaction: async (update) => {
      const next = update(get(path) ?? null);
      set(path, next);
      return { snapshot: { val: () => next } };
    },
    once: async () => ({ val: () => (get(path) === undefined ? null : JSON.parse(JSON.stringify(get(path)))) }),
    set: async (value) => set(path, resolveTimestamps(value)),
    update: async (values) => Object.entries(values).forEach(([key, value]) => set(`${path}/${key}`, value === null ? null : resolveTimestamps(value))),
    push: async (value) => set(`${path}/id${state.nextId++}`, resolveTimestamps(value)),
  };
}

const fakes = {
  'firebase-admin/app': { cert: (x) => x, getApps: () => [], initializeApp: () => undefined },
  'firebase-admin/auth': {
    getAuth: () => ({
      verifyIdToken: async (token) => {
        if (!token.startsWith('ok')) throw new Error('jeton faux');
        return { uid: token === 'ok' ? 'u1' : token.slice(2) };
      },
    }),
  },
  'firebase-admin/database': { getDatabase: () => ({ ref }), ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } },
  'firebase-admin/messaging': {
    getMessaging: () => ({
      send: async (message) => {
        if (state.pushError) throw state.pushError;
        state.pushes.push(message);
      },
    }),
  },
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return fakes[request] ?? load.call(this, request, ...rest);
};

// Recharge une fonction et le module partagé (qui lit les variables d'environnement au chargement).
function loadHandler(name) {
  for (const file of Object.keys(require.cache)) if (/[\\/]server[\\/](api|lib)[\\/]/.test(file)) delete require.cache[file];
  return require(`../api/${name}.js`);
}

function call(handler, { method = 'POST', auth = 'Bearer ok', body } = {}) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      payload: undefined,
      status(code) {
        this.code = code;
        return this;
      },
      end() {
        resolve(this);
      },
      json(payload) {
        this.payload = payload;
        resolve(this);
      },
    };
    handler({ method, headers: { authorization: auth }, body }, res);
  });
}

function reset() {
  state.db = {};
  state.pushes = [];
  state.pushError = null;
}

module.exports = { state, get, loadHandler, call, reset };
