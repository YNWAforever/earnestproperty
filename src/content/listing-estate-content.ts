/** Sourced editorial content for estates evidenced by active listings on 2026-10-26.
 * Identity and photographs live in estate-registry.ts. Listing/photo provenance
 * and the reviewed linking set live in fixtures/listing-estate-expansion-20261026.json.
 * No numeric market facts are inferred from individual listings.
 */
export type ListingEstateContent = {
  slug: string;
  address: string;
  overview: string[];
  watchout: string;
  transport: string;
  sources: string[];
  seoTitle: string;
  seoDescription: string;
};

export const listingEstateContent: ListingEstateContent[] = [
  {
    slug: "bayview-terrace",
    address: "青山公路青山灣段107號",
    overview: [
      "碧翠花園位於三聖一帶的青山公路青山灣段，是同時提供分層住宅與洋房的私人屋苑。選盤時宜先確定住宅類型，再比較客飯廳、睡房及戶外空間的安排，避免把兩類物業直接作同一標準比較。",
      "公開屋苑資料列有泳池、網球場及兒童遊樂設施，日常康樂配套也是看樓重點。分層單位與洋房的出入口、景觀及管理安排各有不同，適合連同家庭活動和泊車需要一起考慮。",
    ],
    watchout: "同苑兼有洋房及分層住宅，須按實際門牌核對花園、平台與車位是否屬該物業。",
    transport: "由青山公路青山灣段的實際出入口試走接駁路線，並核對往三聖及屯門市中心的候車位置。",
    sources: [
      "https://hk.centanet.com/estate/%E7%A2%A7%E7%BF%A0%E8%8A%B1%E5%9C%92/2-ZMDLTHDVHN",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B0%8F%E6%AC%96-%E6%8E%83%E7%AE%A1%E7%AC%8F-%E9%9D%92%E5%B1%B1%E7%81%A3-%E7%A2%A7%E7%BF%A0%E8%8A%B1%E5%9C%92-E00630",
      "https://www.property.hk/asking_detail/ept/king/6823280.html",
    ],
    seoTitle: "碧翠花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "碧翠花園位於青山公路青山灣段107號。同苑兼有洋房及分層住宅，須按實際門牌核對花園、平台與車位是否屬該物業。晉誠地產 C-018613。",
  },
  {
    slug: "castle-peak-villas",
    address: "樂翠街19號",
    overview: [
      "青山別墅位於小欖樂翠街，屬分層住宅屋苑，名稱中的「別墅」不代表每個單位都是獨立屋。屋苑的座名及單位布局各有分別，尋找家庭居所時可重點比較客飯廳、房間和露台的實際連接方式。",
      "現有放盤可見連露台及車位的選擇，適合把室內空間、戶外活動和駕車安排一併評估。看樓時亦宜留意樓宇及公用部分的保養，並向代理確認車位是否包含在租售條件內。",
    ],
    watchout: "應以樂翠街門牌及座名核對物業；個別來源把地址簡寫為青山公路，不能據此判斷實際入口。",
    transport: "樂翠街附近有青山公路巴士站；建議實走單位至站點的路程，再按日常出發時段核對班次。",
    sources: [
      "https://hk.centanet.com/estate/%E9%9D%92%E5%B1%B1%E5%88%A5%E5%A2%85/2-SUDCFROXRJ",
      "https://www.28hse.com/estate/detail/%E9%9D%92%E5%B1%B1%E5%88%A5%E5%A2%85-4509",
      "https://www.28hse.com/rent/apartment/property-4051997",
    ],
    seoTitle: "青山別墅｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "青山別墅位於樂翠街19號。應以樂翠街門牌及座名核對物業；個別來源把地址簡寫為青山公路，不能據此判斷實際入口。晉誠地產 C-018613。",
  },
  {
    slug: "ching-lai-waan-villas",
    address: "樂翠街6–18號",
    overview: [
      "青麗灣別墅座落小欖樂翠街，是以洋房為主的低密度私人住宅。屋內分層與花園、天台的銜接，是這類物業與一般分層住宅的主要分別，適合按家庭成員的活動習慣逐層看樓。",
      "現有放盤介紹包括私家車房及前後花園的選擇，可把泊車、種植和戶外休憩需要一併考慮。各幢洋房的朝向及配置未必相同，海景、戶外空間和車房條件均應按實際單位確認。",
    ],
    watchout: "洋房的前後花園、天台和車房須逐項核對契約範圍，並實測樓梯對長幼成員是否合用。",
    transport: "以樂翠街實際大門為起點測試步行及駕車動線，再核對接駁青山公路公共交通的安排。",
    sources: [
      "https://hk.centanet.com/estate/%E9%9D%92%E9%BA%97%E7%81%A3%E5%88%A5%E5%A2%85/2-SUCJFROORJ",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B0%8F%E6%AC%96-%E6%8E%83%E7%AE%A1%E7%AC%8F-%E9%9D%92%E5%B1%B1%E7%81%A3-%E9%9D%92%E9%BA%97%E7%81%A3%E5%88%A5%E5%A2%85-E00667",
      "https://www.28hse.com/buy/apartment/property-4049628",
    ],
    seoTitle: "青麗灣別墅｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "青麗灣別墅位於樂翠街6–18號。洋房的前後花園、天台和車房須逐項核對契約範圍，並實測樓梯對長幼成員是否合用。晉誠地產 C-018613。",
  },
  {
    slug: "ching-yung-toi",
    address: "青榕街8號",
    overview: [
      "青榕臺位於青榕街，是三聖一帶的分層私人住宅屋苑。屋苑提供家庭型單位，可按客飯廳尺度、睡房位置及收納需要比較不同座數與戶型，而非只看樓盤照片中的裝修。",
      "公開屋苑資料列有泳池、會所及運動設施，並有巴士、小巴交通資訊。看樓時可同時了解住宅大堂、康樂設施與出入口之間的路程，再衡量日常使用是否方便。",
    ],
    watchout: "青榕街上不同樓層及座向的開揚程度會有分別，宜在室內核對景觀、採光與窗外遮擋。",
    transport: "可比較巴士及小巴接駁方案；由實際座數走到候車點，確認青榕街路段及等車安排是否合用。",
    sources: [
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B0%8F%E6%AC%96-%E6%8E%83%E7%AE%A1%E7%AC%8F-%E9%9D%92%E5%B1%B1%E7%81%A3-%E9%9D%92%E6%A6%95%E5%8F%B0-E00088",
      "https://www.squarefoot.com.hk/cn/estate/detail/%E9%9D%92%E6%A6%95%E5%8F%B0-4506",
      "https://www.28hse.com/buy/apartment/property-4058947",
    ],
    seoTitle: "青榕臺｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "青榕臺位於青榕街8號。青榕街上不同樓層及座向的開揚程度會有分別，宜在室內核對景觀、採光與窗外遮擋。晉誠地產 C-018613。",
  },
  {
    slug: "chui-king-garden",
    address: "青泰路20號",
    overview: [
      "翠景花園位於青泰路，是由洋房組成的低密度住宅，公開資料以歐陸式排屋設計作介紹。尋找較多室內外活動空間的家庭，可把屋內樓層分布、花園使用及泊車動線作為看樓主線。",
      "現有放盤以花園洋房作介紹，實際可用範圍和維護安排值得仔細比較。屋苑規模與一般大型分層社區不同，宜一併了解公用部分管理、保養分工及相關費用。",
    ],
    watchout: "花園是此類洋房的主要比較項目，須核對界線、排水及維護責任，而不只憑放盤面積描述。",
    transport: "先由青泰路實際入口測試步行及行車路線，再核對接駁青山公路交通與日常購物的安排。",
    sources: [
      "https://www.hkp.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B1%AF%E9%96%80-%E7%BF%A0%E6%99%AF%E8%8A%B1%E5%9C%92-E11840",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B0%8F%E6%AC%96-%E6%8E%83%E7%AE%A1%E7%AC%8F-%E9%9D%92%E5%B1%B1%E7%81%A3-%E7%BF%A0%E6%99%AF%E8%8A%B1%E5%9C%92-E11840",
      "https://www.28hse.com/buy/apartment/property-4004523",
    ],
    seoTitle: "翠景花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "翠景花園位於青泰路20號。花園是此類洋房的主要比較項目，須核對界線、排水及維護責任，而不只憑放盤面積描述。晉誠地產 C-018613。",
  },
  {
    slug: "chun-wo-sea-view-garden",
    address: "青山公路青山灣段33號",
    overview: [
      "春和海景花園位於青山公路青山灣段，屬掃管笏一帶的分層私人住宅。屋苑提供家庭型單位，現有放盤亦有露台及連車位的選擇，可按室內空間、戶外活動和駕車需要逐項比較。",
      "公開屋苑資料列有泳池、網球及壁球設施，康樂配套可與單位布局一起考慮。個別放盤以沙灘海景作介紹，景觀仍須按座數、樓層及室內實際視線核對。",
    ],
    watchout: "看樓時應分別站在客飯廳及露台確認景觀，同時了解臨青山公路一側的開窗環境。",
    transport:
      "以青山公路青山灣段實際大門為起點，測試候車及過路安排，並按平日出門時間核對接駁路線。",
    sources: [
      "https://hk.centanet.com/estate/%E6%98%A5%E5%92%8C%E6%B5%B7%E6%99%AF%E8%8A%B1%E5%9C%92/2-SUOVFROYRD",
      "https://www.squarefoot.com.hk/cn/estate/detail/%E6%98%A5%E5%92%8C%E6%B5%B7%E6%99%AF%E8%8A%B1%E5%9B%AD-4516",
      "https://www.28hse.com/buy/apartment/property-4028649",
    ],
    seoTitle: "春和海景花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "春和海景花園位於青山公路青山灣段33號。看樓時應分別站在客飯廳及露台確認景觀，同時了解臨青山公路一側的開窗環境。晉誠地產 C-018613。",
  },
  {
    slug: "chung-yuet-waan",
    address: "青山公路青山灣段28號",
    overview: [
      "棕月灣位於青山公路青山灣段，屬掃管笏一帶的私人住宅。屋苑以家庭型單位為主，現有放盤包括複式選擇，適合把公共活動空間與睡房分層的安排納入比較。",
      "屋苑資料列有泳池、健身室和兒童遊樂設施，可連同日常家庭活動需要一起評估。複式與一般分層單位的生活動線不同，看樓時宜逐層了解房間、浴室及收納配置。",
    ],
    watchout: "現有放盤提及複式及車位，應核對室內樓梯的使用便利，以及車位是否隨物業一併租售。",
    transport: "由青山公路青山灣段的大門測試步行候車及駕車出入，並核對到日常購物地點的實際路線。",
    sources: [
      "https://hk.centanet.com/estate/%E6%A3%95%E6%9C%88%E7%81%A3/2-KEPPWPPYPG",
      "https://www.squarefoot.com.hk/cn/estate/detail/%E6%A3%95%E6%9C%88%E6%B9%BE-4518",
      "https://www.28hse.com/buy/apartment/property-3997966",
    ],
    seoTitle: "棕月灣｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "棕月灣位於青山公路青山灣段，屬掃管笏一帶的私人住宅。屋苑以家庭型單位為主，現有放盤包括複式選擇，適合把公共活動空間與睡房分層的安排納入比較。晉誠地產 C-018613。",
  },
  {
    slug: "fei-yeung",
    address: "青山公路大欖段170號",
    overview: [
      "飛揚位於青山公路大欖段，是分期發展的分層私人住宅屋苑。不同期數、座數與戶型提供不同空間選擇，尋找自住單位時可先確認所需間隔，再比較客飯廳形狀及睡房尺度。",
      "屋苑包含由較精簡至家庭型的戶型，家具擺位和收納安排對實際居住感受尤其重要。看樓時宜按具體期數及單位平面圖，逐一核對廚房、浴室與生活空間的比例。",
    ],
    watchout: "必須核對放盤所屬期數和座數；不同戶型的間隔、外望方向及出入口路程不能互相套用。",
    transport: "以大欖段實際出入口試走候車路線，再按日常往返屯門市中心或市區的時段核對接駁安排。",
    sources: [
      "https://hk.centanet.com/estate/zh-cn/%E9%A3%9E%E6%89%AC/3-KESPWPPHPD",
      "https://www.house730.com/estate-39981/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E9%A3%9B%E6%8F%9A/",
      "https://www.28hse.com/buy/apartment/property-4060439",
    ],
    seoTitle: "飛揚｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "飛揚位於青山公路大欖段170號。必須核對放盤所屬期數和座數；不同戶型的間隔、外望方向及出入口路程不能互相套用。晉誠地產 C-018613。",
  },
  {
    slug: "hoi-ching-hin",
    address: "青發街8號",
    overview: [
      "海澄軒位於小欖青發街，是分層私人住宅屋苑，與其他地區的同名物業須清楚區分。現有放盤包括連車位的家庭型選擇，可把房間分布、客飯廳和泊車需要一起考慮。",
      "公開屋苑資料列有泳池、健身室、壁球場及園林花園，屋內外活動空間可一併比較。各座與不同樓層的景觀、採光及出入動線仍有差別，宜按實際單位看樓。",
    ],
    watchout: "應先確認是小欖青發街的 Villa Sapphire，並核對連車位條款及大堂至停車位置的動線。",
    transport: "由青發街屋苑入口出發測試步行及駕車路線，並核對前往青山公路接駁交通的實際安排。",
    sources: [
      "https://hk.centanet.com/estate/%E6%B5%B7%E6%BE%84%E8%BB%92/2-KEEAWPSXPD",
      "https://www.28hse.com/buy/apartment/property-3984304",
    ],
    seoTitle: "海澄軒｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "海澄軒位於青發街8號。應先確認是小欖青發街的 Villa Sapphire，並核對連車位條款及大堂至停車位置的動線。晉誠地產 C-018613。",
  },
  {
    slug: "hoi-king-garden",
    address: "青榕街1號",
    overview: [
      "海景花園位於三聖青榕街，是由多座住宅大廈組成的私人屋苑。屋苑有不同間隔選擇，家庭可按睡房數目、客飯廳布局及收納需要比較單位，並留意座數與外望方向的分別。",
      "公開屋苑資料列有室外泳池、網球場、羽毛球及兒童遊樂設施，適合把康樂配套納入日常生活考慮。屋苑名稱包含「海景」，但每個單位的視野仍須在實際樓層確認。",
    ],
    watchout: "不同座向的海景及遮擋情況可能不同，應在客廳和睡房分別確認視野，而非只憑屋苑名稱。",
    transport: "以青榕街大門為起點，實走往三聖一帶候車點及生活配套的路線，再核對轉乘屯門站的安排。",
    sources: [
      "https://hk.centanet.com/estate/%E6%B5%B7%E6%99%AF%E8%8A%B1%E5%9C%92/2-KEBAGPYXPB",
      "https://www.earnestproperty.com/property-detail/6718458.html",
    ],
    seoTitle: "海景花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "海景花園位於青榕街1號。不同座向的海景及遮擋情況可能不同，應在客廳和睡房分別確認視野，而非只憑屋苑名稱。晉誠地產 C-018613。",
  },
  {
    slug: "hoi-wai-garden",
    address: "青茵街8號",
    overview: [
      "海慧花園位於三聖青茵街，是兼有分層住宅與洋房的私人屋苑。不同住宅類型的室內分布、戶外空間及出入口各有特色，可先按生活方式選定類型，再比較具體放盤。",
      "現有放盤涵蓋洋房選擇，公用康樂資料亦列有泳池及運動設施。看樓時宜把單位、停車位置和公用部分串連成日常動線，了解實際使用是否符合家庭需要。",
    ],
    watchout: "同苑的分層住宅與洋房不可直接套用相同條件；花園、平台及車位權益須按個別物業核對。",
    transport: "由青茵街實際出入口試走往三聖一帶的路線，並核對接駁屯門市中心及鐵路的候車安排。",
    sources: [
      "http://ww.manywells.com.hk/info/AQUAMARINEGARDEN",
      "https://www.wepropertyhk.com/estate-detail/759d4f57-5532-4fb6-aecc-66da22caff3b",
      "https://www.hkestatelab.com/estate/aquamarine-garden-kepegpyhpb",
      "https://www.28hse.com/buy/apartment/property-4046208",
    ],
    seoTitle: "海慧花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "海慧花園位於青茵街8號。同苑的分層住宅與洋房不可直接套用相同條件；花園、平台及車位權益須按個別物業核對。晉誠地產 C-018613。",
  },
  {
    slug: "hoi-yu",
    address: "青榕街3號",
    overview: [
      "海譽位於三聖青榕街，是單幢式私人住宅。與多座式屋苑相比，選盤時可更集中比較同一大廈內不同樓層及座向，並按房間位置、客飯廳比例及採光挑選合用單位。",
      "公開屋苑資料列有泳池、健身室及閱讀空間，現有放盤亦以海景和車位選配作介紹。景觀與泊車條件均應逐項確認，並把大堂、車庫與住宅之間的日常動線納入考慮。",
    ],
    watchout: "現有放盤提及可配車位，須確認是另租、另購還是包含在條件內，並實地核對海景視線。",
    transport: "以青榕街實際入口為起點測試步行候車路線，按上班及回家時段比較接駁屯門市中心的安排。",
    sources: [
      "https://www.ricacorp.com/zh-hk/property/estate/%E6%B5%B7%E8%AD%BD-single-%E4%B8%89%E8%81%96-hma-hk",
      "https://www.oneday.com.hk/zh_HK/buildings/crown-by-the-sea/",
      "https://www.28hse.com/buy/apartment/property-3993979",
    ],
    seoTitle: "海譽｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "海譽位於青榕街3號。現有放盤提及可配車位，須確認是另租、另購還是包含在條件內，並實地核對海景視線。晉誠地產 C-018613。",
  },
  {
    slug: "kwan-lun",
    address: "青發里8號",
    overview: [
      "琨崙位於小欖青發里，是結合分層、複式及洋房設計的低密度私人住宅。不同組別和戶型的垂直動線與戶外空間各有分別，選盤前宜先確認是分層單位還是全幢洋房。",
      "公開屋苑資料列有會所、泳池及兒童設施，現有放盤亦可見金琥珀等組別名稱。看樓時宜按實際組別與單位圖則，逐層比較生活、睡房和戶外活動空間的安排。",
    ],
    watchout: "放盤可能使用洋房組別名稱描述分層或複式單位，須核對樓層範圍及是否包含全幢物業。",
    transport: "從青發里實際大門測試步行及駕車出入，再核對接駁青山公路交通與日常購物的路線。",
    sources: [
      "https://www.hkp.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B1%AF%E9%96%80-%E7%90%A8%E5%B4%99-E000014030",
      "https://www.ricacorp.com/zh-hk/property/estate/%E7%90%A8%E5%B4%99-estate-%E5%B0%8F%E6%AC%96-hma-hk",
      "https://hk.centanet.com/estate/%E7%90%A8%E5%B4%99/1-KESPWDPSPG",
      "https://www.28hse.com/buy/apartment/property-3945768",
    ],
    seoTitle: "琨崙｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "琨崙位於青發里8號。放盤可能使用洋房組別名稱描述分層或複式單位，須核對樓層範圍及是否包含全幢物業。晉誠地產 C-018613。",
  },
  {
    slug: "kwun-hoi-villas",
    address: "青山公路汀九段386號",
    overview: [
      "觀海別墅位於青山公路汀九段，屬汀九／油柑頭一帶的私人住宅。公開屋苑資料及成交紀錄可見複式選擇，適合希望把起居與睡房分層安排的家庭按實際圖則比較。",
      "此處的生活範圍應按汀九及荃灣方向規劃。看樓時可把屋內樓梯、入口與停車安排一併了解，並留意樓宇及公用部分的保養，衡量是否符合日常使用習慣。",
    ],
    watchout: "汀九地址不可與屯門同類海濱屋苑混淆；複式單位應逐層檢視樓梯、採光和室內保養。",
    transport: "由汀九段實際入口測試候車及過路安排，並核對往荃灣市中心和鐵路站的接駁路線。",
    sources: [
      "https://hk.centanet.com/estate/%E8%A7%80%E6%B5%B7%E5%88%A5%E5%A2%85/2-AADKGPWXPE",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E9%BA%97%E5%9F%8E-%E6%B1%80%E4%B9%9D-%E8%A7%80%E6%B5%B7%E5%88%A5%E5%A2%85-E09072",
      "https://www.earnestproperty.com/property-detail/6765816.html",
    ],
    seoTitle: "觀海別墅｜油柑頭／汀九屋苑資料、租售放盤",
    seoDescription:
      "觀海別墅位於青山公路汀九段386號。汀九地址不可與屯門同類海濱屋苑混淆；複式單位應逐層檢視樓梯、採光和室內保養。晉誠地產 C-018613。",
  },
  {
    slug: "lung-chu-island-garden",
    address: "青龍路11號",
    overview: [
      "龍珠島花園位於青龍路，是龍珠島一帶由低層住宅組成的私人屋苑。公開屋苑資料可見家庭型間隔，部分成交紀錄亦涉及花園或天台，可按樓層與戶外空間需要比較單位。",
      "屋苑設有泳池，日常康樂與單位內部空間可一併考慮。不同樓層的出入方式、採光及戶外使用條件未必相同，看樓時宜由入口走到單位，完整體驗日常路程。",
    ],
    watchout: "看樓前應確認上落樓層方式；花園、天台及平台是否專用和隨物業轉讓，須逐項核對。",
    transport: "以青龍路實際大門為起點，測試出入龍珠島及接駁青山公路交通的步行與行車路線。",
    sources: [
      "https://www.hkp.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B1%AF%E9%96%80-%E9%BE%8D%E7%8F%A0%E5%B3%B6%E8%8A%B1%E5%9C%92-E00301",
      "https://www.squarefoot.com.hk/cn/estate/detail/%E9%BE%99%E7%8F%A0%E5%B2%9B%E8%8A%B1%E5%9B%AD-4519",
      "https://www.28hse.com/rent/apartment/property-4045561",
    ],
    seoTitle: "龍珠島花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "龍珠島花園位於青龍路11號。看樓前應確認上落樓層方式；花園、天台及平台是否專用和隨物業轉讓，須逐項核對。晉誠地產 C-018613。",
  },
  {
    slug: "nam-ngon",
    address: "青山公路青山灣段116號",
    overview: [
      "南岸位於三聖一帶的青山公路青山灣段，是單幢式分層私人住宅。屋苑以家庭型間隔為主，公開資料介紹有獨立廚房、露台及工作平台，可按煮食、收納和家庭活動需要比較。",
      "屋苑資料列有泳池、健身室、兒童設施及燒烤空間，住宅與康樂配套可一併評估。不同座向的單位面向景觀有所分別，宜在客飯廳、睡房及露台逐一確認實際視野。",
    ],
    watchout: "須在室內核對青山灣方向的視野及遮擋，並檢查露台、工作平台與客飯廳的使用動線。",
    transport: "由青山公路青山灣段大門測試候車及過路路線，核對前往三聖、屯門市中心及鐵路的安排。",
    sources: [
      "https://www.homedash.hk/zh-cn/estate-South-Crest-2-KESPWWPEWB",
      "https://www.house730.com/estate-23769/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E5%8D%97%E5%B2%B8/",
      "https://www.28hse.com/buy/apartment/property-4049550",
    ],
    seoTitle: "南岸｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "南岸位於青山公路青山灣段116號。須在室內核對青山灣方向的視野及遮擋，並檢查露台、工作平台與客飯廳的使用動線。晉誠地產 C-018613。",
  },
  {
    slug: "napa",
    address: "掃管笏路88號",
    overview: [
      "NAPA位於掃管笏路，是同時提供分層住宅與洋房的私人屋苑。兩類物業在樓層分布、戶外空間及出入動線上各有特色，可先確定家庭需要，再比較具體座數與單位。",
      "公開屋苑資料列有會所、泳池及娛樂設施，康樂活動可連同居住空間一起考慮。看樓時宜由實際住宅入口走到公用設施及停車位置，了解日常路程是否合用。",
    ],
    watchout: "分層與洋房放盤的花園、天台和車位條件各有不同，必須按個別單位圖則及租售條款核對。",
    transport: "以掃管笏路大門為起點測試候車和行車路線，按平日出發時段核對接駁屯門市中心的安排。",
    sources: [
      "https://hk.centanet.com/estate/en/Napa/1-KEEPWWPOPG",
      "https://www.hkp.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B1%AF%E9%96%80-NAPA-E000015623",
      "https://www.28hse.com/rent/apartment/property-3985456",
    ],
    seoTitle: "NAPA｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "NAPA位於掃管笏路88號。分層與洋房放盤的花園、天台和車位條件各有不同，必須按個別單位圖則及租售條款核對。晉誠地產 C-018613。",
  },
  {
    slug: "nga-tak-yuen",
    address: "青榕街6號",
    overview: [
      "雅德苑位於三聖青榕街，是分層私人住宅屋苑。公開屋苑資料所列單位以較寬敞的家庭空間為特色，選盤時可仔細比較客飯廳形狀、睡房分布，以及實際家具擺位。",
      "屋苑資料列有室外泳池及日光浴空間，可連同家庭的休閒習慣一起評估。看樓時亦宜了解公用部分與單位內部的保養，並比較不同座數和樓層的採光及外望。",
    ],
    watchout: "大戶型應按家具尺寸實測客飯廳與房間，並檢查窗邊、浴室和公用部分的保養狀況。",
    transport: "由青榕街實際座數測試步行候車路線，並核對往三聖生活配套及屯門市中心的接駁安排。",
    sources: [
      "https://www.homedash.hk/zh-cn/estate-Faraday-House-2-ZMHLTHDEHN",
      "https://www.house730.com/estate-23775/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E9%9B%85%E5%BE%B7%E8%8B%91/",
      "https://www.28hse.com/rent/apartment/property-4060617",
    ],
    seoTitle: "雅德苑｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "雅德苑位於青榕街6號。大戶型應按家具尺寸實測客飯廳與房間，並檢查窗邊、浴室和公用部分的保養狀況。晉誠地產 C-018613。",
  },
  {
    slug: "ocean-camino",
    address: "管翠路8號",
    overview: [
      "緹岸位於掃管笏管翠路，是分期發展、兼有分層住宅與洋房的私人屋苑。戶型由較精簡單位至家庭型住宅皆有，選盤時宜先釐清期數、座數及住宅類型，再比較間隔。",
      "公開屋苑資料列有會所、泳池及娛樂設施，可連同屋內活動空間一起考慮。各期大廈與洋房的出入口及步行路線不同，應由實際單位出發了解日常使用動線。",
    ],
    watchout: "須核對第幾期、座數及分層或洋房類型，並按實際平面圖評估睡房、收納及家具擺位。",
    transport: "以管翠路所屬期數的大門為起點試走候車路線，按日常上班時段核對接駁及轉乘安排。",
    sources: [
      "https://hk.centanet.com/estate/%E7%B7%B9%E5%B2%B8/3-KESPWPPAPG",
      "https://www.hkp.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B1%AF%E9%96%80-%E7%B7%B9%E5%B2%B8-E000016894",
      "https://www.28hse.com/buy/apartment/property-4012876",
    ],
    seoTitle: "緹岸｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "緹岸位於管翠路8號。須核對第幾期、座數及分層或洋房類型，並按實際平面圖評估睡房、收納及家具擺位。晉誠地產 C-018613。",
  },
  {
    slug: "oi-kam-waan",
    address: "青發街2號",
    overview: [
      "愛琴灣位於小欖青發街，提供分層、複式及獨立屋等住宅選擇。不同類型的樓層安排與戶外空間各有特色，可按家庭對上下樓、室內面積分布及戶外活動的需要選盤。",
      "屋苑資料列有泳池、健身室、兒童遊樂及桑拿等設施，可把康樂配套與居住空間一併比較。現有放盤出現不同組別名稱，宜按實際門牌及圖則辨認單位類型。",
    ],
    watchout: "應核對組別名稱對應的是分層、複式還是獨立屋，避免把天台或花園條件套用至其他戶型。",
    transport: "由青發街實際入口測試步行候車及駕車出入，並核對往青山公路和屯門市中心的接駁安排。",
    sources: [
      "https://www.ricacorp.com/zh-cn/property/estate/%E7%88%B1%E7%90%B4%E6%B9%BE-estate-%E5%B0%8F%E6%A6%84-hma-cn",
      "https://www.newtohk.com/estates/the-aegean",
      "https://www.house730.com/estate-23793/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E6%84%9B%E7%90%B4%E7%81%A3/",
      "https://www.28hse.com/rent/apartment/property-3998405",
    ],
    seoTitle: "愛琴灣｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "愛琴灣位於青發街2號。應核對組別名稱對應的是分層、複式還是獨立屋，避免把天台或花園條件套用至其他戶型。晉誠地產 C-018613。",
  },
  {
    slug: "oma-by-the-sea",
    address: "青山公路大欖段166號",
    overview: [
      "OMA by the Sea位於青山公路大欖段，是以分層住宅為主的私人屋苑。官方項目資料以海濱生活及園林設計作介紹，選盤時可把單位的室內布局、露台安排與實際外望一起比較。",
      "項目介紹設有園林及泳池等康樂空間，可納入家庭日常休閒需要。各單位樓層和座向不同，官方網站亦說明景觀會受周邊環境影響，宜以現場視線作判斷。",
    ],
    watchout: "看樓時須在客飯廳、睡房及露台確認實際景觀，並了解周邊環境對採光及開窗感受的影響。",
    transport: "以大欖段實際大門為起點測試候車與行車動線，再按日常出發時段核對接駁市區的安排。",
    sources: [
      "https://www.omabythesea.com/en/",
      "https://www.28hse.com/buy/apartment/property-4033510",
    ],
    seoTitle: "OMA by the Sea｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "OMA by the Sea位於青山公路大欖段166號。看樓時須在客飯廳、睡房及露台確認實際景觀，並了解周邊環境對採光及開窗感受的影響。晉誠地產 C-018613。",
  },
  {
    slug: "palm-cove",
    address: "青山公路青山灣段168號",
    overview: [
      "翠濤居位於三聖青山公路青山灣段，是由多座住宅大廈組成的私人屋苑。屋苑提供不同家庭型間隔，可按睡房數目、客飯廳形狀及日常收納需要，比較座數與戶型。",
      "公開屋苑資料列有泳池、網球場、桌球及兒童遊樂設施，康樂配套可連同單位空間一起考慮。看樓時宜比較大廈與公用設施之間的路程，以及不同樓層的採光與景觀。",
    ],
    watchout: "應按實際座數及樓層確認外望方向，並檢查客飯廳及睡房的家具擺位是否符合家庭需要。",
    transport: "由青山公路青山灣段的大門測試候車及過路路線，並核對往三聖和屯門市中心的接駁安排。",
    sources: [
      "https://hk.centanet.com/estate/%E7%BF%A0%E6%BF%A4%E5%B1%85/2-KEPPWPPEPB",
      "https://www.hkp.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B1%AF%E9%96%80-%E7%BF%A0%E6%BF%A4%E5%B1%85-E12854",
      "https://www.28hse.com/buy/apartment/property-4045648",
    ],
    seoTitle: "翠濤居｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "翠濤居位於青山公路青山灣段168號。應按實際座數及樓層確認外望方向，並檢查客飯廳及睡房的家具擺位是否符合家庭需要。晉誠地產 C-018613。",
  },
  {
    slug: "pun-lung-bun-do",
    address: "瑜翠街2號",
    overview: [
      "蟠龍半島位於掃管笏瑜翠街，是兼有洋房與分層式選擇的低密度私人住宅。不同屋型的室內分布與戶外空間各異，尋找家庭居所時宜先確認屋型及是否包含全幢物業。",
      "屋苑資料列有泳池、運動及兒童設施，現有放盤亦有花園和私家車房的選擇。看樓時可把屋內樓層、戶外休憩及泊車動線串連起來，衡量是否合乎家庭生活習慣。",
    ],
    watchout: "必須分清獨立屋與分層洋房；花園、車房、天台及共用地方的範圍應按契約核對。",
    transport: "以瑜翠街所屬屋型的入口為起點測試步行及行車路線，再核對接駁青山公路交通的安排。",
    sources: [
      "https://hohomehk.com/wiki/estate-wiki-beaulieupeninsula/",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B0%8F%E6%AC%96-%E6%8E%83%E7%AE%A1%E7%AC%8F-%E9%9D%92%E5%B1%B1%E7%81%A3-%E8%9F%A0%E9%BE%8D%E5%8D%8A%E5%B3%B6-E00631",
      "https://www.28hse.com/buy/apartment/property-3996535",
    ],
    seoTitle: "蟠龍半島｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "蟠龍半島位於瑜翠街2號。必須分清獨立屋與分層洋房；花園、車房、天台及共用地方的範圍應按契約核對。晉誠地產 C-018613。",
  },
  {
    slug: "royal-cove-tower",
    address: "嘉和里山路2號",
    overview: [
      "帝灣居位於掃管笏嘉和里山路，是同時提供分層住宅與洋房的私人項目。分層單位與洋房的房間分布、樓梯及戶外空間各有不同，適合按家庭的日常活動和上下樓需要比較。",
      "公開資料介紹分層單位設有套房及儲物空間，而洋房則有較多分層安排。選盤時宜先核對所屬住宅類型，再把客飯廳、廚房和輔助空間逐一落實到實際家具擺位。",
    ],
    watchout: "不能因網址或放盤簡稱含大廈便推斷住宅類型；應核對是分層單位還是洋房及其入口。",
    transport: "從嘉和里山路實際大門測試步行、候車與駕車路線，並核對往青山公路及屯門市中心的安排。",
    sources: [
      "https://hk.centanet.com/estate/%E5%B8%9D%E7%81%A3%E5%B1%85/2-KESPWPPYPG",
      "https://www.uplhk.com/eng/firsthand_detail.php?id=319",
      "https://www.property.hk/asking_detail/ept/king/6795702.html",
    ],
    seoTitle: "帝灣居｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "帝灣居位於嘉和里山路2號。不能因網址或放盤簡稱含大廈便推斷住宅類型；應核對是分層單位還是洋房及其入口。晉誠地產 C-018613。",
  },
  {
    slug: "royal-dragon-villa",
    address: "青山公路汀九段321號",
    overview: [
      "嘉御龍庭位於青山公路汀九段，是汀九／油柑頭一帶的低密度洋房屋苑。住宅以全屋分層使用為主要特色，選盤時可按家庭成員的起居安排，比較各層房間與公共活動空間。",
      "公開屋苑資料列有會所、泳池及健身等設施，可與洋房本身的戶外空間一起考慮。看樓時宜完整走過各層及停車動線，同時了解屋苑管理和物業保養的安排。",
    ],
    watchout: "應按汀九而非屯門規劃生活圈，並逐層核對洋房內部樓梯、戶外空間及停車安排。",
    transport: "由汀九段實際入口測試候車與過路路線，並核對前往荃灣市中心和鐵路站的接駁安排。",
    sources: [
      "https://www.house730.com/estate-23652/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E5%98%89%E5%BE%A1%E9%BE%8D%E5%BA%AD/",
      "https://www.homedash.hk/estate-Royal-Dragon-Villa-2-DDMNZHXYHM",
      "https://www.property.hk/asking_detail/ept/king/6825488.html",
    ],
    seoTitle: "嘉御龍庭｜油柑頭／汀九屋苑資料、租售放盤",
    seoDescription:
      "嘉御龍庭位於青山公路汀九段321號。應按汀九而非屯門規劃生活圈，並逐層核對洋房內部樓梯、戶外空間及停車安排。晉誠地產 C-018613。",
  },
  {
    slug: "seaside-castle",
    address: "澄麗路9號",
    overview: [
      "畔海位於小欖澄麗路，是由獨立洋房組成的私人住宅項目。住宅以多房及套房安排為特色，可按家庭成員、訪客和工作空間需要，逐層比較起居與睡房的分布。",
      "這類全幢洋房的使用感受與一般分層住宅不同，室內樓梯、戶外空間和泊車動線都值得一併考察。看樓時宜了解各層的實際採光、私隱及保養，而非只比較總面積。",
    ],
    watchout: "多層洋房須逐層測試長幼成員的活動動線，並核對花園、天台及停車位置的契約範圍。",
    transport: "澄麗路與青山公路交接一帶有巴士站；建議實走洋房大門至站點的路程，並核對日常班次。",
    sources: [
      "https://www.house730.com/new-property-7532/%E7%95%94%E6%B5%B7/",
      "https://www.28hse.com/new-properties/%E7%95%94%E6%B5%B7",
      "https://www.property.hk/asking_detail/ept/mon/6848480.html",
    ],
    seoTitle: "畔海｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "畔海位於小欖澄麗路，是由獨立洋房組成的私人住宅項目。住宅以多房及套房安排為特色，可按家庭成員、訪客和工作空間需要，逐層比較起居與睡房的分布。晉誠地產 C-018613。",
  },
  {
    slug: "yu-chui-yuen",
    address: "瑜翠街9號",
    overview: [
      "瑜翠園位於掃管笏瑜翠街，是分層私人住宅屋苑。不同座數的樓層配置有別，家庭可按睡房布局、客飯廳形狀及外望方向比較，並以實際家具尺寸確認空間是否合用。",
      "公開屋苑資料列有泳池、網球、壁球、健身及兒童遊樂等設施，可把屋內空間與日常康樂需要一併考慮。看樓時宜同時查看公用部分的保養和由大堂往設施的步行動線。",
    ],
    watchout: "應按實際座數及樓層確認採光與外望，並了解公用地方、窗戶及浴室的維修保養狀況。",
    transport: "由瑜翠街所屬座數實走往候車位置的路線，再按上班及回家時段核對往屯門市中心的接駁。",
    sources: [
      "https://www.house730.com/zh-cn/estate-23848/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E7%91%9C%E7%BF%A0%E5%9B%AD/",
      "https://www.newtohk.com/estates/peridot-court",
      "https://www.28hse.com/buy/apartment/property-3991530",
    ],
    seoTitle: "瑜翠園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "瑜翠園位於瑜翠街9號。應按實際座數及樓層確認採光與外望，並了解公用地方、窗戶及浴室的維修保養狀況。晉誠地產 C-018613。",
  },
  {
    slug: "monte-carlo-villas",
    address: "青山公路青山灣段25號",
    overview: [
      "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是掃管笏及青山灣一帶的私人住宅項目。",
      "屋苑由洋房組成。比較放盤時可一併核對屋號、室內間隔，以及花園和車位等附連範圍。",
    ],
    watchout: "屋號、花園與車位條件須按個別物業核實，不能只按屋苑名稱推定。",
    transport: "可按青山公路青山灣段25號規劃行程，睇樓前宜核對屋苑入口及出入安排。",
    sources: [
      "https://hk.centanet.com/estate/en/Monte-Carlo-Villas/1-SURVFROXVD",
      "https://www.midland.com.hk/en/estate/New-Territories-Tuen-Mun-Monte-Carlo-Villas-E06401",
      "https://www.house730.com/buy-property-9252573/青山公路-蒙地卡羅別墅/",
    ],
    seoTitle: "蒙地卡羅別墅｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是掃管笏及青山灣一帶的私人住宅項目。比較蒙地卡羅別墅租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "l-aquatique",
    address: "青山公路青龍頭段108號",
    overview: [
      "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，是區內的私人住宅屋苑。",
      "項目由兩座住宅大廈組成。選盤時可按座別、樓層及座向比較，實際景觀及採光宜在睇樓時確認。",
    ],
    watchout: "核對正式屋苑名稱及地址；「逸璟瓏灣」尚未有明確別名證據，不能據此自動合併。",
    transport: "可從青山公路青龍頭段一帶規劃出入，班次及站位請按實際路線查核。",
    sources: [
      "https://hk.centanet.com/estate/%E9%80%B8%E7%92%9F%EF%BC%8E%E9%BE%8D%E7%81%A3/2-AKPPWPPEPP",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E6%B7%B1%E4%BA%95-%E9%9D%92%E9%BE%8D%E9%A0%AD-%E9%80%B8%E7%92%9F-%E9%BE%8D%E7%81%A3-E000016130",
    ],
    seoTitle: "逸璟．龍灣｜青龍頭屋苑資料、租售放盤",
    seoDescription:
      "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，是區內的私人住宅屋苑。比較逸璟．龍灣租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "deauville",
    address: "青山公路汀九段380號",
    overview: [
      "星岸（Deauville）位於青山公路汀九段380號，屬油柑頭及汀九一帶的私人住宅項目。",
      "項目包括分層住宅及洋房。瀏覽放盤時，宜先分清物業類型，再比較各單位的樓層、戶外空間及景觀。",
    ],
    watchout: "「星岸大廈」屬放盤標示，正式屋苑名稱為星岸；洋房與分層住宅條件宜分開比較。",
    transport: "出入可按青山公路汀九段的實際站位及路線規劃，睇樓前宜核對班次。",
    sources: [
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E9%BA%97%E5%9F%8E-%E6%B1%80%E4%B9%9D-%E6%98%9F%E5%B2%B8-E000015312",
      "https://www.house730.com/estate-23666/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E6%98%9F%E5%B2%B8/",
    ],
    seoTitle: "星岸｜油柑頭／汀九屋苑資料、租售放盤",
    seoDescription:
      "星岸（Deauville）位於青山公路汀九段380號，屬油柑頭及汀九一帶的私人住宅項目。比較星岸租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "long-beach-gardens",
    address: "青山公路汀九段103號",
    overview: [
      "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，是油柑頭及汀九一帶的私人住宅屋苑。",
      "屋苑由兩座住宅大廈組成。比較放盤時可一併核對座別、樓層、間隔及室內保養，景觀則以單位現場為準。",
    ],
    watchout: "不同資料頁的樓宇數據曾有出入，面積、樓層及物業資料應以個別放盤與正式文件核實。",
    transport: "可按青山公路汀九段的巴士及小巴路線規劃出入，站位與服務時間請另行核對。",
    sources: [
      "https://hk.centanet.com/estate/%E6%B5%B7%E6%BF%A4%E8%8A%B1%E5%9C%92/2-AEPPPPSXPA",
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E9%BA%97%E5%9F%8E-%E6%B1%80%E4%B9%9D-%E6%B5%B7%E6%BF%A4%E8%8A%B1%E5%9C%92-E12029",
    ],
    seoTitle: "海濤花園｜油柑頭／汀九屋苑資料、租售放盤",
    seoDescription:
      "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，是油柑頭及汀九一帶的私人住宅屋苑。即睇海濤花園放盤。晉誠地產 C-018613。",
  },
  {
    slug: "riviera",
    address: "青山公路汀九段369號",
    overview: [
      "麗海別墅（Riviera）位於青山公路汀九段369號，屬油柑頭及汀九一帶的私人住宅。",
      "麗海別墅為單幢住宅。睇樓時可重點比較單位間隔、實際採光及公共部分保養，並核對車位是否包含在放盤條件內。",
    ],
    watchout: "屋苑名稱含「別墅」，不代表每個放盤都是獨立屋；請核對單位類型及樓層。",
    transport: "先按青山公路汀九段369號規劃行程，並核對落車後到入口的步行路線。",
    sources: [
      "https://hk.centanet.com/estate/麗海別墅/2-DDTLTHIAHM",
      "https://www.ricacorp.com/zh-hk/property/estate/麗海別墅-single-汀九-hma-hk",
    ],
    seoTitle: "麗海別墅｜油柑頭／汀九屋苑資料、租售放盤",
    seoDescription:
      "麗海別墅（Riviera）位於青山公路汀九段369號，屬油柑頭及汀九一帶的私人住宅。比較麗海別墅租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "both-wealth-garden",
    address: "掃管笏村第一區",
    overview: [
      "均富花園（Both Wealth Garden）位於掃管笏村第一區，是掃管笏一帶的住宅項目。",
      "晉誠現有放盤以期數標示物業。搜尋及睇樓時宜一併核對期數、座別與完整地址，以分清不同單位。",
    ],
    watchout: "來源對門牌範圍有不同記載；以掃管笏村第一區作位置介紹，個別物業地址須再核對。",
    transport: "睇樓前宜按個別單位的確實門牌規劃路線，並確認由落車位置到物業入口的步行安排。",
    sources: [
      "https://hk.centanet.com/estate/%E5%9D%87%E5%AF%8C%E8%8A%B1%E5%9C%92/2-KEPPWPPAPD",
      "https://www.ricacorp.com/zh-hk/property/estate/%E5%9D%87%E5%AF%8C%E8%8A%B1%E5%9C%92-estate-%E6%8E%83%E7%AE%A1%E7%AC%8F-hma-hk",
    ],
    seoTitle: "均富花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "均富花園（Both Wealth Garden）位於掃管笏村第一區，是掃管笏一帶的住宅項目。即睇均富花園放盤。晉誠地產 C-018613。",
  },
  {
    slug: "fiona-garden",
    address: "青泰路28號",
    overview: [
      "富安新邨（Fiona Garden）位於青泰路28號，屬小欖及大欖一帶的住宅項目。",
      "屋苑以洋房住宅為主，現有放盤亦使用「富安新村」名稱。比較單位時，宜核對獨立門牌及戶外範圍。",
    ],
    watchout:
      "「富安新邨」與「富安新村」為同址名稱用法；花園、天台及車位範圍應按個別物業文件確認。",
    transport: "可按青泰路28號規劃睇樓行程，公共交通站位及步行路線請先核對。",
    sources: [
      "https://www.midland.com.hk/zh-hk/estate/%E6%96%B0%E7%95%8C-%E5%B0%8F%E6%AC%96-%E6%8E%83%E7%AE%A1%E7%AC%8F-%E9%9D%92%E5%B1%B1%E7%81%A3-%E5%AF%8C%E5%AE%89%E6%96%B0%E9%82%A8-E000000015",
      "https://www.house730.com/estate-23822/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E5%AF%8C%E5%AE%89%E6%96%B0%E9%82%A8/",
    ],
    seoTitle: "富安新邨｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "富安新邨（Fiona Garden）位於青泰路28號，屬小欖及大欖一帶的住宅項目。比較富安新邨租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "dragon-inn-court",
    address: "青霞里9號",
    overview: [
      "容龍居（Dragon Inn Court）位於三聖青霞里9號，是青山灣及三聖一帶的私人住宅屋苑。",
      "屋苑由四座住宅大廈組成。選盤時可按座別、樓層與間隔比較，並實地了解單位及公共部分的保養。",
    ],
    watchout: "請核對放盤的座別與單位資料；景觀及車位安排以個別物業條件為準。",
    transport: "先按青霞里9號確認物業入口，再核對附近公共交通及最後一段步行路線。",
    sources: [
      "https://www.house730.com/estate-23783/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E5%AE%B9%E9%BE%8D%E5%B1%85/",
      "https://www.ricacorp.com/zh-hk/property/estate/%E5%AE%B9%E9%BE%8D%E5%B1%85-estate-%E4%B8%89%E8%81%96-hma-hk",
      "https://www.28hse.com/estate/detail/%E5%AE%B9%E9%BE%8D%E5%B1%85-4511",
    ],
    seoTitle: "容龍居｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "容龍居（Dragon Inn Court）位於三聖青霞里9號，是青山灣及三聖一帶的私人住宅屋苑。比較容龍居租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "tuen-mun-court",
    address: "青榕街2號",
    overview: [
      "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青榕街一帶的私人住宅大廈。",
      "屯門閣屬單幢住宅，與鄰近青榕街4號的雅翠苑為不同物業。比較放盤時宜核對大廈名稱、門牌及樓層。",
    ],
    watchout: "不要因名稱或鄰近位置而與雅翠苑混淆；車位是否連同出售須按個別放盤確認。",
    transport: "可按青榕街2號規劃行程，睇樓前核對由站位至大廈入口的步行路線。",
    sources: [
      "https://www.28hse.com/estate/detail/屯門閣-4514",
      "https://www.midland.com.hk/zh-hk/estate/新界-小欖-掃管笏-青山灣-屯門閣-E08756",
      "https://www.manyw.com/info/TUENMUNCOURT",
    ],
    seoTitle: "屯門閣｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青榕街一帶的私人住宅大廈。比較屯門閣租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "elegant-villa",
    address: "青榕街4號",
    overview: [
      "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青榕街一帶的私人住宅。",
      "雅翠苑與青榕街2號的屯門閣為不同物業。搜尋或安排睇樓時，宜一併確認屋苑名稱及門牌。",
    ],
    watchout: "放盤資料應核對青榕街4號，景觀、車位及附連空間以個別單位條件為準。",
    transport: "可按青榕街4號確認入口及出入路線，公共交通站位與班次請另行查核。",
    sources: ["https://hk.centanet.com/estate/%E9%9B%85%E7%BF%A0%E8%8B%91/2-ZMSSTHDXHN"],
    seoTitle: "雅翠苑｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青榕街一帶的私人住宅。比較雅翠苑租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "pearl-island-bungalow",
    address: "青龍路9號",
    overview: [
      "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的住宅項目。",
      "現有放盤包括F1及F5座。它與青龍路11號的龍珠島花園為不同屋苑，選盤時應按名稱、門牌及座別分辨。",
    ],
    watchout: "「平房」是屋苑名稱用法，不代表單位為獨立屋；不可與龍珠島花園合併。",
    transport: "睇樓行程宜按青龍路9號規劃，並確認進出龍珠島及停車安排。",
    sources: [
      "https://www.earnestproperty.com/property-detail/6711696.html",
      "https://www.earnestproperty.com/property-detail/6711694.html",
      "https://www.midland.com.hk/en/estate/New-Territories-Siu-Lam-So-Kwun-Wat-Castle-Peak-Bay-Pearl-Island-Bungalow-E00850",
      "https://hk.centanet.com/centaestimate/estate-龍珠島別墅-F1座_1-SUQQURUYRJ?tab=history",
      "https://www.property.hk/sc/asking_detail/6718044.html",
    ],
    seoTitle: "龍珠島平房｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的住宅項目。比較龍珠島平房租售單位及睇樓條件。晉誠地產 C-018613。",
  },
  {
    slug: "pearl-garden",
    address: "青龍路7號",
    overview: [
      "龍珠花園（Pearl Garden）位於掃管笏青龍路7號，是龍珠島一帶的私人住宅屋苑。",
      "屋苑由四座住宅大廈組成，與青龍路9號的龍珠島平房及11號的龍珠島花園均為不同物業。搜尋放盤時宜按正式名稱及門牌分辨。",
    ],
    watchout: "龍珠花園、龍珠島花園及龍珠島平房名稱相近，但應分開配對與比較。",
    transport: "可按青龍路7號規劃行程，並先確認進出龍珠島及停車安排。",
    sources: [
      "https://hk.centanet.com/estate/zh-cn/龙珠花园/2-SUDDURUXRJ",
      "https://www.house730.com/buy-property-9244086/青山公路-龍珠花園/",
    ],
    seoTitle: "龍珠花園｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "龍珠花園（Pearl Garden）位於掃管笏青龍路7號，是龍珠島一帶的私人住宅屋苑。即睇龍珠花園放盤。晉誠地產 C-018613。",
  },
  {
    slug: "peak-castle",
    address: "冠發街8A–8H、8J、10、12、16、18、20、22號",
    overview: [
      "珀居（Peak Castle）位於小欖冠發街，正式門牌包括8A至8H、8J、10、12、16、18、20及22號。",
      "項目由洋房組成。選盤時宜核對各洋房的獨立門牌，以及花園、天台、泳池及車位等範圍是否屬於放盤條件。",
    ],
    watchout: "各洋房的門牌及戶外空間不同，應以個別放盤及物業文件核實。",
    transport: "睇樓前宜按洋房的獨立門牌確認入口，並核對冠發街的出入及停車安排。",
    sources: [
      "https://www.peakcastle.com/zh-hk",
      "https://www.house730.com/buy-property-9249791/青山公路-珀居/",
      "https://www.28hse.com/buy/apartment/property-4001685",
    ],
    seoTitle: "珀居｜小欖至三聖屋苑資料、租售放盤",
    seoDescription:
      "珀居（Peak Castle）位於小欖冠發街，正式門牌包括8A至8H、8J、10、12、16、18、20及22號。比較珀居租售單位及睇樓條件。晉誠地產 C-018613。",
  },
];
