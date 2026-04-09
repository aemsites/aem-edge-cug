# Closed User Groups (CUG) for Edge Delivery Services

This project is an example implementation of Closed User Groups for AEM Edge Delivery Services. It demonstrates how to restrict pages to authenticated users or specific groups using a spreadsheet-driven, edge-enforced access control pattern. It is not an official reference implementation — adapt the patterns here to fit your own site and requirements.

## How It Works

1. **Authors** define access rules in a `closed-user-groups` spreadsheet — which paths to protect and which groups are allowed.
2. **AEM** translates each row into CUG headers (`x-aem-cug-required`, `x-aem-cug-groups`) and attaches them to matching pages via the Config Service.
3. **A CDN edge worker** reads these headers on every request, authenticates visitors via Adobe IMS (OAuth 2.0 + PKCE), checks group membership, and either serves or gates the page — all before content reaches the browser.

## Guides

| Guide | Audience | Covers |
|-------|----------|--------|
| [CUG Author Guide](CUG_AUTHOR_GUIDE.md) | Content authors | Spreadsheet setup, access rules, wildcards, publishing, troubleshooting |
| [CUG Developer Guide](CUG_DEVELOPER_GUIDE.md) | Site developers | Sign-in/sign-out flow, `/auth/*` endpoints, user-group-teaser block |
| [CUG Akamai Guide](CUG_AKAMAI_GUIDE.md) | DevOps / Akamai | EdgeWorker deployment, Property Manager config, secrets, testing |
| [CUG Cloudflare Guide](CUG_CLOUDFLARE_GUIDE.md) | DevOps / Cloudflare | Cloudflare Worker deployment, KV setup, wrangler config, testing |
