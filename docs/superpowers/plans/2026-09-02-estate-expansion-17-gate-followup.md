# 17-Estate Expansion: Publish-Gate Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify school nets against real Hong Kong government sources,
attempt to resolve 4 documented cross-source fact conflicts, and source
photos for the 10 of 17 estates that still have none — closing as much of
the 17-estate expansion's publish-gate gap as available research actually
allows.

**Architecture:** Three independent workstreams, each its own task and its
own PR. Each is a research step (using WebSearch/WebFetch/the Browser tool
against real, authoritative sources — never a competitor real-estate
portal, never a guess) followed by an encode-the-findings step that
follows an exact existing pattern in this repo. None of the three touches
the others' files.

**Tech Stack:** TanStack Start + Neon Postgres (raw SQL migrations,
`node --test` contract tests) — same stack as PR #102–#105, which this
plan continues directly.

---

## Before starting: full context every task needs

**The 17 expansion estates** (slug — nameZh): `hoi-wan-hin` 海雲軒,
`tai-wah-hin` 大華軒, `hoi-wan-toi` 海韻臺, `chun-wong-kui` 縉皇居,
`lung-tang-kok` 龍騰閣, `mun-ming-shan` 滿名山, `wong-gam-hoi-ngon`
香港黃金海岸, `oi-kam-hoi-ngon` 愛琴海岸, `tai-yu` 帝御, `wong-gam-hoi-waan`
黃金海灣, `sing-tai` 星堤, `seong-yuen` 上源, `the-carmel` The Carmel,
`oma-oma` OMA OMA, `lin-shan` 漣山, `long-tou-waan` 浪濤灣, `tai-tou-waan`
帝濤灣. Full identity (address, district, etc.) is in
`src/content/estate-registry.ts`.

**Migrations never auto-apply.** Every migration this plan creates ships
unapplied, same as every prior migration this session — do not attempt to
run `npm run neon:migrate` against production; there is no `DATABASE_URL`
in this sandbox and there shouldn't be.

**Registering a new migration** (needed by Tasks 1 and 2): add the new
filename to `MIGRATION_VERSIONS` in
`src/lib/control-plane/migration-versions.js` — it's a plain frozen array
of every filename in `neon/migrations/`, in apply order:

```js
export const MIGRATION_VERSIONS = Object.freeze([
  // ... existing entries ...
  "20260901110000_estate_expansion_publish.sql",
  "20260902100000_estate_expansion_school_net_correction.sql", // Task 1 adds this line
]);
```

**Never fabricate a value.** If a government source doesn't cover a
building, or a Commons search finds nothing, that is a real, reportable
outcome — write nothing for that slug, don't guess.

---

### Task 1: School net verification

**Files:**
- Create: `neon/migrations/20260902100000_estate_expansion_school_net_correction.sql`
- Modify: `src/lib/control-plane/migration-versions.js` (add the new filename)
- Test: `src/lib/control-plane/estate-expansion-school-net-correction.contract.test.mjs`

- [ ] **Step 1: Do the research**

  For each of the 17 estates listed above, get its `address` from
  `src/content/estate-registry.ts` (or from `neon/migrations/20260901100000_estate_expansion_facts.sql`,
  which set every one) and its currently-recorded `school_net_code` (`'62'`
  or `'71'`) from that same facts migration. Look up the real Primary One
  Admission school net for that address using:
  - EDB's official school net search (search "教育局 小一入學 校網 查詢" or
    navigate directly to EDB's Primary One Admission net-lookup page), or
  - GeoInfo Map's (地理資訊地圖) school net layer, which accepts an address
    or lot lookup.

  Use the Browser tool to actually navigate and read these government
  tools' output — not a general web search, which is a different (and
  previously unsuccessful) method reserved for Task 2. Record, per slug:
  the address queried, the tool used, and the net the tool returned.

