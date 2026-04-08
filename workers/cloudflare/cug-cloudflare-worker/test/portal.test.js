import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePortalRedirect } from '../src/portal.js';
import { createMockEnv } from './helpers.js';

function mappingResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('portal', () => {
  let env;
  const request = new Request('https://mysite.com/auth/portal');

  beforeEach(() => {
    env = createMockEnv();
    vi.unstubAllGlobals();
  });

  it('redirects to the mapped URL when user group matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      mappingResponse([
        { group: 'adobe.com', url: '/members/adobe-portal' },
        { group: 'partner.com', url: '/members/partner-portal' },
      ]),
    ));

    const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location')).toBe('https://mysite.com/members/adobe-portal');
  });

  it('picks the first matching entry when multiple groups could match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      mappingResponse([
        { group: 'adobe.com', url: '/members/first' },
        { group: 'adobe.com', url: '/members/second' },
      ]),
    ));

    const session = { email: 'bob@adobe.com', groups: ['adobe.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.headers.get('Location')).toBe('https://mysite.com/members/first');
  });

  it('redirects to /members when no group matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      mappingResponse([
        { group: 'adobe.com', url: '/members/adobe-portal' },
      ]),
    ));

    const session = { email: 'eve@unknown.com', groups: ['unknown.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location')).toBe('https://mysite.com/members');
  });

  it('redirects to /members when mapping fetch returns non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    ));

    const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location')).toBe('https://mysite.com/members');
  });

  it('redirects to /members when mapping fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));

    const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location')).toBe('https://mysite.com/members');
  });

  it('handles whitespace in group values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      mappingResponse([
        { group: '  partner.com  ', url: '/members/partner-portal' },
      ]),
    ));

    const session = { email: 'bob@partner.com', groups: ['partner.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.headers.get('Location')).toBe('https://mysite.com/members/partner-portal');
  });

  it('redirects to /members when data array is missing from response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location')).toBe('https://mysite.com/members');
  });

  it('redirects to /members when session has no groups', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      mappingResponse([
        { group: 'adobe.com', url: '/members/adobe-portal' },
      ]),
    ));

    const session = { email: 'alice@adobe.com' };
    const resp = await handlePortalRedirect(session, request, env);

    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location')).toBe('https://mysite.com/members');
  });

  it('fetches the mapping from the origin hostname', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      mappingResponse([{ group: 'adobe.com', url: '/members/portal' }]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const session = { email: 'alice@adobe.com', groups: ['adobe.com'] };
    await handlePortalRedirect(session, request, env);

    const fetchedUrl = new URL(fetchSpy.mock.calls[0][0]);
    expect(fetchedUrl.hostname).toBe(env.ORIGIN_HOSTNAME);
    expect(fetchedUrl.pathname).toBe('/closed-user-groups-mapping.json');
  });
});
