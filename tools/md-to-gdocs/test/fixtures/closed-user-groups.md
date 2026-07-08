+-------------------------------+
| Metadata                      |
+----------+--------------------+
| Template | guides             |
+----------+--------------------+
| Category | launch             |
+----------+--------------------+
| Labs     | Closed User Groups |
+----------+--------------------+

+-------------------+
| Section Metadata  |
+---------+---------+
| style   | content |
+---------+---------+

# **Protecting Content with Closed User Groups (CUG)**

How to restrict access to pages on your Edge Delivery site so that only authenticated users — optionally belonging to specific groups — can view them.

## **Overview**

CUG lets you restrict access to pages on your site so that only authenticated users — optionally belonging to specific groups — can view them. You define the access rules in a spreadsheet, and when you publish it, the rules take effect at the CDN edge. The authoring step differs depending on whether your site runs on AEM Author or Document Authoring (DA), and the enforcement step differs depending on your CDN (Cloudflare or Akamai) — this guide covers both.

## **Quick Start**

Setting up CUG starts with creating a spreadsheet and defining access rules in it. Once defined, the rules need to be published so they become CUG headers that the CDN needs to enforce at the edge — see Publishing the Spreadsheet below.

### **1. Create the CUG spreadsheet**

Create a spreadsheet named `closed-user-groups` at your site root (the same level as your index page).

### **2. Add columns and rows**

The spreadsheet has four columns. When published, each row is translated into CUG headers:

