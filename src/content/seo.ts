import { getEstateEntry } from "./estate-registry.ts";

/**
 * Production origin. Every canonical, og:image, sitemap <loc>, robots.txt
 * Sitemap line and JSON-LD url is built from this, so it must be the host
 * search engines should consolidate on -- not whichever deployment served
 * the request. vite.config.ts injects import.meta.env.VITE_SITE_URL at build
 * time from VITE_SITE_URL or Vercel's VERCEL_PROJECT_PRODUCTION_URL (see
 * scripts/site-origin.mjs); the vercel.app origin is only the fallback for
 * local dev and `node --test`, where import.meta.env is undefined.
 */
const FALLBACK_SITE_URL = "https://earnestproperty.vercel.app";

export function normalizeSiteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const SITE_URL =
  normalizeSiteUrl(
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SITE_URL,
  ) ?? FALLBACK_SITE_URL;
export const SITE_HOST = new URL(SITE_URL).host;
export const SITE_NAME = "晉誠地產 Earnest Property";
export const SITE_OG_IMAGE = `${SITE_URL}/og-cover.jpg`;
export const SITE_LOGO_URL = `${SITE_URL}/brand/earnest-company-logo-2026.jpg`;
/* Must stay in sync with --brand-primary in src/styles.css. */
export const SITE_THEME_COLOR = "#1F7A4D";

export type PageSeo = {
  title: string;
  description: string;
  path: string;
};

/**
 * Only 4 routes had a canonical link before this (castle-peak-road.index,
 * castle-peak-road.$segment, district.sham-tseng, district.tsuen-wan); most
 * public pages had none. Deliberately not root-level: a canonical declared on
 * __root.tsx would stamp the homepage URL onto every page. Pass the bare path
 * with no query string -- /listings must canonicalise to `/listings`, not
 * whatever filter combination the visitor arrived with.
 */
export function canonicalLink(path: string) {
  return { rel: "canonical", href: `${SITE_URL}${path}` } as const;
}

/**
 * A CMS-authored SEO 標題 / SEO 描述, or `undefined` when the editor left it
 * blank -- so it can head a `??` fallback chain safely.
 *
 * Every DB-backed head (estate, article, listing) prefers a hand-written
 * `seo_title`/`seo_description` over its derived copy. Those chains used bare
 * `??`, which only falls through on null/undefined: an empty-string column
 * value won, and the page shipped an empty `<title>`. The columns really can
 * hold `''` -- the CMS revision publish writes `payload->>'seo_title'` with no
 * NULLIF (neon/migrations/20260905110000_cms_atomic_mutations.sql), and
 * fetchEstateBySlug returns the row unmapped -- so the guard belongs here,
 * once, rather than in each head.
 */
export function authored(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Combinator for the common `head()` shape (title, description, og mirrors,
 * canonical, optional noindex) -- built for and applied to the handful of
 * routes whose title/description genuinely equal their og:title/og:description
 * (most routes already work fine with a hand-rolled head() and were not
 * migrated onto this; see P7a's scope decision).
 */
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
      // __root.tsx sets the Twitter pair to the homepage copy; mirror the page's
      // own title/description so a shared link never renders the homepage card.
      { name: "twitter:title", content: input.title },
      { name: "twitter:description", content: input.description },
      ...(input.ogImage ? [{ property: "og:image", content: input.ogImage }] : []),
      ...(input.ogImage ? [{ name: "twitter:image", content: input.ogImage }] : []),
      ...(input.noindex ? [{ name: "robots", content: "noindex,follow" }] : []),
    ],
    links: [canonicalLink(input.path)],
  };
}

