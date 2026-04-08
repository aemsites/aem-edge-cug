import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSession, getSession, sessionCookie, clearSessionCookie,
} from '../src/session.js';
import { createMockEnv } from './helpers.js';

describe('session (JWT)', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    it('returns a three-part JWT string', async () => {
      const userInfo = { email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'] };
      const token = await createSession(env, userInfo);

      expect(typeof token).toBe('string');
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });

    it('embeds user info in the payload', async () => {
      const userInfo = { email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'] };
      const token = await createSession(env, userInfo);

      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      expect(payload.email).toBe('alice@adobe.com');
      expect(payload.name).toBe('Alice');
      expect(payload.groups).toEqual(['adobe.com']);
      expect(payload.iat).toBeGreaterThan(0);
      expect(payload.exp).toBe(payload.iat + 3600);
    });
  });

  describe('getSession', () => {
    it('returns payload when token is valid', async () => {
      const userInfo = { email: 'bob@test.com', name: 'Bob', groups: ['test.com'] };
      const token = await createSession(env, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const session = await getSession(request, env);

      expect(session.email).toBe('bob@test.com');
      expect(session.groups).toEqual(['test.com']);
    });

    it('returns null when no cookie is present', async () => {
      const request = new Request('https://mysite.com/');
      const session = await getSession(request, env);

      expect(session).toBeNull();
    });

    it('returns null when token has invalid signature', async () => {
      const userInfo = { email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'] };
      const token = await createSession(env, userInfo);
      const tampered = token.slice(0, -4) + 'XXXX';

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `auth_token=${tampered}` },
      });
      const session = await getSession(request, env);

      expect(session).toBeNull();
    });

    it('returns null when token is expired', async () => {
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1000 * 1000)   // createSession: iat = 1000
        .mockReturnValueOnce(9999 * 1000);  // getSession: way past exp

      const userInfo = { email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'] };
      const token = await createSession(env, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const session = await getSession(request, env);

      expect(session).toBeNull();
    });

    it('returns null when token is signed with a different secret', async () => {
      const userInfo = { email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'] };
      const otherEnv = createMockEnv({ JWT_SECRET: 'other-secret' });
      const token = await createSession(otherEnv, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `auth_token=${token}` },
      });
      const session = await getSession(request, env);

      expect(session).toBeNull();
    });

    it('parses auth_token cookie among multiple cookies', async () => {
      const userInfo = { email: 'carol@adobe.com', name: 'Carol', groups: ['adobe.com'] };
      const token = await createSession(env, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `other=abc; auth_token=${token}; another=xyz` },
      });
      const session = await getSession(request, env);

      expect(session.email).toBe('carol@adobe.com');
    });
  });

  describe('cookie helpers', () => {
    it('sessionCookie sets HttpOnly, Secure, SameSite=Lax with Max-Age', () => {
      const cookie = sessionCookie('jwt-token-here');
      expect(cookie).toBe('auth_token=jwt-token-here; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600');
    });

    it('clearSessionCookie expires the cookie', () => {
      const cookie = clearSessionCookie();
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('auth_token=;');
    });
  });
});
