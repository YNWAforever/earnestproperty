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
      "深井 hyperlocal 地產專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園真盤源，即時 WhatsApp 查詢。持牌代理 C-018613。",
  },
  listings: {
    path: "/listings",
    title: "深井放盤搜尋｜買樓租樓真盤源 — 晉誠地產",
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
      "荃灣買樓租樓指南：港鐵荃灣線、荃灣西、大型商場、校網一覽，連深井青龍頭比較。晉誠地產真盤源 C-018613。",
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
      "晉誠地產（C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園等核心屋苑。真盤源、即時回覆、持牌可靠。",
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
  碧堤半島: "bellagio",
  BELLAGIO: "bellagio",
  浪翠園: "sea-crest-villa",
  "SEA CREST VILLA": "sea-crest-villa",
  豪景花園: "hong-kong-garden",
  "HONG KONG GARDEN": "hong-kong-garden",
  海韻花園: "rhine-garden",
  "RHINE GARDEN": "rhine-garden",
  麗都花園: "lido-garden",
  "LIDO GDN": "lido-garden",
  "LIDO GARDEN": "lido-garden",
};

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
