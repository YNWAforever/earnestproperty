# 17-Estate Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `estate-registry.ts`, `estate-pages.ts`, `seo.ts`, `school-nets.ts`,
`estate.$slug.tsx`, and `normalize-old-site.mjs` fully carry all 17 estates from
`docs/superpowers/specs/assets/estate-expansion-17.data.json`, so each estate's
`/estate/$slug` page is real, tested, and 200-OK-ready the moment a human flips its
DB row's `published` to `true` — while every one of the 17 stays `published = false`
and invisible to sitemap/homepage/public search until that individual, per-estate
publish gate clears.

**Architecture:** `src/routes/estate.$slug.tsx` is already a single dynamic route
reused by all estates; this plan removes its remaining hardcoded 深井-only
assumptions (hero eyebrow, breadcrumb, school-net gate, CTA district label) and
replaces them with lookups against the registry entry, so the same route genuinely
serves all 22 estates (5 original + 17 new) correctly. `estate-registry.ts` stays
the single source of identity truth (DR-10); `estate-pages.ts`/`seo.ts` continue
deriving identity from it rather than retyping. The data pack JSON is the sole
source for new facts/content/SEO copy — every value copied from it traces to a
cited source, and nothing is invented.

**Tech Stack:** TanStack Start route, TypeScript content modules (no ORM), Neon
Postgres migration, `node --test` contract tests matching this repo's existing
`test:estate-conversion`/`test:seo`/`test:corridor`/`test:mls` scripts.

---

## Before you start

Read `docs/superpowers/specs/2026-09-01-estate-expansion-17-design.md` (the design
doc) and skim `docs/superpowers/specs/assets/estate-expansion-17.data.json` (the
data pack — 17 objects under `estates[]`, keyed by `order` 1–17, plus top-level
`schoolNets`, `areaMeta`, `normalizationPrecedence`). Every task below tells you
exactly which JSON path to pull each value from — you should not need to make any
editorial judgment about facts, copy, or sourcing; that's already been done.

