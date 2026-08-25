# /videos Filtering and Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors narrow 96 channel videos by estate and reorder them, using only data that already exists in `cms_videos`.

**Architecture:** Estate tags are derived at render time from the channel's `＃` naming convention (97% of titles carry it) and normalized so phases fold into their parent estate. Filter state lives in TanStack Router search params so filtered views are shareable. No migration, no sync change — view counts and duration are Phase 2.

**Tech Stack:** TanStack Start (React 19, file-based router) · Zod 3 via `@tanstack/zod-adapter` · Tailwind v4 + shadcn/ui · `node --test` for `.mjs` unit tests

**Spec:** `docs/superpowers/specs/2026-08-20-videos-filtering-sorting-design.md`

**Branch:** `feat/videos-filtering-and-sorting` (already created, spec committed). Builds on PR #66.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/video-tags.js` (create) | Pure tag derivation: extract the `＃` token, normalize it, resolve district. No React, no DB. |
| `src/lib/video-tags.d.ts` (create) | Types for the above. |
| `src/lib/video-tags.test.mjs` (create) | Unit tests against a corpus of real production titles. |
| `src/lib/neon/public-data.server.ts` (modify) | Add `youtube_published_at` to the `fetchCmsVideos` projection — the sort needs a real upload date, and `created_at` is only the sync time. |
| `src/lib/queries.ts` (modify) | Add `youtube_published_at` to the `CmsVideo` type. |
| `src/routes/videos.tsx` (modify) | Search-param schema, chip row, sort select, filter/sort wiring. |
| `src/routes/videos.contract.test.mjs` (create) | Asserts the route's search schema degrades invalid params to defaults. |
| `package.json` (modify) | Add both new test files to the existing `test:videos` script. |

`video-tags.js` is plain JS with a `.d.ts` sibling, matching `website-inquiry.js`, `site-branches.js` and `video-description.js`, so `node --test` imports it with no build step. Import it with the explicit `.js` extension.

---

### Task 1: Extract the estate token from a title

**Files:**
- Create: `src/lib/video-tags.js`
- Create: `src/lib/video-tags.d.ts`
- Test: `src/lib/video-tags.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/video-tags.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { deriveEstateTag } from "./video-tags.js";

// Real titles from the production channel. The full-width ＃ is what this
// channel actually types; the ASCII # appears occasionally.
test("the estate token is read from the ＃ marker", () => {
  assert.equal(
    deriveEstateTag("💚＃黃金海灣.珀岸💚 《417呎 580萬》2房高層遊艇會海+沙灘海景！優質單位！")?.tag,
    "黃金海灣",
  );
  assert.equal(
    deriveEstateTag("💚＃NAPA 💚 《484呎+132呎花園 550萬》 兩房梗廚！特高樓底！")?.tag,
    "NAPA",
  );
  assert.equal(deriveEstateTag("#豪景花園 三房套 靚裝")?.tag, "豪景花園");
});

// 3 of 97 production titles carry no marker at all -- market-commentary videos
// titled 【北部都會區】... These must not become a tag.
test("titles without a marker yield no tag", () => {
  assert.equal(
    deriveEstateTag("【北部都會區】古洞新盤大戰！買邊個潛力更大？｜晉誠地產《樓市當面講》"),
    null,
  );
  assert.equal(deriveEstateTag(""), null);
  assert.equal(deriveEstateTag(null), null);
  assert.equal(deriveEstateTag(undefined), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/video-tags.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `src/lib/video-tags.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/video-tags.js`:

```javascript
/**
 * Derives an estate tag from a video title.
 *
 * ## Why parse the title rather than match a curated list
 *
 * Measured across all 97 production titles: only 39 (40%) contain a name from
 * src/content/core-estates.ts, while 94 (97%) carry a ＃ marker with the estate
 * immediately after it. 黃金海灣, 漣山, 上源, 愛琴海岸, 星堤 and 帝濤灣 all appear in
 * videos and are absent from the curated list, so matching that list alone would
 * leave most of the catalogue unfilterable.
 *
 * An unrecognised token still becomes a tag. That is the intended degradation
 * path: a newly marketed estate appears as its own chip the day it is uploaded
 * rather than silently vanishing from the filter set.
 *
 * Authored as plain JS with a .d.ts sibling, matching website-inquiry.js and
 * video-description.js, so the node --test suite imports it with no build step.
 */

