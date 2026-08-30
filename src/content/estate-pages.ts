import { getEstateEntry } from "./estate-registry.ts";

export type EstateContentLink = {
  href: string;
  label: string;
};

export type EstatePageFaq = {
  question: string;
  answer: string;
};

export type EstatePageContent = {
  slug: string;
  nameZh: string;
  nameEn: string;
  heroPositioning: string;
  overview: string[];
  buyerFit: string[];
  pros: string[];
  watchouts: string[];
  transportLifestyle: string;
  marketNote: string;
  saleCta: string;
  rentCta: string;
  valuationCta: string;
  faqs: EstatePageFaq[];
  relatedLinks: EstateContentLink[];
};

export const earnestPublicTrust = {
  licenceNo: "C-018613",
  companyNameZh: "晉誠地產代理有限公司",
  companyNameEn: "Earnest Property Agency Ltd",
  phoneDisplay: "2688 2988",
  address: "深井麗都花園地下5A舖",
  agentDirectoryHref: "/agents",
  coverageNotes: [
    "公開資料顯示晉誠地產紮根深井麗都花園地舖。",
    "公開盤源覆蓋深井、屯門青山公路、碧堤半島、琨崙、海澄軒等沿線屋苑。",
    "此區域證明只作 factual trust proof；即時可睇盤源以本網站資料庫及代理回覆為準。",
  ],
} as const;

/**
 * Identity fields (slug, nameZh, nameEn) come from estate-registry.ts (DR-10)
 * instead of being retyped here -- this object keeps only its own detail-page
 * prose (overview/buyerFit/pros/watchouts/FAQs/etc).
 */
function estatePageIdentity(slug: string) {
  const entry = getEstateEntry(slug);
  if (!entry.nameEn) {
    throw new Error(
      `estate-pages.ts: estatePageContent requires a nameEn, but "${slug}" has none`,
    );
  }
  return { slug: entry.slug, nameZh: entry.nameZh, nameEn: entry.nameEn };
}

