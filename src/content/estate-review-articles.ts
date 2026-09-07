import { findCastlePeakRoadSegmentByDistrictSlug } from "./castle-peak-road.ts";
import { estatePageContent, type EstatePageContent } from "./estate-pages.ts";
import { estateRegistry, findComparableEstates, getEstateEntry } from "./estate-registry.ts";
import { getSchoolNet, schoolNetCodeForDistrict } from "./school-nets.ts";
import { DESCRIPTION_MAX_UNITS, displayWidth, truncateToWidth } from "./seo-budget.js";
import type { BlogArticleMeta } from "./blog-articles.ts";

/**
 * The 屋苑開箱 article set behind `/estate-reviews`'s 最新屋苑文章 section.
 *
 * ## Why these are derived, not hand-typed
 *
 * `/estate-reviews` renders `fetchPublishedArticlesByCategory("屋苑開箱")` and
 * — unlike `/blog`, which falls back to `blogArticles` — had no static
 * fallback, while no migration has ever seeded an `articles` row. So the
 * section rendered its empty state on a site with 22 real estate pages behind
 * it.
 *
 * Every paragraph below is assembled from copy that is already established
 * elsewhere in this repo, which is the rule blog-articles.ts's own header
 * sets: `estatePageContent`'s buyer-facing prose (overview / buyerFit / pros /
 * watchouts / transportLifestyle / faqs), `estateRegistry`'s identity and
 * grouping fields, `castlePeakRoadSegments`' transport copy, and the school-net
 * *codes* from school-nets.ts. Nothing here states a developer, a year, a unit
 * count or an area — those live in the database and reach the reader through
 * the live comparison table that `compareEstateSlugs` renders, exactly as the
 * two flagship articles already do, so they can never go stale or be wrong.
 *
 * Three fields are deliberately NOT used:
 *
 * - `estatePageContent.marketNote` is internal data-handling guidance ("成交圖表
 *   必須提供產品類型", "MLS alias 不可互相吞併"), not reader-facing copy.
 * - `schoolNets[*].primarySchools` is empty on purpose and must stay that way
 *   until an Education Bureau register is supplied (see school-nets.ts). The
 *   articles cite the net code and say plainly that no school list is
 *   published, rather than naming schools from an unsourced list.
 * - `estateSeo`'s own title/description, so an article and its estate's meta
 *   description are not the same sentence.
 *
 * ## Why the groupings are computed
 *
 * A multi-estate article makes a factual claim by grouping ("these are the
 * low-density ones"). `estatesMentioning()` derives each group from the
 * estates' own published prose, so a grouping cannot drift away from what the
 * estate pages actually say, and an estate added to the registry joins the
 * right articles without anyone remembering to update a hand-typed list.
 */

/** Article titles get `｜晉誠地產` appended by blog_.$slug.tsx's head(), which
 * trims to the 60-unit SERP budget. Authoring to 50 leaves room for the suffix
 * so that trim is never what a reader sees. */
const ARTICLE_TITLE_MAX_UNITS = 50;

type EstateReviewArticle = Omit<BlogArticleMeta, "author" | "reviewer">;

function content(slug: string): EstatePageContent {
  const entry = estatePageContent[slug as keyof typeof estatePageContent];
  if (!entry) {
    throw new Error(`estate-review-articles.ts: no estatePageContent for "${slug}"`);
  }
  return entry;
}

/** `深井 / 青山公路` and `小欖／大欖` both appear in the registry; the first
 * segment is the estate's primary area label. */
function primaryArea(slug: string): string {
  const label = getEstateEntry(slug).locationLabelZh;
  if (!label) return "青山公路";
  return label.split(/[／/]/)[0].trim();
}

/** A positioning clause with its trailing full stop and any following
 * qualifier removed, for use inside a title. */
function leadClause(text: string): string {
  return text
    .replace(/。\s*$/, "")
    .split("，")[0]
    .trim();
}

/** The display name, with the English name only when it adds something --
 * `The Carmel` is its own nameEn and would otherwise render twice. */
