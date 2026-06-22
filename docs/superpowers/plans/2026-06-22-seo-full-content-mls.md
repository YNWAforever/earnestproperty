# SEO Full Content and MLS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SEO-friendly, full-content Earnest Property website with corrected estate data, rich hyperlocal pages, indexed blog content, imported live listings from the old public MLS, and a protected Vercel Cron refresh.

**Architecture:** Use the existing TanStack Start app and Supabase-backed data model. Add shared `.mjs` MLS parser/importer modules under `src/lib/mls/` so Node scripts, tests, and the TanStack Start cron server route can call the same code. Keep public UI routes in `src/routes`, page content in `src/content`, and durable DB/data changes in Supabase migrations.

**Tech Stack:** TanStack Start, React, Vercel, Vercel Cron, Supabase client/service-role client, Neon-backed Postgres, Node test runner, Cheerio, Vercel `vercel.ts` config.

---

## File Map

- Create `src/content/seo.ts`: canonical metadata, estate corrections, district copy, estate copy, FAQ content, blog article content, schema helpers.
- Create `src/content/seo-source.test.mjs`: source-level tests for metadata, slugs, blog copy, and old placeholder removal.
- Create `supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql`: corrected estate rows, FAQ rows, article seed rows, and optional properties support columns.
- Modify `src/components/site/SiteHeader.tsx`: corrected estate links; keep the primary nav compact and link Ting Kau from district/footer content.
- Modify `src/components/site/SiteFooter.tsx`: corrected estate links and stronger local area links.
- Modify `src/routes/__root.tsx`: `zh-HK`, first-party OG image, and root-level default title/description from `src/content/seo.ts`.
- Modify `src/routes/index.tsx`: first-party metadata, clean FAQ/schema, corrected gradients.
- Modify `src/routes/district.sham-tseng.tsx`: long district content, metadata/schema/internal links.
- Modify `src/routes/district.tsuen-wan.tsx`: replace placeholder with content page.
- Create `src/routes/district.ting-kau.tsx`: new Ting Kau content page.
- Modify `src/routes/estate.$slug.tsx`: corrected estate metadata, enriched content, latest listings, schema.
- Modify `src/routes/blog.tsx`: read and render published articles.
- Create `src/routes/blog.$slug.tsx`: article detail page with Article/Breadcrumb schema.
- Modify `src/routes/about.tsx`: E-E-A-T trust page.
- Modify `src/routes/listings.tsx`: support district filtering and imported-listing display.
- Modify `src/routes/property.$listingNo.tsx`: stronger imported-listing metadata/schema.
- Modify `src/lib/queries.ts`: add article queries, estate listing queries, district filters, and legacy lookup helpers.
- Create `src/lib/mls/parse-old-site.mjs`: parse MLS index/detail HTML.
- Create `src/lib/mls/normalize-old-site.mjs`: normalize parsed MLS records to DB rows.
- Create `src/lib/mls/importer.mjs`: discover, parse, upsert, deactivate, and report sync results.
- Create `src/lib/mls/mls-fixtures.test.mjs`: parser/normalizer/importer tests.
- Modify `scripts/old-site-migration/discover.mjs`: delegate discovery to shared parser.
- Modify `scripts/old-site-migration/parse.mjs`: delegate detail parsing to shared parser.
- Modify `scripts/old-site-migration/normalize.mjs`: delegate normalization to shared normalizer.
- Modify `scripts/old-site-migration/import.mjs`: call shared importer with CLI options.
- Create `src/routes/api.mls-sync.ts`: protected Vercel Cron server route.
- Create `src/routes/api.mls-sync.test.mjs`: source-level auth/config test for the cron route.
- Modify `vercel.ts`: estate redirects and cron entry.
- Modify `package.json`: add MLS sync/test scripts.

---

### Task 1: Lock SEO Data and Correct Estate Slugs

**Files:**
- Create: `src/content/seo.ts`
- Create: `src/content/seo-source.test.mjs`
- Create: `supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql`
- Modify: `src/components/site/SiteHeader.tsx`
- Modify: `src/components/site/SiteFooter.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `vercel.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the failing source test**

Create `src/content/seo-source.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("public navigation and homepage use corrected estate slugs", () => {
  const files = [
    "src/components/site/SiteHeader.tsx",
    "src/components/site/SiteFooter.tsx",
    "src/routes/index.tsx",
    "vercel.ts",
  ].map(read).join("\n");

  assert.equal(files.includes("/estate/belvedere-garden"), false);
  assert.equal(files.includes("/estate/sea-pearl-garden"), false);
  assert.match(files, /\/estate\/bellagio/);
  assert.match(files, /\/estate\/rhine-garden/);
});

test("root metadata no longer references lovable preview assets", () => {
  const root = read("src/routes/__root.tsx");
  assert.equal(root.includes("lovable.app"), false);
  assert.equal(root.includes("id-preview"), false);
});

test("seo content registry contains required full-content routes", () => {
  const source = read("src/content/seo.ts");
  for (const slug of [
    "bellagio",
    "rhine-garden",
    "sham-tseng-buying-guide-2026",
    "bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
  ]) {
    assert.match(source, new RegExp(slug));
  }
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test src/content/seo-source.test.mjs
```

Expected: fail because `src/content/seo.ts` does not exist and old slugs still appear in public source files.

- [ ] **Step 3: Create the SEO content registry**

Create `src/content/seo.ts` with:

