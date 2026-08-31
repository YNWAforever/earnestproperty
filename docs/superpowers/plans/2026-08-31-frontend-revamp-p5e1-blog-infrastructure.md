# P5e1 — Blog infrastructure + the two flagship article rewrites

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the blog infrastructure the master plan calls for (categories, search, ToC, author+reviewer, sources, comparison tables, answer summaries, an editorial-standards page) and use it to rewrite the two thin flagship articles (`sham-tseng-buying-guide-2026`, `bellagio-vs-sea-crest-villa-vs-hong-kong-garden`) — the reason P5 deferred this was that it's genuine long-form authorship, not a technical blocker.

**Base branch:** `main` (post-P5/P6a/P6b, all merged). Independent of the admin-workspace P6 work.

---

## 0. Design decisions (read before starting — these resolve real honesty/fabrication risks)

1. **Every fact in the rewritten articles must trace to something already established elsewhere in this codebase.** No new psf figures, school names, or transport timings are invented. Specifically:
   - The original thin articles' transport claims ("X961 經西隧約 35 分鐘到中環，自駕經青馬橋往機場約 22 分鐘") **do not appear anywhere in `castle-peak-road.ts`** — they were unsourced when first written. The rewrite drops them and reuses `castlePeakRoadSegments.find(s => s.slug === "sham-tseng")`'s actual transport string verbatim.
   - School-net facts reuse `shamTsengSchoolNet` from `school-nets.ts` **as-is** — `primarySchools: []` stays empty (no real EDB source has been supplied yet); the article states the net code (62) and the exact existing caveat, nothing more specific.
   - Estate comparison numbers (avg PSF, total units, year completed, developer) are **fetched live** via `fetchEstateBySlug()` at request time for each of the 5 estates, not hand-typed — so they can never go stale or be wrong, and any field the DB doesn't have renders "—" (matching `estate-comparison.ts`'s existing `estateFigure`/`estateTextFigure` helpers exactly).
2. **Author is an organizational byline, not an invented person.** No existing author/reviewer convention exists in this codebase (confirmed — the only precedent is `Organization` as the JSON-LD `author`). Use `"晉誠地產編輯團隊"` (Earnest Property Editorial Team) as `author` — matching the existing `SITE_NAME`-as-organization pattern, not a fabricated named writer.
3. **No fabricated reviewer.** The master plan wants an author-and-reviewer byline for trust signals, but nobody has actually reviewed these two rewrites yet. The data model supports a `reviewer: string | null` field and the UI shows it when set — but it stays `null` for both articles in this PR. This is the same "hide, don't fabricate" discipline this project applies to every other unverified fact, applied to authorship claims.
4. **Estate slugs, verified against `estate-registry.ts`:** the two articles' 5 referenced estates are `bellagio` (碧堤半島), `hong-kong-garden` (豪景花園), `sea-crest-villa` (浪翠園), `lido-garden` (麗都花園), `rhine-garden` (海韻花園) — all real, published (`hasPage: true`), all in the Sham Tseng segment. (Not `hoi-wan-toi`/`hoi-wan-hin` — two similarly-named but unrelated, unpublished registry entries.)
5. **The comparison table is a new, neutral N-way component**, not a reuse of `EstateComparisonTable` (which is hard-coded to a "current estate vs. its neighbours" framing for the estate detail page). The new component reuses `estate-comparison.ts`'s already-neutral `buildComparisonRowDefs()` row definitions and `estateFigure`/`estateTextFigure` formatters directly — no duplicated formatting logic.

---

## Task 1: Blog content model and category taxonomy

**Files:**
- Create: `src/content/blog-articles.ts`
- Create: `src/content/blog-articles.test.mjs`
- Modify: `src/content/seo.ts` (remove the old `blogArticles` export, re-export from the new file for any other callers — check first)

- [x] **Step 1: Define the model**

```typescript
export const BLOG_CATEGORIES = [
  "買樓攻略",
  "租樓攻略",
  "屋苑比較",
  "成交分析",
  "社區生活",
  "市場評論",
] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export type BlogArticleSection = { heading: string; paragraphs: string[] };

export type BlogArticleMeta = {
  slug: string;
  title: string;
  excerpt: string;
  category: BlogCategory;
  readingMinutes: number;
  author: string;
  reviewer: string | null;
  sourcesNote: string;
  answerSummary: string;
  sections: readonly BlogArticleSection[];
  compareEstateSlugs?: readonly string[];
  links: readonly { href: string; label: string }[];
};

export const blogArticles: readonly BlogArticleMeta[] = [ /* Task 2's two rewrites */ ];
```

- [x] **Step 2: Write a contract test** asserting: every `category` is one of `BLOG_CATEGORIES`; every article has a non-empty `sections` array; `reviewer` is either `null` or a non-empty string (never an empty-string placeholder); `compareEstateSlugs` (where present) only references real registry slugs (import `estateRegistry`/`hasEstatePage`-equivalent from `estate-registry.ts` and check each slug resolves).

