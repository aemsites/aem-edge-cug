/**
 * CUG (Closed User Group) access control.
 *
 * Reads CUG values from origin headers or HTML metadata and returns an action
 * describing how the request should be handled.
 *
 * Group matching uses the user's email domain (e.g., "adobe.com") against
 * the comma-separated domains in x-aem-cug-groups. Access is granted if the
 * user's domain matches at least one (OR logic).
 */

/**
 * Extract quoted name/content attributes from simple HTML meta tags.
 * Returns the same shape as httpRequest().getHeaders() for shared enforcement.
 */
export function extractCugMetadata(html) {
  const headers = {};
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
        && attributes.content !== undefined && !headers[`x-aem-${name}`]) {
      headers[`x-aem-${name}`] = [attributes.content];
    }
  });
  return headers;
}

/**
 * @param {object} originHeaders - headers from httpRequest().getHeaders()
 * @param {object|null} session - decoded JWT payload or null
 * @returns {{ action: 'serve'|'serve_private'|'login'|'forbidden', loginPath?: string }}
 */
export function checkCugAccess(originHeaders, session) {
  const cugRequired = (originHeaders['x-aem-cug-required'] || [])[0];
  const cugGroups = (originHeaders['x-aem-cug-groups'] || [])[0];

  if (cugRequired !== 'true') {
    return { action: 'serve' };
  }

  if (!session) {
    const loginPath = (originHeaders['x-aem-cug-login-path'] || [])[0];
    if (loginPath) {
      if (!/^(?:\/(?![\\/])|https?:\/\/)/i.test(loginPath) || /[\r\n\\]/.test(loginPath)) {
        throw new Error('Invalid cug-login-path: expected a local path or HTTP(S) URL');
      }
      return { action: 'login', loginPath };
    }
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
