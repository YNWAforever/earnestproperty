# P3 — Search and Property Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The core buyer journey — search → compare → contact — per `docs/superpowers/plans/2026-08-28-frontend-revamp.md`'s P3 section: `/listings` sort/filter/UI, save/notify-me, `/property/$listingNo` restructuring, a homepage length cut, and the map-mode decision.

**Architecture:** Branch `feat/frontend-revamp-p3-search-property` off `feat/frontend-revamp-p2-data-trust` (depends on P1's `format.ts`/layout primitives/`AppImage` and P2's `dedupeListings`/sanitization). Eight tasks, each independently testable and committed.

**Tech Stack:** Same as the rest of the repo.

---

## Ground truth already verified (do not re-derive)

- `/listings`' Zod search schema (`src/routes/listings.tsx:41-50`) has no `sort` field and no saleable-area filter. `ListingFilters` (`src/lib/queries.ts:210-220`) and `NeonListingFiltersInput` (`public-data.types.ts`) match — no sort, no area. Sort is hardcoded at the SQL layer: `ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC` (`public-data.server.ts:514`, also reused verbatim at lines 467, 581, 661 for corridor/featured/similar). This is a from-scratch addition, not extending a dormant field.
- **Dedup/sort interaction**: `dedupeListings` (`queries.ts:299-353`) keeps the *first* occurrence of a duplicate pair and documents that callers must pre-order rows `featured DESC, last_seen_at DESC, created_at DESC` so the kept row is the freshest. A user-supplied sort changes SQL row order. Since true duplicates are re-scrapes of the *same physical unit*, their price/area/bedrooms are virtually always identical, so a tie on the user's chosen sort column is the common case — add a secondary `ORDER BY` tiebreaker of the existing freshness ordering after whatever column the user's sort picks, so dedup's "kept row is freshest" property holds on ties (the overwhelmingly common real case) without over-engineering a guarantee for the rare non-identical-duplicate edge case.
- `FiltersPanel` (`listings.tsx:223-427`) is a single, always-in-DOM sticky sidebar (`lg:sticky`, no responsive hide) — there is no mobile drawer today. `ui/sheet.tsx` exists and is used elsewhere (`SiteHeader.tsx`, `AdminShell.tsx`) but not in `listings.tsx`.
- DR-7's three a11y defects, current lines: deal-type buttons `listings.tsx:316-334` (no `aria-pressed`/`role="radiogroup"`, floating unconnected `<Label>`); price inputs `listings.tsx:339-357` (placeholder-only, no `id`/`aria-label`, floating `<Label>` at line 337); the three selects (bedrooms `:367-381`, district `:383-397`, estate `:399-414`) each have a floating `<Label>` with no `htmlFor` plus a redundant `aria-label` on the `SelectTrigger` doing the real work.
- No `pendingComponent`/`errorComponent` on the `/listings` route today. No grid/list toggle. No share action on `ListingCard`. `property.$listingNo.tsx`'s `handleShare` (lines 281-293) already implements `navigator.share`-with-clipboard-fallback — reuse that exact pattern, don't reinvent it.
- `formatFreshness`/`<FreshnessStamp>` (P1, `src/lib/format.ts:89-104` / `src/components/layout/FreshnessStamp.tsx`) exist and are fully unit-tested but have **zero production call sites** anywhere in the app (confirmed by repo-wide grep). `ListingCard` (`listings.tsx:429-501`) and the homepage's `PropertyCard` both show only an absolute `formatHkDate` "最後更新" line.
- Gallery on `property.$listingNo.tsx` (lines 571-606): no keyboard nav, active thumbnail signaled by border color only (no `aria-current`), and `images.slice(0, 5)` means **listings with more than 5 photos have unreachable images** — a real bug, not just an a11y gap.
- `property.$listingNo.tsx`'s enquiry form already calls the real `createWebsiteInquiry` (same server fn `src/routes/contact.tsx` uses) — this is not a separate/parallel mechanism, and P3 does not need to build a new inquiry pathway for the property page's existing generic enquiry. (The master plan's "structured request-viewing form" item is scoped in this plan as: keep the existing inquiry form, do not replace it — see Task 6's note.)
- `fetchPropertyByListingNo` hardcodes `WHERE p.status = 'active'` (`public-data.server.ts:625`), so a `sold`/`rented`/`offline`/`inactive` listing returns the same `null` as a truly nonexistent `listing_no` — both collapse into the generic `notFoundComponent`. `properties.status` is a 6-value enum: `draft | active | sold | rented | offline | inactive` (`neon/migrations/20260622060000_public_content.sql:12`) — no `withdrawn` value exists; `sold`/`rented` are the closest fit for "this listing existed and is now unavailable."
- `src/lib/mortgage.ts`'s `calculateMortgage()` already computes `deposit` and `stampDuty` as separate fields but never sums them into a single "cash required at closing" total — that sum doesn't exist anywhere in the codebase yet. `PropertyDecisionActions.tsx` (lines 227-264) already calls `calculateMortgage({ price })` for its teaser card — this is the prior art to extend, not a new call site to invent.
- Related listings (`property.$listingNo.tsx:774-784`) already call `fetchSimilarListings`, which P2 already wired through `dedupeListings` — no further dedup work needed here.
- `ROUTE_FUNCTION_PARITY.md` does not exist anywhere in the repo (tracked or untracked) — Task 8 creates it fresh.
- `properties` has no `lat`/`lng` columns (only `estates` does, confirmed via full-tree grep of every migration file) — per the master plan's own explicit instruction, **map mode (a `/listings` results map view with per-listing pins) is deferred, not built**, since faking pins from estate centroids is explicitly forbidden. This requires no code task — just the deferral note in this plan and the eventual PR description. (This is unrelated to `property.$listingNo.tsx`'s existing single-listing "地圖" tab, which already exists today via an address-based Google Maps iframe embed — that stays as-is, untouched by this plan.)
- The only existing `localStorage` usage pattern in the repo (`LiveAgentWidget.tsx:296-310`) is a plain `window.localStorage.getItem`/`setItem` wrapped in try/catch returning `null`/no-op on failure, with a single string key constant — no existing hook or shared wrapper module. Task 4 follows this same shape.
- `src/lib/neon/website-inquiry.js`'s consent pattern (`crm_contacts.opt_in_whatsapp`, set-once via `ON CONFLICT DO UPDATE` that deliberately never *lowers or later raises* consent for an existing contact from an unauthenticated form) is documented as a known, deliberate limitation. `listing_alerts` (Task 5) should **not** reuse this shared contact-level flag — it needs its own consent text/version/timestamp columns per the master plan's explicit schema spec, since "consent to be notified about this specific alert" is a different, narrower thing than "opt in to WhatsApp marketing broadly."
- `src/lib/control-plane/migration-versions.js`'s `MIGRATION_VERSIONS` array is already missing `"20260822120000_whatsapp_audience_segment_link.sql"` (a pre-existing gap, unrelated to P3, that the migration-drift test would already be failing on). Task 5 adds both the missing pre-existing entry and its own new migration's entry in one clean commit while already touching this exact file — same "found it while in the code, close it" judgment call P2's Task 2 made for its two extra call sites.