function displayName(slug: string): string {
  const { nameZh, nameEn } = content(slug);
  return nameEn && nameEn !== nameZh ? `${nameZh}（${nameEn}）` : nameZh;
}

function shortName(slug: string): string {
  return content(slug).nameZh;
}

/**
 * `opening` + `closing`, with as many of `optional` as fit between them.
 *
 * `closing` is always included, and is always this article's own subject matter
 * (its member estates' names, or its estate's own watchouts). That is what
 * keeps 50 derived excerpts from sharing a closing statement -- the rule
 * seo-copy.test.mjs enforces across every description on the site. Appending
 * `closing` last-but-guaranteed rather than merely last is the point: a
 * long-named article would otherwise drop it and fall back to a shared clause.
 */
function excerpt(opening: string, optional: readonly string[], closing: string): string {
  let text = opening;
  for (const clause of optional) {
    if (displayWidth(text + clause + closing) <= DESCRIPTION_MAX_UNITS) text += clause;
  }
  return truncateToWidth(text + closing, DESCRIPTION_MAX_UNITS);
}

/** `base`, plus `tail` when the pair fits the snippet budget. Unlike
 * `excerpt()` the mandatory half comes first, so the copy reads in its natural
 * order. */
function excerptWithOptionalTail(base: string, tail: string): string {
  if (displayWidth(base + tail) <= DESCRIPTION_MAX_UNITS) return base + tail;
  return truncateToWidth(base, DESCRIPTION_MAX_UNITS);
}

function title(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (displayWidth(candidate) <= ARTICLE_TITLE_MAX_UNITS) return candidate;
  }
  return truncateToWidth(candidates[candidates.length - 1], ARTICLE_TITLE_MAX_UNITS);
}

/** The school-net paragraph, or `null` for a district with no known net --
 * never a guessed one. */
function schoolNetParagraph(slugs: readonly string[]): string | null {
  const codes = [
    ...new Set(
      slugs
        .map((slug) => schoolNetCodeForDistrict(getEstateEntry(slug).districtSlug))
        .filter((code): code is string => Boolean(code)),
    ),
  ].sort();
  if (codes.length === 0) return null;
  const described = codes
    .map((code) => {
      const net = getSchoolNet(code);
      return net ? `${net.netCode} 校網（${net.districtLabel}）` : `${code} 校網`;
    })
    .join("、");
  return (
    `以上屋苑分別屬 ${described}。本網站唔會列出小學名單 —— ` +
    `教育局《小一入學統一派位選校名冊》來源未確認，寧願唔寫都好過寫錯；` +
    `實際派位以教育局最新公布為準。`
  );
}

/** Corridor transport copy for the districts these estates sit in, deduped. */
function corridorTransport(slugs: readonly string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const slug of slugs) {
    const segment = findCastlePeakRoadSegmentByDistrictSlug(getEstateEntry(slug).districtSlug);
    if (segment && !seen.has(segment.transport)) {
      seen.add(segment.transport);
      lines.push(segment.transport);
    }
  }
  return lines;
}

/**
 * A sentence with any clause that addresses *the page* rather than the reader
 * removed.
 *
 * Most of the "應／必須" clauses in estatePageContent are real buyer advice
 * ("成交量較少，應把較長時段成交…一併比較") and belong in an article. A few
 * address whoever builds the page instead -- 「頁面必須按期數標示」,
 * 「新路線或班次必須引用最新營運資料」 -- and reading those in an article makes
 * no sense to a buyer. They are clause-level, so they are dropped here rather
 * than by rewriting the estate pages' own copy; the tell is that they talk
 * about 頁面 or about which data to cite.
 */
const PAGE_ADDRESSED = /頁面|引用最新營運資料/;

function readerCopy(text: string): string {
  const clauses = text
    .split("；")
    .map((clause) =>
      // Some of these sit as a trailing comma-clause rather than their own
      // semicolon-clause ("…至較大家庭戶，頁面必須按期數標示。"), so both
      // delimiters are filtered.
      clause
        .split("，")
        .filter((part) => !PAGE_ADDRESSED.test(part))
        .join("，")
        .trim(),
    )
    .filter((clause) => clause && !PAGE_ADDRESSED.test(clause));
  if (clauses.length === 0) return text;
  const joined = clauses.join("；").replace(/[，；]+$/, "");
  return /[。！？]$/.test(joined) ? joined : `${joined}。`;
}

