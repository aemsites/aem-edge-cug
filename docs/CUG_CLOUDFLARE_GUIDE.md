# Cloudflare CUG Worker Setup

This setup enables Closed User Group (CUG) protection for AEM Edge Delivery sites served through Cloudflare. It deploys a Cloudflare Worker that sits between the browser and the AEM origin, authenticating users via Adobe IMS (OAuth 2.0 + PKCE) and enforcing per-path access control based on CUG headers published from AEM Author or Document Authoring (DA). Protected pages are never delivered to unauthenticated or unauthorized users — the worker intercepts the origin response at the edge and gates access before any content reaches the browser.

PKCE (Proof Key for Code Exchange) ensures that even if the authorization code is intercepted during the redirect, it cannot be exchanged for tokens without the original code verifier — which only the worker knows.

## Architecture

```
┌──────────┐     ┌─────────────────────────────────────┐     ┌──────────────┐
│          │     │         Cloudflare Edge              │     │              │
│  Browser │────>│  ┌───────────────────────────────┐   │     │  Adobe IMS   │
│          │<────│  │  Cloudflare Worker             │   │     │  (OAuth)     │
│          │     │  │  Auth + Proxy + CUG enforce    │──────────>│              │
│          │     │  │                                │   │     └──────────────┘
│          │     │  │  Sessions: signed JWT cookie   │   │
│          │     │  │  PKCE state: KV (5 min TTL)    │   │
│          │     │  └───────────────┬────────────────┘   │
│          │     │                  │ fetch               │
│          │     └──────────────────┼─────────────────────┘
└──────────┘                       │
                        ┌──────────▼───────┐
                        │  AEM Edge        │
                        │  Delivery        │
                        │  Origin          │
                        └──────────────────┘
```

Unlike the Akamai EdgeWorker, the Cloudflare Worker calls Adobe IMS directly via `fetch` — no Property Manager proxy is needed for the token exchange.

### Request Flow

1. Browser requests a page through Cloudflare. The worker intercepts the request.
2. Non-standard ports are redirected. `/drafts/*` paths return 404.
3. Auth paths (`/auth/callback`, `/auth/logout`, `/auth/portal`, `/auth/me`) are routed to dedicated handlers.
4. RUM and media requests are proxied directly to origin with no auth check.
5. For all other requests, the worker proxies to origin via `fetch` (rewriting the hostname to the AEM Edge Delivery origin).
6. If the origin response includes `x-aem-cug-required: true` and no valid session cookie exists, the worker redirects to Adobe IMS using OAuth Authorization Code + PKCE.
7. IMS authenticates the user and redirects back to `/auth/callback` with an authorization code.
8. The worker exchanges the code for tokens by calling the IMS token endpoint directly, extracts user identity from the ID token, creates a signed JWT session cookie (`auth_token`), and redirects to the original page.
9. On subsequent requests, the worker verifies the JWT cookie locally (HMAC-SHA256) and checks the user's email domain against `x-aem-cug-groups` from the origin response.

### Detailed Sequence

