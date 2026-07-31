export type CorridorFaq = {
  question: string;
  answer: string;
};

export type CorridorLink = {
  href: string;
  label: string;
};

export type CorridorHub = {
  slug: string;
  path: string;
  label: string;
  launchName: string;
  title: string;
  description: string;
  h1: string;
  intro: string[];
  faqs: CorridorFaq[];
};

export type CorridorSegment = {
  slug: string;
  path: string;
  nameZh: string;
  nameEn: string;
  eyebrow: string;
  title: string;
  description: string;
  h1: string;
  intro: string[];
  /**
   * Zone-card copy, supplied verbatim by the client. Kept as string[] so a zone
   * whose copy arrives as multiple paragraphs renders as paragraphs rather than
   * being joined into one run-on line.
   */
  zoneSummary: string[];
  buyerFit: string;
  transport: string;
  schoolNet?: string;
  housingProfile: string;
  featuredEstates: string[];
  districtSlugs: string[];
  estateSlugs: string[];
  textAliases: string[];
  faqs: CorridorFaq[];
  links: CorridorLink[];
};

export const castlePeakRoadHub = {
  slug: "castle-peak-road",
  path: "/castle-peak-road",
  label: "青山公路 Castle Peak Road",
  launchName: "Core Corridor Launch",
  title: "青山公路 Castle Peak Road 樓盤｜油柑頭、汀九、深井、青龍頭、小欖",
  description:
    "青山公路沿線買樓租樓指南：油柑頭、汀九、深井、青龍頭、小欖、掃管笏及三聖，結合晉誠地產 C-018613 全部真盤。",
  h1: "青山公路 Castle Peak Road · 海景住宅走廊",
  intro: [
    "新界西青山公路住宅區由汀九、深井、小欖後段組成，住宅選擇橫跨鐵路生活圈、低密度海景屋、成熟大型屋苑及臨海新式屋苑。",
    "晉誠地產紮根深井青山公路，這個指南將沿線分成三個買家容易理解的生活圈，配合即時放盤數據，方便同日比較交通、景觀、樓齡、校網和預算。",
  ],
  faqs: [
    {
      question: "青山公路沿線適合邊類買家？",
      answer:
        "適合想用荃灣市區以外預算換取海景、空間、屋苑尺度或低密度生活的買家。自駕家庭、機場或港島通勤客、換樓客和收租投資者都會比較這條走廊。",
    },
    {
      question: "青山公路買樓應先比較哪些地段？",
      answer:
        "可以先由油柑頭/汀九，深井/青龍頭段，小欖/掃管笏/三聖段入手，再按交通、校網、樓齡、海景和放盤量收窄選擇。",
    },
    {
      question: "放盤數量是否即時更新？",
      answer:
        "頁面會讀取網站已接入的 Neon-backed 公開真盤資料。實際可睇盤源、業主最新叫價和未公開放盤，建議直接 WhatsApp 晉誠地產查詢。",
    },
  ],
} satisfies CorridorHub;

