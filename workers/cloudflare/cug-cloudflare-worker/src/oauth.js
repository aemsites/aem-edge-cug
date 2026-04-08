/**
 * OAuth 2.0 Authorization Code flow with PKCE (RFC 7636) against Adobe IMS.
 *
 * - redirectToLogin: starts the flow by redirecting to the IMS authorize endpoint
 * - handleCallback: completes the flow by exchanging the code for tokens
 *
 * User identity is extracted from the ID token JWT. The user's email domain
 * becomes their group for CUG access control (e.g., user@adobe.com → "adobe.com").
 */

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * PKCE: generate a random verifier and its SHA-256 challenge.
 * The verifier is stored server-side; only the challenge is sent to the IdP.
 */
async function generatePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

function generateState() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Redirects the user to the IMS authorize endpoint.
 * Stores the PKCE verifier and original URL in KV (TTL 5 min) keyed by state.
 */
export async function redirectToLogin(originalUrl, env) {
  const { verifier, challenge } = await generatePkce();
  const state = generateState();

  await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({ verifier, originalUrl }), {
    expirationTtl: 300,
  });

  const params = new URLSearchParams({
    client_id: env.OAUTH_CLIENT_ID,
    scope: env.OAUTH_SCOPE,
    response_type: 'code',
    redirect_uri: env.OAUTH_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  return Response.redirect(`${env.OAUTH_AUTHORIZE_URL}?${params}`, 302);
}

/**
 * Handles the /auth/callback redirect from IMS.
 * Exchanges the authorization code for tokens using the stored PKCE verifier,
 * then extracts the user's email from the ID token JWT and derives the group
 * from the email domain.
 *
 * Returns a Response on error, or { userInfo, originalUrl } on success.
 */
export async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`OAuth error: ${error} - ${url.searchParams.get('error_description') || ''}`, {
      status: 400,
    });
  }

  if (!code || !state) {
    // No OAuth params — likely a post-logout redirect from IMS. Send user home.
    return Response.redirect(new URL('/', url).href, 302);
  }

  const stored = await env.SESSIONS.get(`pkce:${state}`, 'json');
  if (!stored) {
    return new Response('Invalid or expired state', { status: 400 });
  }
  await env.SESSIONS.delete(`pkce:${state}`);

  const tokenResponse = await fetch(env.OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.OAUTH_CLIENT_ID,
      client_secret: env.OAUTH_CLIENT_SECRET,
      code,
      code_verifier: stored.verifier,
      redirect_uri: env.OAUTH_REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    // eslint-disable-next-line no-console
    console.error('Token exchange failed:', tokenResponse.status, await tokenResponse.text());
    return new Response('Authentication failed. Please try again.', { status: 502 });
  }

  // Prefer id_token (contains email claim); fall back to access_token
  const tokens = await tokenResponse.json();
  const claims = parseJwt(tokens.id_token || tokens.access_token);
  const email = (claims.email || claims.sub).toLowerCase();
  if (!email) {
    return new Response('Could not determine user email from token', { status: 502 });
  }
  const domain = email.split('@')[1] || '';

  return {
    userInfo: { email, name: claims.name || email, groups: [domain] },
    originalUrl: stored.originalUrl,
  };
}

/** Decode a JWT payload without signature verification (trusted IMS response). */
function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}
