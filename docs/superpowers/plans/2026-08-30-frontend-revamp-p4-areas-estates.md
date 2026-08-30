# P4 — Areas, Corridor, and Estate Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One authoritative estate registry, and infrastructure ready for the client's 17-estate expansion — per `docs/superpowers/plans/2026-08-28-frontend-revamp.md`'s P4 section.

**Explicit scope decision (confirmed with the user before writing this plan):** the master plan gates estate *publication* on verified facts and real photos ("no photo or no facts → stays `published = false`"), and explicitly forbids guessing three estates' districts. This session has neither real facts, real photos, nor those three districts. **All 17 new estates ship `published = false` with only identity fields populated (name, provisional slug, district where known) — infrastructure is real, content is not fabricated.** Once real data exists, publishing is a data change, not a code change.

**Slug caveat:** the master plan separately says estate slugs "are permanent URLs — do not invent them (open input #2)," and that input hasn't been supplied either. Since `estates.slug` is `NOT NULL UNIQUE` and a row needs *some* key to exist, each of the 17 new rows gets a **provisional** slug (deterministic transliteration of its name), explicitly commented in the migration and the registry as not-yet-confirmed and safe to rename freely — nothing links to `/estate/<slug>` publicly while `published = false`, so a later rename costs nothing (no redirects needed).

**Architecture:** Branch `feat/frontend-revamp-p4-areas-estates` off `feat/frontend-revamp-p3-search-property`. Eight tasks.

---

## Ground truth already verified (do not re-derive)

**Estate identity currently has SIX drift sources, not four:**
1. `src/content/core-estates.ts` — `coreEstates: CoreEstate[]`, 10 estates (5 `hasPage: true` matching the estates below, 5 `hasPage: false` — the same 5 estates from the 深井/汀九 half of the 17-estate list, already partially present as inert homepage-card entries with all facts `null`).
2. `src/content/seo.ts`'s `estateSeo` — 5 estates (exact `hasPage: true` subset), SEO copy + `oldSlugs`.
3. `src/content/estate-pages.ts`'s `estatePageContent` — same 5 estates, detail-page prose/FAQs/CTAs.
4. `src/lib/queries.ts`'s `ESTATE_DB_SLUG_FALLBACKS` — 2 legacy-slug redirects (`bellagio`→`belvedere-garden`, `rhine-garden`→`sea-pearl-garden`).
5. `src/content/castle-peak-road.ts` — each `CorridorSegment`'s `estateSlugs`/`featuredEstates`/`textAliases` re-list the same 5 estates' slugs and display names independently.
6. `src/lib/ai/crm-rules.ts`'s `knownEstateInterestTags` and `src/lib/ai/segments.ts`'s `estateAliases` — two more independent alias/tag lists for the same 5 estates, used by the AI CRM layer.

`estate.$slug.tsx`'s loader/render only ever reads `estateSeo[slug]`/`estatePageContent[slug]` directly (no dependency on `core-estates.ts` or `castle-peak-road.ts`) — a registry consolidation must preserve this route's exact current behavior while making the other five sources derive from one place instead of independently duplicating data.

**`estates` table** (`neon/migrations/20260622060000_public_content.sql:17-37` + later ALTERs): `id, slug (UNIQUE NOT NULL), name_zh (NOT NULL), name_en, district_slug (NOT NULL), developer, year_completed, phases, total_units, area_min, area_max, avg_saleable_psf, description, hero_image, facilities TEXT[], lat, lng, created_at, updated_at`, plus `seo_title`, `seo_description` (added later), `published boolean NOT NULL DEFAULT true`. No `districts` table exists anywhere. No `district_id` column exists anywhere (only `district_slug` on both `estates` and `properties`).

**`seo_title`/`seo_description` are confirmed dead on the public site** — written only by the admin CMS estate form (`admin-data.server.ts`'s `saveAdminEstate`), never selected by any public query (`EstateRecord` in `queries.ts` doesn't include them), never referenced in `estate.$slug.tsx` or any other public route. Only consumer is the AI content-copilot's admin-side knowledge indexer. This resolves DR-10's open question: they're editable in the CMS but do nothing — Task 3 wires them in as a real override.

