# Earnest Property 晉誠地產 — Frontend Revamp Implementation Plan

**For:** Claude Code, working in `YNWAforever/earnestproperty`
**Source spec:** `EarnestProperty_ChatGPT_Sites_Frontend_Revamp_Claude_Integration_Master_Instruction.md`
**Plan date:** 2026-08-28
**Status:** P0 in progress on `feat/frontend-revamp-p0-baseline`

> This copy was reconciled against a verification pass run at HEAD `0592fd7` (the same
> commit this plan was authored against — no drift, only authorship-time corrections).
> Six factual corrections were folded in during P0 step 6: two undercounted figures
> (§0.1 admin route count, DR-2's admin file count), two citation off-by-ones (a DR-1
> comment line range, DR-1's `corridorWhere` SQL-shape description), one narrowed DR-3
> fix-scope note, and one added DR-5 fix target (`district.sham-tseng.tsx`, which carries
> the actual named-school list the instruction was worried about — `castle-peak-road.ts`
> only ever had generic, already-hedged net-code text). Nothing else changed; the phase
> plan, decisions, and defect diagnoses below are otherwise as originally authored.

---

## 0. Read this before you touch anything

### 0.1 The instruction document is not accurate about this repository

The master instruction was written as a brief for a **ChatGPT Sites prototype**, assuming a mostly-greenfield frontend that Claude would later port in. The actual repo is a mature, ~60k-LOC production application. Several instructions are therefore wrong, already done, or describe things that exist under different names. **The repository is the technical source of truth. This plan is the reconciliation.** Do not follow §5–§8 of the instruction literally.

| Instruction assumes | Reality in the repo |
| --- | --- |
| Next.js-style dynamic routes (`/property/[id]`, `/estate/[slug]`) | **TanStack Start**, flat file routes: `src/routes/property.$listingNo.tsx`, `estate.$slug.tsx`. `.` = path segment, `_` = non-nested, `$` = param. `src/routeTree.gen.ts` is generated — never edit it. |
| Ting Kau lives at `/castle-peak-road/ting-kau` and needs building | Already exists (`castle-peak-road.$segment.tsx`). `/district/ting-kau` already 301s to it, at both the edge (`vercel.ts`) and the router (`district.ting-kau.tsx:14-21`). |
| An admin workspace needs designing | 15 admin routes already ship, including CRM, WhatsApp/Woztell inbox, AI content copilot, AI lead scoring, and a control plane with jobs/migrations/audit. |
| Content versioning must be built | `cms_content_revisions` + full draft/publish/restore/archive logic **already exist and are dead code** — `src/lib/neon/admin-cms.ts` opens with `UNREACHABLE — this module ships in no bundle and is called by nothing`. Wire it up; do not rebuild it. |
| Listing dedup needs a "repository-approved key" | It exists: `canonical_property_no + deal_type` via `buildMatchKey()` in `src/lib/mls/source-contract.mjs`, reconciled through `property_source_links`. The gap is **presentation-side** dedup, not import-side. |
| Frontend must avoid direct DB calls | Already enforced by convention: `x.ts` (`createServerFn` + Zod) → `await import("./x.server")` → SQL. Public routes go through `src/lib/queries.ts`. Follow this, don't invent an adapter layer. |

Two more things the instruction never mentions but which shape everything below:

- **CI is effectively absent.** `.github/workflows/` contains one file, `migration-drift.yml`. No lint, no typecheck, no build, and none of the 25 `test:*` scripts run automatically. `tsc --noEmit` has a **pre-existing error baseline** (CHANGELOG cites 56). A revamp of this size without a CI gate will silently rot.
- **MLS publishing may be shadow-gated.** `docs/mls-production-activation.md` and `workers/mls-container/README.md` indicate `MLS_SCHEDULED_MODE=shadow` / `MLS_PUBLISH_ENABLED=false`. Every "freshness" and "verified" claim in the UI depends on knowing the answer. Confirm before building freshness badges (open input #8).

### 0.2 Decisions already locked by the client (do not re-litigate)

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Repo-executable, prototype-optional.** Implement in the repo now; if an approved ChatGPT Sites version lands, treat it as the visual source of truth for the affected route only. | Each route task has a *Sites reference* slot. Drop screenshots in `docs/sites-reference/<route>.png`. If a reference exists, do a visual-diff review before merging that phase; if not, this plan is authoritative. |
| D2 | **Add all 17 requested estates, keep corridor surfaces narrow.** | All estates get records, pages and search visibility. `corridorRegionScope.outOfScopeTextAliases` in `src/content/castle-peak-road.ts` **stays as it is**. Do NOT reinstate the removed `so-kwun-wat-gold-coast` segment; do NOT reverse its 301. Do NOT implement the instruction's §5.5 six-subarea corridor (小欖/掃管笏/黃金海岸 are deliberately out of corridor scope). Out-of-scope estates surface as 附近選擇 links, never as corridor inventory or homepage 精選. |
| D3 | **Keep forest green `#1F7A4D` as primary; bronze as accent only.** | The brand repaint was deliberate and WCAG-checked. Ignore the instruction's "warm white, charcoal, gold/bronze" as a *replacement* palette; read it as *additive surface + accent* tokens. |
| D4 | **Full spec, phased into sequenced PRs.** | P0–P8 below. Each phase is its own PR into a long-lived integration branch, with a verification gate. |

### 0.3 Hard prohibitions for the whole plan

- No destructive migrations. Every migration is **additive and reversible**; new columns nullable; backfill before anything becomes `NOT NULL`.
- Never touch MLS mode flags, `ops_jobs` leases, or the Cloudflare worker cadence as a side effect of frontend work.
- Never commit secrets. `.env` is currently **tracked in this public repo** (only `VITE_NEON_AUTH_URL`, `NEON_AUTH_BASE_URL`, `WOZTELL_ENABLED` — no secrets today). `.gitignore:38` already ignores `.env*`, so the file is tracked only because it predates that rule: in P0 run `git rm --cached .env`. No `.gitignore` change is needed.
- Never edit `src/routeTree.gen.ts`.
- No invented facts. Prices, transactions, transport times, school data, awards, testimonials: if unverified, **hide the field** — no placeholder, no "待查". A test already forbids testimonials (`src/content/estate-conversion.test.mjs:128`); keep it passing.
- No internal wording in public copy ("Neon", "MLS import", "placeholder", "SEO page", CSV notes).

### 0.4 Branch and PR shape

```
main
 └── feat/frontend-revamp                 ← long-lived integration branch, Vercel preview
      ├── feat/frontend-revamp-p0-baseline
      ├── feat/frontend-revamp-p1-design-system
      ├── … one branch per phase, PR'd into the integration branch
```
Conventional commits with scope: `fix(listings): …`, `feat(estates): …`. Promotion to `main` happens once, at P8, after explicit approval.

---

## 1. Route parity matrix

Every spec route mapped to what exists. **Action** is what P-phase work is required.

| Spec route | Actual route file | State | Action |
| --- | --- | --- | --- |
| `/` | `index.tsx` | Rich; ~12 sections; hero search posts to `/listings` | P3: trim 20–30% length, freshness stamps, zero-data fallbacks, single-primary-CTA per section |
| `/listings` | `listings.tsx` | `deal, district, estate, minPrice, maxPrice, bedrooms, keyword, page` | P3: add `sort`, saleable-area range, mobile drawer, filter chips, save/share/notify, a11y labels, pending+error components |
| `/property/[id]` | `property.$listingNo.tsx` | Full detail page, share, sticky mobile bar, JSON-LD `@graph` | P3: HK-timezone dates (hydration fix), structured description, mortgage summary, viewing form, gallery a11y, withdrawn state |
| `/district/sham-tseng` | `district.sham-tseng.tsx` | Hero, PSF chart, transit, school card, estate grid | P2 (school net) + P4 (rebuild per §5.4, source/as-of stamps) |
| `/castle-peak-road` | `castle-peak-road.index.tsx` | Hub with 2 segment cards, live inventory | P4: corridor map, comparison table, decision guide — **2 segments only** (D2) |
| `/castle-peak-road/ting-kau` | `castle-peak-road.$segment.tsx` | Exists | **P2: fix geographic leakage** + P4 content |
| `/district/ting-kau` | `district.ting-kau.tsx` | 301 → segment | Keep. Verify both edge and router redirect still agree. |
| `/district/tsuen-wan` | `district.tsuen-wan.tsx` | Static, deliberately out of nav/sitemap, **not noindexed** | P7: decide — noindex it or bring it in properly. Don't leave it half-orphaned. |
| `/estate/[slug]` ×5 existing | `estate.$slug.tsx` | 5 DB rows: `bellagio`, `sea-crest-villa`, `hong-kong-garden`, `rhine-garden`, `lido-garden` | P4: template upgrade per §5.9 |
| 17 client-requested estates | — | 5 exist as homepage cards only (`hasPage:false`), 12 don't exist at all | **P4: full build**, blocked on open inputs #2/#3/#5 |
| `/agents`, `/agents/[slug]` | `agents.tsx`, `agents_.$slug.tsx` | Directory + profile, Person/RealEstateAgent JSON-LD | P5: name search, branch/district/estate/language filters, `languages` column |
| `/about` | `about.tsx` | Story, milestones, team preview, branches | P5: dated milestones, verified counts only |
| `/contact` | `contact.tsx` | 3 branch cards, maps, generic form | P5: enquiry type, preferred contact, PICS, split consent, 4 form states |
| `/mortgage` | `mortgage.tsx` + `components/site/MortgageCalculator.tsx` | Works; `price/income/expenses` params | P5: zh-HK ("Affordability" leak), cash-required + stamp duty with effective-date model, scenarios, collapsible amortisation, assumptions + verified date |
| `/transactions` (rename) | `transactions.tsx` | Simple table, self-noindex when empty | P5: rename to 晉誠地產最新成交, filters, source/verification, shareable detail, schema additions |
| `/estate-reviews` | `estate-reviews.tsx` | `articles WHERE category='屋苑開箱'` | P5: filters, zh-HK eyebrows, conditional nav |
| `/videos` | `videos.tsx` | `cms_videos` + listing `video_url`, YouTube sync | P5: category taxonomy, total/filter-total parity, **cap VideoObject JSON-LD to visible items** |
| `/blog`, `/blog/[slug]` | `blog.tsx`, `blog_.$slug.tsx` | DB `articles` + 2-article hardcoded fallback | P5: categories, ToC, reviewer, sources, answer summary; rewrite the 2 thin flagship articles |
| `/privacy`, `/disclaimer`, `/terms` | 3 static routes, each with `TODO(client/legal)` | Template copy | P5: expand + real domain; **legal review is a hard gate** |
| `/admin/*` | 15 routes | See §5 | P6 |
| `sitemap.xml`, `robots.txt` | `sitemap[.]xml.ts`, `public/robots.txt` | Hand-rolled; robots has no disallow rules | P7 |

**Nothing in this matrix may lose a working function.** If a section is removed for length, its function must land somewhere reachable and the removal must be listed in `ROUTE_FUNCTION_PARITY.md`.

---

## 2. Defect register — root causes located

These are the instruction's §6 "known production issues", root-caused to exact locations. Each has a test requirement.

### DR-1 — Ting Kau geographic leakage (highest business risk)
**Root cause, two parts.**
1. `src/lib/queries.ts:269-281` `fetchCorridorInventoryForAliases()` calls `fetchNeonCorridorInventory` with **no region guard**. `isWithinCorridorRegion()` is applied at only two sites — `queries.ts:90` (`fetchEstatesByDistrict`) and `:153` (`fetchFeaturedProperties`) — i.e. the homepage and 深井 district page. The corridor hub and *every segment page, including Ting Kau*, use the unguarded path. Underlying SQL `corridorWhere` (`src/lib/neon/public-data.server.ts:360-391`) is a status-gated OR of district-slug / estate-slug / free-text LIKE (`p.status = 'active' AND (...)`; the text branch is an `EXISTS`/`unnest` LIKE, not a bare LIKE) — the guard that's actually missing is the region check, not row status.
2. `src/content/castle-peak-road.ts:115` — `ting-kau.districtSlugs` includes the catch-all `"castle-peak-road"`, which `src/lib/mls/normalize-old-site.mjs:24-29` assigns to *anything* mentioning 青山公路 that didn't match a more specific district — a road that runs to 屯門. Both segments share that bucket, so Ting Kau and 深井 show partly identical stock. (`yau-kom-tau` in the same array is never assigned by the normalizer — dead filter.)

**Fix.** Split each segment's aliases into `strict*` (primary result set) and `nearby*` (a separately labelled 附近選擇 block). Remove `"castle-peak-road"` and `"yau-kom-tau"` from Ting Kau's strict set. Apply `isWithinCorridorRegion()` inside `fetchCorridorInventoryForAliases`. Keep the existing deliberate exclusion of `tsuen-wan` (see the comment at `castle-peak-road.ts:111-114` — the previous author already reasoned about this).
**Test.** Extend `src/content/castle-peak-road.test.mjs` + a new `src/lib/neon/corridor-scope.contract.test.mjs`: given fixture listings in 掃管笏 / 黃金海岸 / 大欖涌 / 屯門, the Ting Kau strict result set contains none of them; the nearby block may.

### DR-2 — Hydration / date mismatch
**Root cause.** Display dates use `Intl`/`toLocaleDateString("zh-HK")` with **no `timeZone`**, so SSR (Vercel = UTC) and client (UTC+8) disagree for any timestamp before 08:00 HKT. Confirmed on public routes at `property.$listingNo.tsx:328-329` and `:645`, `listings.tsx:401`, `transactions.tsx:140`, plus 11 admin files (`admin.blasts.tsx`, `admin.cms.tsx`, `admin.leads.tsx`, `admin.leads_.command-center.tsx`, `admin.whatsapp.tsx`, `AdminOperationsAudit.tsx`, `AdminOperationsJobs.tsx`, `AdminTeamDetailPanel.tsx`, `AdminTeamMemberCard.tsx`, `AdminTeamTable.tsx`, `admin-team-route-utils.ts`).
**Fix.** One shared `src/lib/format.ts` (P1) with `timeZone: "Asia/Hong_Kong"` pinned; replace every call site.
**Test.** `src/lib/format.test.ts` (bun) for the formatters, plus a source-scan test that fails on any `toLocaleDateString(`/`DateTimeFormat(` in `src/` without an explicit `timeZone`.

### DR-3 — Duplicate / withdrawn listing presentation
**Root cause.** Import-side identity is solid (`canonical_property_no + deal_type`); the render paths don't dedupe. Related-listing and estate-listing queries can surface the same unit twice under two `listing_no`s.
**Fix.** A `dedupeListings(rows)` helper keyed on `canonical_property_no + deal_type` (fall back to `listing_no` when canonical is null), applied in `searchListings`, `fetchSimilarListings`, `fetchListingsForEstate`, `fetchCorridorInventoryForAliases`. `status = 'active'` is already enforced in `searchListings`, `fetchListingsForEstate` and `fetchSimilarListings` today — confirm it's also applied on the `fetchCorridorInventoryForAliases` path (the DR-1 function) rather than auditing all four from scratch.
**Test.** `src/lib/neon/listing-search.contract.test.mjs` additions.

### DR-4 — Malformed imported text in body and metadata
**Fix.** `sanitizeListingText()` in `src/lib/format.ts`: strip control chars, collapse whitespace, drop CSV artefacts, return `null` for empty. Apply before render **and** before `head()` metadata. Suppress `- 房`, `NaN`, `null`, `$0` — the CHANGELOG shows this class of bug was already hit once on estate figures.

### DR-5 — School-net accuracy
**Established:** 荃灣區 is school net **62**, and 深井天主教小學 sits in it — the district-level attribution is not the error. What must not be published unverified is **the named school list and any per-address claim**.

The named list currently lives in **`src/routes/district.sham-tseng.tsx:98-104`** (a hardcoded `SCHOOLS` array including 深井天主教小學, 陳瑞祺（喇沙）小學（深井）, etc.) — not in `castle-peak-road.ts`, which only ever carries generic, already-hedged text ("62 校網。實際派位及校網資料以教育局最新公布為準。"). `castle-peak-road.test.mjs:341` only regex-checks that generic net-code text is present (`/school net 62|62 校網/`); it does not assert anything about named schools. **DR-5's fix must touch `district.sham-tseng.tsx`, not just `castle-peak-road.ts`** — that's where the actual unverified per-school claim ships today.

**Fix.** New `src/content/school-nets.ts`: `{ netCode, districtLabel, primarySchools[], source, sourceUrl, verifiedOn, admissionYear }`. Populate `primarySchools` **only** from the Education Bureau's current 《小一入學統一派位選校名冊》/學校網名冊 (open input #6) — no property-portal or blog sources. Render through a `DataNote` component that always shows source + as-of date + the caveat that actual net depends on the property address and the EDB list for the relevant admission year. Replace the hardcoded `SCHOOLS` array in `district.sham-tseng.tsx:98-104` with this component. Update the net-code assertion at `castle-peak-road.test.mjs:341` and add a new assertion (in a `district.sham-tseng.test.mjs` or similar) that the school page never renders a named school without a source.
**If the EDB list is not supplied, ship the caveat and the net code, and omit the school list.** Do not carry the current five names forward on trust.

### DR-6 — Excessive structured data
`videos.tsx:441` emits a `VideoObject` per video for the **whole unpaged set**. Cap to the rendered page (≤24) and to items with a real thumbnail/duration.

### DR-7 — Accessibility
Fix at minimum: deal-type filter is 3 bare buttons with an unassociated `<Label>` and no `aria-pressed`/`radiogroup` (`listings.tsx:279-296`); price inputs labelled by placeholder only (`:298-320`); select filters where the visible label and accessible name are disconnected (`:328-376`); article cover marked `alt=""` (`estate-reviews.tsx:125`); estate listing image with no `width`/`height`/`loading` (`estate.$slug.tsx:345-349`); mega-menu never returns focus to its trigger (`SiteHeader.tsx:307-326`, `:361-391`); gallery active thumb signalled by colour only (`property.$listingNo.tsx:484-500`); hardcoded English accessible names in a zh-HK UI (`LiveAgentWidget.tsx:155-259`, `ui/sheet.tsx:66`); mobile nav trigger `aria-label` never reflects expanded state (`SiteHeader.tsx:416-427`).
**Preserve the good pattern:** the codebase has **no** nested-interactive bugs — shadcn `Button asChild` → Radix `Slot` is used consistently. Don't regress it.

### DR-8 — English labels in the zh-HK interface
Two different problems, don't treat them as one:
- **Three stray eyebrow labels** sitting directly above correct Chinese headings: `estate-reviews.tsx:63` "Review Articles", `:94` "Estate Pages", `CorridorInventory.tsx:159` "Live Listings". Small fixes.
- **`MortgageCalculator.tsx` is not localised at all.** Of 611 lines, Chinese appears on exactly one (`:280`, the `<h1>香港按揭計算機</h1>`). Every field label in `INPUT_LABELS` (`:41-49`) — Property price, Loan-to-value ratio, Mortgage term, Annual interest rate, Monthly income, Existing monthly debt expenses — plus the section heading "Affordability" (`:390`), its subtitle (`:393`) and the results heading "Your estimate" are English. This is a full component translation, scheduled in P5, not a one-line fix.

(Deliberate bilingual branding like `青山公路 Castle Peak Road` stays.)

### DR-9 — Empty / thin routes in primary navigation
`/transactions` and `/estate-reviews` already self-`noindex` and are conditionally sitemapped. Extend to nav: a nav item for an empty collection must fall back or disappear. `/district/tsuen-wan` is the inverse problem — crawlable but orphaned.

### DR-10 — Unreachable and drifting code
- `src/lib/neon/admin-cms.ts` — full revision workflow, imported by nothing. **P6 wires it in.**
- `updateAdminInquiryStatus` (wrapper at `src/lib/neon/admin-data.ts:669`, SQL impl `updateInquiryStatus` at `admin-data.server.ts:3213`) is staff-gated and works, but **no route calls it and no list function exists** — website enquiries are effectively invisible in admin. **P6 fixes.**
- `api.admin.ai.rebuild-knowledge.ts` is called by nothing.
- `estates.seo_title` / `seo_description` are admin-editable but the public page reads `src/content/seo.ts` instead — likely dead columns. Resolve in P4, don't build on them blindly.
- CMS estate INSERT omits `avg_saleable_psf`, `lat`, `lng` — CMS-created estates can never get a map or PSF.
- Estate identity is defined in **four** unsynced places (`estates` table, `core-estates.ts`, `estateSeo`, `estatePageContent`) plus `ESTATE_DB_SLUG_FALLBACKS` in `queries.ts:24-27`. P4 collapses this.
- `CLAUDE.md` claims only four modules define server functions; `admin-team.ts` defines seven more. Fix the doc in P0.

---

## 3. Phases

Each phase: **Goal → Work → Acceptance → Verify**. `Verify` lists real scripts from `package.json`.

### P0 — Baseline, guardrails and CI (blocks everything)

**Goal.** Know what "green" means today, and make it impossible to regress silently.

**Work.**
1. Record the baseline in `docs/superpowers/reports/2026-08-28-revamp-baseline.md`: output of `npx tsc --noEmit` (count and file distribution — CHANGELOG says ~56), `npm run lint`, `npm run build`, and every `test:*` script except the `:db` integration ones. Note which failures are pre-existing.
2. Add `.github/workflows/ci.yml` on PR + push: `npm ci` → `npm run lint` → typecheck with a **ratchet** (fail if the error count exceeds the recorded baseline) → `npm run build` → the full non-`:db` `test:*` matrix. Keep `migration-drift.yml` as is.
3. Add `"typecheck": "tsc --noEmit"` to `package.json` (it does not exist today).
4. Add `eslint-plugin-jsx-a11y` at `warn` in `eslint.config.js`; promote to `error` at the end of P7.
5. `git rm --cached .env` (already covered by `.gitignore:38`'s `.env*`; the file simply predates it).
6. Create the integration branch. Copy this plan to `docs/superpowers/plans/2026-08-28-frontend-revamp.md`.
7. Correct `CLAUDE.md`: `admin-team.ts` also defines server functions.

**Acceptance.** CI runs on a throwaway PR and reproduces the baseline exactly. No behaviour change ships in P0.
**Verify.** `npm run lint && npm run typecheck && npm run build`; CI green on the baseline.

---

### P1 — Design-system foundation (blocks all visual work)

**Goal.** Stop hand-repeating layout, formatting and image markup in 79 route files. There is currently **no** `Container`/`Section`/`Heading` primitive anywhere.

**Work.**
1. `src/components/layout/`: `Container`, `Section`, `SectionHeading` (eyebrow + h2 + optional action), `Prose`, `Stat`, `EmptyState`, `DataNote` (source + as-of + caveat), `FreshnessStamp`, `VerificationBadge`, `SkeletonBlock`. Every one zh-HK by default.
2. **`src/lib/format.ts`** — the single formatting module (fixes DR-2, DR-4): `formatHkd`, `formatManDisplay` (萬 in *display only*, never stored), `formatArea`, `formatPsf` (returns `null` when area is missing/zero — never divide by zero), `formatHkDate`, `formatHkDateTime`, `formatFreshness`, `sanitizeListingText`. All dates pin `timeZone: "Asia/Hong_Kong"`. Replace the duplicated inline formatters at `property.$listingNo.tsx:85,173,179-184,328-329,428,645`, `listings.tsx:396,399,401`, `transactions.tsx:140,147-152`, `index.tsx:898`, `CorridorInventory.tsx:11-16`, and align `MortgageCalculator.tsx:51-59` onto it.
3. `src/components/media/AppImage.tsx`: required `width`/`height`, `sizes`/`srcSet` where the source supports it, `loading` (`eager` only for the LCP candidate), `decoding="async"`, and a branded missing-image fallback. Replace every raw `<img>` on public routes.
4. Tokens in `src/styles.css` (D3): keep `--brand-primary: #1F7A4D` and its scale; add `--surface-warm` (warm white), `--ink-charcoal`, `--brand-accent-bronze`. Add `.tabular-nums` for prices/areas/mortgage output. Retire the `--coral`/`text-coral` aliases now that eyebrows are being rewritten (DR-8). Verify every new pair at WCAG AA and record the ratios in the token comments, as the existing file already does.
5. Type scale: `--font-display` (Noto Sans TC first) stays. Fix the homepage 買樓租樓 headline break with `text-wrap: balance` plus an explicit non-breaking span — not a hard `<br>`. Self-host or `<link rel="preload">` the two font families; today they load from the Google CDN with no preload.
6. Contract-test the primitives: `src/components/layout/layout.test.tsx` (bun). Add `"test:format"` and `"test:layout"` scripts.

**Acceptance.** No public route formats a date, price, area or PSF inline. Zero raw `<img>` on public routes. Source-scan test for un-timezoned date formatting passes. Contrast documented.
**Verify.** `npm run test:format && npm run test:layout && npm run test:seo && npm run test:homepage && npm run test:property-experience`.

---

### P2 — Data trust (the fixes that protect credibility)

**Goal.** Land DR-1 through DR-6 and DR-8. Highest value per line of code in the whole plan; do it before adding features.

**Work.** DR-1 corridor scope split + region guard + tests. DR-3 `dedupeListings` + `status='active'` on the corridor path. DR-4 sanitisation in body and metadata. DR-5 `school-nets.ts` + `DataNote`, applied to **both** `castle-peak-road.ts` and `district.sham-tseng.tsx` (list omitted unless EDB-sourced). DR-6 JSON-LD caps. DR-8 four label fixes plus the Sheet/LiveAgent aria strings. Extend `src/lib/faq.ts`'s existing `renderableFaqs` guard to every FAQ surface.

**Acceptance.** Ting Kau strict set contains no 掃管笏/黃金海岸/大欖涌/屯門 stock. No duplicate unit on any listing surface. No `- 房`, `NaN`, `null`, `$0`, or raw CSV text on any page. Every market/transport/school claim renders with source + as-of date or is hidden.
**Verify.** `npm run test:corridor && npm run test:listing-search && npm run test:seo && npm run test:estate-conversion && npm run test:mls`.

---

### P3 — Search and property detail

**Goal.** The core buyer journey: search → compare → contact.

**Work.**
1. `/listings`: add `sort` (`newest | price_asc | price_desc | area | psf`) to the Zod search schema, the `ListingFilters` type (`queries.ts:189-199`) and `listingWhere`/ORDER BY (`public-data.server.ts:255-285`, `:458`) — sort is hardcoded server-side today. Add saleable-area min/max. Mobile filter drawer (`ui/sheet`), desktop panel, active-filter chips with individual clear, result count, grid/list toggle. Fix the three a11y defects (DR-7). Add `pendingComponent` skeletons and an `errorComponent` (`/listings` has neither). Share action on cards. Keep the deliberate "price bounds dropped when `deal=all`" guard but **tell the user** instead of silently dropping.
2. Save / 心水: `localStorage`-backed favourites and saved searches (anonymous, no account system exists). New table only for **notify-me**: `listing_alerts` (filter JSON, contact, consent text + version + timestamp, source/UTM, status). Zero-results state offers it.
3. `/property/$listingNo`: HK-timezone dates via P1; structured description (paragraph/feature split) instead of raw import; verification + update stamp; mortgage affordability summary for sale listings reusing `src/lib/mortgage.ts`; estate summary card linking to the estate page; nearby transport; **structured request-viewing form** (preferred date + time band + contact method) replacing the generic enquiry, writing through `createWebsiteInquiry` with an explicit intent; gallery a11y (`aria-current`, arrow-key nav); related listings deduped; withdrawn / temporarily-unavailable states beside the existing 404; keep the sticky mobile bar.
4. Homepage: cut 20–30% of length per §5.1 by removing repeated trust/company/branch/CTA blocks; one primary CTA per section; freshness on listing cards; `EmptyState` instead of empty KPI cards. Log every removal in `ROUTE_FUNCTION_PARITY.md`.
5. Map mode: **only** if `properties` gains real coordinates (it has none today — `estates` has `lat/lng`). Otherwise defer and say so; do not fake pins from estate centroids.

**Acceptance.** Every filter has a visible label and an accessible name. Sort works and is shareable via URL. Zero-results always offers a next action. Property detail renders with no console error or hydration warning at 375px and 1440px.
**Verify.** `npm run test:listing-search && npm run test:property-experience && npm run test:format`; manual 375/430/768/1024/1440 pass; `tsc --noEmit` ratchet holds.

---

### P4 — Areas, corridor, and the 17-estate expansion

**Goal.** One authoritative estate registry, and the client's estates live.

**Work.**
1. **Collapse the four-way estate drift (DR-10).** New `src/content/estate-registry.ts` as the single source for slug, zh/en name, aliases, district, corridor membership, branch, `hasPage`, photo. `core-estates.ts`, `estateSeo`, `estatePageContent` and `queries.ts`'s `ESTATE_DB_SLUG_FALLBACKS` all derive from it. Contract-test that DB slugs and registry slugs cannot diverge.
2. **Migration** `neon/migrations/<ts>_estate_expansion.sql`: `districts` table + `estates.district_id` (nullable, backfilled from `district_slug`, both kept); `estates.aliases TEXT[]`, `address`, `blocks`, `school_net_code`, `verified_at`, `transport_note`; insert the 17 estates with `published = false`. Resolve whether `estates.seo_title/description` are live or dead and either wire them or drop them from the CMS form.
3. **17 estates** (open inputs #2/#3/#5). 深井／汀九 (5): 海雲軒、帝華軒、海韻台、縉皇居、龍騰閣. 青山公路 (12): 滿名山、黃金海岸、愛琴海岸、帝御、黃金海灣、星堤、上源、The Carmel、Oma Oma、漣山、浪濤灣、帝濤灣. The spec lists 「其他」 once per group; those are the two filter/category landing states below, not estates — count them as 17 records, not 19. Per estate: DB row → registry entry → `estateSeo` → `estatePageContent` → photo in `public/estates/<slug>.jpg` (lowercase — the FS is case-sensitive) → branch mapping in `site-branches.js`. **Publish gate: verified facts + a real photo. No photo or no facts → stays `published = false`.** `其他` is a filter/category landing state, never a detail page. Slugs are permanent URLs — do not invent them (open input #2). Three estates (帝華軒、海韻台、龍騰閣) have unknown districts and must not be guessed.
4. **Per D2:** the 青山公路 group gets pages and appears in `/listings` and estate search, but stays out of `corridorRegionScope` and homepage 精選. Their pages link to 附近選擇 rather than claiming corridor membership.
5. Estate template per §5.9: verified facts block, layouts, live sale/rent, transactions + PSF trend (source + as-of), transport, school-net qualification via `school-nets.ts`, balanced strengths/trade-offs, **comparison with two nearby estates**, estate video/article links, covering agents, FAQ + enquiry. Empty transaction block → `EmptyState`, never a zero.
6. `/district/sham-tseng` rebuild per §5.4 (including replacing the hardcoded `SCHOOLS` array per DR-5); `/castle-peak-road` hub per §5.5 **restricted to the two in-scope segments** — corridor map, area comparison table, commute summary, estate directory, inventory counts with explicit geographic scope, price snapshot with source/date, 「邊個區適合我？」 decision guide. Ting Kau page per §5.6 with the DR-1 fix and a labelled 附近選擇 block.
7. Redirects for any new or changed slug in `vercel.ts`. Add the new estates to `sitemap[.]xml.ts` **only when published**.

**Acceptance.** No estate appears on a public surface with an unverified fact or a missing photo. Registry and DB agree. Corridor scope unchanged. Every new URL either resolves or 301s.
**Verify.** `npm run test:estate-conversion && npm run test:corridor && npm run test:seo`; crawl every `/estate/<slug>` for 200/301/404 as intended.

---

### P5 — Transactions, content, agents, forms, legal

**Work.**
1. **Rename 成交快訊 → 晉誠地產最新成交** at all six runtime occurrences across four files: `index.tsx:439`, `transactions.tsx:19,23,46`, `SiteFooter.tsx:159`, `SiteHeader.tsx:126`; update `src/config/site.test.mjs:217,311`. A repo-wide grep for 成交快訊 must return only doc/plan files afterwards.
2. **Transactions.** Migration: `transactions.source`, `source_url`, `verification_state`, `verified_at`, `agent_id`, `published`, `block`, `floor_band`, `social_state`. Page: filters (estate, district, month, deal type, price range), columns per §5.15, source + verification date, shareable detail (`/transactions/$id` or `?tx=`), related estate/listing links, `EmptyState` that links out rather than looking populated. Only `published = true` and `verification_state = 'verified'` render publicly.
3. **Agents.** `staff_users.languages TEXT[]`; name search; branch/district/estate-speciality/language filters; grouped layout, not a flat wall. Confirm 「查看代理放盤」 filters to that agent (`fetchListingsForAgent` exists — verify the UI path). Add redirects for any slug correction; never break a legacy `public_slug`.
4. **Branches as an entity.** Today `staff_users.branch` is free text matched by **name-string equality** against `SITE_BRANCHES[].name` — fragile, and it already caused a factual bug (15 of 23 agents shown at the wrong branch, fixed in the last CHANGELOG). Add a `branches` table seeded from `site-branches.js` plus `staff_users.branch_id`; keep the config as the seed, not the runtime join key.
5. **Contact + owner valuation.** `/contact`: enquiry type, preferred contact method, concise PICS beside the form, **direct-marketing consent separate from the operational reply and not preselected**, and all four states (success, validation, network error, duplicate submit). Owner valuation is currently only a WhatsApp deep-link (`OwnerValuationPanel.tsx:33-45`); add a structured form + `valuation_leads` (or `inquiries` + typed fields) capturing consent text, version and timestamp.
6. **Mortgage.** zh-HK throughout (DR-8). Cash-required summary = deposit + stamp duty + configurable costs, with a maintainable `src/content/policy-rates.ts` (`{ rate, effectiveFrom, source, verifiedOn }`) — **never hardcode a stamp-duty rate inline** (open input #7). Scenario comparison; amortisation collapsed by default; assumptions + last-verified date; links to official HK sources; explicit "estimate, lender approval varies".
7. **Editorial.** `/blog` categories (買樓攻略、租樓攻略、屋苑比較、成交分析、社區生活、市場評論), search, cover/author/dates/reading time, editorial + fact-checking standard page. `/blog/$slug`: ToC for long articles, author **and reviewer**, sources with data dates, evidence-backed comparison tables, related links, concise answer summary. **Rewrite the two flagship articles** (`sham-tseng-buying-guide-2026`, `bellagio-vs-sea-crest-villa-vs-hong-kong-garden`) — their titles promise more than the bodies deliver. `/estate-reviews` filters + zh-HK. `/videos` categories (樓盤實拍、屋苑開箱、市場評論、社區生活), 12–24 initial, **displayed totals must equal filter totals**.
8. **Legal.** Replace `SITE_URL = "https://earnestproperty.vercel.app"` in `src/content/seo.ts` with the final production domain (open input #1) — it currently leaks a preview host into canonicals, OG, sitemap, robots and legal text. Expand `/privacy`, `/disclaimer`, `/terms` per §5.20 with effective and last-updated dates. **Keep the `TODO(client/legal)` markers until a Hong Kong legal/privacy professional signs off (open input #10); this is a release blocker, not a nice-to-have.**

**Acceptance.** No public reference to 成交快訊. No unverified transaction rendered. Marketing consent never preselected and never bundled with the operational reply. No stamp-duty or interest figure without an effective date and source. Video totals reconcile.
**Verify.** `npm run test:contact && npm run test:videos && npm run test:blog && npm run test:property-experience && npm run test:seo && npm run test:homepage`.

---

### P6 — Admin workspace

**Goal.** Make the client able to run the site without a developer — mostly by **wiring up what already exists**.

**Work.**
1. **Wire the dead revision workflow.** Point `/admin/cms` at `src/lib/neon/admin-cms.ts` (`saveAdminCmsDraft`, `publishAdminCmsRevision`, `restoreAdminCmsRevision`, `archiveAdminCmsResource`) instead of `admin-data`'s direct writes. Delivers draft→publish, version history, restore and archive across estate/article/video/faq/media in one move. Keep `base_published_version` optimistic-concurrency checking. Remove the `UNREACHABLE` header once true.
2. **New routes.** `admin.transactions` (+`$id`, `new`, import, validate estate/date/area/price/PSF, draft→approve→publish→correct with audit trail, **social card preview + editable FB/IG zh-HK copy** — extend `ContentCopilotResourceType`/`ContentCopilotAction` in `src/lib/ai/content-copilot.ts`, which has no social action today and no image renderer, so the card renderer is net-new). `admin.estates` (proper editor: aliases, lat/lng and `avg_saleable_psf` — which the current CMS INSERT omits — transport, school note, FAQs, SEO, desktop/mobile preview before publish). `admin.media` (delete/archive using the unused `media_assets.archived_at`, reorder, explicit hero flag, alt text at upload in zh + en, capture dimensions/format/size, **usage tracking** via a `listing_media` join backfilled by URL match against `properties.images`, and refuse deletion of an in-use asset with a warning). `admin.enquiries` (a list server fn + route so `updateAdminInquiryStatus` becomes reachable). `admin.valuations`. `admin.data-quality` (surface `listing_sync_runs`, `listing_source_observations`, `property_sync_state`, `listing_change_events`; the nine review states: suspected duplicates, missing bed/bath, malformed descriptions, missing images, district/estate mismatch, expired/stale, invalid price/area, missing agent mapping, unresolved imports). `admin.seo` (redirect manager persisting to a table; generate `vercel.ts` redirect entries from it or resolve at runtime). `admin.audit` (surface `audit_logs`, which is **write-only today** — nothing ever selects from it).
3. **Roles.** Map the spec's Admin / Editor / Agent / Read-only reviewer onto existing `admin | manager | agent` plus a new `viewer`. Migrate the mixed enforcement to `requireStaffPermission` consistently: `ai.draft.generate` (`src/lib/ai/content-copilot-admin.ts:20,28`) and `cms.publish` (`admin-data.ts:700`, `saveAdminEstateServer`) are declared in `src/lib/control-plane/permissions.ts` but still enforced with plain role arrays. (`ai.knowledge.rebuild` is already enforced correctly at `api.admin.ai.rebuild-knowledge.ts:12` — that route's problem is that nothing calls it: delete it or wire it.) Add permissions for every new surface.
4. Add `created_by` / `updated_by` to CMS content rows (content rows carry no authorship today).
5. **Server-side authorisation tests** for every new route and server function: a `viewer` cannot mutate; an `agent` cannot publish; an unauthenticated request gets 401 and never data.

**Acceptance.** Client can create → preview → publish → unpublish → restore an estate with images, alt text and a hero, without a deploy. Every enquiry and valuation lead is visible and assignable. Data-quality queues are populated from real sync tables. No admin surface exposes tokens, connection strings or env values.
**Verify.** `npm run test:cms && npm run test:command-center && npm run test:operations && npm run test:control-plane && npm run test:team && npm run test:content-copilot`; manual RBAC matrix.

---

### P7 — SEO, AEO, accessibility, performance, analytics

**Work.**
1. **SEO.** A shared `seo({ title, description, path, ogImage, noindex })` helper — there is none today, every route hand-rolls `head()`. Migrate the four routes still inlining canonicals (`castle-peak-road.index.tsx`, `castle-peak-road.$segment.tsx`, `district.sham-tseng.tsx`, `district.tsuen-wan.tsx`) onto `canonicalLink()`. Exactly one H1 per page (audit all routes). Organization/RealEstateAgent JSON-LD sitewide in `__root.tsx`, not homepage-only. Structured data **only for visible, verified content**; cap `ItemList`/`VideoObject`. Sitemap from the route registry with per-page `lastmod` (one shared timestamp today). `public/robots.txt`: add `Disallow: /admin`, `/auth`, `/account` — it has no disallow rules at all. Decide `/district/tsuen-wan`: noindex or reinstate.
2. **AEO/GEO.** Answer summaries on district, estate and guide pages; comparison tables with consistent fields and dates; source + last-verified on every market/transport/school/mortgage/stamp-duty claim; answer 「適合邊類家庭」「交通取捨」「同價有咩選擇」「睇樓前要留意甚麼」; strong entity linking between area ↔ estate ↔ listing ↔ agent ↔ transaction ↔ video ↔ article. No keyword stuffing, no templated shallow estate text.
3. **A11y.** WCAG 2.2 AA on: search, property detail, estate, enquiry, valuation, contact, mortgage. Close every DR-7 item. Add an axe/Playwright a11y suite (`test:a11y`) — there is **no** automated a11y tooling today. Promote `jsx-a11y` to `error`.
4. **Performance.** LCP image prioritised per template; `AppImage` everywhere; lazy below-fold; reserved dimensions; no autoplay video on mobile; paginate long collections; JSON-LD payload caps; font preload/self-host; skeletons that don't mask failure. Record Lighthouse mobile before/after.
5. **Analytics.** `src/lib/analytics/events.ts` with the 18 named events (`listing_search` … `zero_results_notify`), typed payloads, route/district/estate/listing-ref/agent/UTM context, **no PII**, and a provider-agnostic `track()` that no-ops until a provider is chosen (open input #11).

**Acceptance.** One H1 per page; no structured data for invisible content; robots disallows staff surfaces; a11y suite green; Lighthouse mobile improved on home, listings, property, estate; every event fires once with the documented payload.
**Verify.** `npm run test:seo && npm run test:a11y && npm run lint && npm run build`; structured-data validation on one page per template; crawl for broken links and images.

---

### P8 — Verification, preview and handoff

**Work.**
1. Full verification sweep (instruction §8): lint, typecheck, all `test:*`, production build, route crawl, broken-link and image check, 375px + desktop browser pass, keyboard and basic screen-reader pass, structured-data validation, sitemap/robots check, auth and role tests, live enquiry and valuation submissions, dedup checks, and one representative flow each for listing / estate / agent / transaction / article. **No unexplained console error, hydration warning or failed request is acceptable.**
2. Write the six handoff docs — each referencing **actual implemented routes and components**, not intentions: `ROUTE_FUNCTION_PARITY.md` (per §2 of the instruction, including every section moved or removed), `COMPONENT_MAP.md`, `FRONTEND_DATA_CONTRACT.md` (real columns, with the gap table from §4 below), `CONTENT_AND_ASSET_MANIFEST.md` (which estates/photos/facts are verified and which are held back), `SEO_REDIRECT_PLAN.md`, `CLAUDE_INTEGRATION_NOTES.md`.
3. Preview deploy only. Production stays live. Before/after screenshots at 375px and 1440px per template, plus the parity report. **No promotion to `main` or the production domain without explicit written approval.**

---

## 4. Schema work, consolidated

All additive, all reversible, applied via `npm run neon:migrate`; `npm run check:migration-drift` must stay green.

| Phase | Migration | Contents |
| --- | --- | --- |
| P3 | `listing_alerts` | notify-me requests: filter JSON, contact, consent text + version + timestamp, source/UTM, status |
| P4 | `estate_expansion` | `districts` table; `estates.district_id` (nullable, backfilled); `estates.aliases`, `address`, `blocks`, `school_net_code`, `verified_at`, `transport_note`; 17 estate rows `published=false` |
| P5 | `transaction_provenance` | `transactions.source`, `source_url`, `verification_state`, `verified_at`, `agent_id`, `published`, `block`, `floor_band`, `social_state` |
| P5 | `agent_branch_identity` | `branches` table seeded from `site-branches.js`; `staff_users.branch_id`; `staff_users.languages TEXT[]` |
| P5 | `valuation_leads` | structured owner-valuation capture + consent record |
| P6 | `cms_authorship` | `created_by`/`updated_by` on CMS content rows; `listing_media` join table for media usage tracking |

**Known contract gaps to document, not necessarily to fill** (from the data audit): `properties` has no verification status, no coordinates, no `branch_id`, no `published_at`, no stored PSF, and `floor` is free text not a band; `estates` had no aliases/address/blocks before P4; `transactions` had no provenance before P5. Where a spec field has no column and no verified source, the UI **hides** it — it does not display an empty label.

---

## 5. Open inputs — each blocks specific tasks

| # | Input | Blocks | If not supplied |
| --- | --- | --- | --- |
| 1 | Final production domain | P5 legal, P7 canonicals/sitemap/robots/OG | Keep the vercel.app host and flag it as a release blocker |
| 2 | Confirmed permanent slugs + zh/en names for the 17 estates; districts for 帝華軒、海韻台、龍騰閣 | P4 | Build the records with `published=false`; do not mint URLs |
| 3 | 6 outstanding estate photos + 麗都分行 shopfront + a higher-res 浪翠園 image (`TODO-ASSETS.md`) | P4 publish gate | Estates stay unpublished; homepage cards show no figure rather than a zero |
| 4 | WhatsApp numbers + licence numbers for all 23 agents | P5 agents | Omit the field; never show a blank licence |
| 5 | Verified facts per new estate (developer, occupation year, phases, blocks, units, facilities) | P4 publish gate | Page stays unpublished |
| 6 | Current EDB 學校網名冊 extract + admission year | P2 DR-5 | Ship net code + caveat only; omit the school list |
| 7 | Current stamp-duty rates + effective date; mortgage assumption source | P5 mortgage | Ship the calculator without the cash-required module |
| 8 | Is `MLS_PUBLISH_ENABLED` true in production? | P3 freshness badges | Do not display freshness claims that the data cannot support |
| 9 | Branch WhatsApp (explicitly `null` on all three branches), plus hours and map URLs (never set at all) | P5 contact, footer | Hide the field |
| 10 | HK legal/privacy reviewer sign-off | P5 legal, P8 promotion | Blocks production promotion |
| 11 | Analytics provider | P7 | Ship the typed taxonomy with a no-op `track()` |

---

## 6. Definition of done

Mapped from instruction §16, with the corrections above:

- [ ] Every route in §1 designed, reachable, and mobile-complete at 375/430/768/1024/1440
- [ ] Search, filter, sort, listing detail, viewing request, valuation and contact journeys work end-to-end
- [ ] The 17 client estates exist in the registry and template system; unverified ones are unpublished, not placeholdered
- [ ] 成交快訊 → 晉誠地產最新成交 everywhere, tests updated
- [ ] Transaction → social-content workflow represented in admin
- [ ] Estate image editing and draft→publish→restore workflows live in admin (via the existing revision engine)
- [ ] DR-1…DR-10 closed with regression tests
- [ ] No internal wording, no unfinished placeholder, no invented fact on any public surface
- [ ] Every market/transport/school/mortgage claim carries source + as-of date, or is hidden
- [ ] CI enforces lint + typecheck ratchet + build + full test matrix + a11y
- [ ] Six handoff docs written from the shipped code
- [ ] Preview deployed, before/after evidence supplied, production untouched pending approval

---

## 7. Execution notes for Claude Code

- **Do not start with visual polish.** P0 → P1 → P2 in order. Data trust and shared primitives are what make the rest cheap.
- Work one phase per branch, one PR per phase. Keep the diff reviewable; a 79-route rewrite in one PR is not.
- Before editing any route, read it. Several routes contain comments explaining a past deliberate decision (`castle-peak-road.ts:111-114` on district slugs; `sitemap[.]xml.ts:13-16` on the 荃灣 orphan; `district.ting-kau.tsx` on double redirects; `admin-cms.ts` on why the dead module was kept). Reversing one of those without reading it will reintroduce a fixed bug.
- Treat `docs/superpowers/specs/2026-07-09-mega-menu-navigation-design.md`, `2026-08-16-nav-copy-hero-density-design.md`, `2026-08-17-homepage-chinese-section-headings-design.md` as **already implemented baselines** — don't redo them. `docs/admin-ux-audit-2026-08-03.md` and `docs/admin-ux-review-2026-08-05.md` already cover admin a11y; extend, don't repeat. `docs/code-audit-2026-08-11.md` explains why `jsonLdScript()` escapes `<`/`>`/`&` — keep that escaping.
- Every phase ends with the phase's `Verify` line green plus `npx tsc --noEmit` at or below the recorded baseline.
- If a spec requirement conflicts with a locked decision in §0.2, the decision wins and you note the conflict rather than splitting the difference.
