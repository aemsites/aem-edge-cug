/**
 * JWT-based session management.
 *
 * The session is a signed JWT stored in the `auth_token` cookie.
 * No server-side state — verification is done locally via HMAC-SHA256.
 */

import { crypto } from 'crypto';
import { atob, btoa, TextEncoder, TextDecoder } from 'encoding';

const SESSION_TTL = 3600; // 1 hour
const COOKIE_NAME = 'auth_token';

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

async function getSigningKey(secret) {
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signJwt(payload, secret) {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return `${header}.${body}.${base64url(sig)}`;
}

export async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const data = new TextEncoder().encode(`${header}.${body}`);
  const key = await getSigningKey(secret);
  const sigBytes = base64urlDecode(sig);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
  if (!valid) return null;

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

export async function createSession(jwtSecret, userInfo) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    email: userInfo.email,
    name: userInfo.name,
    groups: userInfo.groups,
    iat: now,
    exp: now + SESSION_TTL,
  }, jwtSecret);
}

/**
 * Verify the JWT from the Cookie header string.
 * @param {string} cookieHeader - raw Cookie header value
 * @param {string} jwtSecret - HMAC signing secret
 * @returns {Promise<object|null>} decoded payload or null
 */
export async function getSession(cookieHeader, jwtSecret) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^\\s;]+)`));
  if (!match) return null;
  return verifyJwt(match[1], jwtSecret);
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
