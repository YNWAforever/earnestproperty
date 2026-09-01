# Publish 17-Estate Expansion + 青山公路 Home Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip `published = true` for all 17 estates from PR #102's expansion,
and add a home page section for the 12 青山公路 estates (mirroring the
existing 深井核心屋苑 grid) so all 17 are actually reachable from the home
page once published.

**Architecture:** A new, additive migration flips `published` only — no
facts/verified_at change. `CoreEstateGrid` (`src/routes/index.tsx`) gets
parameterized to accept a static estate list + district label instead of
hardcoding the 深井 list, so the same component renders both sections. A
new content file mirrors `core-estates.ts`'s exact shape for the 12 青山公路
estates.

**Tech Stack:** TanStack Start route, TypeScript content modules, Neon
Postgres migration (unapplied in this sandbox, same as every prior phase).

---

## Before you start

Read `docs/superpowers/specs/2026-09-01-estate-publish-and-castle-peak-road-section-design.md`.
Non-negotiable: never set `verified_at` on any of the 17 (that column is a
literal "a human confirmed this" claim read by `estate.$slug.tsx`'s
`DataNote` — none of the 17 have actually been human-verified). Never touch
any facts column, `district_slug`, or `name_zh` in this migration — those
were already handled in PR #102; this migration does exactly one thing,
`published = true`, and nothing else.

---

### Task 1: Publish migration

**Files:**
- Create: `neon/migrations/20260901110000_estate_expansion_publish.sql`
- Modify: `src/lib/control-plane/migration-versions.js`
- Test: create `src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_estate_expansion_publish.sql"),
);

const EXPANSION_SLUGS = [
  "hoi-wan-hin",
  "tai-wah-hin",
  "hoi-wan-toi",
  "chun-wong-kui",
  "lung-tang-kok",
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
];

test("the publish migration exists", () => {
  assert.ok(migrationFile, "expected a migration file ending in _estate_expansion_publish.sql");
});

test("the migration sets published = true for exactly the 17 expansion slugs, no more no fewer", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const slugs = [...sql.matchAll(/WHERE slug (?:= '([a-z0-9-]+)'|IN \(([^)]+)\))/g)].flatMap(
    (m) => (m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().replace(/^'|'$/g, ""))),
  );
  assert.deepEqual(slugs.sort(), [...EXPANSION_SLUGS].sort());
});

test("the migration never touches verified_at, facts columns, district_slug, or name_zh", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/verified_at/i.test(sql), "must never touch verified_at");
  assert.ok(!/address\s*=/i.test(sql), "must never touch address");
  assert.ok(!/developer\s*=/i.test(sql), "must never touch developer");
  assert.ok(!/district_slug\s*=/i.test(sql), "must never touch district_slug");
  assert.ok(!/name_zh\s*=/i.test(sql), "must never touch name_zh");
  assert.ok(!/avg_saleable_psf/i.test(sql), "must never touch avg_saleable_psf");
});

test("every SET clause in the migration only ever sets published = true", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const setClauses = [...sql.matchAll(/UPDATE estates SET (.+?) WHERE/gs)].map((m) => m[1].trim());
  for (const clause of setClauses) {
    assert.equal(clause.replace(/\s+/g, " "), "published = true");
  }
});

test("the migration is registered in migration-versions.js", async () => {
  const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
  assert.ok(MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_publish")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs`
Expected: FAIL — the migration file doesn't exist yet.

- [ ] **Step 3: Write the migration**

Create `neon/migrations/20260901110000_estate_expansion_publish.sql`:

