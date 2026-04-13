import { describe, it, expect } from 'vitest';
import { checkCugAccess } from '../src/cug.js';

function originResponse(headers = {}) {
  return new Response('<html>page</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html', ...headers },
  });
}

describe('cug', () => {
  const request = new Request('https://frescopa-b2b.workers.dev/dashboard/securbank');

  describe('no CUG protection', () => {
    it('passes through when x-aem-cug-required is absent', async () => {
      const resp = await checkCugAccess(originResponse(), null, request);

      expect(resp.status).toBe(200);
      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
    });

    it('passes through when x-aem-cug-required is false', async () => {
      const resp = await checkCugAccess(
        originResponse({ 'x-aem-cug-required': 'false' }),
        null, request,
      );

      expect(resp.status).toBe(200);
    });

    it('strips CUG headers from the response', async () => {
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'false',
          'x-aem-cug-groups': 'securbank.com',
        }),
        null, request,
      );

      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
      expect(resp.headers.get('x-aem-cug-groups')).toBeNull();
    });
  });

  describe('CUG required, no session', () => {
    it('redirects to /auth/login', async () => {
      const resp = await checkCugAccess(
        originResponse({ 'x-aem-cug-required': 'true' }),
        null, request,
      );

      expect(resp.status).toBe(302);
      const location = resp.headers.get('Location');
      expect(location).toContain('/auth/login');
      expect(location).toContain('redirect=');
    });
  });

  describe('CUG required, with session, no group restriction', () => {
    it('grants access to any authenticated user', async () => {
      const session = { email: 'fred@securbank.com', groups: ['securbank.com'] };
      const resp = await checkCugAccess(
        originResponse({ 'x-aem-cug-required': 'true' }),
        session, request,
      );

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe('<html>page</html>');
    });
  });

  describe('CUG required, with group restriction', () => {
    it('grants access when user group matches an allowed group', async () => {
      const session = { email: 'fred@securbank.com', groups: ['securbank.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'securbank.com,wknd.com',
        }),
        session, request,
      );

      expect(resp.status).toBe(200);
    });

    it('redirects to /403 when user group does not match', async () => {
      const session = { email: 'megan@wknd.com', groups: ['wknd.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'securbank.com',
        }),
        session, request,
      );

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://frescopa-b2b.workers.dev/403');
    });

    it('handles whitespace in comma-separated groups', async () => {
      const session = { email: 'megan@wknd.com', groups: ['wknd.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'securbank.com , wknd.com',
        }),
        session, request,
      );

      expect(resp.status).toBe(200);
    });

    it('strips CUG headers from the granted response', async () => {
      const session = { email: 'fred@securbank.com', groups: ['securbank.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'securbank.com',
        }),
        session, request,
      );

      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
      expect(resp.headers.get('x-aem-cug-groups')).toBeNull();
    });

    it('sets Cache-Control: private, no-store on granted responses', async () => {
      const session = { email: 'fred@securbank.com', groups: ['securbank.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'securbank.com',
        }),
        session, request,
      );

      expect(resp.headers.get('Cache-Control')).toBe('private, no-store');
    });
  });
});