/** buyerFit entries already end in 。, so joining them with 、 or ； produced
 * 「…自住客。；在深井…」. */
function joinSentences(items: readonly string[]): string {
  return items.map((item) => item.replace(/。\s*$/, "")).join("；") + "。";
}

function faqParagraphs(faqs: EstatePageContent["faqs"]): string[] {
  return faqs.map((faq) => `問：${faq.question.trim()} 答：${readerCopy(faq.answer.trim())}`);
}

/** Up to `limit` estates whose own published prose mentions `keyword`. The
 * grouping claim an attribute article makes is therefore traceable to the
 * estate pages rather than to an editor's memory. */
function estatesMentioning(keyword: string): string[] {
  return Object.entries(estatePageContent)
    .filter(([, entry]) =>
      [
        entry.heroPositioning,
        ...entry.overview,
        ...entry.buyerFit,
        ...entry.pros,
        ...entry.watchouts,
        entry.transportLifestyle,
      ]
        .join(" ")
        .includes(keyword),
    )
    .map(([slug]) => slug);
}

/** The comparison table fetches one row per slug, so this stays at the 5 the
 * flagship guide already uses. */
function compareSlugs(slugs: readonly string[]): string[] {
  return slugs.slice(0, 5);
}

function estateLinks(slugs: readonly string[]) {
  return slugs.slice(0, 4).map((slug) => ({
    href: `/estate/${slug}`,
    label: `${shortName(slug)}放盤同成交`,
  }));
}

// --- One article per estate ------------------------------------------------

function singleEstateArticle(slug: string): EstateReviewArticle {
  const c = content(slug);
  const area = primaryArea(slug);
  const comparables = findComparableEstates(slug, 2).map((entry) => entry.slug);
  const netParagraph = schoolNetParagraph([slug]);
  const transport = corridorTransport([slug]);

  return {
    slug: `${slug}-estate-review`,
    title: title(
      `${c.nameZh} ${c.nameEn} 開箱：${leadClause(c.heroPositioning)}`,
      `${c.nameZh}開箱：${leadClause(c.heroPositioning)}`,
      `${c.nameZh}開箱｜${area}屋苑`,
    ),
    // The estate's own selling points are mandatory and its watchouts are the
    // optional tail, not the other way round: a SERP snippet that opens on
    // positioning and then lists only what to watch out for reads as a warning
    // notice. Both halves are estate-specific, so either tail stays unique.
    excerpt: excerptWithOptionalTail(
      `${displayName(slug)}${c.heroPositioning}開箱睇${c.pros.join("、")}。`,
      `睇樓前要留意${c.watchouts.join("、")}。`,
    ),
    category: "屋苑開箱",
    readingMinutes: 6,
    sourcesNote:
      `屋苑定位、優點及注意事項來自本網站 /estate/${slug} 屋苑專頁內容；` +
      `呎價、單位數、落成年份及發展商實時來自本網站屋苑資料庫，與屋苑專頁同一來源；` +
      `校網只列教育局校網編號，不列小學名單。`,
    answerSummary:
      `${c.nameZh}${c.heroPositioning}買家最常比較嘅係${c.pros.join("、")}，` +
      `而要留意嘅係${c.watchouts[0]}。實際呎價、單位數同落成年份請睇下方實時比較表 —— ` +
      `呢啲數字同 /estate/${slug} 同一個資料庫，唔會過時。`,
    sections: [
      {
        heading: `${c.nameZh}開箱概覽`,
        paragraphs: c.overview.map(readerCopy),
      },
      {
        heading: "邊類買家啱買？",
        paragraphs: [
          `屋苑專頁列出三類買家定位：${joinSentences(c.buyerFit)}`,
          "呢個係買家取向框架，唔係客觀事實 —— 實際啱唔啱，仲要親身睇盤同比較實際叫價。",
        ],
      },
      {
        heading: "優點同要留意位",
        paragraphs: [
          `公開屋苑資料同屋苑定位歸納出三個賣點：${c.pros.join("、")}。`,
          `同時要留意：${c.watchouts.join("、")}。呢幾點都要睇樓時親身核實，唔好只靠圖片同平面圖。`,
        ],
      },
      {
        heading: "交通同生活配套",
        paragraphs: [readerCopy(c.transportLifestyle), ...transport],
      },
      ...(netParagraph ? [{ heading: "校網", paragraphs: [netParagraph] }] : []),
      {
        heading: "常見問題",
        paragraphs: faqParagraphs(c.faqs),
      },
      {
        heading: "同區屋苑實時比較",
        paragraphs: [
          comparables.length
            ? `下方比較表同時列出${comparables.map(shortName).join("同")}，方便同${c.nameZh}放埋一齊睇呎價、單位數同落成年份。`
            : `下方比較表列出${c.nameZh}嘅實時呎價、單位數同落成年份。`,
        ],
      },
    ],
    compareEstateSlugs: compareSlugs([slug, ...comparables]),
    links: [{ href: `/estate/${slug}`, label: `${c.nameZh}屋苑專頁` }, ...c.relatedLinks],
  };
}