```sql
-- Publishes all 17 estates from the 2026-09-01 estate expansion
-- (20260830130000_estate_expansion.sql seeded them, 20260901100000_
-- estate_expansion_facts.sql populated their facts and corrected 5
-- district_slug values). This migration does exactly one thing: flips
-- published = true. It deliberately does NOT set verified_at -- that
-- column is a literal "a human confirmed this" claim
-- (estate.$slug.tsx's DataNote reads it that way), and none of these 17
-- have actually been human-verified. The page already has a graceful,
-- honest fallback for verified_at = NULL ("以上資料尚待人手覆核並標註核實日期"),
-- so publishing without it is a supported state, not a broken one.
--
-- Accepted, documented gaps at publish time (per
-- docs/superpowers/specs/2026-09-01-estate-publish-and-castle-peak-road-section-design.md):
-- every one of the 17 still has photo = NULL (falls back to the existing
-- gradient placeholder), and several facts columns stay NULL where the
-- 2026-09-01 data pack itself documented a genuine cross-source conflict
-- (renders as an em dash, never a fabricated number).

UPDATE estates SET published = true WHERE slug = 'hoi-wan-hin';
UPDATE estates SET published = true WHERE slug = 'tai-wah-hin';
UPDATE estates SET published = true WHERE slug = 'hoi-wan-toi';
UPDATE estates SET published = true WHERE slug = 'chun-wong-kui';
UPDATE estates SET published = true WHERE slug = 'lung-tang-kok';
UPDATE estates SET published = true WHERE slug = 'mun-ming-shan';
UPDATE estates SET published = true WHERE slug = 'wong-gam-hoi-ngon';
UPDATE estates SET published = true WHERE slug = 'oi-kam-hoi-ngon';
UPDATE estates SET published = true WHERE slug = 'tai-yu';
UPDATE estates SET published = true WHERE slug = 'wong-gam-hoi-waan';
UPDATE estates SET published = true WHERE slug = 'sing-tai';
UPDATE estates SET published = true WHERE slug = 'seong-yuen';
UPDATE estates SET published = true WHERE slug = 'the-carmel';
UPDATE estates SET published = true WHERE slug = 'oma-oma';
UPDATE estates SET published = true WHERE slug = 'lin-shan';
UPDATE estates SET published = true WHERE slug = 'long-tou-waan';
UPDATE estates SET published = true WHERE slug = 'tai-tou-waan';
```

- [ ] **Step 4: Register the migration**

In `src/lib/control-plane/migration-versions.js`, add
`"20260901110000_estate_expansion_publish.sql"` to `MIGRATION_VERSIONS`,
following the exact pattern of the entry immediately before it.

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --test src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs`
Expected: PASS on all 5 tests.

- [ ] **Step 6: Run migration-versions' own test**

Run: `node --test src/lib/control-plane/migration-versions.test.mjs`
Expected: PASS.

- [ ] **Step 7: Do NOT apply the migration**

Same as every prior phase this session — no `npm run neon:migrate`, no
`npm run check:migration-drift` against a live database. The contract test
above is sufficient, DB-independent verification.

- [ ] **Step 8: Commit**

```bash
git add neon/migrations/20260901110000_estate_expansion_publish.sql src/lib/control-plane/migration-versions.js src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs
git commit -m "feat(estates): publish the 17-estate expansion (unapplied)"
```

---

### Task 2: `src/content/castle-peak-road-estates.ts` — the 12-estate static list

**Files:**
- Create: `src/content/castle-peak-road-estates.ts`
- Test: create `src/content/castle-peak-road-estates.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/content/castle-peak-road-estates.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { castlePeakRoadEstates } from "./castle-peak-road-estates.ts";
import { getEstateEntry } from "./estate-registry.ts";

const EXPECTED_ORDER = [
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
];

test("castlePeakRoadEstates has exactly the 12 青山公路 estates, in the master spec's canonical order", () => {
  assert.deepEqual(
    castlePeakRoadEstates.map((estate) => estate.slug),
    EXPECTED_ORDER,
  );
});

