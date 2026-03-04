import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession, getSession, destroySession, sessionCookie, clearSessionCookie,
} from '../src/session.js';
import { createMockEnv } from './helpers.js';

describe('session', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
  });

  describe('createSession', () => {
    it('stores session data in KV and returns a session ID', async () => {
      const userInfo = { email: 'alice@adobe.com', name: 'Alice', groups: ['adobe.com'] };
      const sessionId = await createSession(env, userInfo);

      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');

      const stored = await env.SESSIONS.get(`session:${sessionId}`, 'json');
      expect(stored.email).toBe('alice@adobe.com');
      expect(stored.name).toBe('Alice');
      expect(stored.groups).toEqual(['adobe.com']);
      expect(stored.createdAt).toBeGreaterThan(0);
    });
  });

  describe('getSession', () => {
    it('returns session data when cookie is valid', async () => {
      const userInfo = { email: 'bob@test.com', name: 'Bob', groups: ['test.com'] };
      const sessionId = await createSession(env, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `session=${sessionId}` },
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

    it('returns null when session ID does not exist in KV', async () => {
      const request = new Request('https://mysite.com/', {
        headers: { Cookie: 'session=nonexistent-id' },
      });
      const session = await getSession(request, env);

      expect(session).toBeNull();
    });

    it('parses session cookie among multiple cookies', async () => {
      const userInfo = { email: 'carol@adobe.com', name: 'Carol', groups: ['adobe.com'] };
      const sessionId = await createSession(env, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `other=abc; session=${sessionId}; another=xyz` },
      });
      const session = await getSession(request, env);

      expect(session.email).toBe('carol@adobe.com');
    });
  });

  describe('destroySession', () => {
    it('removes the session from KV', async () => {
      const userInfo = { email: 'dave@test.com', name: 'Dave', groups: ['test.com'] };
      const sessionId = await createSession(env, userInfo);

      const request = new Request('https://mysite.com/', {
        headers: { Cookie: `session=${sessionId}` },
      });
      await destroySession(request, env);

      const session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
      expect(session).toBeNull();
    });

    it('does nothing when no cookie is present', async () => {
      const request = new Request('https://mysite.com/');
      await destroySession(request, env);
      // no error thrown
    });
  });

  describe('cookie helpers', () => {
    it('sessionCookie sets HttpOnly, Secure, SameSite=Lax', () => {
      const cookie = sessionCookie('abc-123');
      expect(cookie).toBe('session=abc-123; Path=/; HttpOnly; Secure; SameSite=Lax');
    });

    it('clearSessionCookie expires the cookie', () => {
      const cookie = clearSessionCookie();
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('session=;');
    });
  });
});
