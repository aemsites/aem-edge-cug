import URLSearchParams from 'url-search-params';

/**
 * Build a URL-like object from Akamai EdgeWorker request properties.
 * Akamai's runtime does not provide the global URL constructor.
 */
export function buildUrl(request) {
  const search = request.query ? `?${request.query}` : '';
  const origin = `${request.scheme}://${request.host}`;
  return {
    pathname: request.path,
    search,
    origin,
    href: `${origin}${request.path}${search}`,
    host: request.host,
    hostname: request.host.split(':')[0],
    searchParams: new URLSearchParams(request.query || ''),
  };
}

export const getExtension = (path) => {
  const basename = path.split('/').pop();
  const pos = basename.lastIndexOf('.');
  return (basename === '' || pos < 1) ? '' : basename.slice(pos + 1);
};

export const isMediaRequest = (pathname) =>
  /\/media_[0-9a-f]{40,}[/a-zA-Z0-9_-]*\.[0-9a-z]+$/.test(pathname);

export const isRUMRequest = (pathname) =>
  /\/\.(rum|optel)\/.*/.test(pathname);

/**
 * Sanitize query params per resource type to prevent cache pollution.
 * Returns the sanitized query string including the leading '?', or ''.
 */
export function sanitizeSearchParams(pathname, search) {
  if (!search) return '';
  const params = new URLSearchParams(search);

  if (isMediaRequest(pathname)) {
    for (const key of [...params.keys()]) {
      if (!['format', 'height', 'optimize', 'width'].includes(key)) {
        params.delete(key);
      }
    }
  } else if (getExtension(pathname) === 'json') {
    for (const key of [...params.keys()]) {
      if (!['limit', 'offset', 'sheet'].includes(key)) {
        params.delete(key);
      }
    }
  } else {
    return '';
  }

  params.sort();
  const result = params.toString();
  return result ? `?${result}` : '';
}
