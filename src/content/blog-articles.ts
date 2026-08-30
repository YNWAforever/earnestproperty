/**
 * Blog article content model (P5e1). Every fact in an article's `sections`
 * must already be established elsewhere in this codebase -- castle-peak-road.ts
 * (corridor/transport/school-net text), school-nets.ts (structured school-net
 * data), or estate-registry.ts (which estates are real and published). Numeric
 * estate facts (avg PSF, total units, year completed, developer) are never
 * hand-typed here -- they're fetched live via fetchEstateBySlug() at render
 * time (see blog_.$slug.tsx's loader + BlogEstateComparisonTable), so they can
 * never go stale or be wrong.
 *
 * `author` is an organizational byline ("晉誠地產編輯團隊"), matching this
 * project's existing Organization-as-author convention (blog_.$slug.tsx's own
 * JSON-LD already credits SITE_NAME, not a named writer) -- there is no
 * existing named-author/reviewer convention anywhere in this codebase to
 * follow instead. `reviewer` stays `null` until a named human actually
 * reviews an article; the UI hides the reviewer line entirely when null,
 * the same "hide, don't fabricate" discipline this project applies to every
 * other unverified fact, applied here to authorship claims.
 */
import { castlePeakRoadSegments } from "./castle-peak-road.ts";
import { estateRegistry } from "./estate-registry.ts";
import { shamTsengSchoolNet } from "./school-nets.ts";

export const BLOG_CATEGORIES = [
  "買樓攻略",
  "租樓攻略",
  "屋苑比較",
  "成交分析",
  "社區生活",
  "市場評論",
] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export type BlogArticleSection = { heading: string; paragraphs: readonly string[] };

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
  /** Estate slugs (must resolve in estate-registry.ts) to render as a live
   * comparison table -- see blog_.$slug.tsx's loader. */
  compareEstateSlugs?: readonly string[];
  links: readonly { href: string; label: string }[];
};

export const EDITORIAL_AUTHOR = "晉誠地產編輯團隊";

const shamTsengSegment = castlePeakRoadSegments.find((segment) => segment.slug === "sham-tseng");
if (!shamTsengSegment) {
  throw new Error("blog-articles.ts expects castle-peak-road.ts's sham-tseng segment to exist");
}

function estateDisplayName(slug: string): string {
  const entry = estateRegistry.find((item) => item.slug === slug);
  return entry ? entry.nameZh : slug;
}

export const blogArticles: readonly BlogArticleMeta[] = [
  {
    slug: "sham-tseng-buying-guide-2026",
    title: "深井買樓全攻略 2026：5 大屋苑、交通、校網一次睇晒",
    excerpt:
      "深井買樓睇呢篇就夠：碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園基本資料實時比較，連交通同校網資料都一次過講清楚。",
    category: "買樓攻略",
    readingMinutes: 8,
    author: EDITORIAL_AUTHOR,
    reviewer: null,
    sourcesNote: "屋苑基本資料實時來自本網站屋苑資料庫，與 /estate 頁面同步；交通及校網資料來自本網站深井/青山公路地區頁。",
    answerSummary:
      "深井五大屋苑（碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園）都在同一 62 校網及交通網絡內，實際呎價、單位數同落成年份請參考下方實時比較表；校網派位以教育局最新公布為準。",
    sections: [
      {
        heading: "深井樓市概覽",
        paragraphs: [...shamTsengSegment.zoneSummary, shamTsengSegment.buyerFit],
      },
      {
        heading: "五大屋苑一覽",
        paragraphs: [
          "深井五大屋苑各有唔同定位：" +
            shamTsengSegment.featuredEstates.slice(0, 5).join("、") +
            "。詳細呎價、單位數、落成年份同發展商，請睇下方實時比較表 —— 呢啲資料同 /estate 頁面同一個資料庫，唔會過時。",
          "五個屋苑戶型同物業年齡有分別，適合嘅買家都唔一樣：想揀邊個，建議先睇比較表嘅落成年份同單位數，再配合自己預算同對會所、海景嘅要求。",
        ],
      },
      {
        heading: "交通",
        paragraphs: [shamTsengSegment.transport],
      },
      {
        heading: "校網",
        paragraphs: [
          `深井屬荃灣 ${shamTsengSchoolNet.netCode} 校網。${shamTsengSegment.schoolNet}`,
        ],
      },
    ],
    compareEstateSlugs: ["bellagio", "hong-kong-garden", "sea-crest-villa", "lido-garden", "rhine-garden"],
    links: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/bellagio", label: "碧堤半島放盤" },
      { href: "/listings?deal=all&page=1", label: "搜尋深井放盤" },
    ],
  },
  {
    slug: "bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
    title: `${estateDisplayName("bellagio")} vs ${estateDisplayName("sea-crest-villa")} vs ${estateDisplayName("hong-kong-garden")}：深井三大屋苑點揀好？`,
    excerpt: "碧堤半島、浪翠園、豪景花園三大深井屋苑點揀？實時比較呎價、單位數、落成年份同發展商，再睇邊種買家最啱邊個屋苑。",
    category: "屋苑比較",
    readingMinutes: 6,
    author: EDITORIAL_AUTHOR,
    reviewer: null,
    sourcesNote: "屋苑基本資料實時來自本網站屋苑資料庫，與 /estate 頁面同步。",
    answerSummary:
      "三個屋苑都喺深井 62 校網範圍內，實際呎價、單位數、落成年份同發展商請睇下方實時比較表；點揀主要睇預算、對會所同海景嘅要求，而非單一「邊個最好」嘅答案。",
    sections: [
      {
        heading: "三大屋苑背景",
        paragraphs: [
          "碧堤半島、浪翠園、豪景花園都係深井海景大型屋苑，但規模、會所同物業年齡有分別。實際落成年份、單位數同發展商，請睇下方實時比較表 —— 邊個「較新」、邊個單位數較多，以表格數字為準，唔靠印象判斷。",
          shamTsengSegment.buyerFit,
        ],
      },
      {
        heading: "點揀？睇你嘅優先次序",
        paragraphs: [
          "如果預算充足、想要較強會所同管理，可以先由碧堤半島開始了解；如果想喺海景大屋苑入面搵較多盤源同彈性選擇，浪翠園同豪景花園都值得比較——但呢個係主觀嘅買家取向框架，唔係客觀事實，實際揀樓仲要親身睇盤同比較實際叫價。",
          "三個屋苑都響深井 62 校網範圍內，交通配套亦大致相同（見「深井買樓全攻略 2026」一文），所以校網同交通唔係呢三個屋苑之間嘅主要分野，比較重點應該放喺屋苑本身嘅規模、會所同呎價。",
        ],
      },
    ],
    compareEstateSlugs: ["bellagio", "sea-crest-villa", "hong-kong-garden"],
    links: [
      { href: "/estate/bellagio", label: `${estateDisplayName("bellagio")} Bellagio` },
      { href: "/estate/sea-crest-villa", label: `${estateDisplayName("sea-crest-villa")} Sea Crest Villa` },
      { href: "/estate/hong-kong-garden", label: `${estateDisplayName("hong-kong-garden")} Hong Kong Garden` },
      { href: "/blog/sham-tseng-buying-guide-2026", label: "深井買樓全攻略 2026" },
    ],
  },
] as const;
