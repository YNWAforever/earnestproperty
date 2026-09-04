import { getEstateEntry } from "./estate-registry.ts";

export const SITE_URL = "https://earnestproperty.vercel.app";
export const SITE_NAME = "晉誠地產 Earnest Property";
export const SITE_OG_IMAGE = `${SITE_URL}/og-cover.jpg`;
export const SITE_LOGO_URL = `${SITE_URL}/logo-mark.png`;
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
      ...(input.ogImage ? [{ property: "og:image", content: input.ogImage }] : []),
      ...(input.noindex ? [{ name: "robots", content: "noindex,follow" }] : []),
    ],
    links: [canonicalLink(input.path)],
  };
}

export const pageSeo = {
  home: {
    path: "/",
    title: "晉誠地產 Earnest Property｜深井 青山公路 汀九買樓租樓",
    description:
      "深井、青山公路、汀九買樓租樓專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園及汀九筍盤，即時 WhatsApp 查詢。持牌代理 C-018613。",
  },
  listings: {
    path: "/listings",
    title: "深井放盤搜尋｜買樓租樓全部真盤 — 晉誠地產",
    description:
      "一站搜尋深井、汀九及青山公路在售及放租盤。海景、連車位、連租約收租盤齊全，WhatsApp 即時預約睇樓。C-018613。",
  },
  castlePeakRoad: {
    path: "/castle-peak-road",
    title: "青山公路 Castle Peak Road 樓盤｜油柑頭、汀九、深井、青龍頭",
    description:
      "青山公路沿線買樓租樓指南：油柑頭、汀九、深井、青龍頭、小欖、掃管笏及三聖三個生活圈，即時全部真盤查詢。晉誠地產 C-018613。",
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
      "荃灣買樓租樓指南：港鐵荃灣線、荃灣西、大型商場、校網一覽，連深井青龍頭比較。晉誠地產全部真盤 C-018613。",
  },
  tingKau: {
    // Canonical lives on the Castle Peak Road corridor page; /district/ting-kau
    // is a legacy URL that redirects there (see vercel.ts and the route below).
    path: "/castle-peak-road/ting-kau",
    title: "汀九 Ting Kau 樓盤｜青山公路低密度海景別墅、洋房",
    description:
      "青山公路汀九段樓盤一覽：觀海別墅、嘉御龍庭、汀九別墅等低密度海景別墅洋房，介乎荃灣與深井，62 校網。晉誠地產 C-018613。",
  },
  blog: {
    path: "/blog",
    title: "深井 青山公路 汀九樓市分析 Blog｜晉誠地產",
    description:
      "深井買樓租樓攻略、屋苑比較、校網交通、成交走勢分析。由深井 hyperlocal 專家撰寫，助你睇通深井樓市。",
  },
  blogEditorialStandards: {
    path: "/blog/editorial-standards",
    title: "編採及事實查核標準｜晉誠地產 Blog",
    description: "晉誠地產 Blog 文章的資料來源、審閱制度及事實查核標準說明。",
  },
  about: {
    path: "/about",
    title: "關於晉誠地產 Earnest Property｜深井、青山公路物業專家",
    description:
      "晉誠地產（C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園等核心屋苑。全部真盤、即時回覆、持牌可靠。",
  },
  contact: {
    path: "/contact",
    title: "聯絡晉誠地產｜深井睇樓預約．WhatsApp 即時查詢",
    description:
      "WhatsApp 即時聯絡晉誠地產持牌代理，深井麗都花園地舖門市，歡迎預約睇樓及樓盤估價。",
  },
  privacy: {
    path: "/privacy",
    title: "私隱政策｜晉誠地產 Earnest Property",
    description: "晉誠地產個人資料收集及使用政策，符合香港《個人資料（私隱）條例》(PDPO) 要求。",
  },
  disclaimer: {
    path: "/disclaimer",
    title: "免責聲明｜晉誠地產 Earnest Property",
    description: "晉誠地產網站樓盤資訊及內容的免責聲明。",
  },
  terms: {
    path: "/terms",
    title: "使用條款｜晉誠地產 Earnest Property",
    description: "使用晉誠地產網站的條款及細則。",
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
      "豪景花園（Hong Kong Garden）華懋大型屋苑，青龍頭背山面海，2 至 3 房盤源。成交呎價、FAQ、即時 WhatsApp 查詢。",
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
    title: "海韻花園 Rhine Garden 深井｜海景放盤、成交、租盤",
    description:
      "海韻花園（Rhine Garden）深井臨海屋苑，無敵汀九橋海景。放盤、成交、租務一覽，WhatsApp 即時預約睇樓。C-018613。",
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
    title: "麗都花園 Lido Garden 深井｜放盤、租盤、成交呎價",
    description:
      "麗都花園（Lido Garden）深井青山公路臨海屋苑，鄰近深井燒鵝美食圈。放盤、租盤、成交數據，持牌代理 C-018613。",
    intro:
      "麗都花園（Lido Garden）位於深井青山公路深井段，1988 年落成，提供約 1,392 個單位，是深井其中一個最早期嘅臨海屋苑，亦係晉誠地產門市所在地。",
    fit: "預算入門嘅上車客、想要方便生活圈嘅租客、收租投資者。",
  },
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
  "hoi-wan-toi": {
    ...estateSeoIdentity("hoi-wan-toi"),
    title: "海韻臺 Rhine Terrace 深井｜放盤、成交、海景、單幢住宅",
    description:
      "海韻臺（Rhine Terrace）深井屋苑專頁：放盤、成交、海景、單幢住宅、交通、62 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "chun-wong-kui": {
    ...estateSeoIdentity("chun-wong-kui"),
    title: "縉皇居 Ocean Pointe 深井｜放盤、成交、高層海景、戶型",
    description:
      "縉皇居（Ocean Pointe）深井屋苑專頁：放盤、成交、高層海景、戶型、交通、62 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "lung-tang-kok": {
    ...estateSeoIdentity("lung-tang-kok"),
    title: "龍騰閣 Lung Tang Court 青龍頭｜放盤、成交、大單位、低密度",
    description:
      "龍騰閣（Lung Tang Court）青龍頭屋苑專頁：放盤、成交、大單位、低密度、交通、62 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "mun-ming-shan": {
    ...estateSeoIdentity("mun-ming-shan"),
    title: "滿名山 The Bloomsway 掃管笏｜分層、洋房、放盤成交、戶型",
    description:
      "滿名山（The Bloomsway）掃管笏屋苑專頁：分層、洋房、放盤成交、戶型、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "wong-gam-hoi-ngon": {
    ...estateSeoIdentity("wong-gam-hoi-ngon"),
    title: "香港黃金海岸 Hong Kong Gold Coast 青山灣／掃管笏｜五期放盤、成交、海景、生活配套",
    description:
      "香港黃金海岸（Hong Kong Gold Coast）青山灣／掃管笏屋苑專頁：五期放盤、成交、海景、生活配套、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "oi-kam-hoi-ngon": {
    ...estateSeoIdentity("oi-kam-hoi-ngon"),
    title: "愛琴海岸 Aegean Coast 掃管笏｜兩三房放盤、成交、會所、戶型",
    description:
      "愛琴海岸（Aegean Coast）掃管笏屋苑專頁：兩三房放盤、成交、會所、戶型、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "tai-yu": {
    ...estateSeoIdentity("tai-yu"),
    title: "帝御 The Royale 青山灣／掃管笏｜金灣、星濤、嵐天三期放盤成交",
    description:
      "帝御（The Royale）青山灣／掃管笏屋苑專頁：金灣、星濤、嵐天三期放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "wong-gam-hoi-waan": {
    ...estateSeoIdentity("wong-gam-hoi-waan"),
    title: "黃金海灣 Gold Coast Bay 青山灣｜意嵐、珀岸兩期放盤成交",
    description:
      "黃金海灣（Gold Coast Bay）青山灣屋苑專頁：意嵐、珀岸兩期放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "sing-tai": {
    ...estateSeoIdentity("sing-tai"),
    title: "星堤 Avignon 掃管笏｜分層、洋房、低密度放盤成交",
    description:
      "星堤（Avignon）掃管笏屋苑專頁：分層、洋房、低密度放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "seong-yuen": {
    ...estateSeoIdentity("seong-yuen"),
    title: "上源 Le Pont 掃管笏｜分層、洋房、1,154伙放盤成交",
    description:
      "上源（Le Pont）掃管笏屋苑專頁：分層、洋房、1,154伙放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "the-carmel": {
    ...estateSeoIdentity("the-carmel"),
    title: "The Carmel 大欖／掃管笏｜分層、洋房、低密度放盤成交",
    description:
      "The Carmel 大欖／掃管笏屋苑專頁：分層、洋房、低密度放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "oma-oma": {
    ...estateSeoIdentity("oma-oma"),
    title: "OMA OMA 掃管笏｜放盤、成交、細戶、家庭戶",
    description:
      "OMA OMA 掃管笏屋苑專頁：放盤、成交、細戶、家庭戶、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "lin-shan": {
    ...estateSeoIdentity("lin-shan"),
    title: "漣山 The Hillgrove 小欖｜低密度、大單位、放盤成交",
    description:
      "漣山（The Hillgrove）小欖屋苑專頁：低密度、大單位、放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "long-tou-waan": {
    ...estateSeoIdentity("long-tou-waan"),
    title: "浪濤灣 Aqua Blue 小欖｜分層、洋房、海景放盤成交",
    description:
      "浪濤灣（Aqua Blue）小欖屋苑專頁：分層、洋房、海景放盤成交、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
  },
  "tai-tou-waan": {
    ...estateSeoIdentity("tai-tou-waan"),
    title: "帝濤灣 Palatial Coast 小欖／大欖｜兩期放盤、成交、海景、家庭戶",
    description:
      "帝濤灣（Palatial Coast）小欖／大欖屋苑專頁：兩期放盤、成交、海景、家庭戶、交通、71 校網、最新放盤、成交及業主估價。晉誠地產 C-018613。",
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