export const pageSeo = {
  home: {
    path: "/",
    title: "晉誠地產 Earnest Property｜深井 青山公路 汀九樓盤",
    description:
      "深井 青山公路 汀九我哋比你更熟。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園及汀九筍盤，即時 WhatsApp 查詢。持牌代理 C-018613。",
  },
  // Rendered by listings.tsx's head() -- keep the route on this object rather
  // than a second hardcoded string, so an edit here actually ships.
  listings: {
    path: "/listings",
    title: "深井放盤搜尋｜買樓租樓全部真盤 — 晉誠地產",
    description:
      "一站搜尋深井、汀九及青山公路在售及放租盤。海景、連車位、連租約收租盤齊全，WhatsApp 即時預約睇樓。C-018613。",
  },
  // No `castlePeakRoad` entry: castlePeakRoadHub in castle-peak-road.ts owns
  // the corridor hub's title/description, and the hub's path already reaches
  // the sitemap through castlePeakRoadSitemapPaths. The entry that used to sit
  // here was dead in all three fields -- its title was byte-identical to the
  // hub's (a duplicate <title> waiting to be shipped if anyone wired it up),
  // its description had silently diverged from the rendered one, and its path
  // was deduplicated away by the sitemap's own uniquePaths().
  // Rendered by district.sham-tseng.tsx's head(). /district/sham-tseng is the
  // canonical 深井 page; the corridor segment targets 青山公路深井段 instead.
  shamTseng: {
    path: "/district/sham-tseng",
    title: "深井 Sham Tseng 物業｜屋苑、交通、62 校網、成交",
    description:
      "深井買樓租樓全攻略：5 大屋苑、青馬橋海景、62 校網、去中環 35 分鐘、近 12 個月實呎走勢。晉誠地產 C-018613。",
  },
  tsuenWan: {
    path: "/district/tsuen-wan",
    title: "荃灣樓盤｜港鐵市中心、荃灣西、深井汀九比較",
    description:
      "荃灣買樓租樓指南：荃灣市中心港鐵盤、荃灣西、青山公路深井汀九海景屋苑三個生活圈，比較交通取捨同同價選擇。晉誠地產 C-018613。",
  },
  blog: {
    path: "/blog",
    title: "深井 青山公路 汀九樓市分析 Blog｜晉誠地產",
    description:
      "深井、青山公路及汀九買樓租樓攻略：屋苑比較、校網交通、成交走勢分析，由紮根深井嘅持牌代理團隊撰寫，助你睇通區內樓市。",
  },
  // These five routes used to hardcode their title and description three times
  // each (meta, og, twitter) inside their own route file, with the og/twitter
  // copy a shorter, divergent string -- so every shared card was thinner than
  // the SERP snippet, and none of it was width-tested. They live here now so
  // seo-copy.test.mjs sweeps them like every other page. Each route still owns
  // its own canonical and its own noindex gate.
  agents: {
    path: "/agents",
    title: "深井 青山公路 汀九持牌地產代理｜晉誠地產團隊",
    description:
      "晉誠地產持牌代理團隊，分駐麗都、海韻及青山公路豪景分行。按屋苑、專長及語言揀代理，WhatsApp 直接聯絡預約睇樓或放盤委託。C-018613。",
  },
  videos: {
    path: "/videos",
    title: "樓盤影片｜深井 青山公路 汀九屋苑實拍｜晉誠地產",
    description:
      "晉誠地產 YouTube 影片專頁：樓盤實拍、屋苑開箱、市場評論及社區生活影片，可按屋苑或分類篩選，睇完即 WhatsApp 預約實地睇樓。C-018613。",
  },
  transactions: {
    path: "/transactions",
    title: "深井 青山公路 汀九成交紀錄｜屋苑實呎｜晉誠地產",
    description:
      "深井、青山公路及汀九屋苑最新成交：成交價、實用面積及實呎，可按地區、屋苑、租售及月份篩選，配合前線市場資訊評估你嘅物業。C-018613。",
  },
  estateReviews: {
    path: "/estate-reviews",
    title: "屋苑開箱｜深井 青山公路 汀九屋苑指南｜晉誠地產",
    description:
      "深井、青山公路及汀九屋苑開箱：逐個屋苑睇會所、間隔、樓齡同買家定位，連結各屋苑專頁比較現有放盤同成交紀錄。晉誠地產 C-018613。",
  },
  mortgage: {
    path: "/mortgage",
    title: "香港按揭計算機｜供款、壓力測試、印花稅｜晉誠地產",
    description:
      "香港住宅按揭計算機：輸入樓價即算首期、每月供款、壓力測試、供款與入息比率及從價印花稅，可直接 WhatsApp 晉誠地產跟進按揭同睇樓。C-018613。",
  },
  blogEditorialStandards: {
    path: "/blog/editorial-standards",
    title: "編採及事實查核標準｜晉誠地產 Blog",
    description:
      "晉誠地產 Blog 文章點樣揀資料來源、邊啲數據要核對、幾時更新，以及發現錯誤時嘅更正做法。買樓前先了解我哋嘅編採及事實查核標準。",
  },
  about: {
    path: "/about",
    title: "關於晉誠地產｜深井、青山公路物業專家",
    description:
      "晉誠地產（C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園等核心屋苑。全部真盤、即時回覆、持牌可靠。",
  },
  contact: {
    path: "/contact",
    title: "聯絡晉誠地產｜深井睇樓預約．WhatsApp 即時查詢",
    description:
      "WhatsApp 即時聯絡晉誠地產持牌代理，深井麗都花園地舖門市，買樓、租樓、放盤及免費估價一站處理，歡迎預約睇樓。持牌代理 C-018613。",
  },
  privacy: {
    path: "/privacy",
    title: "私隱政策｜晉誠地產 Earnest Property",
    description:
      "晉誠地產點樣收集、使用及保存你透過網站、WhatsApp 及門市提供嘅個人資料，以及你查閱和更正資料嘅權利。符合香港《個人資料（私隱）條例》。",
  },
  disclaimer: {
    path: "/disclaimer",
    title: "免責聲明｜晉誠地產 Earnest Property",
    description:
      "晉誠地產網站嘅放盤、成交、呎價及樓市分析只供參考，實際資料以業主及土地註冊處紀錄為準。了解本網站資料嘅來源、限制及使用責任。",
  },
  terms: {
    path: "/terms",
    title: "使用條款｜晉誠地產 Earnest Property",
    description:
      "使用晉誠地產網站、放盤搜尋、按揭計算機及 WhatsApp 查詢服務嘅條款及細則，包括資料使用、知識產權及責任限制。",
  },
} satisfies Record<string, PageSeo>;

