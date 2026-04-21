# Closed User Groups (CUG) for AEM Edge Delivery Services

This project is an example implementation of Closed User Groups for AEM Edge Delivery Services. It demonstrates how to restrict pages to authenticated users or specific groups using a spreadsheet-driven, edge-enforced access control pattern. Authors define access rules in a spreadsheet, AEM translates them into CUG headers via the Config Service, and a CDN edge worker authenticates visitors via Adobe IMS (OAuth 2.0 + PKCE) and enforces group membership — all before content reaches the browser. It is not an official reference implementation — adapt the patterns here to fit your own site and requirements.

## How It Works

1. **Authors** define access rules in a `closed-user-groups` spreadsheet — which paths to protect and which groups are allowed.
2. **AEM** translates each row into CUG headers (`x-aem-cug-required`, `x-aem-cug-groups`) and attaches them to matching pages via the Config Service.
3. **A CDN edge worker** reads these headers on every request, authenticates visitors via Adobe IMS (OAuth 2.0 + PKCE), checks group membership, and either serves or gates the page.

```
Browser ──> CDN Edge Worker ──> AEM Edge Delivery Origin
                │                        │
                │ 1. Proxy request        │ Returns page + CUG headers
                │ 2. Check CUG headers    │ (x-aem-cug-required, x-aem-cug-groups)
                │ 3. Verify session JWT   │
                │ 4. Enforce groups       │
                │                        │
                └──> Adobe IMS (OAuth)   │
                     (if no session)     │
```

## Repository Structure

This is a multi-project repository containing an Edge Delivery site and CDN edge workers for two platforms:

| Directory | What it is |
|-----------|------------|
| Root (`blocks/`, `scripts/`, `styles/`) | AEM Edge Delivery site with auth-aware header and user-group-teaser block |
| `workers/akamai/cug-akamai-worker/` | Akamai EdgeWorker — IMS OAuth, JWT sessions, CUG enforcement |
| `workers/cloudflare/cug-cloudflare-worker/` | Cloudflare Worker — same pattern, KV for PKCE, direct IMS fetch |
| `workers/cloudflare/frescopa-b2b-worker/` | Frescopa B2B variant of the Cloudflare Worker |
| `docs/` | CUG documentation for authors, developers, and DevOps |
| `models/` | Universal Editor component models (merged into `component-*.json` on commit) |

## Guides

| Guide | Audience | Covers |
|-------|----------|--------|
| [CUG Overview](docs/CUG.md) | Everyone | How CUG works, links to all guides |
| [CUG Author Guide](docs/CUG_AUTHOR_GUIDE.md) | Content authors | Spreadsheet setup, access rules, wildcards, publishing, troubleshooting |
| [CUG Developer Guide](docs/CUG_DEVELOPER_GUIDE.md) | Site developers | Sign-in/sign-out flow, `/auth/*` endpoints, user-group-teaser block |
| [CUG Akamai Guide](docs/CUG_AKAMAI_GUIDE.md) | DevOps / Akamai | EdgeWorker deployment, Property Manager config, secrets, testing |
| [CUG Cloudflare Guide](docs/CUG_CLOUDFLARE_GUIDE.md) | DevOps / Cloudflare | Cloudflare Worker deployment, KV setup, wrangler config, testing |

## Prerequisites

- Node.js 18.3.x or newer
- AEM Cloud Service release 2024.8 or newer (>= `17465`)
- For Akamai: [Akamai CLI](https://techdocs.akamai.com/developer/docs/set-up-akamai-cli) with EdgeWorkers module
- For Cloudflare: [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

## Quick Start

### Edge Delivery Site

```bash
npm ci
npm run lint
npm install -g @adobe/aem-cli
aem up
```

The dev server runs at `http://localhost:3000`.

### Cloudflare Worker

```bash
cd workers/cloudflare/cug-cloudflare-worker
npm ci
npm test
npm run dev      # local dev server
npm run deploy   # deploy to Cloudflare
```

### Akamai EdgeWorker

```bash
cd workers/akamai/cug-akamai-worker
cp secrets.example.js secrets.js   # fill in your secrets
tar -czvf bundle.tgz bundle.json main.js config.js secrets.js oauth.js session.js cug.js utils.js
akamai edgeworkers upload --bundle bundle.tgz <edgeworker-id>
akamai edgeworkers activate <edgeworker-id> STAGING 1.0
```

## Environments

| Environment | URL |
|-------------|-----|
| Preview | https://main--aem-edge-cug--aemsites.aem.page/ |
| Live | https://main--aem-edge-cug--aemsites.aem.live/ |

## AEM Edge Delivery Documentation

- [Getting Started](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/wysiwyg-authoring/edge-dev-getting-started)
- [Creating Blocks](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/wysiwyg-authoring/create-block)
- [Content Modelling](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/wysiwyg-authoring/content-modeling)
- [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
- [Web Performance](https://www.aem.live/developer/keeping-it-100)
- [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

## License

Apache License 2.0 — see [LICENSE](LICENSE).
