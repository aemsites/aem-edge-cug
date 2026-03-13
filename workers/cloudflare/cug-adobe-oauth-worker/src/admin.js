/**
 * Config Service client for pushing CUG headers.
 *
 * Fetches /closed-user-groups.json from the AEM origin, transforms the sheet
 * entries into the Config Service headers format, and POSTs them to the Admin API.
 * Non-CUG headers already present in the config are preserved.
 */

const ADMIN_API_BASE = 'https://admin.hlx.page';
const CUG_SHEET_PATH = '/closed-user-groups.json';
const HEADER_CUG_REQUIRED = 'x-aem-cug-required';
const HEADER_CUG_GROUPS = 'x-aem-cug-groups';

/**
 * Extracts org and site from an AEM Edge Delivery origin hostname.
 * Expected format: {ref}--{site}--{org}.aem.live (or .aem.page, .hlx.live, etc.)
 * Site names may contain single hyphens; only double-dash (--) is a separator.
 */
export function parseOrgSite(originHostname) {
  const match = originHostname.match(/^(.+?)--(.+?)--([^.]+)\./);
  return match ? { site: match[2], org: match[3] } : null;
}

/**
 * Fetches the CUG spreadsheet JSON from the AEM origin.
 * Returns the data array or throws on failure.
 */
async function fetchCugSheet(env) {
  const url = `https://${env.ORIGIN_HOSTNAME}${CUG_SHEET_PATH}`;
  const headers = {};
  if (env.ORIGIN_AUTHENTICATION) {
    headers.authorization = `token ${env.ORIGIN_AUTHENTICATION}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Failed to fetch CUG sheet: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Transforms CUG sheet entries into the Config Service headers format.
 *
 * Each entry with a valid url produces an object keyed by that url path,
 * containing an array of {key, value} header pairs.
 */
export function transformToHeadersConfig(entries) {
  const config = {};

  for (const entry of entries) {
    const path = (entry.url || '').trim();
    if (!path || !path.startsWith('/')) continue;
    if (config[path]) continue;

    const headers = [];
    const required = (entry['cug-required'] || '').trim().toLowerCase();
    if (required === 'true' || required === 'false') {
      headers.push({ key: HEADER_CUG_REQUIRED, value: required });
    }

    const groups = (entry['cug-groups'] || '').trim();
    if (groups) {
      headers.push({ key: HEADER_CUG_GROUPS, value: groups });
    }

    if (headers.length > 0) {
      config[path] = headers;
    }
  }

  return config;
}

function isCugHeader(key) {
  return key === HEADER_CUG_REQUIRED || key === HEADER_CUG_GROUPS;
}

/**
 * Fetches the current site-level config and extracts existing headers,
 * stripping any CUG-related entries so they can be replaced by the new ones.
 * Requires an API key with the "admin" role (the "config" role cannot read).
 */
async function fetchExistingNonCugHeaders(org, site, apiKey) {
  const url = `${ADMIN_API_BASE}/config/${org}/aggregated/${site}.json`;
  const resp = await fetch(url, {
    headers: { authorization: `token ${apiKey}` },
  });

  if (!resp.ok) {
    if (resp.status === 404) return {};
    const body = await resp.text().catch(() => '');
    throw new Error(`Failed to read site config: GET ${url} → ${resp.status} ${resp.statusText} ${body}`);
  }

  const config = await resp.json();
  const existing = config.headers || {};
  const filtered = {};

  for (const [path, headerList] of Object.entries(existing)) {
    const nonCug = Array.isArray(headerList)
      ? headerList.filter((h) => !isCugHeader(h.key))
      : [];
    if (nonCug.length > 0) {
      filtered[path] = nonCug;
    }
  }

  return filtered;
}

/**
 * Merges two headers configs. CUG headers from `cugConfig` are added to
 * `baseConfig`, preserving any non-CUG headers already present per path.
 */
function mergeHeaders(baseConfig, cugConfig) {
  const merged = { ...baseConfig };

  for (const [path, cugHeaders] of Object.entries(cugConfig)) {
    const existing = merged[path] || [];
    merged[path] = [...existing, ...cugHeaders];
  }

  return merged;
}

/**
 * Pushes the merged headers config to the Config Service.
 */
async function postHeadersConfig(org, site, headersConfig, apiKey) {
  const url = `${ADMIN_API_BASE}/config/${org}/sites/${site}/headers.json`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth-token': apiKey,
    },
    body: JSON.stringify(headersConfig),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Config Service POST failed: ${resp.status} ${resp.statusText} — ${body}`);
  }
}

/**
 * Orchestrates the full CUG headers update:
 * 1. Fetch the CUG sheet from origin
 * 2. Transform entries to headers config
 * 3. Fetch existing non-CUG headers from Config Service
 * 4. Merge and POST
 *
 * Returns a summary object with the number of paths updated.
 */
export async function pushCugHeaders(env) {
  const identity = parseOrgSite(env.ORIGIN_HOSTNAME);
  if (!identity) {
    throw new Error(`Cannot derive org/site from ORIGIN_HOSTNAME: ${env.ORIGIN_HOSTNAME}`);
  }

  if (!env.CONFIG_SERVICE_API_KEY) {
    throw new Error('CONFIG_SERVICE_API_KEY secret is not configured');
  }

  const { org, site } = identity;
  const entries = await fetchCugSheet(env);
  const cugConfig = transformToHeadersConfig(entries);
  const baseConfig = await fetchExistingNonCugHeaders(org, site, env.CONFIG_SERVICE_API_KEY);
  const merged = mergeHeaders(baseConfig, cugConfig);

  await postHeadersConfig(org, site, merged, env.CONFIG_SERVICE_API_KEY);

  return {
    org,
    site,
    cugPaths: Object.keys(cugConfig).length,
    totalPaths: Object.keys(merged).length,
  };
}