/**
 * `intro`/`fit`/`developer`/`yearLabel`/`phases`/`totalUnits`/`areaLabel` are
 * optional: the original 5 core estates carry all of them (hand-written
 * market-fact prose predating estate-pages.ts's own `content` object), while
 * the 17 estates added 2026-09-01 carry only `title`/`description` -- their
 * equivalent prose lives in estate-pages.ts's `content.heroPositioning`/
 * `content.buyerFit` instead (Task 4), which estate.$slug.tsx already prefers
 * over these fields (`content?.heroPositioning ?? seo?.fit ?? ...`). Declaring
 * this type explicitly, rather than letting TypeScript infer a disjoint union
 * from 22 differently-shaped object literals, is what lets that fallback
 * chain type-check for every estate, not just the original 5.
 */
export type EstateSeo = {
  slug: string;
  oldSlugs: string[];
  nameZh: string;
  nameEn: string;
  title: string;
  description: string;
  developer?: string;
  yearLabel?: string;
  phases?: number;
  totalUnits?: number;
  areaLabel?: string;
  intro?: string;
  fit?: string;
};

/**
 * Identity fields (slug, oldSlugs, nameZh, nameEn) come from estate-registry.ts
 * (DR-10) instead of being retyped here -- this object keeps only its own SEO
 * copy (title/description/intro/fit) and market facts.
 */
function estateSeoIdentity(slug: string) {
  const entry = getEstateEntry(slug);
  if (!entry.nameEn) {
    throw new Error(`seo.ts: estateSeo requires a supplied nameEn, but "${slug}" has none`);
  }
  return {
    slug: entry.slug,
    oldSlugs: entry.legacySlug ? [entry.legacySlug] : [],
    nameZh: entry.nameZh,
    nameEn: entry.nameEn,
  };
}

