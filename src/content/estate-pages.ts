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
    throw new Error(`estate-pages.ts: estatePageContent requires a nameEn, but "${slug}" has none`);
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
    watchouts: ["不同期數景觀和實用率差異大", "熱門座向叫價較硬", "繁忙時間需預留接駁交通時間"],
    transportLifestyle:
      "小巴及巴士接駁荃灣、九龍、港島和機場方向，日常生活依靠深井商店、餐飲和鄰近屋苑配套。",
    marketNote: "成交和呎價需要按期數、座向、樓層和海景質素分開比較，不能只看屋苑平均數。",
    saleCta: "想買碧堤半島？講低預算、期數和海景要求，代理幫你配盤。",
    rentCta: "想租碧堤半島？講低月租、入住日期和房數，代理幫你搵盤。",
    valuationCta: "碧堤半島業主可 WhatsApp 索取深井業主估價報告。",
    faqs: [
      {
        question: "碧堤半島適合自住定投資？",
        answer: "兩者都適合。自住買家重視海景和會所，投資者則會留意租客需求、叫租和管理質素。",
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
    watchouts: ["分期多，質素和景觀要逐個比較", "樓齡較新盤高", "部分座數與交通接駁距離較遠"],
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
        answer: "要留意期數、維修、景觀、座向和交通接駁位置，最好用同一期數近期成交作比較。",
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
    watchouts: ["交通較依賴巴士小巴或自駕", "屋苑不同座數位置差異大", "樓齡和維修狀態要仔細檢查"],
    transportLifestyle:
      "主要依靠青山公路交通往返荃灣、屯門和機場方向，適合能接受巴士小巴或自駕的家庭。",
    marketNote: "豪景花園成交比較要留意座數、面積、裝修和景觀，單看平均呎價容易失真。",
    saleCta: "想買豪景花園？講低預算、面積和交通要求，代理幫你配盤。",
    rentCta: "想租豪景花園？講低月租和入住日期，代理幫你篩選可睇盤。",
    valuationCta: "豪景花園業主可 WhatsApp 查詢青龍頭同類單位估值。",
    faqs: [
      {
        question: "豪景花園適合家庭客嗎？",
        answer: "適合重視空間和預算效率的家庭，但要先確認日常交通和校網安排是否配合生活需要。",
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
    transportLifestyle: "日常可使用深井青山公路交通和生活配套，適合接受非鐵路步行生活圈的住戶。",
    marketNote: "海韻花園估值應按海景質素和單位狀態比較，近期可睇盤量亦會影響議價空間。",
    saleCta: "想買海韻花園？講低景觀、預算和面積要求，代理幫你留意新盤。",
    rentCta: "想租海韻花園？講低月租、入住日期和景觀要求，代理幫你配盤。",
    valuationCta: "海韻花園業主可 WhatsApp 查詢臨海單位估值。",
    faqs: [
      {
        question: "海韻花園最大賣點是甚麼？",
        answer: "主要是臨海位置、景觀和較寧靜的居住感，適合把景觀和生活節奏放在前面的買家。",
      },
      {
        question: "海韻花園盤源多嗎？",
        answer: "盤源會按市場流通變化，建議直接 WhatsApp 查詢最新可睇盤和業主叫價。",
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
    watchouts: ["樓齡較高，單位狀態差異大", "景觀和座向要逐間比較", "優質放盤流通速度快"],
    transportLifestyle:
      "鄰近深井主要商店、餐飲和青山公路交通，適合想住在深井核心生活圈的買家和租客。",
    marketNote: "麗都花園成交比較應分開看裝修、景觀和樓層，租盤則要留意交吉時間和家具電器狀態。",
    saleCta: "想買麗都花園？講低預算和單位狀態要求，代理幫你篩盤。",
    rentCta: "想租麗都花園？講低月租、入住日期和家具要求，代理幫你搵盤。",
    valuationCta: "麗都花園業主可直接 WhatsApp 地舖團隊查詢估值。",
    faqs: [
      {
        question: "麗都花園適合租客嗎？",
        answer: "適合。麗都花園位置成熟，生活配套方便，對想住深井核心生活圈的租客有吸引力。",
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
    marketNote:
      "成交應按座向、景觀、樓層、裝修與車位分開比較；平均呎價只由 Neon 成交資料動態計算。",
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
  "tai-wah-hin": {
    ...estatePageIdentity("tai-wah-hin"),
    heroPositioning: "浪翠園五期的大單位低密度選擇，適合重視空間、海景與車位的家庭。",
    overview: [
      "帝華軒是浪翠園第 5 期，市場亦以 Royal Sea Crest 或 Sea Crest Villa Phase 5 搜尋。",
      "單位以大三房為主，睇樓重點包括景觀、露台、裝修、車位，以及與浪翠園其他期數的管理和位置差異。",
    ],
    buyerFit: [
      "想在青龍頭尋找逾千呎家庭單位的換樓客。",
      "重視低密度、海景、車位和實用空間的家庭。",
      "熟悉浪翠園生活圈但希望選擇較大戶型的買家。",
    ],
    pros: ["大單位供應集中", "兩座低密度規模", "可與浪翠園其他期數同區比較"],
    watchouts: [
      "搜尋時須同時匹配帝華軒及浪翠園五期",
      "成交量較低，單一成交未必代表整體",
      "車位、景觀和裝修對價格影響較大",
    ],
    transportLifestyle:
      "主要依靠青山公路及龍騰路一帶巴士、小巴或自駕往返荃灣及市區；睇樓時應實測繁忙時間接駁。",
    marketNote: "不可與浪翠園一至四期混合計算平均呎價；交易、放盤和比較表須以獨立 estate_id 為準。",
    saleCta: "想買帝華軒？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租帝華軒？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "帝華軒業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "帝華軒同浪翠園有甚麼關係？",
        answer:
          "帝華軒是浪翠園第 5 期，公開平台亦會使用 Royal Sea Crest 或 Sea Crest Villa Phase 5。",
      },
      {
        question: "搜尋帝華軒放盤要用甚麼關鍵字？",
        answer: "建議同時搜尋帝華軒、浪翠園五期、Royal Sea Crest 及 Sea Crest Villa Phase 5。",
      },
    ],
    relatedLinks: [
      { href: "/estate/sea-crest-villa", label: "比較浪翠園其他期數" },
      { href: "/estate/lung-tang-kok", label: "比較龍騰閣" },
      { href: "/listings?deal=all&estate=tai-wah-hin&page=1", label: "帝華軒放盤" },
    ],
  },
  "hoi-wan-toi": {
    ...estatePageIdentity("hoi-wan-toi"),
    heroPositioning: "深井單幢臨海住宅，適合想要海景、較簡潔屋苑規模和家庭戶型的買家。",
    overview: [
      "海韻臺位於青山公路深井段，市場上亦常寫作「海韻台」；它與附近的海韻花園是兩個不同屋苑。",
      "買家通常比較高低層景觀、座向、裝修，以及單幢管理與大型屋苑會所和盤源量之間的取捨。",
    ],
    buyerFit: [
      "喜歡單幢屋苑、希望社區較簡潔的自住客。",
      "在深井尋找兩至三房或較大面積單位的家庭。",
      "重視海景但不一定需要大型屋苑規模的買家。",
    ],
    pros: ["單幢規模簡潔", "家庭戶至較大單位選擇", "位處成熟深井生活圈"],
    watchouts: ["不可與海韻花園混淆", "盤源與成交量少於大型屋苑", "樓齡、公共地方及維修狀況需檢查"],
    transportLifestyle:
      "可利用青山公路巴士、小巴和自駕接駁荃灣及市區；日常購物與餐飲可使用深井生活圈配套。",
    marketNote: "成交必須使用本身 estate_id，不可混入海韻花園或其他相似名稱屋苑。",
    saleCta: "想買海韻臺？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租海韻臺？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "海韻臺業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "海韻臺同海韻花園是同一屋苑嗎？",
        answer: "不是。海韻臺英文為 Rhine Terrace；海韻花園英文為 Rhine Garden，必須分開處理。",
      },
      {
        question: "海韻臺適合甚麼買家？",
        answer: "適合重視深井生活圈、海景和單幢屋苑規模，並接受盤源較少的自住家庭。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/rhine-garden", label: "比較海韻花園" },
      { href: "/listings?deal=all&estate=hoi-wan-toi&page=1", label: "海韻臺放盤" },
    ],
  },
  "chun-wong-kui": {
    ...estatePageIdentity("chun-wong-kui"),
    heroPositioning: "深井高層海景地標，適合重視開揚景觀、會所與家庭間隔的換樓客。",
    overview: [
      "縉皇居位於深慈街，樓宇高度和臨海景觀是主要辨識點，單位由家庭戶至較大戶型都有。",
      "睇樓時應比較座數、方向、海景遮擋、樓層、裝修及升降機等候情況，而不是只看屋苑平均呎價。",
    ],
    buyerFit: [
      "重視高層海景和會所配套的家庭。",
      "由市區換入較大單位但仍想留在深井生活圈的買家。",
      "希望比較碧堤半島、海雲軒和深井高層屋苑的換樓客。",
    ],
    pros: ["高層海景選擇", "家庭戶型跨度較大", "嘉里發展及屋苑辨識度高"],
    watchouts: [
      "熱門海景方向與樓景叫價差距大",
      "高層大廈需留意升降機及管理安排",
      "公開資料有 558／560 伙差異",
    ],
    transportLifestyle:
      "主要以深井巴士、小巴及自駕接駁荃灣、九龍和港島方向，生活配套可使用深井商店、餐飲及鄰近屋苑商場。",
    marketNote:
      "市場比較要按座數、樓層、景觀和面積拆分；成交資料及平均呎價由 Neon 動態計算並顯示日期。",
    saleCta: "想買縉皇居？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租縉皇居？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "縉皇居業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "縉皇居適合哪類家庭？",
        answer: "適合重視高層海景、會所和家庭戶型，並接受以巴士、小巴或自駕通勤的買家。",
      },
      {
        question: "買縉皇居最重要看甚麼？",
        answer: "應比較座數、方向、海景遮擋、樓層、裝修及相近面積近期成交。",
      },
    ],
    relatedLinks: [
      { href: "/district/sham-tseng", label: "深井地區攻略" },
      { href: "/estate/bellagio", label: "比較碧堤半島" },
      { href: "/listings?deal=all&estate=chun-wong-kui&page=1", label: "縉皇居放盤" },
    ],
  },
  "lung-tang-kok": {
    ...estatePageIdentity("lung-tang-kok"),
    heroPositioning: "青龍頭大面積低密度住宅，適合追求實用空間、私隱和海景的家庭。",
    overview: [
      "龍騰閣位於青山公路青龍頭段，單位面積大、總伙數少，是沿線較少見的低密度家庭住宅。",
      "成交量不高，買家應把單位狀況、景觀、車位、公共地方維修和大廈工程紀錄放在價格前一併評估。",
    ],
    buyerFit: [
      "需要大面積四房或多用途空間的家庭。",
      "重視私隱、低密度和車位安排的換樓客。",
      "願意接受較低流通量和較長持有期的自住買家。",
    ],
    pros: ["單位面積大", "總伙數少、私隱度較高", "青龍頭山海環境"],
    watchouts: [
      "樓齡較高，需查閱維修及大廈工程",
      "成交量低，估值不能只靠單一紀錄",
      "發展商資料未有足夠可靠來源",
    ],
    transportLifestyle:
      "日常主要靠青山公路巴士、小巴或自駕，睇樓時宜實測往返荃灣、深井和主要工作地點的繁忙時間。",
    marketNote: "交易疏落，頁面應顯示最近成交日期與樣本數；樣本不足時不要展示看似精確的平均呎價。",
    saleCta: "想買龍騰閣？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租龍騰閣？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "龍騰閣業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "龍騰閣適合甚麼買家？",
        answer: "適合重視大面積、低密度、私隱與車位，並接受樓齡較高及成交量較低的家庭。",
      },
      {
        question: "龍騰閣估價為何要看較長成交期？",
        answer: "屋苑只有少量單位，短期可能沒有足夠同類成交，要同時參考較長時段和現有放盤。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road/sham-tseng", label: "深井／青龍頭生活圈" },
      { href: "/estate/tai-wah-hin", label: "比較帝華軒" },
      { href: "/listings?deal=all&estate=lung-tang-kok&page=1", label: "龍騰閣放盤" },
    ],
  },
  "mun-ming-shan": {
    ...estatePageIdentity("mun-ming-shan"),
    heroPositioning: "掃管笏大型低密度屋苑，分層與洋房兼備，適合重視新樓齡與生活空間的家庭。",
    overview: [
      "滿名山由分層住宅與洋房組成，戶型跨度大，買家要先確定滿庭、名庭或山庭等產品類型。",
      "分層、特色戶和洋房不可用同一平均數概括，成交與放盤應按產品、景觀、戶外空間和車位分開呈現。",
    ],
    buyerFit: [
      "希望在掃管笏尋找較新大型屋苑的家庭。",
      "需要由細戶至四房或洋房多元選擇的買家。",
      "重視會所、綠化、車位和低密度居住感的換樓客。",
    ],
    pros: ["分層與洋房選擇多", "樓齡相對較新", "大型會所及園林生活"],
    watchouts: [
      "不同庭院及產品差異大",
      "日常交通較依賴巴士、小巴或自駕",
      "公開資料有 1,100／1,101 伙差異",
    ],
    transportLifestyle:
      "主要透過掃管笏及青山公路巴士、小巴和自駕連接屯門、荃灣及市區；實際通勤應按個人時段試走。",
    marketNote:
      "成交圖表必須提供產品類型，至少把洋房排除於一般分層平均值，並顯示樣本數與資料日期。",
    saleCta: "想買滿名山？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租滿名山？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "滿名山業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "滿名山分層單位和洋房應怎樣比較？",
        answer: "兩者面積、戶外空間、車位和流通量不同，應分開看近期成交及放盤。",
      },
      {
        question: "滿名山適合哪類家庭？",
        answer: "適合重視較新屋苑、會所、綠化及多元戶型，並接受非港鐵步行生活圈的家庭。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/seong-yuen", label: "比較上源" },
      { href: "/listings?deal=all&estate=mun-ming-shan&page=1", label: "滿名山放盤" },
    ],
  },
  "wong-gam-hoi-ngon": {
    ...estatePageIdentity("wong-gam-hoi-ngon"),
    heroPositioning: "青山灣成熟海濱大屋苑，生活配套、海景與多期數選擇兼備。",
    overview: [
      "香港黃金海岸分期發展，單位面積、樓齡、景觀和位置差異大，買家應先確定期數與戶型。",
      "屋苑鄰近海濱、商場及休閒配套，但各座往交通站點和生活設施的步行距離不同。",
    ],
    buyerFit: [
      "重視海濱生活、成熟配套和會所的家庭。",
      "希望在多期數、多面積選擇中控制預算的買家。",
      "看重租務需求與屋苑知名度的長線投資者。",
    ],
    pros: ["成熟海濱生活圈", "期數與戶型選擇多", "屋苑辨識度及配套較完整"],
    watchouts: [
      "五期樓齡和位置差異大",
      "公開總伙數有 2,052／2,168 等口徑",
      "部分座數距離主要交通站點較遠",
    ],
    transportLifestyle:
      "可使用青山公路巴士、小巴及自駕往返屯門、荃灣、九龍和港島方向；睇樓時要按座數實測接駁距離。",
    marketNote:
      "市場圖表應按期數、座向及面積分組；香港黃金海岸與黃金海灣是不同屋苑，MLS alias 不可互相吞併。",
    saleCta: "想買香港黃金海岸？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租香港黃金海岸？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta:
      "香港黃金海岸業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "香港黃金海岸有甚麼選樓重點？",
        answer:
          "先比較期數、座數、樓齡、景觀、面積及往交通和商場的距離，再用同一期數近期成交判斷。",
      },
      {
        question: "香港黃金海岸和黃金海灣是同一屋苑嗎？",
        answer:
          "不是。Hong Kong Gold Coast 與 Gold Coast Bay 的地址、樓齡、slug 和 estate_id 都不同。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/oi-kam-hoi-ngon", label: "比較愛琴海岸" },
      { href: "/listings?deal=all&estate=wong-gam-hoi-ngon&page=1", label: "香港黃金海岸放盤" },
    ],
  },
  "oi-kam-hoi-ngon": {
    ...estatePageIdentity("oi-kam-hoi-ngon"),
    heroPositioning: "掃管笏成熟會所屋苑，兩至三房供應較集中，適合家庭及租務買家。",
    overview: [
      "愛琴海岸由七座住宅組成，單位面積主要集中在兩至三房家庭戶，較容易以相近面積和座向比較成交。",
      "買家會重點比較高低層、海景或內園景、座數位置、裝修、車位及往交通站點的距離。",
    ],
    buyerFit: [
      "想找成熟會所屋苑兩至三房的家庭。",
      "重視戶型供應集中、方便比較成交的買家。",
      "關注掃管笏租務和較易管理面積的投資者。",
    ],
    pros: ["兩至三房供應集中", "屋苑規模及會所成熟", "區內生活配套較易使用"],
    watchouts: [
      "不同座數景觀與道路聲影響不同",
      "樓齡與公共地方保養要檢查",
      "非港鐵步行生活圈，需評估接駁",
    ],
    transportLifestyle:
      "主要利用掃管笏及青山公路巴士、小巴和自駕往返屯門、荃灣及市區；實際路線和班次以最新營運資料為準。",
    marketNote: "成交比較應控制座數、面積、景觀和樓層；放盤呎價與註冊成交呎價要分開標示。",
    saleCta: "想買愛琴海岸？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租愛琴海岸？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "愛琴海岸業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "愛琴海岸主要有甚麼戶型？",
        answer:
          "公開屋苑資料顯示實用面積約 490–811 呎，供應以兩至三房為主；實際間隔以個別圖則為準。",
      },
      {
        question: "買愛琴海岸應比較哪幾項？",
        answer: "建議比較座數位置、景觀、樓層、裝修、車位及相近面積近期成交。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/wong-gam-hoi-ngon", label: "比較香港黃金海岸" },
      { href: "/listings?deal=all&estate=oi-kam-hoi-ngon&page=1", label: "愛琴海岸放盤" },
    ],
  },
  "tai-yu": {
    ...estatePageIdentity("tai-yu"),
    heroPositioning: "青山灣近年落成三期屋苑，細戶至家庭戶齊全，適合上車、收租與小家庭。",
    overview: [
      "帝御由金灣、星濤及嵐天三期組成，戶型由開放式至較大家庭單位，買家應先按期數和面積收窄選擇。",
      "三期的座數、落成年份、景觀和戶型組合不同；搜尋、成交和比較表應保留 phase 欄位。",
    ],
    buyerFit: [
      "重視較新樓齡和會所的上車客或小家庭。",
      "尋找細面積收租盤、同時要求屋苑規模的投資者。",
      "希望在青山灣比較新盤與成熟屋苑的買家。",
    ],
    pros: ["樓齡較新", "由開放式至家庭戶選擇多", "三期大型會所生活"],
    watchouts: ["三期產品和戶型差異大", "細戶需仔細比較實用間隔及儲物", "一手和二手資料不可混用"],
    transportLifestyle:
      "主要使用青山公路沿線巴士、小巴及自駕，並可接駁屯門生活圈；實際交通時間應按出發時段測試。",
    marketNote: "成交及供應須按金灣、星濤、嵐天分組；一手銷售資料與二手註冊成交和真盤要分開。",
    saleCta: "想買帝御？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租帝御？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "帝御業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "帝御包括哪三期？",
        answer:
          "帝御包括第 1 期金灣 Seacoast Royale、第 2 期星濤 Starfront Royale及第 3 期嵐天 Skypoint Royale。",
      },
      {
        question: "比較帝御成交要注意甚麼？",
        answer: "應按期數、面積、戶型、景觀和樓層分組，避免用細戶成交直接推算家庭戶或特色戶。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/wong-gam-hoi-waan", label: "比較黃金海灣" },
      { href: "/listings?deal=all&estate=tai-yu&page=1", label: "帝御放盤" },
    ],
  },
  "wong-gam-hoi-waan": {
    ...estatePageIdentity("wong-gam-hoi-waan"),
    heroPositioning: "青山灣新式兩期臨海項目，適合重視新樓、會所與細戶選擇的買家。",
    overview: [
      "黃金海灣分為意嵐 The Uppland 與珀岸 The Reserve 兩期，產品由細面積單位至較大家庭戶，頁面必須按期數標示。",
      "項目較新，一手資料、已入伙二手放盤與註冊成交可能同時存在，資訊來源、日期和性質需清楚分開。",
    ],
    buyerFit: [
      "重視新樓齡、會所和現代戶型的上車客或小家庭。",
      "希望比較帝御與青山灣新式屋苑的買家。",
      "關注新盤租務和細面積產品的投資者。",
    ],
    pros: ["樓齡新", "兩期戶型選擇多", "青山灣臨海生活定位"],
    watchouts: [
      "兩期關鍵日期及銷售狀態不同",
      "一手價單不可當作二手市場成交",
      "細戶要實地評估收納與實用間隔",
    ],
    transportLifestyle:
      "主要透過青山公路巴士、小巴及自駕接駁屯門、荃灣與市區；新路線或班次必須引用最新營運資料。",
    marketNote: "一手成交、二手成交和業主放盤必須分開；市場快照不得混合不同資料口徑。",
    saleCta: "想買黃金海灣？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租黃金海灣？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "黃金海灣業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "黃金海灣包括哪兩期？",
        answer: "第 1 期為意嵐 The Uppland，第 2 期為珀岸 The Reserve；兩期資料應分開顯示。",
      },
      {
        question: "黃金海灣和香港黃金海岸是否同一屋苑？",
        answer:
          "不是。Gold Coast Bay 與 Hong Kong Gold Coast 的地址、樓齡、slug 和 estate_id 不同。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/tai-yu", label: "比較帝御" },
      { href: "/listings?deal=all&estate=wong-gam-hoi-waan&page=1", label: "黃金海灣放盤" },
    ],
  },
  "sing-tai": {
    ...estatePageIdentity("sing-tai"),
    heroPositioning: "掃管笏低密度分層與洋房社區，適合重視私隱、空間和車位的換樓家庭。",
    overview: [
      "星堤由分層住宅與洋房組成，產品跨度大；買家應先決定分層、複式或洋房，再比較景觀、戶外空間和車位。",
      "低密度環境是主要賣點，但成交量和盤源會因產品類型而明顯不同，估值需要更多個案比較。",
    ],
    buyerFit: [
      "重視低密度、園林、私隱與車位的家庭。",
      "需要大面積、複式或洋房選擇的換樓客。",
      "接受較低流通量、以長線自住為主的買家。",
    ],
    pros: ["低密度園林環境", "分層、複式與洋房選擇", "新鴻基屋苑管理及會所"],
    watchouts: ["不同產品價值差距大", "最大實用面積公開資料差異很大", "交通較依賴巴士、小巴或自駕"],
    transportLifestyle:
      "主要透過掃管笏及青山公路沿線交通接駁屯門、荃灣和市區；有車家庭仍需確認車位使用條款。",
    marketNote: "成交頁必須把分層、複式及洋房分類；樣本少時顯示中位數或隱藏平均值。",
    saleCta: "想買星堤？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租星堤？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "星堤業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "星堤分層和洋房可以直接比較嗎？",
        answer: "不建議。兩者面積、戶外空間、車位和流通量不同，應分開比較近期成交和放盤。",
      },
      {
        question: "星堤適合甚麼家庭？",
        answer: "適合重視低密度、空間、私隱與車位，並接受非港鐵步行生活圈的換樓家庭。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/mun-ming-shan", label: "比較滿名山" },
      { href: "/listings?deal=all&estate=sing-tai&page=1", label: "星堤放盤" },
    ],
  },
  "seong-yuen": {
    ...estatePageIdentity("seong-yuen"),
    heroPositioning: "掃管笏大型低密度社區，分層與洋房並存，適合重視新樓齡和多元戶型的家庭。",
    overview: [
      "上源由分層大廈和洋房組成，單位由一房至大型洋房，買家應按產品、座數、景觀和車位先行分類。",
      "部分平台把分層大廈按 A／B 子座計作十座，另有資料以五座大廈描述；頁面應顯示組成文字。",
    ],
    buyerFit: [
      "希望在掃管笏尋找較新大型屋苑的家庭。",
      "由一房、家庭戶至洋房都想保留選擇的買家。",
      "重視會所、寵物友善和低密度感的自住客。",
    ],
    pros: ["樓齡較新", "戶型及面積選擇廣", "分層與洋房兼備"],
    watchouts: ["座數統計口徑不同", "不同產品不可混合比較", "日常交通較依賴接駁或自駕"],
    transportLifestyle:
      "主要使用掃管笏路及青山公路巴士、小巴或自駕接駁屯門、荃灣及市區；睇樓時應按座數測試步行和等車時間。",
    marketNote: "成交及放盤必須標記分層或洋房；平均呎價只可在同類產品和足夠樣本下展示。",
    saleCta: "想買上源？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租上源？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "上源業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "上源有多少座？",
        answer:
          "公開平台有兩種口徑：五座分層大廈可再按 A／B 子座描述，另有三十間洋房；頁面以組成文字說明。",
      },
      {
        question: "上源成交應怎樣比較？",
        answer: "先分開分層與洋房，再按房數、面積、景觀、樓層、戶外空間和車位比較。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/mun-ming-shan", label: "比較滿名山" },
      { href: "/listings?deal=all&estate=seong-yuen&page=1", label: "上源放盤" },
    ],
  },
  "the-carmel": {
    ...estatePageIdentity("the-carmel"),
    heroPositioning: "大欖低密度精品住宅，細戶與洋房同場，適合重視私隱和新樓質素的買家。",
    overview: [
      "The Carmel 由兩座分層住宅及多間洋房組成，供應由細面積單位至大型獨立屋，市場比較必須先分產品類型。",
      "屋苑總伙數較少，盤源與成交未必連續；睇樓時應確認車位、花園、天台、維修責任和管理費。",
    ],
    buyerFit: [
      "重視較新低密度住宅和私隱的家庭。",
      "想在同一屋苑比較細戶、家庭戶與洋房的買家。",
      "有車、需要戶外空間或長線自住的換樓客。",
    ],
    pros: ["樓齡較新", "低密度及私隱度", "分層與洋房產品並存"],
    watchouts: ["盤源和成交量較低", "不同產品不可混合估值", "交通及日常採購較依賴接駁或自駕"],
    transportLifestyle:
      "主要透過青山公路巴士、小巴及自駕連接屯門、荃灣和市區；洋房買家亦應核實車位數量和充電安排。",
    marketNote: "市場快照應把分層與洋房分開；樣本不足時顯示最近成交清單而非整體平均呎價。",
    saleCta: "想買The Carmel？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租The Carmel？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta:
      "The Carmel業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "The Carmel 有甚麼物業類型？",
        answer: "公開屋苑資料顯示項目包括兩座分層住宅及四十八間洋房，面積跨度大，應分開比較。",
      },
      {
        question: "The Carmel 適合哪類買家？",
        answer: "適合重視新樓、低密度、私隱、車位和戶外空間，並接受較少盤源的自住家庭。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/oma-oma", label: "比較 OMA OMA" },
      { href: "/listings?deal=all&estate=the-carmel&page=1", label: "The Carmel 放盤" },
    ],
  },
  "oma-oma": {
    ...estatePageIdentity("oma-oma"),
    heroPositioning: "掃管笏較新四座屋苑，戶型由開放式至家庭戶，適合上車與小家庭。",
    overview: [
      "OMA OMA 由四座住宅組成，戶型由細面積單位延伸至較大家庭戶，買家應先按房數和實用間隔比較。",
      "樓齡較新是主要優點，但仍要評估景觀、道路聲、座數位置、收納、會所距離和交通接駁。",
    ],
    buyerFit: [
      "重視較新樓齡和會所的上車客。",
      "尋找一至三房、希望控制總價的小家庭。",
      "關注掃管笏新式屋苑租務的投資者。",
    ],
    pros: ["樓齡較新", "四座規模較易掌握", "由細戶至家庭戶選擇"],
    watchouts: [
      "細戶要仔細評估實用間隔",
      "不同座向可能受道路或樓景影響",
      "通勤較依賴巴士、小巴或自駕",
    ],
    transportLifestyle:
      "主要透過掃管笏路及青山公路巴士、小巴或自駕接駁屯門、荃灣與市區；實際步行與等車時間需按座數測試。",
    marketNote: "成交比較應控制座數、房數、面積和景觀；一手紀錄、二手成交及放盤叫價須清楚分開。",
    saleCta: "想買OMA OMA？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租OMA OMA？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "OMA OMA業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "OMA OMA 適合上車嗎？",
        answer:
          "屋苑提供細面積至家庭戶型，適合希望較新樓齡的上車客，但仍要按間隔、管理費和交通綜合評估。",
      },
      {
        question: "買 OMA OMA 最需要比較甚麼？",
        answer: "建議比較座數、景觀、道路聲、房數、收納、樓層及相近面積近期成交。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/the-carmel", label: "比較 The Carmel" },
      { href: "/listings?deal=all&estate=oma-oma&page=1", label: "OMA OMA 放盤" },
    ],
  },
  "lin-shan": {
    ...estatePageIdentity("lin-shan"),
    heroPositioning: "小欖低密度住宅群，單位較大、環境較靜，適合重視空間與私隱的家庭。",
    overview: [
      "漣山位於青發里，由多座低密度住宅組成，單位面積較大，買家通常比較座數、景觀、樓層、平台或花園及車位。",
      "屋苑總伙數不多，短期成交樣本可能有限；樓齡、外牆及公共地方維修紀錄亦是重要盡職審查項目。",
    ],
    buyerFit: [
      "需要較大面積和多房戶型的家庭。",
      "重視低密度、寧靜、私隱和車位的換樓客。",
      "願意接受較少盤源、以長線自住為主的買家。",
    ],
    pros: ["低密度居住感", "單位面積較大", "小欖山海環境"],
    watchouts: ["成交量與盤源較少", "樓齡及維修狀況需檢查", "日常交通和採購較依賴接駁或自駕"],
    transportLifestyle:
      "主要靠青山公路巴士、小巴或自駕接駁屯門、荃灣和市區；有車家庭應確認車位業權或使用安排。",
    marketNote:
      "估值要參考較長時段成交並控制座數、面積、景觀、戶外空間和車位；樣本不足時隱藏平均數。",
    saleCta: "想買漣山？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租漣山？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "漣山業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "漣山適合哪類家庭？",
        answer: "適合需要較大面積、重視低密度、私隱與車位，並接受非港鐵步行生活圈的家庭。",
      },
      {
        question: "漣山估價要注意甚麼？",
        answer: "成交量較少，應把較長時段成交、現有放盤、裝修、戶外空間及車位一併比較。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/long-tou-waan", label: "比較浪濤灣" },
      { href: "/listings?deal=all&estate=lin-shan&page=1", label: "漣山放盤" },
    ],
  },
  "long-tou-waan": {
    ...estatePageIdentity("long-tou-waan"),
    heroPositioning: "小欖臨海低密度屋苑，分層與洋房兼備，適合追求海景、空間和度假感的家庭。",
    overview: [
      "浪濤灣由分層住宅及洋房組成，海景、戶外空間和低密度是主要特色；買家要先分清產品類型。",
      "睇樓重點包括景觀遮擋、海風及外牆狀況、花園或天台、車位、管理費和往主要交通站點的距離。",
    ],
    buyerFit: [
      "重視海景、低密度和較大生活空間的家庭。",
      "需要分層、複式或洋房選擇的換樓客。",
      "有車、喜歡小欖寧靜生活節奏的自住買家。",
    ],
    pros: ["臨海及度假感", "分層與洋房選擇", "低密度和私隱度"],
    watchouts: ["海濱樓宇保養及維修要檢查", "盤源及成交量較少", "不同產品不可混合估值"],
    transportLifestyle:
      "主要依靠青山公路巴士、小巴及自駕接駁屯門、荃灣和市區；有車家庭應確認車位和充電安排。",
    marketNote:
      "成交與放盤須分開分層、洋房及特色戶；樣本不足時顯示原始紀錄，不輸出虛假精確平均值。",
    saleCta: "想買浪濤灣？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租浪濤灣？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "浪濤灣業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "浪濤灣有甚麼物業類型？",
        answer: "公開資料顯示屋苑包括六座分層住宅及三十二間洋房，兩者應分開比較成交與放盤。",
      },
      {
        question: "買浪濤灣應特別檢查甚麼？",
        answer: "除景觀和間隔外，應查閱海濱樓宇保養、外牆及公共地方維修、車位和管理費。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/lin-shan", label: "比較漣山" },
      { href: "/listings?deal=all&estate=long-tou-waan&page=1", label: "浪濤灣放盤" },
    ],
  },
  "tai-tou-waan": {
    ...estatePageIdentity("tai-tou-waan"),
    heroPositioning: "小欖成熟大型海景屋苑，兩期多座供應，適合重視空間、會所和較務實選擇的家庭。",
    overview: [
      "帝濤灣分兩期發展，市場常以浪琴軒、海琴軒及相關英文名搜尋；買家必須先確認期數、座數和戶型。",
      "單位由兩房至較大家庭戶，景觀、樓層、車位、裝修與兩期位置差異會直接影響價格和租務。",
    ],
    buyerFit: [
      "重視成熟會所、海景和家庭空間的買家。",
      "希望在小欖比較大型屋苑與低密度項目的家庭。",
      "接受非港鐵步行生活圈、以自住或長線持有為主的買家。",
    ],
    pros: ["兩期多座供應", "家庭戶型及會所成熟", "小欖海景生活環境"],
    watchouts: ["兩期名稱及產品要分清", "最大實用面積公開資料差異大", "樓齡、維修和交通接駁要評估"],
    transportLifestyle:
      "主要利用青山公路巴士、小巴及自駕接駁屯門、荃灣與市區；應按實際座數測試步行和通勤。",
    marketNote:
      "成交比較應按期數、座數、面積和景觀分組；浪琴軒與海琴軒的盤源標籤須在 MLS 正規化中保留。",
    saleCta: "想買帝濤灣？講低預算、房數、景觀和其他要求，代理幫你配盤。",
    rentCta: "想租帝濤灣？講低月租、入住日期和房數，代理幫你找可睇單位。",
    valuationCta: "帝濤灣業主可提供座數／期數、樓層、面積、景觀及裝修，索取同類成交與放盤比較。",
    faqs: [
      {
        question: "帝濤灣比較時為何要分期？",
        answer: "兩期的座數、位置、景觀與戶型不同，成交和放盤應先按期數分類。",
      },
      {
        question: "買帝濤灣最需要留意甚麼？",
        answer: "建議比較期數、座數、面積、景觀、樓層、車位、維修狀況及相近戶型近期成交。",
      },
    ],
    relatedLinks: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      { href: "/estate/wong-gam-hoi-ngon", label: "比較香港黃金海岸" },
      { href: "/listings?deal=all&estate=tai-tou-waan&page=1", label: "帝濤灣放盤" },
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
  if (!Object.prototype.hasOwnProperty.call(estatePageContent, slug)) return null;
  return estatePageContent[slug as keyof typeof estatePageContent];
}

