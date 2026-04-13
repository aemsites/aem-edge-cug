/**
 * Shared test helpers: mock environment (no KV needed for B2B worker).
 */

export function createMockEnv(overrides = {}) {
  return {
    ORIGIN_HOSTNAME: 'main--frescopa-business-da--aem-showcase.aem.live',
    JWT_SECRET: 'test-jwt-secret',
    ...overrides,
  };
}