- [ ] **Step 2: Write the migration**

  For every slug where the confirmed net differs from what's currently in
  `20260901100000_estate_expansion_facts.sql`, add one statement to the new
  migration file, following this exact style (from the existing facts
  migration):

  ```sql
  -- EDB Primary One Admission net lookup for 青山公路青龍頭段88–90號
  -- (龍騰閣) confirmed net 62, correcting the data pack's unverified 71.
  UPDATE estates SET school_net_code = '62' WHERE slug = 'lung-tang-kok';
  ```

  If every one of the 17 confirms correct, the file still needs to exist
  (Task 1's test requires it) — open it with just a header comment stating
  that all 17 were checked and confirmed, and no `UPDATE` statements:

  ```sql
  -- 2026-09-02: verified all 17 estate-expansion school_net_code values
  -- against EDB's Primary One Admission net lookup. All 17 confirmed
  -- correct as recorded by 20260901100000_estate_expansion_facts.sql --
  -- no corrections needed. This file exists as the verification record.
  ```

- [ ] **Step 3: Register the migration**

  Add `"20260902100000_estate_expansion_school_net_correction.sql"` to
  `MIGRATION_VERSIONS` in `src/lib/control-plane/migration-versions.js`,
  as the new last entry.

- [ ] **Step 4: Write the failing test**

  Create `src/lib/control-plane/estate-expansion-school-net-correction.contract.test.mjs`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync, readdirSync } from "node:fs";
  import path from "node:path";

  const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
  const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith("_estate_expansion_school_net_correction.sql"),
  );

  const EXPANSION_SLUGS = new Set([
    "hoi-wan-hin", "tai-wah-hin", "hoi-wan-toi", "chun-wong-kui",
    "lung-tang-kok", "mun-ming-shan", "wong-gam-hoi-ngon", "oi-kam-hoi-ngon",
    "tai-yu", "wong-gam-hoi-waan", "sing-tai", "seong-yuen", "the-carmel",
    "oma-oma", "lin-shan", "long-tou-waan", "tai-tou-waan",
  ]);

  test("the school net correction migration exists", () => {
    assert.ok(
      migrationFile,
      "expected a migration file ending in _estate_expansion_school_net_correction.sql",
    );
  });

  test("only touches school_net_code, on estate-expansion slugs, to a known net", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
    const statements = [...sql.matchAll(/UPDATE estates SET ([^;]+) WHERE slug = '([a-z0-9-]+)';/g)];
    for (const [, setClause, slug] of statements) {
      assert.match(
        setClause.trim(),
        /^school_net_code = '(62|71)'$/,
        `${slug}'s UPDATE must set only school_net_code, to '62' or '71'`,
      );
      assert.ok(EXPANSION_SLUGS.has(slug), `${slug} must be one of the 17 expansion estates`);
    }
  });

  test("never touches published, verified_at, or any fact/photo column", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
    assert.ok(!/published\s*=/i.test(sql), "must never touch published");
    assert.ok(!/verified_at\s*=/i.test(sql), "must never touch verified_at");
    assert.ok(!/avg_saleable_psf|developer|area_min|area_max|blocks\s*=/i.test(sql));
  });

  test("the migration is registered in migration-versions.js", async () => {
    const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
    assert.ok(
      MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_school_net_correction")),
      "the new migration filename must be registered",
    );
  });
  ```

- [ ] **Step 5: Run the test, verify it fails before the migration file exists**

  Run: `node --test src/lib/control-plane/estate-expansion-school-net-correction.contract.test.mjs`
  Expected: FAIL — `migrationFile` is `undefined` (Step 2 not done yet, if
  running steps out of order) or passes trivially once Steps 2–3 are done.
  If you followed the steps in order, this step instead confirms the test
  itself is well-formed: temporarily rename the migration file, confirm
  the first test fails, rename it back.

- [ ] **Step 6: Run migration-versions.test.mjs and the new test together**

  Run: `node --test src/lib/control-plane/migration-versions.test.mjs src/lib/control-plane/estate-expansion-school-net-correction.contract.test.mjs`
  Expected: all PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add neon/migrations/20260902100000_estate_expansion_school_net_correction.sql \
    src/lib/control-plane/migration-versions.js \
    src/lib/control-plane/estate-expansion-school-net-correction.contract.test.mjs
  git commit -m "feat(estates): verify 17-estate-expansion school nets against EDB"
  ```

---

### Task 2: Resolve documented fact conflicts

**Files:**
- Create: `neon/migrations/20260902110000_estate_expansion_facts_resolution.sql`
- Modify: `src/lib/control-plane/migration-versions.js` (add the new filename)
- Test: `src/lib/control-plane/estate-expansion-facts-resolution.contract.test.mjs`

**The 4 conflicts** (all documented in
`neon/migrations/20260901100000_estate_expansion_facts.sql`):

| Slug | Field | Disputed values |
|---|---|---|
| `lung-tang-kok` | `developer` | unset — pending estate-document confirmation |
| `sing-tai` | `area_max` | 2,766 / 4,054 / 4,484 sq ft |
| `seong-yuen` | `blocks` | 5 buildings vs. 10 A/B sub-blocks |
| `tai-tou-waan` | `area_max` | 2,841 / 3,421 sq ft |

