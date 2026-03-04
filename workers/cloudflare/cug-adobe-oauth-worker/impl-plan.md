# CUG OAuth Authentication — Cloudflare Worker Plan

## Architecture

```
┌──────────┐     ┌──────────────────────────────┐     ┌──────────────┐     ┌──────────────────┐
│          │     │     Cloudflare Worker         │     │              │     │                  │
│  Browser │────>│     (Auth + Proxy)            │────>│  Identity    │     │  AEM Edge        │
│          │<────│                               │<────│  Provider    │     │  Delivery        │
│          │     │  ┌────────────────────────┐   │     │  (OAuth)     │     │  Origin          │
│          │     │  │  Cloudflare KV         │   │     │              │     │                  │
│          │     │  │  (Sessions + PKCE)     │   │     └──────────────┘     └──────────────────┘
│          │     │  └────────────────────────┘   │                                  ▲
│          │     │                               │──────────────────────────────────┘
│          │     └──────────────────────────────┘
└──────────┘
```

### Request Flow

1. Browser requests a page through the Cloudflare Worker.
2. Worker checks if the path requires authentication (via CUG headers or static config).
3. If unauthenticated: redirect to IdP using OAuth Authorization Code + PKCE.
4. IdP authenticates the user and redirects back with an authorization code.
5. Worker exchanges the code for tokens, creates a session in KV.
6. Worker sets a session cookie and redirects to the original page.
7. On subsequent requests, Worker validates the session cookie and proxies to origin.
8. If CUG group restrictions apply, Worker checks user groups against the `x-aem-cug-groups` header from the origin response.

### Detailed Sequence

```
Browser                 Cloudflare Worker              IdP                     Origin
  │                          │                          │                        │
  │── GET /members/page ────>│                          │                        │
  │                          │ (no session cookie)      │                        │
  │                          │── GET /members/page ─────────────────────────────>│
  │                          │<── 200 + CUG headers ──────────────────-──────────│
  │                          │                          │                        │
  │                          │ x-aem-cug-required: true │                        │
  │                          │ no session → redirect    │                        │
  │                          │ generate PKCE verifier   │                        │
  │                          │ store verifier in KV     │                        │
  │<── 302 /authorize ───────│                          │                        │
  │                          │                          │                        │
  │── GET /authorize ──────────────────────────────────>│                        │
  │   ?code_challenge=...    │                          │                        │
  │   &state=...             │                          │                        │
  │                          │                          │                        │
  │   (user logs in)         │                          │                        │
  │                          │                          │                        │
  │<── 302 /auth/callback ──────────────────────────────│                        │
  │   ?code=abc&state=...    │                          │                        │
  │                          │                          │                        │
  │── GET /auth/callback ───>│                          │                        │
  │                          │── POST /token ──────────>│                        │
  │                          │   code=abc               │                        │
  │                          │   code_verifier=...      │                        │
  │                          │<── access_token ─────────│                        │
  │                          │                          │                        │
  │                          │ create session in KV     │                        │
  │<── 302 /members/page ────│                          │                        │
  │   Set-Cookie: session=.. │                          │                        │
  │                          │                          │                        │
  │── GET /members/page ────>│                          │                        │
  │                          │ (valid session)          │                        │
  │                          │── GET /members/page ─────────────────────────────>│
  │                          │<── 200 + CUG headers (CF cache hit*) ─────────────│
  │                          │                          │                        │
  │                          │ x-aem-cug-required: true │                        │
  │                          │ check x-aem-cug-groups   │                        │
  │                          │ against session.groups   │                        │
  │                          │                          │                        │
  │<── 200 page content ─────│                          │                        │

  * cf: { cacheEverything: true } — Cloudflare caches origin responses
    (HTML + CUG headers) at the edge. The first unauthenticated request
    populates the cache; subsequent requests are served from cache.
    The auth decision is still made per-request based on the session.
```

## Main Components

### 1. Request Router — `src/index.js`

Entry point for the Cloudflare Worker. Routes every incoming request to the correct handler.

| Route | Handler | Purpose |
|-------|---------|---------|
| `/auth/callback` | `handleCallback()` | Process IdP redirect, exchange code for tokens |
| `/auth/logout` | `handleLogout()` | Destroy session, clear cookie |
| Protected paths | Auth check + proxy | Validate session, enforce CUG, proxy to origin |
| Public paths | Direct proxy | Pass through to origin with no auth check |

