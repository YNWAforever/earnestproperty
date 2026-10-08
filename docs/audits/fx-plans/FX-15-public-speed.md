# FX-15: Public site speed. Implementation plan

**Owner decisions:** _pending._ Every default under "Open questions" applies unless the owner says otherwise. **D6 (font) still needs an explicit sign-off on the Task 6 screenshots before Task 6 merges.** Fixed by the brief:
1. **Never lose an enquiry.** Nothing here touches a form, a server function that writes, `/api/*` or `/w/*`. Caching applies only to anonymous `GET` HTML from five public route files, and only when the page loaded successfully.
2. **No migration. No new env var. Two env vars are removed:** `MLS_MEDIA_VARIANTS_ENABLED` (as the fix plan says) and `MEDIA_BACKFILL_TARGET` (replaced by a command-line confirmation, Task 4). No Vercel or Neon project setting is needed: the function region is set in `vercel.ts`.
3. **Cut from `main` (1216ab8d). Never stack on #239 (FX-13) or #241 (FX-14).** This batch's `vercel.ts` hunk is one type field and one `regions:` line, placed away from both PRs' hunks (fact 21).
4. **Copy.** zh-HK. No visible copy changes. Task 6 changes the typeface, which is a **visual change for owner sign-off (D6)**.
5. **Production is read-only** for whoever runs this plan: `curl` GET/HEAD and read-only Vercel MCP only. No deploy, no setting change, no Neon access and no Blob write. The variant backfill (Task 4) is an **owner action**.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- HTML renders next to the database. Functions move from `iad1` (US East) to `sin1` (Singapore), the region of the Neon database (`aws-ap-southeast-1`). Every DB query stops crossing the Pacific (F-01).
- Repeat views of anonymous public pages come from Vercel's CDN. They are fresh for 60 s, and served stale for up to 300 s while the page is regenerated in the background (F-01).
- The first listing card's photo is fetched first instead of lazily (F-03). The footer logo stops being preloaded on every page (F-17).
- Owned listing photos get a `srcset` of 160 to 1280 px WebP variants. The flag is deleted, and existing photos are filled in by a resumable owner-run backfill (F-14).
- The home page stops shipping about 80 KB of unused YouTube descriptions in its loader data. Below-fold sections skip rendering until they are scrolled near, while staying in the SSR HTML (F-11).
- Chinese text uses the visitor's system CJK font. The 1.4 to 1.7 MB of Noto Sans TC web font per page is no longer downloaded (F-02, D6).
- A throttled lab script, `scripts/perf/throttled-lab.mjs`, records before and after numbers. The targets are LCP under 4 s for home, under 4 s for listings and under 3.5 s for a property.

Findings: F-01, F-02, F-03, F-11 (loader data and rendering parts), F-14, F-17.

**Approach.**
- **Task 1 (measure first).** Copy the audit's lab script, make it take URLs from the command line, and add a pure `evaluateTargets()` with a unit test. Record the "before" numbers in the PR before any other commit.
- **Task 2 (region).** Add `regions: ["sin1"]` to `vercel.ts`. This is code, so it reaches previews as well, needs no project setting and reverts with the PR. sin1 beats hkg1 because each page makes 2 to 4 *sequential* DB round trips. The trip from Hong Kong to sin1 happens once per request (fact 3).
- **Task 3 (CDN cache).** A plain-JS helper `publicPageCacheHeaders(ctx)` returns `Vercel-CDN-Cache-Control: max-age=60, stale-while-revalidate=300` only when the route's match succeeded and has loader data. It is used through TanStack Router's per-route `headers` option, on an **allowlist of five route files**: home, listings, property, estate and the castle-peak-road hub and segment. The root route and every admin, auth, account, API and `/w/` route get nothing, so they keep today's `public, max-age=0, must-revalidate`. The browser-facing `Cache-Control` is unchanged, so browsers always revalidate (fact 12).
- **Task 4 (images).** Add a `priority` prop to `ListingCard`/`ListingCardRow`, true for index 0. Give the footer logo `loading="lazy"`, which also removes React 19's automatic `<link rel=preload>` for it. Delete `MLS_MEDIA_VARIANTS_ENABLED` from the two places that read it. Replace the backfill's `MEDIA_BACKFILL_TARGET=staging` gate with `--confirm-db-host=<host>`, which must equal the host in `DATABASE_URL`, and add a total-remaining count to the dry run.
- **Task 5 (home).** Move the `homeVideos` derivation (dedupe and cap at 3) into the loader, and return only the five fields the card uses. Add one `defer-render` utility (`content-visibility: auto; contain-intrinsic-size: auto 900px`) to the sections below 精選樓盤影片. The HTML stays identical, so there is no SEO loss.
- **Task 6 (font, D6).** Drop the `@fontsource-variable/noto-sans-tc` import from `__root.tsx`. Put the system CJK stack first in `--font-sans` and `--font-display`: `"PingFang HK", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC"`. Inter stays self-hosted for Latin.