// --- Multi-estate articles -------------------------------------------------

type GroupSpec = {
  slug: string;
  /** Why these estates belong in one article, stated to the reader. */
  premise: string;
  titles: string[];
  /** Opening clause of the excerpt; the member names are appended last so the
   * closing statement is unique to this article. */
  lede: string;
  estateSlugs: readonly string[];
  readingMinutes: number;
};

function groupArticle(spec: GroupSpec): EstateReviewArticle {
  const slugs = spec.estateSlugs;
  const names = slugs.map(shortName);
  const netParagraph = schoolNetParagraph(slugs);
  const transport = corridorTransport(slugs);

  return {
    slug: spec.slug,
    title: title(...spec.titles),
    excerpt: excerpt(
      spec.lede,
      ["逐個睇買家定位、賣點同注意位，再用實時呎價、單位數同落成年份比較。"],
      `今次覆蓋${names.join("、")}。`,
    ),
    category: "屋苑開箱",
    readingMinutes: spec.readingMinutes,
    sourcesNote:
      "各屋苑定位、賣點及注意事項來自本網站對應屋苑專頁內容；" +
      "呎價、單位數、落成年份及發展商實時來自本網站屋苑資料庫；" +
      "校網只列教育局校網編號，不列小學名單。",
    answerSummary:
      `${spec.premise}實際呎價、單位數同落成年份請睇下方實時比較表；` +
      `邊個「最好」冇單一答案，要睇你自己嘅預算、對空間同景觀嘅要求。`,
    sections: [
      {
        heading: "為咩要一齊比較？",
        paragraphs: [spec.premise],
      },
      {
        heading: "逐個屋苑定位",
        paragraphs: slugs.map((slug) => {
          const c = content(slug);
          return `${displayName(slug)}：${c.heroPositioning}賣點係${c.pros.join("、")}；要留意${c.watchouts[0]}。`;
        }),
      },
      {
        heading: "買家定位分野",
        paragraphs: slugs.map((slug) => `${shortName(slug)}：${content(slug).buyerFit[0]}`),
      },
      {
        heading: "交通同生活配套",
        paragraphs: [
          ...new Set(slugs.map((slug) => readerCopy(content(slug).transportLifestyle))),
          ...transport,
        ],
      },
      ...(netParagraph ? [{ heading: "校網", paragraphs: [netParagraph] }] : []),
      {
        heading: "實時數據點睇",
        paragraphs: [
          `下方比較表列出${names.slice(0, 5).join("、")}嘅呎價、單位數、落成年份同發展商。` +
            "呢啲數字同各屋苑專頁同一個資料庫，所以邊個較新、邊個規模較大，以表格為準，唔靠印象判斷。",
        ],
      },
    ],
    compareEstateSlugs: compareSlugs(slugs),
    links: [...estateLinks(slugs), { href: "/estate-reviews", label: "所有屋苑開箱文章" }],
  };
}

