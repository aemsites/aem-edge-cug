/**
 * Akamai EdgeWorker entry point for AEM Edge Delivery with CUG authentication.
 *
 * onClientRequest  — blocks /drafts/*, strips non-standard ports
 * responseProvider — handles auth routes, proxies to origin, enforces CUG
 *
 * Origin proxying uses httpRequest to the same Akamai domain (request.host).
 * Sub-requests from httpRequest go through Property Manager to the real origin
 * but do not trigger EdgeWorker events, so there is no recursion.
 */

import { httpRequest } from 'http-request';
import { createResponse } from 'create-response';
import config, { getSecrets } from './config.js';
import { createSession, getSession, sessionCookie, clearSessionCookie } from './session.js';
import { redirectToLogin, handleCallback } from './oauth.js';
import { checkCugAccess } from './cug.js';
import { buildUrl, isMediaRequest, isRUMRequest, sanitizeSearchParams } from './utils.js';

const SKIP_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding',
  'host', 'content-length', 'vary',
  'age', 'x-robots-tag',
  'x-aem-cug-required', 'x-aem-cug-groups',
]);

function buildResponseHeaders(originHeaders) {
  const result = {};
  for (const [name, values] of Object.entries(originHeaders)) {
    if (!SKIP_RESPONSE_HEADERS.has(name)) {
      result[name] = values;
    }
  }
  return result;
}

async function proxyToOrigin(request, url) {
  const savedSearch = url.search;
  const sanitizedSearch = sanitizeSearchParams(url.pathname, url.search);
  const originUrl = `https://${request.host}${url.pathname}${sanitizedSearch}`;

  const reqHeaders = {
    'x-forwarded-host': request.host,
    'x-byo-cdn-type': 'akamai',
    'x-push-invalidation': 'enabled',
  };

  const secrets = await getSecrets();
  if (secrets.ORIGIN_AUTHENTICATION) {
    reqHeaders.authorization = `token ${secrets.ORIGIN_AUTHENTICATION}`;
  }

  const originResp = await httpRequest(originUrl, {
    method: request.method,
    headers: reqHeaders,
  });

  const originHeaders = originResp.getHeaders();
  const respHeaders = buildResponseHeaders(originHeaders);

  if (originResp.status === 301 && savedSearch) {
    const location = (originHeaders.location || [])[0];
    if (location && !/\?.*$/.test(location)) {
      respHeaders.location = [`${location}${savedSearch}`];
    }
  }

  if (originResp.status === 304) {
    delete respHeaders['content-security-policy'];
  }

  return {
    status: originResp.status,
    headers: respHeaders,
    body: originResp.body,
    rawHeaders: originHeaders,
  };
}

export function onClientRequest(request) {
  if (request.host && request.host.includes(':')) {
    const cleanHost = request.host.split(':')[0];
    const qs = request.query ? `?${request.query}` : '';
    request.respondWith(301, { Location: `${request.scheme}://${cleanHost}${request.path}${qs}` }, '');
    return;
  }

  if (request.path.startsWith('/drafts/')) {
    request.respondWith(404, {}, 'Not Found');
  }
}

export async function responseProvider(request) {
  try {
    const url = buildUrl(request);
    const secrets = await getSecrets();

    // --- Auth routes ---

    if (url.pathname === '/auth/callback') {
      const result = await handleCallback(url, secrets, request.host);
      if (result.error) {
        return createResponse(result.status, result.headers || {}, result.body);
      }
      const token = await createSession(secrets.JWT_SECRET, result.userInfo);
      return createResponse(302, {
        Location: result.originalUrl,
        'Set-Cookie': sessionCookie(token),
      }, '');
    }

    if (url.pathname === '/auth/login') {
      const redirect = url.searchParams.get('redirect') || '/';
      const loginResp = await redirectToLogin(redirect, secrets.JWT_SECRET);
      return createResponse(loginResp.status, loginResp.headers, loginResp.body);
    }

    if (url.pathname === '/auth/logout') {
      const logoutUrl = `${config.OAUTH_LOGOUT_URL}`
        + `?client_id=${config.OAUTH_CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(url.origin + '/')}`;
      return createResponse(302, {
        Location: logoutUrl,
        'Set-Cookie': clearSessionCookie(),
      }, '');
    }

    if (url.pathname === '/auth/me') {
      const cookieHeader = (request.getHeader('Cookie') || [])[0] || '';
      const session = await getSession(cookieHeader, secrets.JWT_SECRET);
      if (!session) {
        return createResponse(401, { 'Content-Type': 'application/json' },
          JSON.stringify({ authenticated: false }));
      }
      return createResponse(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      }, JSON.stringify({
        authenticated: true,
        email: session.email,
        name: session.name,
        groups: session.groups,
      }));
    }

    // --- RUM method validation ---
    if (isRUMRequest(url.pathname)) {
      if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
        return createResponse(405, {}, 'Method Not Allowed');
      }
    }

    // --- RUM and media bypass (no auth) ---
    if (isRUMRequest(url.pathname) || isMediaRequest(url.pathname)) {
      const origin = await proxyToOrigin(request, url);
      return createResponse(origin.status, origin.headers, origin.body);
    }

    // --- All other requests: proxy then enforce CUG ---
    const cookieHeader = (request.getHeader('Cookie') || [])[0] || '';
    const session = await getSession(cookieHeader, secrets.JWT_SECRET);
    const origin = await proxyToOrigin(request, url);

    const { action } = checkCugAccess(origin.rawHeaders, session);

    switch (action) {
      case 'login': {
        const loginResp = await redirectToLogin(request.url, secrets.JWT_SECRET);
        return createResponse(loginResp.status, loginResp.headers, loginResp.body);
      }
      case 'forbidden':
        return createResponse(302, { Location: `${url.origin}/403` }, '');
      case 'serve_private':
        origin.headers['cache-control'] = ['private, no-store'];
        return createResponse(origin.status, origin.headers, origin.body);
      default: // 'serve'
        return createResponse(origin.status, origin.headers, origin.body);
    }
  } catch (err) {
    return createResponse(500, { 'Content-Type': 'text/plain' }, `Internal Server Error: ${err.message}`);
  }
}
