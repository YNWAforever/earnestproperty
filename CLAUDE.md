# Earnest Property (晉誠地產)

Hong Kong property agency site — public zh-HK marketing/listing pages plus a staff
admin (CMS + CRM + WhatsApp blasts + AI copilot + ops control plane).

## Tech Stack

TanStack Start (React 19, file-based TanStack Router) · Vite 7 + Nitro · Neon
Postgres via `@neondatabase/serverless` (raw SQL, **no ORM**) · Neon Auth ·
Tailwind v4 + shadcn/ui (new-york, slate) · Zod 3 · TypeScript 5.8 strict.
Deployed to **Vercel**; `workers/cron/` is a Cloudflare Worker used **only** for
cron cadence.

Scaffolded by Lovable — `vite.config.ts` wraps `@lovable.dev/vite-tanstack-config`,
which already registers tanstackStart/react/tailwind/tsconfig-paths. Do not re-add
those plugins; duplicates break the app.

## Build & Run

```
npm run dev      # vite dev
npm run build    # vite build (runs scripts/check-required-env.mjs as prebuild)
npm run lint     # eslint . (prettier runs as an eslint rule)
npm run format   # prettier --write .
npx tsc --noEmit # typecheck — `npm run build` does NOT typecheck
```

## Testing

**There is no `npm test`.** Tests are split by runner and invoked per named script:

- `*.test.mjs` → `node --test` (17 scripts: `test:seo`, `test:command-center`,
  `test:operations`, `test:control-plane`, …)
- `*.test.ts` / `*.test.tsx` → `bun test` (bundled inside `test:woztell`,
  `test:operations`, `test:property-experience`, `test:content-copilot`)

Run the scripts that cover the area you touched; check `package.json` for the list.
`*.contract.test.mjs` asserts module/API shape; `*.integration.test.mjs` needs a live DB.

## Project Structure

```
src/routes/       flat file-based routes; `.` = path segment, `_` = non-nested
                  (admin.leads_.command-center.tsx), `api.*.ts` = server handlers
src/lib/neon/     all DB access — see the .ts/.server.ts split below
src/lib/ai/       content copilot, live agent, CRM enrichment (OpenRouter-style providers)
src/lib/control-plane/  jobs queue, migrations, health, audit, RBAC permissions
src/lib/woztell/  WhatsApp send + campaign delivery
src/content/      SEO copy, estate/corridor content constants
src/config/       site.ts (contact/CTA config), site-branches, site-team
src/components/ui shadcn primitives — vendored, keep in sync with upstream
neon/migrations/  timestamped .sql, applied via `npm run neon:migrate`
vercel.ts         Vercel config-as-TS: crons + redirects (not vercel.json)
```

## Conventions

- **`.server.ts` = server-only.** Starts with `import "@tanstack/react-start/server-only"`.
  Never import one from a client component.
- **Two-file DB boundary**: `x.ts` holds `createServerFn` wrappers (+ Zod
  `inputValidator`) and lazily `await import("./x.server")`; `x.server.ts` holds the
  SQL. Types live in `x.types.ts`. `public-data.ts`, `admin-data.ts`, `admin-cms.ts`,
  `content-copilot-admin.ts`, and `admin-team.ts` define server functions.
- **`.js` + `.d.ts` pairs** (`website-inquiry.js`, `property-decision.js`,
  `site-branches.js`): pure logic authored as plain JS so `node --test` `.mjs` tests
  import it with no build step. Import with the explicit `.js` extension.
- **SQL**: parameterized via `queryRows(sql, params)` / `addParam()` in
  `lib/neon/db.server.ts`. Never interpolate values into SQL strings.
- **Admin auth**: client calls `withStaffAuthHeaders()` (`src/auth.ts`) to attach the
  Neon Auth JWT; the server fn calls `requireStaffAccess(getRequest(), roles)`.
  Roles are `admin | manager | agent`; capability grants in
  `lib/control-plane/permissions.ts`.
- **Errors**: typed error classes (`LiveAgentPublicError`) mapped to status codes in
  handlers. Don't swallow errors.
- Components PascalCase; helper/logic modules kebab-case. Prettier: 100 cols, double
  quotes, semis, trailing commas.
- `src/routeTree.gen.ts` is generated — never edit.

## Gotchas

- Missing `VITE_CONTACT_WHATSAPP_PHONE` / `_PHONE_DISPLAY` / `_PHONE_TEL` silently
  degrades every WhatsApp CTA to `/contact`. `prebuild` fails Vercel builds on it;
  local dev only warns. See `.env.example`.
- Vercel Hobby allows one cron run/day — the daily entries in `vercel.ts` are a
  safety floor; real 5/10-minute cadence comes from `workers/cron/`. Both drain
  `ops_jobs` under a lease, so running both is safe.
- Public site copy is **zh-HK**. No i18n framework — strings are inline.

## Git

Branches `feat/…`, `fix/…`, `claude/…`. Conventional commits with a scope
(`fix(admin): …`). Merged to `main` via GitHub PR merge commits.