### 2. OAuth Module — `src/oauth.js`

Handles the OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).

| Function | Responsibility |
|----------|----------------|
| `redirectToLogin(originalUrl, env)` | Generate PKCE verifier + challenge, store verifier in KV keyed by `state`, redirect to IdP `/authorize` endpoint |
| `handleCallback(request, env)` | Read `code` and `state` from callback URL, retrieve verifier from KV, POST to IdP `/token` endpoint with `code_verifier`, parse response tokens |
| `parseJwt(token)` | Base64url-decode the JWT payload to extract user claims (email, name, groups) |
| `base64url(bytes)` | Encode a `Uint8Array` to a URL-safe base64 string (no padding) |

PKCE parameters:

- **Verifier**: 64 random bytes, base64url-encoded.
- **Challenge**: SHA-256 hash of the verifier, base64url-encoded.
- **Challenge method**: `S256` (always).
- **Storage**: KV key `pkce:<state>`, TTL 5 minutes.

### 3. Session Manager — `src/session.js`

Manages session lifecycle using Cloudflare KV.

| Function | Responsibility |
|----------|----------------|
| `createSession(env, userInfo)` | Generate a UUID session ID, store `{email, name, groups, exp}` in KV with TTL, return the session ID |
| `getSession(request, env)` | Parse `session` cookie, look up session data in KV, return `null` if missing or expired |
| `destroySession(request, env)` | Delete session entry from KV, return `Set-Cookie` header that clears the cookie |

Session cookie attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.

Default session TTL: 1 hour (configurable).

### 4. CUG Enforcer — `src/cug.js`

Reads CUG headers from the origin response and enforces access control. This integrates with the `cug-config` spreadsheet published from AEM Author.

| Function | Responsibility |
|----------|----------------|
| `checkCugAccess(originResponse, session, env)` | Read `x-aem-cug-required` and `x-aem-cug-groups` from origin response headers. If `cug-required` is `true` and no valid session exists, redirect to login. If groups are specified, check that the user belongs to at least one allowed group (OR logic). Return the origin response if access is granted, or a 403 response if denied. |

Header reference:

| Header | Values | Meaning |
|--------|--------|---------|
| `x-aem-cug-required` | `true` / `false` | Whether authentication is required for this path |
| `x-aem-cug-groups` | `group1,group2` | Comma-separated groups; user must belong to at least one |

### 5. Configuration — `wrangler.toml` + Secrets

#### Secrets (set via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `OAUTH_CLIENT_ID` | OAuth application client ID from IdP |
| `OAUTH_CLIENT_SECRET` | OAuth application client secret from IdP |
| `SESSION_SECRET` | Key for signing session cookies (if signing is added) |

#### Environment Variables (in `wrangler.toml`)

| Variable | Description | Example |
|----------|-------------|---------|
| `OAUTH_AUTHORIZE_URL` | IdP authorization endpoint | `https://idp.example.com/oauth2/authorize` |
| `OAUTH_TOKEN_URL` | IdP token endpoint | `https://idp.example.com/oauth2/token` |
| `OAUTH_REDIRECT_URI` | Callback URL registered with IdP | `https://site.example.com/auth/callback` |
| `OAUTH_SCOPE` | OAuth scopes to request | `openid profile email` |

#### KV Namespace

| Binding | Purpose |
|---------|---------|
| `SESSIONS` | Stores session data and PKCE verifiers |

Create with: `wrangler kv:namespace create "SESSIONS"`

## Implementation Steps

1. Register an OAuth application in the Identity Provider (client ID, secret, redirect URI).
2. Create a Cloudflare Worker project (`wrangler init`).
3. Create a KV namespace for sessions (`wrangler kv:namespace create "SESSIONS"`).
4. Configure `wrangler.toml` with environment variables and the KV binding.
5. Set secrets with `wrangler secret put` for `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and `SESSION_SECRET`.
6. Implement the request router in `src/index.js`.
7. Implement the OAuth module in `src/oauth.js` (PKCE generation, token exchange, JWT parsing).
8. Implement the session manager in `src/session.js` (create, get, destroy).
9. Implement the CUG enforcer in `src/cug.js` (read origin CUG headers, check groups).
10. Add the logout handler (destroy session, clear cookie, redirect to `/`).
11. Deploy with `wrangler deploy`.
12. Configure DNS so the domain is proxied through Cloudflare.
13. Publish the `cug-config` sheet from AEM Author to activate CUG protection on desired paths.
