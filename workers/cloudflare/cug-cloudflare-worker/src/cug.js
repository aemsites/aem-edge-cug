/**
 * CUG (Closed User Group) access control.
 *
 * Reads CUG values from origin headers or HTML metadata and enforces
 * authentication and email-domain-based authorization.
 *
 * Group matching uses the user's email domain (e.g., "adobe.com") against
 * the comma-separated domains in x-aem-cug-groups. Access is granted if the
 * user's domain matches at least one (OR logic).
 */

import { redirectToLogin } from './oauth.js';

/**
 * Extract quoted name/content attributes from simple HTML meta tags.
 * Returns Headers for shared enforcement with the header-based policy.
 */
export function extractCugMetadata(html) {
  const headers = new Headers();
  const tags = html.match(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) || [];
  tags.forEach((tag) => {
    const attributes = {};
    const pattern = /\s([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let match = pattern.exec(tag);
    while (match) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3];
      match = pattern.exec(tag);
    }
    const name = (attributes.name || '').toLowerCase();
    if (['cug-required', 'cug-groups', 'cug-login-path'].includes(name)
        && attributes.content !== undefined && !headers.has(`x-aem-${name}`)) {
      headers.set(`x-aem-${name}`, attributes.content);
    }
  });
  return headers;
}

export async function checkCugAccess(originResponse, session, request, env) {
  const source = env.CUG_SOURCE ?? 'headers';
  if (!['headers', 'metadata'].includes(source)) {
    throw new Error('Invalid CUG_SOURCE: expected headers or metadata');
  }
  let response = originResponse;
  let policy = response.headers;
  const contentType = response.headers.get('content-type') || '';
  if (source === 'metadata' && /^text\/html(?:\s*;|\s*$)/i.test(contentType)) {
    const html = await response.text();
    policy = extractCugMetadata(html);
    response = new Response(html, response);
    response.headers.delete('content-encoding');
    response.headers.delete('content-length');
  }
  const cugRequired = policy.get('x-aem-cug-required');
  const cugGroups = policy.get('x-aem-cug-groups');

  // No CUG protection on this path — serve publicly
  if (cugRequired !== 'true') {
    return stripCugHeaders(response);
  }

  // CUG required but no session — redirect to login
  if (!session) {
    const loginPath = policy.get('x-aem-cug-login-path');
    if (loginPath) {
      if (!/^(?:\/(?![\\/])|https?:\/\/)/i.test(loginPath) || /[\r\n\\]/.test(loginPath)) {
        throw new Error('Invalid cug-login-path: expected a local path or HTTP(S) URL');
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: new URL(loginPath, request.url).href,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return redirectToLogin(request.url, env);
  }

  // If specific domains are required, check the user's email domain
  if (cugGroups) {
    const allowedGroups = cugGroups.split(',').map((g) => g.trim().toLowerCase());
    const userGroups = session.groups || [];
    const hasAccess = allowedGroups.some((g) => userGroups.includes(g));

    if (!hasAccess) {
      return Response.redirect(new URL('/403', request.url).href, 302);
    }
  }

  const resp = stripCugHeaders(response);
  resp.headers.set('Cache-Control', 'private, no-store');
  return resp;
}

/** Remove CUG headers before sending the response to the browser. */
function stripCugHeaders(response) {
  const resp = new Response(response.body, response);
  resp.headers.delete('x-aem-cug-required');
  resp.headers.delete('x-aem-cug-groups');
  resp.headers.delete('x-aem-cug-login-path');
  return resp;
}
