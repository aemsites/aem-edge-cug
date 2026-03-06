# CUG Worker Demo Guide

Walkthrough of the main use cases for the Cloudflare CUG worker with Adobe IMS authentication.

## URLs

| Environment | URL |
|-------------|-----|
| AEM Author | https://author-p130360-e1560298.adobeaemcloud.com/ui#/aem/sites.html/content/cloudfare1 |
| Closed User Groups | https://author-p130360-e1560298.adobeaemcloud.com/content/cloudfare1/closed-user-groups.html |
| Group Mapping | https://author-p130360-e1560298.adobeaemcloud.com/content/cloudfare1/closed-user-groups-mapping.html |
| Edge Delivery | https://main--cloudfare1--jckautzmann.aem.live/members |
| Cloudflare CDN | https://aem-cug-cloudfare-jck1.com/members |
| Log out | https://aem-cug-cloudfare-jck1.com/auth/logout |

---

## Prerequisites

- An Adobe IMS account (e.g., `alice@adobe.com`)
- The `closed-user-groups` spreadsheet is published with CUG rules
- The `closed-user-groups-mapping` spreadsheet is published with group-to-page mappings

---

## 1. Public page — no authentication required

**Goal:** Pages without CUG rules are accessible to everyone.

1. Open `https://aem-cug-cloudfare-jck1.com/` (home page)
2. The page loads immediately — no sign-in prompt
3. Open DevTools > Network — no redirects to Adobe IMS

**What happens:** The origin response has no `x-aem-cug-required` header, so the worker serves the page as-is.

---

## 2. Protected page — unauthenticated visitor

**Goal:** Visiting a CUG-protected page without signing in redirects to Adobe IMS.

1. Open a private/incognito window
2. Navigate to `https://aem-cug-cloudfare-jck1.com/members/adobe`
3. You are redirected to the Adobe IMS sign-in page
4. The URL bar shows `ims-na1.adobelogin.com/ims/authorize/v2?...`

**What happens:** The origin returns `x-aem-cug-required: true`. The worker sees no `auth_token` cookie and redirects to IMS.

---

## 3. Protected page — sign in and access

**Goal:** After signing in, the protected page is served.

1. Continue from the previous step — sign in with your Adobe account
2. After sign-in, you are redirected back to `https://aem-cug-cloudfare-jck1.com/members/adobe`
3. The page content is now visible
4. Open DevTools > Application > Cookies — you can see an `auth_token` cookie (this is the signed JWT)

**What happens:** IMS redirects to `/auth/callback` with an authorization code. The worker exchanges it for tokens, creates a signed JWT with the user's email and group, sets the `auth_token` cookie, and redirects to the originally requested page.

---

## 4. Protected page — unauthorized group

**Goal:** A signed-in user who is not in the required group is denied access.

1. Sign in with an account whose email domain is NOT in the allowed CUG groups (e.g., `user@gmail.com` trying to access a page restricted to `adobe.com`)
2. Navigate to the restricted page
3. You are redirected to `/403`

**What happens:** The origin returns `x-aem-cug-groups: adobe.com`. The worker checks the user's group (derived from email domain) and finds no match, so it redirects to `/403`.

---

## 5. Portal redirect — "Access Your Portal"

**Goal:** A single link routes each user to the right members page based on their group.

### 5a. Not signed in

1. Open a private/incognito window
2. Click the "Access Your Portal" link (or navigate to `https://aem-cug-cloudfare-jck1.com/auth/portal`)
3. You are redirected to the Adobe IMS sign-in page
4. Sign in with `alice@adobe.com`
5. After sign-in, you land on `https://aem-cug-cloudfare-jck1.com/members/adobe`

### 5b. Already signed in

1. With an active session (the `auth_token` cookie exists), navigate to `/auth/portal`
2. You are immediately redirected to the page for your group (e.g., `/members/adobe` for `adobe.com` users)

**What happens:** The worker fetches `/closed-user-groups-mapping.json` from the origin, which contains:

```json
{ "data": [
  { "group": "adobe.com", "url": "/members/adobe" },
  { "group": "gmail.com", "url": "/members/google" }
]}
```

It matches the user's group against the mapping and redirects to the corresponding URL. If no match is found, it falls back to `/members`.

---

## 6. Logout

**Goal:** Sign out and terminate the session.

1. Navigate to `https://aem-cug-cloudfare-jck1.com/auth/logout`
2. You are redirected to Adobe IMS logout, then back to the home page
3. The `auth_token` cookie is cleared
4. Navigate to a protected page — you are prompted to sign in again

**What happens:** The worker clears the `auth_token` cookie and redirects to `ims-na1.adobelogin.com/ims/logout/v1`, which terminates the Adobe IMS session. Without both the local JWT and the IMS session, the user must sign in again to access protected content.

**Important:** Simply deleting the `auth_token` cookie in DevTools is NOT sufficient to log out. The Adobe IMS session remains active, so the next visit to a protected page triggers a silent re-authentication (IMS auto-signs you in). Always use `/auth/logout` to fully sign out.

---

## Summary of routes

| Route | Purpose |
|-------|---------|
| `/auth/portal` | Authenticate (if needed) then redirect to the user's group page |
| `/auth/callback` | OAuth callback (internal, not user-facing) |
| `/auth/logout` | Clear session cookie and sign out of Adobe IMS |
| `/403` | Shown when the user's group does not match the required CUG groups |
| Everything else | Proxied to the AEM origin; CUG headers enforced if present |