```ts
export const SITE_URL = "https://earnestproperty.vercel.app";
export const SITE_NAME = "晉誠地產 Earnest Property";
export const SITE_OG_IMAGE = `${SITE_URL}/assets/hero-shamtseng.jpg`;

export type PageSeo = {
  title: string;
  description: string;
  path: string;
};

export const pageSeo = {
  home: {
    path: "/",
    title: "晉誠地產 Earnest Property｜深井買樓租樓．青山公路物業專家",
    description:
      "深井 hyperlocal 地產專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園堅盤源，即時 WhatsApp 查詢。持牌代理 C-018613。",
  },
  listings: {
    path: "/listings",
    title: "深井放盤搜尋｜買樓租樓堅盤源 — 晉誠地產",
    description:
      "一站搜尋深井、汀九及青山公路在售及放租盤。海景、連車位、連租約收租盤齊全，WhatsApp 即時預約睇樓。C-018613。",
  },
  shamTseng: {
    path: "/district/sham-tseng",
    title: "深井 Sham Tseng 物業｜屋苑、交通、62 校網、12 個月成交",
    description:
      "深井買樓租樓全攻略：5 大屋苑、青馬橋海景、62 校網、去中環 35 分鐘、近 12 個月實呎走勢。晉誠地產 C-018613。",
  },
  tsuenWan: {
    path: "/district/tsuen-wan",
    title: "荃灣 Tsuen Wan 物業｜屋苑、港鐵、學校、樓價走勢",
    description:
      "荃灣買樓租樓指南：港鐵荃灣線、荃灣西、大型商場、校網一覽，連深井青龍頭比較。晉誠地產堅盤源 C-018613。",
  },
  tingKau: {
    path: "/district/ting-kau",
    title: "汀九 Ting Kau 樓盤｜青山公路低密度海景別墅、洋房",
    description:
      "青山公路汀九段樓盤一覽：觀海別墅、嘉御龍庭、汀九別墅等低密度海景別墅洋房，介乎荃灣與深井，62 校網。晉誠地產 C-018613。",
  },
  blog: {
    path: "/blog",
    title: "深井 / 荃灣樓市分析 Blog｜晉誠地產",
    description:
      "深井買樓租樓攻略、屋苑比較、校網交通、成交走勢分析。由深井 hyperlocal 專家撰寫，助你睇通深井樓市。",
  },
  about: {
    path: "/about",
    title: "關於晉誠地產 Earnest Property｜深井物業專家",
    description:
      "晉誠地產（C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園等核心屋苑。堅盤源、即時回覆、持牌可靠。",
  },
  contact: {
    path: "/contact",
    title: "聯絡晉誠地產｜深井睇樓預約．WhatsApp 即時查詢",
    description:
      "WhatsApp 即時聯絡晉誠地產持牌代理，深井麗都花園地舖門市，歡迎預約睇樓及樓盤估價。",
  },
} satisfies Record<string, PageSeo>;

export const estateSeo = {
  bellagio: {
    slug: "bellagio",
    oldSlugs: ["belvedere-garden"],
    nameZh: "碧堤半島",
    nameEn: "Bellagio",
    developer: "會德豐 / 九龍倉",
    yearLabel: "2003–2006",
    phases: 3,
    totalUnits: 3345,
    areaLabel: "515–1,961 呎",
    title: "碧堤半島 Bellagio 深井｜放盤、成交、呎價、會所",
    description:
      "碧堤半島（Bellagio）深井海景豪宅，約 3,345 伙，坐擁青馬橋景。即時放盤、成交呎價、FAQ。WhatsApp 查詢 C-018613。",
    intro:
      "碧堤半島（Bellagio）位於深井青山公路深井段 33 號，由會德豐 / 九龍倉發展，2003 至 2006 年分三期落成，共 8 座、約 3,345 個單位，係深井近海填海地段嘅地標屋苑。",
    fit: "追求海景同會所配套嘅家庭、換樓客、外籍 / 回流人士；亦有不少投資者睇中其租務需求穩定。",
  },
  "sea-crest-villa": {
    slug: "sea-crest-villa",
    oldSlugs: [],
    nameZh: "浪翠園",
    nameEn: "Sea Crest Villa",
    developer: "新鴻基",
    yearLabel: "1992–1997",
    phases: 5,
    totalUnits: 2389,
    areaLabel: "",
    title: "浪翠園 Sea Crest Villa 深井｜放盤、成交、則王",
    description:
      "浪翠園（Sea Crest Villa）新鴻基出品，5 期 15 座近 2,400 伙。深井海景大社區放盤、成交、間隔一覽。晉誠地產 C-018613。",
    intro:
      "浪翠園（Sea Crest Villa）由新鴻基地產發展，1992 至 1997 年分五期落成，共 15 座、約 2,389 個單位，係深井歷史最悠久嘅大型海景屋苑之一。",
    fit: "首次置業上車客、預算務實嘅換樓家庭、想要海景但唔想付碧堤溢價嘅買家。",
  },
  "hong-kong-garden": {
    slug: "hong-kong-garden",
    oldSlugs: [],
    nameZh: "豪景花園",
    nameEn: "Hong Kong Garden",
    developer: "華懋集團",
    yearLabel: "1986–1991",
    phases: 3,
    totalUnits: 2830,
    areaLabel: "358–1,382 呎",
    title: "豪景花園 Hong Kong Garden 青龍頭｜放盤、成交、呎價",
    description:
      "豪景花園（Hong Kong Garden）華懋大型屋苑，青龍頭背山面海，2 至 3 房盤源。成交呎價、FAQ、即時 WhatsApp 查詢。",
    intro:
      "豪景花園（Hong Kong Garden）位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位。",
    fit: "注重空間同預算嘅家庭、想用上車價買三房嘅買家、長線收租投資者。",
  },
  "rhine-garden": {
    slug: "rhine-garden",
    oldSlugs: ["sea-pearl-garden"],
    nameZh: "海韻花園",
    nameEn: "Rhine Garden",
    developer: "",
    yearLabel: "1992",
    phases: 0,
    totalUnits: 1068,
    areaLabel: "",
    title: "海韻花園 Rhine Garden 深井｜海景放盤、成交、租盤",
    description:
      "海韻花園（Rhine Garden）深井臨海屋苑，無敵汀九橋海景。放盤、成交、租務一覽，WhatsApp 即時預約睇樓。C-018613。",
    intro:
      "海韻花園（Rhine Garden）位於深井青山公路臨海地段，1992 年底落成，提供約 1,068 個單位，是深井最貼近海岸線的屋苑之一。",
    fit: "鍾意低密度、近海、想要靚海景嘅自住客同退休人士。",
  },
  "lido-garden": {
    slug: "lido-garden",
    oldSlugs: [],
    nameZh: "麗都花園",
    nameEn: "Lido Garden",
    developer: "",
    yearLabel: "1988",
    phases: 0,
    totalUnits: 1392,
    areaLabel: "",
    title: "麗都花園 Lido Garden 深井｜放盤、租盤、成交呎價",
    description:
      "麗都花園（Lido Garden）深井青山公路臨海屋苑，鄰近深井燒鵝美食圈。放盤、租盤、成交數據，持牌代理 C-018613。",
    intro:
      "麗都花園（Lido Garden）位於深井青山公路深井段，1988 年落成，提供約 1,392 個單位，是深井其中一個最早期嘅臨海屋苑，亦係晉誠地產門市所在地。",
    fit: "預算入門嘅上車客、想要方便生活圈嘅租客、收租投資者。",
  },
} as const;

export const estateAliases: Record<string, keyof typeof estateSeo> = {
  "碧堤半島": "bellagio",
  "BELLAGIO": "bellagio",
  "浪翠園": "sea-crest-villa",
  "SEA CREST VILLA": "sea-crest-villa",
  "豪景花園": "hong-kong-garden",
  "HONG KONG GARDEN": "hong-kong-garden",
  "海韻花園": "rhine-garden",
  "RHINE GARDEN": "rhine-garden",
  "麗都花園": "lido-garden",
  "LIDO GDN": "lido-garden",
  "LIDO GARDEN": "lido-garden",
};
```

- [ ] **Step 4: Add the estate/data migration**

Create `supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql` with SQL that:

```sql
UPDATE public.estates
SET slug = 'bellagio',
    name_en = 'Bellagio',
    developer = '會德豐 / 九龍倉',
    year_completed = 2003,
    phases = 3,
    total_units = 3345,
    area_min = 515,
    area_max = 1961,
    description = '碧堤半島（Bellagio）位於深井青山公路深井段 33 號，由會德豐 / 九龍倉發展，2003 至 2006 年分三期落成，共 8 座、約 3,345 個單位，係深井近海填海地段嘅地標屋苑。'
WHERE slug = 'belvedere-garden' OR name_zh = '碧堤半島';

UPDATE public.estates
SET name_en = 'Sea Crest Villa',
    developer = '新鴻基',
    year_completed = 1992,
    phases = 5,
    total_units = 2389,
    description = '浪翠園（Sea Crest Villa）由新鴻基地產發展，1992 至 1997 年分五期落成，共 15 座、約 2,389 個單位，係深井歷史最悠久嘅大型海景屋苑之一。'
WHERE slug = 'sea-crest-villa' OR name_zh = '浪翠園';

UPDATE public.estates
SET name_en = 'Hong Kong Garden',
    developer = '華懋集團',
    year_completed = 1986,
    phases = 3,
    total_units = 2830,
    area_min = 358,
    area_max = 1382,
    description = '豪景花園（Hong Kong Garden）位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位。'
WHERE slug = 'hong-kong-garden' OR name_zh = '豪景花園';

UPDATE public.estates
SET slug = 'rhine-garden',
    name_en = 'Rhine Garden',
    year_completed = 1992,
    total_units = 1068,
    description = '海韻花園（Rhine Garden）位於深井青山公路臨海地段，1992 年底落成，提供約 1,068 個單位，是深井最貼近海岸線的屋苑之一。'
WHERE slug = 'sea-pearl-garden' OR name_zh = '海韻花園';

UPDATE public.estates
SET name_en = 'Lido Garden',
    year_completed = 1988,
    total_units = 1392,
    description = '麗都花園（Lido Garden）位於深井青山公路深井段，1988 年落成，提供約 1,392 個單位，是深井其中一個最早期嘅臨海屋苑，亦係晉誠地產門市所在地。'
WHERE slug = 'lido-garden' OR name_zh = '麗都花園';

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_updated_at DATE;

CREATE INDEX IF NOT EXISTS idx_properties_last_seen_at
  ON public.properties (last_seen_at);
```

- [ ] **Step 5: Update public links and redirects**

Make these source changes:

