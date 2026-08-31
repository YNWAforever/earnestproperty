# P7a — SEO hygiene (canonical helper, sitewide Organization JSON-LD, real sitemap dates, robots.txt)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 6 still-open items from the master plan's P7 SEO work item, verified against current code by a fresh audit (2026-08-31) rather than the stale 2026-08-28 register: no shared `seo()` helper, 4 routes still inlining a raw canonical link, Organization/RealEstateAgent JSON-LD is homepage-only, sitemap shares one timestamp across every URL even where a real per-entity date exists, `robots.txt` has zero `Disallow` rules, and `/district/tsuen-wan` is still undecided (indexable but orphaned).

**Base branch:** `main` (post-P6a/P6b/#86/#87). Independent of P5e1 (#91, open) and P5e2 (#92, open) and of the rest of P7's sub-phases (a11y, performance, analytics, AEO — separate plans).

---

## 0. Scope decisions

1. **The `seo()` helper is built and applied to the 4 named routes, not mass-migrated across all ~40 routes.** Every other route's `head()` already works and most already use `canonicalLink()` (confirmed by `canonical-links.test.mjs`'s own enumerated list) — forcing all of them onto a new helper now would be a large, low-value, regression-risking diff untethered from the actual defect. The 4 routes the master plan names are the ones still inlining a raw canonical object; those get both the helper and `canonicalLink()`.
2. **`/district/tsuen-wan` is noindexed, not reinstated.** Reinstating it into nav/sitemap is a content/IA decision (what does "properly bringing it in" mean — new nav item? merged into an existing district?) that's out of scope for an SEO-hygiene pass. Noindexing an orphaned-but-crawlable page is the correct, scoped, honest fix: it stops search engines from indexing a page nothing on the site links to, without deciding product questions this phase has no mandate to decide.
3. **Sitemap `lastmod` gets a real per-entity date only where one actually exists** (estates' and articles' `updated_at` columns, both confirmed real via `admin-cms.server.ts`'s `UPDATE ... SET ... updated_at = now()` archive/publish paths). Genuinely static pages (home, about, contact, mortgage, corridor hub, district pages) have no tracked per-page change signal and keep the existing shared generation timestamp — `sitemap[.]xml.ts`'s own comment already defends this as "an honest 'this sitemap was generated at' signal" rather than a fabricated per-page value, and that reasoning still holds for content with no real per-page date. This task extends real dates to entities that DO have one; it doesn't fabricate dates for entities that don't.
4. **Individual `/property/$listingNo` pages are not added to the sitemap in this task.** They aren't in it today (confirmed) and adding potentially hundreds of fast-churning listing pages is a separate, larger architectural question (sitemap size/pagination, delisted-listing handling) the master plan's P7 SEO bullet doesn't call out — not silently expanding scope here.

---

## Task 1: `seo()` helper + migrate the 4 routes still inlining a raw canonical

**Files:**
- Modify: `src/content/seo.ts`
- Modify: `src/content/seo.test.mjs` (create if it doesn't already test `canonicalLink`/`pageSeo` — check first; if `seo-source.test.mjs` already covers this file, add to that instead of creating a new one)
- Modify: `src/routes/castle-peak-road.index.tsx`
- Modify: `src/routes/castle-peak-road.$segment.tsx`
- Modify: `src/routes/district.sham-tseng.tsx`
- Modify: `src/routes/district.tsuen-wan.tsx`

- [ ] **Step 1: Add the helper to `seo.ts`**, next to the existing `canonicalLink`:

```typescript
export function seo(input: {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  noindex?: boolean;
}) {
  return {
    meta: [
      { title: input.title },
      { name: "description", content: input.description },
      { property: "og:title", content: input.title },
      { property: "og:description", content: input.description },
      ...(input.ogImage ? [{ property: "og:image", content: input.ogImage }] : []),
      ...(input.noindex ? [{ name: "robots", content: "noindex,follow" }] : []),
    ],
    links: [canonicalLink(input.path)],
  };
}
```

- [ ] **Step 2: `castle-peak-road.index.tsx`** — replace the current `head: () => ({ meta: [...], links: [{ rel: "canonical", href: \`${SITE_URL}${castlePeakRoadHub.path}\` }] })` with:

```typescript
head: () => seo({
  title: castlePeakRoadHub.title,
  description: castlePeakRoadHub.description,
  path: castlePeakRoadHub.path,
}),
```

Import `seo` from `@/content/seo` alongside whatever's already imported from there. If `SITE_URL` becomes unused in this file after the change, remove that import too (check with a grep for other `SITE_URL` usages in the file first).

- [ ] **Step 3: `castle-peak-road.$segment.tsx`** — same pattern, but the title/description/path already fall back to `castlePeakRoadHub` when `loaderData` is absent:

```typescript
head: ({ loaderData }) =>
  seo({
    title: loaderData?.segment.title ?? castlePeakRoadHub.title,
    description: loaderData?.segment.description ?? castlePeakRoadHub.description,
    path: loaderData?.segment.path ?? castlePeakRoadHub.path,
  }),
```

- [ ] **Step 4: `district.sham-tseng.tsx`** — this route's og:title/og:description currently differ slightly from its meta title/description (four distinct strings, not two). `seo()` only takes one title/description pair, so use the meta title/description for both (the og-specific variants were never meaningfully different marketing copy, just a shorter restatement — check the actual current 4 strings before deciding, but if they're substantively different, keep this route on its current hand-rolled `head()` rather than forcing a lossy fit, and only replace its `links` line with `canonicalLink(pageSeo.shamTseng.path)` instead of adopting `seo()` wholesale):

```typescript
links: [canonicalLink(pageSeo.shamTseng.path)],
```

(Read the actual current 4 strings before choosing between the full `seo()` swap and the narrower `canonicalLink`-only fix — don't guess.)

- [ ] **Step 5: `district.tsuen-wan.tsx`** — adopt `seo()` with `noindex: true` (scope decision §0.2):

```typescript
head: () =>
  seo({
    title: pageSeo.tsuenWan.title,
    description: pageSeo.tsuenWan.description,
    path: pageSeo.tsuenWan.path,
    noindex: true,
  }),
```

- [ ] **Step 6: Test.** Add or extend a test asserting: `seo()` returns a `noindex` robots meta only when `input.noindex` is true, and that all 4 routes now import `canonicalLink`/`seo` from `@/content/seo` (source-text scan, matching this codebase's existing style — see `canonical-links.test.mjs` for the pattern). Update `canonical-links.test.mjs`'s existing entries for these 4 files if it has any currently-passing assertions that would need adjusting for the new code shape.

Run: `node --test src/content/seo-source.test.mjs src/content/canonical-links.test.mjs`

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add src/content/seo.ts src/content/canonical-links.test.mjs src/routes/castle-peak-road.index.tsx src/routes/castle-peak-road.\$segment.tsx src/routes/district.sham-tseng.tsx src/routes/district.tsuen-wan.tsx
git commit -m "feat(seo): add a seo() head() helper and migrate the last 4 inline canonicals"
```

---

## Task 2: Sitewide Organization/RealEstateAgent JSON-LD

**Files:**
- Modify: `src/lib/schema.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/lib/schema.test.mjs` or `src/lib/schema.test.ts` (check which one already covers `schema.ts`'s builders — extend that one)

- [ ] **Step 1: Add `organizationSchema()` to `schema.ts`**, extracted from `index.tsx`'s current inline block (read `index.tsx`'s exact current object first — reproduce it exactly, don't paraphrase the address/areaServed/identifier):

```typescript
export function organizationSchema() {
  return {
    "@type": "RealEstateAgent",
    name: "晉誠地產 Earnest Property",
    description: "深井．青山公路．汀九物業專家",
    url: SITE_URL,
    logo: SITE_LOGO_URL,
    address: {
      "@type": "PostalAddress",
      streetAddress: "新界深井青山公路深井段 23 號麗都花園地下 5A 舖",
      addressRegion: "新界",
      addressCountry: "HK",
    },
    areaServed: ["深井 Sham Tseng", "青山公路 Castle Peak Road", "汀九 Ting Kau"],
    identifier: "C-018613",
  };
}
```

Import `SITE_LOGO_URL` into `schema.ts` alongside the existing `SITE_URL` import.

- [ ] **Step 2: Render it in `__root.tsx`**, gated by `showSiteChrome` (same public/admin split `SiteHeader`/`SiteFooter` already use — an internal admin page doesn't need a public-facing Organization schema):

```tsx
{showSiteChrome && (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: jsonLdScript({ "@context": "https://schema.org", ...organizationSchema() }),
    }}
  />
)}
```

Import `jsonLdScript` from `@/lib/schema` and `organizationSchema` from the same module. Place it inside `RootComponent()`'s returned tree (e.g. right after the closing `</NeonAuthUIProvider>` opening, or wherever a sitewide script tag reads cleanly next to the existing conditional renders).

- [ ] **Step 3: Remove the inline block from `index.tsx`** — delete the `{/* Organization JSON-LD */}` comment and its `<script>` tag entirely (it's now sitewide via `__root.tsx`). Check whether `index.tsx` has any OTHER JSON-LD (the file's own doc comments elsewhere in this codebase mention an `FAQPage` block on the homepage) — leave any other schema block untouched, only remove the Organization/RealEstateAgent one.

- [ ] **Step 4: Update/extend the schema test file** with an assertion that `organizationSchema()` returns the exact fields above, and a source-scan assertion that `__root.tsx` renders it (not `index.tsx` alone anymore).

Run: whichever of `bun test src/lib/schema.test.ts` / `node --test src/lib/schema.test.mjs` currently covers `schema.ts` (check `test:seo`'s script definition for which one).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts src/routes/__root.tsx src/routes/index.tsx src/lib/schema.test.mjs src/lib/schema.test.ts
git commit -m "feat(seo): move Organization/RealEstateAgent JSON-LD sitewide into __root.tsx"
```

(Only `git add` whichever of the two schema test files actually exists/changed.)

---

## Task 3: Sitemap — real per-entity `lastmod` for estates and articles

**Files:**
- Modify: `src/lib/neon/public-data.server.ts` (or `src/lib/queries.ts` — check which already owns estate/article read functions and add the new one there for consistency)
- Modify: `src/lib/neon/public-data.ts` (the `createServerFn` wrapper, if the new function needs one — check whether `sitemap[.]xml.ts` can call a `.server.ts` function directly today, since it's itself a `.ts` server route, or whether it goes through the same client/server split as public routes)
- Modify: `src/routes/sitemap[.]xml.ts`
- Modify: `src/routes/sitemap.contract.test.mjs`

- [ ] **Step 1: Read `sitemap[.]xml.ts`'s current imports first** to determine whether it calls `.server.ts` functions directly (it's a server-only route handler) or goes through the client-wrapper (`public-data.ts`) layer like public pages must. Match whatever pattern it already uses for `listPublicAgentProfiles`/`fetchRecentTransactions`/`fetchPublishedArticlesByCategory` — don't introduce a second pattern.

- [ ] **Step 2: Add a lightweight sitemap-dates query**, in whichever file the existing estate/article read functions live:

```typescript
export async function fetchSitemapTimestamps(): Promise<{
  estates: Record<string, string | null>;
  articles: Record<string, string | null>;
}> {
  const [estateRows, articleRows] = await Promise.all([
    sql().query("SELECT slug, updated_at FROM estates WHERE published = true"),
    sql().query("SELECT slug, updated_at FROM articles WHERE published = true"),
  ]);
  return {
    estates: Object.fromEntries(
      estateRows.map((row) => [stringOrEmpty(row.slug), dateOrNull(row.updated_at)]),
    ),
    articles: Object.fromEntries(
      articleRows.map((row) => [stringOrEmpty(row.slug), dateOrNull(row.updated_at)]),
    ),
  };
}
```

(Match the exact helper names — `stringOrEmpty`/`dateOrNull` — already used elsewhere in the same file; don't reinvent them if they're already imported there.)

- [ ] **Step 3: Wire it into `sitemap[.]xml.ts`**. Fetch `fetchSitemapTimestamps()` alongside the existing `Promise.all([...])` calls. Change `urlXml(path, lastmod)` to accept a per-path lastmod, falling back to the shared generation timestamp:

```typescript
function urlXml(path: string, lastmod: string) {
  // unchanged signature -- caller now passes the right lastmod per path
  ...
}
```

Build a `Map<string, string>` (or plain object) from path → date for the estate and blog-article paths specifically (`/estate/${slug}` → `timestamps.estates[slug]`, `/blog/${slug}` → `timestamps.articles[slug]`), falling back to the existing shared `lastmod` (rename it to `generatedAt` for clarity) wherever a specific date is missing or null. Every other path (static pages, agent paths, conditional paths) keeps using `generatedAt` exactly as today — extend, don't replace, the existing comment explaining why (§0.3 above).

- [ ] **Step 4: Extend `sitemap.contract.test.mjs`** with an assertion that an estate/article path's `<lastmod>` can differ from the generation timestamp when a real `updated_at` exists (mock or source-scan, matching this test file's existing style — check whether it currently does a live-fetch-based test or a pure source-text scan first).

