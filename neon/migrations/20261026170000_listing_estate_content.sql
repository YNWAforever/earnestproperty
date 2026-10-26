-- Reviewed active corridor inventory, 2026-10-26. Evidence and photo provenance:
-- src/content/fixtures/listing-estate-expansion-20261026.json.
-- 28 existing unpublished rows + 12 new identities. No numerical facts inferred.
-- Apply through the ordinary migration workflow after PR review; not applied by this PR.
BEGIN;

WITH content AS (
 SELECT * FROM jsonb_to_recordset($estate_content$
[
  {
    "slug": "bayview-terrace",
    "name_zh": "碧翠花園",
    "name_en": "Bayview Terrace",
    "district_slug": "castle-peak-road",
    "aliases": [
      "碧翠花園",
      "Bayview Terrace",
      "BAYVIEW TERR"
    ],
    "address": "青山公路青山灣段107號",
    "description": "碧翠花園位於三聖一帶的青山公路青山灣段，是同時提供分層住宅與洋房的私人屋苑。選盤時宜先確定住宅類型，再比較客飯廳、睡房及戶外空間的安排，避免把兩類物業直接作同一標準比較。\n\n公開屋苑資料列有泳池、網球場及兒童遊樂設施，日常康樂配套也是看樓重點。分層單位與洋房的出入口、景觀及管理安排各有不同，適合連同家庭活動和泊車需要一起考慮。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/5/f/8/58bf4c9fa5c25874c54c4ffe0e70d341.jpg",
    "seo_title": "碧翠花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "碧翠花園位於青山公路青山灣段107號。同苑兼有洋房及分層住宅，須按實際門牌核對花園、平台與車位是否屬該物業。晉誠地產 C-018613。"
  },
  {
    "slug": "castle-peak-villas",
    "name_zh": "青山別墅",
    "name_en": "Castle Peak Villas",
    "district_slug": "castle-peak-road",
    "aliases": [
      "青山別墅",
      "Castle Peak Villas"
    ],
    "address": "樂翠街19號",
    "description": "青山別墅位於小欖樂翠街，屬分層住宅屋苑，名稱中的「別墅」不代表每個單位都是獨立屋。屋苑的座名及單位布局各有分別，尋找家庭居所時可重點比較客飯廳、房間和露台的實際連接方式。\n\n現有放盤可見連露台及車位的選擇，適合把室內空間、戶外活動和駕車安排一併評估。看樓時亦宜留意樓宇及公用部分的保養，並向代理確認車位是否包含在租售條件內。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/38/384abf198c6ca47ef656ca788e1976edacc32c1082a7a9e8ab8270c8d2091128.jpg",
    "seo_title": "青山別墅｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "青山別墅位於樂翠街19號。應以樂翠街門牌及座名核對物業；個別來源把地址簡寫為青山公路，不能據此判斷實際入口。晉誠地產 C-018613。"
  },
  {
    "slug": "ching-lai-waan-villas",
    "name_zh": "青麗灣別墅",
    "name_en": "The Castle Bay",
    "district_slug": "castle-peak-road",
    "aliases": [
      "青麗灣別墅",
      "The Castle Bay"
    ],
    "address": "樂翠街6–18號",
    "description": "青麗灣別墅座落小欖樂翠街，是以洋房為主的低密度私人住宅。屋內分層與花園、天台的銜接，是這類物業與一般分層住宅的主要分別，適合按家庭成員的活動習慣逐層看樓。\n\n現有放盤介紹包括私家車房及前後花園的選擇，可把泊車、種植和戶外休憩需要一併考慮。各幢洋房的朝向及配置未必相同，海景、戶外空間和車房條件均應按實際單位確認。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/35/35b60726094f0c3abcbc1d21e9554d2390a13dc80950e5d7b8a635dadf8b289d.jpg",
    "seo_title": "青麗灣別墅｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "青麗灣別墅位於樂翠街6–18號。洋房的前後花園、天台和車房須逐項核對契約範圍，並實測樓梯對長幼成員是否合用。晉誠地產 C-018613。"
  },
  {
    "slug": "ching-yung-toi",
    "name_zh": "青榕臺",
    "name_en": "Tsing Yung Terrace",
    "district_slug": "castle-peak-road",
    "aliases": [
      "青榕臺",
      "Tsing Yung Terrace",
      "青榕台"
    ],
    "address": "青榕街8號",
    "description": "青榕臺位於青榕街，是三聖一帶的分層私人住宅屋苑。屋苑提供家庭型單位，可按客飯廳尺度、睡房位置及收納需要比較不同座數與戶型，而非只看樓盤照片中的裝修。\n\n公開屋苑資料列有泳池、會所及運動設施，並有巴士、小巴交通資訊。看樓時可同時了解住宅大堂、康樂設施與出入口之間的路程，再衡量日常使用是否方便。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/b4/b4f12661f6db2c1cccdd354f8a32f1ee64cd257ba270dabf5065756bf8a88155.jpg",
    "seo_title": "青榕臺｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "青榕臺位於青榕街8號。青榕街上不同樓層及座向的開揚程度會有分別，宜在室內核對景觀、採光與窗外遮擋。晉誠地產 C-018613。"
  },
  {
    "slug": "chui-king-garden",
    "name_zh": "翠景花園",
    "name_en": "Jade View Villa",
    "district_slug": "castle-peak-road",
    "aliases": [
      "翠景花園",
      "Jade View Villa"
    ],
    "address": "青泰路20號",
    "description": "翠景花園位於青泰路，是由洋房組成的低密度住宅，公開資料以歐陸式排屋設計作介紹。尋找較多室內外活動空間的家庭，可把屋內樓層分布、花園使用及泊車動線作為看樓主線。\n\n現有放盤以花園洋房作介紹，實際可用範圍和維護安排值得仔細比較。屋苑規模與一般大型分層社區不同，宜一併了解公用部分管理、保養分工及相關費用。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1e/1edce3beba410ed109e4fb4d0db5551f46f50df57e56a9c9eb163772c9750243.webp",
    "seo_title": "翠景花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "翠景花園位於青泰路20號。花園是此類洋房的主要比較項目，須核對界線、排水及維護責任，而不只憑放盤面積描述。晉誠地產 C-018613。"
  },
  {
    "slug": "chun-wo-sea-view-garden",
    "name_zh": "春和海景花園",
    "name_en": "Spring Seaview Terrace",
    "district_slug": "castle-peak-road",
    "aliases": [
      "春和海景花園",
      "Spring Seaview Terrace"
    ],
    "address": "青山公路青山灣段33號",
    "description": "春和海景花園位於青山公路青山灣段，屬掃管笏一帶的分層私人住宅。屋苑提供家庭型單位，現有放盤亦有露台及連車位的選擇，可按室內空間、戶外活動和駕車需要逐項比較。\n\n公開屋苑資料列有泳池、網球及壁球設施，康樂配套可與單位布局一起考慮。個別放盤以沙灘海景作介紹，景觀仍須按座數、樓層及室內實際視線核對。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/3d/3dab39f1fedbe804e074e8d35d439f2172895f10d37e89a222b30af49a4c7a85.jpg",
    "seo_title": "春和海景花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "春和海景花園位於青山公路青山灣段33號。看樓時應分別站在客飯廳及露台確認景觀，同時了解臨青山公路一側的開窗環境。晉誠地產 C-018613。"
  },
  {
    "slug": "chung-yuet-waan",
    "name_zh": "棕月灣",
    "name_en": "Palm Beach",
    "district_slug": "castle-peak-road",
    "aliases": [
      "棕月灣",
      "Palm Beach"
    ],
    "address": "青山公路青山灣段28號",
    "description": "棕月灣位於青山公路青山灣段，屬掃管笏一帶的私人住宅。屋苑以家庭型單位為主，現有放盤包括複式選擇，適合把公共活動空間與睡房分層的安排納入比較。\n\n屋苑資料列有泳池、健身室和兒童遊樂設施，可連同日常家庭活動需要一起評估。複式與一般分層單位的生活動線不同，看樓時宜逐層了解房間、浴室及收納配置。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/0e/0e34d2bf93186ff756e2db1fbbde1ece2a36f6a1cfac0994fe9c67472a23fb1b.webp",
    "seo_title": "棕月灣｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "棕月灣位於青山公路青山灣段，屬掃管笏一帶的私人住宅。屋苑以家庭型單位為主，現有放盤包括複式選擇，適合把公共活動空間與睡房分層的安排納入比較。晉誠地產 C-018613。"
  },
  {
    "slug": "fei-yeung",
    "name_zh": "飛揚",
    "name_en": "Grand Jeté",
    "district_slug": "castle-peak-road",
    "aliases": [
      "飛揚",
      "Grand Jeté",
      "飛揚 1期",
      "飛揚1期",
      "飛揚 2期",
      "飛揚2期"
    ],
    "address": "青山公路大欖段170號",
    "description": "飛揚位於青山公路大欖段，是分期發展的分層私人住宅屋苑。不同期數、座數與戶型提供不同空間選擇，尋找自住單位時可先確認所需間隔，再比較客飯廳形狀及睡房尺度。\n\n屋苑包含由較精簡至家庭型的戶型，家具擺位和收納安排對實際居住感受尤其重要。看樓時宜按具體期數及單位平面圖，逐一核對廚房、浴室與生活空間的比例。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/f/c/e8f252c0a4992f4c2192d8e4459b43a8.jpg",
    "seo_title": "飛揚｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "飛揚位於青山公路大欖段170號。必須核對放盤所屬期數和座數；不同戶型的間隔、外望方向及出入口路程不能互相套用。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-ching-hin",
    "name_zh": "海澄軒",
    "name_en": "Villa Sapphire",
    "district_slug": "castle-peak-road",
    "aliases": [
      "海澄軒",
      "Villa Sapphire"
    ],
    "address": "青發街8號",
    "description": "海澄軒位於小欖青發街，是分層私人住宅屋苑，與其他地區的同名物業須清楚區分。現有放盤包括連車位的家庭型選擇，可把房間分布、客飯廳和泊車需要一起考慮。\n\n公開屋苑資料列有泳池、健身室、壁球場及園林花園，屋內外活動空間可一併比較。各座與不同樓層的景觀、採光及出入動線仍有差別，宜按實際單位看樓。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1b/1b335c3abf6400edd5f2561e9ad05fb3d18553c173a397a718712b057f500d80.webp",
    "seo_title": "海澄軒｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "海澄軒位於青發街8號。應先確認是小欖青發街的 Villa Sapphire，並核對連車位條款及大堂至停車位置的動線。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-king-garden",
    "name_zh": "海景花園",
    "name_en": "Seaview Garden",
    "district_slug": "castle-peak-road",
    "aliases": [
      "海景花園",
      "Seaview Garden"
    ],
    "address": "青榕街1號",
    "description": "海景花園位於三聖青榕街，是由多座住宅大廈組成的私人屋苑。屋苑有不同間隔選擇，家庭可按睡房數目、客飯廳布局及收納需要比較單位，並留意座數與外望方向的分別。\n\n公開屋苑資料列有室外泳池、網球場、羽毛球及兒童遊樂設施，適合把康樂配套納入日常生活考慮。屋苑名稱包含「海景」，但每個單位的視野仍須在實際樓層確認。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/f/8/5/08afcca7aaada5af73483caa275d1fab.jpg",
    "seo_title": "海景花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "海景花園位於青榕街1號。不同座向的海景及遮擋情況可能不同，應在客廳和睡房分別確認視野，而非只憑屋苑名稱。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-wai-garden",
    "name_zh": "海慧花園",
    "name_en": "Aquamarine Garden",
    "district_slug": "castle-peak-road",
    "aliases": [
      "海慧花園",
      "Aquamarine Garden",
      "海慧花園 洋房",
      "海慧花園洋房"
    ],
    "address": "青茵街8號",
    "description": "海慧花園位於三聖青茵街，是兼有分層住宅與洋房的私人屋苑。不同住宅類型的室內分布、戶外空間及出入口各有特色，可先按生活方式選定類型，再比較具體放盤。\n\n現有放盤涵蓋洋房選擇，公用康樂資料亦列有泳池及運動設施。看樓時宜把單位、停車位置和公用部分串連成日常動線，了解實際使用是否符合家庭需要。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/d1/d17aaef525ccba8aef3715c2d34cf13a655aa203e295814b72c7bf0070307166.jpg",
    "seo_title": "海慧花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "海慧花園位於青茵街8號。同苑的分層住宅與洋房不可直接套用相同條件；花園、平台及車位權益須按個別物業核對。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-yu",
    "name_zh": "海譽",
    "name_en": "Crown By The Sea",
    "district_slug": "castle-peak-road",
    "aliases": [
      "海譽",
      "Crown By The Sea"
    ],
    "address": "青榕街3號",
    "description": "海譽位於三聖青榕街，是單幢式私人住宅。與多座式屋苑相比，選盤時可更集中比較同一大廈內不同樓層及座向，並按房間位置、客飯廳比例及採光挑選合用單位。\n\n公開屋苑資料列有泳池、健身室及閱讀空間，現有放盤亦以海景和車位選配作介紹。景觀與泊車條件均應逐項確認，並把大堂、車庫與住宅之間的日常動線納入考慮。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/ae/ae65106225cd33e3cba9bd939a30e2f5e1972ab8f793112753fbed9c0355d94c.webp",
    "seo_title": "海譽｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "海譽位於青榕街3號。現有放盤提及可配車位，須確認是另租、另購還是包含在條件內，並實地核對海景視線。晉誠地產 C-018613。"
  },
  {
    "slug": "kwan-lun",
    "name_zh": "琨崙",
    "name_en": "Jade Grove",
    "district_slug": "castle-peak-road",
    "aliases": [
      "琨崙",
      "Jade Grove",
      "琨崙 分層單位",
      "琨崙分層單位"
    ],
    "address": "青發里8號",
    "description": "琨崙位於小欖青發里，是結合分層、複式及洋房設計的低密度私人住宅。不同組別和戶型的垂直動線與戶外空間各有分別，選盤前宜先確認是分層單位還是全幢洋房。\n\n公開屋苑資料列有會所、泳池及兒童設施，現有放盤亦可見金琥珀等組別名稱。看樓時宜按實際組別與單位圖則，逐層比較生活、睡房和戶外活動空間的安排。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/5/1/464f55ec15fb07fa1daa36fad11b8d07.jpeg",
    "seo_title": "琨崙｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "琨崙位於青發里8號。放盤可能使用洋房組別名稱描述分層或複式單位，須核對樓層範圍及是否包含全幢物業。晉誠地產 C-018613。"
  },
  {
    "slug": "kwun-hoi-villas",
    "name_zh": "觀海別墅",
    "name_en": "Vista Del Mar",
    "district_slug": "ting-kau",
    "aliases": [
      "觀海別墅",
      "Vista Del Mar"
    ],
    "address": "青山公路汀九段386號",
    "description": "觀海別墅位於青山公路汀九段，屬汀九／油柑頭一帶的私人住宅。公開屋苑資料及成交紀錄可見複式選擇，適合希望把起居與睡房分層安排的家庭按實際圖則比較。\n\n此處的生活範圍應按汀九及荃灣方向規劃。看樓時可把屋內樓梯、入口與停車安排一併了解，並留意樓宇及公用部分的保養，衡量是否符合日常使用習慣。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/b/0/70a74c8ec7bd8c429dc7f4c59e963c7c.jpg",
    "seo_title": "觀海別墅｜油柑頭／汀九屋苑資料、租售放盤",
    "seo_description": "觀海別墅位於青山公路汀九段386號。汀九地址不可與屯門同類海濱屋苑混淆；複式單位應逐層檢視樓梯、採光和室內保養。晉誠地產 C-018613。"
  },
  {
    "slug": "lung-chu-island-garden",
    "name_zh": "龍珠島花園",
    "name_en": "Pearl Island Garden",
    "district_slug": "castle-peak-road",
    "aliases": [
      "龍珠島花園",
      "Pearl Island Garden"
    ],
    "address": "青龍路11號",
    "description": "龍珠島花園位於青龍路，是龍珠島一帶由低層住宅組成的私人屋苑。公開屋苑資料可見家庭型間隔，部分成交紀錄亦涉及花園或天台，可按樓層與戶外空間需要比較單位。\n\n屋苑設有泳池，日常康樂與單位內部空間可一併考慮。不同樓層的出入方式、採光及戶外使用條件未必相同，看樓時宜由入口走到單位，完整體驗日常路程。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/8e/8ebd6372f460076ae63aaf5e630aae6081ed36b7ec724ad4a7907b06155a2861.jpg",
    "seo_title": "龍珠島花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "龍珠島花園位於青龍路11號。看樓前應確認上落樓層方式；花園、天台及平台是否專用和隨物業轉讓，須逐項核對。晉誠地產 C-018613。"
  },
  {
    "slug": "nam-ngon",
    "name_zh": "南岸",
    "name_en": "South Crest",
    "district_slug": "castle-peak-road",
    "aliases": [
      "南岸",
      "South Crest"
    ],
    "address": "青山公路青山灣段116號",
    "description": "南岸位於三聖一帶的青山公路青山灣段，是單幢式分層私人住宅。屋苑以家庭型間隔為主，公開資料介紹有獨立廚房、露台及工作平台，可按煮食、收納和家庭活動需要比較。\n\n屋苑資料列有泳池、健身室、兒童設施及燒烤空間，住宅與康樂配套可一併評估。不同座向的單位面向景觀有所分別，宜在客飯廳、睡房及露台逐一確認實際視野。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/04/04d8c87b1df833e08daf623c83d49617d34e3e3488192af9a11e5d0ef553209f.jpg",
    "seo_title": "南岸｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "南岸位於青山公路青山灣段116號。須在室內核對青山灣方向的視野及遮擋，並檢查露台、工作平台與客飯廳的使用動線。晉誠地產 C-018613。"
  },
  {
    "slug": "napa",
    "name_zh": "NAPA",
    "name_en": "NAPA",
    "district_slug": "castle-peak-road",
    "aliases": [
      "NAPA",
      "NAPA 大廈",
      "NAPA大廈"
    ],
    "address": "掃管笏路88號",
    "description": "NAPA位於掃管笏路，是同時提供分層住宅與洋房的私人屋苑。兩類物業在樓層分布、戶外空間及出入動線上各有特色，可先確定家庭需要，再比較具體座數與單位。\n\n公開屋苑資料列有會所、泳池及娛樂設施，康樂活動可連同居住空間一起考慮。看樓時宜由實際住宅入口走到公用設施及停車位置，了解日常路程是否合用。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/8/2/9/7c6b63e09c39928784f20d761c23bd89.jpg",
    "seo_title": "NAPA｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "NAPA位於掃管笏路88號。分層與洋房放盤的花園、天台和車位條件各有不同，必須按個別單位圖則及租售條款核對。晉誠地產 C-018613。"
  },
  {
    "slug": "nga-tak-yuen",
    "name_zh": "雅德苑",
    "name_en": "Faraday House",
    "district_slug": "castle-peak-road",
    "aliases": [
      "雅德苑",
      "Faraday House"
    ],
    "address": "青榕街6號",
    "description": "雅德苑位於三聖青榕街，是分層私人住宅屋苑。公開屋苑資料所列單位以較寬敞的家庭空間為特色，選盤時可仔細比較客飯廳形狀、睡房分布，以及實際家具擺位。\n\n屋苑資料列有室外泳池及日光浴空間，可連同家庭的休閒習慣一起評估。看樓時亦宜了解公用部分與單位內部的保養，並比較不同座數和樓層的採光及外望。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/59/5992dd4bc265744fd9e4d96156c41241afc9c4daf5c09f67a29af9fb643732f8.jpg",
    "seo_title": "雅德苑｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "雅德苑位於青榕街6號。大戶型應按家具尺寸實測客飯廳與房間，並檢查窗邊、浴室和公用部分的保養狀況。晉誠地產 C-018613。"
  },
  {
    "slug": "ocean-camino",
    "name_zh": "緹岸",
    "name_en": "Ocean Camino",
    "district_slug": "castle-peak-road",
    "aliases": [
      "緹岸",
      "Ocean Camino",
      "緹岸 第1期(大廈)",
      "緹岸第1期(大廈)",
      "緹岸 第1期(洋房)",
      "緹岸第1期(洋房)",
      "緹岸 第2期",
      "緹岸第2期"
    ],
    "address": "管翠路8號",
    "description": "緹岸位於掃管笏管翠路，是分期發展、兼有分層住宅與洋房的私人屋苑。戶型由較精簡單位至家庭型住宅皆有，選盤時宜先釐清期數、座數及住宅類型，再比較間隔。\n\n公開屋苑資料列有會所、泳池及娛樂設施，可連同屋內活動空間一起考慮。各期大廈與洋房的出入口及步行路線不同，應由實際單位出發了解日常使用動線。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/5d/5d85da6a8de8c28c54b5e2b36d3cbf06119908de5d0ddbfc64915afcf7f407b1.jpg",
    "seo_title": "緹岸｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "緹岸位於管翠路8號。須核對第幾期、座數及分層或洋房類型，並按實際平面圖評估睡房、收納及家具擺位。晉誠地產 C-018613。"
  },
  {
    "slug": "oi-kam-waan",
    "name_zh": "愛琴灣",
    "name_en": "The Aegean",
    "district_slug": "castle-peak-road",
    "aliases": [
      "愛琴灣",
      "The Aegean",
      "愛琴灣 愛琴灣",
      "愛琴灣愛琴灣",
      "愛琴灣 愛琴灣(獨立屋)",
      "愛琴灣愛琴灣(獨立屋)"
    ],
    "address": "青發街2號",
    "description": "愛琴灣位於小欖青發街，提供分層、複式及獨立屋等住宅選擇。不同類型的樓層安排與戶外空間各有特色，可按家庭對上下樓、室內面積分布及戶外活動的需要選盤。\n\n屋苑資料列有泳池、健身室、兒童遊樂及桑拿等設施，可把康樂配套與居住空間一併比較。現有放盤出現不同組別名稱，宜按實際門牌及圖則辨認單位類型。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/d/a/9/d118a89a3ac63d2afa96c9b06b05a0f3.jpg",
    "seo_title": "愛琴灣｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "愛琴灣位於青發街2號。應核對組別名稱對應的是分層、複式還是獨立屋，避免把天台或花園條件套用至其他戶型。晉誠地產 C-018613。"
  },
  {
    "slug": "oma-by-the-sea",
    "name_zh": "OMA by the Sea",
    "name_en": "OMA by the Sea",
    "district_slug": "castle-peak-road",
    "aliases": [
      "OMA by the Sea",
      "OMA BY THE SEA"
    ],
    "address": "青山公路大欖段166號",
    "description": "OMA by the Sea位於青山公路大欖段，是以分層住宅為主的私人屋苑。官方項目資料以海濱生活及園林設計作介紹，選盤時可把單位的室內布局、露台安排與實際外望一起比較。\n\n項目介紹設有園林及泳池等康樂空間，可納入家庭日常休閒需要。各單位樓層和座向不同，官方網站亦說明景觀會受周邊環境影響，宜以現場視線作判斷。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/78/7889533d3eea8d8dea6718bc2c140466d853544aeee4f6868eca2953a0d4cd75.jpg",
    "seo_title": "OMA by the Sea｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "OMA by the Sea位於青山公路大欖段166號。看樓時須在客飯廳、睡房及露台確認實際景觀，並了解周邊環境對採光及開窗感受的影響。晉誠地產 C-018613。"
  },
  {
    "slug": "palm-cove",
    "name_zh": "翠濤居",
    "name_en": "Palm Cove",
    "district_slug": "castle-peak-road",
    "aliases": [
      "翠濤居",
      "Palm Cove",
      "PALM COVE"
    ],
    "address": "青山公路青山灣段168號",
    "description": "翠濤居位於三聖青山公路青山灣段，是由多座住宅大廈組成的私人屋苑。屋苑提供不同家庭型間隔，可按睡房數目、客飯廳形狀及日常收納需要，比較座數與戶型。\n\n公開屋苑資料列有泳池、網球場、桌球及兒童遊樂設施，康樂配套可連同單位空間一起考慮。看樓時宜比較大廈與公用設施之間的路程，以及不同樓層的採光與景觀。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/8f/8f628dbfe5852a4d770602ea64a9f46751534a19aade4ee06cc48db414e20f81.jpg",
    "seo_title": "翠濤居｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "翠濤居位於青山公路青山灣段168號。應按實際座數及樓層確認外望方向，並檢查客飯廳及睡房的家具擺位是否符合家庭需要。晉誠地產 C-018613。"
  },
  {
    "slug": "pun-lung-bun-do",
    "name_zh": "蟠龍半島",
    "name_en": "Beaulieu Peninsula",
    "district_slug": "castle-peak-road",
    "aliases": [
      "蟠龍半島",
      "Beaulieu Peninsula",
      "蟠龍半島 三層洋房",
      "蟠龍半島三層洋房",
      "蟠龍半島 獨立屋",
      "蟠龍半島獨立屋"
    ],
    "address": "瑜翠街2號",
    "description": "蟠龍半島位於掃管笏瑜翠街，是兼有洋房與分層式選擇的低密度私人住宅。不同屋型的室內分布與戶外空間各異，尋找家庭居所時宜先確認屋型及是否包含全幢物業。\n\n屋苑資料列有泳池、運動及兒童設施，現有放盤亦有花園和私家車房的選擇。看樓時可把屋內樓層、戶外休憩及泊車動線串連起來，衡量是否合乎家庭生活習慣。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/ae/ae8688aeef547cba5a65a0574fc829f5136abab059a9fac3973ccd382d9a9cb3.jpg",
    "seo_title": "蟠龍半島｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "蟠龍半島位於瑜翠街2號。必須分清獨立屋與分層洋房；花園、車房、天台及共用地方的範圍應按契約核對。晉誠地產 C-018613。"
  },
  {
    "slug": "royal-cove-tower",
    "name_zh": "帝灣居",
    "name_en": "Royal Cove",
    "district_slug": "castle-peak-road",
    "aliases": [
      "帝灣居",
      "Royal Cove",
      "ROYAL COVE TOWER"
    ],
    "address": "嘉和里山路2號",
    "description": "帝灣居位於掃管笏嘉和里山路，是同時提供分層住宅與洋房的私人項目。分層單位與洋房的房間分布、樓梯及戶外空間各有不同，適合按家庭的日常活動和上下樓需要比較。\n\n公開資料介紹分層單位設有套房及儲物空間，而洋房則有較多分層安排。選盤時宜先核對所屬住宅類型，再把客飯廳、廚房和輔助空間逐一落實到實際家具擺位。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/c/e/180ec74c4fd0be97d1d241f51e40bbec.jpg",
    "seo_title": "帝灣居｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "帝灣居位於嘉和里山路2號。不能因網址或放盤簡稱含大廈便推斷住宅類型；應核對是分層單位還是洋房及其入口。晉誠地產 C-018613。"
  },
  {
    "slug": "royal-dragon-villa",
    "name_zh": "嘉御龍庭",
    "name_en": "Royal Dragon Villa",
    "district_slug": "ting-kau",
    "aliases": [
      "嘉御龍庭",
      "Royal Dragon Villa",
      "ROYAL DRAGON VILLA"
    ],
    "address": "青山公路汀九段321號",
    "description": "嘉御龍庭位於青山公路汀九段，是汀九／油柑頭一帶的低密度洋房屋苑。住宅以全屋分層使用為主要特色，選盤時可按家庭成員的起居安排，比較各層房間與公共活動空間。\n\n公開屋苑資料列有會所、泳池及健身等設施，可與洋房本身的戶外空間一起考慮。看樓時宜完整走過各層及停車動線，同時了解屋苑管理和物業保養的安排。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/d/4/5/252dcfeffb5ea212f047b5220026a47f.jpeg",
    "seo_title": "嘉御龍庭｜油柑頭／汀九屋苑資料、租售放盤",
    "seo_description": "嘉御龍庭位於青山公路汀九段321號。應按汀九而非屯門規劃生活圈，並逐層核對洋房內部樓梯、戶外空間及停車安排。晉誠地產 C-018613。"
  },
  {
    "slug": "seaside-castle",
    "name_zh": "畔海",
    "name_en": "Seaside Castle",
    "district_slug": "castle-peak-road",
    "aliases": [
      "畔海",
      "Seaside Castle",
      "SEASIDE CASTLE"
    ],
    "address": "澄麗路9號",
    "description": "畔海位於小欖澄麗路，是由獨立洋房組成的私人住宅項目。住宅以多房及套房安排為特色，可按家庭成員、訪客和工作空間需要，逐層比較起居與睡房的分布。\n\n這類全幢洋房的使用感受與一般分層住宅不同，室內樓梯、戶外空間和泊車動線都值得一併考察。看樓時宜了解各層的實際採光、私隱及保養，而非只比較總面積。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/d/c/3/4dd478d18530ede031cbf003e2521312.jpg",
    "seo_title": "畔海｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "畔海位於小欖澄麗路，是由獨立洋房組成的私人住宅項目。住宅以多房及套房安排為特色，可按家庭成員、訪客和工作空間需要，逐層比較起居與睡房的分布。晉誠地產 C-018613。"
  },
  {
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "name_en": "Peridot Court",
    "district_slug": "castle-peak-road",
    "aliases": [
      "瑜翠園",
      "Peridot Court"
    ],
    "address": "瑜翠街9號",
    "description": "瑜翠園位於掃管笏瑜翠街，是分層私人住宅屋苑。不同座數的樓層配置有別，家庭可按睡房布局、客飯廳形狀及外望方向比較，並以實際家具尺寸確認空間是否合用。\n\n公開屋苑資料列有泳池、網球、壁球、健身及兒童遊樂等設施，可把屋內空間與日常康樂需要一併考慮。看樓時宜同時查看公用部分的保養和由大堂往設施的步行動線。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/77/770eccf3710c9adc09f63132b37230f95f0b5711b79b6ed400f31148d18043c1.jpg",
    "seo_title": "瑜翠園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "瑜翠園位於瑜翠街9號。應按實際座數及樓層確認採光與外望，並了解公用地方、窗戶及浴室的維修保養狀況。晉誠地產 C-018613。"
  },
  {
    "slug": "monte-carlo-villas",
    "name_zh": "蒙地卡羅別墅",
    "name_en": "Monte Carlo Villas",
    "district_slug": "castle-peak-road",
    "aliases": [
      "蒙地卡羅別墅",
      "Monte Carlo Villas"
    ],
    "address": "青山公路青山灣段25號",
    "description": "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是掃管笏及青山灣一帶的私人住宅項目。\n\n屋苑由洋房組成。比較放盤時可一併核對屋號、室內間隔，以及花園和車位等附連範圍。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1e/1ebc954d2ced6db1cff3b7fd69d1eef380216bbf85e717e22b1ce828019139e2.webp",
    "seo_title": "蒙地卡羅別墅｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是掃管笏及青山灣一帶的私人住宅項目。比較蒙地卡羅別墅租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "name_en": "L'Aquatique",
    "district_slug": "tsing-lung-tau",
    "aliases": [
      "逸璟．龍灣",
      "L'Aquatique",
      "逸璟龍灣",
      "逸璟‧龍灣"
    ],
    "address": "青山公路青龍頭段108號",
    "description": "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，是區內的私人住宅屋苑。\n\n項目由兩座住宅大廈組成。選盤時可按座別、樓層及座向比較，實際景觀及採光宜在睇樓時確認。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/7/8/b/b6740003588d99f67968a649e9fba067.jpg",
    "seo_title": "逸璟．龍灣｜青龍頭屋苑資料、租售放盤",
    "seo_description": "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，是區內的私人住宅屋苑。比較逸璟．龍灣租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "deauville",
    "name_zh": "星岸",
    "name_en": "Deauville",
    "district_slug": "ting-kau",
    "aliases": [
      "星岸",
      "Deauville",
      "星岸大廈"
    ],
    "address": "青山公路汀九段380號",
    "description": "星岸（Deauville）位於青山公路汀九段380號，屬油柑頭及汀九一帶的私人住宅項目。\n\n項目包括分層住宅及洋房。瀏覽放盤時，宜先分清物業類型，再比較各單位的樓層、戶外空間及景觀。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/56/56abcc171952c57c6cedb1b91fa48a7c415347bd3637a3159147907d3653a4f2.jpg",
    "seo_title": "星岸｜油柑頭／汀九屋苑資料、租售放盤",
    "seo_description": "星岸（Deauville）位於青山公路汀九段380號，屬油柑頭及汀九一帶的私人住宅項目。比較星岸租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "long-beach-gardens",
    "name_zh": "海濤花園",
    "name_en": "Long Beach Gardens",
    "district_slug": "ting-kau",
    "aliases": [
      "海濤花園",
      "Long Beach Gardens"
    ],
    "address": "青山公路汀九段103號",
    "description": "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，是油柑頭及汀九一帶的私人住宅屋苑。\n\n屋苑由兩座住宅大廈組成。比較放盤時可一併核對座別、樓層、間隔及室內保養，景觀則以單位現場為準。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/24/241e4ed6a8f6913ebc420e9a13badeced4b3b752c796980f429a35e300f40f37.jpg",
    "seo_title": "海濤花園｜油柑頭／汀九屋苑資料、租售放盤",
    "seo_description": "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，是油柑頭及汀九一帶的私人住宅屋苑。即睇海濤花園放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "riviera",
    "name_zh": "麗海別墅",
    "name_en": "Riviera",
    "district_slug": "ting-kau",
    "aliases": [
      "麗海別墅",
      "Riviera"
    ],
    "address": "青山公路汀九段369號",
    "description": "麗海別墅（Riviera）位於青山公路汀九段369號，屬油柑頭及汀九一帶的私人住宅。\n\n麗海別墅為單幢住宅。睇樓時可重點比較單位間隔、實際採光及公共部分保養，並核對車位是否包含在放盤條件內。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/a/5/2/61b9e3267ef9e369eea3236791ad2d53.jpg",
    "seo_title": "麗海別墅｜油柑頭／汀九屋苑資料、租售放盤",
    "seo_description": "麗海別墅（Riviera）位於青山公路汀九段369號，屬油柑頭及汀九一帶的私人住宅。比較麗海別墅租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "both-wealth-garden",
    "name_zh": "均富花園",
    "name_en": "Both Wealth Garden",
    "district_slug": "castle-peak-road",
    "aliases": [
      "均富花園",
      "Both Wealth Garden"
    ],
    "address": "掃管笏村第一區",
    "description": "均富花園（Both Wealth Garden）位於掃管笏村第一區，是掃管笏一帶的住宅項目。\n\n晉誠現有放盤以期數標示物業。搜尋及睇樓時宜一併核對期數、座別與完整地址，以分清不同單位。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/1/8/e/7a6e8678e0447977e58ff48c0500499d.jpg",
    "seo_title": "均富花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "均富花園（Both Wealth Garden）位於掃管笏村第一區，是掃管笏一帶的住宅項目。即睇均富花園放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "fiona-garden",
    "name_zh": "富安新邨",
    "name_en": "Fiona Garden",
    "district_slug": "castle-peak-road",
    "aliases": [
      "富安新邨",
      "Fiona Garden",
      "富安新村"
    ],
    "address": "青泰路28號",
    "description": "富安新邨（Fiona Garden）位於青泰路28號，屬小欖及大欖一帶的住宅項目。\n\n屋苑以洋房住宅為主，現有放盤亦使用「富安新村」名稱。比較單位時，宜核對獨立門牌及戶外範圍。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/1/8/1/fdf6b5d2e4d5eb76b684e938434a2f26.jpeg",
    "seo_title": "富安新邨｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "富安新邨（Fiona Garden）位於青泰路28號，屬小欖及大欖一帶的住宅項目。比較富安新邨租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "dragon-inn-court",
    "name_zh": "容龍居",
    "name_en": "Dragon Inn Court",
    "district_slug": "castle-peak-road",
    "aliases": [
      "容龍居",
      "Dragon Inn Court"
    ],
    "address": "青霞里9號",
    "description": "容龍居（Dragon Inn Court）位於三聖青霞里9號，是青山灣及三聖一帶的私人住宅屋苑。\n\n屋苑由四座住宅大廈組成。選盤時可按座別、樓層與間隔比較，並實地了解單位及公共部分的保養。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/7/5/2/17ceacec2610f8161e6b97186f470ef6.jpeg",
    "seo_title": "容龍居｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "容龍居（Dragon Inn Court）位於三聖青霞里9號，是青山灣及三聖一帶的私人住宅屋苑。比較容龍居租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "tuen-mun-court",
    "name_zh": "屯門閣",
    "name_en": "Tuen Mun Court",
    "district_slug": "castle-peak-road",
    "aliases": [
      "屯門閣",
      "Tuen Mun Court"
    ],
    "address": "青榕街2號",
    "description": "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青榕街一帶的私人住宅大廈。\n\n屯門閣屬單幢住宅，與鄰近青榕街4號的雅翠苑為不同物業。比較放盤時宜核對大廈名稱、門牌及樓層。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/1/0/2/05d18e188a23b68f3eb743f154514631.jpg",
    "seo_title": "屯門閣｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青榕街一帶的私人住宅大廈。比較屯門閣租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "elegant-villa",
    "name_zh": "雅翠苑",
    "name_en": "Elegant Villa",
    "district_slug": "castle-peak-road",
    "aliases": [
      "雅翠苑",
      "Elegant Villa"
    ],
    "address": "青榕街4號",
    "description": "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青榕街一帶的私人住宅。\n\n雅翠苑與青榕街2號的屯門閣為不同物業。搜尋或安排睇樓時，宜一併確認屋苑名稱及門牌。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/3/7/6/cd96f59acb42cbb327d4bf070a9a9a3a.jpg",
    "seo_title": "雅翠苑｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青榕街一帶的私人住宅。比較雅翠苑租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "pearl-island-bungalow",
    "name_zh": "龍珠島平房",
    "name_en": "Pearl Island Bungalow",
    "district_slug": "castle-peak-road",
    "aliases": [
      "龍珠島平房",
      "Pearl Island Bungalow",
      "龍珠島別墅"
    ],
    "address": "青龍路9號",
    "description": "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的住宅項目。\n\n現有放盤包括F1及F5座。它與青龍路11號的龍珠島花園為不同屋苑，選盤時應按名稱、門牌及座別分辨。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/a/5/e/534dfb816d73e407eaaa1878c96d485e.jpg",
    "seo_title": "龍珠島平房｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的住宅項目。比較龍珠島平房租售單位及睇樓條件。晉誠地產 C-018613。"
  },
  {
    "slug": "pearl-garden",
    "name_zh": "龍珠花園",
    "name_en": "Pearl Garden",
    "district_slug": "castle-peak-road",
    "aliases": [
      "龍珠花園",
      "Pearl Garden"
    ],
    "address": "青龍路7號",
    "description": "龍珠花園（Pearl Garden）位於掃管笏青龍路7號，是龍珠島一帶的私人住宅屋苑。\n\n屋苑由四座住宅大廈組成，與青龍路9號的龍珠島平房及11號的龍珠島花園均為不同物業。搜尋放盤時宜按正式名稱及門牌分辨。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/d2/d26242b165dd439bb04e3052ff65994f07ed2652a0d570a3ec450167616c8557.webp",
    "seo_title": "龍珠花園｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "龍珠花園（Pearl Garden）位於掃管笏青龍路7號，是龍珠島一帶的私人住宅屋苑。即睇龍珠花園放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "peak-castle",
    "name_zh": "珀居",
    "name_en": "Peak Castle",
    "district_slug": "castle-peak-road",
    "aliases": [
      "珀居",
      "Peak Castle"
    ],
    "address": "冠發街8A–8H、8J、10、12、16、18、20、22號",
    "description": "珀居（Peak Castle）位於小欖冠發街，正式門牌包括8A至8H、8J、10、12、16、18、20及22號。\n\n項目由洋房組成。選盤時宜核對各洋房的獨立門牌，以及花園、天台、泳池及車位等範圍是否屬於放盤條件。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/62/62051f93d6f782391f0e9ba95514217b5c68afd32ba746f5e3f5a531c6824c55.webp",
    "seo_title": "珀居｜小欖至三聖屋苑資料、租售放盤",
    "seo_description": "珀居（Peak Castle）位於小欖冠發街，正式門牌包括8A至8H、8J、10、12、16、18、20及22號。比較珀居租售單位及睇樓條件。晉誠地產 C-018613。"
  }
]
$estate_content$::jsonb) AS x(
   slug text,name_zh text,name_en text,district_slug text,aliases text[],address text,
   description text,hero_image text,seo_title text,seo_description text)
)
INSERT INTO estates AS current (
 slug,name_zh,name_en,district_slug,district_id,aliases,address,description,hero_image,
 seo_title,seo_description,published)