export const estateSeo: Record<string, EstateSeo> = {
  bellagio: {
    ...estateSeoIdentity("bellagio"),
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
    ...estateSeoIdentity("sea-crest-villa"),
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
    ...estateSeoIdentity("hong-kong-garden"),
    developer: "華懋集團",
    yearLabel: "1986–1991",
    phases: 3,
    totalUnits: 2830,
    areaLabel: "358–1,382 呎",
    title: "豪景花園 Hong Kong Garden 青龍頭｜放盤、成交、呎價",
    description:
      "豪景花園（Hong Kong Garden）華懋 1986 至 1991 年分三期落成，28 座約 2,830 伙，實用 358 至 1,382 呎，青龍頭背山面海。放盤成交即查。C-018613。",
    intro:
      "豪景花園（Hong Kong Garden）位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位。",
    fit: "注重空間同預算嘅家庭、想用上車價買三房嘅買家、長線收租投資者。",
  },
  "rhine-garden": {
    ...estateSeoIdentity("rhine-garden"),
    developer: "",
    yearLabel: "1992",
    phases: 0,
    totalUnits: 1068,
    areaLabel: "",
    title: "海韻花園 Rhine Garden 深井｜1,068 伙臨海放盤成交",
    description:
      "海韻花園（Rhine Garden）1992 年落成，約 1,068 伙，深井臨海地段睇正汀九橋海景。放盤、租盤、成交呎價即時查詢。C-018613。",
    intro:
      "海韻花園（Rhine Garden）位於深井青山公路臨海地段，1992 年底落成，提供約 1,068 個單位，是深井最貼近海岸線的屋苑之一。",
    fit: "鍾意低密度、近海、想要靚海景嘅自住客同退休人士。",
  },
  "lido-garden": {
    ...estateSeoIdentity("lido-garden"),
    developer: "",
    yearLabel: "1988",
    phases: 0,
    totalUnits: 1392,
    areaLabel: "",
    title: "麗都花園 Lido Garden 深井｜1,392 伙放盤、租盤",
    description:
      "麗都花園（Lido Garden）1988 年落成、約 1,392 伙，深井青山公路臨海，晉誠地產地舖就在樓下。放盤、租盤、成交數據齊。C-018613。",
    intro:
      "麗都花園（Lido Garden）位於深井青山公路深井段，1988 年落成，提供約 1,392 個單位，是深井其中一個最早期嘅臨海屋苑，亦係晉誠地產門市所在地。",
    fit: "預算入門嘅上車客、想要方便生活圈嘅租客、收租投資者。",
  },
  "hoi-wan-hin": {
    ...estateSeoIdentity("hoi-wan-hin"),
    title: "海雲軒 Anglers' Bay 深井｜2004 年兩座海景放盤",
    description:
      "海雲軒（Anglers' Bay）青山公路 18A 號，信和／嘉華 2004 年兩座住宅，實用 469 至 1,427 呎。放盤、成交、62 校網一頁睇晒。C-018613。",
  },
  "tai-wah-hin": {
    ...estateSeoIdentity("tai-wah-hin"),
    title: "帝華軒 Royal Sea Crest 青龍頭｜浪翠園五期 168 伙",
    description:
      "帝華軒（Royal Sea Crest）即浪翠園五期，新鴻基 1997 年建、168 伙，實用 1,056 至 1,086 呎大三房。放盤、成交、62 校網齊全。C-018613。",
  },
  "hoi-wan-toi": {
    ...estateSeoIdentity("hoi-wan-toi"),
    title: "海韻臺 Rhine Terrace 深井｜單幢 212 伙海景放盤",
    description:
      "海韻臺（Rhine Terrace）青山公路深井段 28 號，1992 年單幢 212 伙，實用 598 至 1,487 呎，與海韻花園是兩個屋苑。放盤成交即查。C-018613。",
  },
  "chun-wong-kui": {
    ...estateSeoIdentity("chun-wong-kui"),
    title: "縉皇居 Ocean Pointe 深井｜嘉里 558 伙高層海景",
    description:
      "縉皇居（Ocean Pointe）深慈街 8 號，嘉里建設 2000 年 3 座 558 伙，實用 653 至 1,609 呎高層海景。放盤成交及 62 校網資料齊。C-018613。",
  },
  "lung-tang-kok": {
    ...estateSeoIdentity("lung-tang-kok"),
    title: "龍騰閣 Lung Tang Court 青龍頭｜48 伙千七呎大單位",
    description:
      "龍騰閣（Lung Tang Court）青山公路青龍頭段 88–90 號，1981 年落成，僅 48 伙，實用 1,743 至 1,958 呎，低密度大單位放盤成交。C-018613。",
  },
  "mun-ming-shan": {
    ...estateSeoIdentity("mun-ming-shan"),
    title: "滿名山 The Bloomsway 掃管笏｜嘉里 1,100 伙洋房分層",
    description:
      "滿名山（The Bloomsway）青盈路，嘉里建設 2017 年落成、約 1,100 伙，實用 308 至 2,877 呎，分層連洋房。放盤成交及 71 校網即查。C-018613。",
  },
  "wong-gam-hoi-ngon": {
    ...estateSeoIdentity("wong-gam-hoi-ngon"),
    title: "香港黃金海岸 Gold Coast 青山灣｜五期 2,168 伙放盤",
    description:
      "香港黃金海岸（Gold Coast）青山灣段 1 號，信和 1990 年起五期 2,168 伙，實用 476 至 2,833 呎，會所商場酒店齊。放盤成交隨時問。C-018613。",
  },
  "oi-kam-hoi-ngon": {
    ...estateSeoIdentity("oi-kam-hoi-ngon"),
    title: "愛琴海岸 Aegean Coast 掃管笏｜七座 1,624 伙兩三房",
    description:
      "愛琴海岸（Aegean Coast）管青路 2 號，2002 年 7 座 1,624 伙，實用 490 至 811 呎兩至三房為主。放盤、成交、71 校網一次過睇。C-018613。",
  },
  "tai-yu": {
    ...estateSeoIdentity("tai-yu"),
    title: "帝御 The Royale 青山灣｜2022 年三期 1,782 伙放盤",
    description:
      "帝御（The Royale）青山灣段 8 號，2022 年落成，金灣、星濤、嵐天三期共 1,782 伙，實用 184 至 1,376 呎。三期放盤成交比較。C-018613。",
  },
  "wong-gam-hoi-waan": {
    ...estateSeoIdentity("wong-gam-hoi-waan"),
    title: "黃金海灣 Gold Coast Bay 青山灣｜2025 年 1,323 伙",
    description:
      "黃金海灣（Gold Coast Bay）青山灣段 18 號，2025 年落成，意嵐、珀岸兩期共 1,323 伙，實用 182 至 1,329 呎新盤源，WhatsApp 即問。C-018613。",
  },
  "sing-tai": {
    ...estateSeoIdentity("sing-tai"),
    title: "星堤 Avignon 掃管笏｜新鴻基 459 伙分層洋房放盤",
    description:
      "星堤（Avignon）管翠路 1 號，新鴻基 2011 年落成、459 伙，實用 554 呎起，低密度分層連洋房。放盤、成交、71 校網一次睇齊。C-018613。",
  },
  "seong-yuen": {
    ...estateSeoIdentity("seong-yuen"),
    title: "上源 Le Pont 掃管笏｜萬科 1,154 伙分層洋房放盤",
    description:
      "上源（Le Pont）掃管笏路 99 號，萬科香港 2020 年落成、1,154 伙，實用 321 至 4,880 呎，一房至大洋房。放盤成交連 71 校網。C-018613。",
  },
  "the-carmel": {
    ...estateSeoIdentity("the-carmel"),
    title: "The Carmel 大欖／掃管笏｜永泰 178 伙洋房分層放盤",
    description:
      "The Carmel 青山公路大欖段 168 號，永泰地產 2019 年落成、僅 178 伙，實用 260 至 3,998 呎，細戶連獨立屋。放盤成交即時查詢。C-018613。",
  },
  "oma-oma": {
    ...estateSeoIdentity("oma-oma"),
    title: "OMA OMA 掃管笏｜2021 年四座 466 伙放盤、成交",
    description:
      "OMA OMA 掃管笏路 108 號，永泰地產 2021 年 4 座 466 伙，實用 254 至 1,659 呎，開放式至家庭戶。放盤、成交、71 校網。C-018613。",
  },
  "lin-shan": {
    ...estateSeoIdentity("lin-shan"),
    title: "漣山 The Hillgrove 小欖｜216 伙低密度大單位放盤",
    description:
      "漣山（The Hillgrove）青發里 9 號，2002 年落成、216 伙，實用 630 至 1,653 呎，小欖低密度大單位。放盤及成交紀錄一次過睇。C-018613。",
  },
  "long-tou-waan": {
    ...estateSeoIdentity("long-tou-waan"),
    title: "浪濤灣 Aqua Blue 小欖｜南豐 242 伙海景洋房放盤",
    description:
      "浪濤灣（Aqua Blue）青發街 28 號，南豐 2002 年落成、242 伙，實用 615 至 2,282 呎，海景分層連洋房，睇樓即約。C-018613。",
  },
  "tai-tou-waan": {
    ...estateSeoIdentity("tai-tou-waan"),
    title: "帝濤灣 Palatial Coast 小欖｜新鴻基兩期 856 伙",
    description:
      "帝濤灣（Palatial Coast）小欖村路 2 號，新鴻基 1999 年兩期 9 座 856 伙，實用 670 呎起海景家庭戶。兩期放盤成交對比。C-018613。",
  },
};

/**
 * Derived from estate-registry.ts's `aliases` field (DR-10) rather than a
 * second hand-maintained alias list. Unused elsewhere in this codebase today
 * (confirmed by a repo-wide grep) but kept exported for parity with the
 * pre-refactor API.
 */
export const estateAliases: Record<string, keyof typeof estateSeo> = Object.fromEntries(
  (Object.keys(estateSeo) as Array<keyof typeof estateSeo>).flatMap((slug) =>
    getEstateEntry(slug).aliases.map((alias) => [alias, slug] as const),
  ),
);