```
Browser                 Cloudflare Worker                    IMS                   Origin
  │                          │                                │                      │
  │── GET /members/page ────>│                                │                      │
  │                          │ (check auth_token cookie)      │                      │
  │                          │── fetch GET ───────────────────────────────────────────>│
  │                          │<── 200 + CUG headers ──────────────────────────────────│
  │                          │                                │                      │
  │                          │ x-aem-cug-required: true       │                      │
  │                          │ no valid session → redirect     │                      │
  │                          │ generate PKCE verifier           │                      │
  │                          │ store verifier + URL in KV       │                      │
  │                          │   (pkce:<state>, TTL 5 min)      │                      │
  │<── 302 /authorize ───────│                                │                      │
  │   ?code_challenge=...    │                                │                      │
  │   &state=<random>        │                                │                      │
  │                          │                                │                      │
  │── GET /authorize ─────────────────────────────────────────>│                      │
  │                          │                                │                      │
  │   (user logs in at IMS)  │                                │                      │
  │                          │                                │                      │
  │<── 302 /auth/callback ────────────────────────────────────│                      │
  │   ?code=abc&state=...    │                                │                      │
  │                          │                                │                      │
  │── GET /auth/callback ───>│                                │                      │
  │                          │ load pkce:<state> from KV       │                      │
  │                          │ delete KV entry                 │                      │
  │                          │── POST /ims/token/v3 ──────────>│                      │
  │                          │   code=abc                     │                      │
  │                          │   code_verifier=...            │                      │
  │                          │<── id_token + access_token ────│                      │
  │                          │                                │                      │
  │                          │ parse ID token → email, name    │                      │
  │                          │ derive group from email domain   │                      │
  │                          │ sign session JWT (HS256)         │                      │
  │<── 302 /members/page ────│                                │                      │
  │   Set-Cookie: auth_token │                                │                      │
  │                          │                                │                      │
  │── GET /members/page ────>│                                │                      │
  │                          │ verify auth_token JWT (HS256)   │                      │
  │                          │── fetch GET ───────────────────────────────────────────>│
  │                          │<── 200 + CUG headers ──────────────────────────────────│
  │                          │                                │                      │
  │                          │ x-aem-cug-required: true       │                      │
  │                          │ check x-aem-cug-groups          │                      │
  │                          │   against session.groups         │                      │
  │                          │ strip CUG headers               │                      │
  │<── 200 page content ─────│                                │                      │
  │   Cache-Control: private │                                │                      │
```

### User Journeys

#### Public page

1. Browser requests `/about`.
2. Worker proxies to origin.
3. Origin responds with HTML — no `x-aem-cug-required` header.
4. Worker strips any CUG headers (defensive) and serves the page as-is.
5. Header calls `/auth/me` → 401 → shows "Sign in" link.

#### Protected page, unauthenticated visitor

1. Browser requests `/members/adobe`.
2. Worker proxies to origin.
3. Origin responds with `x-aem-cug-required: true` and `x-aem-cug-groups: adobe.com`.
4. No valid session → worker calls `redirectToLogin()`:
   - Generates PKCE verifier + challenge.
   - Stores verifier + original URL (`/members/adobe`) in KV.
   - Redirects browser to IMS authorize endpoint with PKCE params.
5. User authenticates with Adobe IMS.
6. IMS redirects to `/auth/callback?code=...&state=...`.
7. Worker retrieves stored verifier from KV, exchanges code for tokens.
8. Worker extracts email from ID token, derives group from domain.
9. Worker creates a signed JWT session, sets `auth_token` cookie.
10. Worker redirects browser back to `/members/adobe`.
11. Browser requests `/members/adobe` (now with cookie).
12. Worker verifies session, proxies to origin, checks CUG groups — `adobe.com` matches.
13. Worker strips CUG headers, sets `Cache-Control: private, no-store`, serves the page.

#### Portal redirect

1. User clicks "Sign in" → browser requests `/auth/portal`.
2. Worker checks for session — none found → redirects to IMS login (same as steps 4–9 above, but original URL is `/auth/portal`).
3. After login, browser returns to `/auth/portal` with session cookie.
4. Worker verifies session, fetches `closed-user-groups-mapping.json` from origin.
5. User's group `adobe.com` matches the mapping entry for `/members/adobe`.
6. Worker redirects to `/members/adobe`.

#### Block-level personalization on a shared page

1. Authenticated `adobe.com` user visits the home page (`/`).
2. Worker proxies to origin — no CUG headers on `/`, page is served publicly.
3. Page loads and the `user-group-teaser` block initializes.
4. Block calls `GET /auth/me` → worker returns `{ groups: ["adobe.com"] }`.
5. Block resolves fragment path for the user's group (e.g. `/members/adobe/teaser`).
6. `loadFragment` fetches `/members/adobe/teaser` — this request goes through the worker.
7. Worker proxies to origin, origin responds with `x-aem-cug-required: true` and `x-aem-cug-groups: adobe.com`.
8. Worker verifies session, checks group — `adobe.com` matches — serves the fragment HTML.
9. Block renders the teaser. If the user is not signed in, the block removes itself.

---

## CDN Routes