SELECT c.slug,c.name_zh,c.name_en,c.district_slug,d.id,c.aliases,c.address,c.description,
 c.hero_image,c.seo_title,c.seo_description,true
FROM content c JOIN districts d ON d.slug=c.district_slug
ON CONFLICT (slug) DO UPDATE SET
 name_en=COALESCE(NULLIF(trim(current.name_en),''),EXCLUDED.name_en),
 district_id=COALESCE(current.district_id,EXCLUDED.district_id),
 aliases=ARRAY(SELECT DISTINCT alias FROM unnest(COALESCE(current.aliases,'{}'::text[])||EXCLUDED.aliases) alias
   WHERE NOT(current.slug='lung-chu-island-garden' AND alias='龍珠島別墅') ORDER BY alias),
 address=COALESCE(NULLIF(trim(current.address),''),EXCLUDED.address),
 description=COALESCE(NULLIF(trim(current.description),''),EXCLUDED.description),
 hero_image=COALESCE(NULLIF(trim(current.hero_image),''),EXCLUDED.hero_image),
 seo_title=COALESCE(NULLIF(trim(current.seo_title),''),EXCLUDED.seo_title),
 seo_description=COALESCE(NULLIF(trim(current.seo_description),''),EXCLUDED.seo_description),
 published=true,updated_at=now()
