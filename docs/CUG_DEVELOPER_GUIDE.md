# CUG Developer Guide

This guide covers the client-side integration points for CUG: the sign-in/sign-out flow, the `/auth/*` endpoint contract, and the `user-group-teaser` block for group-based content personalization.

CUG relies on a CDN edge worker that sits between the browser and the AEM origin. The worker handles OAuth sign-in/sign-out via Adobe IMS, manages sessions with a signed JWT cookie, and enforces CUG access rules using headers set by the AEM Config Service. On the client side, header and block code calls the worker's `/auth/*` endpoints to determine the user's identity and group membership. This is an example implementation — adapt the patterns to fit your requirements.

**Related guides:**

- [CUG Author Guide](CUG_AUTHOR_GUIDE.md) — spreadsheet setup, access rules, publishing
- [Akamai CUG Worker Setup](CUG_AKAMAI_GUIDE.md) — CDN worker deployment, configuration, and secrets
- [Cloudflare CUG Worker Setup](CUG_CLOUDFLARE_GUIDE.md) — CDN worker deployment, KV setup, and secrets

---

## Sign-in Flow

The header block renders a "Sign in" link when the user has no active session. Clicking it starts an OAuth flow through the CDN worker and Adobe IMS.

1. On page load, the header calls `GET /auth/me`. If the response is not `200 OK`, the user is unauthenticated and a "Sign in" link is rendered pointing to `/auth/login?redirect=<current path>`.
2. The browser navigates to `/auth/login`. The worker reads the `redirect` query parameter, generates a PKCE challenge, and redirects to Adobe IMS for authentication.
3. The user authenticates at IMS. IMS redirects back to `/auth/callback` with an authorization code.
4. The worker exchanges the code for tokens, extracts the user's identity (email, groups) from the ID token, creates a signed JWT session cookie (`auth_token`), and redirects the browser to the original `redirect` URL.

Implementation: [`blocks/header/header.js`](../blocks/header/header.js) — the `decorateUserInfo` function.

> **Note:** OAuth configuration, token exchange details, and session cookie internals are covered in the CDN-specific guides: [Akamai](CUG_AKAMAI_GUIDE.md) | [Cloudflare](CUG_CLOUDFLARE_GUIDE.md).

---

## Sign-out Flow

1. The user clicks "Sign out" in the header dropdown, which navigates to `/auth/logout`.
2. The worker clears the `auth_token` cookie and redirects to Adobe IMS logout with the site's `client_id` and a `redirect_uri` back to the site root.
3. IMS ends the IdP session and redirects the browser to `/`.

After sign-out, `GET /auth/me` returns `401` again and the header renders the "Sign in" link.

---

## `/auth/*` Endpoint Reference

These endpoints are provided by the CDN edge worker. Client-side code interacts with `/auth/me` and links to the other paths.

| Endpoint | Method | Behavior |
|----------|--------|----------|
| `/auth/me` | GET | Returns the current session. **200** with `{ authenticated: true, email, name, groups }` if logged in; **401** with `{ authenticated: false }` if not. |
| `/auth/login` | GET | Accepts a `redirect` query parameter. Generates a PKCE challenge and redirects to Adobe IMS for authentication. After login, the user is sent back to the `redirect` URL (defaults to `/`). |
| `/auth/callback` | GET | OAuth callback from IMS. Exchanges the authorization code for tokens, creates the session cookie, and redirects to the original URL. Not called directly by client code. |
| `/auth/logout` | GET | Clears the session cookie and redirects to Adobe IMS logout. |

---

## User Group Teaser Block (Block-Level Authorization)

The `user-group-teaser` block shows personalized content based on group membership. It uses `/auth/me` to determine the user's groups and loads a group-specific teaser fragment.

### How it works

1. **Get user groups** — calls `GET /auth/me` and reads `groups` from the response.
2. **Match group to fragment** — looks up the user's groups against a `GROUP_FRAGMENTS` map that associates group names with fragment paths.
3. **Load teaser fragment** — loads the matched fragment via `loadFragment` and appends it to the block.

The group-to-fragment mapping is defined in the block's JavaScript:

```javascript
const GROUP_FRAGMENTS = {
  'adobe.com': '/members/adobe/teaser',
  'gmail.com': '/members/gmail/teaser',
};
```

Adapt this map to your site's groups and content structure.

### Behavior

| User state | Result |
|------------|--------|
| Not authenticated | Block shows fallback content for anonymous users |
| Authenticated, no groups | Block shows fallback content for anonymous users |
| Authenticated, no matching group in map | Block remains with heading only (no teaser loaded) |
| Authenticated, matching group found | Teaser fragment loaded and displayed |
| Fragment load fails | Block removed |

### Authoring

Authors place a `user-group-teaser` block in their page. The block content in the document is replaced at runtime — first with a heading, then with the group-specific teaser fragment if the user matches. The teaser content itself lives at per-group fragment paths (e.g., `/members/adobe/teaser`).

### Security

The block's client-side show/hide logic is a **UX concern, not a security boundary**. The teaser fragment URLs should be protected by CUG headers at the CDN edge. Even if the client-side logic were bypassed, the CDN worker would enforce authentication and group membership before serving the fragment content.

Implementation: [`blocks/user-group-teaser/user-group-teaser.js`](../blocks/user-group-teaser/user-group-teaser.js)

---

## CDN Worker Setup

CUG enforcement requires a CDN edge worker deployed between the browser and the AEM origin. The worker handles authentication, session management, and access control based on `x-aem-cug-required` and `x-aem-cug-groups` headers from the origin.

For deployment instructions, configuration, and secrets setup, see the CDN-specific guides:

- [Akamai CUG Worker Setup](CUG_AKAMAI_GUIDE.md)
- [Cloudflare CUG Worker Setup](CUG_CLOUDFLARE_GUIDE.md)
