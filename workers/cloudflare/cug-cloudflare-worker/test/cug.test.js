import { describe, it, expect, vi } from 'vitest';
import { checkCugAccess, extractCugMetadata } from '../src/cug.js';
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
          'x-aem-cug-login-path': '/login',
        }),
        null, request, env,
      );

      expect(resp.headers.get('x-aem-cug-required')).toBeNull();
      expect(resp.headers.get('x-aem-cug-groups')).toBeNull();
      expect(resp.headers.get('x-aem-cug-login-path')).toBeNull();
    });
  });

  describe('HTML metadata', () => {
    const metadataEnv = createMockEnv({ CUG_SOURCE: 'metadata' });
    const html = `<html><head>
        <meta name="cug-required" content="true">
        <meta name="cug-groups" content="adobe.com, partner.com">
      </head><body>Protected content</body></html>`;
    const response = (body = html, headers = {}) => new Response(body, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
    });

    it('extracts all policies with mixed case, quotes, whitespace and attribute order', () => {
      const headers = extractCugMetadata(`
          <META CONTENT = 'true' NAME = "cug-required">
          <meta class="extra" name='cug-groups' content="adobe.com, partner.com" />
          <meta content='/login' name='cug-login-path'>
          <meta name="unrelated" content="ignored">
        `);
      expect(Object.fromEntries(headers)).toEqual({
        'x-aem-cug-required': 'true',
        'x-aem-cug-groups': 'adobe.com, partner.com',
        'x-aem-cug-login-path': '/login',
      });
    });

    it('ignores incomplete and unrelated tags and keeps the first duplicate', () => {
      const headers = extractCugMetadata(`
          <meta data-name="cug-required" content="true">
          <meta name="cug-required">
          <meta name="cug-required" content="true">
          <meta name="cug-required" content="false">
        `);
      expect(Object.fromEntries(headers)).toEqual({ 'x-aem-cug-required': 'true' });
      expect(Object.fromEntries(extractCugMetadata(''))).toEqual({});
    });

    it('requires authentication before delivering protected HTML', async () => {
      const resp = await checkCugAccess(response(), null, request, metadataEnv);
      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toContain(env.OAUTH_AUTHORIZE_URL);
      expect(await resp.text()).not.toContain('Protected content');
    });

    it('serves matching groups privately and removes stale payload headers', async () => {
      const resp = await checkCugAccess(response(html, {
        'content-encoding': 'gzip',
        'content-length': '42',
        'x-aem-cug-required': 'true',
        'x-aem-cug-groups': 'other.com',
        'x-aem-cug-login-path': '/header-login',
      }), { groups: ['partner.com'] }, request, metadataEnv);
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe(html);
      expect(resp.headers.get('cache-control')).toBe('private, no-store');
      ['content-encoding', 'content-length', 'x-aem-cug-required', 'x-aem-cug-groups', 'x-aem-cug-login-path']
        .forEach((name) => expect(resp.headers.has(name)).toBe(false));
    });

    it('rejects authenticated users outside the allowed groups', async () => {
      const resp = await checkCugAccess(response(), { groups: ['other.com'] }, request, metadataEnv);
      expect(resp.status).toBe(302);
      expect(resp.headers.get('Location')).toBe('https://mysite.com/403');
    });

    it('uses only metadata for HTML, including absent and false required values', async () => {
      const publicPages = [
        '<html>Public</html>',
        '<meta name="cug-required" content="false">',
      ];
      await Promise.all(publicPages.map(async (body) => {
        const resp = await checkCugAccess(
          response(body, { 'x-aem-cug-required': 'true' }), null, request, metadataEnv,
        );
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe(body);
      }));
    });

    it('allows any authenticated user when metadata has no group restriction', async () => {
      const resp = await checkCugAccess(
        response('<meta name="cug-required" content="true">'), {}, request, metadataEnv,
      );
      expect(resp.status).toBe(200);
      expect(resp.headers.get('cache-control')).toBe('private, no-store');
    });

    it('retains header enforcement for non-HTML without reading the body', async () => {
      const origin = response('{}', {
        'Content-Type': 'application/json',
        'x-aem-cug-required': 'true',
      });
      const read = vi.spyOn(origin, 'text');
      const resp = await checkCugAccess(origin, null, request, metadataEnv);
      expect(resp.status).toBe(302);
      expect(read).not.toHaveBeenCalled();
    });

    it('keeps header mode streaming and ignores metadata by default', async () => {
      const origin = response();
      const read = vi.spyOn(origin, 'text');
      const resp = await checkCugAccess(origin, null, request, env);
      expect(resp.status).toBe(200);
      expect(resp.body).toBe(origin.body);
      expect(read).not.toHaveBeenCalled();
    });

    it.each(['headers', 'metadata'])('supports custom login paths in %s mode', async (source) => {
      await Promise.all(['/login', 'https://idp.example.com/login'].map(async (loginPath) => {
        const origin = source === 'headers'
          ? originResponse({ 'x-aem-cug-required': 'true', 'x-aem-cug-login-path': loginPath })
          : response(`${html}<meta name="cug-login-path" content="${loginPath}">`);
        const resp = await checkCugAccess(origin, null, request, { ...env, CUG_SOURCE: source });
        expect(resp.status).toBe(302);
        expect(resp.headers.get('Location')).toBe(new URL(loginPath, request.url).href);
        expect(resp.headers.get('cache-control')).toBe('private, no-store');
      }));
    });

    it.each(['headers', 'metadata'])('rejects unsafe login paths in %s mode', async (source) => {
      const unsafePaths = [
        // eslint-disable-next-line no-script-url
        'javascript:alert(1)', '//other.example/login', '/\\other.example',
      ];
      await Promise.all(unsafePaths.map(async (loginPath) => {
        const origin = source === 'headers'
          ? originResponse({ 'x-aem-cug-required': 'true', 'x-aem-cug-login-path': loginPath })
          : response(`${html}<meta name="cug-login-path" content="${loginPath}">`);
        await expect(checkCugAccess(origin, null, request, { ...env, CUG_SOURCE: source }))
          .rejects.toThrow('Invalid cug-login-path');
      }));
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
