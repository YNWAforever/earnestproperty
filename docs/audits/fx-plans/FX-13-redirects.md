# FX-13: Redirects, canonical host, legacy URLs. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- `earnestproperty.vercel.app` stops serving an indexable duplicate. Every public page on that host 308s to the same path on `https://www.earnestproperty.com` (F-06).
- **No enquiry is ever lost.** The host redirect never touches `/api/*`, `/_serverFn/*`, `/w/*` or `/.well-known/*`. The WozTell webhook, the Cloudflare job drains, the Property.hk receiver, the cron routes and tracked links answer on `earnestproperty.vercel.app` exactly as today, whether or not the owner has moved them to www yet.
- About 3,400 old-site PHP requests a day stop returning 404. Each one redirects to a page that exists (L-04).
- Old search codes `/property/b<estate name>$` reach the estate page, or a keyword search when the name is unknown. Real listing numbers are never caught (L-04).
- `/listings`, `/videos` and `/transactions` answer 200 on the bare URL. There is no 307 to `?deal=all&sort=newest&page=1` and no redirect loop (F-04).
- robots.txt disallows `/w/` (F-24). The 404 page has its own title (F-22). No estate link is built from an empty slug (L-05).

Findings: F-06, L-04, F-04, F-24, F-22, L-05. F-05 is **skipped unless the owner says yes** (Open question 6).

**Architecture.**
- **Host redirect.** One entry in `vercel.ts`, generated only when **all** of these hold: `VERCEL_ENV === "production"`; `resolveSiteOrigin()` (`scripts/site-origin.mjs:23-27`) returns an https origin; and that origin is not a `*.vercel.app` host. Shape:
  ```ts
  redirectEntry(HOST_REDIRECT_SOURCE, `${origin.origin}/$1`, true, {
    has: [{ type: "host", value: FALLBACK_HOST }], // "earnestproperty.vercel.app"
  })
  // HOST_REDIRECT_SOURCE = "/((?!api(?:/|$)|_serverFn(?:/|$)|w/|\\.well-known(?:/|$)).*)"
  ```
  The `CANONICAL_HOST_REDIRECT_ENABLED` flag is deleted (fix plan Global constraints: "removes 7"). Vercel cannot condition a redirect on the HTTP method (fact 4). **"Never redirect a POST" is therefore delivered by path exclusion:** every POST-receiving machine route lives under `/api/` or `/_serverFn/` (facts 9-10), and a test enumerates `src/routes/api.*.ts` so a future API route cannot slip into the redirect.
- **Preview deployments never redirect.** There are two independent guards. First, the rule is generated only in production builds. Second, even a production config matches only the exact host `earnestproperty.vercel.app`. Previews are served on `earnestproperty-git-<branch>-<team>.vercel.app` and `earnestproperty-<hash>-<team>.vercel.app`, which that host value cannot match (fact 5).
- **Legacy PHP paths.** These are static `vercel.ts` entries, taken only from the audit's 24 h 404 list (L-04, audit `:150`). `/special_prop_detail.php?id=<n>` goes through the existing `/property-detail/$file` resolver, using a Vercel `has` query capture. No new app route is needed.
- **Old search code.** This lives in the `/property/$listingNo` loader. It runs **only after** `fetchPropertyByListingNo` returns nothing, and only when the decoded parameter has the shape `b<name>$` (trailing literal `$`). A real listing can therefore never be redirected (facts 19-20).
- **F-04.** A `search.middlewares: [stripSearchParams(DEFAULTS)]` on the three routes. TanStack Start's server load redirects only when the incoming `publicHref` differs from the canonical one it builds (fact 15). With the defaults stripped, the canonical of `/listings` is `/listings`, so the bare URL is served directly. The 28 internal hrefs that spell the defaults out are rewritten (fact 17), so the change adds no new 307s.
- **No new env var, no migration, no provider call, no new `test:*` script, no `ci.yml` change.**

