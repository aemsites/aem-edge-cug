'use strict';

/**
 * Cloudflare Worker entry point for Frescopa B2B with CUG authentication.
 *
 * Routes:
 *   GET  /auth/login   — Serve HTML login form
 *   POST /auth/login   — Validate credentials, create session, redirect
 *   /auth/logout       — Destroy session and redirect to home
 *   /auth/portal       — Redirect to business.frescopa.coffee
 *   /auth/me           — Return current user info as JSON
 *   RUM / media        — Passed through to origin without auth
 *   Everything else    — Proxied to origin, then CUG headers are checked
 */

import { redirectToLogin, serveLoginForm, handleLoginPost } from './auth.js';
import { createSession, getSession, sessionCookie, clearSessionCookie } from './session.js';
import { checkCugAccess } from './cug.js';

const PORTAL_URL = '/';

const GROUP_PORTALS = {
  'wknd.com': '/dashboard/wknd',
  'securbank.com': '/dashboard/securbank',
};

function portalForGroups(groups) {
  for (const g of groups || []) {
    if (GROUP_PORTALS[g]) return GROUP_PORTALS[g];
  }
  return PORTAL_URL;
}

const getExtension = (path) => {
  const basename = path.split('/').pop();
  const pos = basename.lastIndexOf('.');
  return (basename === '' || pos < 1) ? '' : basename.slice(pos + 1);
};

const isMediaRequest = (url) => /\/media_[0-9a-f]{40,}[/a-zA-Z0-9_-]*\.[0-9a-z]+$/.test(url.pathname);
const isRUMRequest = (url) => /\/\.(rum|optel)\/.*/.test(url.pathname);

async function proxyToOrigin(request, env, url) {
  const extension = getExtension(url.pathname);
  const savedSearch = url.search;
  const { searchParams } = url;

  if (isMediaRequest(url)) {
    for (const [key] of searchParams.entries()) {
      if (!['format', 'height', 'optimize', 'width'].includes(key)) {
        searchParams.delete(key);
      }
    }
  } else if (extension === 'json') {
    for (const [key] of searchParams.entries()) {
      if (!['limit', 'offset', 'sheet'].includes(key)) {
        searchParams.delete(key);
      }
    }
  } else {
    url.search = '';
  }
  searchParams.sort();

  url.hostname = env.ORIGIN_HOSTNAME;
  const req = new Request(url, request);
  req.headers.set('x-forwarded-host', req.headers.get('host'));
  req.headers.set('x-byo-cdn-type', 'cloudflare');
  if (env.PUSH_INVALIDATION !== 'disabled') {
    req.headers.set('x-push-invalidation', 'enabled');
  }
  if (env.ORIGIN_AUTHENTICATION) {
    req.headers.set('authorization', `token ${env.ORIGIN_AUTHENTICATION}`);
  }

  let resp = await fetch(req, {
    method: req.method,
    cf: { cacheEverything: true },
  });
  resp = new Response(resp.body, resp);

  if (resp.status === 301 && savedSearch) {
    const location = resp.headers.get('location');
    if (location && !location.match(/\?.*$/)) {
      resp.headers.set('location', `${location}${savedSearch}`);
    }
  }
  if (resp.status === 304) {
    resp.headers.delete('Content-Security-Policy');
  }
  resp.headers.delete('age');
  resp.headers.delete('x-robots-tag');
  return resp;
}

const handleRequest = async (request, env) => {
  const url = new URL(request.url);

  if (url.port) {
    const redirectTo = new URL(request.url);
    redirectTo.port = '';
    return new Response('Moved permanently to ' + redirectTo.href, {
      status: 301,
      headers: { location: redirectTo.href },
    });
  }

  if (url.pathname.startsWith('/drafts/')) {
    return new Response('Not Found', { status: 404 });
  }

  if (isRUMRequest(url)) {
    if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }
  }

  // --- Auth routes ---

  if (url.pathname === '/auth/login') {
    if (request.method === 'POST') {
      const result = await handleLoginPost(request);
      if (result instanceof Response) return result;

      const token = await createSession(env, result.userInfo);
      const destination = result.redirectUrl === '/'
        ? portalForGroups(result.userInfo.groups)
        : result.redirectUrl;
      return new Response(null, {
        status: 302,
        headers: {
          Location: new URL(destination, request.url).href,
          'Set-Cookie': sessionCookie(token),
        },
      });
    }
    return serveLoginForm(request);
  }

  if (url.pathname === '/auth/logout') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL('/', request.url).href,
        'Set-Cookie': clearSessionCookie(),
      },
    });
  }

  if (url.pathname === '/auth/portal') {
    const session = await getSession(request, env);
    if (!session) {
      return redirectToLogin(request.url);
    }
    return Response.redirect(new URL(portalForGroups(session.groups), request.url).href, 302);
  }

  if (url.pathname === '/auth/me') {
    const session = await getSession(request, env);
    if (!session) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      authenticated: true,
      email: session.email,
      name: session.name,
      groups: session.groups,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // RUM and media bypass authentication
  if (isRUMRequest(url) || isMediaRequest(url)) {
    return proxyToOrigin(request, env, url);
  }

  // All other requests: fetch from origin, then enforce CUG
  const session = await getSession(request, env);
  const originResponse = await proxyToOrigin(request, env, url);

  return checkCugAccess(originResponse, session, request);
};

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Unhandled worker error:', err.stack || err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