- [ ] **Step 1: Do the research**

  For each of the 4 slugs above, query Hong Kong government sources
  directly for the disputed field:
  - 差餉物業估價署 (Rating and Valuation Department) property information
    online — covers building age, developer, and floor area records.
  - 屋宇署 (Buildings Department) building records search — covers
    approved block counts and Occupation Permit floor areas.

  Use the Browser tool to navigate these portals directly by the estate's
  address (from `estate-registry.ts` / the facts migration). This is a
  deliberately different method from a general web search, which already
  failed to surface these 4 on an earlier pass this session — if these
  portals also don't cover a given building (a real possible outcome for
  a small residential building), that slug's field stays unresolved; say
  so, don't guess between the disputed values.

- [ ] **Step 2: Write the migration**

  For every field actually resolved, add one statement, matching the
  existing facts migration's style exactly — cite the source:

  ```sql
  -- 差餉物業估價署 property record confirms developer as 恒基兆業 for
  -- 龍騰閣, resolving the data pack's "pending estate-document
  -- confirmation" note.
  UPDATE estates SET developer = '恒基兆業' WHERE slug = 'lung-tang-kok';
  ```

  For any of the 4 that stay unresolved, add a comment (not an `UPDATE`)
  documenting what was checked and why it's still unresolved:

  ```sql
  -- sing-tai's area_max (2,766/4,054/4,484 呎 disputed) checked against
  -- 差餉物業估價署 and 屋宇署 2026-09-02 -- neither source's public search
  -- covers this building's individual unit floor areas. Stays NULL.
  ```

  If none of the 4 resolve, the file still needs to exist with just these
  4 comment blocks and no `UPDATE` statements — that is a legitimate,
  fully-documented outcome for this task, not a failure to fix inline.

- [ ] **Step 3: Register the migration**

  Add `"20260902110000_estate_expansion_facts_resolution.sql"` to
  `MIGRATION_VERSIONS` in `src/lib/control-plane/migration-versions.js`.

- [ ] **Step 4: Write the failing test**

  Create `src/lib/control-plane/estate-expansion-facts-resolution.contract.test.mjs`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync, readdirSync } from "node:fs";
  import path from "node:path";

  const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
  const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith("_estate_expansion_facts_resolution.sql"),
  );

  const CONFLICT_SLUGS = new Set(["lung-tang-kok", "sing-tai", "seong-yuen", "tai-tou-waan"]);
  const ALLOWED_FIELDS = new Set(["developer", "area_max", "blocks"]);

  test("the facts resolution migration exists", () => {
    assert.ok(
      migrationFile,
      "expected a migration file ending in _estate_expansion_facts_resolution.sql",
    );
  });

  test("only touches the 4 documented conflict slugs, only their disputed field", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
    const statements = [...sql.matchAll(/UPDATE estates SET (\w+) = [^;]+ WHERE slug = '([a-z0-9-]+)';/g)];
    for (const [, field, slug] of statements) {
      assert.ok(CONFLICT_SLUGS.has(slug), `${slug} must be one of the 4 documented conflicts`);
      assert.ok(ALLOWED_FIELDS.has(field), `${field} must be the slug's own disputed field`);
    }
  });

  test("never seeds avg_saleable_psf, price, listing counts, transactions, published, or verified_at", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
    assert.ok(!/avg_saleable_psf\s*=/i.test(sql));
    assert.ok(!sql.toLowerCase().includes("insert into transactions"));
    assert.ok(!/published\s*=\s*true/i.test(sql));
    assert.ok(!/verified_at\s*=\s*(now\(\)|'[^']+')/i.test(sql));
  });

  test("the migration is registered in migration-versions.js", async () => {
    const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
    assert.ok(
      MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_facts_resolution")),
      "the new migration filename must be registered",
    );
  });
  ```

- [ ] **Step 5: Run the test, verify it fails before the migration file exists**

  Same approach as Task 1 Step 5: confirm the first assertion fails
  without the file, passes once Steps 2–3 are done.

- [ ] **Step 6: Run the full set together**

  Run: `node --test src/lib/control-plane/migration-versions.test.mjs src/lib/control-plane/estate-expansion-facts-resolution.contract.test.mjs`
  Expected: all PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add neon/migrations/20260902110000_estate_expansion_facts_resolution.sql \
    src/lib/control-plane/migration-versions.js \
    src/lib/control-plane/estate-expansion-facts-resolution.contract.test.mjs
  git commit -m "feat(estates): resolve documented 17-estate-expansion fact conflicts where possible"
  ```

---

### Task 3: Photos for the remaining 10 estates

**Files:**
- Modify: `src/content/estate-registry.ts` (set `photo`/`photoCredit` for
  whichever slugs get a licensed photo)
