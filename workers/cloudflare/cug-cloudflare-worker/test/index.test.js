import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { createMockEnv, fakeJwt } from './helpers.js';

function mockOriginFetch(body = '<html>ok</html>', headers = {}, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { 'Content-Type': 'text/html', ...headers } }),
  );
}

describe('index (request routing)', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
    vi.unstubAllGlobals();
  });

  describe('port stripping', () => {
    it('redirects requests with a port to the same URL without a port', async () => {
      const request = new Request('https://mysite.com:8080/page');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(301);
      expect(resp.headers.get('location')).toBe('https://mysite.com/page');
    });
  });

  describe('drafts', () => {
    it('returns 404 for /drafts/ paths', async () => {
      const request = new Request('https://mysite.com/drafts/secret');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(404);
    });
  });

  describe('RUM requests', () => {
    it('proxies .rum requests without auth', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('rum-data'));
      const request = new Request('https://mysite.com/.rum/collect');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
    });

    it('rejects non-allowed methods for RUM', async () => {
      const request = new Request('https://mysite.com/.rum/collect', { method: 'DELETE' });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(405);
    });
  });

  describe('auth callback', () => {
    it('creates a session and redirects to original URL on success', async () => {
      const state = 'cb-state';
      await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({
        verifier: 'v', originalUrl: 'https://mysite.com/members',
      }));

      const idToken = fakeJwt({ email: 'alice@adobe.com', name: 'Alice' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const request = new Request(`https://mysite.com/auth/callback?code=abc&state=${state}`);
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://mysite.com/members');
      expect(resp.headers.get('Set-Cookie')).toContain('auth_token=');
    });
  });

  describe('auth logout', () => {
    it('clears cookie and redirects to IMS logout', async () => {
      const request = new Request('https://mysite.com/auth/logout');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      const location = resp.headers.get('Location');
      expect(location).toContain('ims.example.com/ims/logout/v1');
      expect(location).toContain('client_id=test-client-id');
      expect(resp.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });
  });

  describe('public page (no CUG)', () => {
    it('proxies to origin and returns content', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('<html>public</html>'));
      const request = new Request('https://mysite.com/about');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe('<html>public</html>');
    });
  });

  describe('protected page (CUG)', () => {
    it('redirects to login when no session and CUG is required', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('<html>secret</html>', {
        'x-aem-cug-required': 'true',
      }));

      const request = new Request('https://mysite.com/members/page');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toContain(env.OAUTH_AUTHORIZE_URL);
    });

    describe('metadata policy mode', () => {
      const html = `<html><head>
        <meta name="cug-required" content="true">
        <meta name="cug-groups" content="adobe.com">
      </head><body>Secret</body></html>`;

      it('enforces metadata on a normal request', async () => {
        env.CUG_SOURCE = 'metadata';
        vi.stubGlobal('fetch', mockOriginFetch(html));
        const resp = await worker.fetch(new Request('https://mysite.com/members'), env);
        expect(resp.status).toBe(302);
        expect(resp.headers.get('Location')).toContain(env.OAUTH_AUTHORIZE_URL);
        expect(await resp.text()).not.toContain('Secret');
      });

      it('fetches GET for anonymous HEAD requests to enforce the HTML policy', async () => {
        env.CUG_SOURCE = 'metadata';
        const fetchOrigin = mockOriginFetch(html);
        vi.stubGlobal('fetch', fetchOrigin);
        const resp = await worker.fetch(new Request('https://mysite.com/members', { method: 'HEAD' }), env);
        expect(fetchOrigin.mock.calls[0][1].method).toBe('GET');
        expect(fetchOrigin.mock.calls[0][0].headers.get('accept-encoding')).toBe('identity');
        expect(resp.status).toBe(302);
        expect(await resp.text()).toBe('');
      });

      it('returns no body on authorized HEAD requests', async () => {
        env.CUG_SOURCE = 'metadata';
        vi.stubGlobal('fetch', mockOriginFetch(html));
        const { createSession } = await import('../src/session.js');
        const token = await createSession(env, {
          email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'],
        });
        const resp = await worker.fetch(new Request('https://mysite.com/members', {
          method: 'HEAD',
          headers: { Cookie: `auth_token=${token}` },
        }), env);
        expect(resp.status).toBe(200);
        expect(resp.headers.get('cache-control')).toBe('private, no-store');
        expect(await resp.text()).toBe('');
      });

      it('leaves header-mode HEAD requests as HEAD', async () => {
        const fetchOrigin = mockOriginFetch('', { 'x-aem-cug-required': 'true' });
        vi.stubGlobal('fetch', fetchOrigin);
        const resp = await worker.fetch(new Request('https://mysite.com/members', { method: 'HEAD' }), env);
        expect(fetchOrigin.mock.calls[0][1].method).toBe('HEAD');
        expect(resp.status).toBe(302);
        expect(await resp.text()).toBe('');
      });

      it.each([
        '/.rum/collect',
        '/media_0123456789abcdef0123456789abcdef01234567.png',
      ])('preserves the auth bypass for %s', async (path) => {
        env.CUG_SOURCE = 'metadata';
        vi.stubGlobal('fetch', mockOriginFetch(html));
        const resp = await worker.fetch(new Request(`https://mysite.com${path}`), env);
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe(html);
      });

      it('logs body-read errors and returns 500 instead of unchecked content', async () => {
        env.CUG_SOURCE = 'metadata';
        const body = new ReadableStream({
          start(controller) { controller.error(new Error('Body read failed')); },
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
          headers: { 'content-type': 'text/html' },
        })));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const resp = await worker.fetch(new Request('https://mysite.com/members'), env);
          expect(resp.status).toBe(500);
          expect(await resp.text()).toBe('Internal Server Error');
          expect(spy).toHaveBeenCalledWith('Unhandled worker error:', expect.stringContaining('Body read failed'));
        } finally {
          spy.mockRestore();
        }
      });

      it('logs invalid source configuration and returns 500', async () => {
        env.CUG_SOURCE = 'invalid';
        vi.stubGlobal('fetch', mockOriginFetch(html));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const resp = await worker.fetch(new Request('https://mysite.com/members'), env);
          expect(resp.status).toBe(500);
          expect(spy).toHaveBeenCalledWith('Unhandled worker error:', expect.stringContaining('Invalid CUG_SOURCE'));
        } finally {
          spy.mockRestore();
        }
      });
    });

    it('serves content when session exists and CUG is satisfied', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('<html>members</html>', {
        'x-aem-cug-required': 'true',
        'x-aem-cug-groups': 'adobe.com',
      }));

      const { createSession } = await import('../src/session.js');
      const token = await createSession(env, {
        email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'],
      });

      const request = new Request('https://mysite.com/members/page', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe('<html>members</html>');
    });
  });

  describe('portal redirect', () => {
    it('redirects to IMS login when no session', async () => {
      const request = new Request('https://mysite.com/auth/portal');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toContain(env.OAUTH_AUTHORIZE_URL);
    });

    it('fetches mapping and redirects to matched page when session exists', async () => {
      const mapping = JSON.stringify({
        data: [{ group: 'adobe.com', url: '/members/adobe-portal' }],
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response(mapping, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const { createSession } = await import('../src/session.js');
      const token = await createSession(env, {
        email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'],
      });

      const request = new Request('https://mysite.com/auth/portal', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://mysite.com/members/adobe-portal');
    });
  });

  describe('error handling', () => {
    it('returns 500 instead of crashing on unhandled errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('origin down')));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = new Request('https://mysite.com/page');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(500);
      expect(await resp.text()).toBe('Internal Server Error');
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });
  });
});