**Non-negotiable throughout every task** (from the design doc, reproduced here so
it's visible task-by-task, not just once at the top):
- Never write a real average PSF, price, rent, listing count, or transaction count
  anywhere in these files — those stay dynamically computed from Neon/MLS, never
  hardcoded.
- Never invent a fact not present in the data pack. A field the data pack itself
  leaves as `null` (e.g. `hoi-wan-hin.totalUnits`) must stay `null` in the DB —
  do not fill it with a guess, and do not average conflicting public sources.
- Every one of the 17 estates' DB row keeps `published = false` and
  `verified_at = NULL` at the end of every task in this plan. No task flips either.

---

### Task 1: Estate registry — type additions and all 17 entries

**Files:**
- Modify: `src/content/estate-registry.ts:48-99` (type), and the 17 existing
  placeholder entries for slugs `hoi-wan-hin`, `tai-wah-hin`, `hoi-wan-toi`,
  `chun-wong-kui`, `lung-tang-kok`, `mun-ming-shan`, `wong-gam-hoi-ngon`,
  `oi-kam-hoi-ngon`, `tai-yu`, `wong-gam-hoi-waan`, `sing-tai`, `seong-yuen`,
  `the-carmel`, `oma-oma`, `lin-shan`, `long-tou-waan`, `tai-tou-waan`
- Modify: `src/content/estate-registry.ts` — also backfill the same 3 new fields
  onto the 5 *original* entries (`bellagio`, `hong-kong-garden`, `sea-crest-villa`,
  `lido-garden`, `rhine-garden`) so Task 5's route refactor has a value to read for
  every estate, not just the new 17.
- Test: `src/content/estate-registry.test.mjs` (existing file — extend it)

- [ ] **Step 1: Add 4 new fields to `EstateRegistryEntry`**

In `src/content/estate-registry.ts`, add these 4 fields to the type (right after
the existing `homepageDistrict: EstateHomepageDistrict | null;` line, before the
closing `};`):

```typescript
  /**
   * Another estate's slug this one is a phase of (e.g. 帝華軒 is 浪翠園 Phase 5).
   * `null` for every estate that isn't a named phase of a different estate's
   * own registry entry. Informational only today -- no consumer joins on it
   * yet; added for 帝華軒/tai-wah-hin per the 2026-09-01 data pack.
   */
  parentEstateSlug: string | null;
  /**
   * Small text shown above the H1 on this estate's detail page
   * (`estate.$slug.tsx`). Was hardcoded to "深井屋苑獨立 SEO 頁" for every
   * estate; now per-estate so a 青山公路 estate doesn't claim to be a 深井 page.
   */
  heroEyebrow: string | null;
  /** The estate's own district/corridor guide link, used in the detail page's
   * breadcrumb JSON-LD. Was hardcoded to "/district/sham-tseng" for every
   * estate. */
  districtHref: string | null;
  /** Display label used in the detail page's WhatsApp CTA context
   * (`ctaContext.districtName`) -- e.g. "深井 / 青山公路" or "掃管笏". Was
   * hardcoded to "深井 / 青山公路" for every estate. */
  locationLabelZh: string | null;
```

- [ ] **Step 2: Backfill the 3 display fields onto the 5 original estates**

For `bellagio`, `hong-kong-garden`, `sea-crest-villa`, `lido-garden`,
`rhine-garden` in `estate-registry.ts`, add these 4 lines to each entry (right
after `homepageDistrict: ...,`), with **identical values for all 5** — this
exactly reproduces today's hardcoded route behavior, so there is zero visible
change for these 5 estates:

```typescript
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
```

- [ ] **Step 3: Update the 5 深井/汀九 entries (`hoi-wan-hin`, `tai-wah-hin`, `hoi-wan-toi`, `chun-wong-kui`, `lung-tang-kok`)**

These 5 already exist as placeholders (`hasPage: false`, mostly-null fields).
Replace each entry in full with the values below — every value is copied
verbatim from `docs/superpowers/specs/assets/estate-expansion-17.data.json`'s
`estates[]` array (matched by `slug`), except `corridorSegment` (stays `null` for
all 17 per design-doc decision — D2's homepage override does not touch corridor
scope) and `hasPage` (flips to `true` — the route/content now exist; this is
independent of the DB `published` flag, which stays `false`).

```typescript
  {
    slug: "hoi-wan-hin",
    nameZh: "海雲軒",
    nameEn: "Anglers' Bay",
    aliases: ["海雲軒", "Anglers' Bay", "Anglers Bay", "ANGLERS BAY"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井／青龍頭屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井／青龍頭",
  },
  {
    slug: "tai-wah-hin",
    nameZh: "帝華軒",
    nameEn: "Royal Sea Crest",
    aliases: [
      "帝華軒",
      "浪翠園5期",
      "浪翠園五期",
      "浪翠園帝華軒",
      "Royal Sea Crest",
      "Sea Crest Villa Phase 5",
    ],
    districtSlug: "tsing-lung-tau",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: "sea-crest-villa",
    heroEyebrow: "浪翠園五期屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road/sham-tseng",
    locationLabelZh: "青龍頭／深井",
  },
  {
    slug: "hoi-wan-toi",
    nameZh: "海韻臺",
    nameEn: "Rhine Terrace",
    aliases: ["海韻臺", "海韻台", "Rhine Terrace", "RHINE TERRACE"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井單幢屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井",
  },
  {
    slug: "chun-wong-kui",
    nameZh: "縉皇居",
    nameEn: "Ocean Pointe",
    aliases: ["縉皇居", "Ocean Pointe", "OCEAN POINTE"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井高層海景屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井",
  },
  {
    slug: "lung-tang-kok",
    nameZh: "龍騰閣",
    nameEn: "Lung Tang Court",
    aliases: ["龍騰閣", "Lung Tang Court", "LUNG TANG COURT"],
    districtSlug: "tsing-lung-tau",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "青龍頭低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road/sham-tseng",
    locationLabelZh: "青龍頭",
  },
```

Note the `districtSlug` correction: `hoi-wan-hin` and `chun-wong-kui` currently
read `"ting-kau"` in the placeholder on `main` — both become `"sham-tseng"`.
`tai-wah-hin` and `lung-tang-kok` currently read `null` — both become
`"tsing-lung-tau"`. `hoi-wan-toi` currently reads `null` — becomes `"sham-tseng"`.
`homepageDistrict: "深井"` for `tai-wah-hin`/`lung-tang-kok` (青龍頭) is a
deliberate choice, not an oversight: `EstateHomepageDistrict` only has 3 literal
values (`"深井" | "青山公路" | "汀九"`), and `castle-peak-road.ts`'s own
`sham-tseng` corridor segment already absorbs 青龍頭 into its "深井 / 青山公路"
grouping (see that file's comment on why) — this backfill matches that existing
precedent rather than widening the type for 2 records.

- [ ] **Step 4: Update the 12 青山公路 entries**

Same pattern as Step 3. For each of `mun-ming-shan`, `wong-gam-hoi-ngon`,
`oi-kam-hoi-ngon`, `tai-yu`, `wong-gam-hoi-waan`, `sing-tai`, `seong-yuen`,
`the-carmel`, `oma-oma`, `lin-shan`, `long-tou-waan`, `tai-tou-waan`: keep the
existing `districtSlug: "castle-peak-road"` and `corridorSegment: null`
unchanged (both already correct), set `hasPage: true`, and fill in the 6 fields
below from the data pack's matching `estates[]` object (matched by `slug`):

| Registry field | Data pack path |
|---|---|
| `nameEn` | `estates[].nameEn` |
| `aliases` | `estates[].aliases` (copy the array verbatim) |
| `homepageDistrict` | `"青山公路"` for all 12 (matches `EstateHomepageDistrict`'s literal set; the data pack's own finer `locationLabelZh` distinctions like "青山灣／掃管笏" live in the new `locationLabelZh` field below, not here) |
| `parentEstateSlug` | `null` for all 12 |
| `heroEyebrow` | `estates[].heroEyebrow` |
| `districtHref` | `estates[].districtHref` (all 12 are `"/castle-peak-road"`) |
| `locationLabelZh` | `estates[].locationLabelZh` |

`photo` stays `null` for all 12 (unchanged — no licensed image exists yet).

- [ ] **Step 5: Extend the registry contract test**

In `src/content/estate-registry.test.mjs`, add assertions (adapt to the file's
existing test style — read it first to match its assertion helpers):
- All 17 slugs from the data pack have `hasPage === true`.
- The 5 corrected `districtSlug` values match exactly: `hoi-wan-hin` →
  `"sham-tseng"`, `tai-wah-hin` → `"tsing-lung-tau"`, `hoi-wan-toi` →
  `"sham-tseng"`, `chun-wong-kui` → `"sham-tseng"`, `lung-tang-kok` →
  `"tsing-lung-tau"`.
- `corridorSegment` is `null` for all 17 (regression guard: this task must never
  silently pull any of the 17 into corridor listing-search scope).
- `tai-wah-hin.parentEstateSlug === "sea-crest-villa"`; every other entry
  (including all 5 originals) has `parentEstateSlug === null`.
- Every one of the 22 estates (5 original + 17 new) has non-null
  `heroEyebrow`/`districtHref`/`locationLabelZh` (a regression guard for
  Step 2's backfill — nothing should read `null` after this task).

- [ ] **Step 6: Run the test and verify it passes**

Run: `node --test src/content/estate-registry.test.mjs`
Expected: PASS, including the new assertions.

- [ ] **Step 7: Commit**

```bash
git add src/content/estate-registry.ts src/content/estate-registry.test.mjs
git commit -m "feat(estates): add identity/district/display fields for 17-estate expansion"
```

---

### Task 2: `school-nets.ts` — restructure to a map, add net 71

**Files:**
- Modify: `src/content/school-nets.ts` (full rewrite of its exports)
- Modify: `src/routes/estate.$slug.tsx` — only the import line, in this task (the
  render-site fixes happen in Task 5)
- Test: create `src/content/school-nets.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/content/school-nets.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { schoolNets, getSchoolNet } from "./school-nets.ts";

test("schoolNets has both net 62 and net 71, each with empty primarySchools", () => {
  assert.equal(schoolNets["62"].netCode, "62");
  assert.equal(schoolNets["62"].districtLabel, "荃灣");
  assert.deepEqual(schoolNets["62"].primarySchools, []);
  assert.equal(schoolNets["71"].netCode, "71");
  assert.equal(schoolNets["71"].districtLabel, "屯門");
  assert.deepEqual(schoolNets["71"].primarySchools, []);
});

test("getSchoolNet returns the matching net or null for an unknown code", () => {
  assert.equal(getSchoolNet("62")?.netCode, "62");
  assert.equal(getSchoolNet("71")?.netCode, "71");
  assert.equal(getSchoolNet("999"), null);
  assert.equal(getSchoolNet(null), null);
  assert.equal(getSchoolNet(undefined), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/content/school-nets.test.mjs`
Expected: FAIL — `school-nets.ts` has no `schoolNets` or `getSchoolNet` export yet.

- [ ] **Step 3: Rewrite `school-nets.ts`**

Replace the entire file with:

```typescript
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
 * Deliberately empty primarySchools on both nets: no Education Bureau
 * 《小一入學統一派位選校名冊》/ 學校網名冊 source has been supplied (open
 * input #6 in docs/superpowers/plans/2026-08-28-frontend-revamp.md). Populate
 * primarySchools, source, sourceUrl, verifiedOn and admissionYear together,
 * from the EDB register only, once it is supplied -- do not add named
 * schools from any other source (property portals, blogs, agent knowledge).
 * Net 71 added 2026-09-01 for the 12 青山公路 estates from the 17-estate
 * expansion data pack.
 */
export const schoolNets: Record<string, SchoolNet> = {
  "62": {
    netCode: "62",
    districtLabel: "荃灣",
    primarySchools: [],
    source: "教育局",
    sourceUrl: null,
    verifiedOn: null,
    admissionYear: null,
  },
  "71": {
    netCode: "71",
    districtLabel: "屯門",
    primarySchools: [],
    source: "教育局",
    sourceUrl: null,
    verifiedOn: null,
    admissionYear: null,
  },
};

/** Returns `null` for an unknown or missing code -- callers must omit the
 * school-net section entirely on `null`, matching this repo's established
 * "hide, don't show an empty label" convention (see
 * `findCastlePeakRoadSegmentByDistrictSlug`'s own doc comment for the same
 * pattern). */
export function getSchoolNet(code: string | null | undefined): SchoolNet | null {
  if (!code) return null;
  return schoolNets[code] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/content/school-nets.test.mjs`
Expected: PASS.

- [ ] **Step 5: Fix the now-broken import in `estate.$slug.tsx`**

`estate.$slug.tsx:25` currently imports `shamTsengSchoolNet`, which no longer
exists. Change:

```typescript
import { shamTsengSchoolNet } from "@/content/school-nets";
```

to:

```typescript
import { getSchoolNet } from "@/content/school-nets";
```

This will leave `estate.$slug.tsx`'s body still referencing the old
`shamTsengSchoolNet` name in several places — that's expected here and gets
fixed in Task 5, not this task. Confirm this task's own scope stays green by
running only the school-nets test (not the whole route) at Step 4 above; do not
attempt to build or typecheck the full app until Task 5 lands.

- [ ] **Step 6: Commit**

```bash
git add src/content/school-nets.ts src/content/school-nets.test.mjs src/routes/estate.\$slug.tsx
git commit -m "feat(content): restructure school-nets.ts to a map, add net 71"
```

---

### Task 3: `seo.ts` — 17 SEO records

**Files:**
- Modify: `src/content/seo.ts` (add 17 `estateSeo` entries; `estateAliases`
  derives from these automatically per the existing `Object.fromEntries` at
  `seo.ts:231-232` — do not hand-edit `estateAliases`)
- Test: `src/content/seo.test.mjs` (existing — extend)

- [ ] **Step 1: Add 17 entries to `estateSeo`**

In `src/content/seo.ts`, inside the `estateSeo` object (after the existing
`lido-garden` entry, before the closing `}`), add one entry per estate using
`estateSeoIdentity()` exactly like the existing 5. For each of the 17 slugs, pull
`title`/`description` from the data pack's `estates[].seo.title` /
`estates[].seo.description`. Two fully worked examples:

```typescript
  "hoi-wan-hin": {
    ...estateSeoIdentity("hoi-wan-hin"),
    title: "海雲軒 Anglers' Bay 深井／青龍頭｜放盤、成交、海景、戶型",
    description:
      "海雲軒（Anglers' Bay）深井／青龍頭屋苑專頁：放盤、成交、海景、戶型、交通、62 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "tai-wah-hin": {
    ...estateSeoIdentity("tai-wah-hin"),
    title: "帝華軒 Royal Sea Crest 青龍頭／深井｜浪翠園五期、大三房、放盤成交",
    description:
      "帝華軒（Royal Sea Crest）青龍頭／深井屋苑專頁：浪翠園五期、大三房、放盤成交、交通、62 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
```

Continue for the remaining 15 slugs (`hoi-wan-toi`, `chun-wong-kui`,
`lung-tang-kok`, `mun-ming-shan`, `wong-gam-hoi-ngon`, `oi-kam-hoi-ngon`,
`tai-yu`, `wong-gam-hoi-waan`, `sing-tai`, `seong-yuen`, `the-carmel`,
`oma-oma`, `lin-shan`, `long-tou-waan`, `tai-tou-waan`), copying each one's
`title`/`description` verbatim from
`docs/superpowers/specs/assets/estate-expansion-17.data.json`'s matching
`estates[].seo` object — do not paraphrase or shorten them.

- [ ] **Step 2: Read how `seo.ts` currently gates `robots`/canonical on publish state**

Before writing anything else, grep `seo.ts` and `estate.$slug.tsx` for how the
existing 5 estates' `robots`/`canonical` meta tags are built, and for where
`estate.published` (the DB row's boolean) is read in the route. The data pack's
own `robotsUntilPublished: "noindex,follow"` requirement must be satisfied by
whatever mechanism already exists for gating meta output on DB `published` state
(likely already present, since `fetchEstateBySlug` already 404s unpublished rows
entirely at the SQL layer — confirm whether that alone is sufficient, i.e.
whether an unpublished estate's page is unreachable at all rather than reachable
with `noindex`, and note which is actually true in this task's commit message).
Do not add new gating logic speculatively — only add it if you find the existing
404-on-unpublished behavior is NOT sufficient to satisfy the data pack's
`robotsUntilPublished` requirement.

- [ ] **Step 3: Extend `seo.test.mjs`**

Add assertions (matching the file's existing style): all 17 new slugs exist in
`estateSeo`; each has non-empty `nameEn` (regression guard — `estateSeoIdentity`
throws otherwise, so this proves Task 1 landed correctly first); `estateAliases`
now includes entries for all 22 estates (5 original + 17), derived automatically.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/content/seo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/seo.ts src/content/seo.test.mjs
git commit -m "feat(seo): add SEO records for 17-estate expansion"
```

---

### Task 4: `estate-pages.ts` — 17 content entries

**Files:**
- Modify: `src/content/estate-pages.ts` (add 17 entries to `estatePageContent`)
- Test: `src/content/estate-pages.test.mjs` (existing — extend)

- [ ] **Step 1: Add 17 entries to `estatePageContent`**

Each entry follows the exact shape of the existing 5 (`bellagio` etc. —
`estatePageIdentity(slug)` spread, then `heroPositioning` / `overview` /
`buyerFit` / `pros` / `watchouts` / `transportLifestyle` / `marketNote` /
`saleCta` / `rentCta` / `valuationCta` / `faqs` / `relatedLinks`). For each of
the 17 slugs, copy every one of those 11 fields **verbatim** from the data
pack's matching `estates[].content` object — do not edit, shorten, or
paraphrase any of the supplied copy; it is already final, sourced content, not
a draft. One fully worked example (the remaining 16 follow the identical
field-by-field copy from their own `estates[].content` object):

```typescript
  "hoi-wan-hin": {
    ...estatePageIdentity("hoi-wan-hin"),
    heroPositioning: "深井東面臨海雙座屋苑，適合想兼顧海景、會所與精簡社區規模的家庭。",
    overview: [
      "海雲軒位於青山公路近釣魚灣一帶，由兩座住宅組成；買家通常先比較座向、海景開揚度、樓層、裝修和車位。",
      "相對深井大型屋苑，海雲軒盤源較少，睇樓時宜把同類單位和鄰近屋苑放在同一天比較。",
    ],
    buyerFit: [
      "重視海景和較精簡屋苑規模的自住家庭。",
      "希望在深井／青龍頭生活圈尋找兩至三房的換樓客。",
      "願意以較少盤源換取較寧靜居住感的買家。",
    ],
    pros: ["臨海景觀選擇", "兩座規模較易掌握", "設住客會所及家庭配套"],
    watchouts: [
      "公開平台對總伙數有 213、247 等不同紀錄",
      "不同平台對路段名稱標示不一",
      "日常交通較依賴巴士、小巴或自駕",
    ],
    transportLifestyle:
      "主要透過青山公路巴士、小巴及自駕往返荃灣、九龍及港島方向；實際路線與班次以營辦商最新公布為準。",
    marketNote: "成交應按座向、景觀、樓層、裝修與車位分開比較；平均呎價只由 Neon 成交資料動態計算。",
    saleCta: "想買海雲軒？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租海雲軒？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "海雲軒業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "海雲軒適合家庭自住嗎？",
        answer: "適合重視海景、會所和較精簡社區規模的家庭，但應先確認日常交通與車位安排。",
      },
      {
        question: "買海雲軒最需要比較甚麼？",
        answer: "建議比較座向、海景遮擋、樓層、裝修、車位及近期相近面積成交。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/chun-wong-kui", label: "比較縉皇居" },
      { href: "/listings?deal=all&estate=hoi-wan-hin&page=1", label: "海雲軒放盤" },
    ],
  },
```

Repeat for `tai-wah-hin`, `hoi-wan-toi`, `chun-wong-kui`, `lung-tang-kok`,
`mun-ming-shan`, `wong-gam-hoi-ngon`, `oi-kam-hoi-ngon`, `tai-yu`,
`wong-gam-hoi-waan`, `sing-tai`, `seong-yuen`, `the-carmel`, `oma-oma`,
`lin-shan`, `long-tou-waan`, `tai-tou-waan` — each estate's full `content`
object is at `estates[N].content` in the committed data pack, N being that
estate's own `order` (2 through 17).

- [ ] **Step 2: Extend `estate-pages.test.mjs`**

Add assertions (matching the file's existing style): all 17 new slugs exist in
`estatePageContent`; each has exactly 2 `overview` paragraphs, exactly 3 items
each in `buyerFit`/`pros`/`watchouts`, exactly 2 `faqs`, exactly 3
`relatedLinks` (the master spec's own stated minimums — a regression guard that
a future edit doesn't silently drop an item); every `relatedLinks[].href` that
points to `/estate/{slug}` targets a slug that itself exists in
`estateRegistry` (catches a typo'd cross-reference, e.g. Task 4's `hoi-wan-hin`
entry linking to `chun-wong-kui`).

- [ ] **Step 3: Run the test and verify it passes**

Run: `node --test src/content/estate-pages.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/content/estate-pages.ts src/content/estate-pages.test.mjs
git commit -m "feat(content): add page content for 17-estate expansion"
```

---

### Task 5: `estate.$slug.tsx` — remove hardcoded 深井 assumptions

**Files:**
- Modify: `src/routes/estate.$slug.tsx:25,216-220,236-247,278-281,391-448`
- Test: create `src/routes/estate.district-driven.contract.test.mjs`

This is the highest-risk task in this plan — it changes an existing, working,
tested route. Read the whole file once before editing (`wc -l` reports 667
lines) so you understand every place `estate`/`content`/`seo` are already in
scope in the component body.

- [ ] **Step 1: Write the failing test**

Create `src/routes/estate.district-driven.contract.test.mjs`. This is a
source-scan test (matching this repo's `*.routes.test.mjs` pattern elsewhere —
grep `src/routes/admin.transactions.routes.test.mjs` for the exact style if
unfamiliar with it), not a rendered-DOM test:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./estate.$slug.tsx", import.meta.url),
  "utf8",
);

test("estate.$slug.tsx no longer hardcodes a 深井-only hero eyebrow", () => {
  assert.ok(
    !source.includes('"深井屋苑獨立 SEO 頁"'),
    "hero eyebrow must come from the registry entry, not a literal string",
  );
});

test("estate.$slug.tsx no longer hardcodes /district/sham-tseng as every estate's breadcrumb target", () => {
  const literalBreadcrumb = /item:\s*`\$\{SITE_URL\}\/district\/sham-tseng`/;
  assert.ok(
    !literalBreadcrumb.test(source),
    "breadcrumb href must come from the registry entry's districtHref",
  );
});

test("estate.$slug.tsx no longer hardcodes districtName as every estate's CTA context", () => {
  assert.ok(
    !source.includes('districtName: "深井 / 青山公路"'),
    "ctaContext.districtName must come from the registry entry's locationLabelZh",
  );
});

test("estate.$slug.tsx no longer gates school-net display on district_slug === sham-tseng", () => {
  assert.ok(
    !source.includes('estate.district_slug === "sham-tseng"'),
    "school-net visibility must come from whether the estate's registry entry resolves a real school net code, not a single hardcoded district",
  );
});

test("estate.$slug.tsx no longer imports the retired shamTsengSchoolNet constant", () => {
  assert.ok(
    !source.includes("shamTsengSchoolNet"),
    "must use getSchoolNet(code) from school-nets.ts instead",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/estate.district-driven.contract.test.mjs`
Expected: FAIL on at least the first 4 assertions (the current file still has
every one of these literals).

- [ ] **Step 3: Add a registry lookup for the current estate**

Near the top of the route component (find where `estate` — the loader's fetched
DB row — first comes into scope, and where `content`/`seo` are already derived
from it), add:

```typescript
  const registryEntry = getEstateEntry(estate.slug);
```

Add the import at the top of the file (alongside the existing
`findComparableEstates`/`getEstatePageContent` imports from
`@/content/estate-registry` — if `getEstateEntry` isn't already imported from
there, add it):

```typescript
import { findComparableEstates, getEstateEntry } from "@/content/estate-registry";
```

(If the file already imports differently from `estate-registry`, merge into the
existing import statement rather than adding a second one.)

- [ ] **Step 4: Fix the CTA context district name (`estate.$slug.tsx:216-220`)**

Change:

```typescript
  const ctaContext = {
    estateName: seo?.nameZh ?? estate.name_zh,
    districtName: "深井 / 青山公路",
    source: `estate-${estate.slug}`,
  };
```

to:

```typescript
  const ctaContext = {
    estateName: seo?.nameZh ?? estate.name_zh,
    districtName: registryEntry.locationLabelZh ?? "深井 / 青山公路",
    source: `estate-${estate.slug}`,
  };
```

(The `?? "深井 / 青山公路"` fallback is defensive only — every registry entry
has a real value after Task 1 — but keeps this line from ever rendering `null`
if a future estate is added to the DB before its registry entry.)

- [ ] **Step 5: Fix the school-net gate and breadcrumb (`estate.$slug.tsx:236-247`)**

Change:

```typescript
  const transportSegment = findCastlePeakRoadSegmentByDistrictSlug(estate.district_slug);
  const showSchoolNet = estate.district_slug === "sham-tseng";
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "屋苑",
        item: `${SITE_URL}/district/sham-tseng`,
      },
```

to:

```typescript
  const transportSegment = findCastlePeakRoadSegmentByDistrictSlug(estate.district_slug);
  const schoolNet = getSchoolNet(registryEntry.districtSlug ? SCHOOL_NET_BY_DISTRICT[registryEntry.districtSlug] : null);
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "屋苑",
        item: `${SITE_URL}${registryEntry.districtHref ?? "/district/sham-tseng"}`,
      },
```

Add this small lookup table near the top of the file (module scope, alongside
other constants — not inside the component function):

```typescript
/** Maps a registry entry's districtSlug to its school net code, mirroring
 * the data pack's `areaMeta[districtSlug].schoolNetCode`. sham-tseng and
 * tsing-lung-tau both carry net 62; castle-peak-road (the 掃管笏/青山灣/小欖
 * group) carries net 71. Any districtSlug not listed here has no known
 * school net -- getSchoolNet(undefined) returns null, which the render site
 * below already treats as "omit the section", not an error. */
const SCHOOL_NET_BY_DISTRICT: Record<string, string> = {
  "sham-tseng": "62",
  "tsing-lung-tau": "62",
  "castle-peak-road": "71",
};
```

Add the `getSchoolNet` import (already added to the file in Task 2 — confirm
it's there, don't duplicate).

- [ ] **Step 6: Fix the hero eyebrow (`estate.$slug.tsx:278-281`)**

Change:

```typescript
          <p className="text-sm opacity-80">深井屋苑獨立 SEO 頁</p>
```

to:

```typescript
          <p className="text-sm opacity-80">
            {registryEntry.heroEyebrow ?? "深井屋苑獨立 SEO 頁"}
          </p>
```

- [ ] **Step 7: Fix the school-net render block (`estate.$slug.tsx:391-448`)**

Change the gate on line 391 from:

```typescript
      {(transportSegment || showSchoolNet) && (
```

to:

```typescript
      {(transportSegment || schoolNet) && (
```

Change line 395's ternary from `transportSegment && showSchoolNet` to
`transportSegment && schoolNet`. Change line 413's gate from `showSchoolNet &&`
to `schoolNet &&`. Inside that block (lines 414-443), replace every
`shamTsengSchoolNet.X` reference with `schoolNet.X` (same field names — this is
a pure rename, `schoolNet` is typed the same as the old constant since both are
`SchoolNet`). For example line 416 becomes:

```typescript
                  校網 {schoolNet.netCode}（小學）
```

...and so on for every other `shamTsengSchoolNet.` occurrence in that block
(lines 419, 420, 422, 424, 437, 438, 439, 442) — mechanically rename all of
them, the surrounding JSX structure does not change.

- [ ] **Step 8: Run the contract test to verify it passes**

Run: `node --test src/routes/estate.district-driven.contract.test.mjs`
Expected: PASS on all 5 assertions.

- [ ] **Step 9: Run the estate-conversion suite to check for regressions**

Run: `node --test src/content/estate-conversion.test.mjs src/content/core-estates.test.mjs src/content/estate-registry.test.mjs src/content/estate-pages.test.mjs src/components/site/estate-comparison.test.mjs`
Expected: PASS. If anything fails, it's almost certainly because a rename in
Step 7 was incomplete (a leftover `shamTsengSchoolNet` reference) — grep the
file for that string and confirm zero hits outside the school-nets.ts import
you already fixed in Task 2.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. A leftover `showSchoolNet` reference (renamed to `schoolNet` in
Step 7 but missed somewhere) or a leftover `shamTsengSchoolNet` import will
surface here as a type error.

- [ ] **Step 11: Commit**

```bash
git add src/routes/estate.\$slug.tsx src/routes/estate.district-driven.contract.test.mjs
git commit -m "refactor(estates): make estate.\$slug.tsx district-driven instead of hardcoded to 深井"
```

---

### Task 6: `normalize-old-site.mjs` — aliases, precedence, district-inference fix

**Files:**
- Modify: `src/lib/mls/normalize-old-site.mjs:3-30`
- Test: create `src/lib/mls/normalize-old-site.test.mjs`
- Modify: `package.json` — add the new test file to the `test:mls` script

The real current file (read in full — it's only 35 lines) has two independent
pieces relevant here: `ESTATE_PATTERNS` (an ordered array of
`[slug, [regex, ...]]` tuples — `resolveEstateSlug` returns the slug of the
*first* tuple whose pattern matches, so precedence is just array order, nothing
fancier), and `inferDistrictSlug` (a separate, ordered if/else chain matched
against street/building text, falling through to `"tsuen-wan"` as its last
resort at line 29 — this is where the 海雲軒/縉皇居 bug lives, at line 26).

- [ ] **Step 1: Write the failing test**

Create `src/lib/mls/normalize-old-site.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEstateSlug, inferDistrictSlug } from "./normalize-old-site.mjs";

const estateCases = [
  ["浪翠園5期 帝華軒", "tai-wah-hin"],
  ["浪翠園 第3期", "sea-crest-villa"],
  ["海韻台", "hoi-wan-toi"],
  ["海韻臺", "hoi-wan-toi"],
  ["RHINE TERRACE", "hoi-wan-toi"],
  ["海韻花園", "rhine-garden"],
  ["RHINE GARDEN", "rhine-garden"],
  ["黃金海灣 意嵐", "wong-gam-hoi-waan"],
  ["香港黃金海岸", "wong-gam-hoi-ngon"],
  ["帝御‧嵐天", "tai-yu"],
  ["帝濤灣 浪琴軒", "tai-tou-waan"],
];

for (const [buildingZh, expectedSlug] of estateCases) {
  test(`buildingZh "${buildingZh}" resolves to slug "${expectedSlug}"`, () => {
    assert.equal(resolveEstateSlug({ buildingZh }), expectedSlug);
  });
}

test("海雲軒 no longer falls through to tsuen-wan under the old district-inference rule", () => {
  assert.notEqual(inferDistrictSlug({ buildingZh: "海雲軒" }), "tsuen-wan");
  assert.equal(inferDistrictSlug({ buildingZh: "海雲軒" }), "sham-tseng");
});

test("縉皇居 no longer falls through to tsuen-wan under the old district-inference rule", () => {
  assert.notEqual(inferDistrictSlug({ buildingZh: "縉皇居" }), "tsuen-wan");
  assert.equal(inferDistrictSlug({ buildingZh: "縉皇居" }), "sham-tseng");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/mls/normalize-old-site.test.mjs`
Expected: FAIL — none of the 17 new estates' patterns exist in
`ESTATE_PATTERNS` yet, and the two district-inference cases still return
`"tsuen-wan"`.

- [ ] **Step 3: Insert `tai-wah-hin` and `hoi-wan-toi` tuples in the precedence-sensitive positions**

In `normalize-old-site.mjs`, change:

```javascript
const ESTATE_PATTERNS = [
  ["bellagio", [/碧堤半島/i, /BELLAGIO/i]],
  ["sea-crest-villa", [/浪翠園/i, /SEA CREST VILLA/i]],
  ["hong-kong-garden", [/豪景花園/i, /HONG KONG GARDEN/i]],
  ["rhine-garden", [/海韻花園/i, /RHINE GARDEN/i]],
  ["lido-garden", [/麗都花園/i, /LIDO GDN/i, /LIDO GARDEN/i]],
];
```

to (note `tai-wah-hin` inserted *before* `sea-crest-villa`, and `hoi-wan-toi`
inserted *before* `rhine-garden` — array order is the whole precedence
mechanism, so this alone satisfies both `mustPrecede` rules from the data
pack):

```javascript
const ESTATE_PATTERNS = [
  ["bellagio", [/碧堤半島/i, /BELLAGIO/i]],
  [
    "tai-wah-hin",
    [/帝華軒/i, /浪翠園5期/i, /浪翠園五期/i, /ROYAL SEA CREST/i, /SEA CREST VILLA PHASE 5/i],
  ],
  ["sea-crest-villa", [/浪翠園/i, /SEA CREST VILLA/i]],
  ["hong-kong-garden", [/豪景花園/i, /HONG KONG GARDEN/i]],
  ["hoi-wan-toi", [/海韻臺/i, /海韻台/i, /RHINE TERRACE/i]],
  ["rhine-garden", [/海韻花園/i, /RHINE GARDEN/i]],
  ["lido-garden", [/麗都花園/i, /LIDO GDN/i, /LIDO GARDEN/i]],
  ["hoi-wan-hin", [/海雲軒/i, /ANGLERS' BAY/i, /ANGLERS BAY/i]],
  ["chun-wong-kui", [/縉皇居/i, /OCEAN POINTE/i]],
  ["lung-tang-kok", [/龍騰閣/i, /LUNG TANG COURT/i]],
  ["mun-ming-shan", [/滿名山/i, /THE BLOOMSWAY/i, /BLOOMSWAY/i]],
  [
    "wong-gam-hoi-waan",
    [/黃金海灣/i, /GOLD COAST BAY/i, /意嵐/i, /THE UPPLAND/i, /珀岸/i, /THE RESERVE/i],
  ],
  ["wong-gam-hoi-ngon", [/香港黃金海岸/i, /黃金海岸/i, /HONG KONG GOLD COAST/i, /HK GOLD COAST/i, /GOLD COAST/i]],
  ["oi-kam-hoi-ngon", [/愛琴海岸/i, /AEGEAN COAST/i]],
  [
    "tai-yu",
    [
      /帝御金灣/i,
      /帝御‧金灣/i,
      /SEACOAST ROYALE/i,
      /帝御星濤/i,
      /帝御‧星濤/i,
      /STARFRONT ROYALE/i,
      /帝御嵐天/i,
      /帝御‧嵐天/i,
      /SKYPOINT ROYALE/i,
      /帝御/i,
      /THE ROYALE/i,
    ],
  ],
  ["sing-tai", [/星堤/i, /AVIGNON/i]],
  ["seong-yuen", [/上源/i, /LE PONT/i]],
  ["the-carmel", [/THE CARMEL/i]],
  ["oma-oma", [/OMA OMA/i]],
  ["lin-shan", [/漣山/i, /THE HILLGROVE/i]],
  ["long-tou-waan", [/浪濤灣/i, /AQUA BLUE/i]],
  [
    "tai-tou-waan",
    [/帝濤灣/i, /帝濤灣浪琴軒/i, /帝濤灣海琴軒/i, /GRAND PACIFIC VIEW/i, /GRAND PACIFIC HEIGHTS/i, /PALATIAL COAST/i],
  ],
];
```

Every pattern above is copied from that estate's own `aliases` array in the
data pack. `wong-gam-hoi-waan` is placed before `wong-gam-hoi-ngon` in this
same list, satisfying that pair's precedence rule the same way — array order,
no separate mechanism needed. `hong-kong-garden`'s existing pattern is
`/HONG KONG GARDEN/i` and does not collide with `wong-gam-hoi-ngon`'s new
`/HONG KONG GOLD COAST/i` (different words), so no reordering is needed there.

- [ ] **Step 4: Fix `inferDistrictSlug`'s 海雲軒/縉皇居 misclassification**

Change:

```javascript
  if (/汀九|TING KAU|觀海別墅|嘉御龍庭|汀九別墅/i.test(haystack)) return "ting-kau";
  if (/深井|SHAM TSENG|麗都花園|碧堤半島|浪翠園|海韻花園/i.test(haystack)) return "sham-tseng";
  if (/荃灣|TSUEN WAN|海雲軒|縉皇居/i.test(haystack)) return "tsuen-wan";
  if (/青山公路|CASTLE PEAK/i.test(haystack)) return "castle-peak-road";
```

to:

```javascript
  if (/汀九|TING KAU|觀海別墅|嘉御龍庭|汀九別墅/i.test(haystack)) return "ting-kau";
  if (/深井|SHAM TSENG|麗都花園|碧堤半島|浪翠園|海韻花園|海雲軒|縉皇居|海韻臺|海韻台/i.test(haystack))
    return "sham-tseng";
  if (/荃灣|TSUEN WAN/i.test(haystack)) return "tsuen-wan";
  if (/青山公路|CASTLE PEAK/i.test(haystack)) return "castle-peak-road";
```

海雲軒/縉皇居/海韻臺(台) move from the `tsuen-wan` line to the `sham-tseng`
line — the bug was that they were misclassified as 荃灣, not that
`tsuen-wan` itself was wrong to keep as a fallback for genuine 荃灣 text.
The other 15 estates need no new rule here: their real addresses (per the data
pack) all mention 青山公路, which the existing (unchanged) line 4 above already
catches — do not add per-estate rules for them, that would duplicate what the
existing `青山公路|CASTLE PEAK` line already does correctly.

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --test src/lib/mls/normalize-old-site.test.mjs`
Expected: PASS on all 13 cases.

- [ ] **Step 6: Wire the new test file into `test:mls`**

In `package.json`, add `src/lib/mls/normalize-old-site.test.mjs` to the
`test:mls` script's file list (append it after the last file already in that
`node --test` command on the `test:mls` line).

- [ ] **Step 7: Run the full MLS suite to check for regressions**

Run: `npm run test:mls`
Expected: PASS (all pre-existing MLS tests plus the new normalizer test) —
watch specifically for any existing fixture in `mls-fixtures.test.mjs` that
exercised the old (buggy) 海雲軒/縉皇居 → tsuen-wan behavior and asserted on
it; if one exists, it was asserting on the bug and its expected value must be
corrected to `sham-tseng`, not treated as a regression to preserve.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mls/normalize-old-site.mjs src/lib/mls/normalize-old-site.test.mjs package.json
git commit -m "feat(mls): add 17-estate expansion aliases and precedence rules to the normalizer"
```

---

### Task 7: Neon migration — populate facts for the 17 estates

**Files:**
- Create: `neon/migrations/<timestamp>_estate_expansion_facts.sql` (pick a
  timestamp later than `20260830130000` and later than the most recent existing
  migration filename in `neon/migrations/` — check `ls neon/migrations/ | tail
  -5` for the current latest before choosing one)
- Modify: `src/lib/control-plane/migration-versions.js` (register the new
  filename — follow the exact pattern the previous entry there uses)
- Test: create `src/lib/control-plane/estate-expansion-facts-migration.contract.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/control-plane/estate-expansion-facts-migration.contract.test.mjs`
(adapt the exact assertion style from whatever contract test already covers
`20260830130000_estate_expansion.sql`, if one exists — grep
`neon/migrations/` and `src/lib/control-plane/` for it first):

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_estate_expansion_facts.sql"),
);

test("the estate expansion facts migration exists", () => {
  assert.ok(migrationFile, "expected a migration file ending in _estate_expansion_facts.sql");
});

test("the migration never seeds avg_saleable_psf, price, listing counts, or transactions", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/avg_saleable_psf\s*=/i.test(sql), "must never set avg_saleable_psf");
  assert.ok(!sql.toLowerCase().includes("insert into transactions"), "must never insert transaction rows");
});

test("the migration does not touch published or verified_at", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/published\s*=\s*true/i.test(sql), "must never flip published to true");
  assert.ok(!/verified_at\s*=\s*(now\(\)|'[^']+')/i.test(sql), "must never set a real verified_at timestamp");
});

test("the migration is registered in migration-versions.js", async () => {
  const { migrationVersions } = await import("./migration-versions.js");
  assert.ok(
    migrationVersions.some((v) => v.includes("estate_expansion_facts")),
    "the new migration filename must be registered",
  );
});
```

Adjust the import path/export name for `migration-versions.js` to match its
real exports — read that file first if the shape above doesn't match.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/control-plane/estate-expansion-facts-migration.contract.test.mjs`
Expected: FAIL — the migration file doesn't exist yet.

- [ ] **Step 3: Write the migration**

Create `neon/migrations/<timestamp>_estate_expansion_facts.sql`. For each of
the 17 slugs, `UPDATE`s only the facts columns the data pack supplies a real
value for — every column the data pack itself leaves conflicting/unresolved
(see each estate's `publishBlockers` in the data pack) is deliberately omitted
from the `SET` clause so it stays whatever `NULL` the original
`20260830130000_estate_expansion.sql` seeded, not overwritten with a guess.
One fully worked example (repeat the same `UPDATE ... WHERE slug = '<slug>'`
shape for the other 16, pulling `addressZh`/`developerZh`/`yearCompleted`/
`blocks`/`totalUnits`/`areaMin`/`areaMax`/`schoolNetCode` from each estate's
own data-pack object — omit `totalUnits` from the `SET` clause entirely for
any estate whose data-pack value is `null`, e.g. `hoi-wan-hin`):

```sql
-- Populates facts for the 17-estate expansion (2026-08-30's
-- estate_expansion migration seeded these rows with everything but
-- slug/name/district NULL). Every value here is sourced and cited in
-- docs/superpowers/specs/assets/estate-expansion-17.data.json; a field left
-- NULL here has a genuine cross-source conflict documented in that estate's
-- own publishBlockers entry and is intentionally not guessed.
--
-- Never sets avg_saleable_psf, price, rent, listing counts, or transaction
-- data -- those stay dynamically computed from Neon/MLS. Never sets
-- published or verified_at -- those flip per-estate, by hand, only once
-- that estate individually clears the publish gate documented in
-- docs/superpowers/specs/2026-09-01-estate-expansion-17-design.md.

UPDATE estates SET
  address = '青山公路18A號',
  developer = '信和集團／嘉華國際',
  year_completed = 2004,
  blocks = 2,
  area_min = 469,
  area_max = 1427,
  school_net_code = '62'
WHERE slug = 'hoi-wan-hin';

UPDATE estates SET
  address = '龍騰路8號',
  developer = '新鴻基地產',
  year_completed = 1997,
  blocks = 2,
  total_units = 168,
  area_min = 1056,
  area_max = 1086,
  school_net_code = '62'
WHERE slug = 'tai-wah-hin';
```

Continue this same pattern for the remaining 15 estates
(`hoi-wan-toi`/212/598–1487, `chun-wong-kui`/558/653–1609,
`lung-tang-kok`/48/1743–1958, `mun-ming-shan`/1100/308–2877,
`wong-gam-hoi-ngon`/2168/476–2833, `oi-kam-hoi-ngon`/1624/490–811,
`tai-yu`/1782/184–1376, `wong-gam-hoi-waan`/1323/182–1329,
`sing-tai`, `seong-yuen`, `the-carmel`/178, `oma-oma`/466, `lin-shan`/216,
`long-tou-waan`/242, `tai-tou-waan`/856) — every field value is in that
estate's own object under `docs/superpowers/specs/assets/estate-expansion-17.data.json`'s
`estates[]` array; `addressZh` → `address`, `developerZh` → `developer`,
`yearCompleted` → `year_completed`, `blocks` → `blocks`, `totalUnits` →
`total_units` (omit if `null`), `areaMin`/`areaMax` → `area_min`/`area_max`,
`schoolNetCode` → `school_net_code`. `developerZh: null` (only `lung-tang-kok`)
also means omit `developer` from that estate's `SET` clause.

- [ ] **Step 4: Register the migration filename**

In `src/lib/control-plane/migration-versions.js`, add the new migration's
filename following the exact pattern the file already uses for
`20260830130000_estate_expansion.sql`'s own entry.

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `node --test src/lib/control-plane/estate-expansion-facts-migration.contract.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run migration-versions' own test**

Run: `node --test src/lib/control-plane/migration-versions.test.mjs`
Expected: PASS.

- [ ] **Step 7: Do NOT apply the migration**

Per the design doc and the user's own non-negotiable rule ("Do not deploy and
do not publish"), do not run `npm run neon:migrate` or
`npm run check:migration-drift` against any live database as part of this
task — the contract tests above are sufficient, DB-independent verification.

- [ ] **Step 8: Commit**

```bash
git add neon/migrations/*_estate_expansion_facts.sql src/lib/control-plane/migration-versions.js src/lib/control-plane/estate-expansion-facts-migration.contract.test.mjs
git commit -m "feat(estates): add facts migration for 17-estate expansion (unapplied, unpublished)"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run every test suite this plan touches**

```bash
node --test src/content/estate-registry.test.mjs src/content/estate-pages.test.mjs src/content/school-nets.test.mjs src/content/core-estates.test.mjs src/content/estate-conversion.test.mjs src/components/site/estate-comparison.test.mjs
node --test src/routes/estate.district-driven.contract.test.mjs
node --test src/lib/control-plane/estate-expansion-facts-migration.contract.test.mjs src/lib/control-plane/migration-versions.test.mjs
npm run test:seo
npm run test:corridor
npm run test:listing-search
npm run test:mls
```

Expected: every one PASS.

- [ ] **Step 2: Confirm unpublished isolation end to end**

Run a quick source-level sanity check (not a new test file — a one-off
verification, since Task 1's `fetchEstateBySlug`-level SQL filter on
`published` was never touched by this plan and provides this guarantee
structurally):

```bash
grep -n "COALESCE((to_jsonb(estates)->>'published')" src/lib/neon/public-data.server.ts
```

Expected: still present, unmodified — confirms none of this plan's 7 tasks
touched the query-level publish gate that keeps all 17 unpublished estates
unreachable via `/estate/$slug`, out of the sitemap, and out of public search.

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

- [ ] **Step 4: Lint**

```bash
npx eslint src/content/estate-registry.ts src/content/estate-pages.ts src/content/seo.ts src/content/school-nets.ts src/routes/estate.\$slug.tsx src/lib/mls/normalize-old-site.mjs
```

Expected: clean on every file this plan touched.

- [ ] **Step 5: Confirm the 5 深井/汀九 homepage cards will render once each individually publishes**

This plan does not flip any `published` flag, so no new homepage card
actually appears yet — but confirm the mechanism is genuinely ready: read
`src/content/core-estates.ts`'s `CLIENT_ORDER_SLUGS` (unchanged by this plan)
and confirm it already lists `hoi-wan-hin`/`tai-wah-hin`/`hoi-wan-toi`/
`chun-wong-kui`/`lung-tang-kok` in that order, and that
`CoreEstateGrid`'s `linkableEstates = coreEstates.filter((estate) => estate.hasPage)`
(`src/routes/index.tsx:641`) will now include these 5 given Task 1 flipped
their registry `hasPage` to `true`. This is read-only confirmation, not a code
change — the 12 青山公路 estates are correctly still excluded from any
homepage list (no 青山公路 homepage section exists yet — that's a separate,
later phase per the design doc's explicit scope note).

- [ ] **Step 6: Report**

Summarize: which of the 17 estates' facts fields ended up `NULL` after Task 7
(cross-reference each one's own `publishBlockers` from the data pack — every
`NULL` should trace to a named blocker there, not an oversight); confirm no
`published` or `verified_at` value changed anywhere in this plan's diff;
confirm no deploy and no `neon:migrate` run occurred.
