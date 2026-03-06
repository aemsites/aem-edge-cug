/**
 * Portal redirect: routes an authenticated user to the page mapped to their
 * group in the /members/closed-user-groups-mapping spreadsheet.
 *
 * The mapping is fetched from the AEM origin as JSON:
 *   { "data": [{ "group": "<domain>", "url": "/path" }, ...] }
 *
 * The user's groups (derived from their email domain during login) are matched
 * against the "group" column. The first match wins.
 */

const MAPPING_PATH = '/closed-user-groups-mapping.json';
const FALLBACK_PATH = '/members';

/**
 * Fetches the group-to-URL mapping from the origin and redirects the user
 * to the page that matches their group. Falls back to /members when the
 * mapping is unavailable or no group matches.
 */
export async function handlePortalRedirect(session, request, env) {
  const origin = new URL(request.url);
  origin.hostname = env.ORIGIN_HOSTNAME;
  origin.pathname = MAPPING_PATH;
  origin.search = '';

  let mapping;
  try {
    const resp = await fetch(origin);
    if (!resp.ok) {
      return redirect(request, FALLBACK_PATH);
    }
    mapping = await resp.json();
  } catch {
    return redirect(request, FALLBACK_PATH);
  }

  const entries = Array.isArray(mapping.data) ? mapping.data : [];
  const userGroups = session.groups || [];

  const match = entries.find((entry) => {
    const group = (entry.group || '').trim();
    return userGroups.includes(group);
  });

  return redirect(request, match ? match.url : FALLBACK_PATH);
}

function redirect(request, path) {
  return Response.redirect(new URL(path, request.url).href, 302);
}