Run: `node --test src/routes/sitemap.contract.test.mjs`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/routes/sitemap[.]xml.ts src/routes/sitemap.contract.test.mjs
# plus whichever of public-data.server.ts / public-data.ts / queries.ts changed
git commit -m "feat(seo): give estate and article sitemap entries a real per-page lastmod"
```

---

## Task 4: `robots.txt` — disallow staff surfaces

**Files:**
- Modify: `public/robots.txt`
- Create or extend a contract test asserting the disallow rules exist (check whether one already exists for `robots.txt` — likely not, per the audit; add one, matching `sitemap.contract.test.mjs`'s style)

- [ ] **Step 1: Update `public/robots.txt`** from:

```
User-agent: *
Allow: /

Sitemap: https://earnestproperty.vercel.app/sitemap.xml
```

to:

```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /account

Sitemap: https://earnestproperty.vercel.app/sitemap.xml
```

- [ ] **Step 2: Write a contract test** (new file `public/robots.test.mjs` or wherever this repo's convention puts non-`src/` tests — check if any existing test reads from `public/`, otherwise place it in `src/routes/` alongside `sitemap.contract.test.mjs` since both are SEO-surface files):

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("robots.txt disallows staff-only surfaces", () => {
  const source = readFileSync("public/robots.txt", "utf8");
  assert.match(source, /Disallow: \/admin/);
  assert.match(source, /Disallow: \/auth/);
  assert.match(source, /Disallow: \/account/);
  assert.match(source, /Sitemap: https:\/\/earnestproperty\.vercel\.app\/sitemap\.xml/);
});
```

- [ ] **Step 3: Register the test** in `package.json`'s `test:seo` script.

Run: `npm run test:seo`

- [ ] **Step 4: Commit**

```bash
git add public/robots.txt src/routes/robots.test.mjs package.json
git commit -m "feat(seo): disallow /admin, /auth, /account in robots.txt"
```

---

## Final verification

Run: `npm run test:seo && npx tsc --noEmit && npm run build && npm run lint`

## Acceptance

- `seo()` helper exists and is used by the 4 routes the master plan named; no other working route was touched.
- `/district/tsuen-wan` is noindexed — a documented, scoped decision, not silently reinstated or left ambiguous.
- Organization/RealEstateAgent JSON-LD renders on every public page via `__root.tsx`, not just the homepage.
- Sitemap `lastmod` is a real per-entity date for estates and articles (which have one), and stays an honest shared generation timestamp for genuinely static pages (which don't) — no fabricated date anywhere.
- `robots.txt` disallows `/admin`, `/auth`, `/account`.
