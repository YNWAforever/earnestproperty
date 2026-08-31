# P5e2 — /estate-reviews filters + /videos category taxonomy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Finish the remaining two items from P5's deferred editorial backlog (the master plan's `/estate-reviews` and `/videos` line items) that P5e1 didn't cover: a real district filter + an accessibility fix on `/estate-reviews`, and a video category taxonomy (樓盤實拍/屋苑開箱/市場評論/社區生活) on `/videos`, including the admin editor needed to actually assign one.

**Base branch:** `main` (post-P5e1/#91). Independent of the admin-workspace P6 work and of P5e1's blog changes.

---

## 0. Scope decisions (read before starting)

1. **`/estate-reviews`'s "屋苑入口" district filter reuses `estate-registry.ts`'s existing `homepageDistrict` field** (`"深井" | "青山公路" | "汀九" | null`) — no new DB column, no new query. `fetchEstateOptions()` only returns published estates (today: the 5 real `hasPage:true` ones, since P4's 17 additions are all `published:false`), so this cross-reference is a simple slug lookup against an already-loaded static registry.
2. **The `alt=""` on the article cover image is a real, unambiguous a11y bug** (cited in the master plan's DR-7) — fixed to `article.title`, which is always a real, non-empty string for any article that reaches this card.
3. **Video category is a genuine, admin-assigned fact, not a derived heuristic** — unlike the existing estate tag (parsed from the title's `＃estate` marker, see `video-tags.js`), there is no reliable way to infer "is this a walkthrough vs. market commentary" from a title. This requires a real nullable `category` column plus an admin editor to set it. Existing videos (currently ~96, synced from YouTube) get `category = null` — shown as unfiltered/"未分類", never guessed.
4. **Category is a closed 4-value taxonomy, enforced with a `<Select>` in the admin editor**, not a free-text field. Unlike `admin.cms.tsx`'s article-category `TextField` (which tolerates a typo since `/blog`'s consequence is just "this article won't match a filter chip"), a mistyped video category would silently and permanently exclude that video from every category chip's count — a `<Select>` closes that failure mode entirely rather than matching the article editor's looser (arguably already slightly buggy) precedent.
5. **Listing videos** (`VideoListing`, videos attached to a live property listing, no `cms_videos` row) are unambiguously property walkthroughs by construction — when the category filter narrows to anything other than "全部" or "樓盤實拍", the listing-videos section hides; for those two values it shows, same as today.
6. **Explicitly deferred, not silently dropped: "conditional nav"** (master plan: "a nav item for an empty collection must fall back or disappear", for `/estate-reviews` when it has zero articles). `SiteHeader` is rendered on every public page with no loader of its own; making its nav conditional on live article/transaction counts would require a new root-level data fetch running on every navigation — a real architectural change, not a small polish fix. `/estate-reviews` already self-`noindex`s and is excluded from the sitemap when empty (existing behaviour), so the residual cost of an always-visible nav link to a graceful empty state is low. Left as a documented follow-up, not built in this PR.

---

## Task 1: `cms_videos.category` migration + query/type plumbing

**Files:**
- Create: `neon/migrations/20260831180000_video_category.sql`
- Modify: `src/lib/neon/public-data.server.ts` (`fetchCmsVideos`)
- Modify: `src/lib/queries.ts` (`CmsVideo` type)
- Modify: `src/lib/neon/admin-data.server.ts` (`fetchAdminCmsVideos`, `saveAdminCmsVideo`)
- Modify: `src/lib/neon/admin-data.types.ts` (`AdminCmsVideoInput`, `AdminCmsVideoRow`)
- Create: `src/content/video-categories.ts`
- Create: `src/content/video-categories.test.mjs`

- [x] **Step 1: Write the migration**

```sql
-- neon/migrations/20260831180000_video_category.sql
ALTER TABLE cms_videos ADD COLUMN IF NOT EXISTS category text;
```

No `NOT NULL`, no default other than the implicit `NULL` — every existing row (currently ~96 YouTube-synced videos) has no assigned category, and none should be guessed.

- [x] **Step 2: Define the taxonomy**

```typescript
// src/content/video-categories.ts
export const VIDEO_CATEGORIES = ["樓盤實拍", "屋苑開箱", "市場評論", "社區生活"] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export function isVideoCategory(value: string): value is VideoCategory {
  return (VIDEO_CATEGORIES as readonly string[]).includes(value);
}
```

- [x] **Step 3: Test the taxonomy guard**

```javascript
// src/content/video-categories.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { isVideoCategory, VIDEO_CATEGORIES } from "./video-categories.ts";

test("VIDEO_CATEGORIES has exactly the 4 master-plan categories, in order", () => {
  assert.deepEqual(VIDEO_CATEGORIES, ["樓盤實拍", "屋苑開箱", "市場評論", "社區生活"]);
});

test("isVideoCategory accepts only the named 4 categories", () => {
  for (const category of VIDEO_CATEGORIES) {
    assert.equal(isVideoCategory(category), true);
  }
  assert.equal(isVideoCategory("其他"), false);
  assert.equal(isVideoCategory(""), false);
});
```

Run: `node --test src/content/video-categories.test.mjs` — expect all pass.

- [x] **Step 4: Add `category` to `CmsVideo` and the public read query**

In `src/lib/queries.ts`, extend the type:

```typescript
export type CmsVideo = {
  id: string;
  title: string;
  video_url: string;
  description: string | null;
  sort_order: number;
  created_at: string | null;
  youtube_published_at: string | null;
  category: string | null;
};
```

In `src/lib/neon/public-data.server.ts`'s `fetchCmsVideos`, add `category` to the `SELECT` list and the returned object (use this file's existing `stringOrNull` helper — check the function's current imports, it already uses this helper for `description`):

```typescript
SELECT id, title, video_url, description, sort_order, created_at, youtube_published_at, category
FROM cms_videos
WHERE published = true
```

and in the row-mapping object add `category: stringOrNull(row.category),`.

- [x] **Step 5: Add `category` to the admin read/write path**

In `src/lib/neon/admin-data.types.ts`:

```typescript
export type AdminCmsVideoInput = {
  id?: string;
  title: string;
  video_url: string;
  description: string | null;
  sort_order: number;
  published: boolean;
  category: string | null;
};
```

(`AdminCmsVideoRow` already extends `AdminCmsVideoInput`, no separate change needed there.)

In `src/lib/neon/admin-data.server.ts`'s `fetchAdminCmsVideos`, add `category` to the `SELECT` list and to the mapped object (`category: stringOrNull(row.category),`).

In `saveAdminCmsVideo`, add `input.category` to the `params` array (after `input.published`) and to both the `UPDATE`/`INSERT` SQL:

```typescript
const params = [
  input.title,
  input.video_url,
  input.description,
  input.sort_order,
  input.published,
  input.category,
];
```

```sql
UPDATE cms_videos SET
  title = $1, video_url = $2, description = $3, sort_order = $4,
  published = $5, category = $6, updated_at = now()
WHERE id = $7
RETURNING id
```

```sql
INSERT INTO cms_videos (title, video_url, description, sort_order, published, category)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id
```

(Update the positional `input.id` param slot from `$6`/`[...params, input.id]` to `$7` — same array-append pattern already used, just one slot further along.)

- [x] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

- [x] **Step 7: Commit**

```bash
git add neon/migrations/20260831180000_video_category.sql src/content/video-categories.ts src/content/video-categories.test.mjs src/lib/queries.ts src/lib/neon/public-data.server.ts src/lib/neon/admin-data.server.ts src/lib/neon/admin-data.types.ts
git commit -m "feat(videos): add a nullable category column and taxonomy for cms_videos"
```

---

## Task 2: Admin CMS video editor — category select

**Files:**
- Modify: `src/routes/admin.cms.tsx`

- [x] **Step 1: Add `category: null` to `emptyCmsVideo`** (the "new video" default object, currently missing the field entirely — check its exact current shape before editing, it sits near the top of the file alongside `emptyCmsVideo`'s sibling empty-object constants).

- [x] **Step 2: Add a category `<Select>` to `CmsVideoDialog`**, after the "排序" `NumberField` and before the "發布" `Field`:

```tsx
<Field label="分類">
  <Select
    value={video.category ?? "none"}
    onValueChange={(value) => onChange({ ...video, category: value === "none" ? null : value })}
  >
    <SelectTrigger>
      <SelectValue placeholder="未分類" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">未分類</SelectItem>
      {VIDEO_CATEGORIES.map((category) => (
        <SelectItem key={category} value={category}>
          {category}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</Field>
```

Import `VIDEO_CATEGORIES` from `@/content/video-categories`. Check whether `Field` (the label-wrapper component already used for "發布" a few lines below) is generic enough to wrap a `<Select>` directly, or whether it expects a specific child shape — read its definition in this same file before assuming.

- [x] **Step 3: Propagate `category` through `cmsVideoToInput` and `cmsVideoFingerprintValues`** (both near the bottom of the file, both already listed in the earlier grep of this file) — add `category: video.category` to `cmsVideoToInput`'s returned object, and `category` to whatever field list `cmsVideoFingerprintValues` builds for videos (matching how it already includes `title`/`description`/etc. — read the function first to match its existing shape).

- [x] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

- [x] **Step 5: Extend `cms-videos-schema.test.mjs` or a new source-scan assertion** confirming `saveAdminCmsVideo`'s SQL includes `category` (source-text scan, matching this file's existing style):

```javascript
test("saveAdminCmsVideo persists the category column", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/neon/admin-data.server.ts"),
    "utf8",
  );
  const saveFunction = source.match(
    /export async function saveAdminCmsVideo[\s\S]*?\r?\n}\r?\n\r?\nexport async function saveAdminEstate/,
  )?.[0];
  assert.match(saveFunction ?? "", /category = \$6/);
  assert.match(saveFunction ?? "", /input\.category/);
});
```

Run: `node --test src/lib/neon/cms-videos-schema.test.mjs`

- [x] **Step 6: Commit**

```bash
git add src/routes/admin.cms.tsx src/lib/neon/cms-videos-schema.test.mjs
git commit -m "feat(admin): add a video category selector to the CMS video editor"
```

---

## Task 3: `/videos` category filter

**Files:**
- Modify: `src/routes/videos.tsx`
- Modify: `src/routes/videos.contract.test.mjs`

- [x] **Step 1: Add `category` to the URL search schema**

```typescript
const searchSchema = z.object({
  estate: fallback(z.string().optional(), undefined),
  category: fallback(z.string().optional(), undefined),
  sort: fallback(z.enum(["newest", "oldest", "featured"]), "newest").default("newest"),
  q: fallback(z.string().optional(), undefined),
});
```

- [x] **Step 2: Read `category` from `Route.useSearch()`** alongside the existing `estate`/`sort`/`q` destructure.

- [x] **Step 3: Filter `matchingCmsVideos` by category**, composed with the existing estate/query filters (add one more `if` guard in the same `.filter()` callback):

```typescript
if (category && video.category !== category) return false;
```

- [x] **Step 4: Filter `matchingListingVideos` by category** — per scope decision §0.5, listing videos are implicitly "樓盤實拍":

```typescript
if (category && category !== "樓盤實拍") return false;
```

(add this alongside the existing `estate`/`trimmedQuery` guards in that filter's callback)

- [x] **Step 5: Compute category counts and render chips**, mirroring the existing estate-tag chip row exactly (same `aria-pressed` pattern, same "全部 N" first chip) — place this as a second chip row, above or below "屋苑" (choose above, since narrowing by content type is a coarser filter than narrowing by estate):

```typescript
const categoryCounts = useMemo(() => {
  const counts = new Map<string, number>();
  for (const video of cmsVideos) {
    if (video.category) counts.set(video.category, (counts.get(video.category) ?? 0) + 1);
  }
  return VIDEO_CATEGORIES.map((cat) => ({ category: cat, count: counts.get(cat) ?? 0 }));
}, [cmsVideos]);
```

```tsx
<div>
  <p className="text-sm font-semibold text-primary">分類</p>
  <div className="mt-2 flex flex-wrap gap-2">
    <button
      type="button"
      onClick={() => updateSearch({ category: undefined })}
      aria-pressed={!category}
      className={/* same conditional classes as the existing 全部 estate chip */}
    >
      全部 {cmsVideos.length}
    </button>
    {categoryCounts.map((entry) => (
      <button
        key={entry.category}
        type="button"
        onClick={() => updateSearch({ category: entry.category })}
        aria-pressed={category === entry.category}
        className={/* same conditional classes */}
      >
        {entry.category} {entry.count}
      </button>
    ))}
  </div>
</div>
```

Import `VIDEO_CATEGORIES` from `@/content/video-categories`. Add `category` to the `VideoSearch` type and to `updateSearch`'s partial-update signature (both already exist for `estate`/`sort`/`q`).

- [x] **Step 6: Update the empty-state / "搵到 N 條影片" count copy** if it hardcodes a filter list — check the existing empty-state JSX (search for "搵到" or "清除篩選" in this file) and confirm the category filter is included wherever it resets/reports active filters, matching how `estate`/`q` already are.

- [x] **Step 7: Typecheck**

Run: `npx tsc --noEmit`

- [x] **Step 8: Extend `videos.contract.test.mjs`** (source-text scan, matching its existing style) with assertions for: the `category` search-schema field, the category filter guards on both video arrays, the chip row rendering `VIDEO_CATEGORIES`, and the listing-video 樓盤實拍-only guard.

Run: `npm run test:videos`

- [x] **Step 9: Commit**

```bash
git add src/routes/videos.tsx src/routes/videos.contract.test.mjs
git commit -m "feat(videos): add a category filter (樓盤實拍/屋苑開箱/市場評論/社區生活) to /videos"
```

---

## Task 4: `/estate-reviews` — real alt text + district filter

**Files:**
- Modify: `src/routes/estate-reviews.tsx`
- Create: `src/routes/estate-reviews.contract.test.mjs`

- [x] **Step 1: Fix the article cover image's `alt=""`**

```tsx
<AppImage
  src={article.cover_image}
  alt={article.title}
  width={640}
  height={360}
  className="h-full w-full object-cover"
  fallback={<BookOpen className="h-8 w-8" />}
/>
```

- [x] **Step 2: Cross-reference the loaded estates against the registry's `homepageDistrict`**, computed once via `useMemo` in the component (not in the loader — this is presentation grouping over already-loaded data, not a new fetch):

```typescript
import { getEstateEntry } from "@/content/estate-registry";
import type { EstateHomepageDistrict } from "@/content/estate-registry";
// ...
const DISTRICT_FILTERS = ["全部", "深井", "青山公路", "汀九"] as const;
type DistrictFilter = (typeof DISTRICT_FILTERS)[number];

const estatesWithDistrict = useMemo(
  () =>
    estates.map((estate) => ({
      ...estate,
      homepageDistrict: getEstateEntry(estate.slug).homepageDistrict,
    })),
  [estates],
);
```

`getEstateEntry` throws for a slug it doesn't recognise (see `estate-registry.ts:413`) — `fetchEstateOptions()` only returns real published-estate rows, and every one of today's 5 published estates already has a registry entry (asserted elsewhere, e.g. `estate-registry.test.mjs`'s own "every hasPage:true entry has a matching estateSeo" test), so this is safe as a direct call, not a `.find()` needing a null-guard.

- [x] **Step 3: Add district filter chips and wire them to the estate grid**

```tsx
const [districtFilter, setDistrictFilter] = useState<DistrictFilter>("全部");
const filteredEstates = useMemo(
  () =>
    districtFilter === "全部"
      ? estatesWithDistrict
      : estatesWithDistrict.filter((estate) => estate.homepageDistrict === districtFilter),
  [estatesWithDistrict, districtFilter],
);
```

Render the chip row (same visual pattern as `/videos`' and `/blog`'s existing filter chips — `aria-pressed`, active/inactive class pair) above the estate grid, inside the "屋苑入口" section, only when `estatesWithDistrict.length > 0`. Render `filteredEstates` instead of `estates` in the grid's `.map()`.

- [x] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

- [x] **Step 5: Write a contract test** (source-text scan, matching `blog.editorial-standards.contract.test.mjs`'s style) asserting: the cover image's `alt` is `article.title` (not `""`), the district-filter chips render `DISTRICT_FILTERS`, and `getEstateEntry` (not a guessed/hardcoded district map) is the source of each estate's district.

```javascript
// src/routes/estate-reviews.contract.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("estate-reviews article cards use a real alt, never alt=\"\"", () => {
  const source = read("src/routes/estate-reviews.tsx");
  assert.doesNotMatch(source, /alt=""/);
  assert.match(source, /alt=\{article\.title\}/);
});

test("estate-reviews district filter sources its grouping from the registry, not a guessed map", () => {
  const source = read("src/routes/estate-reviews.tsx");
  assert.match(source, /import \{ getEstateEntry \}/);
  assert.match(source, /getEstateEntry\(estate\.slug\)\.homepageDistrict/);
  assert.match(source, /DISTRICT_FILTERS = \["全部", "深井", "青山公路", "汀九"\]/);
});
```

Run: `node --test src/routes/estate-reviews.contract.test.mjs`

- [x] **Step 6: Register the new test** in `package.json` — check whether an existing `test:*` script already covers `estate-reviews.tsx`; if not, add `src/routes/estate-reviews.contract.test.mjs` to the most relevant existing script (`test:homepage` or a similarly-scoped one) rather than inventing a new one-file script.

- [x] **Step 7: Commit**

```bash
git add src/routes/estate-reviews.tsx src/routes/estate-reviews.contract.test.mjs package.json
git commit -m "feat(estate-reviews): fix cover alt text and add a homepageDistrict filter"
```

---

## Final verification

Run: `npm run test:videos && node --test src/content/video-categories.test.mjs src/lib/neon/cms-videos-schema.test.mjs src/routes/estate-reviews.contract.test.mjs && npx tsc --noEmit && npm run build && npm run lint`

## Acceptance

- `cms_videos` has a real, nullable `category` column; existing videos show as unfiltered rather than a guessed category.
- Admin can assign one of the 4 named categories (or none) to any video via a closed `<Select>`, not free text.
- `/videos` has a working category filter, composable with the existing estate/search/sort filters, with listing videos correctly scoped to "樓盤實拍".
- `/estate-reviews`'s article cover image has a real `alt`, and its estate portal has a working district filter sourced from the existing registry, not a new guess.
- "Conditional nav" is explicitly documented as deferred, not silently dropped.
