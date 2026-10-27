/* eslint-env node */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const cugSource = await readFile(new URL('../cug.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const cug = new SourceTextModule(cugSource);
await cug.link(() => { throw new Error('Unexpected CUG dependency'); });
await cug.evaluate();
const { extractCugMetadata, checkCugAccess } = cug.namespace;

const protectedHtml = `<html><head>
  <meta name="cug-required" content="true">
  <meta name="cug-groups" content="adobe.com, example.com">
</head><body>Protected content</body></html>`;

test('extracts all three metadata values with mixed case, quotes and attribute order', () => {
  assert.deepEqual(extractCugMetadata(`
    <META CONTENT = 'true' NAME = "cug-required">
    <meta class="extra" name='cug-groups' content="adobe.com, example.com" />
    <meta content='/login' name='cug-login-path'>
    <meta name="unrelated" content="ignored">
  `), {
    'x-aem-cug-required': ['true'],
    'x-aem-cug-groups': ['adobe.com, example.com'],
    'x-aem-cug-login-path': ['/login'],
  });
});

test('ignores incomplete and unrelated tags and keeps the first duplicate', () => {
  assert.deepEqual(extractCugMetadata(`
    <meta data-name="cug-required" content="true">
    <meta name="cug-required">
    <meta name="cug-required" content="true">
    <meta name="cug-required" content="false">
  `), { 'x-aem-cug-required': ['true'] });
  assert.deepEqual(extractCugMetadata(''), {});
});

test('applies the same access decisions to metadata and headers', () => {
  const headers = extractCugMetadata(protectedHtml);
  assert.deepEqual(checkCugAccess(headers, null), { action: 'login' });
  assert.deepEqual(checkCugAccess(headers, { groups: ['example.com'] }), { action: 'serve_private' });
  assert.deepEqual(checkCugAccess(headers, { groups: ['other.com'] }), { action: 'forbidden' });
  assert.deepEqual(checkCugAccess({}, null), { action: 'serve' });
  assert.deepEqual(checkCugAccess({ 'x-aem-cug-required': ['false'] }, null), { action: 'serve' });
  assert.deepEqual(checkCugAccess({ 'x-aem-cug-required': ['true'] }, {}), { action: 'serve_private' });
});

test('supports local and external login paths and rejects unsafe redirect values', () => {
  ['/login', 'https://idp.example.com/login'].forEach((loginPath) => {
    const headers = {
      'x-aem-cug-required': ['true'],
      'x-aem-cug-login-path': [loginPath],
    };
    assert.deepEqual(checkCugAccess(headers, null), { action: 'login', loginPath });
    assert.deepEqual(checkCugAccess(headers, {}), { action: 'serve_private' });
  });
  // eslint-disable-next-line no-script-url
  ['javascript:alert(1)', '//other.example/login', '/\\other.example', '/login\r\nx: y'].forEach((value) => {
    assert.throws(() => checkCugAccess({
      'x-aem-cug-required': ['true'],
      'x-aem-cug-login-path': [value],
    }, null), /Invalid cug-login-path/);
  });
});

async function respond({
  source = 'headers', html = protectedHtml, headers = {}, session = null, method = 'GET',
  path = '/members', textError = false,
} = {}) {
  let textReads = 0;
  let originMethod;
  const stream = { originalBody: true };
  const modules = {
    'http-request': {
      httpRequest: async (url, options) => {
        originMethod = options.method;
        return {
          status: 200,
          body: stream,
          getHeaders: () => ({ 'content-type': ['text/html; charset=utf-8'], ...headers }),
          text: async () => {
            textReads += 1;
            if (textError) throw new Error('Body read failed');
            return html;
          },
        };
      },
    },
    'create-response': { createResponse: (status, responseHeaders, body) => ({
      status, headers: responseHeaders, body,
    }) },
    './config.js': {
      default: { CUG_SOURCE: source },
      getSecrets: () => ({ JWT_SECRET: 'test-secret' }),
    },
    './session.js': {
      getSession: async () => session,
      createSession: () => '',
      sessionCookie: () => '',
      clearSessionCookie: () => '',
    },
    './oauth.js': {
      redirectToLogin: async () => ({ status: 302, headers: { Location: 'https://ims.example/login' }, body: '' }),
      handleCallback: () => { throw new Error('Unexpected OAuth callback'); },
    },
    './utils.js': {
      buildUrl: () => new URL(`https://site.example${path}`),
      sanitizeSearchParams: (pathname, search) => search,
      isRUMRequest: () => false,
      isMediaRequest: (pathname) => pathname.startsWith('/media_'),
    },
  };
  const main = new SourceTextModule(mainSource);
  await main.link((specifier) => {
    if (specifier === './cug.js') return cug;
    const exports = modules[specifier];
    if (!exports) throw new Error(`Unexpected dependency: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function initialize() {
      Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
    });
  });
  await main.evaluate();
  const response = await main.namespace.responseProvider({
    method, host: 'site.example', url: path, getHeader: () => [],
  });
  return { response, textReads, originMethod, stream };
}

test('header mode preserves streaming and strips all three control headers', async () => {
  const { response, textReads, stream } = await respond({
    headers: { 'x-aem-cug-login-path': ['/login'] },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, stream);
  assert.equal(textReads, 0);
  assert.equal(response.headers['x-aem-cug-login-path'], undefined);
  const { response: protectedResponse } = await respond({
    headers: { 'x-aem-cug-required': ['true'], 'x-aem-cug-groups': ['adobe.com'] },
  });
  assert.equal(protectedResponse.status, 302);
  assert.equal(protectedResponse.headers.Location, 'https://ims.example/login');
  assert.equal(protectedResponse.headers['x-aem-cug-required'], undefined);
  assert.equal(protectedResponse.headers['x-aem-cug-groups'], undefined);
});

test('metadata mode gates HTML before serving and preserves authorized HTML', async () => {
  const { response: anonymous } = await respond({ source: 'metadata' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.body, '');
  const { response: allowed, textReads } = await respond({
    source: 'metadata', session: { groups: ['adobe.com'] },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, protectedHtml);
  assert.deepEqual(allowed.headers['cache-control'], ['private, no-store']);
  assert.equal(textReads, 1);
  const { response: denied } = await respond({ source: 'metadata', session: { groups: ['other.com'] } });
  assert.equal(denied.status, 302);
  assert.equal(denied.headers.Location, 'https://site.example/403');
  assert.equal(denied.body, '');
});

test('metadata mode uses metadata rather than HTML response headers', async () => {
  const { response } = await respond({
    source: 'metadata',
    html: '<html><body>Public</body></html>',
    headers: { 'x-aem-cug-required': ['true'] },
  });
  assert.equal(response.status, 200);
});

test('buffered HTML drops stale encoding and length headers', async () => {
  const { response } = await respond({
    source: 'metadata',
    session: { groups: ['adobe.com'] },
    headers: { 'content-encoding': ['gzip'], 'content-length': ['42'] },
  });
  assert.equal(response.body, protectedHtml);
  assert.equal(response.headers['content-encoding'], undefined);
  assert.equal(response.headers['content-length'], undefined);
});

test('both sources honor a custom login path', async () => {
  const { response: metadata } = await respond({
    source: 'metadata', html: `${protectedHtml}<meta name="cug-login-path" content="/login">`,
  });
  assert.equal(metadata.headers.Location, '/login');
  const { response: headers } = await respond({
    headers: { 'x-aem-cug-required': ['true'], 'x-aem-cug-login-path': ['https://idp.example/login'] },
  });
  assert.equal(headers.headers.Location, 'https://idp.example/login');
});

test('metadata HEAD requests fetch HTML for enforcement but never return a body', async () => {
  const anonymous = await respond({ source: 'metadata', method: 'HEAD' });
  assert.equal(anonymous.originMethod, 'GET');
  assert.equal(anonymous.response.status, 302);
  const allowed = await respond({ source: 'metadata', method: 'HEAD', session: { groups: ['adobe.com'] } });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.response.body, '');
});

test('non-HTML responses retain header enforcement without reading the body', async () => {
  const { response, textReads } = await respond({
    source: 'metadata', headers: { 'content-type': ['application/json'], 'x-aem-cug-required': ['true'] },
  });
  assert.equal(response.status, 302);
  assert.equal(textReads, 0);
});

test('media bypass remains streaming in metadata mode', async () => {
  const { response, stream, textReads } = await respond({ source: 'metadata', path: '/media_image.png' });
  assert.equal(response.body, stream);
  assert.equal(textReads, 0);
});

test('body-read errors and invalid source configuration return errors, not content', async () => {
  const unreadable = await respond({ source: 'metadata', textError: true });
  assert.equal(unreadable.response.status, 500);
  assert.match(unreadable.response.body, /Body read failed/);
  const invalid = await respond({ source: 'invalid' });
  assert.equal(invalid.response.status, 500);
  assert.match(invalid.response.body, /Invalid CUG_SOURCE/);
});
