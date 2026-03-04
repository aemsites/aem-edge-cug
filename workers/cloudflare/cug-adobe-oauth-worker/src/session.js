/**
 * Session management using Cloudflare KV.
 *
 * Sessions are stored as JSON under the key "session:<uuid>" with a TTL.
 * The session cookie is HttpOnly, Secure, SameSite=Lax.
 */

const SESSION_TTL = 3600; // 1 hour

/** Create a new session in KV and return the session ID. */
export async function createSession(env, userInfo) {
  const sessionId = crypto.randomUUID();

  await env.SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({
      email: userInfo.email,
      name: userInfo.name,
      groups: userInfo.groups,
      createdAt: Date.now(),
    }),
    { expirationTtl: SESSION_TTL },
  );

  return sessionId;
}

/** Read the session from KV using the cookie value. Returns null if missing or expired. */
export async function getSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^\s;]+)/);
  if (!match) return null;

  const sessionId = match[1];
  const data = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  return data;
}

/** Delete the session from KV. */
export async function destroySession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^\s;]+)/);
  if (match) {
    await env.SESSIONS.delete(`session:${match[1]}`);
  }
}

export function sessionCookie(sessionId) {
  return `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}
