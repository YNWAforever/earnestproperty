# P2 — Data Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land DR-1, DR-3, DR-4, DR-5, DR-6 and DR-8 from `docs/superpowers/plans/2026-08-28-frontend-revamp.md`'s defect register — the fixes that protect this site's credibility (no geographic leakage, no duplicate/malformed listings, no unverified school claims, no bloated structured data, no stray English in the zh-HK interface).

**Architecture:** Branch `feat/frontend-revamp-p2-data-trust` off `feat/frontend-revamp-p1-design-system` (P1's `format.ts`/`DataNote`/`AppImage` are dependencies here). Seven tasks, each independently testable and committed. No visual redesign, no new routes, no schema migration beyond one additive column backfill for DR-3.

**Tech Stack:** Same as the rest of the repo — TanStack Start, Neon (raw SQL via `queryRows`), `node --test` for `.test.mjs`, `bun test` for `.test.ts`/`.test.tsx`.

---

## Ground truth already verified (do not re-derive)

- `isWithinCorridorRegion()` (`src/content/castle-peak-road.ts:332-363`) already exists and correctly rejects `outOfScopeTextAliases` (屯門/大欖涌/小欖/掃管笏/黃金海岸/三聖) — it is applied at `fetchEstatesByDistrict` and `fetchFeaturedProperties` (`src/lib/queries.ts:90`, `:153`) but **not** inside `fetchCorridorInventoryForAliases` (`:269-281`), which is the actual leak (both the corridor hub page and every `/castle-peak-road/$segment` page use this unguarded path).
- Each row returned by the corridor query already carries everything `isWithinCorridorRegion()` needs: a top-level `district_slug` (from `properties.district_slug`, separate from the nested `estates.district_slug`) and `estates.slug`/`estates.name_zh`. No extra join needed.
- `p.status = 'active'` is already enforced identically in all four listing-read functions (`searchListings`, `fetchListingsForEstate`, `fetchSimilarListings`, `fetchCorridorInventoryForAliases`'s underlying `corridorWhere`) — DR-3's status concern is already satisfied; only dedup is missing.
- `properties.canonical_property_no TEXT` (nullable) already exists in the DB (added by `neon/migrations/20260817120000_dual_source_listing_sync.sql`, already indexed with `deal_type`) — no new migration needed for DR-3, just select and use the column.
- `src/lib/neon/public-data.server.ts`'s `listingColumns` string (lines 48-92) and `mapListingRow()` (lines 184-238) are shared by `searchListings`, `fetchListingsForEstate` (delegates to `searchListings`), `fetchSimilarListings`, and the corridor path's `fetchCorridorRows` — one change to each covers all four read paths.
- `src/lib/format.ts`'s `sanitizeListingText()` (lines 115-128) already exists, is unit-tested, and has **zero production call sites** — DR-4 is pure wiring, no new logic.
- `src/lib/faq.ts`'s `renderableFaqs()` guard is **already applied at all five FAQ-rendering surfaces** (`index.tsx:161`, `estate.$slug.tsx:89`, `castle-peak-road.index.tsx:122`, `district.sham-tseng.tsx:126`, `castle-peak-road.$segment.tsx:229`) — this item in the master plan's P2 scope is already satisfied. Task 7 below adds a regression test so it stays that way, rather than re-implementing something that already works.

---

## Task 1: DR-1 — corridor strict/nearby split + region-guard inside `fetchCorridorInventoryForAliases`

**Files:**
- Modify: `src/content/castle-peak-road.ts`
- Modify: `src/lib/queries.ts`
- Modify: `src/components/site/CorridorInventory.tsx`
- Modify: `src/routes/castle-peak-road.$segment.tsx`
- Test: `src/content/castle-peak-road.test.mjs` (extend)
- Test (new): `src/lib/neon/corridor-scope.contract.test.mjs`

### Step 1: Add `nearbyDistrictSlugs`/`nearbyEstateSlugs`/`nearbyTextAliases` to `CorridorSegment`, split Ting Kau's aliases

In `src/content/castle-peak-road.ts`, extend the type (after line 46, right after the existing `textAliases: string[];`):

```ts
export type CorridorSegment = {
  slug: string;
  path: string;
  nameZh: string;
  nameEn: string;
  eyebrow: string;
  title: string;
  description: string;
  h1: string;
  intro: string[];
  zoneSummary: string[];
  buyerFit: string;
  transport: string;
  schoolNet?: string;
  housingProfile: string;
  featuredEstates: string[];
  districtSlugs: string[];
  estateSlugs: string[];
  textAliases: string[];
  /**
   * A broader, explicitly-labelled "附近選擇" (nearby) result set — content
   * that borders this segment but isn't claimed as its own strict inventory.
   * Empty arrays mean the segment has no separate nearby block. Both the
   * strict and nearby sets are still passed through isWithinCorridorRegion()
   * inside fetchCorridorInventoryForAliases, so neither can ever surface
   * corridorRegionScope.outOfScopeTextAliases stock.
   */
  nearbyDistrictSlugs: string[];
  nearbyEstateSlugs: string[];
  nearbyTextAliases: string[];
  faqs: CorridorFaq[];
  links: CorridorLink[];
};
```

Update Ting Kau's entry (replace lines 115-116):

```ts
    // "castle-peak-road" is the normalizer's catch-all for anything mentioning
    // 青山公路 that didn't match a more specific district (src/lib/mls/normalize-old-site.mjs:24-29)
    // -- a road that runs all the way to 屯門, so it cannot be Ting Kau's own
    // strict district. It moves to the nearby set below instead of being
    // dropped outright, so a genuinely nearby castle-peak-road-tagged listing
    // is still visible, just honestly labelled 附近選擇 rather than claimed as
    // Ting Kau's own stock. "yau-kom-tau" is dropped entirely, not moved: the
    // normalizer never assigns it (confirmed dead -- 油柑頭 stock actually
    // normalises to "tsuen-wan" and is recovered via the textAliases below).
    districtSlugs: ["ting-kau"],
    estateSlugs: [],
    textAliases: [
      "汀九",
      "Ting Kau",
      "青山公路汀九段",
      "觀海別墅",
      "Vista Del Mar",
      "嘉御龍庭",
      "Royal Dragon Villa",
      "汀九別墅",
      "Ting Kau Villa",
      "油柑頭",
      "Yau Kom Tau",
      "海雲軒",
      "縉皇居",
    ],
    nearbyDistrictSlugs: ["castle-peak-road"],
    nearbyEstateSlugs: [],
    nearbyTextAliases: [],
```

Add empty nearby arrays to the sham-tseng segment (after its existing `textAliases` array, i.e. after line 218's closing `],`):

```ts
    nearbyDistrictSlugs: [],
    nearbyEstateSlugs: [],
    nearbyTextAliases: [],
```

`sham-tseng` keeps its existing `districtSlugs: ["sham-tseng", "tsing-lung-tau", "castle-peak-road"]` untouched — the master plan's fix instruction only names Ting Kau's strict set for the split; `castle-peak-road` stays a legitimate district-slug member there. It is still protected by the new `isWithinCorridorRegion()` post-filter added in Step 2.

### Step 2: Apply `isWithinCorridorRegion()` inside `fetchCorridorInventoryForAliases`

In `src/lib/queries.ts`, replace the body of `fetchCorridorInventoryForAliases` (lines 269-281):

```ts
function withinCorridorScope(row: ListingRow): boolean {
  return isWithinCorridorRegion({
    districtSlug: row.district_slug,
    estateSlug: row.estates?.slug ?? null,
    estateDistrictSlug: row.estates?.district_slug ?? null,
    text: [row.title_zh, row.address],
  });
}

export async function fetchCorridorInventoryForAliases(
  input: CorridorInventoryAliasInput,
): Promise<CorridorInventory> {
  const normalized = normalizeCorridorInventoryInput(input);
  if (!hasCorridorAliases(normalized)) return emptyCorridorInventory();
  const result = await fetchNeonCorridorInventory({ data: normalized });
  // saleTotal/rentTotal are SQL-computed counts against the same alias set
  // used for the rows below; they are not re-derived from the filtered rows.
  // The strict-alias cleanup in castle-peak-road.ts already removes the
  // primary leak vector at the SQL WHERE-clause level, so this filter is a
  // second, defense-in-depth layer against any residual text-alias match --
  // in the rare case it drops a row, the displayed total can be very slightly
  // higher than the rendered row count, the same way FEATURED_FETCH_LIMIT
  // above already over-fetches relative to what's displayed.
  return {
    saleTotal: result.saleTotal,
    rentTotal: result.rentTotal,
    saleRows: (result.saleRows as ListingRow[]).filter(withinCorridorScope),
    rentRows: (result.rentRows as ListingRow[]).filter(withinCorridorScope),
  };
}
```

`ListingRow` (line 201-218) already includes `estates` via its `Pick<NeonPropertyRow, ... | "estates">`, but does **not** currently pick `"district_slug"` or `"address"` — add both to the `Pick` list:

```ts
export type ListingRow = Pick<
  NeonPropertyRow,
  | "id"
  | "listing_no"
  | "title_zh"
  | "deal_type"
  | "price"
  | "rent"
  | "saleable_area"
  | "bedrooms"
  | "bathrooms"
  | "floor"
  | "last_seen_at"
  | "source_site"
  | "images"
  | "video_url"
  | "district_slug"
  | "address"
  | "estates"
>;
```

### Step 3: Render the nearby block on the segment page

In `src/components/site/CorridorInventory.tsx`, make the heading/eyebrow configurable (defaults match current text exactly, so the primary call site needs no change):

```ts
export function CorridorInventory({
  inventory,
  inquiryText,
  listingsHref,
  eyebrow = "Live Listings",
  heading = "即時放盤",
  description = "放盤數字來自網站已接入的公開真盤資料，實際可睇盤源可 WhatsApp 再確認。",
}: {
  inventory: CorridorInventoryData;
  inquiryText: string;
  listingsHref: string;
  eyebrow?: string;
  heading?: string;
  description?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-bold text-primary">{heading}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
```

(Rest of the component body is unchanged — only the three literals in that header block become props with defaults.)

In `src/routes/castle-peak-road.$segment.tsx`, fetch the nearby inventory alongside the strict one in the loader (replace lines 29-41):

```ts
  loader: async ({ params }): Promise<SegmentLoaderData> => {
    const segment = getCastlePeakRoadSegment(params.segment);
    if (!segment) throw notFound();

    const [inventory, nearbyInventory] = await Promise.all([
      fetchCorridorInventoryForAliases({
        districtSlugs: segment.districtSlugs,
        estateSlugs: segment.estateSlugs,
        textAliases: segment.textAliases,
        limit: 6,
      }),
      fetchCorridorInventoryForAliases({
        districtSlugs: segment.nearbyDistrictSlugs,
        estateSlugs: segment.nearbyEstateSlugs,
        textAliases: segment.nearbyTextAliases,
        limit: 6,
      }),
    ]);

    return { segment, inventory, nearbyInventory };
  },
```

Update `SegmentLoaderData` (line 21-24):

```ts
type SegmentLoaderData = {
  segment: CorridorSegment;
  inventory: CorridorInventoryData;
  nearbyInventory: CorridorInventoryData;
};
```

In `CastlePeakRoadSegmentPage` (line 207-208), destructure the new field and render a second block after the existing `<CorridorInventory>` call (after line 350's closing `</section>`, i.e. right after the primary inventory section):

```ts
  const { segment, inventory, nearbyInventory } = Route.useLoaderData() as SegmentLoaderData;
```

```tsx
      {(nearbyInventory.saleRows.length > 0 || nearbyInventory.rentRows.length > 0) && (
        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <CorridorInventory
            inventory={nearbyInventory}
            inquiryText={`你好，我想查詢${segment.nameZh}附近盤源`}
            listingsHref={getSegmentListingsHref(segment)}
            eyebrow="附近地段"
            heading="附近選擇"
            description="呢啲放盤鄰近呢個分段，但唔屬於呢個分段嘅核心範圍，可 WhatsApp 查詢實際位置。"
          />
        </section>
      )}
```

Also update `allListings` (line 209) to only reflect the strict `inventory` for the page's `ItemList` JSON-LD (it already does — no change needed there, just confirming the nearby block's rows never enter that JSON-LD, keeping structured data scoped to what the page claims as its own).

### Step 4: Extend `src/content/castle-peak-road.test.mjs`

Add assertions that Ting Kau's strict set no longer contains the leak vectors, and that the nearby set does:

```js
test("Ting Kau's strict alias set excludes the castle-peak-road catch-all and the dead yau-kom-tau slug", () => {
  const tingKau = castlePeakRoadSegments.find((s) => s.slug === "ting-kau");
  assert.ok(tingKau);
  assert.deepStrictEqual(tingKau.districtSlugs, ["ting-kau"]);
  assert.ok(!tingKau.districtSlugs.includes("castle-peak-road"));
  assert.ok(!tingKau.districtSlugs.includes("yau-kom-tau"));
});

test("Ting Kau's nearby set carries the castle-peak-road catch-all", () => {
  const tingKau = castlePeakRoadSegments.find((s) => s.slug === "ting-kau");
  assert.ok(tingKau);
  assert.deepStrictEqual(tingKau.nearbyDistrictSlugs, ["castle-peak-road"]);
});

test("every segment declares nearby alias arrays, even when empty", () => {
  for (const segment of castlePeakRoadSegments) {
    assert.ok(Array.isArray(segment.nearbyDistrictSlugs));
    assert.ok(Array.isArray(segment.nearbyEstateSlugs));
    assert.ok(Array.isArray(segment.nearbyTextAliases));
  }
});
```

### Step 5: New `src/lib/neon/corridor-scope.contract.test.mjs`

This test exercises `fetchCorridorInventoryForAliases` end-to-end against fixture rows, using the same `importPublicDataServerWithInjectedQuery`-style query-injection pattern already used in `listing-search.contract.test.mjs` (read that file's helper first and reuse it rather than reinventing it). Given fixture listings whose `district_slug` is `"castle-peak-road"` and whose `title_zh`/`address` mention 掃管笏, 黃金海岸, 大欖涌, or 屯門 (i.e. rows that WOULD match Ting Kau's old, leaky districtSlugs but sit in `corridorRegionScope.outOfScopeTextAliases`):

```js
import assert from "node:assert/strict";
import test from "node:test";

import { fetchCorridorInventoryForAliases } from "../queries.ts";

// Reuses the query-injection helper pattern from listing-search.contract.test.mjs
// to stub fetchNeonCorridorInventory's server-fn boundary with fixture rows,
// rather than hitting a real database.
```

(The implementer should read `listing-search.contract.test.mjs`'s existing injection helper in full before writing this file, and mirror its exact mechanism — do not invent a different mocking approach for the same boundary.)

Assertions required:
- A fixture row with `district_slug: "castle-peak-road"`, `title_zh` containing "屯門" is **excluded** from `fetchCorridorInventoryForAliases({ districtSlugs: ["ting-kau"], estateSlugs: [], textAliases: [...Ting Kau's real textAliases] })`'s `saleRows`/`rentRows`.
- Same for fixture rows mentioning 掃管笏, 黃金海岸, 大欖涌.
- A genuine Ting Kau row (`district_slug: "ting-kau"`, `title_zh: "汀九別墅"`) **is** included.
- Calling with Ting Kau's `nearbyDistrictSlugs: ["castle-peak-road"]` returns a row whose `district_slug` is `"castle-peak-road"` and which does **not** match any `outOfScopeTextAliases` term.

### Step 6: Run tests, verify, commit

```bash
node --test src/content/castle-peak-road.test.mjs src/lib/neon/corridor-scope.contract.test.mjs
npx tsc --noEmit
```

Expected: all pass, 0 new type errors.

```bash
git add src/content/castle-peak-road.ts src/lib/queries.ts src/components/site/CorridorInventory.tsx src/routes/castle-peak-road.\$segment.tsx src/content/castle-peak-road.test.mjs src/lib/neon/corridor-scope.contract.test.mjs
git commit -m "fix(corridor): split Ting Kau's strict/nearby aliases and guard fetchCorridorInventoryForAliases (DR-1)"
```

---

## Task 2: DR-3 — `dedupeListings` + `canonical_property_no` plumbing

**Files:**
- Modify: `src/lib/neon/public-data.server.ts`
- Modify: `src/lib/neon/public-data.types.ts`
- Modify: `src/lib/queries.ts`
- Test: `src/lib/neon/listing-search.contract.test.mjs` (extend)

### Step 1: Select `canonical_property_no` in the shared column list

In `src/lib/neon/public-data.server.ts`, add to `listingColumns` (after `p.listing_no,` at line 50):

```ts
  p.listing_no,
  p.canonical_property_no,
```

In `mapListingRow()` (after `listing_no: stringOrEmpty(row.listing_no),` at line 203):

```ts
    listing_no: stringOrEmpty(row.listing_no),
    canonical_property_no: stringOrNull(row.canonical_property_no),
```

### Step 2: Add the field to `NeonPropertyRow`

In `src/lib/neon/public-data.types.ts`, add `canonical_property_no: string | null;` immediately after the existing `listing_no: string;` field (both in the main row shape, matching the `mapListingRow` mapping above).

### Step 3: Add `canonical_property_no` to `ListingRow` and `SimilarListing`

In `src/lib/queries.ts`:

`ListingRow`'s `Pick` (already being extended in Task 1 Step 2 above with `district_slug`/`address` — add `"canonical_property_no"` to that same list):

```ts
export type ListingRow = Pick<
  NeonPropertyRow,
  | "id"
  | "listing_no"
  | "canonical_property_no"
  | "title_zh"
  | "deal_type"
  | "price"
  | "rent"
  | "saleable_area"
  | "bedrooms"
  | "bathrooms"
  | "floor"
  | "last_seen_at"
  | "source_site"
  | "images"
  | "video_url"
  | "district_slug"
  | "address"
  | "estates"
>;
```

`SimilarListing` (lines 361-371, defined independently, not via `Pick`) — add the field:

```ts
export type SimilarListing = {
  id: string;
  listing_no: string;
  canonical_property_no: string | null;
  title_zh: string;
  deal_type: "sale" | "rent";
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  images: string[] | null;
};
```

`fetchSimilarListings` (lines 373-382) currently does `return (await fetchNeonSimilarListings({...})) as SimilarListing[];` — a raw cast from `NeonPropertyRow[]`. Since `NeonPropertyRow` now carries `canonical_property_no` (Step 2) and `SimilarListing` now expects it too, the existing cast continues to work with no further change, since the field name and type match exactly.

### Step 4: `dedupeListings` helper

In `src/lib/queries.ts`, add near the other corridor helper functions (after `emptyCorridorInventory()`, before `fetchCorridorInventoryForAliases`):

```ts
/**
 * De-duplicates listing rows by canonical_property_no + deal_type -- the
 * identity the MLS import pipeline already establishes at write time
 * (src/lib/mls/match.mjs), but which the render paths never enforced. Falls
 * back to listing_no when canonical_property_no is null, since two rows
 * that both lack a canonical number are not known to be the same property.
 * Keeps the first occurrence, which callers already order by
 * `featured DESC, last_seen_at DESC NULLS LAST, created_at DESC` -- so the
 * kept row is the freshest/most-featured of any duplicate pair.
 */
function dedupeListings<T extends { listing_no: string; canonical_property_no?: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const key = row.canonical_property_no
      ? `canonical:${row.canonical_property_no}`
      : `listing:${row.listing_no}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}
```

Note: this keys on `canonical_property_no` alone (not `+ deal_type`) because within a single query's result set, deal type is already homogeneous per logical grouping (`searchListings` is filtered by `f.deal`, `fetchCorridorInventory`'s `saleRows`/`rentRows` are already split by `deal_type`, `fetchSimilarListings` takes an explicit `dealType` param) — two rows sharing `canonical_property_no` inside one of these result arrays are always the same deal type already, so the `deal_type` half of the compound key would be redundant here. If the implementer finds a call site where this assumption doesn't hold (mixed deal types in one array being deduped), key on `` `${canonical_property_no}:${deal_type}` `` there instead and note why in a comment.

### Step 5: Apply at the four call sites

`searchListings` (lines 283-304) — dedupe before returning, in both the direct-match and fallback-candidate branches:

```ts
export async function searchListings(f: ListingFilters): Promise<{
  rows: ListingRow[];
  total: number;
}> {
  const candidates = f.estateSlug ? estateSlugCandidates(f.estateSlug) : [undefined];
  let lastResult: Awaited<ReturnType<typeof searchNeonListings>> | null = null;

  for (const estateSlug of candidates) {
    const result = await searchNeonListings({
      data: { ...f, estateSlug },
    });
    if (!f.estateSlug || result.total > 0) {
      return { rows: dedupeListings(result.rows as ListingRow[]), total: result.total };
    }
    lastResult = result;
  }

  return {
    rows: dedupeListings((lastResult?.rows ?? []) as ListingRow[]),
    total: lastResult?.total ?? 0,
  };
}
```

`fetchListingsForEstate` (lines 343-351):

```ts
export async function fetchListingsForEstate(estateSlug: string, limit = 6): Promise<ListingRow[]> {
  for (const candidate of estateSlugCandidates(estateSlug)) {
    const rows = (await fetchNeonListingsForEstate({
      data: { estateSlug: candidate, limit },
    })) as ListingRow[];
    if (rows.length > 0) return dedupeListings(rows);
  }
  return [];
}
```

`fetchSimilarListings` (lines 373-382):

```ts
export async function fetchSimilarListings(
  estateId: string,
  dealType: "sale" | "rent",
  excludeId: string,
  limit = 4,
): Promise<SimilarListing[]> {
  const rows = (await fetchNeonSimilarListings({
    data: { estateId, dealType, excludeId, limit },
  })) as SimilarListing[];
  return dedupeListings(rows);
}
```

`fetchCorridorInventoryForAliases` (as modified in Task 1 Step 2) — apply dedup after the region-scope filter:

```ts
  return {
    saleTotal: result.saleTotal,
    rentTotal: result.rentTotal,
    saleRows: dedupeListings((result.saleRows as ListingRow[]).filter(withinCorridorScope)),
    rentRows: dedupeListings((result.rentRows as ListingRow[]).filter(withinCorridorScope)),
  };
```

### Step 6: Extend `src/lib/neon/listing-search.contract.test.mjs`

Read the existing file's structure first (it already tests `listingColumns`/SQL shape via query injection and imports from `queries.ts` or `public-data.server.ts` directly — match its existing style). Add:

- A SQL-contract assertion that `canonical_property_no` appears in the `SELECT` list built by `listingColumns` (mirror the existing `assert.match(sql, /WHERE status = 'active'/)` pattern at line 276).
- Unit tests for `dedupeListings` behavior against fixture row arrays:
  - Two rows with the same `canonical_property_no` → only the first survives.
  - Two rows with `canonical_property_no: null` but different `listing_no` → both survive (not falsely merged).
  - Two rows with `canonical_property_no: null` and the same `listing_no` → only the first survives.
  - A mixed array (some rows with canonical numbers, some without) dedupes each row independently by whichever key it has.

If `dedupeListings` is not exported from `queries.ts` today (it's written as a private helper above), export it for this test file to import directly: change `function dedupeListings` to `export function dedupeListings` in Step 4.

### Step 7: Run tests, verify, commit

```bash
node --test src/lib/neon/listing-search.contract.test.mjs
npx tsc --noEmit
```

```bash
git add src/lib/neon/public-data.server.ts src/lib/neon/public-data.types.ts src/lib/queries.ts src/lib/neon/listing-search.contract.test.mjs
git commit -m "fix(listings): dedupe by canonical_property_no across all four read paths (DR-3)"
```

---

## Task 3: DR-4 — wire `sanitizeListingText` into render and metadata

**Files:**
- Modify: `src/routes/property.$listingNo.tsx`
- Modify: `src/routes/listings.tsx`
- Modify: `src/components/site/CorridorInventory.tsx`
- Modify: `src/routes/castle-peak-road.$segment.tsx`
- Test: extend the relevant existing route/component test files (see below)

`sanitizeListingText(input: string | null | undefined): string | null` (`src/lib/format.ts:115-128`) strips control characters, trims wrapping quotes, collapses repeated `,,,`-style delimiters, and returns `null` for empty or exactly `NaN`/`null`/`undefined`/`- 房`/`$0`. Import it as `import { sanitizeListingText } from "@/lib/format";` in each file below (add to the existing `@/lib/format` import if one is already present from P1's DR-2 wiring).

### Step 1: `src/routes/property.$listingNo.tsx`

Wrap every raw `title_zh`/`description`/`address` interpolation. Apply once, close to the data, rather than re-sanitizing at every JSX call site: introduce local `const safeTitle = sanitizeListingText(property.title_zh) ?? property.title_zh;` (fallback to the raw value only if sanitization would leave nothing to show — an empty title is worse than an unsanitized one) near the top of the component/`head()`, and `const safeDescription = sanitizeListingText(property.description);` (may legitimately be `null` — the description section already needs a "no description" branch; check whether one exists, and if not, treat a `null` result as "don't render the paragraph" rather than rendering the literal word "null").

Specifically:
- `head()` (lines 111-112): use `safeTitle` in place of `p.title_zh`, `sanitizeListingText(p.description)` in place of the raw `.slice(0, 150)` source (sanitize first, then slice).
- JSON-LD `@graph` (lines 294, 295, 308, 311, 339): `name: safeTitle`, `description: safeDescription ?? undefined`, `streetAddress: sanitizeListingText(property.address) ?? undefined`.
- JSX body (lines 401, 406, 605): `{safeTitle}` for the h1, `{sanitizeListingText(property.address)}` for the address paragraph (guard rendering the whole paragraph if this comes back `null`), `{safeDescription}` for the 物業描述 section (render an "暫無詳細描述" fallback, matching this repo's established `EmptyState`/fallback-text convention, rather than an empty `<p>`, when `safeDescription` is `null`).
- Image `alt` text (lines 497, 517, 562) and similar-listings card (lines 827, 834): use `safeTitle` (and the equivalent sanitized value for `listing.title_zh` in the similar-listings loop — introduce a small local helper or inline `sanitizeListingText(listing.title_zh) ?? listing.title_zh` at that call site).

### Step 2: `src/routes/listings.tsx`

- Line 113 (`itemListSchema`/JSON-LD): `name: sanitizeListingText(row.title_zh) ?? row.title_zh`.
- Lines 413, 424 (`alt`, `<h3>`): same pattern — sanitize with a raw fallback so a card never goes fully blank, but never surfaces a literal `NaN`/`null`/`$0` token.

### Step 3: `src/components/site/CorridorInventory.tsx`

`ListingMiniCard` (lines 23-70) interpolates `listing.title_zh` at line 35 (`alt`) and line 43 (`<h3>`). Apply the same `sanitizeListingText(listing.title_zh) ?? listing.title_zh` pattern at both.

### Step 4: `src/routes/castle-peak-road.$segment.tsx`

The `ItemList` JSON-LD at line 246 (`name: listing.title_zh`) — sanitize the same way: `name: sanitizeListingText(listing.title_zh) ?? listing.title_zh`.

### Step 5: Tests

Since none of `property.$listingNo.tsx`/`listings.tsx`/`CorridorInventory.tsx`/`castle-peak-road.$segment.tsx` currently has a dedicated unit-test file exercising rendered output against fixture data with malformed text (confirm this by checking what test scripts already cover these files — `test:property-experience`, `test:listing-search`, `test:corridor` per `package.json`), add a source-scan-style regression test instead, matching this repo's existing pattern (e.g. `castle-peak-road.test.mjs`'s existing source-text regex assertions): a new test in `src/lib/format.test.ts` is NOT the right place (that file tests `format.ts` in isolation, already fully covers `sanitizeListingText` itself). Instead add one assertion per modified file to the test script that already covers it, confirming the import and usage exist:

```js
test("property.$listingNo.tsx sanitizes title/description/address before rendering", () => {
  const source = readFileSync("src/routes/property.$listingNo.tsx", "utf8");
  assert.match(source, /import \{[^}]*sanitizeListingText[^}]*\} from "@\/lib\/format"/);
  // At least one call site per field family, not an exhaustive count -- the
  // goal is catching a future raw-interpolation regression, not pinning the
  // exact number of call sites.
  assert.match(source, /sanitizeListingText\(property\.title_zh\)/);
  assert.match(source, /sanitizeListingText\(property\.description\)/);
  assert.match(source, /sanitizeListingText\(property\.address\)/);
});
```

Add the equivalent source-scan assertion (checking for the `sanitizeListingText(` import and at least one call against the relevant raw field) to whichever `.test.mjs`/`.test.tsx` file already exercises each of the other three files — check `package.json`'s `test:property-experience`, `test:listing-search`, and `test:corridor` script definitions to find the exact existing test file names before adding to them (do not create new test files for this task; every one of these four route/component files is already covered by an existing script).

### Step 6: Run tests, verify, commit

```bash
npm run test:property-experience && npm run test:listing-search && npm run test:corridor
npx tsc --noEmit
```

```bash
git add src/routes/property.\$listingNo.tsx src/routes/listings.tsx src/components/site/CorridorInventory.tsx src/routes/castle-peak-road.\$segment.tsx
git commit -m "fix(listings): sanitize imported listing text before render and metadata (DR-4)"
```

---

## Task 4: DR-5 — `school-nets.ts` + `DataNote`, applied to `district.sham-tseng.tsx`

**Files:**
- Create: `src/content/school-nets.ts`
- Modify: `src/routes/district.sham-tseng.tsx`
- Test: `src/content/castle-peak-road.test.mjs` (extend), new `src/routes/district.sham-tseng.test.mjs`

Per the master plan's explicit instruction: **no Education Bureau source list was supplied as part of this session's inputs (open input #6 remains unresolved)**. Per the plan's own fallback rule — *"If the EDB list is not supplied, ship the caveat and the net code, and omit the school list. Do not carry the current five names forward on trust."* — this task removes the hardcoded five-school list entirely rather than re-publishing it unverified, and ships only the net code + caveat + a `primarySchools: []`-shaped structure ready to populate once a verified source exists.

### Step 1: `src/content/school-nets.ts`

```ts
export type SchoolNet = {
  netCode: string;
  districtLabel: string;
  primarySchools: Array<{ name: string; type: string }>;
  source: string;
  sourceUrl: string | null;
  verifiedOn: string | null;
  admissionYear: string | null;
};

/**
 * Deliberately empty primarySchools: no Education Bureau 《小一入學統一派位
 * 選校名冊》/學校網名冊 source has been supplied (open input #6 in
 * docs/superpowers/plans/2026-08-28-frontend-revamp.md). The previous
 * hardcoded five-school list in district.sham-tseng.tsx was never sourced
 * from that register and is not carried forward. Populate primarySchools,
 * source, sourceUrl, verifiedOn and admissionYear together, from the EDB
 * register only, once it is supplied -- do not add named schools from any
 * other source (property portals, blogs, agent knowledge).
 */
export const shamTsengSchoolNet: SchoolNet = {
  netCode: "62",
  districtLabel: "荃灣",
  primarySchools: [],
  source: "教育局",
  sourceUrl: null,
  verifiedOn: null,
  admissionYear: null,
};
```

### Step 2: Replace the `SCHOOLS` block in `district.sham-tseng.tsx`

Remove the `SCHOOLS` array (lines 98-104) entirely. Add the import:

```ts
import { shamTsengSchoolNet } from "@/content/school-nets";
import { DataNote } from "@/components/layout/DataNote";
```

Replace the school-net `CardContent` block (lines 246-263):

```tsx
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              深井屬荃灣 {shamTsengSchoolNet.netCode} 校網。
            </p>
            {shamTsengSchoolNet.primarySchools.length > 0 ? (
              <ul className="space-y-2">
                {shamTsengSchoolNet.primarySchools.map((s) => (
                  <li
                    key={s.name}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <span>{s.name}</span>
                    <Badge variant="outline">{s.type}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <DataNote
              className="mt-4"
              source={shamTsengSchoolNet.source}
              sourceUrl={shamTsengSchoolNet.sourceUrl ?? undefined}
              asOf={shamTsengSchoolNet.verifiedOn ?? undefined}
              caveat="實際派位及校網資料以教育局最新公布為準，並因應個別地址及入學年度而有所不同。"
            >
              中學屬荃灣中學校網。
            </DataNote>
          </CardContent>
```

`Badge` import stays (still used elsewhere in the file per the earlier grep — `<Badge variant="secondary" className="mb-3">` at line 137 — do not remove that import).

### Step 3: Extend `src/content/castle-peak-road.test.mjs`'s DR-5 assertion

The existing assertion at line 341 (`assert.match(source, /school net 62|62 校網/);`) checks generic net-code text in `castle-peak-road.ts` and is still correct — leave it. Add a new, separate assertion (do not conflate the two files) confirming `castle-peak-road.ts`'s `schoolNet` fields still carry only the generic, already-hedged text and never a named school:

```js
test("castle-peak-road.ts never names a specific school in schoolNet copy", () => {
  for (const segment of castlePeakRoadSegments) {
    if (!segment.schoolNet) continue;
    assert.doesNotMatch(segment.schoolNet, /小學|中學校?$/); // generic net-code sentences only, no "XX小學" style names
  }
});
```

(Adjust the regex if it produces a false positive against the real current copy — verify against the actual `schoolNet` strings in the file before finalizing; the intent is "no proper-noun school name", not a syntactic ban on the characters 小學/中學 appearing at all in a generic sentence like "中學屬荃灣中學校網".)

### Step 4: New `src/routes/district.sham-tseng.test.mjs`

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("district.sham-tseng.tsx no longer hardcodes a named school list", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  assert.doesNotMatch(source, /const SCHOOLS = \[/);
  assert.doesNotMatch(source, /深井天主教小學/);
  assert.match(source, /import \{ shamTsengSchoolNet \} from "@\/content\/school-nets"/);
  assert.match(source, /<DataNote/);
});

test("school-nets.ts ships no named school without a source", () => {
  // Import dynamically since this is a .ts module consumed by a .mjs test,
  // matching the pattern already used elsewhere in this repo for .js/.ts
  // content modules imported from node --test files.
  const source = readFileSync("src/content/school-nets.ts", "utf8");
  assert.match(source, /primarySchools: \[\]/);
});
```

Wire this new file into `package.json`'s test matrix. There is no existing script covering `district.sham-tseng.tsx` specifically (`test:command-center` and others don't touch it) — add a new script:

```json
"test:district": "node --test src/routes/district.sham-tseng.test.mjs",
```

Add `test:district` to `.github/workflows/ci.yml`'s test-script list (the file already has a `# Added during P1` comment block showing where new scripts were inserted for the previous phase — add this one in the same style, noting `# Added during P2`).

### Step 5: Run tests, verify, commit

```bash
node --test src/content/castle-peak-road.test.mjs src/routes/district.sham-tseng.test.mjs
npx tsc --noEmit
```

```bash
git add src/content/school-nets.ts src/routes/district.sham-tseng.tsx src/content/castle-peak-road.test.mjs src/routes/district.sham-tseng.test.mjs package.json .github/workflows/ci.yml
git commit -m "fix(content): remove unverified school list, ship net code + DataNote caveat only (DR-5)"
```

---

## Task 5: DR-6 — cap `videos.tsx`'s JSON-LD to what's actually rendered

**Files:**
- Modify: `src/routes/videos.tsx`
- Test: `src/routes/videos.contract.test.mjs` (extend)

### Step 1: Pass the rendered subsets, not the full loader data

At the call site (line 172), replace:

```tsx
      <AllVideoSchemas cmsVideos={cmsVideos} listingVideos={listingVideos} />
```

with:

```tsx
      <AllVideoSchemas cmsVideos={visibleCmsVideos} listingVideos={matchingListingVideos} />
```

Update the comment immediately above it (lines 169-171), since its current text ("Emitted for every video regardless of paging... must not shrink to whatever the visitor happens to have scrolled to") describes the behavior this step deliberately reverses:

```tsx
      {/* Capped to what's actually visible: visibleCmsVideos (paged) and
          matchingListingVideos (already ≤12 from the loader, filtered by the
          active search/category). DR-6 -- structured data for content the
          page doesn't render is misleading to crawlers and inflates payload
          for no benefit. */}
      <AllVideoSchemas cmsVideos={visibleCmsVideos} listingVideos={matchingListingVideos} />
```

Confirm `visibleCmsVideos` (line 163) and `matchingListingVideos` (referenced in the JSX grid render, verify the exact variable name used at the grid-render call site around line 323 before using it here — the research pass reported this name, but re-confirm against the live file since line numbers may have shifted from other work) are both in scope at line 172 (both are `const`s computed earlier in the component body, above the return statement — confirm this before editing; if either is computed inside a conditional block or after line 172, hoist the computation above the `<AllVideoSchemas>` call instead of restructuring the component).

### Step 2: Extend `src/routes/videos.contract.test.mjs`

Add a source-scan assertion that the full/unfiltered loader arrays no longer reach `AllVideoSchemas`:

```js
test("AllVideoSchemas receives the rendered subset, not the full loader data", () => {
  const source = readFileSync("src/routes/videos.tsx", "utf8");
  assert.doesNotMatch(source, /<AllVideoSchemas cmsVideos=\{cmsVideos\} listingVideos=\{listingVideos\}/);
  assert.match(source, /<AllVideoSchemas cmsVideos=\{visibleCmsVideos\}/);
});
```

If this test file already has a fixture-driven render test (using the `bun:test` + `cheerio` + `renderToStaticMarkup` pattern this repo uses elsewhere for component tests), also add a behavioral case: render the page with a loader payload of, say, 30 CMS videos and confirm the number of `<script type="application/ld+json">` tags emitted does not exceed `VIDEOS_PER_PAGE` (12) plus the listing-video count, i.e. ≤24 per the plan's acceptance criterion. Check whether such a render harness already exists in this file before adding one — if it doesn't, a source-scan assertion (above) is sufficient for this task; do not build a new render harness from scratch just for this one check.

### Step 3: Run tests, verify, commit

```bash
node --test src/routes/videos.contract.test.mjs
npx tsc --noEmit
```

```bash
git add src/routes/videos.tsx src/routes/videos.contract.test.mjs
git commit -m "fix(videos): cap VideoObject JSON-LD to the rendered/filtered video set (DR-6)"
```

---

## Task 6: DR-8 — label fixes (eyebrows, Sheet close, LiveAgentWidget aria-labels)

**Files:**
- Modify: `src/routes/estate-reviews.tsx`
- Modify: `src/components/site/CorridorInventory.tsx`
- Modify: `src/components/ui/sheet.tsx`
- Modify: `src/components/live-agent/LiveAgentWidget.tsx`
- Test: whichever existing test files already cover these routes/components (see Step 5)

Scope per the master plan: only the small, independent label swaps below — **not** `MortgageCalculator.tsx`'s full translation, which the master plan explicitly schedules for P5 (§DR-8: *"This is a full component translation, scheduled in P5, not a one-line fix"*). Do not touch `MortgageCalculator.tsx` in this task.

### Step 1: `src/routes/estate-reviews.tsx`

Line 64: `<p className="text-sm font-semibold text-coral">Review Articles</p>` → `<p className="text-sm font-semibold text-coral">屋苑文章</p>`.

Line 95: `<p className="text-sm font-semibold text-coral">Estate Pages</p>` → `<p className="text-sm font-semibold text-coral">屋苑專頁</p>`.

### Step 2: `src/components/site/CorridorInventory.tsx`

This file's `eyebrow` prop default was introduced in Task 1 Step 3 as `"Live Listings"` (matching the pre-existing text exactly, so Task 1 stayed a pure refactor with no visible change). Change that default now:

```ts
  eyebrow = "即時放盤",
```

Since `heading` already defaults to `"即時放盤"` (the Chinese h2), having `eyebrow` also default to the same Chinese phrase would duplicate it visually — use a distinct eyebrow instead:

```ts
  eyebrow = "放盤情報",
```

(Pick whatever short Chinese eyebrow phrase reads naturally above "即時放盤" as the h2 — "放盤情報" is a reasonable default; do not simply translate "Live Listings" word-for-word if a more natural zh-HK real-estate phrase fits better. Keep it under ~6 characters to match the visual weight of the other eyebrows already fixed in Step 1.)

### Step 3: `src/components/ui/sheet.tsx`

Line 66: `<span className="sr-only">Close</span>` → `<span className="sr-only">關閉</span>`.

This is a vendored shadcn primitive (per `CLAUDE.md`: "shadcn/ui components in `components/ui/`... vendored, keep in sync with upstream") — this is a deliberate, intentional divergence from upstream for zh-HK localization, not drift to "fix" back later. No comment is needed beyond what's already there; this single-string change doesn't need special-casing during a future shadcn re-sync (upstream's own value would simply get overwritten again if the file were ever regenerated wholesale, which is a pre-existing risk for every other divergence already in this vendored directory, not new to this change).

### Step 4: `src/components/live-agent/LiveAgentWidget.tsx`

Six `aria-label` swaps (English → zh-HK), same technique as `sheet.tsx`:

- Line 155: `aria-label="Earnest Property live agent"` → `aria-label="晉誠地產即時客服"`
- Line 165: `aria-label="Close live agent"` → `aria-label="關閉即時客服"`
- Line 216: `aria-label="WhatsApp phone for handoff"` → `aria-label="轉接 WhatsApp 電話"`
- Line 223: `aria-label="Consent to WhatsApp follow-up"` → `aria-label="同意 WhatsApp 跟進聯絡"`
- Line 253: `aria-label="Live agent message"` → `aria-label="即時客服訊息"`
- Line 259: `aria-label="Send"` → `aria-label="傳送"`

Re-confirm each line number against the live file before editing (this file may have shifted slightly since the research pass) — locate by the exact English string, not by line number alone.

### Step 5: Tests

Check which existing test scripts already source-scan these four files (search `package.json`'s `test:homepage`, `test:contact`, or any script referencing `estate-reviews`, `CorridorInventory`, `sheet`, or `LiveAgentWidget` by filename) before creating anything new. Add a source-scan assertion per file to whichever existing test already covers it, confirming the English strings are gone and the zh-HK replacements are present, e.g.:

```js
test("estate-reviews.tsx eyebrows are zh-HK, not English", () => {
  const source = readFileSync("src/routes/estate-reviews.tsx", "utf8");
  assert.doesNotMatch(source, /Review Articles|Estate Pages/);
});
```

If none of these four files is covered by any existing `test:*` script (confirm by checking `package.json` in full), add the assertions to the most topically adjacent existing test file rather than creating a new script just for four one-line label checks — e.g. `LiveAgentWidget`'s aria-labels could reasonably live in whatever test already covers the live-agent feature (check for a `live-agent`-named test file first), and `sheet.tsx`/`CorridorInventory.tsx`/`estate-reviews.tsx` similarly.

### Step 6: Run tests, verify, commit

```bash
npx tsc --noEmit
npm run lint
```

(Run whichever `test:*` scripts you added assertions to.)

```bash
git add src/routes/estate-reviews.tsx src/components/site/CorridorInventory.tsx src/components/ui/sheet.tsx src/components/live-agent/LiveAgentWidget.tsx
git commit -m "fix(i18n): replace stray English eyebrows and aria-labels with zh-HK (DR-8)"
```

---

## Task 7: FAQ guard regression test (already applied everywhere — verify, don't re-implement)

**Files:**
- Test: `src/content/castle-peak-road.test.mjs` or a new small `src/lib/faq-surfaces.test.mjs`

Research for this plan confirmed `renderableFaqs()` is already applied at all five FAQ-rendering surfaces (`index.tsx:161`, `estate.$slug.tsx:89`, `castle-peak-road.index.tsx:122`, `district.sham-tseng.tsx:126`, `castle-peak-road.$segment.tsx:229`), and all five surfaces that emit `FAQPage` JSON-LD (grep for `"@type": "FAQPage"`) draw from one of those five guarded arrays. **Do not re-implement this — it is already correct.** This task exists only to add a regression test, since the master plan's P2 acceptance criteria still names it and there is currently no automated check that a future new FAQ surface won't skip the guard.

### Step 1: Add the regression test

```js
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROUTES_DIR = "src/routes";
const COMPONENTS_DIR = "src/components";

function allSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

test("every file emitting FAQPage JSON-LD also imports renderableFaqs", () => {
  for (const file of [...allSourceFiles(ROUTES_DIR), ...allSourceFiles(COMPONENTS_DIR)]) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('"@type": "FAQPage"')) continue;
    assert.match(
      source,
      /renderableFaqs/,
      `${file} emits FAQPage JSON-LD but does not appear to use renderableFaqs`,
    );
  }
});
```

This is a coarse source-scan (it doesn't prove the guard is applied to the exact array feeding the JSON-LD, only that the import/usage co-occurs in the file) — that's an intentional, honest limitation given no render-harness exists for most of these routes; note it in a one-line comment above the test rather than overclaiming precision. It is still a real regression guard: it fails loudly the moment someone adds a sixth FAQ-JSON-LD surface without importing `renderableFaqs` at all, which is the actual failure mode this task exists to catch.

### Step 2: Run, verify, commit

```bash
node --test <the file you added this to>
```

```bash
git add <the modified test file>
git commit -m "test(faq): add a regression guard that every FAQPage surface uses renderableFaqs"
```

---

## Final verification (after all seven tasks)

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run test:corridor && npm run test:listing-search && npm run test:seo && npm run test:estate-conversion && npm run test:mls && npm run test:district
```

Per the master plan's P2 acceptance criteria, confirm by inspection (not just test-green):
- Ting Kau's strict result set contains no 掃管笏/黃金海岸/大欖涌/屯門 stock (Task 1's new contract test proves this against fixtures; also worth a manual check against live data if a database connection is available in the environment executing this plan).
- No duplicate unit appears twice on any single listing surface (Task 2).
- No `- 房`, `NaN`, `null`, `$0`, or raw CSV artifact renders on `/property/$listingNo`, `/listings`, `/castle-peak-road/*` (Task 3 — `sanitizeListingText` already guarantees this at the function level; the wiring is what this task added).
- `district.sham-tseng.tsx` no longer names a specific school without a verified source (Task 4).
- `/videos`' JSON-LD script count is bounded by what's on the page (Task 5).
- No English eyebrow/aria-label remains on the four files touched in Task 6, and `MortgageCalculator.tsx` is untouched (still English, correctly deferred to P5).
- The FAQ guard regression test (Task 7) passes and would fail if a future surface skipped `renderableFaqs`.