export const castlePeakRoadSegments: CorridorSegment[] = [
  {
    slug: "ting-kau",
    path: "/castle-peak-road/ting-kau",
    nameZh: "油柑頭 汀九",
    nameEn: "Yau Kom Tau / Ting Kau",
    eyebrow: "青山公路東段",
    title: "油柑頭・汀九樓盤｜青山公路低密度海景別墅、洋房",
    description:
      "油柑頭及汀九 Ting Kau 樓盤指南：觀海別墅、嘉御龍庭、汀九別墅等低密度海景別墅洋房，介乎荃灣與深井，62 校網。晉誠地產 C-018613。",
    h1: "油柑頭 汀九 · 青山公路低密度海景住宅",
    intro: [
      "油柑頭與汀九是青山公路海景生活圈的東面入口，沿青山公路面向汀九橋、青馬橋及藍巴勒海峽，是青山公路少數以低密度別墅、洋房和海景住宅為主的地段。",
      "相比荃灣市中心，這一段更重視私隱、空間、車位和寧靜生活；相比深井大型屋苑，盤源更稀少，睇樓時需要仔細比較維修、管理費、車位和實用面積。",
    ],
    zoneSummary: ["主打面積比較大，低密度海景、洋房及屋地"],
    buyerFit: "適合重視海景、低密度、私隱、泊車和安靜生活的家庭與換樓客。",
    transport: "主要靠青山公路巴士、小巴及自駕，往荃灣、深井、機場和青衣方向成熟。",
    schoolNet: "62 校網。實際派位及校網資料以教育局最新公布為準。",
    housingProfile: "低密度別墅、洋房、海景住宅和少量分層單位，流通量較低。",
    featuredEstates: [
      "Vista Del Mar 觀海別墅",
      "Royal Dragon Villa 嘉御龍庭",
      "Ting Kau Villa 汀九別墅",
      "海雲軒",
      "縉皇居",
      "油柑頭海景住宅",
    ],
    // 油柑頭 stock normalises to tsuen-wan (see src/lib/mls/normalize-old-site.mjs),
    // so it is recovered through the textAliases below rather than by accepting
    // tsuen-wan as a districtSlug — accepting it would drag the 荃灣, 大欖涌 and
    // 屯門 listings the client asked us to exclude into corridor inventory.
    districtSlugs: ["ting-kau", "yau-kom-tau", "castle-peak-road"],
    estateSlugs: [],
    textAliases: [
      "汀九",
      "Ting Kau",
      "青山公路汀九段",
      "觀海別墅",
      "Vista Del Mar",
      "嘉御龍庭",
      "Royal Dragon Villa",
      "汀九別墅",
      "Ting Kau Villa",
      "油柑頭",
      "Yau Kom Tau",
      "海雲軒",
      "縉皇居",
    ],
    faqs: [
      // 荃灣西 left the corridor with the client's p47 district prune, so the old
      // 「荃灣西同油柑頭」 FAQ no longer describes anything on the page. Rewritten
      // against the two zone members the client kept; every claim below traces to
      // the client's own zone description (docx p54/p55) or to this segment's
      // existing intro copy — nothing new is asserted about either area.
      {
        question: "油柑頭同汀九有咩分別？",
        answer:
          "油柑頭較接近荃灣一邊，汀九則沿青山公路面向汀九橋及藍巴勒海峽。兩段同屬一個生活圈，主打面積比較大，低密度海景、洋房及屋地，環境相對安靜。",
      },
      {
        question: "汀九主要有咩類型樓盤？",
        answer:
          "汀九以低密度別墅、洋房、海景住宅和少量分層單位為主，常見搜尋包括觀海別墅、嘉御龍庭、汀九別墅及青山公路汀九段住宅。",
      },
      {
        question: "汀九是否屬 62 校網？",
        answer:
          "汀九一般屬荃灣 62 小學校網，但每個地址的實際校網及派位安排應以教育局最新資料為準。",
      },
      {
        question: "汀九交通方便嗎？",
        answer:
          "汀九主要靠青山公路巴士、小巴和自駕，往荃灣、深井、青衣和機場方向成熟，但不屬港鐵步行生活圈。",
      },
      {
        question: "汀九同深井點揀？",
        answer:
          "想要大型屋苑、商店和較多放盤可先比較深井；想要低密度、海景、私隱和較寧靜環境，汀九會更合適。",
      },
    ],
    links: [
      { href: "/castle-peak-road/sham-tseng", label: "比較深井 / 青山公路" },
      { href: "/castle-peak-road/so-kwun-wat-gold-coast", label: "比較小欖 / 掃管笏 / 三聖" },
      { href: "/listings?deal=all&district=ting-kau&page=1", label: "搜尋汀九放盤" },
    ],
  },
  {
    slug: "sham-tseng",
    path: "/castle-peak-road/sham-tseng",
    nameZh: "深井 / 青山公路",
    nameEn: "Sham Tseng / Castle Peak Road",
    eyebrow: "青山公路深井段",
    title: "深井・青山公路樓盤｜海景大型屋苑、青龍頭豪景花園",
    description:
      "深井 Sham Tseng 及青山公路樓盤指南：碧堤半島、浪翠園、麗都花園、海韻花園與青龍頭豪景花園，配合即時全部真盤。",
    h1: "深井 / 青山公路 · 海景大型屋苑",
    intro: [
      "深井是青山公路最成熟的海景住宅生活圈，屋苑規模、巴士小巴、餐飲和日常配套都比汀九集中。",
      "由深井向西伸延至青龍頭，住宅選擇以較大面積、海景和山海環境為賣點，適合想以較務實預算換取空間的家庭。",
    ],
    // The docx (p57) left this zone as "……..，車位比例高，租售價錢十分相宜"; the client
    // supplied the missing clauses on 2026-07-29, so both paragraphs ship verbatim.
    // This is the only zone card with two paragraphs. Its opening sentence is also
    // `intro[0]` — that overlap is the client's own wording, not recycled page copy.
    zoneSummary: [
      "深井是青山公路最成熟的海景住宅生活圈，屋苑規模、巴士小巴、餐飲和日常配套都比汀九集中。",
      "碧堤半島、浪翠園、麗都花園、海韻花園與周邊屋苑形成穩定自住及租務市場，車位比例高，租售價錢十分相宜",
    ],
    buyerFit: "適合想要海景、屋苑管理、會所、較多盤源和成熟生活配套的家庭。",
    // 青龍頭's transport detail is retained here because this zone absorbed it.
    transport:
      "小巴接駁荃灣站，巴士往九龍、港島、機場及青衣方向成熟；青龍頭段主要靠青山公路巴士、小巴和自駕，往荃灣、屯門和機場均有路線。",
    schoolNet: "62 校網。實際派位及校網資料以教育局最新公布為準。",
    housingProfile: "大型海景屋苑、成熟分層住宅、山海景單位和部分低密度臨海單位。",
    featuredEstates: [
      "Bellagio 碧堤半島",
      "Sea Crest Villa 浪翠園",
      "Lido Garden 麗都花園",
      "Rhine Garden 海韻花園",
      "Hong Kong Garden 豪景花園",
      "青龍頭海景住宅",
    ],
    districtSlugs: ["sham-tseng", "tsing-lung-tau", "castle-peak-road"],
    estateSlugs: ["bellagio", "sea-crest-villa", "lido-garden", "rhine-garden", "hong-kong-garden"],
    textAliases: [
      "深井",
      "Sham Tseng",
      "碧堤半島",
      "浪翠園",
      "麗都花園",
      "海韻花園",
      "豪景花園",
      "Hong Kong Garden",
      "青龍頭",
      "Tsing Lung Tau",
    ],
    faqs: [
      {
        question: "深井在青山公路沿線有咩優勢？",
        answer: "深井放盤量、屋苑選擇和生活配套較集中，適合想同日比較多個海景屋苑的買家。",
      },
      {
        question: "深井同汀九有咩分別？",
        answer: "深井較成熟和多盤源，汀九較低密度和私隱度高。預算、交通和生活節奏會直接影響選擇。",
      },
      {
        question: "青龍頭適合上車客嗎？",
        answer: "青龍頭部分屋苑入場門檻較深井核心屋苑低，適合想用較務實預算換取面積的買家。",
      },
      {
        question: "青龍頭交通會否太遠？",
        answer: "青龍頭主要靠巴士、小巴和自駕，買家應按上班地點實測繁忙時間車程。",
      },
    ],
    links: [
      { href: "/district/sham-tseng", label: "深井完整地區專頁" },
      { href: "/estate/bellagio", label: "碧堤半島 Bellagio" },
      { href: "/estate/hong-kong-garden", label: "豪景花園 Hong Kong Garden" },
      { href: "/listings?deal=all&district=sham-tseng&page=1", label: "搜尋深井放盤" },
    ],
  },
  {
    // Slug stays so-kwun-wat-gold-coast: this zone was renamed and widened (to
    // take in 小欖 and 三聖), not created fresh, so changing the slug would throw
    // away an already-indexed URL for nothing.
    slug: "so-kwun-wat-gold-coast",
    path: "/castle-peak-road/so-kwun-wat-gold-coast",
    nameZh: "小欖/掃管笏/三聖區",
    nameEn: "Siu Lam / So Kwun Wat / Sam Shing",
    eyebrow: "青山公路西段",
    title: "小欖・掃管笏・三聖樓盤｜青山公路西段新樓及臨海洋房",
    description:
      "小欖、掃管笏及三聖一帶樓盤指南，涵蓋新樓入伙盤、低密度住宅、黃金海岸及臨海洋房，即時全部真盤查詢。",
    h1: "小欖 / 掃管笏 / 三聖 · 青山公路西段臨海生活",
    intro: [
      "小欖、掃管笏與三聖屬青山公路西段，近年新式屋苑供應較多，兼具臨海生活、會所和較完整家庭配套。",
      "這段適合願意接受較長通勤，換取新式屋苑、海景或較大生活空間的買家。",
    ],
    zoneSummary: ["提供大量新樓入伙盤及比較多低密度的住宅，亦有比較多的新型或臨海洋房可選擇"],
    buyerFit: "適合追求新式屋苑、會所、海濱生活和較大空間的家庭與換樓客。",
    transport: "主要靠巴士、小巴和自駕往屯門、荃灣、九龍及港島，實際車程受繁忙時間影響。",
    schoolNet: "校網需按實際地址核實，以教育局最新公布為準。",
    housingProfile: "新式大型屋苑、臨海住宅、會所屋苑和部分低密度選擇。",
    featuredEstates: [
      "Aegean Coast 愛琴海岸",
      "Gold Coast 黃金海岸",
      "帝濤灣",
      "滿名山",
      "星堤",
      "NAPA",
      "OMA by the Sea",
      "瑜翠園",
    ],
    districtSlugs: ["so-kwun-wat", "gold-coast", "castle-peak-road"],
    estateSlugs: [],
    textAliases: [
      "小欖",
      "Siu Lam",
      "掃管笏",
      "So Kwun Wat",
      "三聖",
      "Sam Shing",
      "黃金海岸",
      "Gold Coast",
      "Aegean Coast",
      "愛琴海岸",
      "帝濤灣",
      "滿名山",
      "星堤",
      "NAPA",
      "OMA by the Sea",
      "瑜翠園",
    ],
    faqs: [
      {
        question: "小欖、掃管笏同三聖適合邊類家庭？",
        answer: "適合想要新式屋苑、會所、臨海生活和較大居住空間，並能接受巴士或自駕通勤的家庭。",
      },
      {
        question: "這段同深井有咩分別？",
        answer:
          "深井較接近荃灣和成熟生活圈，小欖 / 掃管笏 / 三聖一帶新樓入伙盤較多，生活節奏更偏度假式。",
      },
    ],
    links: [
      { href: "/castle-peak-road/sham-tseng", label: "比較深井 / 青山公路" },
      { href: "/castle-peak-road/ting-kau", label: "比較油柑頭 / 汀九" },
      { href: "/listings?deal=all&district=castle-peak-road&page=1", label: "搜尋青山公路放盤" },
    ],
  },
];

