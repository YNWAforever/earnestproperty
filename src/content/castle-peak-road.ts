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
  title: "青山公路 Castle Peak Road 樓盤｜荃灣、汀九、深井、青龍頭、黃金海岸",
  description:
    "青山公路沿線買樓租樓指南：荃灣西、油柑頭、汀九、深井、青龍頭、掃管笏及黃金海岸，結合晉誠地產 C-018613 堅盤源。",
  h1: "青山公路 Castle Peak Road · 海景住宅走廊",
  intro: [
    "青山公路由荃灣西、油柑頭伸延至汀九、深井、青龍頭、掃管笏及黃金海岸，住宅選擇橫跨鐵路生活圈、低密度海景屋、成熟大型屋苑及臨海新式屋苑。",
    "晉誠地產紮根深井與青山公路，這個指南將沿線分成五個買家容易理解的生活圈，配合即時放盤數據，方便同日比較交通、景觀、樓齡、校網和預算。",
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
        "可以先由荃灣西 / 油柑頭、汀九、深井、青龍頭 / 豪景、掃管笏 / 黃金海岸五段入手，再按交通、校網、樓齡、海景和放盤量收窄選擇。",
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
    slug: "tsuen-wan-yau-kom-tau",
    path: "/castle-peak-road/tsuen-wan-yau-kom-tau",
    nameZh: "荃灣西 / 油柑頭",
    nameEn: "Tsuen Wan West / Yau Kom Tau",
    eyebrow: "青山公路東段",
    title: "荃灣西・油柑頭樓盤｜青山公路東段海景住宅",
    description:
      "荃灣西、油柑頭及青山公路荃灣段樓盤指南，涵蓋港鐵、商場、海景住宅與往汀九深井生活圈比較。",
    h1: "荃灣西 / 油柑頭 · 青山公路東段入口",
    intro: [
      "荃灣西與油柑頭是青山公路海景生活圈的東面入口，兼具港鐵、商場和臨海住宅選擇。",
      "這段適合仍想保留荃灣市區便利，但希望比較汀九、深井及青龍頭海景住宅的買家。",
    ],
    buyerFit: "適合重視鐵路、商場、通勤便利，同時想比較海景和較大面積的家庭。",
    transport: "荃灣西站、荃灣站、青山公路巴士及小巴網絡成熟，前往九龍、港島和機場路線選擇多。",
    schoolNet: "荃灣區小學校網，實際校網以教育局最新公布為準。",
    housingProfile: "鐵路上蓋及鄰近大型住宅為主，向西逐步過渡至低密度及海景住宅。",
    featuredEstates: ["海雲軒", "縉皇居", "油柑頭海景住宅"],
    districtSlugs: ["tsuen-wan", "yau-kom-tau", "castle-peak-road"],
    estateSlugs: [],
    textAliases: ["荃灣西", "油柑頭", "青山公路荃灣段", "海雲軒", "縉皇居", "Yau Kom Tau"],
    faqs: [
      {
        question: "荃灣西同油柑頭有咩分別？",
        answer:
          "荃灣西較接近港鐵與商場，油柑頭則較近青山公路海景住宅段，環境相對安靜，適合想在便利和景觀之間取得平衡的買家。",
      },
      {
        question: "這段適合自住定投資？",
        answer: "兩者都適合。鐵路及商場支撐租務需求，而海景或較大單位則吸引換樓家庭。",
      },
    ],
    links: [
      { href: "/district/tsuen-wan", label: "荃灣地區攻略" },
      { href: "/castle-peak-road/ting-kau", label: "比較汀九低密度住宅" },
      { href: "/listings?deal=all&district=tsuen-wan&page=1", label: "搜尋荃灣放盤" },
    ],
  },
  {
    slug: "ting-kau",
    path: "/castle-peak-road/ting-kau",
    nameZh: "汀九",
    nameEn: "Ting Kau",
    eyebrow: "青山公路汀九段",
    title: "汀九 Ting Kau 樓盤｜青山公路低密度海景別墅、洋房",
    description:
      "汀九 Ting Kau 樓盤指南：觀海別墅、嘉御龍庭、汀九別墅等低密度海景別墅洋房，介乎荃灣與深井，62 校網。晉誠地產 C-018613。",
    h1: "汀九 Ting Kau · 青山公路低密度海景住宅",
    intro: [
      "汀九位於荃灣油柑頭與深井之間，沿青山公路面向汀九橋、青馬橋及藍巴勒海峽，是青山公路少數以低密度別墅、洋房和海景住宅為主的地段。",
      "相比荃灣市中心，汀九更重視私隱、空間、車位和寧靜生活；相比深井大型屋苑，汀九盤源更稀少，睇樓時需要仔細比較維修、管理費、車位和實用面積。",
    ],
    buyerFit: "適合重視海景、低密度、私隱、泊車和安靜生活的家庭與換樓客。",
    transport: "主要靠青山公路巴士、小巴及自駕，往荃灣、深井、機場和青衣方向成熟。",
    schoolNet: "62 校網。實際派位及校網資料以教育局最新公布為準。",
    housingProfile: "低密度別墅、洋房、海景住宅和少量分層單位，流通量較低。",
    featuredEstates: [
      "Vista Del Mar 觀海別墅",
      "Royal Dragon Villa 嘉御龍庭",
      "Ting Kau Villa 汀九別墅",
    ],
    districtSlugs: ["ting-kau", "castle-peak-road"],
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
    ],
    faqs: [
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
      { href: "/castle-peak-road/sham-tseng", label: "比較深井大型屋苑" },
      { href: "/district/tsuen-wan", label: "荃灣地區攻略" },
      { href: "/listings?deal=all&district=ting-kau&page=1", label: "搜尋汀九放盤" },
    ],
  },
  {
    slug: "sham-tseng",
    path: "/castle-peak-road/sham-tseng",
    nameZh: "深井",
    nameEn: "Sham Tseng",
    eyebrow: "青山公路深井段",
    title: "深井 Sham Tseng 樓盤｜青山公路海景大型屋苑",
    description:
      "深井 Sham Tseng 青山公路樓盤指南：碧堤半島、浪翠園、麗都花園、海韻花園與香港花園，配合即時堅盤源。",
    h1: "深井 Sham Tseng · 青山公路海景大型屋苑",
    intro: [
      "深井是青山公路最成熟的海景住宅生活圈，屋苑規模、巴士小巴、餐飲和日常配套都比汀九集中。",
      "碧堤半島、浪翠園、麗都花園、海韻花園與周邊屋苑形成穩定自住及租務市場。",
    ],
    buyerFit: "適合想要海景、屋苑管理、會所、較多盤源和成熟生活配套的家庭。",
    transport: "小巴接駁荃灣站，巴士往九龍、港島、機場及青衣方向成熟。",
    schoolNet: "62 校網。實際派位及校網資料以教育局最新公布為準。",
    housingProfile: "大型海景屋苑、成熟分層住宅和部分低密度臨海單位。",
    featuredEstates: [
      "Bellagio 碧堤半島",
      "Sea Crest Villa 浪翠園",
      "Lido Garden 麗都花園",
      "Rhine Garden 海韻花園",
      "Hong Kong Garden 豪景花園",
    ],
    districtSlugs: ["sham-tseng", "castle-peak-road"],
    estateSlugs: ["bellagio", "sea-crest-villa", "lido-garden", "rhine-garden", "hong-kong-garden"],
    textAliases: ["深井", "Sham Tseng", "碧堤半島", "浪翠園", "麗都花園", "海韻花園", "豪景花園"],
    faqs: [
      {
        question: "深井在青山公路沿線有咩優勢？",
        answer: "深井放盤量、屋苑選擇和生活配套較集中，適合想同日比較多個海景屋苑的買家。",
      },
      {
        question: "深井同汀九有咩分別？",
        answer: "深井較成熟和多盤源，汀九較低密度和私隱度高。預算、交通和生活節奏會直接影響選擇。",
      },
    ],
    links: [
      { href: "/district/sham-tseng", label: "深井完整地區專頁" },
      { href: "/estate/bellagio", label: "碧堤半島 Bellagio" },
      { href: "/listings?deal=all&district=sham-tseng&page=1", label: "搜尋深井放盤" },
    ],
  },
  {
    slug: "tsing-lung-tau",
    path: "/castle-peak-road/tsing-lung-tau",
    nameZh: "青龍頭 / 豪景",
    nameEn: "Tsing Lung Tau / Hong Kong Garden",
    eyebrow: "青山公路青龍頭段",
    title: "青龍頭 Tsing Lung Tau 樓盤｜豪景花園、香港花園、海景住宅",
    description:
      "青龍頭及豪景一帶樓盤指南，涵蓋豪景花園、香港花園和青山公路青龍頭段海景住宅，即時堅盤源查詢。",
    h1: "青龍頭 Tsing Lung Tau · 空間型海景住宅",
    intro: [
      "青龍頭位於深井以西，住宅選擇以較大面積、海景和山海環境為賣點。",
      "豪景花園和香港花園一帶適合想以較務實預算換取空間的家庭。",
    ],
    buyerFit: "適合重視實用面積、海景、預算效率和較安靜環境的家庭。",
    transport: "主要靠青山公路巴士、小巴和自駕，往荃灣、屯門和機場均有路線。",
    schoolNet: "校網需按實際地址核實，以教育局最新公布為準。",
    housingProfile: "大型屋苑、山海景分層住宅及部分低密度單位。",
    featuredEstates: ["Hong Kong Garden 豪景花園", "香港花園", "青龍頭海景住宅"],
    districtSlugs: ["tsing-lung-tau", "castle-peak-road"],
    estateSlugs: ["hong-kong-garden"],
    textAliases: ["青龍頭", "Tsing Lung Tau", "豪景花園", "Hong Kong Garden", "香港花園"],
    faqs: [
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
      { href: "/estate/hong-kong-garden", label: "豪景花園 Hong Kong Garden" },
      { href: "/castle-peak-road/sham-tseng", label: "比較深井" },
      { href: "/listings?deal=all&estate=hong-kong-garden&page=1", label: "搜尋豪景花園放盤" },
    ],
  },
  {
    slug: "so-kwun-wat-gold-coast",
    path: "/castle-peak-road/so-kwun-wat-gold-coast",
    nameZh: "掃管笏 / 黃金海岸",
    nameEn: "So Kwun Wat / Gold Coast",
    eyebrow: "青山公路西段",
    title: "掃管笏・黃金海岸樓盤｜青山公路西段臨海住宅",
    description:
      "掃管笏及黃金海岸樓盤指南，涵蓋 Aegean Coast、Gold Coast、NAPA、OMA by the Sea、滿名山等青山公路西段住宅。",
    h1: "掃管笏 / 黃金海岸 · 青山公路西段臨海生活",
    intro: [
      "掃管笏與黃金海岸屬青山公路西段，近年新式屋苑供應較多，兼具臨海生活、會所和較完整家庭配套。",
      "這段適合願意接受較長通勤，換取新式屋苑、海景或較大生活空間的買家。",
    ],
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
      "掃管笏",
      "So Kwun Wat",
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
        question: "掃管笏同黃金海岸適合邊類家庭？",
        answer: "適合想要新式屋苑、會所、臨海生活和較大居住空間，並能接受巴士或自駕通勤的家庭。",
      },
      {
        question: "這段同深井有咩分別？",
        answer: "深井較接近荃灣和成熟生活圈，掃管笏 / 黃金海岸新式屋苑較多，生活節奏更偏度假式。",
      },
    ],
    links: [
      { href: "/castle-peak-road/tsing-lung-tau", label: "比較青龍頭" },
      { href: "/castle-peak-road/sham-tseng", label: "比較深井" },
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