- `src/components/site/SiteHeader.tsx`: change the estate nav item from `/estate/belvedere-garden` to `/estate/bellagio`.
- `src/components/site/SiteFooter.tsx`: change `/estate/belvedere-garden` to `/estate/bellagio`; add `/estate/rhine-garden` and `/estate/lido-garden` to the district/estate link list.
- `src/routes/index.tsx`: replace `belvedere-garden` gradient key with `bellagio`; replace `sea-pearl-garden` with `rhine-garden`; fallback to `ESTATE_GRADIENTS["bellagio"]`.
- `vercel.ts`: add permanent redirects before the generic listing redirects:

```ts
routes.redirect("/estate/belvedere-garden", "/estate/bellagio", { permanent: true }),
routes.redirect("/estate/sea-pearl-garden", "/estate/rhine-garden", { permanent: true }),
```

- [ ] **Step 6: Add the test script**

Modify `package.json` scripts:

```json
"test:seo": "node --test src/content/seo-source.test.mjs",
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run test:seo
npx eslint src/components/site/SiteHeader.tsx src/components/site/SiteFooter.tsx src/routes/index.tsx
git diff --check
```

Expected: tests pass, ESLint exits 0, diff check exits 0.

Commit:

```bash
git add src/content/seo.ts src/content/seo-source.test.mjs supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql src/components/site/SiteHeader.tsx src/components/site/SiteFooter.tsx src/routes/index.tsx vercel.ts package.json package-lock.json
git commit -m "fix: correct estate seo data"
```

---

### Task 2: Build the MLS Parser With Fixtures

**Files:**
- Create: `src/lib/mls/parse-old-site.mjs`
- Create: `src/lib/mls/mls-fixtures.test.mjs`
- Create: `scripts/old-site-migration/__fixtures__/property-index-c1.html`
- Create: `scripts/old-site-migration/__fixtures__/property-detail-6709182.html`
- Modify: `package.json`

- [ ] **Step 1: Capture fixtures**

Run:

```bash
curl -sSL https://www.earnestproperty.com/property/c1 > scripts/old-site-migration/__fixtures__/property-index-c1.html
curl -sSL https://www.earnestproperty.com/property-detail/6709182.html > scripts/old-site-migration/__fixtures__/property-detail-6709182.html
```

Expected: both fixture files contain `晉誠地產`, and the detail fixture contains `物業編號: B054805`.

- [ ] **Step 2: Add failing parser tests**

Create `src/lib/mls/mls-fixtures.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  parseListingIndex,
  parseListingDetail,
  parseMoneyToHkd,
  parseAreaFeet,
  parseRoomCounts,
} from "./parse-old-site.mjs";

function fixture(name) {
  return readFileSync(new URL(`../../../scripts/old-site-migration/__fixtures__/${name}`, import.meta.url), "utf8");
}

test("parseListingIndex discovers unique property-detail URLs", () => {
  const links = parseListingIndex(fixture("property-index-c1.html"), "https://www.earnestproperty.com/property/c1");
  assert.ok(links.length >= 10);
  assert.ok(links.includes("https://www.earnestproperty.com/property-detail/6709182.html"));
  assert.equal(new Set(links).size, links.length);
});

test("parseListingDetail extracts old MLS fields", () => {
  const detail = parseListingDetail(
    fixture("property-detail-6709182.html"),
    "https://www.earnestproperty.com/property-detail/6709182.html",
  );
  assert.equal(detail.legacyDetailId, "6709182");
  assert.equal(detail.legacyPropertyNo, "B054805");
  assert.equal(detail.title, "麗都花園 第03座, 荃灣, #B054805 - 晉誠地產");
  assert.equal(detail.districtName, "荃灣");
  assert.equal(detail.streetZh, "青山公路41-63號深井段");
  assert.equal(detail.buildingZh, "麗都花園 第03座");
  assert.equal(detail.buildingEn, "LIDO GDN BLK 03");
  assert.equal(detail.salePriceHkd, 5900000);
  assert.equal(detail.rentHkd, null);
  assert.equal(detail.grossArea, 683);
  assert.equal(detail.saleableArea, 570);
  assert.equal(detail.bedrooms, 2);
  assert.equal(detail.livingRooms, 2);
  assert.equal(detail.orientation, "西南");
  assert.equal(detail.sourceUpdatedAt, "2026-06-21");
  assert.ok(detail.images.length >= 10);
  assert.ok(detail.images[0].startsWith("https://imgs.property.hk/largePhotos/"));
});

test("primitive parsers handle Hong Kong listing text", () => {
  assert.equal(parseMoneyToHkd("590萬"), 5900000);
  assert.equal(parseMoneyToHkd("$1,280萬"), 12800000);
  assert.equal(parseMoneyToHkd("--"), null);
  assert.equal(parseAreaFeet("570 呎"), 570);
  assert.deepEqual(parseRoomCounts("2房2廳"), { bedrooms: 2, livingRooms: 2 });
  assert.deepEqual(parseRoomCounts("開放式"), { bedrooms: 0, livingRooms: null });
});
```

- [ ] **Step 3: Run the failing parser tests**

Run:

```bash
node --test src/lib/mls/mls-fixtures.test.mjs
```

Expected: fail because `src/lib/mls/parse-old-site.mjs` does not exist.

- [ ] **Step 4: Implement the parser**

Create `src/lib/mls/parse-old-site.mjs` with exports:

```js
import * as cheerio from "cheerio";

export function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).toString();
}

export function parseListingIndex(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = $("a[href]")
    .map((_, a) => $(a).attr("href"))
    .get()
    .filter((href) => href && /\/property-detail\/\d+\.html$/.test(href))
    .map((href) => absoluteUrl(href, baseUrl));
  return [...new Set(links)];
}

export function parseMoneyToHkd(text) {
  const raw = normalizeText(text);
  if (!raw || raw === "--") return null;
  const number = Number(raw.replace(/[$,\s]/g, "").replace(/萬$/, ""));
  if (!Number.isFinite(number)) return null;
  return raw.endsWith("萬") ? Math.round(number * 10000) : Math.round(number);
}

export function parseAreaFeet(text) {
  const match = normalizeText(text).match(/([\d,]+)\s*呎/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function parseRoomCounts(text) {
  const raw = normalizeText(text);
  if (raw.includes("開放式")) return { bedrooms: 0, livingRooms: null };
  const bedrooms = raw.match(/(\d+)房/);
  const livingRooms = raw.match(/(\d+)廳/);
  return {
    bedrooms: bedrooms ? Number(bedrooms[1]) : null,
    livingRooms: livingRooms ? Number(livingRooms[1]) : null,
  };
}

export function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function parseDetailTable($) {
  const fields = {};
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const key = normalizeText($(cells[0]).text());
    const value = normalizeText($(cells[1]).text());
    if (key) fields[key] = value;
  });
  return fields;
}

export function parseListingDetail(html, sourceUrl) {
  const $ = cheerio.load(html);
  const fields = parseDetailTable($);
  const legacyDetailId = sourceUrl.match(/property-detail\/(\d+)\.html/)?.[1] ?? null;
  const legacyPropertyNo =
    normalizeText($("body").text()).match(/物業編號:\s*([A-Z0-9]+)/)?.[1] ??
    $("meta[name=description]").attr("content")?.match(/#([A-Z0-9]+)/)?.[1] ??
    null;
  const roomCounts = parseRoomCounts(fields["間格"]);
  const images = $("img[src], meta[property='og:image']")
    .map((_, node) => $(node).attr("content") ?? $(node).attr("src"))
    .get()
    .filter((src) => src && /imgs\.property\.hk\/(largePhotos|midPhotos)/.test(src))
    .map((src) => src.replace("/midPhotos/", "/largePhotos/"))
    .filter((src, index, all) => all.indexOf(src) === index);

  return {
    sourceUrl,
    legacyDetailId,
    legacyPropertyNo,
    title: normalizeText($("title").text()),
    metaDescription: normalizeText($("meta[name=description]").attr("content")),
    ogImage: $("meta[property='og:image']").attr("content") ?? null,
    sourceUpdatedAt: fields["更新日期"] || null,
    propertyUse: fields["物業用途"] || null,
    districtName: fields["地區"] || null,
    streetEn: fields["街道 (英)"] || null,
    streetZh: fields["街道 (中)"] || null,
    buildingEn: fields["大廈 (英)"] || null,
    buildingZh: fields["大廈 (中)"] || null,
    floor: fields["層數"] || null,
    unit: fields["單位"] || null,
    grossArea: parseAreaFeet(fields["建築面積"]),
    saleableArea: parseAreaFeet(fields["實用面積"]),
    salePriceHkd: parseMoneyToHkd(fields["售價"]),
    rentHkd: parseMoneyToHkd(fields["出租價"]),
    orientation: fields["座向景觀"] || null,
    decoration: fields["裝修"] || null,
    remarks: fields["備註"] || null,
    contactName: fields["聯絡人"] || null,
    contactPhone: fields["聯絡電話"] || null,
    bedrooms: roomCounts.bedrooms,
    livingRooms: roomCounts.livingRooms,
    images,
  };
}
```