---

## Task 1: `/listings` — server-side sort + saleable-area filter

**Files:**
- Modify: `src/routes/listings.tsx`
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/neon/public-data.server.ts`
- Modify: `src/lib/neon/public-data.types.ts`
- Test: `src/lib/neon/listing-search.contract.test.mjs` (extend)

### What to build

1. Add `sort: fallback(z.enum(["newest", "price_asc", "price_desc", "area", "psf"]), "newest").default("newest")` to `listings.tsx`'s Zod search schema. Thread it through `loaderDeps`/`loader` the same way `deal`/`district`/etc. already are.
2. Add `minArea?: number` / `maxArea?: number` to the same schema (saleable area, sqft — same shape as the existing `minPrice`/`maxPrice`, but **not** gated by `deal !== "all"` the way price is, since area is meaningful regardless of sale/rent).
3. Add `sort: SortOption` and `minArea?`/`maxArea?: number` to `ListingFilters` (`queries.ts`) and `NeonListingFiltersInput` (`public-data.types.ts`) — thread straight through, same pattern as every other filter field.
4. In `listingWhere()` (`public-data.server.ts`), add a `saleable_area` bound clause, structurally identical to the existing price-bound clause but without the deal-type gate.
5. In the SQL layer's `ORDER BY` (the function backing `searchNeonListings`, `public-data.server.ts:514`), map `sort` to a primary `ORDER BY` column/direction, THEN append the existing `p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC` as a tiebreaker (see the dedup/sort note in "Ground truth" above — this tiebreaker is required, not optional):
   - `newest` → `p.last_seen_at DESC NULLS LAST` (primary), then the existing tiebreaker chain (which starts with `featured DESC` — decide whether `newest`'s primary clause should itself be `featured DESC, last_seen_at DESC NULLS LAST` restated, or whether the existing hardcoded order IS what "newest" means today and mapping `newest` is a no-op passthrough — use your judgment on the cleanest way to express "the pre-existing default order" as one of the five enum values without duplicating logic)
   - `price_asc` → `COALESCE(p.price, p.rent) ASC NULLS LAST` (a listing's populated price/rent column depends on `deal_type`; use whichever is non-null)
   - `price_desc` → same column, `DESC NULLS LAST`
   - `area` → `p.saleable_area DESC NULLS LAST`
   - `psf` → this one is harder: PSF isn't a stored column, it's derived (`price / saleable_area` or `rent / saleable_area`), and dividing by a possibly-zero/null area in SQL needs a `NULLIF`/`CASE` guard exactly like this repo's `formatPsf` already does client-side. Write the SQL expression explicitly (`CASE WHEN p.saleable_area > 0 THEN COALESCE(p.price, p.rent) / p.saleable_area END`) rather than assuming a shortcut exists.
6. Do **not** apply `sort` to `fetchFeaturedProperties`, `fetchCorridorInventoryForAliases`'s underlying rows, or `fetchSimilarListings` — those three still use the plain hardcoded order; this task only touches the general `/listings` search path (`searchListings`/`searchNeonListings`).
7. `/listings`' UI needs a sort `<Select>` control wired to the new `sort` search param (reuse the exact `<Select>`/`<SelectTrigger>` pattern already used for bedrooms/district/estate in this same file, including a properly-wired `<Label htmlFor>`/`id` pair from the start — don't introduce a fourth instance of the DR-7 floating-label bug you're about to fix in Task 3 for the other three selects). Options labelled in zh-HK: 最新上架 / 價格由低至高 / 價格由高至低 / 面積由大至小 / 呎價由低至高 (pick sensible zh-HK labels; these are suggestions, not mandates — match this file's existing tone).

### Tests

Extend `listing-search.contract.test.mjs` (reuse its existing SQL-capture harness, don't invent a new one):
- A contract test per `sort` value confirming the generated SQL's `ORDER BY` clause matches what's expected, including the tiebreaker suffix.
- A test confirming `saleable_area` bounds produce the expected `WHERE` fragment.
- A test confirming a `psf`-sorted query's `ORDER BY` expression correctly guards against division by zero/null area (assert the SQL text contains a `CASE`/`NULLIF` guard, not a bare division).

### Verify

```bash
npx tsc --noEmit
node --test src/lib/neon/listing-search.contract.test.mjs
```

Commit: `feat(listings): add server-side sort and saleable-area filter`

---

## Task 2: `/listings` UI — mobile filter drawer, active-filter chips, grid/list toggle, loading/error states

**Files:**
- Modify: `src/routes/listings.tsx`
- Test: extend whatever test already covers this route (check `package.json` — likely folded into `test:listing-search` or a route-contract test; confirm before assuming)

### What to build

1. Extract `FiltersPanel`'s form controls into a shape reusable by both the existing desktop sidebar and a new mobile `Sheet` (`ui/sheet.tsx`, already vendored and used elsewhere in this repo — follow `SiteHeader.tsx`'s existing `<Sheet>`/`<SheetTrigger>`/`<SheetContent>` usage as the pattern to match). Desktop: keep the current sidebar, but make it `hidden lg:block` (it currently has no visibility gating at all). Mobile: `lg:hidden` — a "篩選" (Filter) button showing the active-filter count as a badge, opening the `Sheet` with the same form controls, with an "套用" (Apply)/"清除" (Clear) action pair at the bottom of the sheet content.
2. Active-filter chips: derive from the current validated search params (every field that differs from its default — `deal !== "all"`, `district`, `minPrice`/`maxPrice`, `bedrooms`, `estate`, `keyword`, plus this task's own `sort !== "newest"`/`minArea`/`maxArea` from Task 1 if that task has already landed on this branch — check). Render as a row of dismissible chip buttons above the results grid, each removing just that one param on click (navigate with that key omitted from search), plus a "清除全部篩選" chip/button clearing everything back to defaults.
3. Grid/list view toggle: a small icon-button pair (grid icon / list icon) controlling a `viewMode` local state (not persisted to the URL — this is a display preference, not a shareable search parameter). Add a `ListingCard` variant (or a conditional layout within it) for the list row: same data, horizontal layout instead of the card grid. Keep this genuinely simple — a real, working second layout, not a fully independent component duplicating all of `ListingCard`'s logic.
4. `pendingComponent`: use `SkeletonBlock` (P1, `src/components/layout/SkeletonBlock.tsx`) to render a grid of placeholder cards matching the results grid's shape while the loader is in flight.
5. `errorComponent`: reuse this repo's established error-boundary pattern (see `CastlePeakRoadSegmentError` in `castle-peak-road.$segment.tsx` for the shape other routes already use — a card with an explanation, a retry button via `router.invalidate()`, and a way back to a working state).
6. Keep the existing "price bounds dropped when `deal=all`" behavior (`isAllDeals` disabling the price inputs), but per the master plan's acceptance note, make sure the explanatory text (already present at `listings.tsx:358-362`, `售價同月租唔同單位，揀「售盤」或「租盤」先可以設定價格。`) is visible in BOTH the desktop panel and the new mobile sheet — don't let it get lost when the panel is duplicated/extracted in step 1.

### Tests

Check `package.json`'s scripts for whatever already covers `listings.tsx` (likely `test:listing-search`, possibly a separate route-contract test) before creating anything new. Add source-scan and/or behavioral assertions (this repo's `bun:test` + `cheerio` + `renderToStaticMarkup` pattern, if a harness already exists for this route — check first) confirming: the mobile `Sheet` trigger exists and is `lg:hidden`, the desktop panel is `hidden lg:block`, active-filter chips render one per non-default param, `pendingComponent`/`errorComponent` are defined on the route.

### Verify

```bash
npx tsc --noEmit
npm run lint
```
(Run whichever test script you extended.)

Commit: `feat(listings): add mobile filter drawer, active-filter chips, grid/list toggle, and loading/error states`

---

## Task 3: `/listings` — DR-7 accessibility fixes, freshness stamp, share action

**Files:**
- Modify: `src/routes/listings.tsx`
- Test: extend the same test file(s) as Task 2

### What to build

1. Deal-type buttons (`listings.tsx:316-334`): wrap the three buttons in a `<div role="radiogroup" aria-label="放盤類型">` (or wire the existing `<Label>` via `aria-labelledby` pointing at a stable `id` on that label instead of duplicating the string — pick whichever avoids repeating the label text twice in the DOM), add `role="radio"` + `aria-checked={deal === v}` to each button (native `<button>` elements can carry ARIA radio semantics directly; you don't need to switch to actual `<input type="radio">` elements, but if you judge that's cleaner and equally accessible, that's an acceptable alternative — don't feel locked into the exact wrapper shape, the requirement is a screen reader correctly announcing "radio button, selected/not selected" and the group's purpose).
2. Price inputs (`listings.tsx:339-357`): give each `<Input>` a real `id` and either connect it to its own `<Label htmlFor>` (two separate labels, "最低售價"/"最高售價" or similar, replacing the shared floating label) or use `aria-label` directly on each input with the deal-type-aware full label text (e.g. "最低售價 (HKD)" vs "最低租金 (HKD)" depending on `deal`) — placeholder text alone must no longer be the only accessible name.
3. The three `<Select>` filters (bedrooms/district/estate, `:367-381`/`:383-397`/`:399-414`): give each `<SelectTrigger>` a stable `id`, wire the existing `<Label>` to it via `htmlFor`, and remove the now-redundant `aria-label` duplicate (or keep it if you judge belt-and-suspenders is warranted — but the `<Label htmlFor>` should be the primary, real association, not a decorative wrapper doing nothing).
4. `ListingCard` (`listings.tsx:429-501`): replace the existing `formatHkDate(p.last_seen_at)` "最後更新" text with `<FreshnessStamp updatedAt={p.last_seen_at} />` (P1 component, already exists, already tested — read its actual props before using it, don't assume the exact API from this description).
5. `ListingCard`: add a share button reusing `property.$listingNo.tsx`'s existing `handleShare` pattern (lines 281-293 there — `navigator.share` with a clipboard-copy fallback and a toast confirmation). Extract it into a small shared helper if that's cleaner than duplicating the function body, but don't invent a different sharing mechanism.

### Tests

Extend the same test file(s) from Task 2. Add assertions: each deal-type button has `role="radio"`/`aria-checked`; each price input has a real accessible name (not placeholder-only — check for `id`+matching `<Label htmlFor>` or `aria-label` in the source); each select's `<SelectTrigger>` has a matching `<Label htmlFor>` `id` pair; `FreshnessStamp` is imported and used in `ListingCard`; a share action exists.

### Verify

```bash
npx tsc --noEmit
npm run lint
```

Commit: `fix(listings): DR-7 accessibility fixes, freshness stamp, share action`

---

## Task 4: Save/心水 — localStorage favourites and saved searches

**Files:**
- Create: `src/lib/saved-listings.ts` (client-side storage helper — favourites + saved searches, following `LiveAgentWidget.tsx`'s established try/catch-around-`window.localStorage` shape, extracted into a small reusable module rather than inlined once)
- Modify: `src/routes/listings.tsx` (favourite toggle on `ListingCard`, "儲存呢個搜尋" action, a small saved-searches list/panel)
- Modify: `src/routes/property.$listingNo.tsx` (favourite toggle, reusing the same helper)
- Test: new `src/lib/saved-listings.test.ts` (bun:test, since this is pure client-side TS logic — no DB, no `.mjs` node:test needed)

### What to build

1. `src/lib/saved-listings.ts`: exported functions for reading/writing two localStorage-backed collections — favourited listing identifiers (an array of `listing_no` or `id`, your choice, pick whichever the card components already have readily available) and saved searches (an array of `{ id, label, params, savedAt }`, where `params` is the current validated search-schema shape serialized to JSON). Each read/write wrapped in try/catch matching the established pattern (return an empty array / no-op on failure, never throw into a render). Cap saved searches at a reasonable count (e.g. 20) so localStorage can't grow unbounded — evict oldest on overflow.
2. `ListingCard` (and the property-detail page): a heart/save icon button toggling favourite state, with an accessible label reflecting current state ("加入心水"/"已加入心水" or similar, not a static label that doesn't change).
3. `/listings`: a "儲存呢個搜尋" button (only shown when at least one non-default filter is active) that persists the current search params via the new helper, plus a small UI surface listing saved searches (a dropdown, popover, or simple inline list — your judgment on the lightest-weight option that's still genuinely usable) letting the user re-apply (navigate with those params) or delete a saved search.
4. This is entirely client-side — no server fn, no DB table (that's Task 5's `listing_alerts`, a genuinely different concept: a *server-recorded notify-me request*, not a *local UI convenience*). Don't conflate the two.

### Tests (TDD)

`src/lib/saved-listings.test.ts` (bun:test): write these first, confirm they fail against nothing (no implementation yet), then implement.
- Favouriting a listing_no persists it; a second call with the same id doesn't duplicate it; un-favouriting removes it.
- Saving a search persists params + a timestamp; saved searches are ordered newest-first (or your chosen order — just assert it's deterministic and documented); deleting one removes only that one.
- The 20-item cap evicts the oldest entry, not a random one.
- A `localStorage.getItem`/`setItem` that throws (simulate via a mock or `Object.defineProperty` override in the test) doesn't throw out of any of these functions — they degrade to empty/no-op.

### Verify

```bash
npx tsc --noEmit
bun test src/lib/saved-listings.test.ts
```

Commit: `feat(listings): add localStorage-backed favourites and saved searches`

---

## Task 5: `listing_alerts` migration + notify-me form

**Files:**
- Create: `neon/migrations/<today's-date-in-this-repo's-timestamp-format>_listing_alerts.sql` (check the most recent migration's filename for the exact `YYYYMMDDHHMMSS_description.sql` convention before picking a timestamp — must sort after every existing migration)
- Modify: `src/lib/control-plane/migration-versions.js` (add both this new entry AND the pre-existing missing `20260822120000_whatsapp_audience_segment_link.sql` entry)
- Create: `src/lib/neon/listing-alerts.js` + `.d.ts` (pure-logic module, matching `website-inquiry.js`'s established convention)
- Modify: `src/lib/neon/admin-data.ts` (or create a new small dedicated file if that's cleaner — your judgment, but match the existing `createWebsiteInquiry` two-file wiring pattern: Zod-validated `createServerFn` wrapper here, delegating to the pure-logic module)
- Modify: `src/routes/listings.tsx` (zero-results state gets a notify-me offer)
- Test: `src/lib/neon/listing-alerts.test.mjs` or fold into an existing contract-test file — your judgment

### What to build

1. Migration: a `listing_alerts` table per the master plan's spec — filter JSON (the same search-params shape Task 4's saved searches already use; consider whether it's worth sharing a type between the two, though the DB table needs its own JSON column regardless), contact fields (name/phone/email — mirror `website-inquiry.js`'s validation shape for consistency, e.g. same phone regex), `consent_text TEXT NOT NULL`, `consent_version TEXT NOT NULL`, `consented_at TIMESTAMPTZ NOT NULL`, `source TEXT`, `utm JSONB` (or separate `utm_source`/`utm_medium`/`utm_campaign` columns — check whether any existing table already has a UTM-capture convention to match before inventing one), `status TEXT NOT NULL DEFAULT 'active'` (or an enum if this repo's convention favors enums for small fixed value sets — `properties.status` uses an enum, follow that precedent), `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Follow this repo's migration comment convention (explain *why*, not just *what* — see the Ground-truth section's quoted example migration).
2. `listing-alerts.js`/`.d.ts`: a `persistListingAlert(query, input)` function, SQL via `queryRows`/parameterized (never string-interpolated), following `persistWebsiteInquiry`'s shape closely enough that a reader familiar with one recognizes the other.
3. Server fn wrapper: Zod-validated, rate-limited the same way `createWebsiteInquiry` is (same IP-based limits, or your judgment on whether notify-me needs different limits — document the choice either way). **The consent capture must record the actual consent text shown to the user, its version, and the timestamp** — don't just store a boolean. If the consent copy changes later, `consent_version` is how you'd know which users saw which wording; write the initial version as `"1"` or similar in a named constant, not inline as a magic string scattered across files.
4. `/listings`' zero-results state: when `total === 0`, alongside whatever "try different filters" messaging already exists (check current zero-results handling before assuming there's a gap — read the file), offer a small notify-me form: contact fields + a required (not preselected) consent checkbox with real, specific copy (not a generic "I agree to be contacted" — say what they're consenting to: being notified by [WhatsApp/email/phone — pick based on what fields you collect] when a matching listing appears), submitting via the new server fn with the CURRENT search filters attached as the alert's filter JSON.

### Tests

- Migration: confirm `check:migration-drift` / `migration-versions.test.mjs` passes (this proves both the new entry and the pre-existing missing one are now correctly registered).
- `listing-alerts.js`: unit/contract tests mirroring `website-inquiry.js`'s existing test coverage style — validate the SQL shape, confirm consent fields are required and actually persisted (not silently dropped), confirm rate-limiting is wired.
- Source-scan or behavioral test confirming the zero-results notify-me form's consent checkbox starts unchecked (never preselected — this is a repo-wide, plan-mandated invariant, not optional).

### Verify

```bash
npx tsc --noEmit
node --test src/lib/control-plane/migration-versions.test.mjs
npm run check:migration-drift
```
(Plus whichever test file you added for `listing-alerts.js`.)

Commit: `feat(listings): add listing_alerts migration and notify-me form`

---

## Task 6: Property detail — gallery accessibility, freshness stamp, withdrawn/unavailable state

**Files:**
- Modify: `src/routes/property.$listingNo.tsx`
- Modify: `src/lib/neon/public-data.server.ts` (`fetchPropertyByListingNo`'s WHERE clause)
- Test: whatever existing test already covers this route (check `test:property-experience`'s script list in `package.json`)

### What to build

1. **Gallery keyboard nav + the >5-photos bug**: the main image viewer and thumbnail strip need arrow-key navigation (Left/Right cycling through ALL images, not just the first 5), and the thumbnail strip needs to actually expose every image, not `images.slice(0, 5)`. Options: a horizontally-scrollable thumbnail strip showing all of them, or thumbnails capped visually with a "+N" indicator that still allows keyboard/main-image cycling past the visible thumbnails. Pick whichever fits this repo's existing visual style better — read the current gallery markup first and extend it, don't rewrite it from scratch.
2. Active thumbnail: add `aria-current="true"` (or `aria-selected` if you judge a `role="tablist"`/`role="tab"` restructuring is warranted — your call on how far to take the ARIA semantics, but at minimum the currently-showing image must be programmatically identifiable, not color-only).
3. Freshness stamp: replace the existing `formatHkDate(property.updated_at)` "最後更新" line (`property.$listingNo.tsx:407,460-464`) with `<FreshnessStamp updatedAt={property.updated_at} />`.
4. **Withdrawn/unavailable state**: change `fetchPropertyByListingNo`'s SQL (`public-data.server.ts:625`) to drop the hardcoded `p.status = 'active'` filter (fetch by `listing_no` regardless of status), then in `property.$listingNo.tsx`'s loader/component, branch on the returned `status`:
   - `active` → render normally (unchanged).
   - `sold` / `rented` → render a distinct "已售出"/"已租出" state: keep the listing's basic info visible (photo, title, address — this was a real property, showing it builds trust rather than a generic 404) but replace the enquiry form/contact CTAs with a message explaining it's no longer available, plus a link to similar active listings (reuse the existing `fetchSimilarListings` call — it should still run even for a non-active property, since `estate_id`/`deal_type` are still known).
   - `offline` / `inactive` / `draft` → keep today's behavior exactly (treat as not-found, same `notFoundComponent`) — these statuses mean "was never really public" or "pulled for an unrelated reason," not "sold," so the existing hedge-y copy ("可能已售出或下架") is still appropriate there, but is now MORE accurate since the genuinely-sold case has its own real state.
   - Think through the SEO implication: a `sold`/`rented` page should probably not be indexed (add a `noindex` meta, following this repo's existing conditional-noindex pattern already used elsewhere, e.g. `transactions.tsx`'s empty-state noindex) — a permanently-gone listing page indexed forever is exactly the kind of thin/stale content DR-9 already flags as a problem elsewhere in this plan.

### Tests

Check `test:property-experience`'s exact script definition in `package.json` first. Add: a fixture-driven or source-scan test confirming the SQL no longer hardcodes `status = 'active'`; assertions for each of the three status-branch behaviors (active/sold-rented/offline-inactive-draft); a test confirming the `sold`/`rented` branch's page carries `noindex`; gallery keyboard-nav and `aria-current` assertions.

### Verify

```bash
npx tsc --noEmit
```
(Run whichever `test:*` script(s) you extended.)

Commit: `fix(property): gallery a11y, freshness stamp, and a distinct sold/rented state (was: generic 404)`

---

## Task 7: Property detail — mortgage affordability summary, nearby transport

**Files:**
- Modify: `src/components/property/PropertyDecisionActions.tsx` (or `property.$listingNo.tsx` directly, if you judge the affordability summary belongs as its own section rather than extending the existing teaser card — your call, but don't duplicate `calculateMortgage`'s invocation if one already exists in scope)
- Test: whatever existing test already covers this component/route

### What to build

1. **Cash-required-at-closing summary**: `src/lib/mortgage.ts`'s `calculateMortgage()` already computes `deposit` and `stampDuty` as separate fields (confirmed — no new financial logic needed, this task is purely additive UI summing two already-computed numbers). Add a line summing them (`deposit + stampDuty`, labelled something like "預計上會現金需求" or similar zh-HK phrasing — your judgment on exact wording, matching this repo's existing mortgage-copy tone) to the existing mortgage teaser in `PropertyDecisionActions.tsx`, or to a new dedicated affordability section if you judge the teaser card is already too dense — read its current layout before deciding. **Do not invent any new financial figures** (no agency fee, no legal fee estimate) unless a source for those numbers already exists in this codebase — if the master plan's "cash required" concept implies more than deposit+stampDuty and no verified source exists for the rest, ship just the sum of the two real numbers with a clear label, not a padded estimate.
2. **Nearby transport**: `src/content/castle-peak-road.ts`'s `CorridorSegment.transport` field (already-curated, no new data needed) is keyed by segment, which maps loosely to `district_slug`. Add a small section on the property page showing that segment's transport summary text when `property.district_slug` matches a known corridor segment (via `getCastlePeakRoadSegment` or equivalent lookup — check how `castle-peak-road.$segment.tsx` already resolves this), linking through to the fuller corridor/district page. If `district_slug` doesn't match any known segment, omit the section entirely (matching this repo's established "hide, don't show an empty label" convention — see the master plan's §4 note on missing-data handling) rather than showing a placeholder.

### Tests

Extend whatever test already covers `PropertyDecisionActions.tsx`/`property.$listingNo.tsx`. Assert: the cash-required sum equals `deposit + stampDuty` for a known fixture price (a real regression, not just "the function ran"); the transport section renders for a property with a matching `district_slug` and is absent for one without.

### Verify

```bash
npx tsc --noEmit
```
(Run whichever test script(s) you extended.)

Commit: `feat(property): add cash-required-at-closing summary and nearby transport section`

---

## Task 8: Homepage — cut length, freshness stamps, `ROUTE_FUNCTION_PARITY.md`

**Files:**
- Modify: `src/routes/index.tsx`
- Create: `ROUTE_FUNCTION_PARITY.md` (repo root, unless this repo has an established docs directory convention for this kind of doc — check `docs/` structure first)
- Test: extend `src/routes/homepage-copy.contract.test.mjs` (this file, per P2's Task 6 research, already covers homepage copy assertions — confirm and reuse rather than creating a new test file)

### What to build

Per the "Ground truth" section above, this page currently repeats its core trust/credibility claims (local expertise, licensed, real listings, fast response) across five separate spots: hero subhead, the WHY US tiles, the agent-team-preview tagline, the about-preview paragraph, and the Organization JSON-LD (the last one is structured data, not visible copy — leave it, it's not part of the "20-30% length cut," which is about the page a human reads).

1. **Consolidate, don't just delete.** Keep the WHY US tiles (most information-dense single block) and the hero subhead (sets first-impression context). Shorten the ABOUT PREVIEW section — since `/about` exists as a full page, this homepage preview repeating the same three claims can shrink to a one-line teaser + its existing CTA, dropping the restated paragraph. Drop the AGENT TEAM PREVIEW's redundant tagline sentence (keep the agent cards and its own CTA — the cards themselves demonstrate the "real people, licensed" claim better than restating it in prose).
2. **One primary CTA per section** — audit each section for more than one call-to-action competing for attention within it (per the research, most sections already have exactly one; verify this holds after your edits rather than assuming).
3. Add `<FreshnessStamp>` to the homepage's `PropertyCard` (featured listings section), same component/pattern as Task 3's `listings.tsx` change.
4. Check the featured-listings and featured-videos empty states (`index.tsx:309` and around the videos section) — if either is ad-hoc text rather than the shared `EmptyState` (P1, `src/components/layout/EmptyState.tsx`), swap it in. `CoreEstateGrid`'s KPI cards (avg PSF / listing count) already correctly show an em-dash for missing data, never "0" — this part of the plan's acceptance criterion is **already satisfied**; add a regression test for it rather than re-implementing anything (same pattern as P2's Task 7 FAQ-guard task).
5. Log every section you shortened or removed content from in the new `ROUTE_FUNCTION_PARITY.md` — for each: what was there before (a one-line description, not a full copy-paste), what's there now, and why. This is the first entry in what the master plan intends as a living document future phases (P4 onward) will also append to — write it with that in mind (a clear per-route, per-change table format future phases can extend, not a one-off free-form note).

### Tests

Extend `homepage-copy.contract.test.mjs`. Add: a regression test confirming the redundant about-preview paragraph and agent-team-preview tagline sentence are gone (source-scan against the specific strings, so a future re-add is caught); a test confirming `FreshnessStamp` is used in the featured-listings section; a regression test locking in `CoreEstateGrid`'s existing em-dash-not-zero behavior for missing PSF/listing-count data (already correct today — this test proves it stays correct).

### Verify

```bash
npx tsc --noEmit
npm run lint
```
(Run `test:homepage` or whatever script covers `homepage-copy.contract.test.mjs`.)

Commit: `refactor(homepage): cut redundant trust copy, add freshness stamps, document changes in ROUTE_FUNCTION_PARITY.md`

---

## Final verification (after all eight tasks)

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run test:listing-search && npm run test:property-experience && npm run test:format && npm run test:homepage
node --test src/lib/control-plane/migration-versions.test.mjs
npm run check:migration-drift
```

Per the master plan's P3 acceptance criteria, confirm by inspection:
- Every filter on `/listings` (desktop panel and mobile sheet) has a visible label AND a correctly-wired accessible name (Task 3).
- Sort works and is shareable via URL (it's a `sort` search param, so any `/listings?...&sort=price_asc` URL reproduces the same result set — confirm this wasn't accidentally implemented as client-only state).
- Zero-results always offers a next action (Task 5's notify-me form, alongside whatever "adjust your filters" messaging already existed).
- Property detail renders with no console error or hydration warning at 375px and 1440px — this needs a manual browser check (this repo has no automated visual regression tooling); do this check before considering the phase done, not just trusting the unit tests.
- Map mode: confirmed deferred per the "Ground truth" section — document this explicitly in the eventual PR description so it doesn't read as an oversight.
