import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redirectToLogin, handleCallback } from '../src/oauth.js';
import { createMockEnv, fakeJwt } from './helpers.js';

describe('oauth', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
  });

  describe('redirectToLogin', () => {
    it('returns a 302 redirect to the authorize URL', async () => {
      const resp = await redirectToLogin('https://mysite.com/members', env);

      expect(resp.status).toBe(302);
      const location = resp.headers.get('Location');
      expect(location).toContain(env.OAUTH_AUTHORIZE_URL);
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('code_challenge=');
      expect(location).toContain('code_challenge_method=S256');
      expect(location).toContain('state=');
    });

    it('stores PKCE verifier and original URL in KV', async () => {
      await redirectToLogin('https://mysite.com/secret', env);

      const keys = [...env.SESSIONS._store.keys()];
      expect(keys.length).toBe(1);
      expect(keys[0]).toMatch(/^pkce:/);

      const stored = JSON.parse(env.SESSIONS._store.get(keys[0]));
      expect(stored.originalUrl).toBe('https://mysite.com/secret');
      expect(stored.verifier).toBeTruthy();
    });
  });

  describe('handleCallback', () => {
    it('returns 400 on OAuth error', async () => {
      const request = new Request('https://mysite.com/auth/callback?error=access_denied&error_description=User+denied');
      const result = await handleCallback(request, env);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(400);
      const body = await result.text();
      expect(body).toContain('access_denied');
    });

    it('returns 400 when code or state is missing', async () => {
      const request = new Request('https://mysite.com/auth/callback?code=abc');
      const result = await handleCallback(request, env);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(400);
    });

    it('returns 400 when state is expired or invalid', async () => {
      const request = new Request('https://mysite.com/auth/callback?code=abc&state=invalid');
      const result = await handleCallback(request, env);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(400);
      const body = await result.text();
      expect(body).toContain('Invalid or expired state');
    });

    it('exchanges code for tokens and returns userInfo with email domain as group', async () => {
      const state = 'test-state';
      await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({
        verifier: 'test-verifier',
        originalUrl: 'https://mysite.com/members',
      }));

      const idToken = fakeJwt({ email: 'alice@adobe.com', name: 'Alice' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id_token: idToken, access_token: 'opaque' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const request = new Request(`https://mysite.com/auth/callback?code=authcode&state=${state}`);
      const result = await handleCallback(request, env);

      expect(result).not.toBeInstanceOf(Response);
      expect(result.userInfo.email).toBe('alice@adobe.com');
      expect(result.userInfo.name).toBe('Alice');
      expect(result.userInfo.groups).toEqual(['adobe.com']);
      expect(result.originalUrl).toBe('https://mysite.com/members');

      vi.unstubAllGlobals();
    });

    it('returns 502 when token exchange fails', async () => {
      const state = 'test-state';
      await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({
        verifier: 'test-verifier',
        originalUrl: 'https://mysite.com/members',
      }));

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response('invalid_grant', { status: 400 }),
      ));

      const request = new Request(`https://mysite.com/auth/callback?code=bad&state=${state}`);
      const result = await handleCallback(request, env);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(502);
      const body = await result.text();
      expect(body).not.toContain('invalid_grant');
      expect(body).toBe('Authentication failed. Please try again.');

      spy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('returns 502 when email cannot be determined', async () => {
      const state = 'test-state';
      await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({
        verifier: 'test-verifier',
        originalUrl: 'https://mysite.com/members',
      }));

      const emptyToken = fakeJwt({});

      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: emptyToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const request = new Request(`https://mysite.com/auth/callback?code=authcode&state=${state}`);
      const result = await handleCallback(request, env);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(502);
      const body = await result.text();
      expect(body).toContain('Could not determine user email');

      vi.unstubAllGlobals();
    });

    it('cleans up PKCE state from KV after use', async () => {
      const state = 'cleanup-state';
      await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({
        verifier: 'v',
        originalUrl: 'https://mysite.com/',
      }));

      const idToken = fakeJwt({ email: 'bob@test.com' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const request = new Request(`https://mysite.com/auth/callback?code=c&state=${state}`);
      await handleCallback(request, env);

      const remaining = await env.SESSIONS.get(`pkce:${state}`);
      expect(remaining).toBeNull();

      vi.unstubAllGlobals();
    });
  });
});