**Tech stack.**
- Config tests: `node --test`. They load `vercel.ts` in a child process with `--experimental-strip-types` and controlled env, which is the pattern of `scripts/site-origin.test.mjs:34-58`. Sources are compiled with `path-to-regexp` 6.3.0. That is the same major version Vercel uses, already in `package-lock.json` (hoisted via `wrangler`). Nothing is added to `package.json`, and `bun.lockb` is untouched.
- Router behaviour tests: `node --test`, building a real `@tanstack/react-router` 1.170.41 router in memory.
- Pure and source-scan tests: `node --test` (importing `.ts` directly, as `src/content/estate-registry.test.mjs` does). The pure 404-head helper uses `bun test`.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`:
  - F-04 (:289)
  - F-05 (:290)
  - F-06 (:291)
  - F-22 (:307)
  - F-24 (:308)
  - L-04 (:150), the 24 h 404 list
  - L-05 (:151)
  - "Canonical domain" (:314)
  - executive summary (:77-79)
  - status mix (:110)
  - open items (:530, :554)
- Fix plan `docs/audits/2026-10-fix-plan.md`:
  - FX-13 (:590-624)
  - Review focus 1 (:43)
  - Wave 0 item 3 (:56)
  - Global constraints (:17-39)
  - FX-07 (:371-401, `SITE_ORIGIN` → www)

## Facts verified in code (origin/main bfbfd618, 2026-10-08)

| # | Fact | Where |
|---|---|---|
| 1 | **Today's host redirect is opt-in and covers every path.** `canonicalHostRedirects()` returns `[]` unless `process.env.CANONICAL_HOST_REDIRECT_ENABLED === "true"`. Otherwise it emits `redirectEntry("/:path*", "${origin}/:path*", true, { has: [{ type: "host", value: "earnestproperty.vercel.app" }] })`. It skips when the resolved origin is a `*.vercel.app` host. It is the first entry in `redirects`. With the flag on, it would 308 `/api/woztell/webhook`, the drains and `/w/*` (Review focus 1). | `vercel.ts:29-43,49-50` |
| 2 | **The flag is not set in any environment.** A read of the Vercel project's env **names and targets only** (no values, 88 variables, 2026-10-08) shows no `CANONICAL_HOST_REDIRECT_ENABLED` and no `VITE_SITE_URL`. The production origin therefore comes from `VERCEL_PROJECT_PRODUCTION_URL`. The audit confirms that canonical tags, og:url and all 455 sitemap `<loc>` entries already use www. **Today `earnestproperty.vercel.app` has no redirect.** | Vercel API `filter_project_envs`; `scripts/site-origin.mjs:23-27`; audit `:314` |
| 3 | **Vercel project domains (read-only, 2026-10-08).** `earnestproperty.com` → 308 → `www.earnestproperty.com`. `www.earnestproperty.com` has no redirect and is verified. `earnestproperty.vercel.app` has no redirect. So www already serves the production deployment. That is the precondition the 2026-09-11 asset incident lacked: a catch-all redirect 308'd same-origin assets to a host that answered HTML (`docs/reports/2026-09-11-homepage-asset-redirect.md:3-5`). | Vercel API `list_project_domains` |
| 4 | **Redirect conditions available to `vercel.ts`.** `@vercel/config` 0.5.3 (present only in the main checkout's `node_modules`; **not** a dependency in `package.json`. `vercel.ts` declares its own `VercelRedirect` type at `:5-17`) defines `Condition = { type: 'host'; value } \| { type: 'header'\|'cookie'\|'query'; key; value? }`, plus `has`/`missing` on `Redirect`. `permanent: true` = 308, `false` = 307. **There is no method condition**, so a redirect cannot be limited to GET. | `node_modules/@vercel/config/dist/types.d.ts:227-276` (main checkout) |
| 5 | **Host match.** `has: [{ type: "host", value: "earnestproperty.vercel.app" }]`. Read even as an unanchored regex, it cannot match a preview host, because `earnestproperty-git-…vercel.app` and `earnestproperty-<hash>-…vercel.app` have `-` after `earnestproperty`, not one character then `vercel.app`. Nor can it match `www.earnestproperty.com`. `scripts/check-required-env.mjs:41` reads `VERCEL_ENV`. `vercel.ts` and `src/` do not read it today. | `vercel.ts:31,40`; `scripts/check-required-env.mjs:41-70` |
| 6 | **No middleware.** There is no `middleware.ts` and no `src/start.ts`/`src/server.ts`. The only redirect sources are `vercel.ts`, route loaders/handlers, and TanStack's canonical-search redirect (fact 15). | `ls` |
| 7 | **Existing legacy redirects (`vercel.ts:84-105`).** `/eng/property-detail/:oldId.html` → `/property-detail/:oldId.html`; `/eng`, `/eng/` → `/`; `/profile.php` → `/about`; `/contactus.php` → `/contact`; `/property`, `/property/`, `/property/c1`, `/c1/`, `/c2`, `/c2/` → `/listings?deal=all&page=1`; `/property/c5`, `/c5/` → `/listings?deal=rent&page=1`; `/listprop.php` → `/contact`; `/companynews.php`, `/news_content.php` → `/blog`; **`/mortgage.php` → `/contact` (:100)**; `/mortgage_rate.php` → `/contact`; `/school.php` → `/blog`; `/bankval.php` → `/contact`; `/unlucky.php` → `/blog`; **`/tran_trends.php` → `/blog` (:105)**. `src/generated/old-site-redirects.json` is `[]`. None of the audit's 404 paths is covered. | `vercel.ts:1,25-27,84-105` |
| 8 | **The audit's 24 h 404 list (the only source for new paths):** `/info_gallery.php` (707), `/qrcode_page.php` (590), `/eng/special_prop_st.php` "+ `.json` and uppercase variants" (987 together), `/special_prop_detail.php` (189), `/seccode_enquiry/seccode.php` "209 incl. `/eng`", `/unlucky_detail.php` (64), `/vr.php` (52), `/m/property_detail.php` (14), and `/property/b<estate>$` ("307 then 404"). **The audit does not spell out the `.json` or uppercase variants, the `/eng` seccode path, or the old query keys.** A read-only `get_runtime_logs` search for `.php` (24 h, 2026-10-08) returned no groups, because runtime logs do not hold edge-served 404s. Those paths therefore must come from a Vercel request-log export (Task 2 step 0, Owner action 6), never from guesses. | audit `:150` |
| 9 | **Machine callers and the route each one hits.** Every one is under `/api/`:<br>• WozTell → `POST /api/woztell/webhook` (`src/routes/api.woztell.webhook.ts:5-7`). It verifies `X-Woztell-Signature` over the raw body only, so the signature does not depend on the host (`src/lib/whatsapp-enquiries/webhook.server.ts:82`).<br>• Cloudflare worker drains → `POST /api/admin/whatsapp/service-worker` and `POST /api/admin/control-plane/worker` with `Authorization: Bearer CRON_SECRET` and `redirect: "manual"`. A 3xx throws `JOB_DRAIN_REDIRECTED` (`workers/cron/src/job-alarm.js:11-12,110-121`; `api.admin.control-plane.worker.ts:9-10`).<br>• Property.hk receiver → `POST /api/admin/propertyhk-sync` (`src/routes/api.admin.propertyhk-sync.ts:3`).<br>• Cron-style GETs `/api/youtube-sync` (`api.youtube-sync.ts:10`) and `/api/mls-sync` have no scheduler: `crons: []` (`vercel.ts:47-48`). | as listed |
| 10 | **Browser-only machine paths.** TanStack Start server functions POST to `/_serverFn/<id>` (default base, `node_modules/@tanstack/start-plugin-core/src/schema.ts:249`). Production logs show them, e.g. `/_serverFn/2240…` (Vercel runtime logs, 2026-10-08). A staff tab opened on `earnestproperty.vercel.app` before the deploy would POST there, and a cross-origin 308 would fail CORS. **The fix plan's source `/((?!api/\|w/).*)` misses this, misses `/api` without a trailing slash, and misses `/.well-known`.** | as listed |
| 11 | **Worker `SITE_ORIGIN` is www in the repo** (FX-07, merged): `"SITE_ORIGIN": "https://www.earnestproperty.com"`. The *deployed* worker version is not visible from the repo (Owner action 3). | `workers/cron/wrangler.jsonc:17-19` |
| 12 | **`PROPERTYHK_SYNC_URL` is not a GitHub variable.** No workflow references it (`grep -r PROPERTYHK_SYNC_URL .github` → nothing). The daily GitHub workflow runs **28hse only**, writes through `DATABASE_URL_UNPOOLED`, and does not call the site (`property-sync-daily.yml:131,346`; `docs/deployment/property-sync-daily.md:3`: "Property.hk remains disabled"). The variable is read only by the operator-run Property.hk path (`scripts/property-sync/sync_propertyhk.py:39`; `scraping/worker.py:1308`). That path enforces an exact-origin allowlist (`worker.py:1113-1120`, `unapproved_sync_origin`) and refuses redirects (`worker.py:154-156`, `NoRedirect`). The documented value is vercel.app (`.env.example:178`; `docs/deployment/property-sync-no-hermes.md:101`). | as listed |
| 13 | **WozTell doc pins the webhook to vercel.app** until FX-13 ships the `/api/*` exclusion. | `docs/woztell-activation.md:35-38` |
| 14 | **Tracked links.** `/w/$code` is a GET/HEAD server route (`src/routes/w.$code.ts:4-10`). The admin builds the URL from `window.location.origin` (`WhatsappLinksTable.tsx:19`; `WhatsappBatchResult.tsx:39`), so links created while staff used vercel.app carry that host and are already printed or sent. robots.txt has no `/w/` line (`src/routes/robots[.]txt.ts:8-18`, F-24 confirmed). `robots.test.mjs:12-20` pins the other four `Disallow` lines. | as listed |
| 15 | **How the F-04 307 happens.** `loadServerRoute` builds `canonical = router.buildLocation({ to: next.pathname, search: true, …, _includeValidateSearch: true })` and `throw redirect({ href })` when `next.publicHref !== canonical.publicHref`. That is a 307. The listings schema fills `deal="all"`, `sort="newest"`, `page=1` (`.default`), so bare `/listings` canonicalises to `/listings?deal=all&sort=newest&page=1`. That is the audit's exact evidence. `stripSearchParams(defaults)` deletes keys deep-equal to the default and records them in `meta.removed`, so the canonical becomes `/listings`. The re-run is stable, so there is no loop. Keys serialise in schema order, which tests must respect. | `node_modules/@tanstack/router-core/src/load-server.ts:913-923`; `searchMiddleware.ts:101-141`; `src/routes/listings.tsx:76-96,99` |
| 16 | **Videos and transactions have the same defaults.** Videos: `sort` default `"newest"` (`videos.tsx:44-52`). Transactions: `dealType` `"all"`, `page` `1` (`transactions.tsx:56-75`). The repo uses `stripSearchParams` nowhere. | as listed |
| 17 | **28 internal hrefs spell the defaults out** and would each gain a 307 once defaults are stripped: `src/content/estate-pages.ts` (22×, e.g. `:94` `/listings?deal=all&estate=bellagio&page=1`); `src/content/castle-peak-road.ts:228,319`; `src/content/blog-articles.ts:136`; `src/routes/castle-peak-road.$segment.tsx:95,98,100`. The `/property*` entries in `vercel.ts:89-96` point at `/listings?deal=all&page=1`, which would become a 308 → 307 chain. | `grep -rn "deal=all\|[?&]page=1" src` |
| 18 | **Search-schema source scans.** Several tests slice `const searchSchema = z.object({` out of the route files: `listings.contract.test.mjs:210`, `agents.contract.test.mjs:487`, `transactions.contract.test.mjs:43-58`, `videos.contract.test.mjs:9-10`. **The schemas must stay in the route files**, and the new middleware is added beside them. | as listed |
| 19 | **How `/property/$listingNo` reads its parameter.** The loader calls `fetchPropertyByListingNo(params.listingNo)` and throws `notFound()` on a miss or a non-public status. When `public_listing_no` differs, it 301s to it (`property.$listingNo.tsx:135-160`). Params are `decodeURIComponent`-decoded (`router-core/src/new-process-route-tree.ts:786`). A raw `$` re-encodes as `%24`, which explains the audit's "307 then 404": first the canonical-href redirect, then the loader miss. | as listed |
| 20 | **Real listing numbers include `B…`.** The production runtime-log 404 paths (2026-10-08, read-only) include `/property/B054645`, `/property/B050052`, `/property/B070102`, `/property/T029514`, `/property/A056377` and `/property/C007232`. FX-11b's number grammar (PR #237, `src/lib/ai/live-agent-intent.ts`) is `EP` + 3-8 digits, or one letter + optional `-`/space + 6 digits (`A056377`, `C-018613`). A `-R` suffix is handled in the loader (`:155`). **A rule on "starts with b" alone would catch real listings.** | Vercel runtime logs; PR #237 |
| 21 | **The estate registry** has `nameZh`, `nameEn`, `aliases[]` and `hasPage` per entry (`src/content/estate-registry.ts:48-128,130+`). It has no imports, so `node --test` can import it as `.ts`. `/listings` accepts **`keyword`**, not `q` (`listings.tsx:85`). An unknown key is stripped by zod, and the result 307s to the bare URL. | as listed |
| 22 | **`/property-detail/$file` resolver.** It parses `^(\d+)\.html?$`, looks up `legacy_detail_id`, and 301s to `/property/<listing_no>`, else 301s to `/listings` (`src/routes/property-detail.$file.ts:10-36`). `legacy-detail.contract.test.mjs:11-26,45` pins it, together with `type: "host", value: FALLBACK_HOST` in `vercel.ts`. | as listed |
| 23 | **L-05: the fix plan's lines are stale.** `property.$listingNo.tsx:543,576` are price and badge markup. The estate links are `:484` (JSON-LD `${SITE_URL}/estate/${estate.slug}`), `:517` (breadcrumb `` `/estate/${estate.slug}` ``) and `:863-864` (`<Link params={{ slug: estate.slug }}>`). All three are guarded on `estate` but **not** on `estate.slug`. `transactions.tsx:661` guards `estate?.slug`. `EstateDirectory.tsx:60` uses `encodeURIComponent(estate.slug)`, which yields `"null"` when the slug is null. The audit marks the source as GUESS. | as listed |
| 24 | **The 404 head.** The root `head()` always returns `pageSeo.home.title`/description (`__root.tsx:82-107`). `NotFoundComponent` (`:40-73`) sets no head. Each match carries `status: 'pending'\|'success'\|'error'\|'notFound'` (`router-core/src/Matches.ts:134`), and `head` receives `matches` (`route.ts:1199-1225`). | as listed |
| 25 | **Test wiring.** `src/test-wiring.test.mjs:39-52` fails on any `src/**/*.test.*` that no `test:*` script names. `:86-121` fails on any deterministic `test:*` script missing from `ci.yml`. It does **not** scan `scripts/` or the repo root, so a root `vercel.config.test.mjs` (fix plan name) would be enforced by nobody. CI already runs `test:seo` (`ci.yml:53`), `test:videos` (`:69`), `test:listing-search` (`:97`), `test:estate-conversion` (`:104`), `test:property-experience` (`:120`) and `test:transactions` (`:133`). | as listed |
| 26 | **Existing tests that pin the flag.** `scripts/site-origin.test.mjs:34-58` ("custom-domain redirect is opt-in…") asserts no host rule for `""`/`"false"` and one for `"true"`. It must be rewritten (Task 1). | as listed |

## Global Constraints

- **Never lose an enquiry.** No change in this batch may alter the response to any request under `/api/`, `/_serverFn/` or `/w/` on any host. A config test enumerates every `src/routes/api.*.ts` route and fails if the host redirect matches it.
- **Never redirect a machine POST.** Vercel has no method condition (fact 4), so the exclusion list is the guarantee. Do not add a host rule in app code either. No middleware.
- **Public URLs and slugs stay stable** (fix plan Global constraints). No route is renamed. Every new redirect targets an existing route: `/`, `/listings`, `/contact`, `/blog`, `/mortgage`, `/about`, `/estate/<slug with hasPage>`, or the `/property-detail/$file` resolver. A test proves each target exists.
- **Permanent only when the target is final.** `permanent: true` (308) is for a fixed public page. A hop into a resolver (`/property-detail/:id.html`) and an unknown-estate keyword search use temporary codes (307/302).
- **No new env var, no `VITE_*`.** `CANONICAL_HOST_REDIRECT_ENABLED` is removed from code, tests and docs.
- **No new `test:*` script, no `ci.yml` edit** (keeps clear of #237 and #238, which both append scripts). New test files join existing CI-run scripts.
- **Do not touch `bun.lockb` or `package-lock.json`.** No dependency is added. `path-to-regexp` and `@tanstack/react-router` are already installed.
- **Production is read-only.** Canary checks are `curl -I`/GET. The one POST, to the webhook, is an empty, unsigned request that the handler rejects with 401 before parsing (fact 9). It writes no receipt.
- **Copy:** zh-HK. The only new user-visible text is the 404 title 「找不到頁面｜晉誠地產」 (audit F-22 wording) **[owner copy]** (Open question 5).
- **Every PR passes** `npm run lint`, `npm run typecheck`, `npm run build`, `test:seo`, `test:listing-search`, `test:videos`, `test:transactions`, `test:property-experience`, `test:estate-conversion`, and `test:control-plane` (which runs `src/test-wiring.test.mjs`). Also the admin browser suites in `playwright.admin-owned.config.ts`.

## Review Focus

1. **A host redirect catches a machine caller.** The cases are the WozTell webhook on vercel.app, a drain, a tracked link, a server-function POST from a stale staff tab, `/api` without a slash, or a future API route. *Tests (Task 1):* `host redirect excludes /api/woztell/webhook and /w/abc`; `every API route file is excluded from the host redirect`; `host redirect excludes /_serverFn, bare /api and /.well-known`. *Canary:* `POST https://earnestproperty.vercel.app/api/woztell/webhook` → 401, not 308.
2. **A preview deployment redirects to www,** so a reviewer silently tests production. *Tests (Task 1):* `no host redirect outside production builds`; `host redirect never matches a preview or www host`. *Preview curl:* `/` → 200 with no `location`.
3. **The old-search-code rule catches a real listing** (`B054645` is real, fact 20). *Tests (Task 2):* `real listing numbers are never treated as an old search code`; `old search code is checked only after the listing lookup misses`.
4. **`stripSearchParams` creates a loop or a new 307 chain.** This covers bare URL ↔ defaults ping-pong, internal links still spelling defaults, and `vercel.ts` destinations with defaults. *Tests (Task 3):* `bare /listings renders without redirect`; `explicit defaults collapse to the bare URL in one hop`; `no internal link carries a default search param`; (Task 2) `old /property redirects point at the bare listings URL`.
5. **A legacy redirect points at a page that does not exist, duplicates or contradicts an existing entry, or makes a chain.** *Tests (Task 2):* `every legacy path in the 24h 404 list has a redirect`; `every redirect destination is an existing route`; `legacy redirects have no duplicate sources and no chains`.