- [ ] **Step 5: Add the test script and verify**

Modify `package.json` scripts:

```json
"test:mls": "node --test src/lib/mls/mls-fixtures.test.mjs"
```

Run:

```bash
npm run test:mls
git diff --check
```

Expected: parser tests pass, diff check exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mls/parse-old-site.mjs src/lib/mls/mls-fixtures.test.mjs scripts/old-site-migration/__fixtures__/property-index-c1.html scripts/old-site-migration/__fixtures__/property-detail-6709182.html package.json package-lock.json
git commit -m "feat: parse old mls listings"
```

---

### Task 3: Normalize Old MLS Records Into Property Rows

**Files:**
- Create: `src/lib/mls/normalize-old-site.mjs`
- Modify: `src/lib/mls/mls-fixtures.test.mjs`
- Modify: `src/content/seo.ts`

- [ ] **Step 1: Add failing normalizer tests**

Append to `src/lib/mls/mls-fixtures.test.mjs`:

```js
import {
  inferDistrictSlug,
  resolveEstateSlug,
  normalizeListingDetail,
} from "./normalize-old-site.mjs";

test("resolveEstateSlug maps corrected estate aliases", () => {
  assert.equal(resolveEstateSlug({ buildingZh: "麗都花園 第03座", buildingEn: "LIDO GDN BLK 03" }), "lido-garden");
  assert.equal(resolveEstateSlug({ buildingZh: "海韻花園", buildingEn: "RHINE GARDEN" }), "rhine-garden");
  assert.equal(resolveEstateSlug({ buildingZh: "碧堤半島", buildingEn: "BELLAGIO" }), "bellagio");
});

test("inferDistrictSlug separates Sham Tseng, Ting Kau, and Tsuen Wan", () => {
  assert.equal(inferDistrictSlug({ streetZh: "青山公路41-63號深井段", buildingZh: "麗都花園 第03座" }), "sham-tseng");
  assert.equal(inferDistrictSlug({ streetZh: "青山公路汀九段386號", buildingZh: "觀海別墅" }), "ting-kau");
  assert.equal(inferDistrictSlug({ streetZh: "荃灣西", buildingZh: "海雲軒" }), "tsuen-wan");
});

test("normalizeListingDetail creates a sale property row", () => {
  const parsed = parseListingDetail(
    fixture("property-detail-6709182.html"),
    "https://www.earnestproperty.com/property-detail/6709182.html",
  );
  const rows = normalizeListingDetail(parsed, {
    estateIdsBySlug: new Map([["lido-garden", "estate-lido"]]),
    nowIso: "2026-06-22T00:00:00.000Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].legacy_detail_id, "6709182");
  assert.equal(rows[0].legacy_property_no, "B054805");
  assert.equal(rows[0].deal_type, "sale");
  assert.equal(rows[0].estate_id, "estate-lido");
  assert.equal(rows[0].district_slug, "sham-tseng");
  assert.equal(rows[0].price, 5900000);
  assert.equal(rows[0].rent, null);
  assert.equal(rows[0].saleable_area, 570);
  assert.equal(rows[0].gross_area, 683);
  assert.equal(rows[0].bedrooms, 2);
  assert.equal(rows[0].source_site, "earnestproperty-old-site");
  assert.equal(rows[0].source_url, "https://www.earnestproperty.com/property-detail/6709182.html");
  assert.equal(rows[0].last_seen_at, "2026-06-22T00:00:00.000Z");
  assert.equal(rows[0].status, "active");
});
```

- [ ] **Step 2: Run the failing normalizer tests**

Run:

```bash
npm run test:mls
```

Expected: fail because `normalize-old-site.mjs` does not exist.

- [ ] **Step 3: Implement the normalizer**

Create `src/lib/mls/normalize-old-site.mjs` with:

```js
const ESTATE_PATTERNS = [
  ["bellagio", [/碧堤半島/i, /BELLAGIO/i]],
  ["sea-crest-villa", [/浪翠園/i, /SEA CREST VILLA/i]],
  ["hong-kong-garden", [/豪景花園/i, /HONG KONG GARDEN/i]],
  ["rhine-garden", [/海韻花園/i, /RHINE GARDEN/i]],
  ["lido-garden", [/麗都花園/i, /LIDO GDN/i, /LIDO GARDEN/i]],
];

export function resolveEstateSlug(detail) {
  const haystack = `${detail.buildingZh ?? ""} ${detail.buildingEn ?? ""}`.toUpperCase();
  for (const [slug, patterns] of ESTATE_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(haystack))) return slug;
  }
  return null;
}

export function inferDistrictSlug(detail) {
  const haystack = `${detail.streetZh ?? ""} ${detail.streetEn ?? ""} ${detail.buildingZh ?? ""}`;
  if (/汀九|TING KAU|觀海別墅|嘉御龍庭|汀九別墅/i.test(haystack)) return "ting-kau";
  if (/深井|SHAM TSENG|麗都花園|碧堤半島|浪翠園|海韻花園/i.test(haystack)) return "sham-tseng";
  if (/荃灣|TSUEN WAN|海雲軒|縉皇居/i.test(haystack)) return "tsuen-wan";
  if (/青山公路|CASTLE PEAK/i.test(haystack)) return "castle-peak-road";
  return "tsuen-wan";
}

function cleanNull(value) {
  return value === "" || value === undefined ? null : value;
}

function listingNo(detail, dealType) {
  const base = detail.legacyPropertyNo || detail.legacyDetailId;
  return dealType === "rent" ? `${base}-R` : `${base}-S`;
}

function titleFor(detail, dealType) {
  const building = detail.buildingZh || detail.title.replace(/ - 晉誠地產$/, "");
  const action = dealType === "rent" ? "租盤" : "售盤";
  return `${building} ${action} #${detail.legacyPropertyNo ?? detail.legacyDetailId}`;
}

