# CUG Author Guide

Closed User Groups (CUG) let you restrict pages on your Edge Delivery site to authenticated users or specific groups — controlled entirely from a spreadsheet. You define which paths to protect and which groups are allowed using a `closed-user-groups` sheet at your site root. When you publish the sheet, each row is translated into CUG headers (`x-aem-cug-required` and `x-aem-cug-groups`) and pushed to the AEM Config Service. Your CDN edge worker then reads these headers on every request and enforces them — redirecting unauthenticated visitors to a login page or returning a 403 for unauthorized users. Wildcard patterns (`*` and `**`) let you protect entire subtrees with a single rule, and unpublishing the sheet removes all protection at once.

This guide walks you through creating the spreadsheet, defining access rules with path patterns and group restrictions, publishing and unpublishing, and troubleshooting common issues.

---

## Quick Start

### 1. Create the CUG spreadsheet

Create a spreadsheet named **`closed-user-groups`** at your site root (the same level as the root index page).

Example location: `/content/mysite/closed-user-groups`

### 2. Add columns and rows

The spreadsheet has three columns:

| Column | Required | Description |
|--------|----------|-------------|
| `url` | Yes | Path pattern to protect (must start with `/`) |
| `cug-required` | No | Whether login is required: `true` or `false` |
| `cug-groups` | No | Comma-separated list of allowed groups |

### 3. Publish the spreadsheet

Publishing the `closed-user-groups` sheet sends the access rules to the Config Service. The CDN then is responsible to enforce them on every request.

> **Note:** Publishing the CUG sheet does **not** make it visible on Edge Delivery as a regular sheet. The sheet content (i.e., `closed-user-groups.json`) is not accessible on preview or live — only the derived CUG headers are applied to the Config Service.

> **Note:** CUG spreadsheet publishing is available in **AEM Author** only, not in Document Authoring (DA). For DA-based sites, you can implement a custom DA tool in your project. See the [summit-portal CUG tool](https://github.com/aemsites/summit-portal/tree/main/tools/cug) for a working example.

---

## Wildcard Patterns

Use wildcards in the `url` column to protect multiple pages at once:

| Pattern | Matches | Does NOT match |
|---------|---------|----------------|
| `/members/*` | `/members/page1` | `/members/sub/page2` |
| `/members/**` | `/members/page1`, `/members/sub/page2` | `/other/page` |

- `*` matches a single path segment
- `**` matches multiple path segments (the whole subtree)

---

## Examples

### Protect a section — any logged-in user

| url | cug-required | cug-groups |
|-----|--------------|------------|
| `/members/**` | true | |

Any authenticated user can access pages under `/members/`.

Resulting headers set by the Config Service for paths matching `/members/**`:

| Header | Value |
|--------|-------|
| `x-aem-cug-required` | `true` |
| `x-aem-cug-groups` | *(not set)* |

### Protect a section — specific groups only

| url | cug-required | cug-groups |
|-----|--------------|------------|
| `/partners/**` | true | gold,silver |

Only users in the `gold` or `silver` group can access pages under `/partners/`.

Resulting headers set by the Config Service for paths matching `/partners/**`:

| Header | Value |
|--------|-------|
| `x-aem-cug-required` | `true` |
| `x-aem-cug-groups` | `gold,silver` |

### Mixed access levels

| url | cug-required | cug-groups |
|-----|--------------|------------|
| `/members/**` | true | |
| `/members/gold/**` | true | gold |
| `/members/silver/**` | true | silver |
| `/members/free/**` | false | |
| `/internal/**` | true | employees |

| Visitor requests... | Result |
|---------------------|--------|
| `/members/page` | Login required, any authenticated user |
| `/members/gold/page` | Login required, must be in `gold` group |
| `/members/free/page` | Public (auth explicitly disabled) |
| `/internal/docs` | Login required, must be in `employees` group |
| `/public/page` | Public (no CUG rule applies) |

---

## Important Rules

1. **Sheet must be at the site root.** Place `closed-user-groups` at the same level as your index page. Sheets at deeper paths are ignored.

2. **Paths must start with `/`.** For example, `/partners/**` is valid; `partners/**` is not.

3. **No duplicate paths.** If the same path appears more than once, only the first row is used.

4. **Empty URLs are skipped.** Rows without a `url` value are ignored.

5. **Publishing applies the rules.** Changes to the sheet only take effect after you publish it.

6. **Unpublishing removes all protection.** See [Unpublishing the sheet](#unpublishing-the-sheet) below.

---

## Unpublishing the Sheet

When you **unpublish** the `closed-user-groups` sheet:

- **All CUG headers are removed** from the Config Service for your site.
- Every previously protected page becomes **publicly accessible**.
- Non-CUG headers (e.g., CORS headers) are preserved — only the `x-aem-cug-required` and `x-aem-cug-groups` headers are removed.

To re-enable protection, simply publish the sheet again.

> **Warning:** Unpublishing affects the entire site at once. There is no way to selectively remove protection for individual paths by unpublishing — either all rules are active (sheet published) or none are (sheet unpublished). To remove protection for a specific path, delete or modify that row in the sheet and republish.

---

## Inheritance

Child pages inherit the access rules of their parent path. For example:

- If `/members/**` requires authentication, then `/members/gold/page` also requires authentication.
- You can add group restrictions on a child path that inherits from a parent.

---

## CDN Requirement

CUG headers are set by AEM in the Config Service, but **enforcement happens at the CDN edge**. Your CDN must have an edge worker (or equivalent) configured to:

1. Read the `x-aem-cug-required` header — if `true`, verify the visitor is logged in.
2. Read the `x-aem-cug-groups` header — if present, verify the visitor belongs to at least one of the listed groups.
3. Redirect unauthenticated visitors to a login page, or return a 403 Forbidden for unauthorized visitors.

For implementation details, see the [CUG Developer Guide](CUG_DEVELOPER_GUIDE.md).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Protection not applied after editing the sheet | Make sure you **published** the `closed-user-groups` sheet |
| Sheet is ignored / no effect | Verify the sheet is at the **site root** (same level as index) |
| Specific rows have no effect | Check that the `url` starts with `/` and is not a duplicate |
| All content became public | The sheet may have been unpublished — republish it |
| Protected pages still accessible | Verify your CDN edge worker is configured and reading the `x-aem-cug-*` headers |
