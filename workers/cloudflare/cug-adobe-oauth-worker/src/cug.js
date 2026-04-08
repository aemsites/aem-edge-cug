/**
 * CUG (Closed User Group) access control.
 *
 * Reads x-aem-cug-required and x-aem-cug-groups headers from the origin
 * response and enforces authentication and email-domain-based authorization.
 *
 * Group matching uses the user's email domain (e.g., "adobe.com") against
 * the comma-separated domains in x-aem-cug-groups. Access is granted if the
 * user's domain matches at least one (OR logic).
 */

import { redirectToLogin } from './oauth.js';

export async function checkCugAccess(originResponse, session, request, env) {
  const cugRequired = originResponse.headers.get('x-aem-cug-required');
  const cugGroups = originResponse.headers.get('x-aem-cug-groups');

  // No CUG protection on this path — serve publicly
  if (cugRequired !== 'true') {
    return stripCugHeaders(originResponse);
  }

  // CUG required but no session — redirect to login
  if (!session) {
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

  const resp = stripCugHeaders(originResponse);
  resp.headers.set('Cache-Control', 'private, no-store');
  return resp;
}

/** Remove CUG headers before sending the response to the browser. */
function stripCugHeaders(response) {
  const resp = new Response(response.body, response);
  resp.headers.delete('x-aem-cug-required');
  resp.headers.delete('x-aem-cug-groups');
  return resp;
}
