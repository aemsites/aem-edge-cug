import { describe, it, expect } from 'vitest';
import { checkCugAccess } from '../src/cug.js';
import { createMockEnv } from './helpers.js';

function originResponse(headers = {}) {
  return new Response('<html>page</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html', ...headers },
  });
}

describe('cug', () => {
  const env = createMockEnv();
  const request = new Request('https://mysite.com/members/page');

  describe('no CUG protection', () => {
    it('passes through when x-aem-cug-required is absent', async () => {
      const resp = await checkCugAccess(originResponse(), null, request, env);

      expect(resp.status).toBe(200);
      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
    });

    it('passes through when x-aem-cug-required is false', async () => {
      const resp = await checkCugAccess(
        originResponse({ 'x-aem-cug-required': 'false' }),
        null, request, env,
      );

      expect(resp.status).toBe(200);
    });

    it('strips CUG headers from the response', async () => {
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'false',
          'x-aem-cug-groups': 'adobe.com',
        }),
        null, request, env,
      );

      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
      expect(resp.headers.get('x-aem-cug-groups')).toBeNull();
    });
  });

  describe('CUG required, no session', () => {
    it('redirects to login', async () => {
      const resp = await checkCugAccess(
        originResponse({ 'x-aem-cug-required': 'true' }),
        null, request, env,
      );

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toContain(env.OAUTH_AUTHORIZE_URL);
    });
  });

  describe('CUG required, with session, no group restriction', () => {
    it('grants access to any authenticated user', async () => {
      const session = { email: 'alice@random.com', groups: ['random.com'] };
      const resp = await checkCugAccess(
        originResponse({ 'x-aem-cug-required': 'true' }),
        session, request, env,
      );

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe('<html>page</html>');
    });
  });

  describe('CUG required, with group restriction', () => {
    it('grants access when user domain matches an allowed group', async () => {
      const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'adobe.com,partner.com',
        }),
        session, request, env,
      );

      expect(resp.status).toBe(200);
    });

    it('redirects to /403 when user domain does not match any allowed group', async () => {
      const session = { email: 'eve@evil.com', groups: ['evil.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'adobe.com,partner.com',
        }),
        session, request, env,
      );

      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://mysite.com/403');
    });

    it('handles whitespace in comma-separated groups', async () => {
      const session = { email: 'bob@partner.com', groups: ['partner.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'adobe.com , partner.com',
        }),
        session, request, env,
      );

      expect(resp.status).toBe(200);
    });

    it('strips CUG headers from the granted response', async () => {
      const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'adobe.com',
        }),
        session, request, env,
      );

      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
      expect(resp.headers.get('x-aem-cug-groups')).toBeNull();
    });

    it('sets Cache-Control: private, no-store on granted responses', async () => {
      const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
      const resp = await checkCugAccess(
        originResponse({
          'x-aem-cug-required': 'true',
          'x-aem-cug-groups': 'adobe.com',
        }),
        session, request, env,
      );

      expect(resp.headers.get('Cache-Control')).toBe('private, no-store');
    });
  });
});