- Create: `public/estates/<slug>.jpg` per photo found
- Modify: `src/content/estate-registry.test.mjs` (extend the existing
  `P4_PHOTO_SLUGS` list from PR #105 with any newly-found slugs)

**The 10 remaining slugs** (none of these have Commons coverage confirmed
yet — PR #105 checked all 17 once and found hits for the other 7):
`hoi-wan-hin`, `tai-wah-hin`, `lung-tang-kok`, `tai-yu`,
`wong-gam-hoi-waan`, `seong-yuen`, `the-carmel`, `oma-oma`, `lin-shan`,
`long-tou-waan`.

- [ ] **Step 1: Search Wikimedia Commons per estate**

  For each of the 10 slugs, search Commons by both the estate's `nameZh`
  and its `nameEn` (from `estate-registry.ts`) — e.g. `Category:<English
  name>, Hong Kong` and the Chinese name directly. Note any candidate
  filenames found.

- [ ] **Step 2: Verify each candidate individually**

  For every candidate filename, fetch its own Commons **file** page (not
  the category page — category pages don't expose per-file license data,
  confirmed empirically during PR #105's research). Record: license,
  author/uploader, and whether the image is a genuine completed-building
  exterior shot (not construction, not a street sign, not an unrelated
  building).

- [ ] **Step 3: Cross-check the name match against a second source**

  Before treating any candidate as a hit, confirm the estate's claimed
  English name actually resolves to that specific building via an
  independent source (e.g. a property portal listing showing the same
  address) — this is the exact check that caught the "Rhine Terrace" vs.
  this repo's existing, unrelated "Rhine Garden" collision risk during PR
  #105. A same-sounding English name is not enough on its own.

- [ ] **Step 4: Visually confirm via the Browser tool**

  For every candidate that passes Steps 2–3, open
  `https://commons.wikimedia.org/wiki/Special:FilePath/<filename>?width=500`
  in the Browser tool and screenshot it — confirm it's a real, clean
  building exterior shot before downloading anything.

- [ ] **Step 5: Download and resize confirmed photos**

  For every estate with a confirmed photo, download the original via
  `https://commons.wikimedia.org/wiki/Special:FilePath/<filename>` (no
  width param = full resolution), then resize to ~1200px on the long edge
  at JPEG quality 65–80 with `sips` (matching PR #105's exact approach and
  this repo's existing client-supplied photos' file sizes), and save to
  `public/estates/<slug>.jpg`.

- [ ] **Step 6: Update the registry**

  For each estate with a confirmed photo, in `src/content/estate-registry.ts`:

  ```ts
  photo: "/estates/<slug>.jpg",
  photoCredit: "<Author> / Wikimedia Commons, <License>",
  ```

  matching the exact field names and format PR #105 already established
  (see the 7 existing entries with a `photoCredit` for the pattern).

- [ ] **Step 7: Extend the existing test**

  In `src/content/estate-registry.test.mjs`, add any newly-photographed
  slugs to the existing `P4_PHOTO_SLUGS` array (added by PR #105) so the
  existing test — "Estate Expansion 17 ... 7 now have a license-verified
  photo, 10 still don't" — covers them; update that test's title/count if
  the split from 7/10 changes (e.g. to 9/8).

- [ ] **Step 8: Run the affected test suites**

  Run: `npm run test:estate-conversion` (covers
  `estate-registry.test.mjs`'s photo checks and `core-estates.test.mjs`'s
  "every declared photo exists on disk" guard) and `npm run test:homepage`.
  Expected: all PASS, same counts as before plus whatever changed.

- [ ] **Step 9: Typecheck**

  Run: `npx tsc --noEmit`
  Expected: clean, no errors.

- [ ] **Step 10: Commit**

  ```bash
  git add src/content/estate-registry.ts src/content/estate-registry.test.mjs public/estates/*.jpg
  git commit -m "feat(estates): source license-verified photos for remaining 17-estate-expansion estates"
  ```

  (Adjust the commit message and `git add` file list to whichever specific
  `.jpg` files actually got created — if zero photos are found, skip this
  commit entirely and report that outcome instead; an empty commit is not
  a deliverable.)

---

## Self-review notes (for whoever executes this plan)

- Tasks 1 and 2 both may legitimately produce a migration file with zero
  `UPDATE` statements (all-confirmed, or all-unresolved). That is a valid,
  fully-tested outcome — the contract tests above pass either way, since
  they check invariants (which columns/slugs are touched, if any) rather
  than asserting a specific predicted resolution.
- Task 3 may legitimately find zero new photos. In that case, skip Step
  10's commit and report the finding (which sources were checked, why
  nothing qualified) instead of forcing a commit.
- Each task is independently a PR, mirroring PR #105: push the branch,
  open a PR referencing this plan, and use
  `superpowers:finishing-a-development-branch` once its own tests pass —
  don't bundle two tasks into one PR even though they can share a base
  branch off `main`.