export function getCastlePeakRoadSegment(slug: string): CorridorSegment | null {
  return castlePeakRoadSegments.find((segment) => segment.slug === slug) ?? null;
}

export const castlePeakRoadSitemapPaths = [
  castlePeakRoadHub.path,
  ...castlePeakRoadSegments.map((segment) => segment.path),
];

/**
 * Client requirement: the homepage 精選筍盤 strip and the estate list may only
 * surface stock in 深井 / 青山公路 / 汀九 / 青龍頭 / 油柑頭 — the listing the
 * client flagged, "大欖涌, 屯門", must never reach the homepage.
 *
 * The whitelist lives in the content layer because the listing API and the MLS
 * scraping logic are out of scope to change, so the filtering itself happens in
 * the consumer (src/lib/queries.ts).
 */
export const corridorRegionScope = {
  /** The region names as the client wrote them — single source of truth for docs and tests. */
  labels: ["深井", "青山公路", "汀九", "青龍頭", "油柑頭"],
  districtSlugs: ["sham-tseng", "castle-peak-road", "ting-kau", "tsing-lung-tau", "yau-kom-tau"],
  /**
   * Place- and estate-name whitelist. 青山公路 and "Castle Peak Road" are
   * deliberately excluded: the road runs all the way to 屯門, so matching on it
   * as free text would admit out-of-corridor stock. 青山公路 is represented
   * above as a district slug only.
   */
  textAliases: [
    "深井",
    "Sham Tseng",
    "汀九",
    "Ting Kau",
    "青龍頭",
    "Tsing Lung Tau",
    "油柑頭",
    "Yau Kom Tau",
    "碧堤半島",
    "Bellagio",
    "浪翠園",
    "Sea Crest Villa",
    "麗都花園",
    "Lido Garden",
    "海韻花園",
    "Rhine Garden",
    "豪景花園",
    "Hong Kong Garden",
    "海雲軒",
    "縉皇居",
    "觀海別墅",
    "Vista Del Mar",
    "嘉御龍庭",
    "Royal Dragon Villa",
    "汀九別墅",
    "Ting Kau Villa",
  ],
  /**
   * Place names outside the corridor. A listing on the 青山公路 stretch can sit
   * as far out as 屯門, so the district slug alone cannot stop it; any of these
   * names is an immediate reject. 荃灣 is deliberately absent — 油柑頭 and 汀九
   * addresses carry it, so rejecting on it would drop stock the client keeps.
   */
  outOfScopeTextAliases: [
    "屯門",
    "Tuen Mun",
    "大欖涌",
    "Tai Lam Chung",
    "小欖",
    "Siu Lam",
    "掃管笏",
    "So Kwun Wat",
    "黃金海岸",
    "Gold Coast",
    "三聖",
    "Sam Shing",
  ],
};

const corridorEstateSlugs = new Set(
  castlePeakRoadSegments.flatMap((segment) => segment.estateSlugs),
);

export function isWithinCorridorRegion(input: {
  districtSlug?: string | null;
  estateSlug?: string | null;
  estateDistrictSlug?: string | null;
  text?: Array<string | null | undefined>;
}): boolean {
  // Already attached to a corridor estate: the strongest signal there is, and
  // not something the place-name gate should be allowed to override.
  if (input.estateSlug && corridorEstateSlugs.has(input.estateSlug)) return true;

  const haystack = (input.text ?? [])
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toUpperCase();

  const isOutOfScope = corridorRegionScope.outOfScopeTextAliases.some((alias) =>
    haystack.includes(alias.toUpperCase()),
  );
  if (isOutOfScope) return false;

  if (input.districtSlug && corridorRegionScope.districtSlugs.includes(input.districtSlug)) {
    return true;
  }
  if (
    input.estateDistrictSlug &&
    corridorRegionScope.districtSlugs.includes(input.estateDistrictSlug)
  ) {
    return true;
  }

  return corridorRegionScope.textAliases.some((alias) => haystack.includes(alias.toUpperCase()));
}
