import { describe, it, expect } from 'vitest';
import { redirectToLogin, handleLoginPost } from '../src/auth.js';

function formRequest(body, redirect = '/dashboard/securbank') {
  return new Request(`https://frescopa-b2b.workers.dev/auth/login?redirect=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    body: new URLSearchParams(body),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

describe('auth', () => {
  describe('redirectToLogin', () => {
    it('returns a 302 to /login with redirect param', () => {
      const resp = redirectToLogin('https://frescopa-b2b.workers.dev/dashboard/securbank');

      expect(resp.status).toBe(302);
      const location = new URL(resp.headers.get('Location'));
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('redirect')).toBe('/dashboard/securbank');
    });
  });

  describe('handleLoginPost', () => {
    it('returns userInfo on valid credentials', async () => {
      const req = formRequest({ email: 'fred@securbank.com', password: 'fred' });
      const result = await handleLoginPost(req);

      expect(result).not.toBeInstanceOf(Response);
      expect(result.userInfo.email).toBe('fred@securbank.com');
      expect(result.userInfo.name).toBe('Fred');
      expect(result.userInfo.groups).toEqual(['securbank.com']);
      expect(result.userInfo.password).toBeUndefined();
      expect(result.redirectUrl).toBe('/dashboard/securbank');
    });

    it('accepts case-insensitive email', async () => {
      const req = formRequest({ email: 'Fred@SecurBank.com', password: 'fred' });
      const result = await handleLoginPost(req);

      expect(result).not.toBeInstanceOf(Response);
      expect(result.userInfo.email).toBe('fred@securbank.com');
    });

    it('redirects to /login with error=invalid on wrong password', async () => {
      const req = formRequest({ email: 'fred@securbank.com', password: 'wrong' });
      const result = await handleLoginPost(req);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(302);
      const location = new URL(result.headers.get('Location'));
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('error')).toBe('invalid');
      expect(location.searchParams.get('redirect')).toBe('/dashboard/securbank');
    });

    it('redirects to /login with error=invalid for unknown user', async () => {
      const req = formRequest({ email: 'nobody@example.com', password: 'x' });
      const result = await handleLoginPost(req);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(302);
      const location = new URL(result.headers.get('Location'));
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('error')).toBe('invalid');
    });

    it('redirects to /login with error=missing when fields are empty', async () => {
      const req = formRequest({ email: '', password: '' });
      const result = await handleLoginPost(req);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(302);
      const location = new URL(result.headers.get('Location'));
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('error')).toBe('missing');
    });

    it('defaults redirect to / when not provided', async () => {
      const req = new Request('https://frescopa-b2b.workers.dev/auth/login', {
        method: 'POST',
        body: new URLSearchParams({ email: 'megan@wknd.com', password: 'megan' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const result = await handleLoginPost(req);

      expect(result).not.toBeInstanceOf(Response);
      expect(result.redirectUrl).toBe('/');
    });
  });
});