```
Browser → Cloudflare Worker → AEM Edge Delivery origin
              │
              ├── /drafts/*        → 404 (blocked)
              ├── /auth/callback   → OAuth code exchange → JWT session → redirect
              ├── /auth/logout     → Clear cookie → IMS logout
              ├── /auth/portal     → Login redirect or portal mapping
              ├── /auth/me         → JSON user info
              ├── RUM / media      → Proxy to origin (no auth)
              └── Everything else  → Proxy to origin → CUG enforcement
```

## Worker Code

```
workers/cloudflare/cug-cloudflare-worker/
  src/
    index.js              Entry point: request routing, origin proxy, auth handlers
    oauth.js              PKCE generation, IMS redirect, callback handler
    session.js            JWT sign/verify, cookie helpers
    cug.js                CUG header enforcement logic
    portal.js             Portal mapping redirect
  test/                   Vitest test suite
  wrangler.toml           Configuration, KV bindings, environment overrides
  package.json            Scripts (dev, deploy, test)
  vitest.config.js        Test configuration
```

### Notes

- **KV for PKCE only:** The `SESSIONS` KV namespace stores PKCE state (`pkce:<state>` → `{ verifier, originalUrl }`) with a 5-minute TTL. It is not used for user sessions — sessions are stateless signed JWTs in the `auth_token` cookie.
- **Direct IMS calls:** Unlike the Akamai EdgeWorker, this worker calls the IMS token endpoint directly via `fetch`. No proxy routing is needed.
- **Portal mapping:** `/auth/portal` fetches `/closed-user-groups-mapping.json` from the origin and redirects authenticated users to the first matching group URL.
- **Session cookie security:** The `auth_token` cookie is set with `HttpOnly` (prevents JavaScript access, mitigating XSS), `Secure` (cookie only sent over HTTPS), and `SameSite=Lax` (CSRF protection while allowing top-level navigations). Sessions expire after 1 hour.

## Step 1: IMS OAuth Client Setup