export const estatePageContent = {
  bellagio: {
    ...estatePageIdentity("bellagio"),
    heroPositioning: "深井地標海景屋苑，適合重視會所、海景和屋苑規模的家庭。",
    overview: [
      "碧堤半島位於深井青山公路深井段，屋苑規模大、臨海感強，是深井最具代表性的換樓屋苑之一。",
      "買家通常會比較座向、期數、海景開揚度、會所距離和往返荃灣的交通安排。",
    ],
    buyerFit: [
      "想在深井尋找大型會所和海景生活的家庭。",
      "由市區換入較大單位、又希望保留穩定交通配套的買家。",
      "看重租務承接力和屋苑知名度的投資者。",
    ],
    pros: ["屋苑辨識度高", "海景及青馬橋景選擇多", "會所及管理配套成熟"],
    watchouts: [
      "不同期數景觀和實用率差異大",
      "熱門座向叫價較硬",
      "繁忙時間需預留接駁交通時間",
    ],
    transportLifestyle:
      "小巴及巴士接駁荃灣、九龍、港島和機場方向，日常生活依靠深井商店、餐飲和鄰近屋苑配套。",
    marketNote:
      "成交和呎價需要按期數、座向、樓層和海景質素分開比較，不能只看屋苑平均數。",
    saleCta: "想買碧堤半島？講低預算、期數和海景要求，代理幫你配盤。",
    rentCta: "想租碧堤半島？講低月租、入住日期和房數，代理幫你搵盤。",
    valuationCta: "碧堤半島業主可 WhatsApp 索取深井業主估價報告。",
    faqs: [
      {
        question: "碧堤半島適合自住定投資？",
        answer:
          "兩者都適合。自住買家重視海景和會所，投資者則會留意租客需求、叫租和管理質素。",
      },
      {
        question: "買碧堤半島最需要比較甚麼？",
        answer: "建議比較期數、座向、景觀、樓層、實用面積和近期同類成交。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/castle-peak-road/sham-tseng", label: "青山公路深井段" },
      {
        href: "/listings?deal=all&estate=bellagio&page=1",
        label: "碧堤半島放盤",
      },
    ],
  },
  "sea-crest-villa": {
    ...estatePageIdentity("sea-crest-villa"),
    heroPositioning: "深井成熟海景屋苑，入場門檻較務實，適合上車和換樓客比較。",
    overview: [
      "浪翠園分期發展，屋苑規模大，單位選擇由上車面積至家庭三房都有。",
      "買家會重點比較期數、樓齡、景觀、裝修和與巴士小巴站的距離。",
    ],
    buyerFit: [
      "預算較務實的海景自住客。",
      "希望以深井價位換取較大空間的家庭。",
      "想比較租務回報的長線投資者。",
    ],
    pros: ["放盤類型多", "生活圈成熟", "部分單位海景質素吸引"],
    watchouts: [
      "分期多，質素和景觀要逐個比較",
      "樓齡較新盤高",
      "部分座數與交通接駁距離較遠",
    ],
    transportLifestyle:
      "屋苑依靠青山公路巴士及小巴接駁荃灣，生活配套與深井餐飲、超市和鄰近屋苑共用。",
    marketNote: "浪翠園呎價通常要按期數和座向拆開看，海景盤和內園盤差距明顯。",
    saleCta: "想買浪翠園？WhatsApp 講低預算和期數偏好，代理幫你篩盤。",
    rentCta: "想租浪翠園？講低月租、入住日期和交通要求，代理幫你搵合適單位。",
    valuationCta: "浪翠園業主可 WhatsApp 查詢近期同類放售和放租估值。",
    faqs: [
      {
        question: "浪翠園適合上車嗎？",
        answer:
          "浪翠園有不少較務實入場選擇，適合想在深井買海景或大型屋苑但預算不想去到碧堤半島水平的買家。",
      },
      {
        question: "浪翠園買盤要注意甚麼？",
        answer:
          "要留意期數、維修、景觀、座向和交通接駁位置，最好用同一期數近期成交作比較。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/bellagio", label: "比較碧堤半島" },
      {
        href: "/listings?deal=all&estate=sea-crest-villa&page=1",
        label: "浪翠園放盤",
      },
    ],
  },
  "hong-kong-garden": {
    ...estatePageIdentity("hong-kong-garden"),
    heroPositioning: "青龍頭大型屋苑，主打空間、山海環境和較務實入場價。",
    overview: [
      "豪景花園位於青龍頭，屋苑規模大，常被買家用來比較深井核心屋苑以外的空間型選擇。",
      "買家通常重視實用面積、景觀、交通時間和屋苑內外配套。",
    ],
    buyerFit: [
      "想用較務實預算買較大單位的家庭。",
      "接受青龍頭交通節奏、重視空間和環境的買家。",
      "長線持有或收租投資者。",
    ],
    pros: ["入場價相對吸引", "單位面積選擇多", "山海環境較開揚"],
    watchouts: [
      "交通較依賴巴士小巴或自駕",
      "屋苑不同座數位置差異大",
      "樓齡和維修狀態要仔細檢查",
    ],
    transportLifestyle:
      "主要依靠青山公路交通往返荃灣、屯門和機場方向，適合能接受巴士小巴或自駕的家庭。",
    marketNote:
      "豪景花園成交比較要留意座數、面積、裝修和景觀，單看平均呎價容易失真。",
    saleCta: "想買豪景花園？講低預算、面積和交通要求，代理幫你配盤。",
    rentCta: "想租豪景花園？講低月租和入住日期，代理幫你篩選可睇盤。",
    valuationCta: "豪景花園業主可 WhatsApp 查詢青龍頭同類單位估值。",
    faqs: [
      {
        question: "豪景花園適合家庭客嗎？",
        answer:
          "適合重視空間和預算效率的家庭，但要先確認日常交通和校網安排是否配合生活需要。",
      },
      {
        question: "豪景花園同深井核心屋苑點揀？",
        answer:
          "深井核心屋苑生活配套較集中，豪景花園通常空間和入場價較吸引，選擇取決於交通和面積優先次序。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road/sham-tseng", label: "深井 / 青山公路生活圈" },
      { href: "/estate/sea-crest-villa", label: "比較浪翠園" },
      {
        href: "/listings?deal=all&estate=hong-kong-garden&page=1",
        label: "豪景花園放盤",
      },
    ],
  },
  "rhine-garden": {
    ...estatePageIdentity("rhine-garden"),
    heroPositioning: "深井臨海屋苑，適合鍾意海景和較寧靜生活節奏的買家。",
    overview: [
      "海韻花園位處深井臨海地段，景觀和寧靜感是主要吸引點。",
      "買家會重點比較海景開揚度、樓層、裝修、管理和與深井核心配套的距離。",
    ],
    buyerFit: [
      "重視海景和居住氣氛的自住客。",
      "想在深井尋找較寧靜屋苑的家庭。",
      "注重景觀和生活節奏的退休或換樓客。",
    ],
    pros: ["臨海感強", "環境相對寧靜", "深井生活圈成熟"],
    watchouts: ["樓齡和維修狀態要檢查", "盤源不一定充足", "不同座向景觀差距大"],
    transportLifestyle:
      "日常可使用深井青山公路交通和生活配套，適合接受非鐵路步行生活圈的住戶。",
    marketNote:
      "海韻花園估值應按海景質素和單位狀態比較，近期可睇盤量亦會影響議價空間。",
    saleCta: "想買海韻花園？講低景觀、預算和面積要求，代理幫你留意新盤。",
    rentCta: "想租海韻花園？講低月租、入住日期和景觀要求，代理幫你配盤。",
    valuationCta: "海韻花園業主可 WhatsApp 查詢臨海單位估值。",
    faqs: [
      {
        question: "海韻花園最大賣點是甚麼？",
        answer:
          "主要是臨海位置、景觀和較寧靜的居住感，適合把景觀和生活節奏放在前面的買家。",
      },
      {
        question: "海韻花園盤源多嗎？",
        answer:
          "盤源會按市場流通變化，建議直接 WhatsApp 查詢最新可睇盤和業主叫價。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/lido-garden", label: "比較麗都花園" },
      {
        href: "/listings?deal=all&estate=rhine-garden&page=1",
        label: "海韻花園放盤",
      },
    ],
  },
  "lido-garden": {
    ...estatePageIdentity("lido-garden"),
    heroPositioning: "深井成熟臨海屋苑，也是晉誠地產地舖所在生活圈。",
    overview: [
      "麗都花園位於深井青山公路深井段，屋苑成熟，鄰近深井餐飲和日常配套。",
      "對買家和租客而言，麗都花園的優勢在於生活便利、入場門檻和深井核心位置。",
    ],
    buyerFit: [
      "想入門深井生活圈的上車客。",
      "重視日常配套和交通接駁的租客。",
      "希望有穩定租務需求的業主和投資者。",
    ],
    pros: ["生活配套方便", "深井核心位置", "晉誠地產地舖就在屋苑生活圈"],
    watchouts: [
      "樓齡較高，單位狀態差異大",
      "景觀和座向要逐間比較",
      "優質放盤流通速度快",
    ],
    transportLifestyle:
      "鄰近深井主要商店、餐飲和青山公路交通，適合想住在深井核心生活圈的買家和租客。",
    marketNote:
      "麗都花園成交比較應分開看裝修、景觀和樓層，租盤則要留意交吉時間和家具電器狀態。",
    saleCta: "想買麗都花園？講低預算和單位狀態要求，代理幫你篩盤。",
    rentCta: "想租麗都花園？講低月租、入住日期和家具要求，代理幫你搵盤。",
    valuationCta: "麗都花園業主可直接 WhatsApp 地舖團隊查詢估值。",
    faqs: [
      {
        question: "麗都花園適合租客嗎？",
        answer:
          "適合。麗都花園位置成熟，生活配套方便，對想住深井核心生活圈的租客有吸引力。",
      },
      {
        question: "麗都花園業主估價要提供甚麼？",
        answer:
          "建議提供座數、實用面積、樓層、景觀、裝修和打算放售或放租，代理可以更快給出同類比較。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/rhine-garden", label: "比較海韻花園" },
      {
        href: "/listings?deal=all&estate=lido-garden&page=1",
        label: "麗都花園放盤",
      },
    ],
  },
} satisfies Record<string, EstatePageContent>;