// Full-width ＃ is what this channel types; ASCII # appears occasionally. The
// token stops at punctuation, so "＃黃金海灣.珀岸" yields "黃金海灣".
const MARKER = /[＃#]\s*([\u4e00-\u9fffA-Za-z0-9]{2,10})/;

/**
 * @param {string | null | undefined} title
 * @returns {{ tag: string, district: string | null } | null}
 */
export function deriveEstateTag(title) {
  if (typeof title !== "string") return null;
  const match = title.match(MARKER);
  if (!match) return null;
  return { tag: match[1], district: null };
}
```

Create `src/lib/video-tags.d.ts`:

```typescript
export type EstateTag = {
  tag: string;
  district: string | null;
};

export function deriveEstateTag(title: string | null | undefined): EstateTag | null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/video-tags.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire the test file into a named script**

`package.json` currently has:

```json
"test:videos": "node --test src/lib/video-presentation.test.mjs",
```

Change it to:

```json
"test:videos": "node --test src/lib/video-presentation.test.mjs src/lib/video-tags.test.mjs",
```

The `test-wiring` guard (`src/test-wiring.test.mjs`) fails any test file under `src/` that no `test:*` script names. Skipping this makes that guard red.

- [ ] **Step 6: Run both the new script and the wiring guard**

Run: `npm run test:videos && node --test src/test-wiring.test.mjs`
Expected: PASS on both.

- [ ] **Step 7: Commit**

```bash
git add src/lib/video-tags.js src/lib/video-tags.d.ts src/lib/video-tags.test.mjs package.json
git commit -m "feat(videos): derive an estate tag from the channel's ＃ marker"
```

---

### Task 2: Normalize phases and drop non-estate tokens

**Files:**
- Modify: `src/lib/video-tags.js`
- Test: `src/lib/video-tags.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/video-tags.test.mjs`:

```javascript
// 浪翠園一期 and 浪翠園三期 are one estate. Left raw they become two chips, which
// reads as broken to anyone who knows the area.
test("phases fold into their parent estate", () => {
  assert.equal(deriveEstateTag("💚＃浪翠園一期💚 《800呎》3房海景")?.tag, "浪翠園");
  assert.equal(deriveEstateTag("💚＃浪翠園三期💚 《900呎》4房")?.tag, "浪翠園");
  assert.equal(deriveEstateTag("💚＃黃金海灣意嵐 💚 《306呎 345萬》1房高層開揚")?.tag, "黃金海灣");
  assert.equal(deriveEstateTag("💚＃黃金海灣.珀岸💚 《417呎》2房")?.tag, "黃金海灣");
});

// 晉誠地產 is the agency's own market-commentary tag, not a place. A 晉誠地產 chip
// on an estate filter is a category error.
test("non-estate tokens are dropped", () => {
  assert.equal(deriveEstateTag("＃晉誠地產 樓市分析 2026"), null);
});

// An estate nobody has curated still filters -- this is the degradation path.
test("unknown estates still produce a tag", () => {
  assert.equal(deriveEstateTag("💚＃漣山💚 《650呎》2房")?.tag, "漣山");
  assert.equal(deriveEstateTag("💚＃愛琴海岸💚 《700呎》3房")?.tag, "愛琴海岸");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/video-tags.test.mjs`
Expected: FAIL — `浪翠園一期` is returned unchanged, and `晉誠地產` returns a tag instead of `null`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/video-tags.js`, add above `deriveEstateTag`:

```javascript
/** Tokens that match the marker but are not places. */
const DROPPED_TAGS = new Set(["晉誠地產", "晉誠", "樓市當面講"]);

/**
 * Sub-developments marketed under their own name. Generic phase-suffix
 * stripping cannot catch these because the child name shares no substring with
 * the parent.
 */
const TAG_ALIASES = new Map([
  ["黃金海灣意嵐", "黃金海灣"],
  ["黃金海灣珀岸", "黃金海灣"],
  ["意嵐", "黃金海灣"],
  ["珀岸", "黃金海灣"],
]);

/** 浪翠園一期 / 浪翠園三期 -> 浪翠園 */
const PHASE_SUFFIX = /(?:第?[一二三四五六七八九十\d]+期)$/;

/**
 * @param {string} token
 * @returns {string | null}
 */
function normalizeTag(token) {
  const aliased = TAG_ALIASES.get(token) ?? token;
  const stripped = aliased.replace(PHASE_SUFFIX, "");
  const final = stripped.length >= 2 ? stripped : aliased;
  if (DROPPED_TAGS.has(final)) return null;
  return final;
}
```

Then change `deriveEstateTag`'s return to run the token through it:

```javascript
export function deriveEstateTag(title) {
  if (typeof title !== "string") return null;
  const match = title.match(MARKER);
  if (!match) return null;
  const tag = normalizeTag(match[1]);
  if (!tag) return null;
  return { tag, district: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:videos`
Expected: PASS, all tests across both files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-tags.js src/lib/video-tags.test.mjs
git commit -m "feat(videos): fold estate phases and drop the agency's own tag"
```

---

### Task 3: Resolve the district from the curated estate list

**Files:**
- Modify: `src/lib/video-tags.js`, `src/lib/video-tags.d.ts`
- Test: `src/lib/video-tags.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/video-tags.test.mjs`:

```javascript
// core-estates.ts deliberately leaves district null where the client has not
// said, rather than putting a false location on a real estate. Tags inherit that
// discipline: an estate the curated list does not know gets null, never a guess.
test("district comes from the curated list, and is null when unknown", () => {
  assert.equal(deriveEstateTag("💚＃豪景花園💚 《700呎》3房")?.district, "青山公路");
  assert.equal(deriveEstateTag("💚＃碧堤半島💚 《900呎》4房")?.district, "深井");
  // 帝華軒 is in the curated list but its district is deliberately null there.
  assert.equal(deriveEstateTag("💚＃帝華軒💚 《500呎》2房")?.district, null);
  // 漣山 is not in the curated list at all.
  assert.equal(deriveEstateTag("💚＃漣山💚 《650呎》2房")?.district, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:videos`
Expected: FAIL — `district` is `null` for 豪景花園, expected `深井`.

- [ ] **Step 3: Check what the curated list actually exposes**

Run: `grep -n "name:\|district:" src/content/core-estates.ts | head -20`

`CORE_ESTATES` entries carry `name` and `district` (`深井` | `青山公路` | `汀九` | `null`). Confirm the exported constant's name before importing it — use whatever `core-estates.ts` actually exports.

- [ ] **Step 4: Write minimal implementation**

`core-estates.ts` is TypeScript, which `node --test` cannot import. Duplicating the district mapping would let the two drift silently, so instead keep the map in the JS module and add a test that fails when it falls out of sync.

In `src/lib/video-tags.js`:

```javascript
/**
 * Estate -> district, mirroring src/content/core-estates.ts.
 *
 * Duplicated rather than imported because core-estates.ts is TypeScript and this
 * module must stay importable by `node --test` with no build step -- the same
 * constraint that makes this file plain JS. video-tags.test.mjs asserts this map
 * agrees with core-estates.ts, so drift is a red test rather than a silent
 * mismatch.
 *
 * Estates the curated list has no district for are absent here and resolve to
 * null. That is deliberate: core-estates.ts refuses to guess a district rather
 * than put a false location on a real estate.
 */
const ESTATE_DISTRICTS = new Map([
  ["碧堤半島", "深井"],
  ["浪翠園", "深井"],
  ["麗都花園", "深井"],
  ["海韻花園", "深井"],
  ["豪景花園", "青山公路"],
  ["海雲軒", "汀九"],
  ["縉皇居", "汀九"],
]);
```

`帝華軒`, `海韻台` and `龍騰閣` are in the curated list but carry `district: null` there, so they are deliberately absent from this map and resolve to `null`.

Return it from `deriveEstateTag`:

```javascript
  return { tag, district: ESTATE_DISTRICTS.get(tag) ?? null };
```

These pairs were read from `src/content/core-estates.ts` at plan time and verified. The drift test in the next step re-checks them at runtime, so if the file has since changed, that test tells you rather than the map lying silently.

- [ ] **Step 5: Add the anti-drift test**

Append to `src/lib/video-tags.test.mjs`:

```javascript
import { readFileSync } from "node:fs";

// The district map in video-tags.js duplicates core-estates.ts because that file
// is TypeScript and this suite runs under `node --test`. This asserts the copy
// still agrees with the source: every estate this module claims a district for
// must carry that same district in core-estates.ts.
test("the district map agrees with core-estates.ts", () => {
  const source = readFileSync("src/content/core-estates.ts", "utf8");
  const claims = [
    ["碧堤半島", "深井"],
    ["浪翠園", "深井"],
    ["麗都花園", "深井"],
    ["海韻花園", "深井"],
    ["豪景花園", "青山公路"],
    ["海雲軒", "汀九"],
    ["縉皇居", "汀九"],
  ];

  for (const [name, district] of claims) {
    const entry = source.slice(source.indexOf(`name: "${name}"`));
    const declared = entry.slice(0, 400).match(/district:\s*"([^"]+)"|district:\s*null/);
    assert.ok(entry, `${name} is no longer in core-estates.ts`);
    assert.equal(
      declared?.[1] ?? null,
      district,
      `${name}: video-tags.js says ${district}, core-estates.ts says ${declared?.[1] ?? "null"}`,
    );
  }
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:videos`
Expected: PASS. If the drift test fails, correct `ESTATE_DISTRICTS` to match `core-estates.ts` — the source file wins.

- [ ] **Step 7: Commit**

```bash
git add src/lib/video-tags.js src/lib/video-tags.d.ts src/lib/video-tags.test.mjs
git commit -m "feat(videos): resolve estate district with an anti-drift guard"
```

---

### Task 4: Count and order tags for the chip row

**Files:**
- Modify: `src/lib/video-tags.js`, `src/lib/video-tags.d.ts`
- Test: `src/lib/video-tags.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/video-tags.test.mjs`:

```javascript
import { buildTagCounts } from "./video-tags.js";

test("tags are counted and ordered by frequency", () => {
  const videos = [
    { title: "＃豪景花園 A" },
    { title: "＃豪景花園 B" },
    { title: "＃漣山 C" },
    { title: "【北都】無標記" },
    { title: "＃晉誠地產 樓市" },
  ];

  assert.deepEqual(buildTagCounts(videos), [
    { tag: "豪景花園", district: "青山公路", count: 2 },
    { tag: "漣山", district: null, count: 1 },
  ]);
});

// Chip order must not depend on row order, or the row shuffles between renders
// for no visible reason.
test("equal counts break alphabetically", () => {
  const counts = buildTagCounts([{ title: "＃漣山 A" }, { title: "＃上源 B" }]);
  assert.deepEqual(
    counts.map((entry) => entry.tag),
    ["上源", "漣山"],
  );
});

test("an empty list yields no tags", () => {
  assert.deepEqual(buildTagCounts([]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:videos`
Expected: FAIL — `buildTagCounts` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/video-tags.js`:

```javascript
/**
 * Counts derived tags across a video list, most frequent first.
 *
 * Ties break alphabetically so the chip row is stable between renders rather
 * than reflecting whatever order the rows arrived in.
 *
 * @param {ReadonlyArray<{ title?: string | null }>} videos
 * @returns {Array<{ tag: string, district: string | null, count: number }>}
 */
export function buildTagCounts(videos) {
  /** @type {Map<string, { tag: string, district: string | null, count: number }>} */
  const counts = new Map();

  for (const video of videos) {
    const derived = deriveEstateTag(video?.title);
    if (!derived) continue;
    const existing = counts.get(derived.tag);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(derived.tag, { ...derived, count: 1 });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hant"),
  );
}
```

Add to `src/lib/video-tags.d.ts`:

```typescript
export type TagCount = EstateTag & { count: number };

export function buildTagCounts(
  videos: ReadonlyArray<{ title?: string | null }>,
): TagCount[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:videos`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-tags.js src/lib/video-tags.d.ts src/lib/video-tags.test.mjs
git commit -m "feat(videos): count and order estate tags for the chip row"
```

---

### Task 5: Expose the YouTube publish date to the client

**Files:**
- Modify: `src/lib/neon/public-data.server.ts` (the `fetchCmsVideos` query and its row mapping)
- Modify: `src/lib/queries.ts` (the `CmsVideo` type)

**Why this task exists.** `CmsVideo` is `{ id, title, video_url, description, sort_order, created_at }`. The query's `ORDER BY` already references `youtube_published_at` but never **selects** it, so the client cannot see it.

Sorting on `created_at` instead is not a workaround — it is wrong. `created_at` is when the row was inserted into `cms_videos`, and all 95 synced videos were inserted within seconds of each other during one full sync. Sorting by it would order the catalogue essentially at random while looking like it worked. 最新／最舊 need the real publish date.

- [ ] **Step 1: Add the column to the SELECT**

In `src/lib/neon/public-data.server.ts`, `fetchCmsVideos` currently selects:

```sql
      SELECT id, title, video_url, description, sort_order, created_at
```

Change it to:

```sql
      SELECT id, title, video_url, description, sort_order, created_at, youtube_published_at
```

Leave the `WHERE` and `ORDER BY` clauses untouched.

- [ ] **Step 2: Map the new column**

In the same function's `rows.map(...)`, alongside `created_at: dateOrNull(row.created_at),` add:

```typescript
    youtube_published_at: dateOrNull(row.youtube_published_at),
```

- [ ] **Step 3: Add it to the type**

In `src/lib/queries.ts`, `CmsVideo` becomes:

```typescript
export type CmsVideo = {
  id: string;
  title: string;
  video_url: string;
  description: string | null;
  sort_order: number;
  created_at: string | null;
  /** Real upload date from YouTube. Null for videos added by hand in the CMS. */
  youtube_published_at: string | null;
};
```

- [ ] **Step 4: Verify nothing else breaks**

Run: `npx tsc --noEmit && npm run test:cms && npm run test:seo`
Expected: no type errors, both suites pass. `test:cms` covers `cms-videos-schema` and the public-isolation contract, which are the tests most likely to notice a changed projection.

- [ ] **Step 5: Commit**

```bash
git add src/lib/neon/public-data.server.ts src/lib/queries.ts
git commit -m "feat(videos): expose youtube_published_at so /videos can sort by upload date"
```

---

### Task 6: Add validated search params to the route

**Files:**
- Modify: `src/routes/videos.tsx`
- Create: `src/routes/videos.contract.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract test**

Create `src/routes/videos.contract.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/routes/videos.tsx", "utf8");

// listings.tsx established this pattern. fallback() is what makes a stale link
// from WhatsApp render the unfiltered page instead of erroring.
test("search params are Zod-validated with fallbacks", () => {
  assert.match(source, /zodValidator\(searchSchema\)/);
  assert.match(source, /from "@tanstack\/zod-adapter"/);
  assert.match(source, /fallback\(/);
});

// The sort vocabulary is English and decoupled from the Chinese labels, so
// rewording 最新 never invalidates a shared link.
test("sort accepts exactly the three documented values", () => {
  assert.match(source, /z\.enum\(\["newest", "oldest", "featured"\]\)/);
});

test("estate and q are optional free text", () => {
  assert.match(source, /estate:\s*fallback\(/);
  assert.match(source, /q:\s*fallback\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/videos.contract.test.mjs`
Expected: FAIL — `videos.tsx` has no `zodValidator`.

- [ ] **Step 3: Add the schema to the route**

In `src/routes/videos.tsx`, add to the imports:

```typescript
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
```

Add above `export const Route`:

```typescript
// Values are English and decoupled from the Chinese labels (最新 / 最舊 / 精選) so
// rewording a label never invalidates a link someone already shared.
const searchSchema = z.object({
  estate: fallback(z.string().optional(), undefined),
  sort: fallback(z.enum(["newest", "oldest", "featured"]), "newest").default("newest"),
  q: fallback(z.string().optional(), undefined),
});
```

Add `validateSearch` to the route definition, keeping the existing `loader` and `head`:

```typescript
export const Route = createFileRoute("/videos")({
  validateSearch: zodValidator(searchSchema),
  loader: async () => fetchVideosPageData(),
  head: () => ({ /* unchanged */ }),
  component: VideosPage,
});
```

The loader does **not** take `loaderDeps` — filtering happens client-side over the already-loaded list, so changing a filter must not refetch.

- [ ] **Step 4: Wire the contract test into a script**

In `package.json`:

```json
"test:videos": "node --test src/lib/video-presentation.test.mjs src/lib/video-tags.test.mjs src/routes/videos.contract.test.mjs",
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test:videos && node --test src/test-wiring.test.mjs && npx tsc --noEmit`
Expected: PASS on all three, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/videos.tsx src/routes/videos.contract.test.mjs package.json
git commit -m "feat(videos): validate estate, sort and q search params"
```

---

### Task 7: Render the chip row and sort select

**Files:**
- Modify: `src/routes/videos.tsx`

- [ ] **Step 1: Replace the local search state with URL state**

PR #66 left `VideosPage` holding `query` and `visibleCount` in `useState`. Replace the `query` state with the URL param; keep `visibleCount` local (paging is ephemeral and does not belong in a shared link).

At the top of `VideosPage`:

```typescript
function VideosPage() {
  const { cmsVideos, listingVideos } = Route.useLoaderData();
  const { estate, sort, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/videos" });
  const [visibleCount, setVisibleCount] = useState(VIDEOS_PER_PAGE);
  const [showAllTags, setShowAllTags] = useState(false);

  const inquiryUrl = whatsappUrl("你好，我想睇深井／青山公路／汀九樓盤影片");
  const hasVideos = cmsVideos.length > 0 || listingVideos.length > 0;
  const trimmedQuery = (q ?? "").trim().toLowerCase();

  const tagCounts = useMemo(() => buildTagCounts(cmsVideos), [cmsVideos]);

  const matchingCmsVideos = useMemo(() => {
    return cmsVideos.filter((video) => {
      if (estate && deriveEstateTag(video.title)?.tag !== estate) return false;
      if (trimmedQuery && !video.title?.toLowerCase().includes(trimmedQuery)) return false;
      return true;
    });
  }, [cmsVideos, estate, trimmedQuery]);

  const sortedCmsVideos = useMemo(() => {
    const rows = [...matchingCmsVideos];
    const time = (video: CmsVideo) =>
      new Date(video.youtube_published_at ?? video.created_at ?? 0).getTime();
    if (sort === "oldest") return rows.sort((a, b) => time(a) - time(b));
    if (sort === "featured") return rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return rows.sort((a, b) => time(b) - time(a));
  }, [matchingCmsVideos, sort]);
```

Add the imports:

```typescript
import { buildTagCounts, deriveEstateTag } from "@/lib/video-tags.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

`youtube_published_at` and `sort_order` are both on `CmsVideo` once Task 5 lands. Do not start this task before Task 5 — without it the sort references a field the query never returns.

- [ ] **Step 2: Add a helper that writes filter changes to the URL**

Inside `VideosPage`, below the memos:

```typescript
  // Every filter change resets paging: page 3 of an old filter is meaningless
  // against a new one.
  type VideoSearch = { estate?: string; sort: "newest" | "oldest" | "featured"; q?: string };
  const updateSearch = (next: Partial<VideoSearch>) => {
    setVisibleCount(VIDEOS_PER_PAGE);
    navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    });
  };
```

`replace: true` keeps filter fiddling out of the back-button history — the back button should leave `/videos`, not walk through every chip tapped.

- [ ] **Step 3: Render the chip row**

Replace the search-box block from PR #66 with:

```tsx
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-primary">屋苑</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateSearch({ estate: undefined })}
                    aria-pressed={!estate}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      !estate
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted"
                    }`}
                  >
                    全部 {cmsVideos.length}
                  </button>
                  {(showAllTags ? tagCounts : tagCounts.slice(0, 8)).map((entry) => (
                    <button
                      key={entry.tag}
                      type="button"
                      onClick={() => updateSearch({ estate: entry.tag })}
                      aria-pressed={estate === entry.tag}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        estate === entry.tag
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted"
                      }`}
                    >
                      {entry.tag} {entry.count}
                    </button>
                  ))}
                  {!showAllTags && tagCounts.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags(true)}
                      className="rounded-full border border-dashed border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                    >
                      更多 {tagCounts.length - 8} ▾
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="video-sort" className="text-sm font-semibold text-primary">
                    排序
                  </label>
                  <Select value={sort} onValueChange={(value) => updateSearch({ sort: value })}>
                    <SelectTrigger id="video-sort" className="mt-2 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">最新</SelectItem>
                      <SelectItem value="oldest">最舊</SelectItem>
                      <SelectItem value="featured">精選</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1">
                  <label htmlFor="video-search" className="text-sm font-semibold text-primary">
                    搜尋影片
                  </label>
                  <div className="relative mt-2 max-w-md">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      id="video-search"
                      type="search"
                      value={q ?? ""}
                      onChange={(event) =>
                        updateSearch({ q: event.target.value || undefined })
                      }
                      placeholder="輸入屋苑或影片名稱"
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground" aria-live="polite">
                {estate || trimmedQuery
                  ? `搵到 ${sortedCmsVideos.length + matchingListingVideos.length} 條影片`
                  : `共 ${cmsVideos.length + listingVideos.length} 條影片`}
              </p>
            </div>
```

- [ ] **Step 4: Point the grid at the sorted list**

Replace `matchingCmsVideos` with `sortedCmsVideos` in the card grid and the load-more calculation:

```typescript
  const visibleCmsVideos = sortedCmsVideos.slice(0, visibleCount);
  const remainingCount = sortedCmsVideos.length - visibleCmsVideos.length;
  const hasMatches = sortedCmsVideos.length > 0 || matchingListingVideos.length > 0;
```

Leave `matchingListingVideos` filtering on `q` only — 樓盤影片 is excluded from estate filtering per the spec, because its estate comes from a database relation rather than a parsed title.

Leave `<AllVideoSchemas cmsVideos={cmsVideos} listingVideos={listingVideos} />` **exactly as is** — it takes the unfiltered lists. `schema.test.mjs` asserts this; filtering it would hide 96 videos from crawlers.

- [ ] **Step 5: Clear the empty-state filter too**

In the no-matches block from PR #66, the 清除搜尋 button must clear the URL, not local state:

```tsx
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => updateSearch({ estate: undefined, q: undefined })}
                >
                  清除篩選
                </Button>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx eslint src/routes/videos.tsx && npm run test:videos && npm run test:seo && npm run build`
Expected: no type errors, lint clean, all tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/routes/videos.tsx
git commit -m "feat(videos): filter by estate chip and sort, driven by the URL"
```

---

### Task 8: Verify on a preview deployment

**Files:** none — verification only.

- [ ] **Step 1: Push and open a PR**

```bash
git push -u origin feat/videos-filtering-and-sorting
gh pr create --base main --title "Filter and sort /videos by estate" --body "Implements docs/superpowers/specs/2026-08-20-videos-filtering-sorting-design.md"
```

- [ ] **Step 2: Get access to the protected preview**

Preview deployments sit behind Vercel authentication. Use the Vercel MCP `get_access_to_vercel_url` tool on the preview URL to mint a `_vercel_share` link, then open that.

- [ ] **Step 3: Check the real numbers**

In the browser console on the preview `/videos`:

```javascript
(()=>{const chips=[...document.querySelectorAll('button[aria-pressed]')].map(b=>b.innerText.trim());
return JSON.stringify({chips, cards:document.querySelectorAll('article').length,
schemas:document.querySelectorAll('script[type="application/ld+json"]').length,
iframes:document.querySelectorAll('iframe').length})})()
```

Expected: a `全部 96` chip plus 8 estate chips and a 更多 chip; 13 cards; **97 schemas**; **0 iframes**.

The schema count is the critical one. If it drops below 97 when a filter is active, `AllVideoSchemas` has been wired to the filtered list and crawlers are seeing a fraction of the catalogue.

- [ ] **Step 4: Check a shared link cold**

Open `<preview>/videos?estate=豪景花園&sort=oldest` in a fresh tab. The 豪景花園 chip must render selected and the sort select must read 最舊 on first paint, with no flash of the unfiltered list.

Then open `<preview>/videos?estate=NOPE&sort=banana`. It must render the unfiltered page with sort 最新 — `fallback()` doing its job — not an error boundary.

- [ ] **Step 5: Commit any fixes and update the PR**

---

## Notes for the implementer

**Do not add `loaderDeps` to the route.** Filtering is client-side over the already-loaded list. Adding `loaderDeps` makes every chip tap refetch from Neon for no benefit.

**Do not touch `AllVideoSchemas`.** It must keep receiving the unfiltered lists.

**`npx tsc --noEmit` requires `@types/bun` to be installed.** If it reports `Cannot find type definition file for 'bun'`, run `npm install` — it is declared in `package.json` but a stale `node_modules` can lack it, and in that state tsc silently stops typechecking rather than failing loudly.

**Phase 2 is out of scope.** No migration, no sync change, no view counts. If a task seems to need them, re-read the spec.
