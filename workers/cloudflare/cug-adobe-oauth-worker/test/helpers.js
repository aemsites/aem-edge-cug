/**
 * Shared test helpers: mock KV store and mock environment.
 */

export function createMockKV() {
  const store = new Map();
  return {
    get: async (key, type) => {
      const val = store.get(key);
      if (val === undefined) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    put: async (key, value) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => {
      store.delete(key);
    },
    _store: store,
  };
}

export function createMockEnv(overrides = {}) {
  return {
    ORIGIN_HOSTNAME: 'main--mysite--myorg.aem.live',
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    OAUTH_AUTHORIZE_URL: 'https://ims.example.com/authorize',
    OAUTH_TOKEN_URL: 'https://ims.example.com/token',
    OAUTH_REDIRECT_URI: 'https://mysite.com/auth/callback',
    OAUTH_SCOPE: 'openid,AdobeID,email,profile',
    OAUTH_LOGOUT_URL: 'https://ims.example.com/ims/logout/v1',
    JWT_SECRET: 'test-jwt-secret',
    SESSIONS: createMockKV(),
    ...overrides,
  };
}

/**
 * Encode a JWT with the given payload (no signature verification in the worker).
 */
export function fakeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${body}.fakesig`;
}
