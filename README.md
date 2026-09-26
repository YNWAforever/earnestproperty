# Earnest Property (晉誠地產)

A Hong Kong property agency website and staff workspace. The public site presents listings, agents, estates, neighbourhood guides, articles, videos, and enquiries in Traditional Chinese. Staff tools manage property content, leads, WhatsApp conversations, campaigns, and operational jobs.

## Stack

- React 19, TanStack Start and Router, TypeScript, Vite, and Nitro
- Tailwind CSS 4 and shadcn/ui components
- Neon Postgres and Neon Auth; SQL lives in server-only modules
- Vercel for the app; Cloudflare Workers for job wake alarms and the optional MLS container workflow
- Node.js and npm for the app, Bun for selected tests, and Python for the property-source workers

The CI workflow uses Node.js 24, Bun 1.3.12, and Python 3.14. See [CI](.github/workflows/ci.yml) for the exact checks.

## Get started

1. Install dependencies and make a local environment file:

   ```powershell
   npm.cmd ci
   Copy-Item .env.example .env.local
   ```

2. Fill the settings needed for the area you are running. At minimum, database-backed pages need `DATABASE_URL_UNPOOLED` (or `DATABASE_URL`). Authentication uses `VITE_NEON_AUTH_URL` and server-side Neon Auth settings. Public contact actions use `VITE_CONTACT_WHATSAPP_PHONE`, `VITE_CONTACT_PHONE_DISPLAY`, and `VITE_CONTACT_PHONE_TEL`. [.env.example](.env.example) lists feature-specific settings; never put server secrets in a `VITE_` variable.

3. Start the app:

   ```powershell
   npm.cmd run dev
   ```

For a production-style local build, run `npm.cmd run build` and `npm.cmd run preview`. The build runs [scripts/check-required-env.mjs](scripts/check-required-env.mjs), which checks production contact and site-origin settings when `VERCEL_ENV` is set. Configuration for external providers is optional until the corresponding feature is exercised.

## What is in the app

| Area                                                                                                                   | Main locations                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Public pages: listings, property detail, agents, estates, districts, blog, videos, transactions, mortgage, and contact | `src/routes/`, `src/components/site/`, `src/components/property/`, `src/content/` |
| Staff workspace: listings, CMS, estates, transactions, leads, team, WhatsApp, campaigns, analytics, and operations     | `src/routes/admin.*`, `src/components/admin/`, `src/lib/admin/`                   |
| Data, search, and authentication                                                                                       | `src/lib/neon/`, `src/auth.ts`, `neon/migrations/`                                |
| Content copilot and live agent                                                                                         | `src/lib/ai/`, `src/components/live-agent/`                                       |
| MLS ingestion and property-source reconciliation                                                                       | `src/lib/mls/`, `scripts/mls/`, `scripts/property-sync/`                          |
| WhatsApp delivery and enquiry handling                                                                                 | `src/lib/woztell/`, `src/lib/whatsapp-enquiries/`                                 |
| Job queue, approvals, audit, and health                                                                                | `src/lib/control-plane/`, `workers/cron/`                                         |

Routes use TanStack Router's file conventions. `src/routeTree.gen.ts` is generated. Browser-facing server functions call server-only modules for database and provider work; `.server.ts` files must stay out of client imports. Staff requests use Neon Auth and server-side access checks.

## Repository map

| Path                             | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `src/routes/`                    | Public, staff, authentication, and API routes                              |
| `src/components/`                | UI components, including vendored primitives in `ui/`                      |
| `src/lib/`                       | Domain logic, server functions, integrations, and tests                    |
| `src/content/` and `src/config/` | Editorial content, SEO, site and contact configuration                     |
| `src/styles.css` and `public/`   | Styles and static images/assets                                            |
| `scripts/`                       | Migration, ingestion, media, release, and verification utilities           |
| `neon/migrations/`               | Timestamped Postgres schema changes                                        |
| `workers/cron/`                  | Cloudflare Durable Object alarms for queued jobs                           |
| `workers/mls-container/`         | Isolated MLS workflow and container                                        |
| `e2e/`                           | Browser acceptance tests                                                   |
| `docs/`                          | Activation guides, designs, audits, deployment notes, and release evidence |
| `.github/workflows/`             | CI, migration drift, and property-sync workflows                           |
| `ops/systemd/`                   | Operator service and timer templates                                       |
| `vite.config.ts` and `vercel.ts` | App build configuration, redirects, and hosting configuration              |

`public/` contains source-controlled assets. Generated route and redirect data live under `src/generated/` and `src/routeTree.gen.ts`; edit their generators or source inputs instead.

## Checks

There is no single `npm test` script. Pick the focused `test:*` command from [package.json](package.json) for the area changed. Common checks:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:seo
npm.cmd run test:cms
npm.cmd run test:mls
npm.cmd run test:whatsapp-enquiries
npm.cmd run test:analytics
```

The test scripts combine Node's test runner and Bun. `:db` suites require an isolated test database; browser suites need a running app. CI runs deterministic checks and keeps database-dependent and staging browser gates separate.

## Data and operations

- `npm.cmd run neon:migrate` applies migrations to the configured database. Inspect the target and the migration plan before running it. `npm.cmd run check:migration-drift` is the read-only drift check.
- Property-source workers have offline fixture and dry-run commands in [scripts/property-sync/README.md](scripts/property-sync/README.md). Daily ingestion and release gates are documented in [docs/deployment/property-sync-daily.md](docs/deployment/property-sync-daily.md).
- `vercel.ts` currently declares no recurring cron jobs. The [job alarm Worker](workers/cron/README.md) wakes the leased job queue when work is due. The [MLS container guide](workers/mls-container/README.md) describes its separate, gated workflow.
- Provider and production activation require their own configuration and checks. Start with the [WozTell](docs/woztell-activation.md), [content copilot](docs/ai-content-copilot-activation.md), [live agent](docs/ai-crm-live-agent-activation.md), and [MLS](docs/mls-production-activation.md) guides. Dated audit and report files record their check date; they are not live status dashboards.

## Working conventions

Public-facing copy is primarily `zh-HK`. Keep database access and provider credentials server-side, use parameterized SQL, and use the existing staff permission checks for privileged actions. See [CLAUDE.md](CLAUDE.md) for the fuller code conventions and [CHANGELOG.md](CHANGELOG.md) for project history.
