/**
 * Portal redirect: routes an authenticated user to the page mapped to their
 * group in the /closed-user-groups-mapping spreadsheet.
 *
 * The mapping is fetched from the AEM origin as JSON:
 *   { "data": [{ "group": "<domain>", "url": "/path" }, ...] }
 *
 * The user's groups are matched against the "group" column.
 * The first match wins.
 */

const MAPPING_PATH = '/closed-user-groups-mapping.json';
const FALLBACK_PATH = '/';

/**
 * Fetches the group-to-URL mapping from the origin and returns the portal
 * path for the given groups. Falls back to FALLBACK_PATH when the mapping
 * is unavailable or no group matches.
 */
export async function getPortalPath(groups, request, env) {
  const origin = new URL(request.url);
  origin.hostname = env.ORIGIN_HOSTNAME;
  origin.pathname = MAPPING_PATH;
  origin.search = '';

  let mapping;
  try {
    const headers = {};
    if (env.ORIGIN_AUTHENTICATION) {
      headers.authorization = `token ${env.ORIGIN_AUTHENTICATION}`;
    }
    const resp = await fetch(origin, { headers });
    if (!resp.ok) {
      return FALLBACK_PATH;
    }
    mapping = await resp.json();
  } catch {
    return FALLBACK_PATH;
  }

  const entries = Array.isArray(mapping.data) ? mapping.data : [];
  const userGroups = groups || [];

  const match = entries.find((entry) => {
    const group = (entry.group || '').trim();
    return userGroups.includes(group);
  });

  return match ? match.url : FALLBACK_PATH;
}

/**
 * Fetches the group-to-URL mapping from the origin and redirects the user
 * to the page that matches their group. Falls back to / when the
 * mapping is unavailable or no group matches.
 */
export async function handlePortalRedirect(session, request, env) {
  const path = await getPortalPath(session.groups, request, env);
  return Response.redirect(new URL(path, request.url).href, 302);
}