-- A same-slug row in another district/identity is not publication authority.
WHERE current.district_slug=EXCLUDED.district_slug AND current.name_zh=EXCLUDED.name_zh
 AND (NOT current.published OR current.district_id IS NULL
  OR NULLIF(trim(current.name_en),'') IS NULL OR NULLIF(trim(current.address),'') IS NULL
  OR NULLIF(trim(current.description),'') IS NULL OR NULLIF(trim(current.hero_image),'') IS NULL
  OR NULLIF(trim(current.seo_title),'') IS NULL OR NULLIF(trim(current.seo_description),'') IS NULL
  OR NOT COALESCE(current.aliases,'{}'::text[]) @> EXCLUDED.aliases
  OR (current.slug='lung-chu-island-garden' AND '龍珠島別墅'=ANY(current.aliases)));

-- Exact reviewed source records only. Do not infer from descriptions or bare
-- addresses, replace explicit foreign keys, or link inactive/edited records.
SELECT set_config('app.admin_property_write','on',true);

WITH reviewed AS (
 SELECT * FROM jsonb_to_recordset($reviewed_links$
[
  {
    "listing_no": "R063140-6774804-S",
    "title_zh": "青山別墅 C座 海景閣 售盤 #R063140",
    "address": "樂翠街19號 青山別墅 C座 海景閣",
    "source_url": "https://www.earnestproperty.com/property-detail/6774804.html",
    "slug": "castle-peak-villas",
    "name_zh": "青山別墅",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "T032104-6714430-S",
    "title_zh": "青山別墅 售盤 #T032104",
    "address": "青山公路大欖段19號 青山別墅",
    "source_url": "https://www.earnestproperty.com/property-detail/6714430.html",
    "slug": "castle-peak-villas",
    "name_zh": "青山別墅",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A064297-6759950-S",
    "title_zh": "青榕台 售盤 #A064297",
    "address": "青榕街8號 青榕台",
    "source_url": "https://www.earnestproperty.com/property-detail/6759950.html",
    "slug": "ching-yung-toi",
    "name_zh": "青榕臺",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C005594-6708230-R",
    "title_zh": "青榕台 第02座 租盤 #C005594",
    "address": "青榕街8號 青榕台 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6708230.html",
    "slug": "ching-yung-toi",
    "name_zh": "青榕臺",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "T031325-6733870-R",
    "title_zh": "青榕台 第03座 租盤 #T031325",
    "address": "青榕街8號 青榕台 第03座",
    "source_url": "https://www.earnestproperty.com/property-detail/6733870.html",
    "slug": "ching-yung-toi",
    "name_zh": "青榕臺",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "T033887-6707408-R",
    "title_zh": "青榕台 租盤 #T033887",
    "address": "青榕街8號 青榕台",
    "source_url": "https://www.earnestproperty.com/property-detail/6707408.html",
    "slug": "ching-yung-toi",
    "name_zh": "青榕臺",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C003079-6767962-S",
    "title_zh": "棕月灣 第02座 售盤 #C003079",
    "address": "青山公路28號青山灣段 棕月灣 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6767962.html",
    "slug": "chung-yuet-waan",
    "name_zh": "棕月灣",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A071622-6760346-R",
    "title_zh": "飛揚 租盤 #A071622",
    "address": "青山公路170號大欖段 飛揚",
    "source_url": "https://www.earnestproperty.com/property-detail/6760346.html",
    "slug": "fei-yeung",
    "name_zh": "飛揚",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A071622-6760346-S",
    "title_zh": "飛揚 售盤 #A071622",
    "address": "青山公路170號大欖段 飛揚",
    "source_url": "https://www.earnestproperty.com/property-detail/6760346.html",
    "slug": "fei-yeung",
    "name_zh": "飛揚",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "R071729-6769464-S",
    "title_zh": "飛揚 第03座 售盤 #R071729",
    "address": "青山公路170號大欖段 飛揚 第03座",
    "source_url": "https://www.earnestproperty.com/property-detail/6769464.html",
    "slug": "fei-yeung",
    "name_zh": "飛揚",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "T034061-6754444-S",
    "title_zh": "海澄軒 第02座 售盤 #T034061",
    "address": "青發街8號 海澄軒 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6754444.html",
    "slug": "hoi-ching-hin",
    "name_zh": "海澄軒",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A072841-6718458-R",
    "title_zh": "海景花園 租盤 #A072841",
    "address": "青榕街1號 海景花園",
    "source_url": "https://www.earnestproperty.com/property-detail/6718458.html",
    "slug": "hoi-king-garden",
    "name_zh": "海景花園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B053826-6766052-S",
    "title_zh": "海慧花園 售盤 #B053826",
    "address": "青茵街8號 海慧花園",
    "source_url": "https://www.earnestproperty.com/property-detail/6766052.html",
    "slug": "hoi-wai-garden",
    "name_zh": "海慧花園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A061940-6759146-S",
    "title_zh": "海譽 售盤 #A061940",
    "address": "青榕街3號 海譽",
    "source_url": "https://www.earnestproperty.com/property-detail/6759146.html",
    "slug": "hoi-yu",
    "name_zh": "海譽",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A052224-6728266-S",
    "title_zh": "琨崙 金琥珀 洋房 售盤 #A052224",
    "address": "青發里8號 琨崙 金琥珀 洋房",
    "source_url": "https://www.earnestproperty.com/property-detail/6728266.html",
    "slug": "kwan-lun",
    "name_zh": "琨崙",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A060071-6772058-S",
    "title_zh": "琨崙 金琥珀 洋房 售盤 #A060071",
    "address": "青發里8號 琨崙 金琥珀 洋房",
    "source_url": "https://www.earnestproperty.com/property-detail/6772058.html",
    "slug": "kwan-lun",
    "name_zh": "琨崙",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A049210-6773962-R",
    "title_zh": "龍珠島花園 第07座 租盤 #A049210",
    "address": "青龍路11號 龍珠島花園 第07座",
    "source_url": "https://www.earnestproperty.com/property-detail/6773962.html",
    "slug": "lung-chu-island-garden",
    "name_zh": "龍珠島花園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B048806-6574040-S",
    "title_zh": "南岸 售盤 #B048806",
    "address": "青山公路116號青山灣段 南岸",
    "source_url": "https://www.earnestproperty.com/property-detail/6574040.html",
    "slug": "nam-ngon",
    "name_zh": "南岸",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A069372-6761036-S",
    "title_zh": "NAPA HSE 售盤 #A069372",
    "address": "掃管笏路88號 NAPA HSE",
    "source_url": "https://www.earnestproperty.com/property-detail/6761036.html",
    "slug": "napa",
    "name_zh": "NAPA",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B054537-6757956-S",
    "title_zh": "NAPA TWR 01 售盤 #B054537",
    "address": "掃管笏路88號 NAPA TWR 01",
    "source_url": "https://www.earnestproperty.com/property-detail/6757956.html",
    "slug": "napa",
    "name_zh": "NAPA",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "R066142-6769412-R",
    "title_zh": "緹岸 第02座 租盤 #R066142",
    "address": "管翠路8號 緹岸 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6769412.html",
    "slug": "ocean-camino",
    "name_zh": "緹岸",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B068404-6586494-S",
    "title_zh": "OMA BY THE SEA TWR 02 售盤 #B068404",
    "address": "青山公路166號大欖段 OMA BY THE SEA TWR 02",
    "source_url": "https://www.earnestproperty.com/property-detail/6586494.html",
    "slug": "oma-by-the-sea",
    "name_zh": "OMA by the Sea",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "SYNC-b0966755-13df-41e4-b572-7fbdb50124cd",
    "title_zh": "(晉誠地產全部真盤) 《2房連平台》 震撼的4XX萬收票！有匙即看！青公路邊！",
    "address": "新界屯門(青山公路)OMA by the Sea 青山公路大欖段166號",
    "source_url": "https://www.28hse.com/buy/apartment/property-4063699",
    "slug": "oma-by-the-sea",
    "name_zh": "OMA by the Sea",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A049547-6750654-R",
    "title_zh": "翠濤居 第03座 租盤 #A049547",
    "address": "青山公路168號青山灣段 翠濤居 第03座",
    "source_url": "https://www.earnestproperty.com/property-detail/6750654.html",
    "slug": "palm-cove",
    "name_zh": "翠濤居",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A067118-6708936-S",
    "title_zh": "蟠龍半島 D型 售盤 #A067118",
    "address": "瑜翠街2號 蟠龍半島 D型",
    "source_url": "https://www.earnestproperty.com/property-detail/6708936.html",
    "slug": "pun-lung-bun-do",
    "name_zh": "蟠龍半島",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C009961-6776748-R",
    "title_zh": "蟠龍半島 租盤 #C009961",
    "address": "瑜翠街2號 蟠龍半島",
    "source_url": "https://www.earnestproperty.com/property-detail/6776748.html",
    "slug": "pun-lung-bun-do",
    "name_zh": "蟠龍半島",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C014535-6707160-R",
    "title_zh": "嘉御龍庭 租盤 #C014535",
    "address": "青山公路321號汀九段 嘉御龍庭",
    "source_url": "https://www.earnestproperty.com/property-detail/6707160.html",
    "slug": "royal-dragon-villa",
    "name_zh": "嘉御龍庭",
    "district_slug": "ting-kau"
  },
  {
    "listing_no": "A035863-6773180-S",
    "title_zh": "瑜翠園 售盤 #A035863",
    "address": "瑜翠街9號 瑜翠園",
    "source_url": "https://www.earnestproperty.com/property-detail/6773180.html",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A053166-6708202-S",
    "title_zh": "瑜翠園 第03座 售盤 #A053166",
    "address": "瑜翠街9號 瑜翠園 第03座",
    "source_url": "https://www.earnestproperty.com/property-detail/6708202.html",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B056049-6767470-S",
    "title_zh": "瑜翠園 第02座 售盤 #B056049",
    "address": "瑜翠街9號 瑜翠園 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6767470.html",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B065045-6770098-R",
    "title_zh": "瑜翠園 第05座 租盤 #B065045",
    "address": "瑜翠街9號 瑜翠園 第05座",
    "source_url": "https://www.earnestproperty.com/property-detail/6770098.html",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C004331-6726116-S",
    "title_zh": "瑜翠園 第06座 售盤 #C004331",
    "address": "瑜翠街9號 瑜翠園 第06座",
    "source_url": "https://www.earnestproperty.com/property-detail/6726116.html",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C019238-6708914-S",
    "title_zh": "瑜翠園 第03座 售盤 #C019238",
    "address": "瑜翠街9號 瑜翠園 第03座",
    "source_url": "https://www.earnestproperty.com/property-detail/6708914.html",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "SYNC-0906f14c-d125-4344-9d84-3aa4a2a37f73",
    "title_zh": "(晉誠地產YouTube實景） 《連車位》 有匙！高層有海景！有小路出青山公路！",
    "address": "新界屯門(青山公路)瑜翠園 瑜翠街9號",
    "source_url": "https://www.28hse.com/buy/apartment/property-4040071",
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "SYNC-8262b471-9232-4e40-ab9b-af57dd493e87",
    "title_zh": "(晉誠地產豪宅推介) 兩層靚則獨立大屋!連千五呎大花園!黃金地段!罕有放盤!",
    "address": null,
    "source_url": "https://www.28hse.com/buy/apartment/property-3992791",
    "slug": "monte-carlo-villas",
    "name_zh": "蒙地卡羅別墅",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B057492-6733958-S",
    "title_zh": "逸璟龍灣 第02座 售盤 #B057492",
    "address": "青山公路108號青龍頭段 逸璟龍灣 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6733958.html",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "B064381-6741282-R",
    "title_zh": "逸璟龍灣 租盤 #B064381",
    "address": "青山公路108號青龍頭段 逸璟龍灣",
    "source_url": "https://www.earnestproperty.com/property-detail/6741282.html",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "B065160-6776144-S",
    "title_zh": "逸璟龍灣 第02座 售盤 #B065160",
    "address": "青山公路108號青龍頭段 逸璟龍灣 第02座",
    "source_url": "https://www.earnestproperty.com/property-detail/6776144.html",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "B068657-6795338-S",
    "title_zh": "逸璟龍灣 售盤 #B068657",
    "address": "青山公路108號青龍頭段 逸璟龍灣",
    "source_url": "https://www.property.hk/asking_detail/eps/wendy/6795338.html",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "B070102-6757228-R",
    "title_zh": "逸璟龍灣 第01座 租盤 #B070102",
    "address": "青山公路108號青龍頭段 逸璟龍灣 第01座",
    "source_url": "https://www.earnestproperty.com/property-detail/6757228.html",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "R070029-6805460-S",
    "title_zh": "逸璟龍灣 第02座 售盤 #R070029",
    "address": "青山公路108號青龍頭段 逸璟龍灣 第02座",
    "source_url": "https://www.property.hk/asking_detail/ept/lee/6805460.html",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "SYNC-394cee68-14bf-42c4-b415-a4ea815d3502",
    "title_zh": "(晉誠地產筍盤推介) 青馬橋海景！深井區樓齡最新！樓底高自設閣仔！",
    "address": "新界深井(荃灣)逸璟龍灣 青山公路青龍頭段108 號",
    "source_url": "https://www.28hse.com/buy/apartment/property-4033461",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "SYNC-8a937a3d-2522-402c-8979-a11867139dc2",
    "title_zh": "（晉誠地產筍盤推介) 向南青馬橋海景！3房套！深井區最新樓齡屋苑！",
    "address": "新界深井(荃灣)逸璟龍灣 青山公路青龍頭段108 號",
    "source_url": "https://www.28hse.com/buy/apartment/property-4053663",
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau"
  },
  {
    "listing_no": "B047469-6727964-S",
    "title_zh": "（晉誠地產VR實景) 新地星級豪宅！前後花園覆式！向南汀九橋海！連2車位！",
    "address": "新界深井(荃灣)星岸大廈 青山公路汀九段380號",
    "source_url": "https://www.28hse.com/buy/apartment/property-4065990",
    "slug": "deauville",
    "name_zh": "星岸",
    "district_slug": "ting-kau"
  },
  {
    "listing_no": "SYNC-8a0920bd-e9c7-41e3-a21e-7f0273f7bde9",
    "title_zh": "(晉誠地產筍盤推介) 臨海4房高層！一梯兩伙有露台！連車位！極少放盤！",
    "address": "新界荃灣海濤花園 青山公路汀九段103號",
    "source_url": "https://www.28hse.com/buy/apartment/property-4042934",
    "slug": "long-beach-gardens",
    "name_zh": "海濤花園",
    "district_slug": "ting-kau"
  },
  {
    "listing_no": "C015931-6707290-R",
    "title_zh": "麗海別墅 租盤 #C015931",
    "address": "青山公路369號汀九段 麗海別墅",
    "source_url": "https://www.earnestproperty.com/property-detail/6707290.html",
    "slug": "riviera",
    "name_zh": "麗海別墅",
    "district_slug": "ting-kau"
  },
  {
    "listing_no": "A055347-6702630-S",
    "title_zh": "均富花園 第01期 售盤 #A055347",
    "address": "掃管笏村 均富花園 第01期",
    "source_url": "https://www.earnestproperty.com/property-detail/6702630.html",
    "slug": "both-wealth-garden",
    "name_zh": "均富花園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A064980-6781174-R",
    "title_zh": "富安新村 租盤 #A064980",
    "address": "青泰路28號 富安新村",
    "source_url": "https://www.earnestproperty.com/property-detail/6781174.html",
    "slug": "fiona-garden",
    "name_zh": "富安新邨",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C005670-6708552-R",
    "title_zh": "富安新村 租盤 #C005670",
    "address": "青山公路大欖段 富安新村",
    "source_url": "https://www.earnestproperty.com/property-detail/6708552.html",
    "slug": "fiona-garden",
    "name_zh": "富安新邨",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "C020026-6733828-S",
    "title_zh": "容龍居 第04座 售盤 #C020026",
    "address": "青霞里9號 容龍居 第04座",
    "source_url": "https://www.earnestproperty.com/property-detail/6733828.html",
    "slug": "dragon-inn-court",
    "name_zh": "容龍居",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "T024719-6575866-S",
    "title_zh": "容龍居 第01座 售盤 #T024719",
    "address": "青霞里9號 容龍居 第01座",
    "source_url": "https://www.earnestproperty.com/property-detail/6575866.html",
    "slug": "dragon-inn-court",
    "name_zh": "容龍居",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B075534-6757916-S",
    "title_zh": "屯門閣 售盤 #B075534",
    "address": "青榕街2號 屯門閣",
    "source_url": "https://www.earnestproperty.com/property-detail/6757916.html",
    "slug": "tuen-mun-court",
    "name_zh": "屯門閣",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A074399-6778974-S",
    "title_zh": "雅翠苑 售盤 #A074399",
    "address": "青榕街4號 雅翠苑",
    "source_url": "https://www.earnestproperty.com/property-detail/6778974.html",
    "slug": "elegant-villa",
    "name_zh": "雅翠苑",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "B055175-6757962-S",
    "title_zh": "雅翠苑 售盤 #B055175",
    "address": "青榕街4號 雅翠苑",
    "source_url": "https://www.earnestproperty.com/property-detail/6757962.html",
    "slug": "elegant-villa",
    "name_zh": "雅翠苑",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "A070076-6711694-S",
    "title_zh": "龍珠島平房 F5座 售盤 #A070076",
    "address": "青龍路9號 龍珠島平房 F5座",
    "source_url": "https://www.earnestproperty.com/property-detail/6711694.html",
    "slug": "pearl-island-bungalow",
    "name_zh": "龍珠島平房",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "T025199-6711696-S",
    "title_zh": "龍珠島平房 F1座 售盤 #T025199",
    "address": "青龍路 龍珠島平房 F1座",
    "source_url": "https://www.earnestproperty.com/property-detail/6711696.html",
    "slug": "pearl-island-bungalow",
    "name_zh": "龍珠島平房",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "SYNC-1b53747f-7898-4cb8-b588-0dab41741d03",
    "title_zh": "(晉誠地產全部真盤) 《連車位》 低密度全海有露台!一梯兩伙!極少放盤!有邨巴!",
    "address": null,
    "source_url": "https://www.28hse.com/buy/apartment/property-3993236",
    "slug": "pearl-garden",
    "name_zh": "龍珠花園",
    "district_slug": "castle-peak-road"
  },
  {
    "listing_no": "SYNC-b72b4dd0-6c4c-42d7-98ff-b2a3443f2c68",
    "title_zh": "(晉誠地產豪宅推介) 《有匙即看》 兩層靚則獨立屋!大花園!蝕讓三千多萬!",
    "address": null,
    "source_url": "https://www.28hse.com/buy/apartment/property-4002400",
    "slug": "peak-castle",
    "name_zh": "珀居",
    "district_slug": "castle-peak-road"
  }
]
$reviewed_links$::jsonb) AS x(listing_no text,title_zh text,address text,source_url text,slug text,name_zh text,district_slug text)
)
UPDATE properties p SET estate_id=e.id
FROM reviewed r JOIN estates e ON e.slug=r.slug AND e.published=true
 AND e.name_zh=r.name_zh AND e.district_slug=r.district_slug
WHERE p.listing_no=r.listing_no AND p.status='active' AND p.estate_id IS NULL
 AND p.title_zh IS NOT DISTINCT FROM r.title_zh
 AND p.address IS NOT DISTINCT FROM r.address
 AND p.source_url IS NOT DISTINCT FROM r.source_url;

SELECT set_config('app.admin_property_write','',true);

-- Existing intake resolves canonical names/aliases from estates. In particular,
-- 龍珠島別墅 belongs only to Pearl Island Bungalow (9 青龍路), not Garden (11號).
COMMIT;
