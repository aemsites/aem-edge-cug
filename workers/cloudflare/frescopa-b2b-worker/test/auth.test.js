import { describe, it, expect } from 'vitest';
import { redirectToLogin, serveLoginForm, handleLoginPost } from '../src/auth.js';

function formRequest(body, redirect = '/dashboard/securbank') {
  return new Request(`https://frescopa-b2b.workers.dev/auth/login?redirect=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    body: new URLSearchParams(body),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

describe('auth', () => {
  describe('redirectToLogin', () => {
    it('returns a 302 to /auth/login with redirect param', () => {
      const resp = redirectToLogin('https://frescopa-b2b.workers.dev/dashboard/securbank');

      expect(resp.status).toBe(302);
      const location = new URL(resp.headers.get('Location'));
      expect(location.pathname).toBe('/auth/login');
      expect(location.searchParams.get('redirect')).toBe('/dashboard/securbank');
    });
  });

  describe('serveLoginForm', () => {
    it('returns 200 with HTML containing a form', () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/login?redirect=/dashboard/securbank');
      const resp = serveLoginForm(request);

      expect(resp.status).toBe(200);
      expect(resp.headers.get('Content-Type')).toContain('text/html');
    });

    it('returns 401 with error message when error is provided', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/login?redirect=/');
      const resp = serveLoginForm(request, 'Invalid email or password.');

      expect(resp.status).toBe(401);
      const body = await resp.text();
      expect(body).toContain('Invalid email or password.');
    });

    it('preserves redirect param in the form action', async () => {
      const request = new Request('https://frescopa-b2b.workers.dev/auth/login?redirect=/dashboard/wknd');
      const resp = serveLoginForm(request);
      const body = await resp.text();

      expect(body).toContain('/auth/login?redirect=');
      expect(body).toContain('dashboard%2Fwknd');
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

    it('returns login form with error on wrong password', async () => {
      const req = formRequest({ email: 'fred@securbank.com', password: 'wrong' });
      const result = await handleLoginPost(req);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(401);
      const body = await result.text();
      expect(body).toContain('Invalid email or password.');
    });

    it('returns login form with error for unknown user', async () => {
      const req = formRequest({ email: 'nobody@example.com', password: 'x' });
      const result = await handleLoginPost(req);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(401);
    });

    it('returns login form with error when fields are missing', async () => {
      const req = formRequest({ email: '', password: '' });
      const result = await handleLoginPost(req);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(401);
      const body = await result.text();
      expect(body).toContain('Email and password are required.');
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