Register an OAuth client via the [Adobe IMS Self-Service portal](https://imss.corp.adobe.com):

1. **Create in Stage** — create the client with:
   - **Client ID:** e.g. `aem-sites-cug`
   - **Redirect URI:** `https://<your-worker-domain>/auth/callback`
   - **Scopes:** `openid`, `AdobeID`, `email`, `profile`
2. **Copy Stage to Prod** — once the stage client is working, copy it to production
3. **Save the Client Secret** — you'll need it for Step 4

## Step 2: Cloudflare Setup

### Create a KV Namespace

The worker uses Cloudflare KV to store PKCE state during the OAuth flow. Create a namespace:

```bash
wrangler kv namespace create SESSIONS
```

This outputs a namespace ID. Copy it into `wrangler.toml` under `[[kv_namespaces]]`:

```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "<your-namespace-id>"
```

For additional environments, create separate namespaces:

```bash
wrangler kv namespace create SESSIONS --env summit
```

### Configure DNS / Routing (optional)

To serve the worker on a custom domain, uncomment and configure the `[routes]` section in `wrangler.toml`:

```toml
[routes]
pattern = "your-domain.com/*"
zone_name = "your-domain.com"
```

Alternatively, configure a custom domain in the Cloudflare dashboard under **Workers & Pages** > **your worker** > **Settings** > **Domains & Routes**.

## Step 3: Configure wrangler.toml

Edit `wrangler.toml` to match your site:

```toml
name = "cug-cloudflare-worker"
main = "src/index.js"
compatibility_date = "2024-12-01"

[vars]
ORIGIN_HOSTNAME = "main--your-site--your-org.aem.live"
OAUTH_AUTHORIZE_URL = "https://ims-na1.adobelogin.com/ims/authorize/v2"
OAUTH_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3"
OAUTH_LOGOUT_URL = "https://ims-na1.adobelogin.com/ims/logout/v1"
OAUTH_REDIRECT_URI = "https://<your-worker-domain>/auth/callback"
OAUTH_SCOPE = "openid,AdobeID,email,profile"
OAUTH_CLIENT_ID = "aem-sites-cug"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<your-namespace-id>"
```

| Variable | Description |
|----------|-------------|
| `ORIGIN_HOSTNAME` | AEM Edge Delivery hostname (e.g. `main--mysite--myorg.aem.live`) |
| `OAUTH_AUTHORIZE_URL` | Adobe IMS authorize endpoint |
| `OAUTH_TOKEN_URL` | Adobe IMS token endpoint |
| `OAUTH_LOGOUT_URL` | Adobe IMS logout endpoint |
| `OAUTH_REDIRECT_URI` | Must exactly match the redirect URI registered in IMS |
| `OAUTH_SCOPE` | OAuth scopes |
| `OAUTH_CLIENT_ID` | IMS client ID |

### Environment Overrides

Use `[env.<name>]` sections for multiple sites. Each environment needs its own variables and KV namespace:

```toml
[env.summit]
name = "summit-portal"

[env.summit.vars]
ORIGIN_HOSTNAME = "main--summit-portal--aemsites.aem.live"
OAUTH_REDIRECT_URI = "https://act.aem.now/auth/callback"
# ... other vars

[[env.summit.kv_namespaces]]
binding = "SESSIONS"
id = "<summit-namespace-id>"
```

## Step 4: Set Secrets

Secrets are stored in Cloudflare's encrypted secret store, not in `wrangler.toml`:

```bash
wrangler secret put OAUTH_CLIENT_SECRET
wrangler secret put JWT_SECRET
```

For additional environments:

```bash
wrangler secret put OAUTH_CLIENT_SECRET --env summit
wrangler secret put JWT_SECRET --env summit
```

Generate a JWT secret:

```bash
openssl rand -hex 32
```

### Optional Secrets

| Secret | Description |
|--------|-------------|
| `ORIGIN_AUTHENTICATION` | Site token for protected AEM origins. If set, the worker sends `Authorization: token <value>` on origin requests. |
| `PUSH_INVALIDATION` | Set to `disabled` to omit the `x-push-invalidation` header on origin requests. |

## Step 5: Deploy

```bash
cd workers/cloudflare/cug-cloudflare-worker

# Install dependencies
npm ci

# Run tests
npm test

# Deploy (default environment)
npm run deploy

# Deploy to a specific environment
npm run deploy -- --env summit
```

No build step is needed — `wrangler deploy` bundles from `src/index.js` directly.

### Local Development

```bash
npm run dev
```

This starts a local development server via `wrangler dev` with access to KV bindings and secrets.

## Step 6: Test

### Basic proxy

```bash
# Public page — should return 200
curl -sI "https://<your-worker-domain>/"

# Drafts — should return 404
curl -sI "https://<your-worker-domain>/drafts/test"
```

### Auth routes

```bash
# /auth/me without session — should return 401
curl -s "https://<your-worker-domain>/auth/me"
# → {"authenticated":false}
```

### CUG enforcement

1. Visit a CUG-protected page in a browser
2. Verify redirect to Adobe IMS login
3. After login, verify redirect back to the protected page with `auth_token` cookie
4. Verify `/auth/me` returns user info
5. Verify `/auth/logout` clears session and redirects to IMS logout

## CUG Header Configuration

CUG headers are set on the AEM Edge Delivery origin via the Config Service. The worker reads these headers from origin responses:

| Header | Purpose |
|--------|---------|
| `x-aem-cug-required: true` | Page requires authentication |
| `x-aem-cug-groups: adobe.com,partner.com` | Comma-separated allowed email domains |

Both headers are stripped before the response reaches the browser. Protected pages are served with `Cache-Control: private, no-store`.

## Adapting Group Derivation

This worker derives groups from the user's email domain (`user@adobe.com` → group `adobe.com`). This is a simple strategy that works well when email domain maps to organizational membership, but it is not the only option.

Depending on your identity provider, you can adapt the group derivation logic in `oauth.js` to use:

| Strategy | Source | Example |
|----------|--------|---------|
| Email domain (default) | `email` claim in ID token | `adobe.com` |
| IdP groups / roles | `groups` or `roles` claim in ID token | `engineering`, `marketing` |
| Custom claims | Any claim configured in your IdP | `tier:gold`, `region:emea` |
| External lookup | Membership API called during callback | Query a CRM or directory service |
| Multi-domain mapping | Map several email domains to one group | `adobe.com` + `behance.com` → `adobe` |

The only requirement is that the groups stored in the session JWT match the values in the `x-aem-cug-groups` header set by the Config Service.
