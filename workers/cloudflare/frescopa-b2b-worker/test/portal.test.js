import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPortalPath, handlePortalRedirect } from '../src/portal.js';
import { createMockEnv } from './helpers.js';

function mappingResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('portal', () => {
  let env;
  const request = new Request('https://frescopa-b2b.workers.dev/auth/portal');

  beforeEach(() => {
    env = createMockEnv();
    vi.unstubAllGlobals();
  });

  describe('getPortalPath', () => {
    it('returns the mapped path when user group matches', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: 'wknd.com', url: '/dashboard/wknd' },
          { group: 'securbank.com', url: '/dashboard/securbank' },
        ]),
      ));

      const path = await getPortalPath(['securbank.com'], request, env);
      expect(path).toBe('/dashboard/securbank');
    });

    it('picks the first matching entry', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: 'wknd.com', url: '/dashboard/first' },
          { group: 'wknd.com', url: '/dashboard/second' },
        ]),
      ));

      const path = await getPortalPath(['wknd.com'], request, env);
      expect(path).toBe('/dashboard/first');
    });

    it('falls back to / when no group matches', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: 'wknd.com', url: '/dashboard/wknd' },
        ]),
      ));

      const path = await getPortalPath(['unknown.com'], request, env);
      expect(path).toBe('/');
    });

    it('falls back to / when fetch returns non-200', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response('Not Found', { status: 404 }),
      ));

      const path = await getPortalPath(['wknd.com'], request, env);
      expect(path).toBe('/');
    });

    it('falls back to / when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));

      const path = await getPortalPath(['wknd.com'], request, env);
      expect(path).toBe('/');
    });

    it('handles whitespace in group values', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: '  securbank.com  ', url: '/dashboard/securbank' },
        ]),
      ));

      const path = await getPortalPath(['securbank.com'], request, env);
      expect(path).toBe('/dashboard/securbank');
    });

    it('falls back to / when data array is missing from response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const path = await getPortalPath(['wknd.com'], request, env);
      expect(path).toBe('/');
    });

    it('falls back to / when groups is null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: 'wknd.com', url: '/dashboard/wknd' },
        ]),
      ));

      const path = await getPortalPath(null, request, env);
      expect(path).toBe('/');
    });

    it('fetches the mapping from the origin hostname', async () => {
      const fetchSpy = vi.fn().mockResolvedValueOnce(
        mappingResponse([{ group: 'wknd.com', url: '/dashboard/wknd' }]),
      );
      vi.stubGlobal('fetch', fetchSpy);

      await getPortalPath(['wknd.com'], request, env);

      const fetchedUrl = new URL(fetchSpy.mock.calls[0][0]);
      expect(fetchedUrl.hostname).toBe(env.ORIGIN_HOSTNAME);
      expect(fetchedUrl.pathname).toBe('/closed-user-groups-mapping.json');
    });

    it('sends authorization header when ORIGIN_AUTHENTICATION is set', async () => {
      env.ORIGIN_AUTHENTICATION = 'my-token';
      const fetchSpy = vi.fn().mockResolvedValueOnce(
        mappingResponse([{ group: 'wknd.com', url: '/dashboard/wknd' }]),
      );
      vi.stubGlobal('fetch', fetchSpy);

      await getPortalPath(['wknd.com'], request, env);

      const fetchOptions = fetchSpy.mock.calls[0][1];
      expect(fetchOptions.headers.authorization).toBe('token my-token');
    });
  });

  describe('handlePortalRedirect', () => {
    it('redirects to the mapped URL when user group matches', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: 'securbank.com', url: '/dashboard/securbank' },
        ]),
      ));

      const session = { email: 'fred@securbank.com', groups: ['securbank.com'] };
      const resp = await handlePortalRedirect(session, request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/dashboard/securbank');
    });

    it('redirects to / when no group matches', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        mappingResponse([
          { group: 'wknd.com', url: '/dashboard/wknd' },
        ]),
      ));

      const session = { email: 'eve@unknown.com', groups: ['unknown.com'] };
      const resp = await handlePortalRedirect(session, request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/');
    });
  });
});