/** An area round-up, grouped by the registry's own `locationLabelZh`. */
function areaArticle(
  area: string,
  slug: string,
  estateSlugs: readonly string[],
  premiseTail: string,
): GroupSpec {
  return {
    slug,
    premise: `${estateSlugs.map(shortName).join("、")}都座落${area}一帶，${premiseTail}放埋一齊比較先睇得出分別。`,
    titles: [`${area}屋苑開箱總覽：${estateSlugs.length} 個屋苑逐個比較`, `${area}屋苑開箱總覽`],
    lede: `${area}買樓睇邊個屋苑好？`,
    estateSlugs,
    readingMinutes: 7,
  };
}

/** A head-to-head, always between estates in the same area. */
function versusArticle(a: string, b: string, slug: string, premise: string): GroupSpec {
  const ca = content(a);
  const cb = content(b);
  return {
    slug,
    premise,
    titles: [
      `${ca.nameZh} vs ${cb.nameZh}：點揀好？實時比較`,
      `${ca.nameZh} vs ${cb.nameZh} 開箱比較`,
    ],
    lede: `${ca.nameZh}同${cb.nameZh}都喺${primaryArea(a)}一帶，點揀好？`,
    estateSlugs: [a, b],
    readingMinutes: 5,
  };
}

/** An attribute round-up whose membership is derived from the estates' own
 * published prose, capped so the comparison table stays readable. */
function attributeArticle(
  keyword: string,
  slug: string,
  titleLead: string,
  premiseTail: string,
  limit = 5,
): GroupSpec {
  const estateSlugs = estatesMentioning(keyword).slice(0, limit);
  return {
    slug,
    premise: `以下屋苑嘅公開屋苑資料都提到「${keyword}」：${estateSlugs.map(shortName).join("、")}。${premiseTail}`,
    titles: [`${titleLead}：${estateSlugs.length} 個屋苑開箱比較`, titleLead],
    lede: `想搵${keyword}嘅屋苑？`,
    estateSlugs,
    readingMinutes: 6,
  };
}

const AREA_ARTICLES: GroupSpec[] = [
  areaArticle(
    "深井",
    "sham-tseng-estate-reviews",
    ["bellagio", "sea-crest-villa", "rhine-garden", "lido-garden", "chun-wong-kui"],
    "同屬深井生活圈，交通同校網大致相同，所以分野主要在屋苑規模、會所同海景質素，",
  ),
  areaArticle(
    "青龍頭",
    "tsing-lung-tau-estate-reviews",
    ["hong-kong-garden", "tai-wah-hin", "lung-tang-kok"],
    "由大型屋苑到低密度大單位都有，入場門檻同盤源流通量差異明顯，",
  ),
  areaArticle(
    "掃管笏",
    "so-kwun-wat-estate-reviews",
    ["mun-ming-shan", "oi-kam-hoi-ngon", "sing-tai", "seong-yuen", "oma-oma"],
    "樓齡同產品類型跨度大，由開放式細戶到洋房都有，",
  ),
  areaArticle(
    "青山灣",
    "castle-peak-bay-estate-reviews",
    ["wong-gam-hoi-ngon", "tai-yu", "wong-gam-hoi-waan"],
    "全部臨海並各有期數劃分，名稱亦相近容易混淆，",
  ),
  areaArticle(
    "小欖",
    "siu-lam-estate-reviews",
    ["lin-shan", "long-tou-waan", "tai-tou-waan"],
    "以低密度同較大單位為主，日常出入較依賴自駕或接駁，",
  ),
  areaArticle(
    "大欖",
    "tai-lam-estate-reviews",
    ["the-carmel", "tai-tou-waan"],
    "都以低密度同戶外空間做賣點，但屋苑規模同盤源量差得遠，",
  ),
];

