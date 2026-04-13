import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { createMockEnv } from './helpers.js';

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
      const request = new Request('https://frescopa-b2b.workers.dev:8080/page');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(301);
      expect(resp.headers.get('location')).toBe('https://frescopa-b2b.workers.dev/page');
    });
  });

  describe('drafts', () => {
    it('returns 404 for /drafts/ paths', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/drafts/secret');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(404);
    });
  });

  describe('RUM requests', () => {
    it('proxies .rum requests without auth', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('rum-data'));
      const request = new Request('https://frescopa-b2b.workers.dev/.rum/collect');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
    });

    it('rejects non-allowed methods for RUM', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/.rum/collect', { method: 'DELETE' });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(405);
    });
  });

  describe('GET /auth/login', () => {
    it('returns the HTML login form', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/login?redirect=/dashboard/securbank');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
      expect(resp.headers.get('Content-Type')).toContain('text/html');
      const body = await resp.text();
      expect(body).toContain('Frescopa B2B');
      expect(body).toContain('Sign in');
    });
  });

  describe('POST /auth/login', () => {
    it('creates a session and redirects on valid credentials', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/login?redirect=/dashboard/securbank', {
        method: 'POST',
        body: new URLSearchParams({ email: 'fred@securbank.com', password: 'fred' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/dashboard/securbank');
      expect(resp.headers.get('Set-Cookie')).toContain('auth_token=');
    });

    it('shows login form with error on invalid credentials', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/login?redirect=/dashboard/securbank', {
        method: 'POST',
        body: new URLSearchParams({ email: 'fred@securbank.com', password: 'wrong' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(401);
      const body = await resp.text();
      expect(body).toContain('Invalid email or password.');
    });
  });

  describe('/auth/logout', () => {
    it('clears cookie and redirects to home', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/logout');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/');
      expect(resp.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });
  });

  describe('/auth/portal', () => {
    it('redirects to login when no session', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/portal');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toContain('/auth/login');
    });

    it('redirects to / when session exists', async () => {
      const { createSession } = await import('../src/session.js');
      const token = await createSession(env, {
        email: 'fred@securbank.com', name: 'Fred', groups: ['securbank.com'],
      });

      const request = new Request('https://frescopa-b2b.workers.dev/auth/portal', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/');
    });
  });

  describe('/auth/me', () => {
    it('returns 401 JSON when no session', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/me');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(401);
      const data = await resp.json();
      expect(data.authenticated).toBe(false);
    });

    it('returns user info when session exists', async () => {
      const { createSession } = await import('../src/session.js');
      const token = await createSession(env, {
        email: 'megan@wknd.com', name: 'Megan', groups: ['wknd.com'],
      });

      const request = new Request('https://frescopa-b2b.workers.dev/auth/me', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.authenticated).toBe(true);
      expect(data.email).toBe('megan@wknd.com');
      expect(data.name).toBe('Megan');
      expect(data.groups).toEqual(['wknd.com']);
    });
  });

  describe('public page (no CUG)', () => {
    it('proxies to origin and returns content', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('<html>public</html>'));
      const request = new Request('https://frescopa-b2b.workers.dev/about');
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

      const request = new Request('https://frescopa-b2b.workers.dev/dashboard/securbank');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toContain('/auth/login');
    });

    it('serves content when session exists and CUG is satisfied', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('<html>dashboard</html>', {
        'x-aem-cug-required': 'true',
        'x-aem-cug-groups': 'securbank.com',
      }));

      const { createSession } = await import('../src/session.js');
      const token = await createSession(env, {
        email: 'fred@securbank.com', name: 'Fred', groups: ['securbank.com'],
      });

      const request = new Request('https://frescopa-b2b.workers.dev/dashboard/securbank', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe('<html>dashboard</html>');
    });

    it('redirects to /403 when user group does not match', async () => {
      vi.stubGlobal('fetch', mockOriginFetch('<html>dashboard</html>', {
        'x-aem-cug-required': 'true',
        'x-aem-cug-groups': 'securbank.com',
      }));

      const { createSession } = await import('../src/session.js');
      const token = await createSession(env, {
        email: 'megan@wknd.com', name: 'Megan', groups: ['wknd.com'],
      });

      const request = new Request('https://frescopa-b2b.workers.dev/dashboard/securbank', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/403');
    });
  });

  describe('error handling', () => {
    it('returns 500 instead of crashing on unhandled errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('origin down')));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const request = new Request('https://frescopa-b2b.workers.dev/page');
      const resp = await worker.fetch(request, env);

      expect(resp.status).toBe(500);
      expect(await resp.text()).toBe('Internal Server Error');
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });
  });
});
