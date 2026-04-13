/**
 * CUG (Closed User Group) access control.
 *
 * Reads x-aem-cug-required and x-aem-cug-groups headers from the origin
 * response and enforces authentication and group-based authorization.
 *
 * Group matching uses the user's groups (derived from email domain) against
 * the comma-separated groups in x-aem-cug-groups. Access is granted if the
 * user belongs to at least one allowed group (OR logic).
 */

import { redirectToLogin } from './auth.js';

export async function checkCugAccess(originResponse, session, request) {
  const cugRequired = originResponse.headers.get('x-aem-cug-required');
  const cugGroups = originResponse.headers.get('x-aem-cug-groups');

  if (cugRequired !== 'true') {
    return stripCugHeaders(originResponse);
  }

  if (!session) {
    return redirectToLogin(request.url);
  }

  if (cugGroups) {
    const allowedGroups = cugGroups.split(',').map((g) => g.trim().toLowerCase());
    const userGroups = session.groups || [];
    const hasAccess = allowedGroups.some((g) => userGroups.includes(g));

    if (!hasAccess) {
      return Response.redirect(new URL('/403', request.url).href, 302);
    }
  }

  const resp = stripCugHeaders(originResponse);
  resp.headers.set('Cache-Control', 'private, no-store');
  return resp;
}

function stripCugHeaders(response) {
  const resp = new Response(response.body, response);
  resp.headers.delete('x-aem-cug-required');
  resp.headers.delete('x-aem-cug-groups');
  return resp;
}