const VERSUS_ARTICLES: GroupSpec[] = [
  versusArticle(
    "bellagio",
    "sea-crest-villa",
    "bellagio-vs-sea-crest-villa",
    "碧堤半島同浪翠園都係深井大型海景屋苑，交通同校網一樣，所以真正嘅分野在會所配套、屋苑規模同入場門檻。",
  ),
  versusArticle(
    "rhine-garden",
    "lido-garden",
    "rhine-garden-vs-lido-garden",
    "海韻花園同麗都花園都係深井臨海屋苑，位置相近、入場門檻都較務實，分別主要在生活圈同海景質素。",
  ),
  versusArticle(
    "hoi-wan-toi",
    "rhine-garden",
    "rhine-terrace-vs-rhine-garden",
    "海韻臺同海韻花園名字相似、位置相近，但係兩個獨立屋苑 —— 成交同放盤都要分開睇，唔可以混埋一齊計平均呎價。",
  ),
  versusArticle(
    "chun-wong-kui",
    "bellagio",
    "ocean-pointe-vs-bellagio",
    "縉皇居同碧堤半島都以深井海景做賣點，一個主打高層開揚景觀，一個主打屋苑規模同會所，換樓客通常會兩個一齊睇。",
  ),
  versusArticle(
    "hoi-wan-hin",
    "chun-wong-kui",
    "anglers-bay-vs-ocean-pointe",
    "海雲軒同縉皇居都喺深井臨海位置，社區規模都較精簡，適合想要海景又唔想住太大型屋苑嘅家庭。",
  ),
  versusArticle(
    "tai-wah-hin",
    "sea-crest-villa",
    "royal-sea-crest-vs-sea-crest-villa",
    "帝華軒係浪翠園五期，但喺本網站係獨立屋苑 —— 成交、放盤同比較表都以各自嘅屋苑資料為準，唔會混合計算平均呎價。",
  ),
  versusArticle(
    "hong-kong-garden",
    "lung-tang-kok",
    "hong-kong-garden-vs-lung-tang-court",
    "豪景花園同龍騰閣都喺青龍頭，一個係大型屋苑、一個係低密度大單位，適合嘅買家完全唔同。",
  ),
  versusArticle(
    "mun-ming-shan",
    "seong-yuen",
    "bloomsway-vs-le-pont",
    "滿名山同上源都係掃管笏大型低密度社區，分層同洋房並存，比較時第一步係先分清產品類型。",
  ),
  versusArticle(
    "sing-tai",
    "mun-ming-shan",
    "avignon-vs-bloomsway",
    "星堤同滿名山都喺掃管笏、都有分層同洋房，但社區規模同私隱度取向唔同，換樓家庭通常會兩個一齊比較。",
  ),
  versusArticle(
    "oi-kam-hoi-ngon",
    "tai-yu",
    "aegean-coast-vs-the-royale",
    "愛琴海岸同帝御都以會所同家庭戶做賣點，一個係成熟屋苑、一個近年落成，樓齡同戶型供應係主要分野。",
  ),
  versusArticle(
    "wong-gam-hoi-ngon",
    "wong-gam-hoi-waan",
    "gold-coast-vs-gold-coast-bay",
    "香港黃金海岸同黃金海灣係兩個唔同屋苑，名字相近但期數、樓齡同配套都唔一樣 —— 搜尋放盤同睇成交時要分清楚。",
  ),
  versusArticle(
    "lin-shan",
    "long-tou-waan",
    "hillgrove-vs-aqua-blue",
    "漣山同浪濤灣都係小欖低密度屋苑，單位較大、環境較靜，分別主要在海景同產品組合。",
  ),
  versusArticle(
    "the-carmel",
    "oma-oma",
    "the-carmel-vs-oma-oma",
    "The Carmel 同 OMA OMA 樓齡都較新，但一個係低密度精品項目、一個戶型由開放式起，盤源量同買家定位差別大。",
  ),
  versusArticle(
    "tai-tou-waan",
    "long-tou-waan",
    "palatial-coast-vs-aqua-blue",
    "帝濤灣同浪濤灣都係小欖臨海屋苑，都有分層同洋房，但屋苑規模同期數劃分唔同，估值要分開睇。",
  ),
];