/**
 * 加返屋苑相片 (docx p6) — asset side.
 *
 * The client supplied four photos in `docs/client-feedback/屋苑相/`; they are
 * committed under `public/estates/` normalised to lowercase `.jpg` (two arrived
 * as `.JPG` and one as `.jpeg`, which 404 on Vercel's case-sensitive filesystem)
 * and downscaled from 4032px originals, because this stack has no image
 * optimiser. Registered here rather than in the card component so the photo can
 * come from one place once the cards start rendering it.
 */
export const estatePhotos: Record<string, string | null> = {
  bellagio: "/estates/bellagio.jpg",
  "rhine-garden": "/estates/rhine-garden.jpg",
  "lido-garden": "/estates/lido-garden.jpg",
  // TODO(client): the supplied 浪翠園 photo is 600×357 and captioned 三期 only —
  // too small for a card at 2× DPR. Awaiting a higher-resolution estate-level shot.
  "sea-crest-villa": "/estates/sea-crest-villa.jpg",
  // TODO(client): 豪景花園 photo not supplied. Do NOT substitute
  // public/branches/hong-kong-garden.jpg — that is the 青山公路豪景分行 shopfront
  // at 青龍頭村11號地下, not the estate.
  "hong-kong-garden": null,
};

export function getEstatePhoto(slug: string): string | null {
  return estatePhotos[slug] ?? null;
}

export function getEstatePageContent(slug: string): EstatePageContent | null {
  if (!Object.prototype.hasOwnProperty.call(estatePageContent, slug))
    return null;
  return estatePageContent[slug as keyof typeof estatePageContent];
}

export const coreEstatePageSlugs = Object.keys(estatePageContent);