export function normalizeListingDetail(detail, options) {
  const estateSlug = resolveEstateSlug(detail);
  const estateId = estateSlug ? options.estateIdsBySlug.get(estateSlug) ?? null : null;
  const districtSlug = inferDistrictSlug(detail);
  const dealTypes = [];
  if (detail.salePriceHkd) dealTypes.push("sale");
  if (detail.rentHkd) dealTypes.push("rent");
  if (dealTypes.length === 0) return [];

  return dealTypes.map((dealType) => ({
    listing_no: listingNo(detail, dealType),
    title_zh: titleFor(detail, dealType),
    title_en: null,
    deal_type: dealType,
    estate_id: estateId,
    district_slug: districtSlug,
    address: [detail.streetZh, detail.buildingZh].filter(Boolean).join(" "),
    price: dealType === "sale" ? detail.salePriceHkd : null,
    rent: dealType === "rent" ? detail.rentHkd : null,
    saleable_area: detail.saleableArea,
    gross_area: detail.grossArea,
    bedrooms: detail.bedrooms,
    bathrooms: null,
    floor: cleanNull(detail.floor),
    orientation: cleanNull(detail.orientation),
    features: [detail.decoration, detail.remarks].filter(Boolean),
    description: detail.metaDescription || detail.title,
    images: detail.images,
    status: "active",
    featured: false,
    legacy_detail_id: detail.legacyDetailId,
    legacy_property_no: detail.legacyPropertyNo,
    source_site: "earnestproperty-old-site",
    source_url: detail.sourceUrl,
    source_updated_at: detail.sourceUpdatedAt,
    last_seen_at: options.nowIso,
  }));
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run test:mls
git diff --check
```

Expected: tests pass.

Commit:

```bash
git add src/lib/mls/normalize-old-site.mjs src/lib/mls/mls-fixtures.test.mjs src/content/seo.ts
git commit -m "feat: normalize old mls listings"
```

---

### Task 4: Build the Shared MLS Importer and CLI

**Files:**
- Create: `src/lib/mls/importer.mjs`
- Modify: `src/lib/mls/mls-fixtures.test.mjs`
- Modify: `scripts/old-site-migration/discover.mjs`
- Modify: `scripts/old-site-migration/parse.mjs`
- Modify: `scripts/old-site-migration/normalize.mjs`
- Modify: `scripts/old-site-migration/import.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing importer tests**

Append to `src/lib/mls/mls-fixtures.test.mjs`:

```js
import { createMlsImporter } from "./importer.mjs";

test("createMlsImporter dry run reports discovered, parsed, and upsertable rows", async () => {
  const indexHtml = fixture("property-index-c1.html");
  const detailHtml = fixture("property-detail-6709182.html");
  const fetched = new Map([
    ["https://www.earnestproperty.com/property/c1", indexHtml],
    ["https://www.earnestproperty.com/property-detail/6709182.html", detailHtml],
  ]);
  const importer = createMlsImporter({
    fetchText: async (url) => fetched.get(url) ?? "",
    db: {
      listEstateIdsBySlug: async () => new Map([["lido-garden", "estate-lido"]]),
      upsertProperties: async (rows) => ({ count: rows.length }),
      deactivateMissing: async () => ({ count: 0 }),
    },
    now: () => new Date("2026-06-22T00:00:00.000Z"),
  });
  const result = await importer.sync({
    seedUrls: ["https://www.earnestproperty.com/property/c1"],
    maxDetails: 1,
    dryRun: true,
  });
  assert.equal(result.discovered, 10);
  assert.equal(result.parsed, 1);
  assert.equal(result.upserted, 0);
  assert.equal(result.dryRunRows.length, 1);
  assert.equal(result.dryRunRows[0].listing_no, "B054805-S");
});
```

- [ ] **Step 2: Run the failing importer tests**

Run:

```bash
npm run test:mls
```

Expected: fail because `importer.mjs` does not exist.

- [ ] **Step 3: Implement the importer**

Create `src/lib/mls/importer.mjs` with:

```js
import { parseListingIndex, parseListingDetail } from "./parse-old-site.mjs";
import { normalizeListingDetail } from "./normalize-old-site.mjs";

export const DEFAULT_SEED_URLS = [
  "https://www.earnestproperty.com/property/c1",
  "https://www.earnestproperty.com/property/c2",
  "https://www.earnestproperty.com/property/c5",
];

export function createMlsImporter({ fetchText, db, now }) {
  return {
    async discover(seedUrls = DEFAULT_SEED_URLS) {
      const discovered = [];
      for (const seedUrl of seedUrls) {
        const html = await fetchText(seedUrl);
        discovered.push(...parseListingIndex(html, seedUrl));
      }
      return [...new Set(discovered)];
    },

    async sync({ seedUrls = DEFAULT_SEED_URLS, maxDetails = 200, dryRun = false } = {}) {
      const nowIso = now().toISOString();
      const estateIdsBySlug = await db.listEstateIdsBySlug();
      const urls = (await this.discover(seedUrls)).slice(0, maxDetails);
      const rows = [];
      const errors = [];

      for (const url of urls) {
        try {
          const html = await fetchText(url);
          const detail = parseListingDetail(html, url);
          rows.push(...normalizeListingDetail(detail, { estateIdsBySlug, nowIso }));
        } catch (error) {
          errors.push({ url, message: error instanceof Error ? error.message : String(error) });
        }
      }

      if (dryRun) {
        return {
          discovered: urls.length,
          parsed: rows.length,
          upserted: 0,
          deactivated: 0,
          errors,
          dryRunRows: rows,
        };
      }

      const upserted = rows.length ? await db.upsertProperties(rows) : { count: 0 };
      const seenLegacyIds = [...new Set(rows.map((row) => row.legacy_detail_id).filter(Boolean))];
      const deactivated = await db.deactivateMissing({
        sourceSite: "earnestproperty-old-site",
        seenLegacyIds,
        nowIso,
      });

      return {
        discovered: urls.length,
        parsed: rows.length,
        upserted: upserted.count,
        deactivated: deactivated.count,
        errors,
        dryRunRows: [],
      };
    },
  };
}

export function createSupabaseMlsDb(supabase) {
  return {
    async listEstateIdsBySlug() {
      const { data, error } = await supabase.from("estates").select("id, slug");
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.slug, row.id]));
    },
    async upsertProperties(rows) {
      const { error } = await supabase
        .from("properties")
        .upsert(rows, { onConflict: "legacy_detail_id,deal_type" });
      if (error) throw error;
      return { count: rows.length };
    },
    async deactivateMissing({ sourceSite, seenLegacyIds, nowIso }) {
      if (seenLegacyIds.length === 0) return { count: 0 };
      const { data, error } = await supabase
        .from("properties")
        .update({ status: "inactive", updated_at: nowIso })
        .eq("source_site", sourceSite)
        .not("legacy_detail_id", "in", `(${seenLegacyIds.map((id) => `"${id}"`).join(",")})`)
        .select("id");
      if (error) throw error;
      return { count: data?.length ?? 0 };
    },
  };
}

export async function defaultFetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "EarnestPropertyBot/1.0 (+https://earnestproperty.vercel.app)",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}
```

- [ ] **Step 4: Update CLI scripts to delegate to shared modules**

Modify `scripts/old-site-migration/import.mjs` to call the shared importer:

```js
import { createClient } from "@supabase/supabase-js";
import {
  createMlsImporter,
  createSupabaseMlsDb,
  defaultFetchText,
  DEFAULT_SEED_URLS,
} from "../../src/lib/mls/importer.mjs";

const dryRun = process.argv.includes("--dry-run");
const maxArg = process.argv.find((arg) => arg.startsWith("--max="));
const maxDetails = maxArg ? Number(maxArg.slice("--max=".length)) : 200;

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const importer = createMlsImporter({
  fetchText: defaultFetchText,
  db: createSupabaseMlsDb(supabase),
  now: () => new Date(),
});

const result = await importer.sync({ seedUrls: DEFAULT_SEED_URLS, maxDetails, dryRun });
console.log(JSON.stringify(result, null, 2));
```

Keep `discover.mjs`, `parse.mjs`, and `normalize.mjs` as thin compatibility wrappers around the shared modules so the existing scripts remain usable.

- [ ] **Step 5: Add scripts**

Modify `package.json`:

```json
"mls:import": "node scripts/old-site-migration/import.mjs",
"mls:sync": "node scripts/old-site-migration/import.mjs --max=200",
"mls:dry-run": "node scripts/old-site-migration/import.mjs --dry-run --max=10"
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:mls
npm run mls:dry-run
git diff --check
```

Expected: tests pass; dry run prints JSON with `discovered`, `parsed`, `dryRunRows`.

Commit:

```bash
git add src/lib/mls/importer.mjs src/lib/mls/mls-fixtures.test.mjs scripts/old-site-migration/discover.mjs scripts/old-site-migration/parse.mjs scripts/old-site-migration/normalize.mjs scripts/old-site-migration/import.mjs package.json package-lock.json
git commit -m "feat: import old mls listings"
```

---

### Task 5: Add Protected Vercel Cron Route

**Files:**
- Create: `src/routes/api.mls-sync.ts`
- Create: `src/routes/api.mls-sync.test.mjs`
- Modify: `vercel.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing cron source test**

Create `src/routes/api.mls-sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./api.mls-sync.ts", import.meta.url), "utf8");
const vercel = readFileSync(new URL("../../vercel.ts", import.meta.url), "utf8");

test("mls sync route protects cron endpoint", () => {
  assert.match(source, /createFileRoute\(["']\/api\/mls-sync["']\)/);
  assert.match(source, /authorization/i);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /status:\s*401/);
  assert.match(source, /createMlsImporter/);
});

test("vercel config registers the daily mls cron", () => {
  assert.match(vercel, /crons/);
  assert.match(vercel, /\/api\/mls-sync/);
  assert.match(vercel, /0 20 \* \* \*/);
});
```

- [ ] **Step 2: Run failing cron test**

Run:

```bash
node --test src/routes/api.mls-sync.test.mjs
```

Expected: fail because `src/routes/api.mls-sync.ts` does not exist and `vercel.ts` has no cron.

- [ ] **Step 3: Implement the server route**

Create `src/routes/api.mls-sync.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createMlsImporter,
  createSupabaseMlsDb,
  defaultFetchText,
} from "@/lib/mls/importer.mjs";

export const Route = createFileRoute("/api/mls-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        const actual = request.headers.get("authorization");

        if (!expected || actual !== `Bearer ${expected}`) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const importer = createMlsImporter({
          fetchText: defaultFetchText,
          db: createSupabaseMlsDb(supabaseAdmin),
          now: () => new Date(),
        });

        const result = await importer.sync({ maxDetails: 200 });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
```

- [ ] **Step 4: Add Vercel cron**

Modify `vercel.ts`:

```ts
crons: [{ path: "/api/mls-sync", schedule: "0 20 * * *" }],
```

Use `20:00 UTC`, which is `04:00 Asia/Hong_Kong`, so the daily import runs before Hong Kong morning traffic.

- [ ] **Step 5: Add test script, verify, commit**

Modify `package.json`:

```json
"test:cron": "node --test src/routes/api.mls-sync.test.mjs"
```

Run:

```bash
npm run test:cron
npx eslint src/routes/api.mls-sync.ts
git diff --check
```

Expected: tests pass, ESLint exits 0.

Commit:

```bash
git add src/routes/api.mls-sync.ts src/routes/api.mls-sync.test.mjs vercel.ts package.json package-lock.json
git commit -m "feat: add protected mls sync cron"
```

---

### Task 6: Add Article Queries and Blog Pages

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/routes/blog.tsx`
- Create: `src/routes/blog.$slug.tsx`
- Modify: `src/content/seo.ts`
- Modify: `src/content/seo-source.test.mjs`

- [ ] **Step 1: Add failing blog source tests**

Append to `src/content/seo-source.test.mjs`:

```js
test("blog routes render real indexed articles", () => {
  const blog = read("src/routes/blog.tsx");
  const detail = read("src/routes/blog.$slug.tsx");
  const queries = read("src/lib/queries.ts");

  assert.match(queries, /fetchPublishedArticles/);
  assert.match(queries, /fetchArticleBySlug/);
  assert.match(blog, /深井買樓全攻略 2026/);
  assert.match(detail, /Article/);
  assert.match(detail, /BreadcrumbList/);
});
```

- [ ] **Step 2: Run failing SEO test**

Run:

```bash
npm run test:seo
```

Expected: fail because article queries/detail route do not exist.

- [ ] **Step 3: Add article content to the registry**

Append `blogArticles` to `src/content/seo.ts`:

```ts
export const blogArticles = [
  {
    slug: "sham-tseng-buying-guide-2026",
    title: "深井買樓全攻略 2026：5 大屋苑、呎價、校網、交通一次睇晒",
    excerpt:
      "深井買樓睇呢篇就夠：碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園逐個分析，連呎價、62 校網、去中環交通全攻略。",
    category: "買樓攻略",
    readingMinutes: 8,
    content: [
      "想喺深井買樓，但唔知五大屋苑點揀、呎價幾多、校網又屬邊個網？呢篇由深井 hyperlocal 專家整理嘅 2026 全攻略，一次過幫你睇通深井樓市。",
      "深井位於新界荃灣西、青山公路沿線，背靠大欖郊野公園，面向汀九橋同青馬大橋海峽。佢最大賣點係同價海景，平過半山。",
      "碧堤半島適合預算充足、想要海景同會所嘅家庭；浪翠園適合上車及換樓；豪景花園適合想用上車價買三房；海韻花園適合海景行先；麗都花園適合入門上車同租住。",
      "深井屬荃灣 62 校網，交通上可用小巴 96M 接荃灣站，X961 經西隧約 35 分鐘到中環，自駕經青馬橋往機場約 22 分鐘。",
    ],
    links: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/bellagio", label: "碧堤半島放盤" },
      { href: "/listings?deal=all&page=1", label: "搜尋深井放盤" },
    ],
  },
  {
    slug: "bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
    title: "碧堤半島 vs 浪翠園 vs 豪景花園：深井三大屋苑點揀好？",
    excerpt:
      "碧堤半島、浪翠園、豪景花園三大深井屋苑點揀？由呎價、樓齡、海景、會所到適合人群逐項對比。",
    category: "屋苑比較",
    readingMinutes: 6,
    content: [
      "深井三大屋苑成日令買家揀到頭痛。三個都係海景大社區，但定位差好遠。",
      "碧堤半島最新，會所同園林維護到位，俾人度假式感覺；浪翠園和豪景花園樓齡較長，勝在社區成熟、實用和入場門檻較低。",
      "想要最新、最強會所同海景，預算充足就睇碧堤半島；想要海景但預算有限就睇浪翠園；想用最抵價錢買到實用三房就睇豪景花園。",
    ],
    links: [
      { href: "/estate/bellagio", label: "碧堤半島 Bellagio" },
      { href: "/estate/sea-crest-villa", label: "浪翠園 Sea Crest Villa" },
      { href: "/estate/hong-kong-garden", label: "豪景花園 Hong Kong Garden" },
    ],
  },
] as const;
```

- [ ] **Step 4: Add article queries**

Modify `src/lib/queries.ts`:

```ts
export type ArticleSummary = {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  category: string | null;
  reading_minutes: number | null;
  published_at: string;
};

export async function fetchPublishedArticles(): Promise<ArticleSummary[]> {
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, excerpt, cover_image, category, reading_minutes, published_at")
    .eq("published", true)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchArticleBySlug(slug: string) {
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, excerpt, content, cover_image, category, reading_minutes, published_at")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 5: Render blog list and detail routes**

Modify `src/routes/blog.tsx` to load published articles and render cards. Create `src/routes/blog.$slug.tsx` to load one article, render title/excerpt/content, internal links from `blogArticles`, and emit `Article` plus `BreadcrumbList` JSON-LD.

- [ ] **Step 6: Seed article rows**

Extend `supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql` with:

```sql
INSERT INTO public.articles
  (slug, title, excerpt, content, category, reading_minutes, published)
VALUES
  (
    'sham-tseng-buying-guide-2026',
    '深井買樓全攻略 2026：5 大屋苑、呎價、校網、交通一次睇晒',
    '深井買樓睇呢篇就夠：碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園逐個分析，連呎價、62 校網、去中環交通全攻略。',
    '想喺深井買樓，但唔知五大屋苑點揀、呎價幾多、校網又屬邊個網？呢篇由深井 hyperlocal 專家整理嘅 2026 全攻略，一次過幫你睇通深井樓市。' || E'\n\n' ||
    '深井位於新界荃灣西、青山公路沿線，背靠大欖郊野公園，面向汀九橋同青馬大橋海峽。佢最大賣點係同價海景，平過半山。' || E'\n\n' ||
    '碧堤半島適合預算充足、想要海景同會所嘅家庭；浪翠園適合上車及換樓；豪景花園適合想用上車價買三房；海韻花園適合海景行先；麗都花園適合入門上車同租住。',
    '買樓攻略',
    8,
    true
  ),
  (
    'bellagio-vs-sea-crest-villa-vs-hong-kong-garden',
    '碧堤半島 vs 浪翠園 vs 豪景花園：深井三大屋苑點揀好？',
    '碧堤半島、浪翠園、豪景花園三大深井屋苑點揀？由呎價、樓齡、海景、會所到適合人群逐項對比。',
    '深井三大屋苑成日令買家揀到頭痛。三個都係海景大社區，但定位差好遠。' || E'\n\n' ||
    '碧堤半島最新，會所同園林維護到位，俾人度假式感覺；浪翠園和豪景花園樓齡較長，勝在社區成熟、實用和入場門檻較低。' || E'\n\n' ||
    '想要最新、最強會所同海景，預算充足就睇碧堤半島；想要海景但預算有限就睇浪翠園；想用最抵價錢買到實用三房就睇豪景花園。',
    '屋苑比較',
    6,
    true
  )
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  excerpt = EXCLUDED.excerpt,
  content = EXCLUDED.content,
  category = EXCLUDED.category,
  reading_minutes = EXCLUDED.reading_minutes,
  published = EXCLUDED.published;
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run test:seo
npx eslint src/lib/queries.ts src/routes/blog.tsx src/routes/blog.$slug.tsx src/content/seo.ts
git diff --check
```

Expected: tests and lint pass.

Commit:

```bash
git add src/lib/queries.ts src/routes/blog.tsx src/routes/blog.$slug.tsx src/content/seo.ts src/content/seo-source.test.mjs supabase/migrations/20260622020000_seo_content_and_estate_corrections.sql
git commit -m "feat: publish seo blog content"
```

---

### Task 7: Build Full District and About Content

**Files:**
- Modify: `src/routes/district.sham-tseng.tsx`
- Modify: `src/routes/district.tsuen-wan.tsx`
- Create: `src/routes/district.ting-kau.tsx`
- Modify: `src/routes/about.tsx`
- Modify: `src/content/seo-source.test.mjs`

- [ ] **Step 1: Add failing district/about tests**

Append to `src/content/seo-source.test.mjs`:

```js
test("district and about pages contain full local seo content", () => {
  const shamTseng = read("src/routes/district.sham-tseng.tsx");
  const tsuenWan = read("src/routes/district.tsuen-wan.tsx");
  const tingKau = read("src/routes/district.ting-kau.tsx");
  const about = read("src/routes/about.tsx");

  assert.match(shamTseng, /西半山平民海景區/);
  assert.match(tsuenWan, /港鐵荃灣綫總站/);
  assert.match(tingKau, /低密度別墅/);
  assert.match(about, /堅盤源/);
  assert.match(about, /C-018613/);
});
```

- [ ] **Step 2: Run failing SEO test**

Run:

```bash
npm run test:seo
```

Expected: fail because Ting Kau route does not exist and placeholder content remains.

- [ ] **Step 3: Implement the pages**

Use copy from the design spec and SEO brief:

- Sham Tseng: add the long introduction immediately below the hero/stats.
- Tsuen Wan: replace placeholder with intro, transport/comparison blocks, and links to `/district/sham-tseng` and `/district/ting-kau`.
- Ting Kau: create route with H1 `汀九 Ting Kau · 青山公路低密度海景住宅`, villa list, FAQ, and WhatsApp CTA.
- About: expand into sections `我哋係邊個`, `我哋點解唔同`, `服務範圍`, `門市`.

Use existing `Card`, `Badge`, `Button`, and `Link` patterns. Do not add a new design system.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run test:seo
npx eslint src/routes/district.sham-tseng.tsx src/routes/district.tsuen-wan.tsx src/routes/district.ting-kau.tsx src/routes/about.tsx
git diff --check
```

Expected: tests and lint pass.

Commit:

```bash
git add src/routes/district.sham-tseng.tsx src/routes/district.tsuen-wan.tsx src/routes/district.ting-kau.tsx src/routes/about.tsx src/content/seo-source.test.mjs
git commit -m "feat: add full local seo pages"
```

---

### Task 8: Enrich Estate Pages With SEO Content and Live Listings

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/routes/estate.$slug.tsx`
- Modify: `src/content/seo-source.test.mjs`

- [ ] **Step 1: Add failing estate page test**

Append to `src/content/seo-source.test.mjs`:

```js
test("estate pages use seo registry and latest listing sections", () => {
  const estate = read("src/routes/estate.$slug.tsx");
  const queries = read("src/lib/queries.ts");

  assert.match(estate, /estateSeo/);
  assert.match(estate, /BreadcrumbList/);
  assert.match(estate, /FAQPage/);
  assert.match(estate, /最新放盤/);
  assert.match(queries, /fetchListingsForEstate/);
});
```

- [ ] **Step 2: Run failing SEO test**

Run:

```bash
npm run test:seo
```

Expected: fail because estate page still uses generic metadata and no latest-listing section.

- [ ] **Step 3: Add estate listing query**

Modify `src/lib/queries.ts`:

```ts
export async function fetchListingsForEstate(estateSlug: string, limit = 6): Promise<ListingRow[]> {
  const { data: estate, error: estateError } = await supabase
    .from("estates")
    .select("id")
    .eq("slug", estateSlug)
    .maybeSingle();
  if (estateError) throw estateError;
  if (!estate?.id) return [];

  const { data, error } = await supabase
    .from("properties")
    .select("id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, floor, images, estates(name_zh, slug)")
    .eq("status", "active")
    .eq("estate_id", estate.id)
    .order("featured", { ascending: false })
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ListingRow[];
}
```

- [ ] **Step 4: Enrich estate route**

Modify `src/routes/estate.$slug.tsx`:

- Import `estateSeo` from `@/content/seo`.
- Loader fetches `latestListings` with `fetchListingsForEstate(params.slug, 6)`.
- Head uses `estateSeo[slug]?.title` and description when available.
- Hero displays Chinese and English estate name.
- Body displays `intro`, `fit`, stats, FAQ, latest listings, CTA.
- Emit `BreadcrumbList` and `FAQPage` scripts.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run test:seo
npx eslint src/lib/queries.ts src/routes/estate.$slug.tsx
git diff --check
```

Expected: tests and lint pass.

Commit:

```bash
git add src/lib/queries.ts src/routes/estate.$slug.tsx src/content/seo-source.test.mjs
git commit -m "feat: enrich estate seo pages"
```

---

### Task 9: Upgrade Listings Search for Imported Inventory

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/routes/listings.tsx`
- Modify: `src/content/seo-source.test.mjs`

- [ ] **Step 1: Add failing listings test**

Append to `src/content/seo-source.test.mjs`:

```js
test("listings page supports district and imported listing freshness", () => {
  const listings = read("src/routes/listings.tsx");
  const queries = read("src/lib/queries.ts");

  assert.match(listings, /district/);
  assert.match(listings, /最後更新/);
  assert.match(queries, /districtSlug/);
  assert.match(queries, /last_seen_at/);
});
```

- [ ] **Step 2: Run failing SEO test**

Run:

```bash
npm run test:seo
```

Expected: fail because listing filters do not include district/freshness.

- [ ] **Step 3: Extend query types**

Modify `ListingFilters` and `ListingRow` in `src/lib/queries.ts`:

```ts
districtSlug?: string;
last_seen_at: string | null;
source_site?: string | null;
```

Update `searchListings`:

```ts
if (f.districtSlug) q = q.eq("district_slug", f.districtSlug);
```

Include `last_seen_at, source_site` in the select list, and order by `last_seen_at` after `featured`.

- [ ] **Step 4: Add district filter UI**

Modify `src/routes/listings.tsx`:

- Add `district` to `searchSchema`.
- Add a district `<Select>` with values `all`, `sham-tseng`, `ting-kau`, `tsuen-wan`, `castle-peak-road`.
- Pass `districtSlug: deps.district === "all" ? undefined : deps.district`.
- Render `最後更新：YYYY-MM-DD` for imported rows with `last_seen_at`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run test:seo
npx eslint src/lib/queries.ts src/routes/listings.tsx
git diff --check
```

Expected: tests and lint pass.

Commit:

```bash
git add src/lib/queries.ts src/routes/listings.tsx src/content/seo-source.test.mjs
git commit -m "feat: filter imported listings by district"
```

---

### Task 10: Strengthen Property Detail SEO and Legacy Redirects

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/routes/property.$listingNo.tsx`
- Modify: `vercel.ts`
- Modify: `src/content/seo-source.test.mjs`

- [ ] **Step 1: Add failing property SEO test**

Append to `src/content/seo-source.test.mjs`:

```js
test("property detail pages expose real estate schema and legacy support", () => {
  const property = read("src/routes/property.$listingNo.tsx");
  const queries = read("src/lib/queries.ts");
  const vercel = read("vercel.ts");

  assert.match(property, /RealEstateListing/);
  assert.match(property, /Residence/);
  assert.match(property, /BreadcrumbList/);
  assert.match(queries, /fetchPropertyByLegacyDetailId/);
  assert.match(vercel, /property-detail\/:oldId\.html/);
});
```

- [ ] **Step 2: Run failing SEO test**

Run:

```bash
npm run test:seo
```

Expected: fail because legacy helper/schema are incomplete.

- [ ] **Step 3: Add legacy lookup helper**

Modify `src/lib/queries.ts`:

```ts
export async function fetchPropertyByLegacyDetailId(oldId: string) {
  const { data, error } = await supabase
    .from("properties")
    .select("listing_no")
    .eq("legacy_detail_id", oldId)
    .eq("status", "active")
    .order("deal_type", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Strengthen property schema**

Modify `src/routes/property.$listingNo.tsx` so JSON-LD includes:

- `@type: ["RealEstateListing", "Residence"]` or separate `RealEstateListing` and `Residence` objects in an `@graph`.
- `BreadcrumbList` with home, listings, estate if known, and property.
- `url` built from `https://earnestproperty.vercel.app/property/${property.listing_no}`.
- `image` from imported listing images.
- `offers.priceCurrency = "HKD"`.

- [ ] **Step 5: Keep generic old detail redirect**

Keep the current `vercel.ts` redirect:

```ts
routes.redirect("/property-detail/:oldId.html", "/listings", { permanent: true }),
```

Do not attempt dynamic DB-backed redirects in `vercel.ts`; Vercel redirects are static. The importer-preserved `legacy_detail_id` supports future dynamic mapping if a server route is added.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:seo
npx eslint src/lib/queries.ts src/routes/property.$listingNo.tsx vercel.ts
git diff --check
```

Expected: tests and lint pass.

Commit:

```bash
git add src/lib/queries.ts src/routes/property.$listingNo.tsx vercel.ts src/content/seo-source.test.mjs
git commit -m "feat: improve property detail seo"
```

---

### Task 11: Final Metadata, Sitemap Signals, and Build Verification

**Files:**
- Modify: `src/routes/__root.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/contact.tsx`
- Modify: `src/routes/agents.tsx`
- Modify: `src/content/seo-source.test.mjs`

- [ ] **Step 1: Add final metadata test**

Append to `src/content/seo-source.test.mjs`:

```js
test("root and public pages use zh-HK and first-party metadata", () => {
  const root = read("src/routes/__root.tsx");
  const home = read("src/routes/index.tsx");
  const contact = read("src/routes/contact.tsx");
  const agents = read("src/routes/agents.tsx");

  assert.match(root, /<html lang=["']zh-HK["']/);
  assert.match(root, /SITE_OG_IMAGE/);
  assert.match(home, /RealEstateAgent/);
  assert.match(contact, /聯絡晉誠地產/);
  assert.match(agents, /持牌/);
});
```

- [ ] **Step 2: Run failing SEO test**

Run:

```bash
npm run test:seo
```

Expected: fail because root language and OG constants are not fully wired.

- [ ] **Step 3: Wire metadata constants**

Modify `src/routes/__root.tsx`:

- Import `SITE_OG_IMAGE`, `SITE_NAME`, `pageSeo`.
- Change `<html lang="en">` to `<html lang="zh-HK">`.
- Replace hard-coded Lovable OG URLs with `SITE_OG_IMAGE`.
- Keep `defaultTheme="light"`.

Modify remaining public pages so titles/descriptions match `pageSeo` where practical.

- [ ] **Step 4: Verify all focused checks**

Run:

```bash
npm run test:seo
npm run test:mls
npm run test:cron
npm run test:neon-auth
npm run test:contact
npx eslint src scripts/old-site-migration vercel.ts
npm run build
git diff --check
```

Expected: every command exits 0. Build may show known chunk-size warnings but must finish successfully.

- [ ] **Step 5: Commit**

```bash
git add src/routes/__root.tsx src/routes/index.tsx src/routes/contact.tsx src/routes/agents.tsx src/content/seo-source.test.mjs
git commit -m "feat: finalize public seo metadata"
```

---

### Task 12: Run Import, Configure Vercel, Deploy, and Verify Production

**Files:**
- No source file required unless verification exposes a bug.

- [ ] **Step 1: Confirm required env vars locally**

Run:

```bash
node -e 'for (const k of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","CRON_SECRET"]) console.log(k, process.env[k] ? "set" : "missing")'
```

Expected: `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` may be missing locally. If they are missing, add them to local `.env.local` from the secure source or use Vercel env only for production.

- [ ] **Step 2: Add Vercel env vars if missing**

Run:

```bash
vercel env ls --scope ynwaforevers-projects
```

If `CRON_SECRET` is missing, add it:

```bash
openssl rand -hex 32
vercel env add CRON_SECRET production --scope ynwaforevers-projects
vercel env add CRON_SECRET preview --scope ynwaforevers-projects
```

If `SUPABASE_SERVICE_ROLE_KEY` is missing, add it from Supabase project settings:

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY production --scope ynwaforevers-projects
vercel env add SUPABASE_SERVICE_ROLE_KEY preview --scope ynwaforevers-projects
```

- [ ] **Step 3: Run a local dry run and manual import**

Run:

```bash
npm run mls:dry-run
npm run mls:sync
```

Expected dry run: JSON includes at least one row with `legacy_detail_id`.

Expected sync: JSON includes nonzero `parsed` and `upserted`, and `errors` is an empty array or a short list of detail URLs that failed without aborting the run.

- [ ] **Step 4: Verify imported listing visibility locally**

Run:

```bash
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

Open or probe:

```bash
curl -sS http://127.0.0.1:4173/listings | rg "B054805|麗都花園|搜尋放盤"
curl -sS http://127.0.0.1:4173/estate/lido-garden | rg "最新放盤|麗都花園"
```

Expected: listing page renders and estate page includes latest-listing content.

Stop the preview server after verification.

- [ ] **Step 5: Push and open PR**

Run:

```bash
git status --short
git push -u origin codex/seo-full-content-mls-plan
gh pr create --base main --head codex/seo-full-content-mls-plan --title "Build full SEO content and MLS integration" --body "Implements full SEO content foundation, corrected estate data, old public MLS importer, Vercel cron sync, article routes, and listing SEO."
```

Expected: PR URL is returned.

- [ ] **Step 6: Wait for Vercel preview**

Run:

```bash
gh pr checks --watch
```

Expected: Vercel check passes.

- [ ] **Step 7: Merge and verify production**

Run:

```bash
gh pr merge --merge --delete-branch
vercel ls earnestproperty --scope ynwaforevers-projects --format json
vercel inspect https://earnestproperty.vercel.app --scope ynwaforevers-projects --wait
```

Expected: latest production deployment status is `Ready` and aliases include `https://earnestproperty.vercel.app`.

- [ ] **Step 8: Verify live pages**

Run:

```bash
curl -sS https://earnestproperty.vercel.app/ | rg "晉誠地產|RealEstateAgent"
curl -sS https://earnestproperty.vercel.app/district/ting-kau | rg "汀九|低密度別墅"
curl -sS https://earnestproperty.vercel.app/blog/sham-tseng-buying-guide-2026 | rg "深井買樓全攻略 2026|Article"
curl -sS https://earnestproperty.vercel.app/listings | rg "搜尋放盤"
```

Expected: each command finds the relevant page content.

Commit or patch any deployment-only issue with a focused follow-up commit and repeat this task's verification.
