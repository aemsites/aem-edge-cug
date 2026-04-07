/**
 * OAuth 2.0 Authorization Code flow with PKCE (RFC 7636) against Adobe IMS.
 *
 * - redirectToLogin: starts the flow by redirecting to the IMS authorize endpoint
 * - handleCallback: completes the flow by exchanging the code for tokens
 *
 * User identity is extracted from the ID token JWT. The user's email domain
 * becomes their group for CUG access control (e.g., user@adobe.com -> "adobe.com").
 *
 * PKCE state is carried in the OAuth state parameter as a signed JWT containing
 * the verifier and original URL. No server-side storage needed.
 */

import { crypto } from 'crypto';
import { atob, btoa, TextEncoder } from 'encoding';
import { httpRequest } from 'http-request';
import URLSearchParams from 'url-search-params';
import config from './config.js';
import { signJwt, verifyJwt } from './session.js';

const PKCE_TTL = 300; // 5 minutes in seconds

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generatePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

/**
 * Build a redirect-to-IMS-login response.
 * The PKCE verifier and original URL are encoded in the state parameter
 * as a signed JWT, eliminating the need for server-side storage.
 * @returns {{ status: number, headers: object, body: string }}
 */
export async function redirectToLogin(originalUrl, jwtSecret) {
  const { verifier, challenge } = await generatePkce();
  const now = Math.floor(Date.now() / 1000);

  const state = await signJwt({
    verifier,
    originalUrl,
    iat: now,
    exp: now + PKCE_TTL,
  }, jwtSecret);

  const params = new URLSearchParams({
    client_id: config.OAUTH_CLIENT_ID,
    scope: config.OAUTH_SCOPE,
    response_type: 'code',
    redirect_uri: config.OAUTH_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    status: 302,
    headers: { Location: `${config.OAUTH_AUTHORIZE_URL}?${params}` },
    body: '',
  };
}

/**
 * Handle the /auth/callback redirect from IMS.
 * On error returns { error: true, status, headers?, body }.
 * On success returns { error: false, userInfo, originalUrl }.
 */
export async function handleCallback(url, secrets) {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const desc = url.searchParams.get('error_description') || '';
    return { error: true, status: 400, body: `OAuth error: ${error} - ${desc}` };
  }

  if (!code || !stateParam) {
    return { error: true, status: 302, headers: { Location: `${url.origin}/` }, body: '' };
  }

  const stored = await verifyJwt(stateParam, secrets.JWT_SECRET);
  if (!stored || !stored.verifier) {
    return { error: true, status: 400, body: 'Invalid or expired state' };
  }

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.OAUTH_CLIENT_ID,
    client_secret: secrets.OAUTH_CLIENT_SECRET,
    code,
    code_verifier: stored.verifier,
    redirect_uri: config.OAUTH_REDIRECT_URI,
  }).toString();

  const tokenResp = await httpRequest(config.OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });

  if (tokenResp.status !== 200) {
    const errBody = await tokenResp.text();
    return { error: true, status: 502, body: `Authentication failed (IMS ${tokenResp.status}): ${errBody}` };
  }

  const tokens = await tokenResp.json();
  const claims = parseJwt(tokens.id_token || tokens.access_token);
  const email = (claims.email || claims.sub || '').toLowerCase();
  if (!email) {
    return { error: true, status: 502, body: 'Could not determine user email from token' };
  }
  const domain = email.split('@')[1] || '';

  return {
    error: false,
    userInfo: { email, name: claims.name || email, groups: [domain] },
    originalUrl: stored.originalUrl,
  };
}

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