+-------------------------------------------------------------------------------------------------------------+
| Table                                                                                                       |
+-------------------------------------------------------------------------------------------------------------+
| +------------------+--------------+----------------------------------------------+------------------------+ |
| | **Column**       | **Required** | **Description**                              | **CUG header**         | |
| +------------------+--------------+----------------------------------------------+------------------------+ |
| | `url`            | Yes          | Path pattern to protect (must start with /)  |                        | |
| +------------------+--------------+----------------------------------------------+------------------------+ |
| | `cug-required`   | No           | Whether login is required: `true` or `false` | `x-aem-cug-required`   | |
| +------------------+--------------+----------------------------------------------+------------------------+ |
| | `cug-groups`     | No           | Comma-separated list of allowed groups       | `x-aem-cug-groups`     | |
| +------------------+--------------+----------------------------------------------+------------------------+ |
| | `cug-login-path` | No           | Login page path (e.g. /login) or absolute    | `x-aem-cug-login-path` | |
| |                  |              | URL (e.g. https\://idp.example.com/login) to |                        | |
| |                  |              | redirect unauthenticated visitors to         |                        | |
| +------------------+--------------+----------------------------------------------+------------------------+ |
+-------------------------------------------------------------------------------------------------------------+

## **Wildcard Patterns**

Use wildcards in the `url` column to protect multiple pages at once:

+-----------------------------------------------------------------------------------+
| Table                                                                             |
+-----------------------------------------------------------------------------------+
| +---------------+----------------------------------------+----------------------+ |
| | **Pattern**   | **Matches**                            | **Does NOT match**   | |
| +---------------+----------------------------------------+----------------------+ |
| | `/members/*`  | `/members/page1`                       | `/members/sub/page2` | |
| +---------------+----------------------------------------+----------------------+ |
| | `/members/**` | `/members/page1`, `/members/sub/page2` | `/other/page`        | |
| +---------------+----------------------------------------+----------------------+ |
+-----------------------------------------------------------------------------------+

- `*` matches a single path segment
- `**` matches multiple path segments (the whole subtree)

## **Examples**

### **Protect a section — any logged-in user**

+-------------------------------------------------------+
| Table                                                 |
+-------------------------------------------------------+
| +---------------+------------------+----------------+ |
| | **url**       | **cug-required** | **cug-groups** | |
| +---------------+------------------+----------------+ |
| | `/members/**` | `true`           |                | |
| +---------------+------------------+----------------+ |
+-------------------------------------------------------+

Any authenticated user can access pages under `/members/`.

### **Protect a section — specific groups only**

+--------------------------------------------------------+
| Table                                                  |
+--------------------------------------------------------+
| +----------------+------------------+----------------+ |
| | **url**        | **cug-required** | **cug-groups** | |
| +----------------+------------------+----------------+ |
| | `/partners/**` | `true`           | gold,silver    | |
| +----------------+------------------+----------------+ |
+--------------------------------------------------------+

Only users in the gold or silver group can access pages under `/partners/`.

### **Protect a section with a custom login page**

+--------------------------------------------------------------------------------------------------+
| Table                                                                                            |
+--------------------------------------------------------------------------------------------------+
| +----------------+------------------+----------------+-----------------------------------------+ |
| | **url**        | **cug-required** | **cug-groups** | **cug-login-path**                      | |
| +----------------+------------------+----------------+-----------------------------------------+ |
| | `/partners/**` | `true`           | gold,silver    | https\://idp.partners.example.com/login | |
| +----------------+------------------+----------------+-----------------------------------------+ |
+--------------------------------------------------------------------------------------------------+

### **Mixed access levels**

+--------------------------------------------------------------+
| Table                                                        |
+--------------------------------------------------------------+
| +----------------------+------------------+----------------+ |
| | **url**              | **cug-required** | **cug-groups** | |
| +----------------------+------------------+----------------+ |
| | `/members/**`        | `true`           |                | |
| +----------------------+------------------+----------------+ |
| | `/members/gold/**`   | `true`           | gold           | |
| +----------------------+------------------+----------------+ |
| | `/members/silver/**` | `true`           | silver         | |
| +----------------------+------------------+----------------+ |
| | `/members/free/**`   | `false`          |                | |
| +----------------------+------------------+----------------+ |
| | `/internal/**`       | `true`           | employees      | |
| +----------------------+------------------+----------------+ |
+--------------------------------------------------------------+

+------------------------------------------------------------------------+
| Table                                                                  |
+------------------------------------------------------------------------+
| +-----------------------+--------------------------------------------+ |
| | **Visitor requests…** | **Result**                                 | |
| +-----------------------+--------------------------------------------+ |
| | `/members/page`       | Login required, any authenticated user     | |
| +-----------------------+--------------------------------------------+ |
| | `/members/gold/page`  | Login required, must be in gold group      | |
| +-----------------------+--------------------------------------------+ |
| | `/members/free/page`  | Public (auth explicitly disabled)          | |
| +-----------------------+--------------------------------------------+ |
| | `/internal/docs`      | Login required, must be in employees group | |
| +-----------------------+--------------------------------------------+ |
| | `/public/page`        | Public (no CUG rule applies)               | |
| +-----------------------+--------------------------------------------+ |
+------------------------------------------------------------------------+

## **Inheritance**

Child pages inherit the access rules of their parent path. For example:

- If `/members/**` requires authentication, then `/members/gold/page` also requires authentication.
- You can add group restrictions on a child path that inherits from a parent.

## **Important Rules**

- **Sheet must be at the site root.** Place `closed-user-groups` at the same level as your index page. Sheets at deeper paths are ignored.
- **Paths must start with /.** For example, `/partners/**` is valid; `partners/**` is not.
- **No duplicate paths.** If the same path appears more than once, only the first row is used.
- **Empty URLs are skipped.** Rows without a `url` value are ignored.
- **Publishing applies the rules.** Changes to the sheet only take effect after you publish it.
- **Unpublishing removes all protection.** See the Unpublishing the Sheet section below.

## **Publishing the Spreadsheet**

Publishing the `closed-user-groups` sheet translates each row into CUG headers and sends them to the Config Service. The CDN needs to enforce them on every request. How you publish depends on your authoring platform:

### **On AEM Author**

Publishing is a built-in, out-of-the-box capability (currently an early feature) — no custom tooling is required. Simply publish the `closed-user-groups` page as you would any other page.

### **On Document Authoring (DA)**

DA does not have a native equivalent to this publishing step. You'll need a custom DA app that:

- Reads the `closed-user-groups` sheet from your DA source (via `admin.da.live`).
- Transforms each row into the corresponding `x-aem-cug-required` / `x-aem-cug-groups` / `x-aem-cug-login-path` headers.
- Posts the resulting headers configuration to the Config Service (via `admin.hlx.page`).

Your app should also support unpublishing: removing just the CUG headers from the Config Service (leaving any other configured headers, e.g. CORS, untouched) so that every previously protected path becomes public again — mirroring the built-in unpublish behavior on AEM Author (see Unpublishing the Sheet below).

**Sample implementation:** [aemsites/summit-portal/tools/cug](https://github.com/aemsites/summit-portal/tree/main/tools/cug) — a working DA plugin that implements exactly this flow: it fetches `closed-user-groups.json`, builds the headers config, merges it with any existing non-CUG headers, and posts the result to the Config Service. Use it as a starting point for your own project.

*Note: Publishing the CUG sheet does not make it visible on Edge Delivery as a regular sheet. The sheet content (i.e.,* `closed-user-groups.json`*) is not accessible on preview or live — only the derived CUG headers are applied to the Config Service.*

## **Unpublishing the Sheet**

Unpublishing works out of the box on AEM Author. On Document Authoring (DA), unpublishing must be implemented as part of your custom DA app — see the sample implementation referenced under Publishing the Spreadsheet above, which also handles removing the CUG headers.

When you unpublish the `closed-user-groups` sheet:

- All CUG headers are removed from the Config Service for your site.
- Every previously protected page becomes publicly accessible.
- Non-CUG headers (e.g., CORS headers) are preserved — only the `x-aem-cug-required`, `x-aem-cug-groups`, and `x-aem-cug-login-path` headers are removed.

To re-enable protection, simply publish the sheet again.

⚠️**Warning:** Unpublishing affects the entire site at once. There is no way to selectively remove protection for individual paths by unpublishing — either all rules are active (sheet published) or none are (sheet unpublished). To remove protection for a specific path, delete or modify that row in the sheet and republish.

## **CDN Requirement**

CUG headers are set by AEM or DA in the Config Service, but enforcement happens at the CDN edge. Your CDN must have an edge worker (or equivalent) configured to:

- Read the `x-aem-cug-required` header — if true, verify the visitor is logged in.
- Read the `x-aem-cug-groups` header — if present, verify the visitor belongs to at least one of the listed groups.
- Read the `x-aem-cug-login-path` header — if present, redirect unauthenticated visitors to that path instead of a default login page.
- Redirect unauthenticated visitors to a login page, or return a 403/401 for unauthorized visitors.
- Strip the `x-aem-cug-*` headers before the response reaches the browser — they must never leak to the client.

The reference and sample implementations below cover Cloudflare and Akamai. If you're on a different CDN, adapt the same pattern to your platform's edge-worker equivalent.

### **Edge Enforcement on Cloudflare**

**Reference implementation:** [adobe-rnd/aem-cloudflare-worker-with-cug](https://github.com/adobe-rnd/aem-cloudflare-worker-with-cug) is a minimal starter template for Cloudflare Workers. It strips the `x-aem-cug-*` headers before they reach the browser, exposes a single `isAuthorized(request, env, allowedGroups)` extension point for plugging in your identity provider (it returns 401 by default until you implement it), and sets `Cache-Control: private, no-store` on authorized responses.

For a full working implementation, two sample workers are available:

- **Sample implementation:** [aemsites/summit-portal/workers/cloudflare/cug-adobe-oauth-worker](https://github.com/aemsites/summit-portal/tree/main/workers/cloudflare/cug-adobe-oauth-worker) — a complete Adobe IMS OAuth 2.0 + PKCE login flow, with a signed JWT session cookie and KV-backed PKCE state. Groups are derived from the visitor's email domain.
- **Sample implementation:** [aem-edge-cug/workers/cloudflare/frescopa-b2b-worker](https://github.com/aemsites/aem-edge-cug/tree/main/workers/cloudflare/frescopa-b2b-worker) — the same CUG header enforcement logic, but using a simple username/password login instead of Adobe IMS. Useful as a starting point if you're not using SSO.

### **Edge Enforcement on Akamai**

**Sample implementation:** [aem-edge-cug/workers/akamai/cug-akamai-worker](https://github.com/aemsites/aem-edge-cug/tree/main/workers/akamai/cug-akamai-worker) is a sample EdgeWorker implementing the same Adobe IMS OAuth 2.0 + PKCE flow as the Cloudflare sample above.

Note the key architectural difference from Cloudflare: an Akamai EdgeWorker's `httpRequest` can only reach hostnames served by the same Akamai property, so the IMS token exchange must be routed through a Property Manager rule rather than called directly. PKCE state is carried in a signed JWT state parameter instead of a key-value store.

## **Troubleshooting**

+----------------------------------------------------------------------------------------------------------------+
| Table                                                                                                          |
+----------------------------------------------------------------------------------------------------------------+
| +------------------------------------------------+-----------------------------------------------------------+ |
| | **Problem**                                    | **Solution**                                              | |
| +------------------------------------------------+-----------------------------------------------------------+ |
| | Protection not applied after editing the sheet | Make sure you published the `closed-user-groups` sheet    | |
| +------------------------------------------------+-----------------------------------------------------------+ |
| | Sheet is ignored / no effect                   | Verify the sheet is at the site root (same level as       | |
| |                                                | index)                                                    | |
| +------------------------------------------------+-----------------------------------------------------------+ |
| | Specific rows have no effect                   | Check that the `url` starts with / and is not a duplicate | |
| +------------------------------------------------+-----------------------------------------------------------+ |
| | All content became public                      | The sheet may have been unpublished — republish it        | |
| +------------------------------------------------+-----------------------------------------------------------+ |
| | Protected pages still accessible               | Verify your CDN edge worker is configured and reading the | |
| |                                                | `x-aem-cug-*` headers                                     | |
| +------------------------------------------------+-----------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------------------+
