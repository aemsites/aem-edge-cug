# Akamai CUG EdgeWorker

AEM Edge Delivery proxy with OAuth 2.0 + PKCE authentication and Closed User Group (CUG) access control, delivered via Akamai EdgeWorkers.

Reference: [AEM BYO CDN Akamai Setup](https://www.aem.live/docs/byo-cdn-akamai-setup)

## Architecture

```
Browser → Akamai Edge (EdgeWorker) → AEM Edge Delivery origin
                │
                ├── /drafts/*        → 404 (blocked)
                ├── /auth/callback   → OAuth code exchange → JWT session → redirect
                ├── /auth/logout     → Clear cookie → IMS logout
                ├── /auth/me         → JSON user info
                ├── RUM / media      → Proxy to origin (no auth)
                └── Everything else  → Proxy to origin → CUG enforcement
```

The EdgeWorker uses `responseProvider` to handle origin proxying and CUG enforcement. This gives full control over what content reaches the browser — protected pages are never sent to unauthenticated users.

## File Structure

```
workers/akamai/cug-akamai-worker/
  bundle.json           EdgeWorker metadata
  main.js               Entry point: onClientRequest + responseProvider
  config.js             OAuth/origin configuration
  secrets.example.js    Template for secrets (copy to secrets.js)
  secrets.js            Actual secrets — gitignored, never committed
  oauth.js              PKCE generation, IMS redirect, callback handler
  session.js            JWT sign/verify, cookie helpers
  cug.js                CUG header enforcement logic
  utils.js              URL parsing, media/RUM detection, query sanitization
  SETUP.md              This file
```

## Step 1: IMS OAuth Client Setup

Register an OAuth client via the [Adobe IMS Self-Service portal](https://imss.corp.adobe.com):

1. **Create in Stage** — go to [imss.corp.adobe.com/#/client/stage/aem-sites-akamai-cug](https://imss.corp.adobe.com/#/client/stage/aem-sites-akamai-cug) and create the client with:
   - **Client ID:** `aem-sites-akamai-cug`
   - **Redirect URI:** `https://aem-edge-cug-akamai.adobe.com/auth/callback`
   - **Scopes:** `openid`, `AdobeID`, `email`, `profile`
2. **Copy Stage to Prod** — once the stage client is working, copy it to production at [imss.corp.adobe.com/#/client/prod/aem-sites-akamai-cug](https://imss.corp.adobe.com/#/client/prod/aem-sites-akamai-cug)
3. **Save the Client Secret** — copy it into `secrets.js` (see Step 4)

## Step 2: Property Manager Configuration

Follow the [official guide](https://www.aem.live/docs/byo-cdn-akamai-setup) to configure the Akamai property. The key behaviors are:

| Behavior | Setting |
|----------|---------|
| Origin Server Hostname | `main--aem-edge-cug-akamai--aemsites.aem.live` |
| Forward Host Header | Origin Hostname |
| Remove Vary Header | On |
| Outgoing Request: `X-Forwarded-Host` | `{{builtin.AK_HOST}}` |
| Outgoing Request: `X-BYO-CDN-Type` | `akamai` |
| Outgoing Request: `X-Push-Invalidation` | `enabled` |
| Caching | Honor origin Cache-Control |
| Strip `X-Robots-Tag` | On non-`*.plain.html` paths |
| EdgeWorkers | On, select the EdgeWorker ID |

> **Note:** Since `responseProvider` handles origin proxying, the Property Manager origin/header behaviors are bypassed for EdgeWorker requests. They remain configured as a fallback if `responseProvider` fails.

### IMS Token Exchange Rule

EdgeWorker `httpRequest` can only reach hostnames served by the same Akamai property — it cannot call external APIs directly. The OAuth token exchange must be proxied through PM. Sub-requests from `httpRequest` go through Property Manager but do not trigger EdgeWorker events, so there is no recursion.

Add a child rule under the Default Rule (Blank Rule Template):

1. **Criteria:** Path matches `/ims/token/v3`
2. **Origin Server:** `ims-na1.adobelogin.com` (HTTPS, port 443, Forward Host Header = Origin Hostname)
3. **Caching:** No Store

## Step 3: Create EdgeWorker ID

1. In [Akamai Control Center](https://control.akamai.com), go to **CDN** > **EdgeWorkers**
2. Click **Create EdgeWorker ID**
3. Give it a name (e.g., `AEM Edge CUG`)
4. Select the **"AEM Edge Delivery CUG"** group
5. Select resource tier **200 - Dynamic Compute** (required for `httpRequest` sub-requests and `crypto.subtle`)
6. Note the EdgeWorker ID (e.g., `106762`) — you'll need it for deployment in Step 6

## Step 4: Configure Secrets

Copy the template and fill in your actual values:

```bash
cd workers/akamai/cug-akamai-worker
cp secrets.example.js secrets.js
```

Edit `secrets.js`:

```js
const secrets = {
  OAUTH_CLIENT_SECRET: '<your-ims-client-secret>',
  JWT_SECRET: '<random-64-char-hex-string>',
  ORIGIN_AUTHENTICATION: '<your-site-token>',  // optional
};
```

Generate a JWT secret:

```bash
openssl rand -hex 32
```

> **Important:** `secrets.js` is gitignored and must never be committed. Only `secrets.example.js` (with placeholder values) is checked in.

## Step 5: Configuration

Edit `config.js` to match your site:

```js
const config = {
  ORIGIN_HOSTNAME: 'main--aem-edge-cug-akamai--aemsites.aem.live',
  OAUTH_REDIRECT_URI: 'https://aem-edge-cug-akamai.adobe.com/auth/callback',
  OAUTH_CLIENT_ID: 'aem-sites-cug',
  // ... other settings
};
```

## Step 6: Build and Deploy

```bash
cd workers/akamai/cug-akamai-worker

# Build the bundle (include all JS files)
tar -czvf bundle.tgz \
  bundle.json main.js config.js secrets.js oauth.js session.js cug.js utils.js

# Upload
akamai edgeworkers upload --bundle bundle.tgz <edgeworker-id>

# Activate on staging
akamai edgeworkers activate <edgeworker-id> STAGING 1.0

# After testing, activate on production
akamai edgeworkers activate <edgeworker-id> PRODUCTION 1.0
```

## Step 7: Test

### Basic proxy

```bash
# Public page — should return 200
curl -sI "https://aem-edge-cug-akamai.adobe.com/"

# Drafts — should return 404
curl -sI "https://aem-edge-cug-akamai.adobe.com/drafts/test"
```

### Auth routes

```bash
# /auth/me without session — should return 401
curl -s "https://aem-edge-cug-akamai.adobe.com/auth/me"
# → {"authenticated":false}
```

### CUG enforcement

1. Visit a CUG-protected page in a browser
2. Verify redirect to Adobe IMS login
3. After login, verify redirect back to the protected page with `auth_token` cookie
4. Verify `/auth/me` returns user info
5. Verify `/auth/logout` clears session and redirects to IMS logout

### Cache purge

```bash
akamai purge invalidate "https://aem-edge-cug-akamai.adobe.com/some-page"
```

## CUG Header Configuration

CUG headers are set on the AEM Edge Delivery origin via the Config Service. The EdgeWorker reads these headers from origin responses:

| Header | Purpose |
|--------|---------|
| `x-aem-cug-required: true` | Page requires authentication |
| `x-aem-cug-groups: adobe.com,partner.com` | Comma-separated allowed email domains |

Both headers are stripped before the response reaches the browser. Protected pages are served with `Cache-Control: private, no-store`.

## Notes

- **Stateless PKCE:** The PKCE verifier is encoded in the OAuth state parameter as a signed JWT, avoiding the need for server-side storage. The JWT expires after 5 minutes.
- **Secret rotation:** Secrets are bundled in `secrets.js` and deployed with the EdgeWorker. To rotate secrets, update the file and deploy a new version.
- **Fallback behavior:** If `responseProvider` throws an unhandled error, Akamai forwards the request to the origin via Property Manager as a safety net.

### Why not EdgeKV?

This EdgeWorker uses bundled secrets and JWT-encoded PKCE state instead of [Akamai EdgeKV](https://techdocs.akamai.com/edgekv/docs/welcome-to-edgekv). EdgeKV is Akamai's edge key-value store and would be the natural choice for storing secrets and PKCE state at the edge. However, configuring EdgeKV access requires an Akamai role with EdgeKV READ-WRITE permissions assigned to the correct group, and creating or modifying roles requires account-level admin access that may not be available to all teams.

The bundled approach trades dynamic secret management for simpler deployment:

| Concern | EdgeKV approach | Bundled approach (current) |
|---------|----------------|---------------------------|
| Secret storage | EdgeKV namespace | `secrets.js` in bundle |
| PKCE state | EdgeKV with TTL | Signed JWT in OAuth state param |
| Secret rotation | `akamai edgekv write` | Edit `secrets.js`, redeploy bundle |
| Setup prerequisites | EdgeKV namespace, access token, role permissions | None beyond EdgeWorker ID |
| Admin access needed | Yes (EdgeKV role + group) | No |

To migrate to EdgeKV later (e.g., once role permissions are available), replace `secrets.js` with EdgeKV reads in `config.js` and store PKCE state in an EdgeKV namespace instead of the JWT state parameter.
