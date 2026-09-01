# Publish the 17-Estate Expansion + 青山公路 Home Section — Design

**Status:** Approved.

## Origin

Continues the 17-estate expansion (PR #102, merged to `main`): that phase
built the full plumbing — registry, page content, SEO, MLS aliases, a facts
migration — for all 17 new estates, deliberately leaving every one
`published = false` pending an individual publish-gate review, and
deliberately deferring a home page section for the 12 青山公路 estates until
real, publishable data existed.

That data now exists. The user has explicitly decided to publish now rather
than wait for the full publish gate (real photos, every fact conflict
resolved, EDB school-net confirmation) to clear first — accepting the
gaps below as acceptable to ship, not as an oversight.

## What "publish now" accepts

- **No real photos for any of the 17.** Every estate's homepage/detail-page
  photo slot falls back to this codebase's existing gradient placeholder —
  the same graceful fallback the original 5 core estates used before their
  own photos arrived. Not a new code path.
- **Several facts stay `NULL`** where the data pack itself documented a
  genuine cross-source conflict (e.g. 海雲軒's total units, 星堤's max area).
  These render as an em dash ("—"), never a fabricated number — this
  codebase's existing, consistently-enforced convention.
- **`verified_at` stays `NULL` for all 17.** That column is read by
  `estate.$slug.tsx`'s `DataNote` as a literal "a human confirmed this on
  this date" claim (`asOf={estate.verified_at ...}`) — setting it without
  genuine human verification would be a fabricated claim, which this
  codebase has never done anywhere else. The page already has a graceful,
  honest fallback for this exact case (`caveat`: "以上資料尚待人手覆核並標註核實日期"),
  so publishing without it is a supported state, not a broken one.

## Scope of work

### 1. Publish migration

New migration, `UPDATE estates SET published = true WHERE slug IN (<17
slugs>)`. Nothing else changes on these rows — no facts, no `verified_at`,
no district. Purely the publish flip this phase's whole design has been
building toward.

### 2. `src/content/castle-peak-road-estates.ts` (new)

The static 12-estate list for the home page's new 青山公路 section, in the
master spec's own canonical order (滿名山, 香港黃金海岸, 愛琴海岸, 帝御,
黃金海灣, 星堤, 上源, The Carmel, OMA OMA, 漣山, 浪濤灣, 帝濤灣) — mirrors
`core-estates.ts`'s own structure exactly: slug/name/photo/district sourced
from `estate-registry.ts` via `getEstateEntry()`, units/avgPsf/listingCount
always `null` here (merged from the live DB at render time, never hardcoded).

### 3. Parameterize `CoreEstateGrid` (`src/routes/index.tsx`)

Currently hardcodes the 深井 static list (`coreEstates`, a module-level
import) and its own preview count. Add two props — `staticEstates:
CoreEstate[]` and `districtLabel: string` (used in each card's photo-overlay
meta line, already rendering `estate.district`) — so the same component
renders both the existing 深井核心屋苑 grid and the new 青山公路 grid without
duplicating the ~100 lines of card markup, live-data merging, and the
hasPage-and-live-row gating this session's earlier work added. Every other
behavior (photo/gradient fallback, em-dash figures, expander at
`CORE_ESTATES_PREVIEW_COUNT`) stays shared and unchanged.

### 4. Home page loader

Add a second `fetchEstates({ districtSlug: "castle-peak-road" })` call
(that function already accepts an optional `districtSlug`, currently only
ever called with the `sham-tseng` default) alongside the existing one, so
the 12 青山公路 estates get real live avgPsf/unit figures merged the same
way the 深井 group already does. `fetchListingCountsByEstate()` needs no
change — confirmed already global, no district filter.

### 5. New home page section

A new `<section>` in `index.tsx`, "青山公路屋苑" (exact copy TBD at
implementation, matching this codebase's existing zh-HK-only heading
convention), placed immediately after the existing 深井核心屋苑 section —
same visual band treatment, same `SectionHeader` component, rendering
`<CoreEstateGrid estates={castlePeakRoadDbRows} counts={counts}
staticEstates={castlePeakRoadEstates} districtLabel="青山公路" />`.

## Testing

Source-scan/contract tests mirroring the existing `core-estates.test.mjs`
pattern: the new content file's 12 entries match `estate-registry.ts`
exactly (slug/name/photo/district, no invented figures); `CoreEstateGrid`'s
parameterization doesn't regress the existing 深井 grid's own tests (the
`homepage-copy.contract.test.mjs`/`site.test.mjs` source-scans this session
already wrote); the new section renders and gates identically to the
existing one (only shows a card once `live.has(slug)`, i.e. once that
specific estate is actually published). Migration contract test mirrors the
existing `estate-expansion-facts-migration.contract.test.mjs` pattern:
confirms exactly the 17 expected slugs get `published = true`, confirms no
other column changes.

## Explicitly out of scope

- Sourcing real photos — stays a follow-up whenever licensed images exist,
  same as the original 5 core estates' own history on this site.
- Resolving any of the data pack's documented fact conflicts — those stay
  `NULL` until someone actually resolves them against an authoritative
  source, not this phase's job.
- The `fetchEstates()` single-exact-district-match limitation for estates
  whose `districtSlug` is `tsing-lung-tau` (tai-wah-hin, lung-tang-kok) —
  already corrected in the DB (PR #102) and unaffected by this phase, since
  `fetchEstates()` is called per-district here (`sham-tseng` and
  `castle-peak-road` separately), and `tsing-lung-tau` was never one of
  those two calls either before or after this phase. Those two estates will
  still merge no live figures on the homepage even once published (same gap
  documented, not newly introduced) — their own `/estate/$slug` pages are
  unaffected, since those use `fetchEstateBySlug`, not `fetchEstates`.
- Applying the migration to a live database — this sandbox has no
  `DATABASE_URL`; the migration ships unapplied, same as every prior phase
  this session.