test("every entry sources slug/name/photo/district/hasPage from estate-registry.ts, not a second copy", () => {
  for (const estate of castlePeakRoadEstates) {
    const entry = getEstateEntry(estate.slug);
    assert.equal(estate.name, entry.nameZh);
    assert.equal(estate.photo, entry.photo);
    assert.equal(estate.district, entry.homepageDistrict);
    assert.equal(estate.hasPage, entry.hasPage);
    assert.equal(estate.district, "青山公路");
  }
});

test("every entry carries no invented figures -- units/avgPsf/listingCount are always null", () => {
  for (const estate of castlePeakRoadEstates) {
    assert.equal(estate.units, null, `${estate.name}.units must be null`);
    assert.equal(estate.avgPsf, null, `${estate.name}.avgPsf must be null`);
    assert.equal(estate.listingCount, null, `${estate.name}.listingCount must be null`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/content/castle-peak-road-estates.test.mjs`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 3: Write `castle-peak-road-estates.ts`**

```typescript
/**
 * The 青山公路屋苑 home page card list -- the 12 estates from the 2026-09-01
 * 17-estate expansion whose homepageDistrict is "青山公路" (estate-registry.ts).
 * Mirrors core-estates.ts's exact shape and discipline: identity (slug, name,
 * photo, district, hasPage) comes from estate-registry.ts (DR-10); this file
 * only fixes display order. units/avgPsf/listingCount stay null here and are
 * merged from the live DB at render time by CoreEstateGrid, same as
 * core-estates.ts's own entries -- hardcoding them here would let the card
 * drift from the estate page.
 */
import { type CoreEstate } from "./core-estates.ts";
import { getEstateEntry } from "./estate-registry.ts";

/**
 * Order matches the 2026-09-01 data pack's own canonical identity table
 * (estates 6-17), the same source order every other file this session built
 * from this data pack already follows.
 */
const CASTLE_PEAK_ROAD_SLUGS = [
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
] as const;

export const castlePeakRoadEstates: CoreEstate[] = CASTLE_PEAK_ROAD_SLUGS.map((slug) => {
  const entry = getEstateEntry(slug);
  return {
    slug: entry.slug,
    name: entry.nameZh,
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: entry.photo,
    district: entry.homepageDistrict,
    hasPage: entry.hasPage,
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/content/castle-peak-road-estates.test.mjs`
Expected: PASS on all 3 tests.

- [ ] **Step 5: Wire the new test file into `test:estate-conversion`**

In `package.json`, add `src/content/castle-peak-road-estates.test.mjs` to
the `test:estate-conversion` script's file list.

- [ ] **Step 6: Run test:estate-conversion to check the wiring**

Run: `npm run test:estate-conversion`
Expected: PASS (all prior tests plus the 3 new ones).

- [ ] **Step 7: Commit**

```bash
git add src/content/castle-peak-road-estates.ts src/content/castle-peak-road-estates.test.mjs package.json
git commit -m "feat(content): add the 12-estate 青山公路 home page card list"
```

---

### Task 3: Parameterize `CoreEstateGrid` and wire the new home page section

**Files:**
- Modify: `src/routes/index.tsx` (loader, `CoreEstateGrid`, the CORE ESTATES section)
- Modify: `src/config/site.test.mjs` (the source-scan test this task's change affects)
- Modify: `src/routes/homepage-copy.contract.test.mjs` (the source-scan test this task's change affects)

This is the highest-risk task in this plan -- it changes an existing,
tested component. Read `CoreEstateGrid`'s current full body
(`src/routes/index.tsx`, the function starting `function CoreEstateGrid(`)
before editing.

- [ ] **Step 1: Add the second import and update the existing one**

Change:

```typescript
import { coreEstates, estateFigure, CORE_ESTATES_PREVIEW_COUNT } from "@/content/core-estates";
```

to:

```typescript
import {
  coreEstates,
  estateFigure,
  CORE_ESTATES_PREVIEW_COUNT,
  type CoreEstate,
} from "@/content/core-estates";
import { castlePeakRoadEstates } from "@/content/castle-peak-road-estates";
```

- [ ] **Step 2: Add a second live-data fetch to the loader**

Change:

```typescript
    const [estates, featured, faqs, counts, agentProfiles, cmsVideos] = await Promise.all([
      fetchEstates(),
      fetchFeaturedProperties(),
      fetchFaqs("district:sham-tseng"),
      fetchListingCountsByEstate(),
      fetchNeonPublicAgentProfiles(),
      // Decorative video section: a real DB error here (fetchCmsVideos only
      // special-cases the missing-table case and rethrows everything else)
      // must not take down the whole homepage.
      fetchCmsVideos().catch(() => []),
    ]);
    return {
      estates,
      featured,
      faqs,
      counts: Object.fromEntries(counts),
      agents: agentProfiles.slice(0, 6),
      cmsVideos,
    };
```

to:

```typescript
    const [estates, castlePeakRoadDbEstates, featured, faqs, counts, agentProfiles, cmsVideos] =
      await Promise.all([
        fetchEstates(),
        // Same live-figure merge as the 深井 group above, scoped to the
        // 青山公路 district -- fetchEstates already accepts an optional
        // districtSlug, this is the first caller to pass one other than the
        // default.
        fetchEstates({ districtSlug: "castle-peak-road" }),
        fetchFeaturedProperties(),
        fetchFaqs("district:sham-tseng"),
        fetchListingCountsByEstate(),
        fetchNeonPublicAgentProfiles(),
        // Decorative video section: a real DB error here (fetchCmsVideos only
        // special-cases the missing-table case and rethrows everything else)
        // must not take down the whole homepage.
        fetchCmsVideos().catch(() => []),
      ]);
    return {
      estates,
      castlePeakRoadDbEstates,
      featured,
      faqs,
      counts: Object.fromEntries(counts),
      agents: agentProfiles.slice(0, 6),
      cmsVideos,
    };
```

- [ ] **Step 3: Destructure the new loader field in `HomePage()`**

Change:

```typescript
  const { estates, featured, faqs: faqRows, counts, agents, cmsVideos } = Route.useLoaderData();
```

to:

```typescript
  const { estates, castlePeakRoadDbEstates, featured, faqs: faqRows, counts, agents, cmsVideos } =
    Route.useLoaderData();
```

- [ ] **Step 4: Parameterize `CoreEstateGrid`'s props**

Change:

```typescript
function CoreEstateGrid({
  estates,
  counts,
}: {
  estates: EstateSummary[];
  counts: Record<string, number>;
}) {
```

to:

```typescript
function CoreEstateGrid({
  estates,
  counts,
  staticEstates,
  districtLabel,
}: {
  estates: EstateSummary[];
  counts: Record<string, number>;
  staticEstates: CoreEstate[];
  districtLabel: string;
}) {
```

- [ ] **Step 5: Use the new props instead of the hardcoded `coreEstates` import and "深井" literal**

Change:

```typescript
  const linkableEstates = coreEstates.filter((estate) => estate.hasPage && live.has(estate.slug));
```

to:

```typescript
  const linkableEstates = staticEstates.filter(
    (estate) => estate.hasPage && live.has(estate.slug),
  );
```

Change:

```typescript
                <AppImage
                  src={estate.photo}
                  alt={`${estate.name} 深井 放盤`}
```

to:

```typescript
                <AppImage
                  src={estate.photo}
                  alt={`${estate.name} ${districtLabel} 放盤`}
```

- [ ] **Step 6: Update the CORE ESTATES section and add the new section**

Change:

```typescript
      {/* CORE ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader title="深井核心屋苑" desc="紮根深井青山公路廿多年，每個屋苑我哋都非常熟悉" />
        <CoreEstateGrid estates={estates} counts={counts} />
      </section>
```

to:

```typescript
      {/* CORE ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader title="深井核心屋苑" desc="紮根深井青山公路廿多年，每個屋苑我哋都非常熟悉" />
        <CoreEstateGrid
          estates={estates}
          counts={counts}
          staticEstates={coreEstates}
          districtLabel="深井"
        />
      </section>

      {/* CASTLE PEAK ROAD ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader title="青山公路屋苑" desc="掃管笏、青山灣、小欖一帶屋苑，我哋同樣熟悉" />
        <CoreEstateGrid
          estates={castlePeakRoadDbEstates}
          counts={counts}
          staticEstates={castlePeakRoadEstates}
          districtLabel="青山公路"
        />
      </section>
```

- [ ] **Step 7: Fix the one source-scan test this change affects**

`src/config/site.test.mjs`'s test titled "homepage estate grid only renders
estates with a live, reachable detail page" (from an earlier phase this
session) asserts `CoreEstateGrid`'s source contains this exact regex:

```javascript
  assert.match(
    source,
    /const linkableEstates = coreEstates\.filter\(\s*\(estate\) => estate\.hasPage && live\.has\(estate\.slug\)/,
  );
```

Change the regex to match the new prop-based text:

```javascript
  assert.match(
    source,
    /const linkableEstates = staticEstates\.filter\(\s*\(estate\) => estate\.hasPage && live\.has\(estate\.slug\)/,
  );
```

Also update that test's `assert.doesNotMatch` (a few lines below, checking
`/coreEstates\.filter\(\(estate\) => estate\.hasPage\)/`) — this one can stay
unchanged, since it's guarding against reverting to hasPage-only gating, not
against the `coreEstates` identifier specifically, and remains a valid guard
either way.

`src/routes/homepage-copy.contract.test.mjs` does NOT need any change —
confirmed it has no assertion on `coreEstates.filter` or the `深井 放盤` alt
text, so this step is scoped to `site.test.mjs` alone.

- [ ] **Step 8: Run the affected test files**

Run: `node --test src/config/site.test.mjs src/routes/homepage-copy.contract.test.mjs`
Expected: PASS.

- [ ] **Step 9: Run the estate-conversion and homepage suites**

Run: `npm run test:estate-conversion && npm run test:homepage`
Expected: PASS.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add src/routes/index.tsx src/config/site.test.mjs src/routes/homepage-copy.contract.test.mjs
git commit -m "feat(homepage): parameterize CoreEstateGrid, add 青山公路 home page section"
```

---

### Task 4: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run every test suite this plan touches**

```bash
node --test src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs src/lib/control-plane/migration-versions.test.mjs
node --test src/content/castle-peak-road-estates.test.mjs
npm run test:estate-conversion
npm run test:homepage
npm run test:control-plane
npm run test:contact
```

Expected: every one PASS.

- [ ] **Step 2: Confirm the publish migration touches only the 17 expected slugs**

```bash
grep -c "UPDATE estates SET published = true" neon/migrations/20260901110000_estate_expansion_publish.sql
```

Expected: `17`.

- [ ] **Step 3: Typecheck, lint, and build**

```bash
npx tsc --noEmit
npx eslint src/routes/index.tsx src/content/castle-peak-road-estates.ts src/content/castle-peak-road-estates.test.mjs src/config/site.test.mjs src/routes/homepage-copy.contract.test.mjs neon/migrations/20260901110000_estate_expansion_publish.sql src/lib/control-plane/estate-expansion-publish-migration.contract.test.mjs
npm run build
```

Expected: all clean/succeed.

- [ ] **Step 4: Confirm no deploy, no live migration apply occurred**

This phase's migration ships unapplied, same as every prior phase this
session -- confirm `git log` shows no `neon:migrate` run and no deploy
command was executed.

- [ ] **Step 5: Report**

Summarize: confirm exactly 17 estates get `published = true` and nothing
else changes in this migration; confirm the home page now has two estate
grids (深井核心屋苑, 青山公路屋苑), both gated identically on live DB
presence; confirm `verified_at` was never touched anywhere in this phase.