## Out of scope / follow-ups

| Follow-up | Owner | Note |
|---|---|---|
| F-05 self-canonical sale/rent/estate facets | FX-16 (only if the owner says yes) | Open question 6. Skipped here. |
| `rel="nofollow"` on rendered `/w/` anchors (audit F-24's second half) | FX-16 | robots `Disallow: /w/` is enough to stop crawling. |
| `src/lib/ai/knowledge.server.ts:330` builds `/estate/${stringOrEmpty(row.slug)}` | after PR #237 merges | #237 rewrites that file. Touching it here would conflict. It yields `/estate/`, not `/estate/null`. |
| Remove `earnestproperty.vercel.app` from `src/content/seo.ts:12` fallback and `src/lib/mls/importer.mjs:103` user agent | FX-19 | Local and test fallbacks only, no production effect. |

---

### Task 1: The canonical-host redirect protects every machine path and never runs on previews

**Files:**
- **Modify `vercel.ts:29-43`.** Replace the flag with:
  ```ts
  const FALLBACK_HOST = "earnestproperty.vercel.app";
  // Machine and browser-runtime paths are never host-redirected: a cross-origin
  // 308 drops Authorization, WozTell may not follow it, and the cron worker
  // refuses it (JOB_DRAIN_REDIRECTED). Vercel cannot match on method.
  export const HOST_REDIRECT_EXCLUDED_PREFIXES = ["api", "_serverFn", "w/", ".well-known"] as const;
  export const HOST_REDIRECT_SOURCE =
    "/((?!api(?:/|$)|_serverFn(?:/|$)|w/|\\.well-known(?:/|$)).*)";
  export function canonicalHostRedirects(env = process.env): VercelRedirect[] {
    if (env.VERCEL_ENV !== "production") return [];
    const resolved = resolveSiteOrigin(env);
    if (!resolved) return [];
    const origin = new URL(resolved);
    if (origin.protocol !== "https:" || origin.host.endsWith(".vercel.app")) return [];
    return [
      redirectEntry(HOST_REDIRECT_SOURCE, `${origin.origin}/$1`, true, {
        has: [{ type: "host", value: FALLBACK_HOST }],
      }),
    ];
  }
  ```
  Keep the literal `type: "host", value: FALLBACK_HOST`, which `legacy-detail.contract.test.mjs:45` pins. Keep the rule first in `redirects` (`:50`).
- **Create `scripts/vercel-config.test.mjs`** and add it to `test:seo` after `scripts/site-origin.test.mjs`. It has a shared helper (fully specified below) that Task 2 reuses.
- **Modify `scripts/site-origin.test.mjs:33-58`.** Replace "custom-domain redirect is opt-in independently of the SEO origin" with `custom-domain redirect follows the production origin, never a vercel.app origin`. Its `redirects(env)` child-process helper passes `{ VERCEL_ENV, VITE_SITE_URL }`. Assertions:
  - `VERCEL_ENV=production` + www → one host rule, destination `https://www.earnestproperty.com/$1`;
  - `VERCEL_ENV=production` + `https://earnestproperty.vercel.app` → `[]`;
  - `VERCEL_ENV=preview` + www → `[]`.
- **Docs (no behaviour):**
  - `.env.example:34-41`: drop "vercel.ts also 301s…" and describe the production-only 308 with its exclusions. Change `:178` to `PROPERTYHK_SYNC_URL=https://www.earnestproperty.com/api/admin/propertyhk-sync`.
  - `docs/woztell-activation.md:32-38`: register `https://www.earnestproperty.com/api/woztell/webhook`, and note that the vercel.app URL keeps working because `/api/*` is never host-redirected.
  - `docs/deployment/property-sync-no-hermes.md:101`: www, plus "add the same origin to `sync_allowed_origins`".

**Interfaces:**
```js
// scripts/vercel-config.test.mjs (helpers, exported for nobody; used inside the file)
// loadRedirects(env) -> VercelRedirect[]  (child process: node --experimental-strip-types
//   --input-type=module -e "import {config} from './vercel.ts'; console.log(JSON.stringify(config.redirects))",
//   env: { PATH, SystemRoot, ...env } -- never inherits CANONICAL_HOST_REDIRECT_ENABLED or VITE_SITE_URL)
// match(redirects, { host, path, query = {} }) -> { status: 307|308, location } | null
//   first redirect whose source compiles (pathToRegexp from "path-to-regexp") and matches `path`,
//   whose every `has` holds (host: new RegExp(`^${value}$`) on host; query: key present and value regex matches),
//   location = destination with $1 / :name / named query captures substituted; status = permanent ? 308 : 307.
// PROD = { VERCEL_ENV: "production", VITE_SITE_URL: "https://www.earnestproperty.com" }
// apiRoutePaths() -> from readdirSync("src/routes") files /^api\..+\.ts$/ (excluding *.test.*):
//   "api.admin.control-plane.jobs.$id.retry.ts" -> "/api/admin/control-plane/jobs/x/retry"
```

**TDD steps:**
- [ ] **Step 1: write failing tests** in `scripts/vercel-config.test.mjs`:
  - `host redirect excludes /api/woztell/webhook and /w/abc` (fix-plan name). With `PROD`, `match(..., { host: "earnestproperty.vercel.app", path })` is `null` for `/api/woztell/webhook`, `/api/admin/whatsapp/service-worker`, `/api/admin/control-plane/worker`, `/api/admin/propertyhk-sync`, `/api/youtube-sync`, `/api/mls-sync`, `/w/abc` and `/w/ABC123`.
  - `host redirect excludes /_serverFn, bare /api and /.well-known`. The paths `/_serverFn/2240abc`, `/api`, `/.well-known/vercel/x` and `/.well-known` give `null`.
  - `every API route file is excluded from the host redirect`. Each path from `apiRoutePaths()` gives `null`. Assert `apiRoutePaths().length >= 25`, so an empty directory read cannot pass vacuously (there are 27 today).
  - `redirects / on the vercel.app host` (fix-plan name). `/` → `{ status: 308, location: "https://www.earnestproperty.com/" }`. `/listings` → `…/listings`. `/estate/bellagio` → `…/estate/bellagio`. `/property/A056377` → `…/property/A056377`. `/wiki` (not `/w/`) → `…/wiki`. `/apidocs` → `…/apidocs`.
  - `host redirect never matches a preview or www host`. With `PROD`, the hosts `earnestproperty-git-fix-fx-13-redirects-team.vercel.app`, `earnestproperty-abc123def-team.vercel.app`, `www.earnestproperty.com` and `earnestproperty.com` on `/` give no **host** rule match (filter to rules with a `host` condition).
  - `no host redirect outside production builds`. `VERCEL_ENV` `preview`, `development` and unset, each with www, give zero rules with a `host` condition.
  - `no host redirect when the production origin is a vercel.app host`. `{ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "earnestproperty.vercel.app" }` → zero host rules.
  - `the opt-in flag is gone`. `readFileSync("vercel.ts")` does not match `/CANONICAL_HOST_REDIRECT_ENABLED/`. `{ ...PROD, CANONICAL_HOST_REDIRECT_ENABLED: "false" }` still yields exactly one host rule.
  - `the host rule is first`. `loadRedirects(PROD)[0].has?.[0]?.type === "host"`.
- [ ] **Step 2: run and see them fail.** `node --test scripts/vercel-config.test.mjs`. Expected: the exclusion and production tests fail, because today's source is `/:path*` and needs the flag.
- [ ] **Step 3: implement** `vercel.ts` as above and rewrite `site-origin.test.mjs:33-58`.
- [ ] **Step 4: run** `npm run test:seo` (now includes the new file) and `npm run test:control-plane`. Expected: all pass. `node --experimental-strip-types -e "import('./vercel.ts').then(m=>console.log(m.config.redirects.length))"` prints the count, with no host rule locally.
- [ ] **Step 5: lint, typecheck, build.** `npm run lint && npm run typecheck && VERCEL_ENV= npm run build`.
- [ ] **Step 6: commit.**
  ```
  fix(seo): canonical host redirect is automatic and never touches /api, /w or server functions

  F-06. Production builds 308 earnestproperty.vercel.app pages to www; the WozTell
  webhook, job drains, Property.hk receiver, tracked links and /_serverFn keep
  answering on vercel.app. Previews never redirect. CANONICAL_HOST_REDIRECT_ENABLED
  is removed.
  ```

### Task 2: Old-site PHP paths and old search codes reach a real page

**Files:**
- **Step 0 (data, before code).** Get the exact paths behind fact 8's gaps. In the Vercel dashboard, open Observability → Logs, production, last 24 h, status 404, and group by path. Ask the owner if no one has dashboard access (Owner action 6). Record these:
  - the exact `.json` and uppercase spellings of `special_prop_st`;
  - the `/eng` seccode path;
  - whether `/special_prop_st.php` (without `/eng`), `/special_prop.php` or `/news_list.php` appear;
  - the query key carrying the listing id on `/special_prop_detail.php` and `/m/property_detail.php`, and 3 sample ids.

  Paste only **paths and counts** into the PR description, never IPs or user agents. **Do not add any path that this export or the audit does not show.**
- **Modify `vercel.ts:84-105`.** Add these after `:105`, in this order:
  ```ts
  // L-04 (audit :150): old-site 404s, 24 h counts in brackets.
  redirectEntry("/info_gallery.php", "/listings", true),            // 707
  redirectEntry("/vr.php", "/listings", true),                      // 52
  redirectEntry("/qrcode_page.php", "/contact", true),              // 590 -- Open question 1
  redirectEntry("/eng/special_prop_st.php", "/listings", true),     // 987 incl. variants
  // + one entry per exact .json / uppercase variant from the step-0 export
  redirectEntry("/seccode_enquiry/seccode.php", "/contact", true),  // 209 incl. /eng
  redirectEntry("/eng/seccode_enquiry/seccode.php", "/contact", true), // only if step 0 shows it
  redirectEntry("/unlucky_detail.php", "/blog", true),              // 64, same target as /unlucky.php
  // Detail pages go through the legacy-id resolver (src/routes/property-detail.$file.ts),
  // temporary because the final page depends on properties.legacy_detail_id.
  redirectEntry("/special_prop_detail.php", "/property-detail/:legacyId.html", false, {
    has: [{ type: "query", key: "id", value: "(?<legacyId>\\d+)" }], // key confirmed in step 0
  }),
  redirectEntry("/special_prop_detail.php", "/listings", true),     // 189 incl. the above
  redirectEntry("/m/property_detail.php", "/property-detail/:legacyId.html", false, {
    has: [{ type: "query", key: "id", value: "(?<legacyId>\\d+)" }],
  }),
  redirectEntry("/m/property_detail.php", "/listings", true),       // 14
  ```
  - Change `:89-96` destinations to `/listings` (c1, c2, bare) and `/listings?deal=rent` (c5). This avoids the 308 → 307 chain after Task 3.
  - Change `:100` `/mortgage.php` → `/mortgage` (Open question 2; the route exists, `src/routes/mortgage.tsx`).
  - Keep `:105` `/tran_trends.php` → `/blog` (Open question 3).
- **Create `src/lib/old-search-code.ts`.** It is pure and imports only `../content/estate-registry.ts`.
- **Modify `src/routes/property.$listingNo.tsx:137-144`.** On the miss branch, before `throw notFound()`:
  ```ts
  if (!property) {
    const legacy = resolveOldSearchCode(params.listingNo);
    if (legacy) throw redirect({ href: legacy.href, statusCode: legacy.status });
  }
  ```
  The `if (!property || …)` notFound check stays as the next statement. The `sold`/`rented`/`offline` paths are untouched.
- **Create `src/lib/old-search-code.test.mjs`** and add it to `test:property-experience`.
- **Modify `src/routes/property.listing-detail.contract.test.mjs`** (already in `test:property-experience`): add one test.
- **Extend `scripts/vercel-config.test.mjs`** (Task 1 file).

**Interfaces:**
```ts
// src/lib/old-search-code.ts
/** Old site search URLs: /property/b<estate name>$ (decoded param, trailing literal "$"). */
export const OLD_SEARCH_CODE: RegExp; // /^b(.{1,40})\$$/u
/** FX-11b public-number grammar; a match is never an old search code. */
export const LISTING_NO_SHAPE: RegExp; // /^(?:EP-?\d{3,8}|[A-Za-z][- ]?\d{6})(?:-R)?$/i
export type OldSearchRedirect = { href: string; status: 301 | 302 };
/**
 * null unless `param` matches OLD_SEARCH_CODE and not LISTING_NO_SHAPE.
 * name = match[1].trim(); empty -> null.
 * Registry entry with hasPage whose nameZh, nameEn or any alias equals name
 * (case-insensitive, NFKC) -> { href: `/estate/${slug}`, status: 301 }.
 * Otherwise -> { href: `/listings?keyword=${encodeURIComponent(name)}`, status: 302 }.
 */
export function resolveOldSearchCode(param: string): OldSearchRedirect | null;
```

**TDD steps:**
- [ ] **Step 1: failing tests.** In `src/lib/old-search-code.test.mjs`:
  - `old search code b<name>$ maps a registry estate to its page`. `b碧堤半島$` → `{ href: "/estate/bellagio", status: 301 }`. `b碧堤$` (alias) → bellagio. `bBellagio$` and `bbellagio$` → bellagio. `b 浪翠園 $` (spaces) → `/estate/sea-crest-villa`.
  - `unknown estate name goes to a keyword search`. `b某某花園$` → `{ href: "/listings?keyword=%E6%9F%90%E6%9F%90%E8%8A%B1%E5%9C%92", status: 302 }`.
  - `real listing numbers are never treated as an old search code`. `A056377`, `B054645`, `B050052`, `b054645`, `C-018613`, `C 018613`, `T029514`, `EP11001`, `EP-1201`, `A056377-R` and `B054645$` all → `null`.
  - `only the trailing-$ shape matches`. `b碧堤半島` → `null`; `b$` → `null`; `b   $` → `null`; `x碧堤$` → `null`; a 41-character name → `null`.
  - `every estate target has a page`. For every registry entry with `hasPage`, `resolveOldSearchCode(\`b${entry.nameZh}$\`)?.href === \`/estate/${entry.slug}\``.

  In `property.listing-detail.contract.test.mjs`:
  - `old search code is checked only after the listing lookup misses`. In the loader source, the index of `resolveOldSearchCode(params.listingNo)` is greater than the index of `fetchPropertyByListingNo(params.listingNo)`, and it sits inside `if (!property)`.

  In `scripts/vercel-config.test.mjs`:
  - `every legacy path in the 24h 404 list has a redirect` (fix-plan name). It uses a constant `LEGACY_404_PATHS` holding the audit's paths (`/info_gallery.php`, `/qrcode_page.php`, `/eng/special_prop_st.php`, `/special_prop_detail.php`, `/seccode_enquiry/seccode.php`, `/unlucky_detail.php`, `/vr.php`, `/m/property_detail.php`) plus the step-0 additions, each with an inline count comment. On host `www.earnestproperty.com`, each path matches a non-host rule. Also, `/special_prop_detail.php?id=6621030` → `{ status: 307, location: "/property-detail/6621030.html" }`, and `/special_prop_detail.php` with no id → `{ status: 308, location: "/listings" }`.
  - `every redirect destination is an existing route`. For every non-host rule, strip the query from the destination. It must be `/`, or a file route present in `src/routeTree.gen.ts` (`/listings`, `/contact`, `/blog`, `/mortgage`, `/about`, `/castle-peak-road/<segment>`), or `/estate/<slug>` with `getEstateEntry(slug).hasPage`, or the `/property-detail/:x.html` resolver.
  - `legacy redirects have no duplicate sources and no chains`. The key `source + JSON.stringify(has ?? [])` is unique. No destination path equals another rule's `source`, except `/property-detail/:oldId.html`, which is an app route and not a vercel rule.
  - `old /property redirects point at the bare listings URL`. No destination contains `deal=all` or `page=1`. `/property/c5` → `/listings?deal=rent`.
  - `mortgage.php reaches the mortgage page`. `/mortgage.php` → `/mortgage`.
- [ ] **Step 2: run, see red.** `node --test src/lib/old-search-code.test.mjs scripts/vercel-config.test.mjs src/routes/property.listing-detail.contract.test.mjs`.
- [ ] **Step 3: implement** the module, the loader branch and the `vercel.ts` entries.
- [ ] **Step 4: green.** `npm run test:seo && npm run test:property-experience && npm run test:control-plane`.
- [ ] **Step 5: commit.**
  ```
  fix(seo): redirect old-site PHP URLs and old /property/b<estate>$ search codes

  L-04. Paths come only from the audit's 24 h 404 list and the Vercel 404 export.
  Detail ids go through the legacy-id resolver; search codes are tried only after
  the listing lookup misses, so real numbers such as B054645 are never caught.
  ```

### Task 3: `/listings`, `/videos` and `/transactions` answer 200 on the bare URL (F-04)

**Files:**
- **Create `src/lib/public-search-defaults.ts`:**
  ```ts
  export const LISTINGS_SEARCH_DEFAULTS = { deal: "all", sort: "newest", page: 1 } as const;
  export const VIDEOS_SEARCH_DEFAULTS = { sort: "newest" } as const;
  export const TRANSACTIONS_SEARCH_DEFAULTS = { dealType: "all", page: 1 } as const;
  ```
- **Modify each route file:**
  - `src/routes/listings.tsx:98-99`: add `search: { middlewares: [stripSearchParams(LISTINGS_SEARCH_DEFAULTS)] },` directly after `validateSearch`, importing `stripSearchParams` from `@tanstack/react-router`.
  - `src/routes/videos.tsx:52`: the same, with `VIDEOS_SEARCH_DEFAULTS`.
  - `src/routes/transactions.tsx:75`: the same, with `TRANSACTIONS_SEARCH_DEFAULTS`.
  - The `searchSchema` declarations stay where they are (fact 18).
- **Rewrite the 28 hrefs (fact 17).** Drop `deal=all&` and `&page=1`. Keep every other key in schema order (`deal, district, …, estate, keyword, agent, sort, page`). For example, `/listings?deal=all&estate=bellagio&page=1` → `/listings?estate=bellagio`, and `castle-peak-road.$segment.tsx:100` → `/listings?district=castle-peak-road`.
- **Create `src/routes/search-defaults.contract.test.mjs`** and add it to `test:listing-search`. **Do not** create a new script.

**Interfaces:**
```js
// src/routes/search-defaults.contract.test.mjs
// schemaFrom(file): slice `const searchSchema = z.object({` .. matching `});` (same anchors as
//   listings.contract.test.mjs:210-211), prepend any consts it references (SORT_OPTIONS,
//   MONTH_PATTERN), transpile with `typescript`, evaluate with { z, fallback }.
// canonicalHref(path, schema, defaults | null): build createRootRoute() + createRoute({ path,
//   validateSearch: zodValidator(schema), search: defaults ? { middlewares: [stripSearchParams(defaults)] } : undefined }),
//   createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [href] }), isServer: true }),
//   return router.buildLocation({ to: pathname, search: true, params: true, hash: true, state: true,
//   _includeValidateSearch: true }).publicHref   // the exact comparison in load-server.ts:913-923
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `precondition: without the middleware, bare /listings canonicalises to ?deal=all&sort=newest&page=1`. This passes today. It proves the harness reproduces the audit's 307.
  - `bare /listings renders without redirect` (fix-plan name). `canonicalHref("/listings", listingsSchema, LISTINGS_SEARCH_DEFAULTS) === "/listings"`.
  - `bare /videos renders without redirect`. → `"/videos"`.
  - `bare /transactions renders without redirect`. → `"/transactions"`.
  - `explicit defaults collapse to the bare URL in one hop`. `/listings?deal=all&page=1` → `/listings`, and `canonicalHref("/listings", …)` → `/listings` (a fixed point, so no loop). The same for `/videos?sort=newest` and `/transactions?dealType=all&page=1`.
  - `non-default filters are kept`. `/listings?deal=sale` → itself. `/listings?estate=bellagio` → itself. `/listings?page=2` → itself. `/transactions?dealType=rent&page=2` → itself. `/videos?sort=oldest` → itself.
  - `each public search route strips its defaults`. A source scan: each of the three route files contains `middlewares: [stripSearchParams(` with its own defaults constant.
  - `no internal link carries a default search param`. Scan `src/content/**/*.ts` and `src/routes/**/*.tsx`, excluding tests, for `/listings?…` and `/transactions?…` literals. None may contain `deal=all`, `dealType=all`, `sort=newest` or `/[?&]page=1(?!\d)/`.
- [ ] **Step 2: red.** `node --test src/routes/search-defaults.contract.test.mjs`.
- [ ] **Step 3: implement** the defaults module, the three middlewares and the 28 href edits. If an existing source-scan test pins one of the old hrefs, update that expectation in the same commit (`grep -rn "deal=all&" src --include=*.test.*` is empty today, fact 17).
- [ ] **Step 4: green.** `npm run test:listing-search && npm run test:videos && npm run test:transactions && npm run test:estate-conversion && npm run test:seo && npm run test:control-plane`.
- [ ] **Step 5: local smoke.** `npm run build && npm run preview`, then:
  - `curl -sI http://localhost:4173/listings` → `HTTP/1.1 200`, no `location`;
  - `curl -sI "http://localhost:4173/listings?deal=all&page=1"` → `307`, `location: /listings`.
- [ ] **Step 6: commit.**
  ```
  fix(seo): bare /listings, /videos and /transactions return 200 instead of 307

  F-04. stripSearchParams removes default search values, so the canonical URL is
  the URL served; internal links and old /property redirects drop the defaults.
  ```

### Task 4: robots disallows `/w/`, the 404 page has its own title, no estate link from an empty slug

**Files:**
- **Modify `src/routes/robots[.]txt.ts:14`.** Add `"Disallow: /w/",` after `"Disallow: /api",`.
- **Modify `src/routes/robots.test.mjs`.** Add one test.
- **Create `src/lib/not-found-head.ts`** (pure) and **`src/lib/not-found-head.test.ts`** (bun). Add the test to the `bun test` half of `test:seo`.
- **Modify `src/routes/__root.tsx:82-107`.** Change to `head: ({ matches }) => isNotFound(matches) ? notFoundHead() : { …current… }`. Keep the current object byte-for-byte in the `else` branch.
- **Create `src/lib/estate-links.ts`** and **`src/lib/estate-links.test.mjs`**. Add the test to `test:estate-conversion`.
- **Modify `src/routes/property.$listingNo.tsx`:**
  - `:478-488`: JSON-LD crumb only when `estatePath(estate?.slug)`;
  - `:517`: breadcrumb item only when `estatePath(estate?.slug)`;
  - `:860-868`: the 「查看屋苑詳情 →」 link only when `estatePath(estate?.slug)`;
  - `:353`, `:380`: `estateSlug: estatePath(estate?.slug) ? estate!.slug : undefined`.
- **Modify `src/components/site/EstateDirectory.tsx:60`.** Skip the card link when `estatePath(estate.slug)` is null.

**Interfaces:**
```ts
// src/lib/not-found-head.ts
export const NOT_FOUND_TITLE = "找不到頁面｜晉誠地產"; // [owner copy], audit F-22
export function isNotFound(matches: ReadonlyArray<{ status?: string }>): boolean; // some status === "notFound"
export function notFoundHead(): { meta: Array<Record<string, string>> };
// -> [{ charSet:"utf-8" }, { name:"viewport", ... } (same as root), { title: NOT_FOUND_TITLE },
//     { name:"robots", content:"noindex" }]  -- no description, og:url or canonical

// src/lib/estate-links.ts
/** "/estate/<slug>" or null for null/undefined/""/whitespace/"null"/"undefined". */
export function estatePath(slug: string | null | undefined): string | null;
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `robots.test.mjs`: `/w/ disallowed` (fix-plan name). `ROBOTS_TXT` source matches `/Disallow: \/w\//`, and the existing four `Disallow` lines still match.
  - `not-found-head.test.ts`:
    - `404 head uses its own title and noindex`: `notFoundHead().meta` contains `{ title: "找不到頁面｜晉誠地產" }` and `{ name: "robots", content: "noindex" }`, and no `og:url`;
    - `only a notFound match switches the head`: `isNotFound([{status:"success"},{status:"notFound"}])` is `true`, and `isNotFound([{status:"success"}])` is `false`.
  - `estate-links.test.mjs`:
    - `estatePath refuses an empty or null slug`: `null`, `undefined`, `""`, `"  "`, `"null"` and `"undefined"` all → `null`; `"bellagio"` → `"/estate/bellagio"`;
    - `the listing page builds estate links only through estatePath`: in `property.$listingNo.tsx` there is no `` `/estate/${estate.slug}` `` and no `` `${SITE_URL}/estate/${estate.slug}` `` outside an `estatePath(` guard, and the `to="/estate/$slug"` link is inside a block that tests `estatePath(`.
- [ ] **Step 2: red.** `node --test src/routes/robots.test.mjs src/lib/estate-links.test.mjs && bun test src/lib/not-found-head.test.ts`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:seo && npm run test:estate-conversion && npm run test:property-experience && npm run test:control-plane`. Then `npm run build && npm run preview`, `curl -s http://localhost:4173/no-such-page | grep -o "<title>[^<]*</title>"` prints `<title>找不到頁面｜晉誠地產</title>`, and `curl -sI` shows `404`. If the title is still the home one, the root match does not carry `notFound` for an unmatched URL in this router version. In that case also check `matches.length === 1 && matches[0].routeId === "__root__" && <router notFound flag>`, and add that case to `isNotFound` with a test before going further.
- [ ] **Step 5: commit.**
  ```
  fix(seo): robots disallows /w/, 404 page has its own title, no /estate/null links

  F-24, F-22, L-05. Estate links on the listing page and estate directory are
  built only from a non-empty slug.
  ```

### Verification (whole batch)

**Suites:** `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:seo`, `npm run test:listing-search`, `npm run test:videos`, `npm run test:transactions`, `npm run test:property-experience`, `npm run test:estate-conversion`, `npm run test:control-plane` (test wiring), and the admin browser suites (`playwright.admin-owned.config.ts`).

**`curl -I` matrix on the Vercel preview.** `P=https://<preview-host>`. If Deployment Protection is on, add `-H "x-vercel-protection-bypass: $VERCEL_BYPASS"`, with the token read from your shell env and never pasted in chat.

| # | Command | Expected |
|---|---|---|
| 1 | `curl -sI $P/` | 200, no `location` (previews never host-redirect) |
| 2 | `curl -sI $P/listings` ; `$P/videos` ; `$P/transactions` | 200 each (F-04) |
| 3 | `curl -sI "$P/listings?deal=all&page=1"` | 307 `location: /listings` |
| 4 | `curl -sI "$P/listings?deal=sale"` | 200 |
| 5 | `curl -sI $P/property` ; `$P/property/c5` | 308 `/listings` ; 308 `/listings?deal=rent` |
| 6 | `curl -sI $P/info_gallery.php` ; `$P/vr.php` | 308 `/listings` |
| 7 | `curl -sI $P/qrcode_page.php` ; `$P/seccode_enquiry/seccode.php` | 308 `/contact` |
| 8 | `curl -sI $P/eng/special_prop_st.php` (+ each step-0 variant) | 308 `/listings` |
| 9 | `curl -sI $P/unlucky_detail.php` ; `$P/mortgage.php` | 308 `/blog` ; 308 `/mortgage` |
| 10 | `curl -sIL --max-redirs 4 "$P/special_prop_detail.php?id=<step-0 sample>"` | 307 → `/property-detail/<id>.html` → 301 → `/property/<no>` or `/listings` → 200 |
| 11 | `curl -sIL --max-redirs 4 "$P/property/b%E7%A2%A7%E5%A0%A4%E5%8D%8A%E5%B3%B6%24"` | ends 200 on `/estate/bellagio` (a 307 for `%24` may precede the 301, fact 19) |
| 12 | `curl -sI $P/property/<a live number from /sitemap.xml>` ; `$P/property/B054645` | 200 or the existing 301/404, **never** `/estate/` or `/listings?keyword=` |
| 13 | `curl -sI $P/estate/null` | 404 |
| 14 | `curl -s $P/robots.txt` | contains `Disallow: /w/` |
| 15 | `curl -s $P/no-such-page \| grep -o "<title>[^<]*"` | `<title>找不到頁面｜晉誠地產` and status 404 |
| 16 | `curl -s -o /dev/null -w "%{http_code}\n" -X POST $P/api/woztell/webhook` | 401 or 503 (preview config), **never 3xx** |
| 17 | `curl -sI $P/w/doesnotexist` | not a redirect to www (today's tracked-link behaviour) |

The host rule itself cannot be exercised on a preview, because Vercel routes by Host. It is proven by `scripts/vercel-config.test.mjs` and by the after-deploy canary.

**After-deploy canary (production, read-only, first 30 minutes, then at 24 h):**

| # | Command | Expected |
|---|---|---|
| C1 | `curl -sI https://earnestproperty.vercel.app/` | 308 `location: https://www.earnestproperty.com/` |
| C2 | `curl -sI "https://earnestproperty.vercel.app/listings?deal=sale"` | 308 to `https://www.earnestproperty.com/listings?deal=sale` |
| C3 | `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://earnestproperty.vercel.app/api/woztell/webhook` | **401** (unsigned, rejected before parsing, nothing stored), never 308 |
| C4 | `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://earnestproperty.vercel.app/api/admin/control-plane/worker` | 401 (no bearer), never 308 |
| C5 | `curl -sI https://earnestproperty.vercel.app/w/doesnotexist` ; `…/_serverFn/x` ; `…/api` | none is a 308 to www |
| C6 | `curl -sI https://www.earnestproperty.com/listings` ; `/videos` ; `/transactions` | 200 |
| C7 | An asset referenced by `https://www.earnestproperty.com/` (`curl -s … \| grep -o '/assets/[^"]*\.js' \| head -1`, then `curl -sI`) | 200, `content-type: …javascript` (2026-09-11 regression check) |
| C8 | `/admin/operations` 「工作程序最後回報」 | under 15 minutes old (drains unaffected) |
| C9 | WozTell sandbox message from the owner's test number | appears in `/admin/whatsapp` within a minute, from whichever webhook host is registered |
| C10 | Vercel logs at 24 h | status-404 count for the L-04 paths near 0; `/listings` 307 count near 0 (was 932/day, audit `:289`); no `JOB_DRAIN_REDIRECTED` and no `[woztell] webhook REJECTED` beyond the C3 probe |

Then update the Status column for F-04, F-06, F-22, F-24, L-04 and L-05 in the audit doc and `CHANGELOG.md`.

**Rollback:**
- Vercel → Deployments → previous production → **Instant Rollback**. This restores the old `vercel.ts` redirects immediately. Then revert the PR.
- Browsers cache 308s for `earnestproperty.vercel.app` pages. That is acceptable because www is already canonical, and no machine path was ever redirected.

## Owner actions before production

**Order:** approve this plan → Owner action 6 (404 export) → Task 2 is finalised → preview curl matrix → merge → canary → Owner actions 1-2 at a quiet hour. **Every code change in this batch is safe before actions 1-3,** because `/api/*`, `/w/*` and `/_serverFn/*` are never host-redirected (Task 1 tests). Actions 1-3 tidy the callers onto the canonical host. They are not safety preconditions.

| # | Action | Steps | Needed before |
|---|---|---|---|
| 1 | **Move the WozTell webhook to www** (optional, recommended) | WozTell console → the company channel → Webhook URL → `https://www.earnestproperty.com/api/woztell/webhook` → Save. Send one message from your test number to the sandbox channel and confirm it appears in `/admin/whatsapp`. **Undo:** put back `https://earnestproperty.vercel.app/api/woztell/webhook`, which keeps working after FX-13. | Nothing. Safe before or after merge. |
| 2 | **`PROPERTYHK_SYNC_URL`** (not a GitHub variable, fact 12) | (a) GitHub → repo Settings → Secrets and variables → Actions: confirm there is **no** `PROPERTYHK_SYNC_URL`. If one exists, set it to `https://www.earnestproperty.com/api/admin/propertyhk-sync`. (b) Wherever an operator runs `scripts/property-sync/sync_propertyhk.py` (Property.hk is disabled today), set the same URL and add `https://www.earnestproperty.com` to `sync_allowed_origins` in that machine's `config.json`. The client refuses redirects and unknown origins, so a stale value fails loudly; it does not fail silently. | Nothing. |
| 3 | **Confirm the worker `SITE_ORIGIN`** | Cloudflare → Workers & Pages → `earnestproperty-cron` → Settings → Variables: `SITE_ORIGIN = https://www.earnestproperty.com` on the **active** deployment, or `npx wrangler deployments list --name earnestproperty-cron` shows a version after the FX-07 merge. Read-only. | Nothing (drains refuse redirects, and `/api` is excluded). |
| 4 | **Neon Auth domain** | Neon Console → Auth → Configuration → Domains lists `https://www.earnestproperty.com`. After the deploy, staff who used vercel.app are sent to www and sign in there once. | Merge |
| 5 | **Vercel env tidy-up** | After the deploy, confirm that `CANONICAL_HOST_REDIRECT_ENABLED` is absent in all environments (it is today, fact 2). Do not add `VITE_SITE_URL`. | After merge |
| 6 | **404 path export** (Task 2 step 0) | Vercel → Observability → Logs → production → last 24 h → status 404 → group by path. Share **paths and counts only**, or grant read-only access. | Task 2 |
| 7 | **Printed QR codes** | Tell us whether any printed material points at `/qrcode_page.php` (Open question 1). | Merge |

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **Where should `/qrcode_page.php` go?** It gets 590 hits a day, at a steady pace, so it is probably a crawler. **Default: 308 → `/contact`.** If printed QR codes use it, tell us their intended landing page, and it becomes a 307 to that page.
2. **`/mortgage.php` currently 308s to `/contact`** (`vercel.ts:100`). Change it to the existing `/mortgage` calculator? **Default: yes.** The target exists and matches the old page's intent. Browsers that cached the old 308 keep `/contact` until their cache clears.
3. **`/tran_trends.php`.** The fix plan says `/transactions`, but today it goes to `/blog` (`vercel.ts:105`) and the transactions page is empty (F-10, D7). **Default: keep `/blog`.** Revisit when 最新成交 has data.
4. **An old search code whose estate is not in the registry.** **Default: a 302 to `/listings?keyword=<name>`** (temporary, because the registry may gain the estate). The alternative is the current 404.
5. **404 title copy [owner copy].** **Default: 「找不到頁面｜晉誠地產」**, the audit's F-22 wording, with `noindex`.
6. **F-05: self-canonical sale/rent and single-estate facets with a matching H1.** **Default: skip**, unless the owner says yes. It would then move to FX-16.
7. **Paths the fix plan lists but the audit's 404 list does not show** (`/special_prop.php`, `/news_list.php`, `/special_prop_st.php` without `/eng`). **Default: add only those the step-0 export shows.**
8. **When to move the WozTell webhook to www.** **Default: after the canary passes, at a quiet hour, with a sandbox test straight away.** It is safe to leave on vercel.app indefinitely.

## Findings that differ from the approved fix plan

1. **The fix plan's three preconditions are not safety preconditions.** With `/api/*` excluded (Task 1 tests), the WozTell webhook, the drains and the Property.hk receiver keep working on vercel.app. The real preconditions are already met (www verified and serving production, fact 3) or need a small owner check (Neon Auth domain, Owner action 4).
2. **`PROPERTYHK_SYNC_URL` is not a GitHub variable.** No workflow uses it. The daily workflow is 28hse-only and writes the database directly. Property.hk is disabled, and its operator client refuses redirects (fact 12).
3. **`CANONICAL_HOST_REDIRECT_ENABLED` is not set in any Vercel environment** (fact 2). `vercel.app` has no redirect today.
4. **"Never redirect a POST" cannot be a Vercel condition.** There is no method matcher (fact 4). The guarantee is path exclusion plus a test that enumerates every `src/routes/api.*.ts`.
5. **The fix plan's source `/((?!api/|w/).*)` is incomplete.** It misses `/_serverFn/*` (server-function POSTs seen in production logs), bare `/api`, and `/.well-known/*` (fact 10).
6. **The host rule is gated on `VERCEL_ENV === "production"`** as well as the exact host, so preview builds generate no host rule at all (Review focus 2).
7. **`/listings?q=` would not work.** The listings search key is `keyword`. `q` is stripped by zod and 307s to the bare page (fact 21).
8. **`/mortgage.php` and `/tran_trends.php` are already redirected** (`vercel.ts:100,105`) to `/contact` and `/blog`. The fix plan's new targets conflict with them (Open questions 2-3).
9. **The fix plan's legacy list differs from the audit's 24 h 404 list.** It adds `/special_prop.php`, `/news_list.php` and a non-`/eng` `special_prop_st.php`, which the audit does not show. It omits `/unlucky_detail.php` (64/day). The audit does not spell out the uppercase or `.json` variants, so they come from a log export, not guesses (fact 8).
10. **`special_prop_detail.php?id=` needs no change to `property-detail.$file.ts`.** A Vercel `has` query capture sends it to the existing resolver, as a temporary 307 because the final page depends on the database.
11. **Real listing numbers start with `B`** (`B054645` in production logs). The `b<estate>$` rule therefore requires the trailing `$`, excludes the FX-11b number grammar, and runs only after the listing lookup misses (fact 20).
12. **F-04 needs more than `stripSearchParams`.** 28 internal hrefs and 8 `vercel.ts` `/property*` destinations spell out `deal=all&page=1`, and would each become a 307 or a 308 → 307 chain (fact 17).
13. **The L-05 line references are stale.** `property.$listingNo.tsx:543,576` are price markup. The estate links are `:484`, `:517` and `:863-864`, and `EstateDirectory.tsx:60` can emit `/estate/null` (fact 23). The true source is still untraced. The guard covers every candidate.
14. **The config test lives at `scripts/vercel-config.test.mjs` in `test:seo`,** not a root `vercel.config.test.mjs`. `src/test-wiring.test.mjs` only scans `src/`, so a root file could silently stop running (fact 25).
15. **`@vercel/config` is not a project dependency.** `vercel.ts` uses its own local types. The types were checked in the main checkout's transitive copy (0.5.3), and the worktree's `node_modules` is a symlink to another worktree that lacks it.
16. **Overlap with open PRs.** #237 (FX-11b) rewrites `src/lib/ai/knowledge.server.ts`, which builds `/estate/${…}` at `:330`, so FX-13 leaves that file alone (follow-up). #237 and #238 (FX-12) both append scripts to `package.json` and lines to `ci.yml`. FX-13 edits only existing script lines and does not touch `ci.yml`, so neither PR blocks it. Whichever merges second rebases trivially.