- [x] **Step 3: Check `seo.ts`'s existing `blogArticles` callers** (grep `blogArticles` across `src/`) and update each to import from the new file instead. Remove the old export from `seo.ts` once nothing references it there.

- [x] **Step 4: Run the test, typecheck**

Run: `node --test src/content/blog-articles.test.mjs && npx tsc --noEmit`

- [x] **Step 5: Commit**

```bash
git add src/content/blog-articles.ts src/content/blog-articles.test.mjs src/content/seo.ts
git commit -m "feat(blog): add the blog article content model and category taxonomy"
```

---

## Task 2: Rewrite the two flagship articles

**Files:**
- Modify: `src/content/blog-articles.ts`

- [x] **Step 1: `sham-tseng-buying-guide-2026`**

Structure with real `sections` (each becomes a ToC entry): 深井樓市概覽 (corridor position, why waterfront-adjacent pricing is the draw — reuse `castle-peak-road.ts`'s own Sham Tseng segment description), 五大屋苑一覽 (a short paragraph per estate — profile/positioning only, no invented numbers; the actual PSF/units/year/developer numbers live in the live comparison table, not restated as prose), 交通 (verbatim from `castle-peak-road.ts`'s Sham Tseng transport string), 校網 (verbatim from `shamTsengSchoolNet` + its caveat). `compareEstateSlugs: ["bellagio", "hong-kong-garden", "sea-crest-villa", "lido-garden", "rhine-garden"]`. `sourcesNote` states the comparison table is live from the site's own estate database, transport/school-net text from this site's own verified content, both with the caveat that school-net allocation is subject to the Education Bureau's own current publication (not a fixed fact this article owns).

- [x] **Step 2: `bellagio-vs-sea-crest-villa-vs-hong-kong-garden`**

Structure with real `sections`: 三大屋苑背景 (positioning, using only facts already in `estate-registry.ts`/the live comparison — e.g. do NOT claim "碧堤半島最新" unless the live `yearCompleted` figures actually confirm the ordering; write the prose to reference the table's real numbers, e.g. "本表可見三個屋苑嘅落成年份差異" rather than asserting an order that might not hold), 點揀 (a decision-framing paragraph per persona — budget-flexible/sea-view-first/value-entry — kept as genuinely subjective/persona framing, not disguised facts, so it doesn't need a citation). `compareEstateSlugs: ["bellagio", "sea-crest-villa", "hong-kong-garden"]`.

**Before writing either article's prose, fetch the current live values for all 5 estates** (via the dev server or a one-off script calling `fetchEstateBySlug` for each slug, if this environment has DB access — if not, write the prose so it never depends on knowing the actual number, only on the live table showing it) so the "點揀" framing doesn't accidentally assert something the real data contradicts.

- [x] **Step 3: Run the content-model test again**

Run: `node --test src/content/blog-articles.test.mjs`

- [x] **Step 4: Commit**

```bash
git add src/content/blog-articles.ts
git commit -m "feat(blog): rewrite the two flagship articles with sourced content and a live comparison table"
```

---

## Task 3: The live, neutral estate comparison table component

**Files:**
- Create: `src/components/site/BlogEstateComparisonTable.tsx`
- Create: `src/components/site/BlogEstateComparisonTable.test.tsx`

- [x] **Step 1: Write the failing test** — given an array of `EstateComparisonRow`-shaped fixtures (no "current" concept), the table renders one column per estate (linked via `/estate/$slug` when `hasPage`) and one row per `buildComparisonRowDefs()` entry, with `"—"` for null fields.

- [x] **Step 2: Implement**, reusing `buildComparisonRowDefs` and the row/column table markup pattern from `EstateComparisonTable.tsx` almost verbatim, minus the "current vs comparables" framing (no `（目前瀏覽）` marker, no `buildComparisonColumns` call — just render every estate as an equal column).

- [x] **Step 3: Run the test**

Run: `bun test src/components/site/BlogEstateComparisonTable.test.tsx`

- [x] **Step 4: Commit**

```bash
git add src/components/site/BlogEstateComparisonTable.tsx src/components/site/BlogEstateComparisonTable.test.tsx
git commit -m "feat(blog): add a neutral N-way live estate comparison table for articles"
```

---

## Task 4: Wire the new article template (`blog_.$slug.tsx`)