export const coreEstatePageSlugs = Object.keys(estatePageContent);

/**
 * P7e: composes the master plan's 4 named answer-summary questions
 * (適合邊類家庭／交通取捨／同價有咩選擇／睇樓前要留意甚麼) from content this
 * estate already has, rather than writing new templated copy per estate.
 * 適合邊類家庭 and 睇樓前要留意甚麼 reuse `buyerFit`/`watchouts` verbatim;
 * 交通取捨 reuses `transportLifestyle`; 同價有咩選擇 is COMPUTED, not written
 * -- the comparable estates already fetched for EstateComparisonTable,
 * sorted by real avgPsf proximity to this estate, named by their actual
 * figures rather than a hand-written claim. Callers only invoke this once
 * `content` (this function's first argument) is known non-null -- an
 * estate with no `estate-pages.ts` entry gets no answer summary at all,
 * matching the rest of this file's hide-don't-fabricate convention.
 */
export function buildEstateAnswerSummary(
  content: EstatePageContent,
  currentAvgPsf: number | null,
  comparableEstates: readonly { nameZh: string; avgPsf: number | null }[],
): string {
  const parts: string[] = [];

  if (content.buyerFit.length > 0) {
    parts.push(`適合邊類家庭：${content.buyerFit.join("；")}`);
  }

  if (content.transportLifestyle) {
    parts.push(`交通取捨：${content.transportLifestyle}`);
  }

  const pricedComparables = comparableEstates
    .filter((entry): entry is { nameZh: string; avgPsf: number } => entry.avgPsf !== null)
    .sort((a, b) =>
      currentAvgPsf === null
        ? 0
        : Math.abs(a.avgPsf - currentAvgPsf) - Math.abs(b.avgPsf - currentAvgPsf),
    );
  if (pricedComparables.length > 0) {
    const names = pricedComparables.map((entry) => entry.nameZh).join("、");
    parts.push(`同價有咩選擇：可留意 ${names}，實際呎價、單位數及落成年份詳見下方屋苑比較。`);
  }

  if (content.watchouts.length > 0) {
    parts.push(`睇樓前要留意：${content.watchouts.join("；")}`);
  }

  return parts.join(" ");
}
