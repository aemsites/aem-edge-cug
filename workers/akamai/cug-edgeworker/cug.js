/**
 * CUG (Closed User Group) access control.
 *
 * Reads x-aem-cug-required and x-aem-cug-groups from the origin response
 * headers and returns an action describing how the request should be handled.
 *
 * Group matching uses the user's email domain (e.g., "adobe.com") against
 * the comma-separated domains in x-aem-cug-groups. Access is granted if the
 * user's domain matches at least one (OR logic).
 */

/**
 * @param {object} originHeaders - headers from httpRequest().getHeaders()
 * @param {object|null} session - decoded JWT payload or null
 * @returns {{ action: 'serve'|'serve_private'|'login'|'forbidden' }}
 */
export function checkCugAccess(originHeaders, session) {
  const cugRequired = (originHeaders['x-aem-cug-required'] || [])[0];
  const cugGroups = (originHeaders['x-aem-cug-groups'] || [])[0];

  if (cugRequired !== 'true') {
    return { action: 'serve' };
  }

  if (!session) {
    return { action: 'login' };
  }

  if (cugGroups) {
    const allowedGroups = cugGroups.split(',').map((g) => g.trim().toLowerCase());
    const userGroups = session.groups || [];
    if (!allowedGroups.some((g) => userGroups.includes(g))) {
      return { action: 'forbidden' };
    }
  }

  return { action: 'serve_private' };
}