const ATTRIBUTE_ARTICLES: GroupSpec[] = [
  attributeArticle(
    "洋房",
    "castle-peak-road-house-estate-reviews",
    "青山公路洋房屋苑開箱",
    "洋房同分層唔可以混合估值 —— 面積、車位、花園同維修責任都唔同，比較前要先分產品類型。",
  ),
  attributeArticle(
    "低密度",
    "low-density-estate-reviews",
    "青山公路低密度屋苑開箱",
    "低密度通常換嚟私隱同空間，代價係盤源較少、成交疏落，估值時樣本不足就唔應該睇平均呎價。",
  ),
  attributeArticle(
    "海景",
    "sea-view-estate-reviews",
    "深井 青山公路海景屋苑開箱",
    "海景唔係一個「有」或「冇」嘅問題 —— 期數、座向、樓層同開揚度都會令同一屋苑內嘅呎價差得遠。",
  ),
  attributeArticle(
    "會所",
    "clubhouse-estate-reviews",
    "青山公路會所屋苑開箱",
    "會所配套會反映在管理費同租務承接力上，所以自住同收租買家睇會所嘅角度並唔一樣。",
  ),
  attributeArticle(
    "車位",
    "car-park-estate-reviews",
    "青山公路連車位屋苑開箱",
    "呢一帶唔屬港鐵步行生活圈，車位供應同充電安排往往直接影響日常生活質素同轉手時嘅叫價。",
  ),
  attributeArticle(
    "上車",
    "first-home-estate-reviews",
    "深井 青山公路上車屋苑開箱",
    "上車盤睇嘅係入場門檻同日後轉手彈性，所以樓齡、屋苑規模同盤源量同樣重要。",
  ),
  attributeArticle(
    "租務",
    "rental-yield-estate-reviews",
    "青山公路收租屋苑開箱",
    "收租買家關心租客來源同管理質素；放盤叫租同實際成交租金要分開睇，唔可以混為一談。",
  ),
  attributeArticle(
    "新樓",
    "newer-estate-reviews",
    "青山公路較新樓齡屋苑開箱",
    "較新樓齡通常代表較低維修風險同較新設計，但一手紀錄、二手成交同業主放盤必須分開比較。",
  ),
];

/**
 * Publication schedule.
 *
 * Publishing 50 pages in one day from one fact base is the pattern Google's
 * spam policy calls scaled content abuse. The 22 single-estate 開箱 go live
 * together -- they are one-per-estate, each about a page that already exists,
 * so there is nothing bulk about them -- and the 28 multi-estate articles then
 * land one a day.
 *
 * These are real timestamps, not a build-time trick: every consumer filters on
 * `publishedAt <= now` at request time, so an article goes live on its date
 * with no deploy, and is genuinely unreachable before it (its /blog URL 404s
 * and it is absent from the sitemap) rather than merely unlisted.
 */
const LAUNCH_AT = "2026-09-07T00:00:00.000Z";
/** 09:00 Hong Kong time (UTC+8) on the first scheduled day. */
const DAILY_START_AT = "2026-09-08T01:00:00.000Z";

function scheduledAt(dayOffset: number): string {
  const at = new Date(DAILY_START_AT);
  at.setUTCDate(at.getUTCDate() + dayOffset);
  return at.toISOString();
}

/** Round-robins the three kinds so the daily feed alternates between an area
 * round-up, a head-to-head and an attribute piece instead of shipping six area
 * articles in a row. */
function interleave<T>(...lists: readonly (readonly T[])[]): T[] {
  const longest = Math.max(...lists.map((list) => list.length));
  const out: T[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      if (index < list.length) out.push(list[index]);
    }
  }
  return out;
}

const SINGLE_ESTATE_SLUGS = estateRegistry
  .filter((entry) => entry.hasPage)
  .map((entry) => entry.slug);

export const estateReviewArticles: readonly EstateReviewArticle[] = [
  ...SINGLE_ESTATE_SLUGS.map((slug) => ({
    ...singleEstateArticle(slug),
    publishedAt: LAUNCH_AT,
  })),
  ...interleave(AREA_ARTICLES, VERSUS_ARTICLES, ATTRIBUTE_ARTICLES).map((spec, index) => ({
    ...groupArticle(spec),
    publishedAt: scheduledAt(index),
  })),
];