**Migration conventions** (from the most recent `CREATE TABLE` migration, `20260830120000_listing_alerts.sql`, quoted in full in this plan's sibling P3 doc if you need the exact template): explain-*why* comment block above the table; `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for enum guards; `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`; `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `CREATE INDEX IF NOT EXISTS` immediately after the table. `MIGRATION_VERSIONS`' current tail (`src/lib/control-plane/migration-versions.js`) ends `..., "20260822120000_whatsapp_audience_segment_link.sql", "20260830120000_listing_alerts.sql"]` — a new migration's filename is appended after that.

**`vercel.ts`** has 36 hand-written redirect entries via a `redirectEntry(source, destination, permanent, options?)` helper, each with an explain-why comment. **No new redirects are needed by this plan** — nothing published/live is changing URLs; this is noted explicitly in Task 8 rather than skipped silently.

**`sitemap[.]xml.ts`** enumerates estates from `Object.values(estateSeo).map(e => \`/estate/${e.slug}\`)` — i.e. from the SEO config, not a DB query — and already has an established "only list once real rows exist" conditional pattern (used today for `/transactions` and `/estate-reviews`). The 17 new estates must **not** appear in `staticPaths`/`estateSeo` while `published = false` — Task 1's registry consolidation needs to preserve this gate, not accidentally list unpublished estates.

**`castle-peak-road.index.tsx`** (the hub) today has: hero, a 3-card segment grid (name/summary/live-count links), and an FAQ block. It has **no** corridor map, comparison table, commute summary, estate directory, scoped/labelled inventory counts, price snapshot, or decision guide — all six are genuinely new sections, not present in any form.

**`estate.$slug.tsx`** today has: a plain fact list (no source/as-of citation), live listings, a market-snapshot component (stat tiles + a 5-row raw transaction table, no PSF trend chart, only a soft disclaimer sentence not a `DataNote`), overview/buyer-fit/pros-watchouts prose, 3 WhatsApp CTA cards, `OwnerValuationPanel`, `TrustProofPanel`, FAQ. It has **no** transport section, no school-net section, no comparison-with-nearby-estates section, no video/article links, no covering-agents section, and no `DataNote` usage anywhere.

**No prior art exists anywhere in this codebase for a comparison table or a "which area suits me" decision guide** — confirmed by a repo-wide grep. Both are net-new UI. However, **all of the content they need already exists as curated copy** — `CorridorSegment`'s `housingProfile`/`buyerFit`/`transport`/`schoolNet`/`zoneSummary` fields are already authored for both live segments. This is new *presentation* of existing *data*, not new fact-sourcing — do not invent numbers (price snapshots, PSF) that aren't already backed by a real query.

**`estates` has `lat`/`lng`** (unlike `properties`, confirmed absent there in P3's research) — but this plan does not assume any specific estate row has real coordinates populated, and this session cannot query the live DB to check. The "corridor map" in Task 6 is scoped as a lightweight schematic/ordered-sequence visual (汀九 → 深井/青山公路, matching the segments' real geographic order), **not** a literal pin map — building a real GPS map without confirming which estates have real `lat`/`lng` values would risk exactly the "fake pins" problem the master plan explicitly forbids for `/listings`.

**`findCastlePeakRoadSegmentByDistrictSlug`** already exists (added in P3 Task 7, `src/content/castle-peak-road.ts`) — reuse it directly for Task 4's transport section instead of writing a second lookup.

**`district.sham-tseng.tsx`** already uses `DataNote` for its school-net card (P2's DR-5 fix) but not for its transit-time list or header stat tiles — Task 7 extends the same pattern to those, it doesn't build the pattern from scratch.

---

## Task 1: `src/content/estate-registry.ts` — collapse the six-way drift

**Files:**
- Create: `src/content/estate-registry.ts`
- Modify: `src/content/core-estates.ts`, `src/content/seo.ts`, `src/content/estate-pages.ts`, `src/lib/queries.ts`, `src/content/castle-peak-road.ts`, `src/lib/ai/crm-rules.ts`, `src/lib/ai/segments.ts`
- Test: `src/content/estate-registry.test.mjs` (new), extend `src/content/core-estates.test.mjs` and `src/content/estate-conversion.test.mjs` as needed to keep their existing assertions passing against the new derivation

### What to build

A single `EstateRegistryEntry` type and `estateRegistry` array/map covering the current 10 client-approved estates (the "17-estate expansion" additions land in Task 2, on top of this registry, not instead of it). Fields, per the master plan's own spec plus what the six drift sources actually need: `slug`, `nameZh`, `nameEn`, `aliases: string[]` (covers what `estateAliases`/`knownEstateInterestTags`/`textAliases` currently duplicate), `legacySlug?: string` (replaces `ESTATE_DB_SLUG_FALLBACKS`'s reverse mapping — decide the cleanest direction, current code maps canonical→legacy, keep that shape unless you find a good reason to flip it), `districtSlug: string | null` (`null` for the 3 unknown-district additions in Task 2), `corridorSegment: "ting-kau" | "sham-tseng" | null` (the "corridor membership" field the master plan names explicitly — `null` for estates outside the 深井/青山公路/汀九 corridor), `branchId?: string` (matching `site-branches.js`'s branch `id` field), `hasPage: boolean`, `photo: string | null`.

Then make every one of the six existing sources **derive** from this registry rather than duplicate it:
- `core-estates.ts`'s `coreEstates` becomes a thin mapper/selector over `estateRegistry` (filtered/ordered to the 10 client-approved homepage entries) — preserve `CoreEstate`'s existing shape and `core-estates.test.mjs`'s "all ten client-approved estates ship in the client's order" assertion exactly.
- `estateSeo`/`estateAliases` (`seo.ts`) derive their slug/name/legacy-slug fields from the registry, keeping their own SEO-specific fields (title, description, intro, fit) as-is — this task doesn't touch SEO copy content, only removes the duplicated identity fields.
- `estatePageContent` (`estate-pages.ts`) similarly keeps its own prose fields, sources slug/name from the registry.
- `ESTATE_DB_SLUG_FALLBACKS` in `queries.ts` becomes derived (e.g. built once from `estateRegistry.filter(e => e.legacySlug).map(...)`) rather than a separately-hand-maintained object.
- `castle-peak-road.ts`'s segments: their `estateSlugs` arrays should be derivable as `estateRegistry.filter(e => e.corridorSegment === "sham-tseng").map(e => e.slug)` rather than hardcoded — but `featuredEstates` (free-text display strings, which include non-registry entries like "觀海別墅"/"Vista Del Mar" that aren't DB-backed estates at all) and `textAliases` (which include place names, not just estate names) stay as their own curated arrays — only the parts that are genuinely estate-identity duplication should move to derive from the registry; don't force-fit content that was never really the same data.
- `crm-rules.ts`'s `knownEstateInterestTags` and `segments.ts`'s `estateAliases`: derive from `estateRegistry`'s `aliases` field instead of hand-maintaining separate regex/tag lists for the same 5 estates.

### Tests

New `estate-registry.test.mjs`: the registry has exactly 10 entries matching `core-estates.ts`'s current `CLIENT_ORDER`; every `hasPage: true` entry has a corresponding `estateSeo`/`estatePageContent` entry and vice versa (no orphan on either side); `corridorSegment` values match what `castle-peak-road.ts`'s segments' `estateSlugs` currently contain; a contract test that the registry's slugs and `ESTATE_DB_SLUG_FALLBACKS`-derived legacy slugs stay consistent (this is the plan's "DB slugs and registry slugs cannot diverge" requirement — since this session has no live DB access, scope this as: the registry's slugs match what `estate.$slug.tsx`'s `estateSlugCandidates()` logic would actually resolve, not a live-DB round-trip).

Run every existing test that touches any of the six source files (`core-estates.test.mjs`, `estate-conversion.test.mjs`, `castle-peak-road.test.mjs`, and whatever covers `crm-rules.ts`/`segments.ts` — check `package.json`) and confirm they still pass unchanged, proving this was a real refactor (same external behavior) not a rewrite.

### Verify

```bash
npx tsc --noEmit
node --test src/content/estate-registry.test.mjs src/content/core-estates.test.mjs src/content/estate-conversion.test.mjs src/content/castle-peak-road.test.mjs
```
(Plus whichever script(s) cover `crm-rules.ts`/`segments.ts` — find and run them.)

Commit: `refactor(content): collapse the six-way estate identity drift into estate-registry.ts (DR-10)`

---

## Task 2: `estate_expansion` migration + 17 unpublished estate rows

**Files:**
- Create: `neon/migrations/<timestamp>_estate_expansion.sql`
- Modify: `src/lib/control-plane/migration-versions.js`
- Modify: `src/content/estate-registry.ts` (add the 17 new entries)
- Test: extend `src/lib/control-plane/migration-versions.test.mjs`'s coverage (it's a shared test file, confirm your new migration doesn't need a NEW test, just needs to pass the existing drift-check logic) and add registry tests for the new entries

**No database mutations from this session** — this sandbox may have a live, reachable `DATABASE_URL` (confirmed present in a prior phase, likely ephemeral). Do not run `npm run neon:migrate` or any mutating command. Writing the migration file and registering it in `migration-versions.js` is the deliverable; applying it is someone else's later step.

### What to build

1. **`districts` table**: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `slug TEXT NOT NULL UNIQUE`, `name_zh TEXT NOT NULL`, `name_en TEXT`, `created_at`/`updated_at`. Seed rows for the districts that genuinely exist in `properties`/`estates` data today — `sham-tseng`, `castle-peak-road`, `ting-kau`, `tsing-lung-tau` (four real, live district slugs per `corridorRegionScope.districtSlugs` minus the confirmed-dead `yau-kom-tau`, which the normalizer never assigns to anything — don't seed a district row for a slug nothing will ever reference).
2. **`estates.district_id UUID REFERENCES districts(id)`** (nullable), backfilled via `UPDATE estates SET district_id = (SELECT id FROM districts WHERE districts.slug = estates.district_slug) WHERE district_id IS NULL` — additive, keep `district_slug` as-is (don't drop it, per this repo's established "don't break what reads the old column" pattern).
3. **Relax `estates.district_slug` to nullable.** This is required, not optional: three of the 17 new estates (帝華軒、海韻台、龍騰閣) have genuinely unknown districts, and the master plan explicitly says "must not be guessed" — inserting a placeholder string would BE guessing. `ALTER TABLE estates ALTER COLUMN district_slug DROP NOT NULL`, with a comment explaining exactly why. Before doing this, grep every consumer of `estates.district_slug`/`estate.district_slug`/`NeonEstateSnapshot.district_slug` in `src/` and confirm each one already null-safely handles a missing district (most should, via existing `?? ""`/`stringOrEmpty` patterns established in P2/P3's work — but verify, don't assume, since this changes a column every public query touches indirectly via the `estates` join).
4. **`estates` new columns**: `aliases TEXT[]`, `address TEXT`, `blocks INT`, `school_net_code TEXT`, `verified_at TIMESTAMPTZ`, `transport_note TEXT` — all nullable, all additive.
5. **Insert the 17 estates**, `published = false`, only `slug`/`name_zh`/`name_en` (where an English name is given in the master plan's own text) /`district_slug` (14 of 17 — the 3 unknown ones get `NULL`) populated. Every fact column (`developer`, `year_completed`, `total_units`, `area_min/max`, `avg_saleable_psf`, `description`, `hero_image`, `facilities`, `lat`/`lng`, `address`, `blocks`, `school_net_code`, `verified_at`, `transport_note`) stays `NULL` — there is no verified source for any of them in this session. The 17 names (from the master plan, verbatim): 深井／汀九 — 海雲軒、帝華軒、海韻台、縉皇居、龍騰閣 (note: 海雲軒/帝華軒/海韻台/縉皇居/龍騰閣 already exist as **inert, DB-less** entries in `core-estates.ts` today — check whether Task 1's registry migration already represents them, and if so this migration is giving them a REAL DB row for the first time, not creating a duplicate; reconcile carefully). 青山公路 — 滿名山、黃金海岸、愛琴海岸、帝御、黃金海灣、星堤、上源、The Carmel、Oma Oma、漣山、浪濤灣、帝濤灣.
6. **Provisional slugs**: deterministic, reviewable transliteration (English name → kebab-case where one exists, e.g. `"The Carmel"` → `the-carmel`; Chinese-only names → a straightforward romanization you judge reasonable, e.g. `滿名山` → something like `mun-ming-shan` — there's no existing romanization table to match against in this codebase, use your best judgment and make it easy to grep/rename later). Comment the migration clearly: *"slugs below are provisional — not yet confirmed as permanent public URLs (open input #2, unresolved). Safe to rename freely while published=false, since nothing links to them publicly."*
7. Add corresponding entries to `estate-registry.ts` (Task 1's file) for all 17 — `hasPage: false`, `corridorSegment`: `null` for all 17 for now (per the master plan's D2 note, the 青山公路 group specifically "stays out of `corridorRegionScope`" even once published later — encode that as a deliberate `null`/exclusion now, not an oversight to fix later), `photo: null`.
8. Register the new migration filename in `migration-versions.js`.

### Tests

Extend registry tests: all 17 new entries present, `hasPage: false`, `corridorSegment: null`. A source-scan/contract test confirming the migration file sets `published = false` for every one of the 17 INSERTed rows (a regression guard against accidentally defaulting to the table's `published DEFAULT true`). `migration-versions.test.mjs` passes with the new entry registered.

### Verify

```bash
npx tsc --noEmit
node --test src/lib/control-plane/migration-versions.test.mjs src/content/estate-registry.test.mjs
```
Do **not** run `npm run check:migration-drift` or `npm run neon:migrate` — both touch the live sandbox database; the DB-independent unit test above is sufficient verification for this task.

Commit: `feat(estates): add estate_expansion migration with 17 unpublished estate rows`

---

## Task 3: wire `estates.seo_title`/`seo_description` into the public page

**Files:**
- Modify: `src/routes/estate.$slug.tsx`
- Modify: `src/lib/queries.ts`'s `EstateRecord` type (add the two fields)
- Test: extend whatever covers `estate.$slug.tsx` (check `test:seo`/`test:estate-conversion` scripts)

### What to build

`EstateRecord` (`queries.ts`) currently doesn't select `seo_title`/`seo_description` — add them (`string | null`). In `estate.$slug.tsx`'s `head()`, use them as the highest-priority override in the existing fallback chain: `estate.seo_title ?? estateSeo[slug]?.title ?? \`${estate.name_zh}...\`` (mirror the exact existing fallback pattern already in that function — read it first, extend it, don't restructure it). Same for description. This makes the admin CMS's existing, previously-inert form fields actually do something, resolving DR-10 by making them live rather than by removing them.

### Tests

A test confirming `estate.$slug.tsx`'s `head()` prefers `estate.seo_title`/`seo_description` when present, and falls back to the existing `estateSeo` entry when they're `null` — a real behavioral or source-scan test proving the priority order, not just that the fields are referenced somewhere.

### Verify

```bash
npx tsc --noEmit
```
(Run whichever test script you extended.)

Commit: `feat(estates): wire estates.seo_title/seo_description as a live SEO override (DR-10)`

---

## Task 4: estate template — verified-facts block, transport, school-net, PSF trend

**Files:**
- Modify: `src/routes/estate.$slug.tsx`
- Modify: `src/components/property/EstateMarketSnapshot.tsx` (or wherever you judge the PSF-trend chart fits best — read its current structure first)
- Test: extend `estate-conversion.test.mjs` or whatever covers this route

### What to build

1. **Verified-facts block**: replace the plain `estateFacts` array/join with a `DataNote`-wrapped presentation (same component P2's DR-5 fix already uses on `district.sham-tseng.tsx` — read that usage as your reference). Source/as-of should come from the estate's own `verified_at` (Task 2's new column — will be `null` for every estate right now, including the 5 existing ones with real detail pages, since none of them have ever been verified-with-a-date under this new column) — when `verified_at` is `null`, the `DataNote` should show a caveat that data hasn't been formally verified yet rather than a fabricated date, not omit the block entirely (the fact list itself is still real DB data, just not date-stamped).
2. **Transport section**: reuse `findCastlePeakRoadSegmentByDistrictSlug` (already built in P3 Task 7) against the estate's `district_slug`, rendering the matched segment's `transport` text in a dedicated section (not folded into the overview paragraph as it is today) when a match exists; omit entirely when it doesn't (this repo's established "hide, don't placeholder" convention).
3. **School-net section**: `school-nets.ts` today only has `shamTsengSchoolNet`. Render it when the estate's `district_slug` matches (`sham-tseng`); omit for estates in other districts rather than showing nothing-useful. Don't invent net data for other districts — that's exactly the DR-5 mistake this whole plan exists to avoid repeating.
4. **PSF-trend chart**: `district.sham-tseng.tsx` already has a `recharts` `LineChart` PSF-trend visualization fed by real transaction data — read that implementation and reuse the same charting approach for `EstateMarketSnapshot.tsx`, fed by the estate's own `fetchEstateTransactions` result (already loaded, already used for the existing 5-row table — this task adds a trend line over the same real data, not new data).

### Tests

Assertions: `DataNote` is used for the facts block; the transport section is gated by a real match/no-match condition (test both branches); the school-net section only renders for `sham-tseng`-district estates; the PSF chart renders (or a source-scan confirming the chart component/import is wired) using real transaction data, not synthetic.

### Verify

```bash
npx tsc --noEmit
```
(Run whichever test script you extended.)

Commit: `feat(estates): add verified-facts DataNote, transport, school-net, and PSF-trend sections to the estate template`

---

## Task 5: estate template — comparison with nearby estates

**Files:**
- Create: `src/components/property/EstateComparisonTable.tsx` (or your judgment on the best location — check `src/components/property/` vs a new `src/components/estate/` directory given this repo's existing organization)
- Modify: `src/routes/estate.$slug.tsx`
- Test: new or extended, matching whichever pattern you used for the component

### What to build

A compact side-by-side comparison of the current estate against up to 2 others sharing its `districtSlug` or `corridorSegment` (Task 1's registry fields) — name, avg PSF, total units, year completed, developer. Since most estates (including several of the original 5 with real detail pages) may be missing some of these facts, every cell needs the established em-dash-for-missing pattern (`estateFigure`, already in `core-estates.ts` — reuse it, don't reinvent). If fewer than 2 comparable estates exist (or none), render nothing for this section rather than a table with one column or a placeholder — this is exactly the kind of net-new UI where it's easy to accidentally ship a table that looks broken with sparse data; test the zero-comparables and one-comparable cases explicitly, not just the happy path.

### Tests

Real fixture-driven tests (or a behavioral extraction/execution test, matching this repo's established pattern for routes without a render harness) covering: 2 comparable estates present → table renders with 3 columns; 1 comparable → renders with 2; 0 comparable → section absent entirely; a missing fact renders as `—` via `estateFigure`, never blank or `0`.

### Verify

```bash
npx tsc --noEmit
```
(Run whichever test script you added/extended.)

Commit: `feat(estates): add nearby-estate comparison table to the estate template`

---

## Task 6: `/castle-peak-road` hub rebuild

**Files:**
- Modify: `src/routes/castle-peak-road.index.tsx`
- Test: extend `src/content/castle-peak-road.test.mjs`

### What to build

Every new section below is built from **already-curated content already in `castle-peak-road.ts`** (`housingProfile`, `buyerFit`, `transport`, `schoolNet`, `zoneSummary` per segment) plus Task 1's registry (estate directory, corridor membership) plus this route's existing loader data (`inventory` per segment). Do not invent new facts, prices, or data sources for any of these.

1. **Corridor schematic** (not a literal pin map, per this plan's "Ground truth" note on `lat`/`lng` uncertainty): a lightweight visual ordering the two live segments east-to-west (汀九 → 深井/青山公路), matching their real relative geography as already described in the segments' own intro copy. A simple horizontal sequence with labels is sufficient — this is about giving a first-glance sense of "where is this relative to that," not a literal map.
2. **Area-comparison table**: rows = each segment's `housingProfile`/`buyerFit`/`transport`/`schoolNet` (columns = the two segments), reusing existing curated text, not new copy.
3. **Estate directory**: for each segment, list the estates whose registry `corridorSegment` matches (Task 1) — link each to its detail page if `hasPage`, otherwise omit the link (or show it as "更多資料稍後提供" / similar — your judgment, but never link to a page that 404s).
4. **Scoped, labelled inventory counts**: replace the current raw `{segmentTotal(inventory)} 個即時放盤` with an explicit sale/rent breakdown (the loader already fetches both — `inventory.saleTotal`/`rentTotal`, confirmed available from P2's corridor work) and a clear scope label (e.g. "只計算[segment 名稱]範圍即時放盤").
5. **Price snapshot**: if `district.sham-tseng.tsx`'s existing PSF-trend data-fetching pattern (real transaction-derived, not invented) can be reused per-segment without a new query, do so, wrapped in a `DataNote` citing the data source and generation date. If reusing that pattern cleanly isn't feasible within this task's scope, it's acceptable to omit this specific sub-item and note why in your implementation report — do not fabricate a price figure to fill the section.
6. **「邊個區適合我？」decision guide**: a short guide comparing the two segments' `buyerFit` copy (already curated) in a more scannable format than prose — e.g. a short set of "if you want X, consider Y" pairings drawn directly from existing `buyerFit` text, not new claims.

### Tests

Extend `castle-peak-road.test.mjs`: the estate directory only lists estates whose registry `corridorSegment` matches; the inventory counts show sale/rent breakdown with a scope label; the price-snapshot section (if built) cites a source via `DataNote`; the decision guide references both segments and draws only from existing `buyerFit` copy (a source-scan proving no new unsourced claim was introduced is reasonable here).

### Verify

```bash
npx tsc --noEmit
npm run test:corridor
```

Commit: `feat(corridor): rebuild the castle-peak-road hub with an area-comparison table, estate directory, scoped inventory counts, and a decision guide`

---

## Task 7: district page polish — extend `DataNote` to transit and stats

**Files:**
- Modify: `src/routes/district.sham-tseng.tsx`
- Test: extend `src/routes/district.sham-tseng.test.mjs`

### What to build

P2's DR-5 fix already built and wired the `DataNote` pattern for this page's school-net card. Extend the same pattern (not a new one) to the `TRANSIT` array (transit-time list) and the header stat tiles — wrap each in a `DataNote` citing what's actually known about the data's source/freshness (e.g. for `TRANSIT`, if it's static curated copy with no real "as of" date, say so honestly — a `DataNote` with a caveat like "交通時間為一般估算，實際車程視乎路況" is more honest than an invented date). Also extend the existing bare "資料來源：本行成交記錄" transaction-source paragraph into the same `DataNote` component for visual/structural consistency with the rest of the page, rather than leaving it as a plain, differently-styled paragraph.

### Tests

Extend `district.sham-tseng.test.mjs`: `DataNote` usage count increases (transit + stats + transactions, not just school-net); no new unsourced claim was introduced (the caveat text, if any, doesn't assert false precision).

### Verify

```bash
npx tsc --noEmit
node --test src/routes/district.sham-tseng.test.mjs
```

Commit: `fix(district): extend DataNote source-citation to transit times and stat tiles`

---

## Task 8: redirects assessment + final verification

**Files:** none expected to change, unless Task 8's own audit finds something.

### What to do

1. **Redirects**: audit whether Task 1-7's work changed any PUBLICLY REACHABLE URL. It should not have — the 17 new estates are `published = false` (no route resolves them), the hub/district/estate-template changes are all in-place content additions, not slug/path changes. Confirm this explicitly (grep `vercel.ts`'s existing 36 entries, confirm none need updating) and record the "no redirects needed, here's why" conclusion in the eventual PR description rather than skipping it silently — matching how P3 explicitly documented the map-mode deferral instead of quietly doing nothing.
2. **Sitemap**: confirm `sitemap[.]xml.ts`'s existing `Object.values(estateSeo)`-based enumeration genuinely excludes all 17 new estates (since they're not in `estateSeo`, only in the new registry with `hasPage: false`) — if Task 1's refactor accidentally made `estateSeo` derive from ALL registry entries instead of just the `hasPage: true` subset, this would silently leak 17 unpublished, fact-less estate pages into the sitemap. This is worth a dedicated regression test, not just a read-through.

### Final verification (after all eight tasks)

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run test:corridor && npm run test:estate-conversion && npm run test:seo && npm run test:district
node --test src/content/estate-registry.test.mjs src/lib/control-plane/migration-versions.test.mjs
```

Per the master plan's P4 acceptance criteria, confirm by inspection:
- No estate appears on a public surface with an unverified fact or a missing photo (the 17 new estates are unpublished, so this is true by construction — confirm no code path renders an unpublished estate anyway).
- Registry and DB agree (Task 1/2's contract tests).
- Corridor scope unchanged (none of the 17 new estates join `corridorRegionScope` — confirm against P2's existing corridor-scope tests still passing unmodified).
- Every new/changed URL either resolves or 301s (Task 8's redirect audit).