**Files:**
- Modify: `src/routes/blog_.$slug.tsx`
- Modify: `src/routes/blog.routes.test.mjs` (existing test file — extend, don't replace)

- [x] **Step 1: Update the loader** to use `BlogArticleMeta` instead of the old `blogArticles` shape, and when `compareEstateSlugs` is present, fetch each via `fetchEstateBySlug()` in parallel (`Promise.all`), building `EstateComparisonRow[]` (`nameZh` from the DB row's `name_zh`, falling back to the registry entry's display name if the DB call fails for a given slug — never throw the whole page for one missing estate).

- [x] **Step 2: Add the ToC** — a `<nav>` listing `sections[].heading` as anchor links (slugify each heading for the `id`), rendered only when there are 2+ sections (a single-section article doesn't need a table of contents).

- [x] **Step 3: Add the author/reviewer byline block** — `作者：{author}` always; `審閱：{reviewer}` only when `reviewer` is non-null. Add the `sourcesNote` as a small caption near the byline (matching the zh-HK "資料來源" pattern already used by `DataNote`/similar components elsewhere — check `src/components/layout/DataNote.tsx` and reuse it if its API fits, rather than hand-rolling new markup).

- [x] **Step 4: Add the answer-summary box** — a highlighted callout near the top rendering `answerSummary`, before the ToC.

- [x] **Step 5: Render the comparison table** (Task 3's component) when `compareEstateSlugs` is present, after the last section.

- [x] **Step 6: Update the JSON-LD** — add `reviewedBy: { "@type": "Organization", name: reviewer }` to the `Article` schema only when `reviewer` is set (never emit a null/empty reviewedBy).

- [x] **Step 7: Extend `blog.routes.test.mjs`** with assertions for: ToC renders section headings as anchors, byline renders author unconditionally and reviewer conditionally, answer-summary box renders, comparison table mounts when `compareEstateSlugs` is present.

- [x] **Step 8: Typecheck and run the test**

Run: `npx tsc --noEmit && npm run test:blog`

- [x] **Step 9: Commit**

```bash
git add src/routes/blog_.\$slug.tsx src/routes/blog.routes.test.mjs
git commit -m "feat(blog): wire ToC, byline, sources, answer summary, and comparison table into the article template"
```

---

## Task 5: Blog list page — categories, search, card metadata

**Files:**
- Modify: `src/routes/blog.tsx`
- Modify: `src/routes/blog.routes.test.mjs`

- [x] **Step 1: Add category filter chips** (全部 + the 6 named categories) and a client-side search box (filters the already-loaded `articles` array by title/excerpt substring match, case-insensitive) — no new DB query, since `fetchPublishedArticlesByCategory` already exists but the fallback path also needs to support the same filter, so filter the unified `BlogCard[]` client-side exactly like `admin.cms.tsx`'s own `matchesSearch` pattern (reuse that helper's shape, don't reinvent).

- [x] **Step 2: Add author + published-date + cover-image display** to each card (author always available now that `BlogArticleMeta`/DB rows both carry it — for DB-sourced articles with no `author` column, default to `"晉誠地產編輯團隊"`, matching Task 1's organizational-byline decision, not a per-article guess).

- [x] **Step 3: Extend `blog.routes.test.mjs`** for the new filter/search UI and card metadata.

- [x] **Step 4: Typecheck and run the test**

Run: `npx tsc --noEmit && npm run test:blog`

- [x] **Step 5: Commit**

```bash
git add src/routes/blog.tsx src/routes/blog.routes.test.mjs
git commit -m "feat(blog): add category filters, search, and richer card metadata to the blog list"
```

---

## Task 6: Editorial standards page

**Files:**
- Create: `src/routes/blog.editorial-standards.tsx`
- Create: `src/routes/blog.editorial-standards.contract.test.mjs`

- [x] **Step 1: Build the page** (`/blog/editorial-standards`) — states plainly, in the same honest register as this project's other disclaimers: facts about estates/transactions come from the site's own live database (same data shown on `/estate/$slug`/`/transactions`); school-net information is limited to net codes pending an official EDB source; articles carry an author byline and, where a named reviewer has checked the content, a reviewer byline; content without a stated source is the writer's own analysis/opinion, not a verified fact. Links to `/disclaimer` for the general site disclaimer (don't duplicate that page's legal content).

- [x] **Step 2: Link to it** from the blog list page footer/byline area and from each article's byline block (Task 4).

- [x] **Step 3: Write a contract test** asserting the route exists, is not noindexed (this page should be crawlable — it's a trust signal, unlike admin routes), and mentions both "資料來源" and a link to `/disclaimer`.

- [x] **Step 4: Register the test** in `test:blog`.

- [x] **Step 5: Typecheck and run**

Run: `npx tsc --noEmit && npm run test:blog`

- [x] **Step 6: Commit**

```bash
git add src/routes/blog.editorial-standards.tsx src/routes/blog.editorial-standards.contract.test.mjs package.json
git commit -m "feat(blog): add the editorial and fact-checking standards page"
```

---

## Final verification

Run: `npm run test:blog && npm run test:estate-conversion && npx tsc --noEmit && npm run lint`

## Acceptance

- Both flagship articles have real structure (ToC, byline, sources, answer summary) and a live, never-stale, never-fabricated comparison table.
- No new psf/transport/school figure was invented — every fact traces to `castle-peak-road.ts`, `school-nets.ts`, `estate-registry.ts`, or a live `fetchEstateBySlug()` call.
- `/blog` has working category filters, search, and richer cards.
- The editorial-standards page states the real sourcing/review model honestly, including that most content has no named reviewer yet.