**Tech stack.** `node --test`, `bun test` and Playwright (`@playwright/test` 1.62, already a devDependency). No new `test:*` script and no `ci.yml` edit (fact 24).

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: F-01 (`:286`), F-02 (`:287`), F-03 (`:288`), F-11 (`:296`), F-14 (`:299`), F-17 (`:302`), measurements (`:316-319`), R-18 (`:501`), executive summary (`:75`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-15 (`:648-665`), Global constraints (`:17-39`), D6 (`:74`), batch table (`:103`).
- The audit's lab script: session scratchpad `lane-f/throttled.mjs` plus the `INIT` observer block from `lane-f/audit.mjs:72-104`. It is not in the repo, so Task 1 copies it in.

## Verified current behaviour (main `1216ab8d`, 2026-10-08 18:00 UTC)

| # | Fact | Where |
|---|---|---|
| 1 | **Functions run in `iad1`. The database is in Singapore.** Every response has `X-Vercel-Id: sin1::iad1::…` (entry PoP, then function region). The production deployment `dpl_3hwufZvSXu18JXopn39528kg2dHz` (commit 1216ab8d) reports `"regions": ["iad1"]` (Vercel MCP `get_deployment`). `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the main checkout's `.env.local` resolve to a Neon host in `ap-southeast-1` (host suffix only, read without printing the value). `docs/reports/2026-09-27-performance-baseline.md:5,29` records the staging branch in `aws-ap-southeast-1`. **Production's DB host is redacted in Vercel, so its region is inferred, not read** (Owner action 1). | live `curl -sI`; Vercel MCP |
| 2 | **"cle1" and "hkg1" in production logs are entry PoPs, not function regions.** Runtime logs carry `region=` per request: `sin1`, `hkg1`, `cle1`, `sfo1` and `iad1` all appear. Request `rfmrl-1791482318071-…` is logged `region=sin1`, while its `X-Vercel-Id` is `sin1::iad1`. So `region` is where the visitor entered, and every function ran in iad1. | Vercel MCP `get_runtime_logs` |
| 3 | **Pages make sequential DB round trips over HTTP.** `db.server.ts:3,15` uses `neon()` (one HTTPS request per query). Home: 8 parallel reads, then `resolveWhatsappLinks`, and `fetchFeaturedProperties` is followed by `attachRemoteVariants` (`index.tsx:101-150`; `public-data.ts:60-63`). Property: `fetchPropertyByListingNo` then 4 parallel reads (`property.$listingNo.tsx:137-192`). Listings: search + estate options, then link resolution (`listings.tsx:101-133`). That is at least 2 to 4 trips per page, each about 220 to 250 ms from iad1 and about 1 to 2 ms from sin1 (same AWS region). From hkg1 each trip is about 30 to 40 ms. | as listed |
| 4 | **No `regions` anywhere in config.** `VercelConfig` is `{ buildCommand; crons; redirects }` (`vercel.ts:19-23`), `config` is `:45-107`. Vercel docs: `regions` in `vercel.ts`/`vercel.json` sets the default function region for the project and overrides the dashboard setting. | `vercel.ts` |
| 5 | **Nothing is edge-cached.** Every public page and `/admin` returns `Cache-Control: public, max-age=0, must-revalidate`, `X-Vercel-Cache: MISS`, `Age: 0`. There is no `Set-Cookie` on `/`, `/listings?…`, `/property/T027001`, `/estate/bellagio` or `/castle-peak-road/ting-kau`. | live `curl -D -` |
| 6 | **Measured TTFB from this machine (entry PoP sin1), 3 runs each:** `/` 2.13 / 1.45 / 1.47 s (total 1.95 to 2.65 s, 347 KB). `/listings?deal=sale&page=1&sort=newest` 1.61 / 0.97 / 0.94 s (142 KB). Bare `/listings` is a 307 to `?deal=all&sort=newest&page=1` in 0.45 to 0.62 s. `/property/T027001` 2.71 / 1.99 / 2.05 s (79 KB). `/estate/bellagio` 1.61 / 1.59 / 1.58 s. | `curl -w` |
| 7 | **Audit lab baseline** (412×823, DPR 1.75, 150 ms RTT, 1.6 Mbps down, CPU ×4): home LCP 6.67 s / TBT 3.26 s (LCP = hero image); listings LCP 12.84 s (LCP = first card's Blob WebP); property LCP 5.94 s (LCP = the `h1`, i.e. text waiting on the web font). CLS ≤ 0.001 on all three. | `lane-f/throttled.json`; audit `:318` |
| 8 | **Public HTML carries no per-visitor data.** Server-rendered public routes never call `getRequest`, `getCookie` or a header reader. The only `getRequest()` outside admin and API code is in staff-only server functions (`staff-notifications.ts:25-43`, `reporting-client.ts:10`). The dehydrated `$_TSR` payload in the three fetched pages has no `csrf`, `session`, `token`, `jwt` or `staff` key. The only WhatsApp number is the company's (`wa.me/85297987774`). `sessionStorage` appears once, as client code. Favourites (`useFavourite`) and the live agent's session id live in browser storage. `PrivateAuthProvider` mounts only on `/admin`, `/auth` and `/account` (`__root.tsx:14,180-187`). | `src/`; fetched HTML |
| 9 | **Tracked CTAs are per listing, not per visitor.** `resolveTrackingLinks` (`whatsapp-enquiries.server.ts:280-330`) maps each listing to its one `website:primary` code, or to the company fallback. Everyone gets the same `/w/<code>` href. `/w/<code>` mints the per-click reference at click time and already sends `no-store` (`noStoreHeaders`, `:332-447`), so it is never cached. | as listed |
| 10 | **TanStack Start supports per-route response headers.** `headers?: (ctx) => Record<string,string>` (`router-core/dist/esm/route.d.ts:351`). It runs server-side with `{ match, matches, params, loaderData }` (`load-server.js:371-393`). Matches' headers are merged root to leaf with `Headers.set` (`start-server-core/createStartHandler.js:14-18`). No route uses it today. Redirect responses do not carry route headers. | `node_modules/@tanstack/*` (router 1.170.41, start 1.168.60) |
| 11 | **Sources of staleness already exceed a few minutes.** Listing status comes from the daily 28hse sync (04:17 HKT, `docs/deployment/property-sync-daily.md:3`) or staff edits. An offline or draft listing throws `notFound()` (`property.$listingNo.tsx:143-145`). Sold or rented listings render an unavailable notice (`:125`). | as listed |
| 12 | **Vercel CDN rules (docs).** `s-maxage` or `Vercel-CDN-Cache-Control` makes a function response cacheable. The cache key includes the full path and query string. Responses with `Set-Cookie` are not cached. `Vercel-CDN-Cache-Control` applies to Vercel's CDN only, so browsers keep `Cache-Control`. `vercel cache purge --type cdn` empties it. **To verify on the preview:** a new deployment does not serve the previous deployment's cached HTML (Task 3 Step 6, row 7). | Vercel MCP `search_vercel_documentation` |
| 13 | **F-03.** `ListingCard` renders `AppImage` with the default `loading="lazy"` (`listings.tsx:1236-1244`), and so does `ListingCardRow` (`:1344-1352`). The grid and list maps are at `:1152-1171`. SSR always renders the grid (`useState("grid")`, `:1033`). `AppImage` passes `fetchPriority` and other extra props through (`AppImage.tsx:28,79`). The fix plan's `:1311-1317,~1394` refer to an older file. | `src/routes/listings.tsx` |
| 14 | **F-17.** The footer logo `<img src={logoSquare} width={800} height={800}>` has no `loading` attribute (`SiteFooter.tsx:21-27`). React 19 therefore emits `<link rel="preload" as="image" href="/assets/logo-earnest-full-….png">` in the head of every public page (seen on `/`, `/listings`, `/property/T027001`). | live HTML |
| 15 | **F-14 flag.** `MLS_MEDIA_VARIANTS_ENABLED` is read in two places. (a) The read path: `attachRemoteVariants` returns rows unchanged unless it is `"true"`, and swallows lookup errors (`remote-variants.server.ts:8,22-25`). All public read models call it (`public-data.ts:32,40-44,61,70,79,90`). (b) The write path: the MLS publish pipeline generates variants with `sharp` while uploading a new owned photo (`mls/media.mjs:1849-1876`), run by the daily sync (`daily-publication.mjs:259`). Tests set the flag at `media.test.mjs:2246-2315`. `.env.example:101-107` documents it with `MLS_OWNED_BLOB_HOSTS` and `MEDIA_BACKFILL_TARGET`. Runbook: `docs/runbooks/final-remediation-rollout.md:56-60`. | as listed |
| 16 | **Turning it on needs a backfill for existing photos.** New uploads get variants in the sync. Existing `media_assets` rows (`owner_type='mls-shared'`) get them only from `scripts/media/backfill-remote-variants.mjs`. That script is dry-run by default, uses `--limit` 1 to 100 and a workspace-relative checkpoint (`lastAssetId`), and is idempotent: a ready set is reused (`remote-variants.mjs:43-52`), and the save is an upsert (`remote-variants-db.mjs:52-68`). Apply **refuses unless `MEDIA_BACKFILL_TARGET === "staging"`** (`:59-65`), so as written it cannot fill production. The dry run reports only the current batch size, not the total. Each photo writes up to 5 WebP files (160/320/640/960/1280 px, never wider than the source) to Blob, plus 2 small DB rows. Tables come from `20260927172000_media_asset_variants.sql` (in `migration-versions.js:106`). Rendering is already wired: `variantSet` + `sizes` on listing cards, home cards and the property gallery, with thumbnails at `sizes="80px"` (`property.$listingNo.tsx:661-670,713-720`). | as listed |
| 17 | **Hotlinked photos get no variants.** Variants exist only for owned Blob assets. The audit's 50 of 258 images from `imgs.property.hk` stay at full size. | audit F-03 |
| 18 | **F-11.** Home HTML is 347 KB. Its largest inline script is 163 KB. In it, `cmsVideos` (full YouTube descriptions, about 80 KB) is passed whole to the client, but only 3 videos and 5 fields are used (`index.tsx:114,159,254-270`). The 134 inline SVGs total 57 KB (`lucide-building2` alone 14 KB). The sections after 精選樓盤影片 start at `index.tsx:452` (`:452,468,486,513,576,601,631,682,705,761`). | fetched HTML; `src/routes/index.tsx` |
| 19 | **F-02 / D6.** `__root.tsx:17-30` imports Inter (4 weights) and `@fontsource-variable/noto-sans-tc/wght.css`, and preloads only Inter Latin 400 (`:114-120`). `styles.css:22-23`: `--font-sans: "Inter", "Noto Sans TC Variable", system-ui, sans-serif`, `--font-display: "Noto Sans TC Variable", "Inter", …`. `styles.test.mjs:32-48` pins the Noto import and both variables, and `:68-87` checks the package's faces. The no-link browser fixture imports Noto itself (`scripts/browser-fixtures/no-link/whatsapp-no-link.tsx:16`, asserted at `scripts/test-whatsapp-no-link-synthetic-browser.mjs:192-196`), **so the package stays a dependency**. **D6 status:** the fix plan's default is "System font first", marked "needs your sign-off" (`:74`). No owner decision is recorded in `docs/`. | as listed |
| 20 | **Previews are behind Vercel Authentication.** The project has `ssoProtection: all_except_custom_domains`. An unauthenticated Playwright context sees a login page on preview URLs. | Vercel MCP `get_project` |
| 21 | **Open PR overlap.** #241 (FX-14) edits `vercel.ts` (import after `:3`, type field after `:20`, `headers:` after `:46`) and the `test:contact`, `test:control-plane`, `test:ratelimit` and `test:job-wake` lines. #239 (FX-13) edits `vercel.ts` `:29-43`, `:52-55`, `:89-105` (it appends before the closing `],` at `:106`); `__root.tsx` (one import near `:35`, `head` at `:80-113`); `listings.tsx` (imports `:5-17`, `search:` middleware after `:100`); `property.$listingNo.tsx` (`:76-80`, loader `:138-143`, `:348-530`, `:858-883`); `scripts/old-site-migration/__tests__/vercel.test.mjs`; and the `test:seo`, `test:listing-search`, `test:estate-conversion` and `test:property-experience` lines. #238 (FX-12) adds 3 `ci.yml` lines and 3 new scripts. #240 (FX-11a) edits `test:crm-analysis`. **None touches** `index.tsx`, `SiteFooter.tsx`, `styles.css`, `styles.test.mjs`, `estate.$slug.tsx`, the castle-peak-road routes, `remote-variants*.{ts,mjs}`, `mls/media.mjs`, `scripts/media/*`, `layout.test.tsx`, `homepage-copy.contract.test.mjs`, or the `test:media`, `test:homepage`, `test:layout` and `test:styles` lines. | `git diff origin/main...origin/<branch>` |
| 22 | **WozTell webhook and cron worker.** `api.woztell.webhook.ts`, the job drains and `api.mls-sync.ts` are Vercel functions, so they move to sin1 with everything else. Each does several DB writes per call, so each gets faster. The Cloudflare Worker (`workers/cron/`) runs on Cloudflare and calls the Vercel host. Only its target region changes. | `src/routes/api.*` |
| 23 | **CJK font on devices.** iOS and macOS ship PingFang HK/TC, Windows ships Microsoft JhengHei, and Android ships Noto Sans CJK (family "Noto Sans CJK TC" or "Noto Sans TC" depending on version). | platform fonts |
| 24 | **Test wiring.** `src/test-wiring.test.mjs:39-52` requires every `src/**/*.test.*` to be in a `test:*` script. `:87-125` requires every deterministic script to be in `ci.yml`. Script-only tests outside `src/` are not policed, but they must still be in a script to run. CI runs `test:media` (`ci.yml:60`), `test:layout` (`:59`), `test:styles` (`:61`), `test:homepage` (`:70`), `test:listing-search` (`:98`) and `test:mls` (`:71`). | as listed |
| 25 | **Plan and cost.** The team plan is not visible to read-only MCP (log retention hints at Hobby). Choosing one function region works on Hobby and Pro. On Pro, function compute in sin1 costs somewhat more per unit than in iad1 (Vercel regional pricing). CDN hits do not invoke functions, so total function time should fall. Blob variant writes count against Blob operation and storage quotas (Task 4, Owner action 5). | Vercel MCP; Vercel pricing docs |

## Global Constraints

- **Never lose an enquiry or lead.** Caching never applies to `POST`, server functions (`/_serverFn/*`), `/api/*` or `/w/*`. Every CTA on a cached page is a `wa.me` link to the company number or a `/w/<code>` link resolved at click time. A cached page of a listing that has since gone offline still leads to the company WhatsApp (fact 9).
- **Never send WhatsApp to the wrong person.** No WhatsApp, link or alert code changes. Caching a page cannot change which number a `/w/` code resolves to.
- **No unauthorised access.** No staff, admin, auth or account route opts into caching. The helper refuses any path under `/admin`, `/auth`, `/account`, `/dashboard`, `/api` or `/w`, even if wired by mistake (Task 3).
- **No migration, no new env var, no `VITE_*`.** Remove `MLS_MEDIA_VARIANTS_ENABLED` and `MEDIA_BACKFILL_TARGET` from code, tests, `.env.example` and the runbook. No `ci.yml` edit. No new `test:*` script. **Do not create `scripts/vercel-config.test.mjs`** (#239) **or `scripts/vercel-headers.*`** (#241).
- **`vercel.ts` hunk is minimal:** one optional type field after `:22` (`redirects: VercelRedirect[];`) and `regions: ["sin1"],` after `:48` (`crons: [],`). Nothing else in that file moves. Do not add `headers` there: that key belongs to #241.
- **Keep hunks small in shared files:** `listings.tsx` (the card `priority` prop, the two maps and one `headers:` line after `errorComponent` at `:202`); `property.$listingNo.tsx` (one import and one `headers:` line directly above `component: PropertyPage` at `:257`); `__root.tsx` (only lines `17-30`, the font import comment block). No other line in these files changes.
- **Do not touch `bun.lockb`, `package-lock.json` or dependencies.** The worktree's `bun.lockb` shows a stray local modification; leave it unstaged. `@fontsource-variable/noto-sans-tc` stays a dependency (fact 19).
- **URLs, slugs and copy unchanged.** The SSR HTML of every page keeps every section, heading, link and JSON-LD block.
- **UI refines the design system.** One new utility in `styles.css` (`defer-render`). No restyling. The font change is D6 only.
- **Production is read-only** (decision 5). No Blob write from an agent.
- **Every PR passes** `npm run lint`, `npm run typecheck`, `npm run build`, `test:media`, `test:mls`, `test:layout`, `test:styles`, `test:homepage`, `test:listing-search`, `test:property-experience`, `test:estate-conversion`, `test:corridor`, `test:seo`, `test:migration`, and the admin browser suites in `playwright.admin-owned.config.ts`. UI tasks attach screenshots at 375 and 1440 px.

## Review Focus

1. **A cached page leaks staff or per-visitor data, or an admin page gets cached.** *Tests (Task 3):* `public-cache refuses admin, auth, account, dashboard, api and w paths`; `only the five allowlisted route files call publicPageCacheHeaders`; `no public route reads the request, cookies or headers during SSR` (source scan of the five route files and `__root.tsx` for `getRequest`, `getCookie` and `getRequestHeader`). *Preview matrix* (Task 3 Step 6): there is no `Set-Cookie` on public pages, `/admin` never shows `X-Vercel-Cache: HIT`, and a signed-in staff member's `/` HTML is byte-identical to an anonymous one apart from asset hashes.
2. **An offline or sold listing stays visible too long, or an error page is cached.** *Tests (Task 3):* `a failed, not-found or loader-less match gets no CDN header`; `property headers are set only when loaderData.property exists`. *Preview:* a listing that does not exist returns 404 with no `Vercel-CDN-Cache-Control`. Owner action 6 covers an emergency purge.
3. **The region move breaks a machine caller** (WozTell webhook, cron drain, mls-sync) or lands somewhere other than sin1. *Test (Task 2):* `vercel.ts pins every function to sin1 and nothing else`. *Post-deploy (Owner action 3):* `X-Vercel-Id` ends `::sin1::…`, a sandbox WozTell message arrives in the inbox, and 「工作程序最後回報」 updates within 10 minutes.
4. **The image changes slow the wrong image or lazy-load the LCP image.** *Tests (Task 4):* `first listing card image is eager with fetchPriority high; the rest stay lazy` (grid and list); `footer logo is lazy and is not preloaded` (render test). *Lab:* listings LCP under 4 s.
5. **Removing the variant flag hides photos or breaks the daily sync.** *Tests (Task 4):* `a variant lookup failure returns the rows unchanged with no flag set`; `publish pipeline writes ready variants with no flag set`; `variant lookup failure leaves the original owned image publishable` (existing, flag removed); `backfill apply refuses unless --confirm-db-host matches DATABASE_URL`.

## Out of scope / follow-ups

| Follow-up | Owner | Note |
|---|---|---|
| Re-host and resize hotlinked `imgs.property.hk` photos (fact 17) | FX-18 or a media batch | Needs rights review (`MLS_MEDIA_RIGHTS_CONFIRMED`). |
| Purge one listing's cached pages on unpublish (`Vercel-Cache-Tag` + `invalidate_by_tags`) | only if Open question 2 asks for under 6 min | Adds a token and an API call on the save path. |
| Sprite or dedupe the 134 inline SVGs (fact 18) | FX-20 | Design-system work. |
| Remove `@fontsource-variable/noto-sans-tc` from `package.json` | FX-19 | Only after the no-link fixture stops importing it; avoids lockfile churn now (fact 19). |
| CJK typography sizes and `tracking-tight` (F-20) | FX-16 | Separate visual pass. |
| `WA_TRACKING_LINK_GAP` warning on every page view (seen in logs) | FX-10 follow-up | Noise only; caching cuts its volume. |
| CrUX field data | owner, after 28 days | PSI quota was exhausted during the audit. |

---

### Task 1: Throttled lab script with before and after targets

**Files:**
- **Create `scripts/perf/throttled-lab.mjs`**, a port of the audit's `lane-f/throttled.mjs` with the `INIT` observer inlined from `lane-f/audit.mjs:72-104`. Changes from the audit copy:
  - `import { chromium } from "@playwright/test";` instead of the hard-coded `createRequire` path.
  - It takes a base URL (`--base=https://…`, default `https://www.earnestproperty.com`) and the paths default to `/`, `/listings?deal=sale&page=1&sort=newest` and `/property/T027001`. `--property=<no>` overrides the listing number.
  - An optional `--share=<url>` is opened first in the same context to pass Vercel Authentication on a preview (fact 20). It is never written to the output.
  - It writes `--out=<file>` (default `.cache/perf/throttled-<UTC stamp>.json`, under the gitignored `.cache/`) and prints a table with `PASS`/`FAIL` per target. It exits 1 when a target fails, so a run can be scripted locally.
  - The same throttling as the audit: 150 ms latency, 1.6 Mbps down, 750 kbps up, CPU ×4, 412×823 at DPR 1.75. It also blocks `/api`, `/w` and `/admin` on the site, non-GET requests, analytics beacons and `wa.me`, so a run creates no leads, clicks or analytics.
  - `--runs=<n>` (default 3) reports the median.
- **Create `scripts/perf/throttled-lab.test.mjs`** and add it to `test:media` (fact 21: no open PR edits that line).

**Interfaces:**
```js
// scripts/perf/throttled-lab.mjs
export const TARGETS = Object.freeze({ home: 4000, listings: 4000, property: 3500 }); // LCP ms
export function parseLabArgs(argv: string[]): {
  base: string; property: string; runs: number; out: string; share: string | null;
};
/** Median LCP per page against TARGETS. Never throws on a missing metric: that page fails. */
export function evaluateTargets(results: Array<{ page: "home" | "listings" | "property"; lcp: number | null }>):
  Array<{ page: string; medianLcp: number | null; target: number; pass: boolean }>;
```
`main()` runs only when the file is executed directly (the `backfill-remote-variants.mjs:133-134` pattern), so the test imports it without launching a browser.

**TDD steps:**
- [ ] **Step 1: failing tests** in `scripts/perf/throttled-lab.test.mjs`:
  - `targets are home 4000, listings 4000, property 3500 ms`.
  - `evaluateTargets takes the median of three runs and fails a page with no LCP`.
  - `parseLabArgs defaults to production and the audit's three pages`, `rejects a non-https base and a runs value outside 1..10`, and `rejects an out path outside the workspace`.
  - `the lab blocks api, w, admin, non-GET and wa.me requests`: export the route predicate `shouldBlock(url, method)` and table-test it.
- [ ] **Step 2: red.** `node --test scripts/perf/throttled-lab.test.mjs` fails because the module does not exist.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:media`.
- [ ] **Step 5: record "before".** `node scripts/perf/throttled-lab.mjs --runs=3` against production. Paste the table into the PR description with the date and the audit's numbers (fact 7) for comparison. Also paste `curl -s -o /dev/null -w "%{time_starttransfer} %{time_total}\n"` ×3 for `/`, `/listings?deal=sale&page=1&sort=newest` and `/property/T027001`, and the `X-Vercel-Id` line.
- [ ] **Step 6: lint.** `npm run lint` (eslint covers `scripts/`).
- [ ] **Step 7: commit.**
  ```
  chore(perf): add the audit's throttled lab script with LCP targets

  scripts/perf/throttled-lab.mjs replays the 2026-10 audit's mobile lab run
  (150 ms, 1.6 Mbps, CPU x4) against any base URL and checks home and
  listings LCP < 4 s and property < 3.5 s. Local only: it hits the network.
  ```

**CI decision:** not wired into CI. It hits a live network and a deployed URL, takes about 1.5 minutes, and its timing varies by runner. Only its pure helpers run in CI (`test:media`).

### Task 2: Functions run in sin1, next to the database (F-01)

**Files:**
- **Modify `vercel.ts`:**
  - after `:22` (`redirects: VercelRedirect[];`): `regions: string[];`
  - after `:48` (`crons: [],`): `// F-01: run next to Neon (aws-ap-southeast-1); see FX-15 fact 3.` and `regions: ["sin1"],`
- **Create `scripts/perf/vercel-region.test.mjs`** and add it to `test:media` next to Task 1's test.

**TDD steps:**
- [ ] **Step 1: failing test** `vercel.ts pins every function to sin1 and nothing else`. A child process `node --experimental-strip-types --input-type=module -e "import {config} from './vercel.ts'; console.log(JSON.stringify({regions: config.regions, fns: config.functions ?? null}))"` (the `scripts/site-origin.test.mjs:34-58` pattern) must deep-equal `{ regions: ["sin1"], fns: null }`. A second assertion: the source has no `functionFailoverRegions`, which would add a setting without need on one region.
- [ ] **Step 2: red.**
- [ ] **Step 3: implement** the two `vercel.ts` lines.
- [ ] **Step 4: green.** `npm run test:media && npm run test:migration && npm run test:seo` (the last two read `vercel.ts`).
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview check.** `curl -sI <preview>/` with the share cookie shows `X-Vercel-Id: <pop>::sin1::…`. Record `curl -w` TTFB ×3 for the three pages.
- [ ] **Step 7: commit.**
  ```
  perf(region): run functions in sin1 next to the Singapore database

  F-01. Every DB query crossed from iad1 to Neon ap-southeast-1 (2-4
  sequential round trips per page). regions in vercel.ts reaches previews
  and reverts with the code; no project setting is needed.
  ```

**Why sin1 and not hkg1.** A Hong Kong visitor enters at the hkg1 PoP either way. To reach a sin1 function costs one hop of about 30 to 40 ms per request. An hkg1 function would pay that hop on **every** DB query instead, and pages make 2 to 4 sequential queries (fact 3). Machine callers (WozTell webhook, drains) make even more. Neon has no Hong Kong region.

### Task 3: Anonymous public HTML is served from the CDN for 60 s, stale up to 300 s

**Files:**
- **Create `src/lib/http/public-cache.js` + `public-cache.d.ts`** (the `.js` + `.d.ts` convention, so `node --test` imports it with no build). FX-14 creates `src/lib/http/bearer-secret.ts` in the same folder; the files do not overlap.
- **Create `src/lib/http/public-cache.test.mjs`** and add it to `test:homepage`.
- **Modify, one `headers:` line each, placed after the existing `head`/`errorComponent` keys and away from FX-13's hunks:**
  - `src/routes/index.tsx` (after the `errorComponent` block, `:162-169`)
  - `src/routes/listings.tsx` (after `errorComponent: ListingsErrorComponent,` `:202`)
  - `src/routes/property.$listingNo.tsx` (directly above `component: PropertyPage,` `:257`; the import goes after the last existing import, not near `:76-80`)
  - `src/routes/estate.$slug.tsx` (above `component: EstatePage,` `:214`)
  - `src/routes/castle-peak-road.index.tsx` (above `component:` `:126`) and `src/routes/castle-peak-road.$segment.tsx` (above `component:` `:81`)
- **Extend existing contract tests (no script change):** `src/routes/listings.contract.test.mjs` (`test:listing-search`), `src/routes/property.listing-detail.contract.test.mjs` (`test:property-experience`), `src/routes/homepage-copy.contract.test.mjs` (`test:homepage`).

**Interfaces:**
```js
// src/lib/http/public-cache.js
export const PUBLIC_CDN_CACHE = "max-age=60, stale-while-revalidate=300";
const PRIVATE_PREFIXES = ["/admin", "/auth", "/account", "/dashboard", "/api", "/w", "/_serverFn"];
/**
 * Route `headers` option for anonymous public pages. Returns the Vercel-only CDN
 * header when the match loaded successfully, otherwise undefined (Vercel's default
 * `public, max-age=0, must-revalidate` stays). Browsers always revalidate.
 * @param {{ match: { status: string; pathname?: string }, loaderData?: unknown }} ctx
 * @param {{ require?: (loaderData: any) => boolean }} [options]
 */
export function publicPageCacheHeaders(ctx, options = {}) {
  const path = ctx.match.pathname ?? "";
  if (PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return undefined;
  if (ctx.match.status !== "success" || ctx.loaderData == null) return undefined;
  if (options.require && !options.require(ctx.loaderData)) return undefined;
  return { "Vercel-CDN-Cache-Control": PUBLIC_CDN_CACHE };
}
```
The property route uses `headers: (ctx) => publicPageCacheHeaders(ctx, { require: (d) => Boolean(d?.property) })`. The others use `headers: publicPageCacheHeaders`.

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `public-cache.test.mjs`:
    - `a successful public match gets max-age=60, stale-while-revalidate=300 on Vercel-CDN-Cache-Control only` (and no `Cache-Control` key);
    - `public-cache refuses admin, auth, account, dashboard, api and w paths` (`/admin`, `/admin/leads`, `/auth/login`, `/account/x`, `/dashboard`, `/api/woztell/webhook`, `/w/abc`, `/_serverFn/x`);
    - `a failed, not-found or loader-less match gets no CDN header` (`status: "error"`, `"notFound"`, `"pending"`, `loaderData: undefined`);
    - `require() can veto caching`.
  - `homepage-copy.contract.test.mjs`:
    - `only the five allowlisted route files call publicPageCacheHeaders`: scan `src/routes/*.tsx` for the identifier; the set equals `index.tsx`, `listings.tsx`, `property.$listingNo.tsx`, `estate.$slug.tsx`, `castle-peak-road.index.tsx`, `castle-peak-road.$segment.tsx`;
    - `__root.tsx has no headers option`;
    - `no public route reads the request, cookies or headers during SSR` (the same six files plus `__root.tsx` contain no `getRequest`, `getCookie`, `getRequestHeader` or `setCookie`).
  - `listings.contract.test.mjs`: `listings route caches through publicPageCacheHeaders`.
  - `property.listing-detail.contract.test.mjs`: `property headers are set only when loaderData.property exists`.
- [ ] **Step 2: red.**
- [ ] **Step 3: implement** the helper and the six `headers:` lines.
- [ ] **Step 4: green.** `npm run test:homepage && npm run test:listing-search && npm run test:property-experience && npm run test:estate-conversion && npm run test:corridor`.
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview curl matrix** (with the share cookie; paste the output in the PR):

  | Row | Request | Expected |
  |---|---|---|
  | 1 | `GET /` twice, 5 s apart | first `X-Vercel-Cache: MISS`, then `HIT`, `Age` > 0; `Cache-Control: public, max-age=0, must-revalidate` |
  | 2 | `GET /listings?deal=sale&page=1&sort=newest`, then `…&page=2` | separate entries (page 2 is `MISS` first) |
  | 3 | `GET /property/<active no>`, `/estate/bellagio`, `/castle-peak-road/ting-kau` | `HIT` on the second request |
  | 4 | `GET /property/ZZZ999999` | 404, no `Vercel-CDN-Cache-Control`, never `HIT` |
  | 5 | `GET /admin`, `/admin/leads`, `/api/…` (any GET), `/w/<code>` | never `HIT`; `/w/` still `no-store` |
  | 6 | every row | no `Set-Cookie` |
  | 7 | a new preview deploy of the same branch | the first `GET /` is `MISS` (no cross-deploy HTML) |
  | 8 | the same `/` signed in as staff and anonymous | identical body (diff is empty) |
- [ ] **Step 7: commit.**
  ```
  perf(cache): serve anonymous public pages from the CDN for 60 s

  F-01. Home, listings, property, estate and castle-peak-road pages send
  Vercel-CDN-Cache-Control: max-age=60, stale-while-revalidate=300 when they
  loaded successfully. Browsers still revalidate every time. Admin, auth,
  API and /w/ responses are untouched.
  ```

### Task 4: Listing photos load in the right order and size (F-03, F-17, F-14)

**Files:**
- **`src/routes/listings.tsx`:**
  - `ListingCard` and `ListingCardRow` get `priority?: boolean`. When true, `AppImage` gets `loading="eager"` and `fetchPriority="high"` (`:1212`, `:1236-1244`, `:1318`, `:1344-1352`).
  - The two maps pass `priority={index === 0}` (`:1154`, `:1164`).
- **`src/components/site/SiteFooter.tsx:21-27`:** add `loading="lazy"` and `decoding="async"`. The `width`/`height` stay, so there is no layout shift.
- **`src/lib/media/remote-variants.server.ts:8`:** drop the flag check (keep `!rows.length`).
- **`src/lib/mls/media.mjs:1849-1855`:** drop `process.env.MLS_MEDIA_VARIANTS_ENABLED === "true" &&`.
- **`src/lib/mls/media.test.mjs:2246-2315`:** remove the flag save and restore. Add `publish pipeline writes ready variants with no flag set`.
- **`scripts/media/backfill-remote-variants.mjs`:**
  - `parseBackfillArgs` accepts `--confirm-db-host=<host>`. Apply requires it to equal `new URL(DATABASE_URL).hostname` exactly, plus `BLOB_READ_WRITE_TOKEN` and `MLS_OWNED_BLOB_HOSTS`. The `MEDIA_BACKFILL_TARGET` check (`:59-65`) is removed.
  - The dry run also prints `remaining` (a `count(*)` with the same `WHERE`) and `estimatedBlobWrites = remaining × 5`.
- **`scripts/media/backfill-remote-variants.test.mjs`:** add the new arg tests.
- **`.env.example:101-107`:** delete the `MLS_MEDIA_VARIANTS_ENABLED` and `MEDIA_BACKFILL_TARGET` entries and their comments. Keep `MLS_OWNED_BLOB_HOSTS` with the comment "Exact owned Vercel Blob hostnames for the variant backfill (`--confirm-db-host` names the target database)".
- **`docs/runbooks/final-remediation-rollout.md:56-60`:** replace the flag and `MEDIA_BACKFILL_TARGET` text with the Owner action 5 procedure.
- **Tests:**
  - `src/routes/listings.contract.test.mjs`: `first listing card image is eager with fetchPriority high; the rest stay lazy`. Extract `ListingCard`, `ListingCardRow` and the two maps from source, and assert `priority={index === 0}` in both maps and the `priority ? "eager" : "lazy"` / `fetchPriority={priority ? "high" : undefined}` wiring.
  - `src/components/layout/layout.test.tsx` (`test:layout`): `footer logo is lazy and is not preloaded`. Render `<SiteFooter />` in a memory router (the `EstateGroupGrid.test.tsx` pattern) with `renderToStaticMarkup`. The logo `img` has `loading="lazy"`, and the markup has no `rel="preload"`.
  - `src/components/media/AppImage.test.tsx` is unchanged.
  - **New `src/lib/media/remote-variants.server-contract.test.mjs`** (in `test:media`), a source scan: `remote-variants.server.ts and mls/media.mjs do not read MLS_MEDIA_VARIANTS_ENABLED`; `.env.example lists neither MLS_MEDIA_VARIANTS_ENABLED nor MEDIA_BACKFILL_TARGET`.
  - `scripts/media/backfill-remote-variants.test.mjs`: `backfill apply refuses unless --confirm-db-host matches DATABASE_URL` (export `assertApplyTarget(databaseUrl, confirmHost)`; mismatch, missing and `postgres://` without host all throw; exact match passes) and `dry run never writes` (the `query` stub sees only `SELECT`).

**TDD steps:**
- [ ] **Step 1: failing tests** as listed.
- [ ] **Step 2: red.** `npm run test:listing-search`, `npm run test:layout`, `npm run test:media`, `npm run test:mls`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green**, the same four scripts.
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview.** `/listings?deal=sale&page=1&sort=newest` at 375 px: the first card's `img` has `loading="eager"` and `fetchpriority="high"`, and the others are `lazy`. The head has no `logo-earnest-full` preload. Variant `srcset` appears only after Owner action 5 has run on the preview's database. Until then the original URL is used, as today.
- [ ] **Step 7: commit** (two commits):
  ```
  perf(images): fetch the first listing photo first; stop preloading the footer logo

  F-03, F-17. The first card (grid or list) is eager with fetchPriority=high.
  The 800x800 footer logo is lazy, which also drops React's automatic
  <link rel=preload> from every page.
  ```
  ```
  perf(media): always serve owned photo variants; delete MLS_MEDIA_VARIANTS_ENABLED

  F-14. Ready variants are attached whenever they exist, and the daily sync
  makes them for new photos. The backfill's MEDIA_BACKFILL_TARGET gate becomes
  --confirm-db-host, so the owner can fill production with a typed host check.
  ```

### Task 5: The home page ships less data and renders below-fold sections lazily (F-11)

**Files:**
- **`src/routes/index.tsx`:**
  - Move the `homeVideos` derivation (`:254-270`) and `dedupeVideosByUrl` into the loader. The loader returns `homeVideos: HomeVideo[]` (at most 3, with only `key`, `title`, `url`, `eyebrow` and `listingNo`) instead of `cmsVideos` (`:114,159,235`). `HomePage` reads `homeVideos`. Render output is unchanged.
  - Add `className="… defer-render"` to the sections from `:452` onward (`:452,468,486,513,576,601,631,682,705,761`). The hero (`:287`), 最新放盤 (`:381`) and 精選樓盤影片 (`:428`) are untouched.
- **`src/styles.css`:** one utility.
  ```css
  /* FX-15 F-11: skip layout and paint for below-fold home sections until they
     near the viewport. Content stays in the SSR HTML (SEO), and `auto` remembers
     the real height after first render, so scrolling does not jump. */
  @utility defer-render {
    content-visibility: auto;
    contain-intrinsic-size: auto 900px;
  }
  ```
- **Create `src/lib/home-videos.js` + `.d.ts`**: the pure `toHomeVideos(featured, cmsVideos, limit)`, moved out of `index.tsx` so `node --test` can run it.
- **Tests:**
  - `src/lib/home-videos.test.mjs` (add to `test:homepage`): `listing walkthroughs come first, then channel videos`, `duplicate YouTube ids are dropped`, `capped at three`, and `each item carries only key, title, url, eyebrow and listingNo` (no `description`).
  - `src/styles.test.mjs` (`test:styles`): `defer-render uses content-visibility auto with a remembered intrinsic size`.
  - `src/routes/homepage-copy.contract.test.mjs`: `the loader returns homeVideos and never cmsVideos` and `hero, 最新放盤 and 精選樓盤影片 sections are not deferred`.

**TDD steps:**
- [ ] **Step 1: failing tests.** **Step 2: red.** **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:homepage && npm run test:styles`.
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview.** Home HTML (uncompressed `curl | wc -c`) drops from 347 KB to under 270 KB. A text diff of the visible text before and after (`curl | sed 's/<[^>]*>//g'`) is empty apart from asset hashes. The lab shows CLS ≤ 0.01. Screenshots at 375 and 1440 px of the full page, scrolled.
- [ ] **Step 7: commit.**
  ```
  perf(home): ship three video cards instead of every channel video; defer below-fold paint

  F-11. The loader returned whole YouTube descriptions (~80 KB) for a section
  that shows three titles. Below-fold sections use content-visibility:auto and
  stay in the server HTML.
  ```

### Task 6: Chinese text uses the system font (F-02, D6, needs sign-off)

**Files:**
- **`src/routes/__root.tsx:17-30`:** delete `import "@fontsource-variable/noto-sans-tc/wght.css";` and rewrite the comment: "Chinese uses the system CJK font (D6). Inter stays self-hosted for Latin." Keep the four Inter imports and the Inter preload (`:114-120`).
- **`src/styles.css:22-23`:**
  ```css
  --font-sans: "Inter", "PingFang HK", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC", system-ui, sans-serif;
  --font-display: "PingFang HK", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC", "Inter", system-ui, sans-serif;
  ```
- **`src/styles.test.mjs:32-48,68-87`:** rewrite the font test as `__root.tsx self-hosts Inter only and preloads its Latin 400 file; Chinese uses the system stack`. It asserts that Inter is imported and preloaded, that there is **no** `noto-sans-tc` import in `__root.tsx`, that both variables start with the stacks above, and that there is no Google Fonts URL. Delete the "variable Noto faces" test: it checked a package the site no longer loads. The no-link fixture keeps its own import.

**TDD steps:**
- [ ] **Step 1: failing test** (the rewritten `styles.test.mjs` case). **Step 2: red.** **Step 3: implement.** **Step 4: green** with `npm run test:styles`.
- [ ] **Step 5: lint, typecheck, build.** Confirm `dist/` has no `noto-sans-tc-*.woff2`: `ls dist/client/assets | grep -c noto` gives 0.
- [ ] **Step 6: screenshots for D6** at 375 and 1440 px: `/`, `/listings`, `/property/T027001`, `/estate/bellagio`, `/contact`. Take them on iPhone Safari (PingFang HK), Windows Chrome (Microsoft JhengHei) and Android Chrome (Noto Sans CJK), before and after. Check headings for weight: system fonts have fewer weights than the variable Noto, so `font-bold` and `font-semibold` may look the same on Windows. Put the screenshots in the PR and ask the owner to approve.
- [ ] **Step 7: commit** (merge only after D6 sign-off).
  ```
  perf(font): use the system Chinese font; stop downloading 1.4-1.7 MB of Noto

  F-02, D6 (owner-approved <date>). PingFang HK / Microsoft JhengHei / Noto
  Sans CJK by platform; Inter stays self-hosted for Latin.
  ```

### Verification (whole batch)

- [ ] `npm run lint && npm run typecheck && npm run build`.
- [ ] `npm run test:media && npm run test:mls && npm run test:layout && npm run test:styles && npm run test:homepage && npm run test:listing-search && npm run test:property-experience && npm run test:estate-conversion && npm run test:corridor && npm run test:seo && npm run test:migration && npm run test:control-plane` (`test:control-plane` runs `src/test-wiring.test.mjs`).
- [ ] The admin browser suites: `npx playwright test --config playwright.admin-owned.config.ts`.
- [ ] **Lab "after" on the preview:** `node scripts/perf/throttled-lab.mjs --base=<preview url> --share=<owner's share link> --runs=3`. The preview reads its own DB, so if it is not production data, `--property=<a no. that exists there>`. Targets: home LCP < 4 s, listings < 4 s, property < 3.5 s. Paste the before and after tables in the PR.
- [ ] **Preview `curl -w` ×3** for the three pages, **first request (MISS) and second (HIT)**, plus `X-Vercel-Id`.
- [ ] Task 3's curl matrix. Task 5's text diff. Task 6's screenshots.
- [ ] **After production deploy:** rerun the lab against production and update the audit Status column for F-01, F-02, F-03, F-11 (partial: SVGs remain), F-14 (after Owner action 5) and F-17. Add a `CHANGELOG.md` entry.

## Owner actions before production

**Order:** approve this plan → D6 sign-off on the Task 6 screenshots → (1) → CI green → preview lab and curl matrix → merge → (2) → (3) → (4) → (5) when convenient. There is **no migration** and no project setting.

| # | Action | Steps | Needed before |
|---|---|---|---|
| 1 | **Confirm the production DB region and the variant tables** (read-only) | In the Neon console, confirm the production project's region is **AWS ap-southeast-1 (Singapore)**. If it is not, stop: Task 2 must name that region instead. Then run the migration readback in the production SQL editor: `SELECT version FROM app_migrations WHERE version LIKE '20260927172000%';` It must return one row. | merge |
| 2 | **Remove the retired variables** | After the deploy is live: delete `MLS_MEDIA_VARIANTS_ENABLED` and `MEDIA_BACKFILL_TARGET` from Vercel (all environments) and from GitHub repository variables and secrets, wherever they exist. Nothing reads them any more. | after deploy |
| 3 | **Post-deploy region and machine-caller check** | `curl -sI https://www.earnestproperty.com/` shows `X-Vercel-Id: …::sin1::…` (not `iad1`). Send one message from your test number to the WozTell **sandbox** channel; it appears in 對話 within a minute. In `/admin/operations`, 「工作程序最後回報」 updates within 10 minutes. **Undo:** revert the PR. With `regions` gone, the project falls back to its old default. | right after deploy |
| 4 | **Canary** | ecc:canary-watch on `/`, `/listings`, a property, an estate and read-only admin views for 30 minutes. Rerun the Task 3 matrix on production. | after deploy |
| 5 | **Backfill photo variants** (production writes, owner only) | On your machine, with production `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` and `MLS_OWNED_BLOB_HOSTS=<the Blob host, e.g. sehe3hq90qgbyxqa.public.blob.vercel-storage.com>`: (a) `node scripts/media/backfill-remote-variants.mjs` (dry run) prints `remaining` and `estimatedBlobWrites`. (b) Check those against your Vercel Blob plan's monthly operation and storage limits on the Usage page. Each photo adds about 0.2 to 0.4 MB across its variants. (c) `node scripts/media/backfill-remote-variants.mjs --apply --limit=50 --confirm-db-host=<host part of DATABASE_URL>`. Repeat. The checkpoint `.cache/media-variant-backfill.json` resumes where it stopped, a rerun skips finished photos, and a failure stops that batch, with its reason, without touching the original photo. If it stops on a source error (unreadable, hash mismatch, invalid or oversized image), rerun with `--skip-failed` and send the skipped IDs to the developer. (d) Finish with one dry run on a fresh checkpoint, `node scripts/media/backfill-remote-variants.mjs --checkpoint=.cache/final-check.json`, and confirm `remaining` is 0 (apart from photos narrower than 160 px and skipped ones). (e) Spot check: a property page's `img` now has a `srcset`. **Undo:** none needed. Pages use the original URL whenever a variant set is missing. | any time after deploy |
| 6 | **Emergency removal of a cached page** | If a listing must vanish before the 6-minute window ends: Vercel dashboard → project → Settings → Caches → Purge CDN Cache, or `vercel cache purge --type cdn`. | as needed |

**Rollback:** revert the PR. It covers region, cache headers, images, home and font together. Revert one commit to roll back one task. The removed env vars do not need restoring: on the old code a missing `MLS_MEDIA_VARIANTS_ENABLED` means "off".

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **D6: system font first?** **Default: yes**, the fix plan's default, after the Task 6 screenshots are approved. If declined, Task 6 changes to two static Noto weights (400 and 700) with `unicode-range` subsetting, which still saves about 60 %.
2. **Is 60 s fresh + 300 s stale acceptable for property status?** **Default: yes, one policy for every public page.** The worst case is that a listing that went offline or sold shows for about 6 minutes. That window is short next to the daily sync (fact 11), and every CTA still reaches the company WhatsApp. A shorter window for `/property/*` (for example 30 + 60 s) needs only a second constant, but it costs more DB load for no lead-safety gain.
3. **sin1 or hkg1?** **Default: sin1** (Task 2 reasoning). hkg1 would make every DB query 30 to 40 ms slower.
4. **`regions` in `vercel.ts` or the dashboard setting?** **Default: `vercel.ts`.** It needs no owner step, reaches previews and reverts with the code.
5. **One PR or two (region first)?** **Default: one PR**, with one commit per task so any task can be reverted alone. Split off Tasks 1-2 as a first PR only if you want to see the region effect on its own in production.
6. **Eager-load more than the first listing card?** **Default: only the first.** On a 375 px phone only one card is above the fold. Desktop's three-column grid gets the other two at normal priority, because they are lazy but already in the viewport.
7. **Wire the lab script into CI?** **Default: no.** It needs the network and a deployed URL, and its timing is noisy on runners. Its pure helpers are tested in CI.

## Findings that differ from the approved fix plan

1. **The function region today is iad1, not cle1 or hkg1.** The `region=` in runtime logs is the visitor's entry PoP (sin1, hkg1, cle1, sfo1, iad1). `X-Vercel-Id` and the deployment's `regions: ["iad1"]` show where functions run (facts 1-2).
2. **The cache header is `Vercel-CDN-Cache-Control`, not `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.** A `stale-while-revalidate` in `Cache-Control` would also let browsers show a stale page, and the Vercel-only header keeps browsers revalidating. It is set per route through TanStack's `headers` option on an allowlist of five route files, not in `vercel.ts`. So it cannot reach admin or API responses, it skips error and 404 pages, and it does not collide with #241's `headers` key (facts 10, 12, 21).
3. **The variant backfill could not fill production as written.** Its apply mode refuses anything but `MEDIA_BACKFILL_TARGET=staging`. Turning the flag on alone would have changed only new photos from the next daily sync. The gate becomes `--confirm-db-host`, which removes a second env var (fact 16).
4. **The footer logo is not preloaded by our code.** React 19 adds a `<link rel=preload>` for every non-lazy SSR image, so `loading="lazy"` fixes both the request and the preload (fact 14).
5. **Most of the home page's loader weight is YouTube descriptions** (about 80 of 119 KB), not listing data. Trimming them is a loader change with identical HTML (fact 18).
6. **Hotlinked photos are not helped by F-14.** Variants exist only for owned Blob assets. Re-hosting is a follow-up (fact 17).
7. **The property page's LCP is the title text, not a photo.** It waits on the Noto web font, so D6 (Task 6) is what moves the property target, more than images (fact 7).
8. **Line numbers moved.** F-03 is `listings.tsx:1236-1244` and `:1344-1352`, not `:1311-1317,~1394`. F-14's gallery is `property.$listingNo.tsx:661-720`, not `:837` (facts 13, 16).
9. **Test locations differ.** `layout.test.tsx` renders `SiteFooter` in a memory router. The region test is `scripts/perf/vercel-region.test.mjs` in `test:media`, because #239 owns `scripts/vercel-config.test.mjs` and #241 owns `scripts/vercel-headers.test.mjs`. The cache helper's test joins `test:homepage`. No new script and no `ci.yml` edit (facts 21, 24).
10. **The Noto package stays a dependency** for now. A browser fixture imports it directly, and removing it would churn both lockfiles under #239 (fact 19).
11. **Previews are behind Vercel Authentication,** so the lab script takes an owner-made share link (`--share`) rather than needing a new bypass secret (fact 20).
