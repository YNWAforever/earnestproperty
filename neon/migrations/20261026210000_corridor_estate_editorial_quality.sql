-- Reviewed public corridor estate content, 2026-10-26. Prepared only, not applied.
-- Evidence: src/content/fixtures/corridor-estate-quality-20261026.json.
-- Updates only the 40 reviewed, still-published identities. No property or ingestion writes.
-- Replace audited baseline/blank prose and SEO field by field; preserve later authored edits.
-- Retain nonblank agency hero images, filling blanks from the reviewed photo provenance.
BEGIN;

WITH reviewed AS (
 SELECT * FROM jsonb_to_recordset($editorial_content$
[
  {
    "slug": "bayview-terrace",
    "name_zh": "碧翠花園",
    "district_slug": "castle-peak-road",
    "before_description": "碧翠花園位於三聖一帶的青山公路青山灣段，是同時提供分層住宅與洋房的私人屋苑。選盤時宜先確定住宅類型，再比較客飯廳、睡房及戶外空間的安排，避免把兩類物業直接作同一標準比較。\n\n公開屋苑資料列有泳池、網球場及兒童遊樂設施，日常康樂配套也是看樓重點。分層單位與洋房的出入口、景觀及管理安排各有不同，適合連同家庭活動和泊車需要一起考慮。",
    "before_seo_title": "碧翠花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "碧翠花園位於青山公路青山灣段107號。同苑兼有洋房及分層住宅，須按實際門牌核對花園、平台與車位是否屬該物業。晉誠地產 C-018613。",
    "description": "碧翠花園（Bayview Terrace）位於三聖青山公路青山灣段107號，屋苑把分層住宅與洋房放在同一社區內。分層單位與全幢物業的空間分布不同，既可比較家庭房間配置，也可按需要尋找較多戶外活動空間的選擇。\n\n屋苑資料列有室外泳池、網球場、健身室及兒童遊樂設施，適合把運動和親子活動放進日常生活的家庭。選盤可先分清物業類型，再看大門、住宅入口與康樂設施的相對位置；有車家庭亦宜連同泊車位置評估，才能把室內面積轉化成合用的生活空間。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/5/f/8/58bf4c9fa5c25874c54c4ffe0e70d341.jpg",
    "seo_title": "碧翠花園 Bayview Terrace｜三聖青山灣分層及洋房租售",
    "seo_description": "碧翠花園 Bayview Terrace 位於三聖青山灣段107號，分層住宅與洋房兼備，設泳池、網球場及兒童設施。比較戶型、戶外空間與車位，查看租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "castle-peak-villas",
    "name_zh": "青山別墅",
    "district_slug": "castle-peak-road",
    "before_description": "青山別墅位於小欖樂翠街，屬分層住宅屋苑，名稱中的「別墅」不代表每個單位都是獨立屋。屋苑的座名及單位布局各有分別，尋找家庭居所時可重點比較客飯廳、房間和露台的實際連接方式。\n\n現有放盤可見連露台及車位的選擇，適合把室內空間、戶外活動和駕車安排一併評估。看樓時亦宜留意樓宇及公用部分的保養，並向代理確認車位是否包含在租售條件內。",
    "before_seo_title": "青山別墅｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "青山別墅位於樂翠街19號。應以樂翠街門牌及座名核對物業；個別來源把地址簡寫為青山公路，不能據此判斷實際入口。晉誠地產 C-018613。",
    "description": "青山別墅（Castle Peak Villas）位於小欖樂翠街19號，由多座分層住宅組成，名稱中的「別墅」並不表示每個放盤都是獨立屋。屋苑單位提供較寬裕的室內空間，客飯廳和多房布局值得連同家庭人數及家具尺寸一起考慮。\n\n晉誠放盤可見連臨海露台及車位的單位，適合喜歡在家看景、又需要駕車出入的家庭逐盤比較。這類成熟住宅的吸引力亦在空間使用方式：大露台與客廳怎樣連接、房間能否兼作書房，以及車位到住宅的搬運路線，都比單看裝修照片更能反映實際居住感受。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/38/384abf198c6ca47ef656ca788e1976edacc32c1082a7a9e8ab8270c8d2091128.jpg",
    "seo_title": "青山別墅 Castle Peak Villas｜小欖樂翠街住宅租售",
    "seo_description": "青山別墅 Castle Peak Villas 位於小欖樂翠街19號，提供較大面積分層住宅，個別放盤有臨海露台及車位。比較家庭間隔與租售選擇。晉誠地產 C-018613。"
  },
  {
    "slug": "ching-lai-waan-villas",
    "name_zh": "青麗灣別墅",
    "district_slug": "castle-peak-road",
    "before_description": "青麗灣別墅座落小欖樂翠街，是以洋房為主的低密度私人住宅。屋內分層與花園、天台的銜接，是這類物業與一般分層住宅的主要分別，適合按家庭成員的活動習慣逐層看樓。\n\n現有放盤介紹包括私家車房及前後花園的選擇，可把泊車、種植和戶外休憩需要一併考慮。各幢洋房的朝向及配置未必相同，海景、戶外空間和車房條件均應按實際單位確認。",
    "before_seo_title": "青麗灣別墅｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "青麗灣別墅位於樂翠街6–18號。洋房的前後花園、天台和車房須逐項核對契約範圍，並實測樓梯對長幼成員是否合用。晉誠地產 C-018613。",
    "description": "青麗灣別墅（The Castle Bay）位於小欖樂翠街6–18號，是洋房組成的低密度住宅。這裏的選屋重點在全幢生活的安排：起居空間與睡房如何分層、家人每天要走多少樓梯，以及室內與花園、天台的連接是否符合生活習慣。\n\n晉誠洋房放盤可見前後花園、天台及私家車房的組合，讓種植、戶外休憩與泊車需要一併考慮。部分放盤亦以向南海景介紹，各幢方向和配置仍有分別；看樓可由車房走進屋內，再逐層走到戶外空間，具體感受一家人的活動範圍與私隱。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/35/35b60726094f0c3abcbc1d21e9554d2390a13dc80950e5d7b8a635dadf8b289d.jpg",
    "seo_title": "青麗灣別墅 The Castle Bay｜小欖樂翠街洋房租售",
    "seo_description": "青麗灣別墅 The Castle Bay 位於小欖樂翠街6–18號，是低密度洋房社區，個別放盤有前後花園、天台及私家車房。比較全幢間隔與洋房租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "ching-yung-toi",
    "name_zh": "青榕臺",
    "district_slug": "castle-peak-road",
    "before_description": "青榕臺位於青榕街，是三聖一帶的分層私人住宅屋苑。屋苑提供家庭型單位，可按客飯廳尺度、睡房位置及收納需要比較不同座數與戶型，而非只看樓盤照片中的裝修。\n\n公開屋苑資料列有泳池、會所及運動設施，並有巴士、小巴交通資訊。看樓時可同時了解住宅大堂、康樂設施與出入口之間的路程，再衡量日常使用是否方便。",
    "before_seo_title": "青榕臺｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "青榕臺位於青榕街8號。青榕街上不同樓層及座向的開揚程度會有分別，宜在室內核對景觀、採光與窗外遮擋。晉誠地產 C-018613。",
    "description": "青榕臺（Tsing Yung Terrace）位於三聖青榕街8號，是以家庭間隔為重點的分層住宅屋苑。公開資料列有三至四房選擇，適合有獨立睡房、書房或較多收納需要的家庭，按實際平面圖比較房間尺寸與客飯廳的比例。\n\n屋苑設有會所、泳池、兒童及運動設施，家庭活動可以連同室內空間一併安排。晉誠放盤亦可見露台和海景單位；看樓除了欣賞外望方向，亦值得由住宅大堂走到康樂設施及青榕街候車點，了解不同座數的日常路程是否適合接送小朋友和帶購物回家。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/b4/b4f12661f6db2c1cccdd354f8a32f1ee64cd257ba270dabf5065756bf8a88155.jpg",
    "seo_title": "青榕臺 Tsing Yung Terrace｜三聖三至四房住宅租售",
    "seo_description": "青榕臺 Tsing Yung Terrace 位於三聖青榕街8號，提供三至四房住宅，設會所、泳池及兒童設施，個別放盤有露台及海景。查看家庭住宅租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "chui-king-garden",
    "name_zh": "翠景花園",
    "district_slug": "castle-peak-road",
    "before_description": "翠景花園位於青泰路，是由洋房組成的低密度住宅，公開資料以歐陸式排屋設計作介紹。尋找較多室內外活動空間的家庭，可把屋內樓層分布、花園使用及泊車動線作為看樓主線。\n\n現有放盤以花園洋房作介紹，實際可用範圍和維護安排值得仔細比較。屋苑規模與一般大型分層社區不同，宜一併了解公用部分管理、保養分工及相關費用。",
    "before_seo_title": "翠景花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "翠景花園位於青泰路20號。花園是此類洋房的主要比較項目，須核對界線、排水及維護責任，而不只憑放盤面積描述。晉誠地產 C-018613。",
    "description": "翠景花園（Jade View Villa）位於青泰路20號，是以歐陸式排屋設計為特色的低密度洋房社區。屋內分層與花園的銜接，比大型分層屋苑更直接影響生活方式；希望增加戶外休憩或種植空間的家庭，可由花園與客廳的連接開始選屋。\n\n晉誠放盤有連花園洋房選擇，適合把室內房間、戶外活動與泊車安排放在同一次看樓中評估。這類住宅亦需要住戶參與更多保養決定，可一併了解花園排水、外牆及公用部分的管理分工，衡量維護所需時間與預算，讓全幢生活的空間優點切合實際需要。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1e/1edce3beba410ed109e4fb4d0db5551f46f50df57e56a9c9eb163772c9750243.webp",
    "seo_title": "翠景花園 Jade View Villa｜青泰路花園洋房租售",
    "seo_description": "翠景花園 Jade View Villa 位於青泰路20號，是歐陸式排屋設計的低密度洋房社區，個別放盤連花園。比較全幢空間、戶外生活與洋房租售選擇。晉誠地產 C-018613。"
  },
  {
    "slug": "chun-wo-sea-view-garden",
    "name_zh": "春和海景花園",
    "district_slug": "castle-peak-road",
    "before_description": "春和海景花園位於青山公路青山灣段，屬掃管笏一帶的分層私人住宅。屋苑提供家庭型單位，現有放盤亦有露台及連車位的選擇，可按室內空間、戶外活動和駕車需要逐項比較。\n\n公開屋苑資料列有泳池、網球及壁球設施，康樂配套可與單位布局一起考慮。個別放盤以沙灘海景作介紹，景觀仍須按座數、樓層及室內實際視線核對。",
    "before_seo_title": "春和海景花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "春和海景花園位於青山公路青山灣段33號。看樓時應分別站在客飯廳及露台確認景觀，同時了解臨青山公路一側的開窗環境。晉誠地產 C-018613。",
    "description": "春和海景花園（Spring Seaview Terrace）位於青山公路青山灣段33號，是三座分層樓宇組成的私人屋苑。單位有家庭型間隔及較寬裕的空間選擇，適合需要多個房間、獨立廚房或在家工作位置的住戶，按圖則比較客飯廳與睡房分布。\n\n晉誠放盤可見帶露台、沙灘海景及車位的單位，屋苑資料亦列有會所、泳池及運動設施。選屋可把景觀和實際使用一起衡量：在客廳與露台分別看海景、了解臨路一側的開窗感受，再走到黃金泳灘一帶候車位置，看看海濱生活是否配合一家人的平日節奏。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/3d/3dab39f1fedbe804e074e8d35d439f2172895f10d37e89a222b30af49a4c7a85.jpg",
    "seo_title": "春和海景花園 Spring Seaview Terrace｜青山灣住宅租售",
    "seo_description": "春和海景花園 Spring Seaview Terrace 位於青山公路青山灣段33號，是三座分層住宅屋苑，設會所及泳池，個別放盤有露台與沙灘海景。查看租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "chung-yuet-waan",
    "name_zh": "棕月灣",
    "district_slug": "castle-peak-road",
    "before_description": "棕月灣位於青山公路青山灣段，屬掃管笏一帶的私人住宅。屋苑以家庭型單位為主，現有放盤包括複式選擇，適合把公共活動空間與睡房分層的安排納入比較。\n\n屋苑資料列有泳池、健身室和兒童遊樂設施，可連同日常家庭活動需要一起評估。複式與一般分層單位的生活動線不同，看樓時宜逐層了解房間、浴室及收納配置。",
    "before_seo_title": "棕月灣｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "棕月灣位於青山公路青山灣段，屬掃管笏一帶的私人住宅。屋苑以家庭型單位為主，現有放盤包括複式選擇，適合把公共活動空間與睡房分層的安排納入比較。晉誠地產 C-018613。",
    "description": "棕月灣（Palm Beach）位於青山公路青山灣段28號，是兩座住宅組成、以較大面積家庭單位為特色的私人屋苑。與細戶為主的項目相比，選盤可更集中考慮客飯廳尺度、多房用途和家庭成員的活動分布，讓換樓空間對應實際需要。\n\n屋苑資料列有室外泳池、健身室、兒童遊樂及嬉水設施，晉誠放盤亦可見連車位的複式選擇。複式把起居與睡房分層，適合希望增加生活分區的家庭；看樓時宜連同樓梯、浴室及收納位置逐層了解，再比較一般分層與複式哪一種更適合全家人的生活節奏。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/0e/0e34d2bf93186ff756e2db1fbbde1ece2a36f6a1cfac0994fe9c67472a23fb1b.webp",
    "seo_title": "棕月灣 Palm Beach｜青山灣家庭大單位及複式租售",
    "seo_description": "棕月灣 Palm Beach 位於青山公路青山灣段28號，是兩座家庭住宅屋苑，設泳池、健身及兒童設施，個別放盤為連車位複式。比較大單位間隔與租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "fei-yeung",
    "name_zh": "飛揚",
    "district_slug": "castle-peak-road",
    "before_description": "飛揚位於青山公路大欖段，是分期發展的分層私人住宅屋苑。不同期數、座數與戶型提供不同空間選擇，尋找自住單位時可先確認所需間隔，再比較客飯廳形狀及睡房尺度。\n\n屋苑包含由較精簡至家庭型的戶型，家具擺位和收納安排對實際居住感受尤其重要。看樓時宜按具體期數及單位平面圖，逐一核對廚房、浴室與生活空間的比例。",
    "before_seo_title": "飛揚｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "飛揚位於青山公路大欖段170號。必須核對放盤所屬期數和座數；不同戶型的間隔、外望方向及出入口路程不能互相套用。晉誠地產 C-018613。",
    "description": "飛揚（Grand Jeté）位於青山公路大欖段170號，是分兩期發展的私人住宅，戶型由一房至三房，讓獨居住戶、小家庭與需要更多睡房的家庭在同一項目內比較。選盤可先按房數和生活人數分組，再看具體期數、座數與平面圖。\n\n精簡戶型要留意餐桌、沙發及衣櫃的擺位，家庭戶則可比較廚房形式、浴室及睡房的比例。晉誠放盤涵蓋一房、兩房及三房選擇，部分以泳池景或海景介紹；看樓宜在確認間隔合用後，再比較採光、外望方向與由住宅入口往青山公路的實際步行路線。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/f/c/e8f252c0a4992f4c2192d8e4459b43a8.jpg",
    "seo_title": "飛揚 Grand Jeté｜大欖段一至三房住宅買賣及租盤",
    "seo_description": "飛揚 Grand Jeté 位於青山公路大欖段170號，分兩期發展，提供一房至三房住宅。由精簡戶到家庭戶，比較間隔、廚房與景觀方向，查看買賣及租盤。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-ching-hin",
    "name_zh": "海澄軒",
    "district_slug": "castle-peak-road",
    "before_description": "海澄軒位於小欖青發街，是分層私人住宅屋苑，與其他地區的同名物業須清楚區分。現有放盤包括連車位的家庭型選擇，可把房間分布、客飯廳和泊車需要一起考慮。\n\n公開屋苑資料列有泳池、健身室、壁球場及園林花園，屋內外活動空間可一併比較。各座與不同樓層的景觀、採光及出入動線仍有差別，宜按實際單位看樓。",
    "before_seo_title": "海澄軒｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "海澄軒位於青發街8號。應先確認是小欖青發街的 Villa Sapphire，並核對連車位條款及大堂至停車位置的動線。晉誠地產 C-018613。",
    "description": "海澄軒（Villa Sapphire）位於小欖青發街8號，是兩座分層住宅組成的屋苑，與其他地區的同名物業有別。單位有不同面積組別，家庭可按睡房用途及客飯廳比例選擇，亦可把小型社區規模和公用康樂設施一起考慮。\n\n公開資料列有室外泳池、健身室、壁球場、園林花園及兒童遊樂設施，讓家庭在室內以外有活動選擇。晉誠放盤可見連車位的家庭戶；看樓時可把單位、大堂、停車位置及常用設施串成一條生活路線，觀察採光、景觀與搬運購物的便利程度是否符合需要。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1b/1b335c3abf6400edd5f2561e9ad05fb3d18553c173a397a718712b057f500d80.webp",
    "seo_title": "海澄軒 Villa Sapphire｜小欖青發街住宅買賣及租盤",
    "seo_description": "海澄軒 Villa Sapphire 位於小欖青發街8號，是兩座分層住宅社區，設泳池、健身室、壁球場及園林花園。比較家庭間隔與連車位租售選擇。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-king-garden",
    "name_zh": "海景花園",
    "district_slug": "castle-peak-road",
    "before_description": "海景花園位於三聖青榕街，是由多座住宅大廈組成的私人屋苑。屋苑有不同間隔選擇，家庭可按睡房數目、客飯廳布局及收納需要比較單位，並留意座數與外望方向的分別。\n\n公開屋苑資料列有室外泳池、網球場、羽毛球及兒童遊樂設施，適合把康樂配套納入日常生活考慮。屋苑名稱包含「海景」，但每個單位的視野仍須在實際樓層確認。",
    "before_seo_title": "海景花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "海景花園位於青榕街1號。不同座向的海景及遮擋情況可能不同，應在客廳和睡房分別確認視野，而非只憑屋苑名稱。晉誠地產 C-018613。",
    "description": "海景花園（Seaview Garden）位於三聖青榕街1號，是多座分層住宅組成的成熟屋苑，設有兩房及三房選擇。由二人住戶到需要子女房或書房的家庭，都可按房數、客飯廳布局和收納需求，選擇合適的面積及座數。\n\n屋苑資料列有室外泳池、網球、羽毛球、壁球及兒童遊樂設施，日常運動與親子活動是比較居住需要的一部分。多座布局亦令外望方向與出入路程各有分別；選盤時可先確認合用戶型，再在客廳與睡房實看景觀，連同住宅到青榕街大門和康樂設施的路線一併衡量。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/f/8/5/08afcca7aaada5af73483caa275d1fab.jpg",
    "seo_title": "海景花園 Seaview Garden｜三聖青榕街兩至三房租售",
    "seo_description": "海景花園 Seaview Garden 位於三聖青榕街1號，提供兩房及三房住宅，設泳池、網球、羽毛球及兒童設施。比較家庭間隔、座向與買賣租盤。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-wai-garden",
    "name_zh": "海慧花園",
    "district_slug": "castle-peak-road",
    "before_description": "海慧花園位於三聖青茵街，是兼有分層住宅與洋房的私人屋苑。不同住宅類型的室內分布、戶外空間及出入口各有特色，可先按生活方式選定類型，再比較具體放盤。\n\n現有放盤涵蓋洋房選擇，公用康樂資料亦列有泳池及運動設施。看樓時宜把單位、停車位置和公用部分串連成日常動線，了解實際使用是否符合家庭需要。",
    "before_seo_title": "海慧花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "海慧花園位於青茵街8號。同苑的分層住宅與洋房不可直接套用相同條件；花園、平台及車位權益須按個別物業核對。晉誠地產 C-018613。",
    "description": "海慧花園（Aquamarine Garden）位於三聖青茵街8號，是兼有分層住宅與洋房的私人屋苑。兩類物業提供不同生活方式：分層住宅可集中比較房間和客飯廳，洋房則要把各層起居、戶外空間及車房的連接一起考慮。\n\n屋苑資料列有會所、泳池、兒童及運動設施，晉誠洋房放盤亦可見花園、天台及獨立車房組合。想在同一社區比較分層與全幢生活的家庭，可先列出是否需要私人戶外空間、能否接受樓梯，以及泊車習慣，再按具體門牌看樓，讓物業類型與每天的活動方式相配。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/d1/d17aaef525ccba8aef3715c2d34cf13a655aa203e295814b72c7bf0070307166.jpg",
    "seo_title": "海慧花園 Aquamarine Garden｜三聖分層住宅及洋房租售",
    "seo_description": "海慧花園 Aquamarine Garden 位於三聖青茵街8號，兼有分層住宅與洋房，設會所及泳池，個別洋房有花園、天台及獨立車房。查看租售選擇。晉誠地產 C-018613。"
  },
  {
    "slug": "hoi-yu",
    "name_zh": "海譽",
    "district_slug": "castle-peak-road",
    "before_description": "海譽位於三聖青榕街，是單幢式私人住宅。與多座式屋苑相比，選盤時可更集中比較同一大廈內不同樓層及座向，並按房間位置、客飯廳比例及採光挑選合用單位。\n\n公開屋苑資料列有泳池、健身室及閱讀空間，現有放盤亦以海景和車位選配作介紹。景觀與泊車條件均應逐項確認，並把大堂、車庫與住宅之間的日常動線納入考慮。",
    "before_seo_title": "海譽｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "海譽位於青榕街3號。現有放盤提及可配車位，須確認是另租、另購還是包含在條件內，並實地核對海景視線。晉誠地產 C-018613。",
    "description": "海譽（Crown By The Sea）位於三聖青榕街3號，是單幢私人住宅，適合偏好精簡社區規模的家庭。選盤重點可集中在同幢不同樓層與方向，按客飯廳尺度、睡房位置及採光比較，並把家庭家具與收納需要放進實際平面圖考慮。\n\n公開資料列有室外泳池、健身室及閱讀室，住戶可在屋內生活以外安排運動和安靜活動。晉誠放盤以海景及車位選配作介紹；看樓時可先在各房間確認視線，再走一遍大堂、停車位置與青榕街出入口，衡量單幢住宅的空間和日常出入是否適合一家人。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/ae/ae65106225cd33e3cba9bd939a30e2f5e1972ab8f793112753fbed9c0355d94c.webp",
    "seo_title": "海譽 Crown By The Sea｜三聖青榕街單幢住宅租售",
    "seo_description": "海譽 Crown By The Sea 位於三聖青榕街3號，是設有泳池、健身室及閱讀室的單幢住宅，個別放盤有海景及車位選配。比較家庭間隔與租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "kwan-lun",
    "name_zh": "琨崙",
    "district_slug": "castle-peak-road",
    "before_description": "琨崙位於小欖青發里，是結合分層、複式及洋房設計的低密度私人住宅。不同組別和戶型的垂直動線與戶外空間各有分別，選盤前宜先確認是分層單位還是全幢洋房。\n\n公開屋苑資料列有會所、泳池及兒童設施，現有放盤亦可見金琥珀等組別名稱。看樓時宜按實際組別與單位圖則，逐層比較生活、睡房和戶外活動空間的安排。",
    "before_seo_title": "琨崙｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "琨崙位於青發里8號。放盤可能使用洋房組別名稱描述分層或複式單位，須核對樓層範圍及是否包含全幢物業。晉誠地產 C-018613。",
    "description": "琨崙（Jade Grove）位於小欖青發里8號，是結合分層、複式及洋房的低密度住宅。不同組別名稱之下，可能有不同樓層範圍及物業類型；希望增加家庭空間的買家，可先確認是分層複式還是全幢洋房，再按生活分區選擇。\n\n公開資料列有會所、泳池及兒童設施，晉誠放盤亦涵蓋金琥珀、青玥琳等組別。這裏的比較不只在面積，而在每天如何使用多層空間：起居、睡房及戶外活動的位置、室內樓梯，以及車位至住宅的路線都值得逐項查看，讓大面積居所真正配合家人作息與私隱需要。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/5/1/464f55ec15fb07fa1daa36fad11b8d07.jpeg",
    "seo_title": "琨崙 Jade Grove｜小欖青發里複式及洋房買賣租盤",
    "seo_description": "琨崙 Jade Grove 位於小欖青發里8號，是分層複式與洋房並存的低密度住宅，設會所、泳池及兒童設施。按組別比較多層空間與租售選擇。晉誠地產 C-018613。"
  },
  {
    "slug": "kwun-hoi-villas",
    "name_zh": "觀海別墅",
    "district_slug": "ting-kau",
    "before_description": "觀海別墅位於青山公路汀九段，屬汀九／油柑頭一帶的私人住宅。公開屋苑資料及成交紀錄可見複式選擇，適合希望把起居與睡房分層安排的家庭按實際圖則比較。\n\n此處的生活範圍應按汀九及荃灣方向規劃。看樓時可把屋內樓梯、入口與停車安排一併了解，並留意樓宇及公用部分的保養，衡量是否符合日常使用習慣。",
    "before_seo_title": "觀海別墅｜油柑頭／汀九屋苑資料、租售放盤",
    "before_seo_description": "觀海別墅位於青山公路汀九段386號。汀九地址不可與屯門同類海濱屋苑混淆；複式單位應逐層檢視樓梯、採光和室內保養。晉誠地產 C-018613。",
    "description": "觀海別墅（Vista Del Mar）位於青山公路汀九段386號，是汀九一帶規模精簡、提供較大面積單位的私人住宅。與屯門青山灣或小欖物業相比，這裏的日常生活應以汀九及荃灣方向規劃，選屋時宜先確認工作、購物和家庭活動的路線。\n\n公開成交資料可見複式選擇，適合希望把起居與睡房分層的家庭進一步了解。成熟大單位的吸引力在空間分配，看樓可逐層比較採光、房間用途與樓梯，再了解窗戶、外牆及公用部分的保養；連同入口和停車安排一起查看，較能掌握實際居住方式與後續維護需要。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/b/0/70a74c8ec7bd8c429dc7f4c59e963c7c.jpg",
    "seo_title": "觀海別墅 Vista Del Mar｜汀九大單位及複式租售",
    "seo_description": "觀海別墅 Vista Del Mar 位於青山公路汀九段386號，是規模精簡的私人住宅，提供較大面積單位及複式選擇。了解家庭空間與荃灣方向生活，查看租售盤。晉誠地產 C-018613。"
  },
  {
    "slug": "lung-chu-island-garden",
    "name_zh": "龍珠島花園",
    "district_slug": "castle-peak-road",
    "before_description": "龍珠島花園位於青龍路，是龍珠島一帶由低層住宅組成的私人屋苑。公開屋苑資料可見家庭型間隔，部分成交紀錄亦涉及花園或天台，可按樓層與戶外空間需要比較單位。\n\n屋苑設有泳池，日常康樂與單位內部空間可一併考慮。不同樓層的出入方式、採光及戶外使用條件未必相同，看樓時宜由入口走到單位，完整體驗日常路程。",
    "before_seo_title": "龍珠島花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "龍珠島花園位於青龍路11號。看樓前應確認上落樓層方式；花園、天台及平台是否專用和隨物業轉讓，須逐項核對。晉誠地產 C-018613。",
    "description": "龍珠島花園沿青龍路而建，以低層分層住宅為主，與青山公路沿線的高層屋苑有不同居住尺度。家庭型單位是選盤重點，而公開成交紀錄可見花園、天台及平台等組合，適合先按樓層和戶外空間需要縮窄選擇。\n\n屋苑設有泳池，住客可把屋內起居與屋苑休閒安排一起考慮。地面花園戶、普通分層及頂層單位的使用方式各異，出入口、上落樓層及停車位置亦影響日常便利；看樓時宜走完整段回家路線，再比較客飯廳、睡房與外望。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/8e/8ebd6372f460076ae63aaf5e630aae6081ed36b7ec724ad4a7907b06155a2861.jpg",
    "seo_title": "龍珠島花園 Pearl Island Garden｜青龍路低層住宅租售",
    "seo_description": "龍珠島花園位於青龍路11號，以低層家庭住宅及泳池配套為特色；比較普通分層、花園與天台單位，查看龍珠島生活動線及租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "nam-ngon",
    "name_zh": "南岸",
    "district_slug": "castle-peak-road",
    "before_description": "南岸位於三聖一帶的青山公路青山灣段，是單幢式分層私人住宅。屋苑以家庭型間隔為主，公開資料介紹有獨立廚房、露台及工作平台，可按煮食、收納和家庭活動需要比較。\n\n屋苑資料列有泳池、健身室、兒童設施及燒烤空間，住宅與康樂配套可一併評估。不同座向的單位面向景觀有所分別，宜在客飯廳、睡房及露台逐一確認實際視野。",
    "before_seo_title": "南岸｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "南岸位於青山公路青山灣段116號。須在室內核對青山灣方向的視野及遮擋，並檢查露台、工作平台與客飯廳的使用動線。晉誠地產 C-018613。",
    "description": "南岸位於三聖青山公路青山灣段，是以三房家庭單位為主的單幢住宅。獨立廚房、露台及工作平台，把煮食、晾曬與起居空間分開，選盤時可按一家人的家務習慣和家具尺寸，比較客飯廳與房間布局。\n\n向海景觀是南岸的選盤焦點，但不同單位可見的青山灣、避風塘或較遠海岸方向並不相同。屋苑另有泳池、健身和兒童康樂設施，適合把家庭活動放在同一生活範圍內規劃；日常購物及對外交通則宜連同三聖和屯門市中心一併考慮。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/04/04d8c87b1df833e08daf623c83d49617d34e3e3488192af9a11e5d0ef553209f.jpg",
    "seo_title": "南岸 South Crest｜三聖青山灣三房住宅租售",
    "seo_description": "南岸位於青山公路青山灣段116號，是三聖單幢三房住宅，具獨立廚房、露台及泳池配套；了解向海座向、家庭布局與租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "napa",
    "name_zh": "NAPA",
    "district_slug": "castle-peak-road",
    "before_description": "NAPA位於掃管笏路，是同時提供分層住宅與洋房的私人屋苑。兩類物業在樓層分布、戶外空間及出入動線上各有特色，可先確定家庭需要，再比較具體座數與單位。\n\n公開屋苑資料列有會所、泳池及娛樂設施，康樂活動可連同居住空間一起考慮。看樓時宜由實際住宅入口走到公用設施及停車位置，了解日常路程是否合用。",
    "before_seo_title": "NAPA｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "NAPA位於掃管笏路88號。分層與洋房放盤的花園、天台和車位條件各有不同，必須按個別單位圖則及租售條款核對。晉誠地產 C-018613。",
    "description": "NAPA位於掃管笏路88號，同一屋苑兼有分層住宅與洋房，適合先按家庭規模和上下樓需要選定物業類型。分層單位可比較房間配置與廚房形式；洋房則須把各層起居、戶外空間和停車安排串連起來，理解實際可用的生活範圍。\n\n屋苑設有會所、泳池及休閒設施，讓住客把室內居住空間與日常康樂活動一起規劃。由大門到所屬住宅、停車位置及公用設施的路程，是比較不同放盤的重要部分；有小孩或長者的家庭，宜在看樓時親身走過常用路線。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/8/2/9/7c6b63e09c39928784f20d761c23bd89.jpg",
    "seo_title": "NAPA｜掃管笏路分層住宅及洋房租售",
    "seo_description": "NAPA位於掃管笏路88號，兼備分層住宅與洋房，設有泳池及休閒配套；按家庭房數、戶外空間和出入動線比較租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "nga-tak-yuen",
    "name_zh": "雅德苑",
    "district_slug": "castle-peak-road",
    "before_description": "雅德苑位於三聖青榕街，是分層私人住宅屋苑。公開屋苑資料所列單位以較寬敞的家庭空間為特色，選盤時可仔細比較客飯廳形狀、睡房分布，以及實際家具擺位。\n\n屋苑資料列有室外泳池及日光浴空間，可連同家庭的休閒習慣一起評估。看樓時亦宜了解公用部分與單位內部的保養，並比較不同座數和樓層的採光及外望。",
    "before_seo_title": "雅德苑｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "雅德苑位於青榕街6號。大戶型應按家具尺寸實測客飯廳與房間，並檢查窗邊、浴室和公用部分的保養狀況。晉誠地產 C-018613。",
    "description": "雅德苑位於三聖青榕街，以大面積分層單位形成鮮明定位。公開屋苑資料的實用面積集中於1,751至1,761平方呎，適合需要較多起居、收納或工作空間的家庭；選盤重點是客飯廳比例、房間分布，以及現有裝修是否切合生活習慣。\n\n屋苑由兩座住宅組成，資料列有室外泳池及日光浴空間，住客可兼顧家中活動與屋苑休閒。大戶型的家具、冷氣及保養需求亦值得納入預算；看樓時應連同公用地方、窗邊和濕區一起檢查，並比較不同樓層的採光及外望。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/59/5992dd4bc265744fd9e4d96156c41241afc9c4daf5c09f67a29af9fb643732f8.jpg",
    "seo_title": "雅德苑 Faraday House｜三聖青榕街大戶住宅租售",
    "seo_description": "雅德苑位於三聖青榕街6號，以大面積分層單位及兩座住宅規模為特色，資料列有室外泳池；比較家庭布局、保養狀況及租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "ocean-camino",
    "name_zh": "緹岸",
    "district_slug": "castle-peak-road",
    "before_description": "緹岸位於掃管笏管翠路，是分期發展、兼有分層住宅與洋房的私人屋苑。戶型由較精簡單位至家庭型住宅皆有，選盤時宜先釐清期數、座數及住宅類型，再比較間隔。\n\n公開屋苑資料列有會所、泳池及娛樂設施，可連同屋內活動空間一起考慮。各期大廈與洋房的出入口及步行路線不同，應由實際單位出發了解日常使用動線。",
    "before_seo_title": "緹岸｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "緹岸位於管翠路8號。須核對第幾期、座數及分層或洋房類型，並按實際平面圖評估睡房、收納及家具擺位。晉誠地產 C-018613。",
    "description": "緹岸位於掃管笏管翠路，是分期發展、兼有住宅大廈與洋房的屋苑。戶型涵蓋開放式、小型單位以至多房家庭住宅，同一屋苑的面積與使用方式差距明顯，選盤宜先按家庭人數、房數和預算確立類型，再細看期數與座號。\n\n分層單位的家具擺位、廚房與收納安排，是精簡戶型能否住得合用的關鍵；洋房則要同時理解上下樓及戶外動線。屋苑康樂配套可納入日常生活規劃，但所屬大廈與大門、設施及候車位置的距離，仍應由實際單位起點逐段比較。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/5d/5d85da6a8de8c28c54b5e2b36d3cbf06119908de5d0ddbfc64915afcf7f407b1.jpg",
    "seo_title": "緹岸 Ocean Camino｜掃管笏管翠路住宅及洋房租售",
    "seo_description": "緹岸位於掃管笏管翠路8號，分期提供開放式、小型家庭戶至洋房；了解期數、座號、戶型布局與出入路線，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "oi-kam-waan",
    "name_zh": "愛琴灣",
    "district_slug": "castle-peak-road",
    "before_description": "愛琴灣位於小欖青發街，提供分層、複式及獨立屋等住宅選擇。不同類型的樓層安排與戶外空間各有特色，可按家庭對上下樓、室內面積分布及戶外活動的需要選盤。\n\n屋苑資料列有泳池、健身室、兒童遊樂及桑拿等設施，可把康樂配套與居住空間一併比較。現有放盤出現不同組別名稱，宜按實際門牌及圖則辨認單位類型。",
    "before_seo_title": "愛琴灣｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "愛琴灣位於青發街2號。應核對組別名稱對應的是分層、複式還是獨立屋，避免把天台或花園條件套用至其他戶型。晉誠地產 C-018613。",
    "description": "愛琴灣位於小欖青發街，將分層、複式與獨立屋放在同一屋苑，為家庭提供不同的空間分配方式。普通分層便於在同一層安排起居；複式及獨立屋則可把公共活動與睡房分層處理，選盤時應先確定上下樓習慣和實際房間用途。\n\n屋苑設有泳池、健身室及兒童活動設施，可把屋內生活與康樂活動一起規劃。由於放盤可使用多層大廈、複式或屋號等不同稱呼，應按門牌及圖則辨認身份；同時比較入口、停車與戶外空間的關係，了解每天回家的完整動線。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/d/a/9/d118a89a3ac63d2afa96c9b06b05a0f3.jpg",
    "seo_title": "愛琴灣 The Aegean｜小欖分層、複式及獨立屋租售",
    "seo_description": "愛琴灣位於小欖青發街2號，提供分層、複式與獨立屋，設有泳池及健身配套；按家庭動線、住宅類型和戶外條件比較租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "oma-by-the-sea",
    "name_zh": "OMA by the Sea",
    "district_slug": "castle-peak-road",
    "before_description": "OMA by the Sea位於青山公路大欖段，是以分層住宅為主的私人屋苑。官方項目資料以海濱生活及園林設計作介紹，選盤時可把單位的室內布局、露台安排與實際外望一起比較。\n\n項目介紹設有園林及泳池等康樂空間，可納入家庭日常休閒需要。各單位樓層和座向不同，官方網站亦說明景觀會受周邊環境影響，宜以現場視線作判斷。",
    "before_seo_title": "OMA by the Sea｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "OMA by the Sea位於青山公路大欖段166號。看樓時須在客飯廳、睡房及露台確認實際景觀，並了解周邊環境對採光及開窗感受的影響。晉誠地產 C-018613。",
    "description": "OMA by the Sea位於青山公路大欖段，以分層住宅配合園林與泳池空間。官方介紹的瑞士木屋建築意象及園景設計，為屋苑帶來較鮮明的休閒風格；選盤時可同時比較家中起居面積、露台安排，以及日常使用公用休憩空間的需要。\n\n向海生活是項目的主要定位，但實際外望仍取決於樓層、座向及周邊環境，應以所看單位的現場視線為準。由大欖段出入，亦需要把候車、駕車和日常採購一起規劃，適合先試過平日生活路線，再判斷園林及海岸環境是否切合居住習慣。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/78/7889533d3eea8d8dea6718bc2c140466d853544aeee4f6868eca2953a0d4cd75.jpg",
    "seo_title": "OMA by the Sea｜青山公路大欖段園林住宅租售",
    "seo_description": "OMA by the Sea位於青山公路大欖段166號，以園林設計、木屋建築意象及泳池空間為特色；比較分層戶型、實際景觀與租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "palm-cove",
    "name_zh": "翠濤居",
    "district_slug": "castle-peak-road",
    "before_description": "翠濤居位於三聖青山公路青山灣段，是由多座住宅大廈組成的私人屋苑。屋苑提供不同家庭型間隔，可按睡房數目、客飯廳形狀及日常收納需要，比較座數與戶型。\n\n公開屋苑資料列有泳池、網球場、桌球及兒童遊樂設施，康樂配套可連同單位空間一起考慮。看樓時宜比較大廈與公用設施之間的路程，以及不同樓層的採光與景觀。",
    "before_seo_title": "翠濤居｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "翠濤居位於青山公路青山灣段168號。應按實際座數及樓層確認外望方向，並檢查客飯廳及睡房的家具擺位是否符合家庭需要。晉誠地產 C-018613。",
    "description": "翠濤居位於三聖青山公路青山灣段，提供兩房及三房等家庭型分層住宅。不同戶型的客飯廳比例與房間配置，是按家庭人數選盤的起點；小家庭可留意起居與收納是否足夠，需要多一間房的住戶則可比較工作及睡房的分配。\n\n屋苑設有室外泳池、網球場、桌球和兒童活動設施，住客可把家中空間與屋苑康樂安排一起衡量。三聖位置亦讓日常生活可連同區內配套及屯門市中心規劃；看樓時宜留意所屬座數至大門和設施的路程，以及室內採光、外望和保養。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/8f/8f628dbfe5852a4d770602ea64a9f46751534a19aade4ee06cc48db414e20f81.jpg",
    "seo_title": "翠濤居 Palm Cove｜三聖兩房及三房住宅租售",
    "seo_description": "翠濤居位於三聖青山公路青山灣段168號，提供兩房及三房分層戶，設泳池、網球及兒童配套；了解家庭布局與租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "pun-lung-bun-do",
    "name_zh": "蟠龍半島",
    "district_slug": "castle-peak-road",
    "before_description": "蟠龍半島位於掃管笏瑜翠街，是兼有洋房與分層式選擇的低密度私人住宅。不同屋型的室內分布與戶外空間各異，尋找家庭居所時宜先確認屋型及是否包含全幢物業。\n\n屋苑資料列有泳池、運動及兒童設施，現有放盤亦有花園和私家車房的選擇。看樓時可把屋內樓層、戶外休憩及泊車動線串連起來，衡量是否合乎家庭生活習慣。",
    "before_seo_title": "蟠龍半島｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "蟠龍半島位於瑜翠街2號。必須分清獨立屋與分層洋房；花園、車房、天台及共用地方的範圍應按契約核對。晉誠地產 C-018613。",
    "description": "蟠龍半島位於掃管笏瑜翠街，是兼有獨立屋與分層洋房選擇的低密度住宅。兩類物業對私隱、上下樓及戶外活動有不同安排，家庭宜先確認購買或租用的是全幢還是其中一層，再比較各房間和客飯廳的實際分布。\n\n屋苑資料列有泳池、網球及兒童設施，可連同海岸一帶的生活環境一起考慮。現有放盤亦有花園及私家車房組合，但並非每戶相同；看樓時應把室內樓層、花園、車房與屋苑出入口連成完整路線，衡量長幼成員和日常採購的需要。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/ae/ae8688aeef547cba5a65a0574fc829f5136abab059a9fac3973ccd382d9a9cb3.jpg",
    "seo_title": "蟠龍半島 Beaulieu Peninsula｜掃管笏獨立屋及分層洋房租售",
    "seo_description": "蟠龍半島位於掃管笏瑜翠街2號，提供獨立屋與分層洋房，配合泳池及網球設施；比較屋型、花園車房條件與租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "royal-cove-tower",
    "name_zh": "帝灣居",
    "district_slug": "castle-peak-road",
    "before_description": "帝灣居位於掃管笏嘉和里山路，是同時提供分層住宅與洋房的私人項目。分層單位與洋房的房間分布、樓梯及戶外空間各有不同，適合按家庭的日常活動和上下樓需要比較。\n\n公開資料介紹分層單位設有套房及儲物空間，而洋房則有較多分層安排。選盤時宜先核對所屬住宅類型，再把客飯廳、廚房和輔助空間逐一落實到實際家具擺位。",
    "before_seo_title": "帝灣居｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "帝灣居位於嘉和里山路2號。不能因網址或放盤簡稱含大廈便推斷住宅類型；應核對是分層單位還是洋房及其入口。晉誠地產 C-018613。",
    "description": "帝灣居位於掃管笏嘉和里山路，兼有分層住宅與洋房。分層戶型有套房及儲物室連廁的配置，適合需要把睡房、工作和家務空間分開的家庭；洋房則以多房、套房及書房布局為比較重點，應連同各層活動路線一起理解。\n\n兩類住宅在面積分配、入口和上下樓方式上的差異，比放盤名稱更重要。選盤時可先列出家庭成員、留宿訪客與收納需要，再按圖則逐一落實房間用途；看樓亦宜由嘉和里山路大門走到單位及停車位置，了解回家和搬運的完整動線。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/b/c/e/180ec74c4fd0be97d1d241f51e40bbec.jpg",
    "seo_title": "帝灣居 Royal Cove｜掃管笏分層住宅及洋房租售",
    "seo_description": "帝灣居位於嘉和里山路2號，兼備分層家庭戶及洋房，套房、儲物與書房配置各有特色；了解戶型分工、出入動線及租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "royal-dragon-villa",
    "name_zh": "嘉御龍庭",
    "district_slug": "ting-kau",
    "before_description": "嘉御龍庭位於青山公路汀九段，是汀九／油柑頭一帶的低密度洋房屋苑。住宅以全屋分層使用為主要特色，選盤時可按家庭成員的起居安排，比較各層房間與公共活動空間。\n\n公開屋苑資料列有會所、泳池及健身等設施，可與洋房本身的戶外空間一起考慮。看樓時宜完整走過各層及停車動線，同時了解屋苑管理和物業保養的安排。",
    "before_seo_title": "嘉御龍庭｜油柑頭／汀九屋苑資料、租售放盤",
    "before_seo_description": "嘉御龍庭位於青山公路汀九段321號。應按汀九而非屯門規劃生活圈，並逐層核對洋房內部樓梯、戶外空間及停車安排。晉誠地產 C-018613。",
    "description": "嘉御龍庭位於青山公路汀九段321號，是汀九一帶規模較小的低密度洋房屋苑。全屋分層使用，讓家庭可把會客、睡房和工作空間分開安排；選盤時宜逐層比較房間比例與私隱，並把上落樓梯納入每天的生活習慣。\n\n屋苑資料列有會所、泳池及健身等配套，但家庭的日常便利亦取決於住宅入口和停車安排。汀九的生活圈應連同荃灣方向規劃，較大型採購和鐵路轉乘可一併測試；看樓時走過各層及戶外位置，再了解管理與物業保養的分工。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/d/4/5/252dcfeffb5ea212f047b5220026a47f.jpeg",
    "seo_title": "嘉御龍庭 Royal Dragon Villa｜汀九低密度洋房租售",
    "seo_description": "嘉御龍庭位於青山公路汀九段321號，為小型低密度洋房屋苑，資料列泳池及健身配套；比較全屋分層、戶外停車條件與租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "seaside-castle",
    "name_zh": "畔海",
    "district_slug": "castle-peak-road",
    "before_description": "畔海位於小欖澄麗路，是由獨立洋房組成的私人住宅項目。住宅以多房及套房安排為特色，可按家庭成員、訪客和工作空間需要，逐層比較起居與睡房的分布。\n\n這類全幢洋房的使用感受與一般分層住宅不同，室內樓梯、戶外空間和泊車動線都值得一併考察。看樓時宜了解各層的實際採光、私隱及保養，而非只比較總面積。",
    "before_seo_title": "畔海｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "畔海位於小欖澄麗路，是由獨立洋房組成的私人住宅項目。住宅以多房及套房安排為特色，可按家庭成員、訪客和工作空間需要，逐層比較起居與睡房的分布。晉誠地產 C-018613。",
    "description": "畔海位於小欖澄麗路，是以獨立洋房組成的住宅項目。公開項目資料的間隔由四房連多套房至五房多套房，適合需要分開家庭成員、留宿訪客與工作空間的住戶；選盤時應逐層理解房間關係，而非只比較整幢總面積。\n\n全幢住宅的生活範圍延伸至室內樓梯、戶外位置和停車動線，不同洋房的採光、外望與私隱仍應現場比較。看樓時可按一家人平日作息走過各層，確認長幼成員的活動是否順手，並一併了解戶外防水、排水及日後維修責任。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/d/c/3/4dd478d18530ede031cbf003e2521312.jpg",
    "seo_title": "畔海 Seaside Castle｜小欖澄麗路獨立洋房租售",
    "seo_description": "畔海位於小欖澄麗路9號，以多房、多套房獨立洋房為特色；了解全幢空間分配、家庭樓梯動線及戶外停車條件，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "yu-chui-yuen",
    "name_zh": "瑜翠園",
    "district_slug": "castle-peak-road",
    "before_description": "瑜翠園位於掃管笏瑜翠街，是分層私人住宅屋苑。不同座數的樓層配置有別，家庭可按睡房布局、客飯廳形狀及外望方向比較，並以實際家具尺寸確認空間是否合用。\n\n公開屋苑資料列有泳池、網球、壁球、健身及兒童遊樂等設施，可把屋內空間與日常康樂需要一併考慮。看樓時宜同時查看公用部分的保養和由大堂往設施的步行動線。",
    "before_seo_title": "瑜翠園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "瑜翠園位於瑜翠街9號。應按實際座數及樓層確認採光與外望，並了解公用地方、窗戶及浴室的維修保養狀況。晉誠地產 C-018613。",
    "description": "瑜翠園位於掃管笏瑜翠街，是由多座不同高度住宅組成的分層屋苑。公開資料可見面積及房數不同的家庭單位，適合按家庭人數先選戶型，再比較客飯廳比例、睡房分布及露台等個別配置，避免只按座數或樓層作判斷。\n\n屋苑設有泳池、網球、壁球、健身及兒童活動設施，讓家中起居與運動安排可以一併考慮。部分放盤以海岸方向外望或天台作特色，但視線和戶外範圍各有不同；看樓時亦應沿大堂、公用設施及候車路線走一遍，了解實際日常使用。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/77/770eccf3710c9adc09f63132b37230f95f0b5711b79b6ed400f31148d18043c1.jpg",
    "seo_title": "瑜翠園 Peridot Court｜掃管笏家庭住宅租售",
    "seo_description": "瑜翠園位於掃管笏瑜翠街9號，提供不同面積家庭分層戶，兼備泳池、網球及壁球設施；了解座數景觀、特色單位與租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "monte-carlo-villas",
    "name_zh": "蒙地卡羅別墅",
    "district_slug": "castle-peak-road",
    "before_description": "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是掃管笏及青山灣一帶的私人住宅項目。\n\n屋苑由洋房組成。比較放盤時可一併核對屋號、室內間隔，以及花園和車位等附連範圍。",
    "before_seo_title": "蒙地卡羅別墅｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是掃管笏及青山灣一帶的私人住宅項目。比較蒙地卡羅別墅租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "蒙地卡羅別墅（Monte Carlo Villas）位於青山公路青山灣段25號，是以洋房組成的私人住宅項目。屋苑共有二十伙，公開資料所列實用面積均逾二千呎，選擇重點在整幢居住空間及屋號差異。\n\n對希望增加家庭活動與接待空間的買家，這類洋房可與青山灣一帶分層住宅一同比較。睇樓時宜沿室內動線實際走一遍，了解房間分布、傢俬擺位及不同樓層之間的使用便利。屋苑住戶規模較小，各屋裝修與保養情況是重要分野。如放盤附連花園或車位，應把可用範圍、出入口及日常打理成本納入整體預算，再與屋價及管理支出一併衡量。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1e/1ebc954d2ced6db1cff3b7fd69d1eef380216bbf85e717e22b1ce828019139e2.webp",
    "seo_title": "蒙地卡羅別墅 Monte Carlo Villas｜青山灣洋房租售、屋苑資料",
    "seo_description": "蒙地卡羅別墅 Monte Carlo Villas 位於青山公路青山灣段25號，為二十伙洋房社區，實用空間逾二千呎。了解家庭生活動線、個別屋號差異及租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "l-aquatique",
    "name_zh": "逸璟．龍灣",
    "district_slug": "tsing-lung-tau",
    "before_description": "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，是區內的私人住宅屋苑。\n\n項目由兩座住宅大廈組成。選盤時可按座別、樓層及座向比較，實際景觀及採光宜在睇樓時確認。",
    "before_seo_title": "逸璟．龍灣｜青龍頭屋苑資料、租售放盤",
    "before_seo_description": "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，是區內的私人住宅屋苑。比較逸璟．龍灣租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "逸璟．龍灣（L'Aquatique）位於青龍頭青山公路青龍頭段108號，由兩座住宅大廈組成，提供一房至四房等間隔。單位面積跨度大，小家庭與需要較多房間的住戶可在同一屋苑內按空間需求篩選。\n\n細戶型的比較重點是收納、傢俬尺寸及客飯廳實際用途；較大單位則宜留意房間分配、套房及工作空間能否配合家庭成員。座別相同也不代表座向與採光一致，宜連同窗外環境觀察。公開資料列有會所及泳池，適合把屋苑康樂空間納入生活考慮的住戶。日常外出仍要結合青龍頭周邊商店與青山公路行程，睇樓時順道試行往返站位及日常購物的路線。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/7/8/b/b6740003588d99f67968a649e9fba067.jpg",
    "seo_title": "逸璟．龍灣 L'Aquatique｜青龍頭一房至四房租售、屋苑資料",
    "seo_description": "逸璟．龍灣 L'Aquatique 位於青龍頭108號，兩座住宅提供一房至四房間隔，公開資料列有會所與泳池。比較戶型、座向與青山公路生活安排，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "deauville",
    "name_zh": "星岸",
    "district_slug": "ting-kau",
    "before_description": "星岸（Deauville）位於青山公路汀九段380號，屬油柑頭及汀九一帶的私人住宅項目。\n\n項目包括分層住宅及洋房。瀏覽放盤時，宜先分清物業類型，再比較各單位的樓層、戶外空間及景觀。",
    "before_seo_title": "星岸｜油柑頭／汀九屋苑資料、租售放盤",
    "before_seo_description": "星岸（Deauville）位於青山公路汀九段380號，屬油柑頭及汀九一帶的私人住宅項目。比較星岸租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "星岸（Deauville）位於青山公路汀九段380號，是油柑頭與汀九一帶兼有分層住宅及洋房的私人住宅項目。整體戶數較少，分層單位與洋房在居住動線、戶外空間及打理方式上各有比較重點。\n\n希望增加室內面積的家庭，可先按所需房間和客飯廳用途選擇分層單位；考慮洋房的買家，則宜親身了解各層連接及出入口。兩種物業不宜混用屋苑平均呎價，應先分清類型與附連範圍。星岸的選盤價值在於可於同一地點比較不同居住形式。睇樓除觀察窗外景觀，也可留意室內私隱、樓層及管理保養，再把沿青山公路的外出安排納入家庭日程，建立較完整的自住預算。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/56/56abcc171952c57c6cedb1b91fa48a7c415347bd3637a3159147907d3653a4f2.jpg",
    "seo_title": "星岸 Deauville｜汀九分層住宅、洋房租售及屋苑資料",
    "seo_description": "星岸 Deauville 位於青山公路汀九段380號，為小戶數私人住宅項目，兼有分層住宅與洋房。了解不同戶型、家庭動線與戶外空間，查看汀九租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "long-beach-gardens",
    "name_zh": "海濤花園",
    "district_slug": "ting-kau",
    "before_description": "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，是油柑頭及汀九一帶的私人住宅屋苑。\n\n屋苑由兩座住宅大廈組成。比較放盤時可一併核對座別、樓層、間隔及室內保養，景觀則以單位現場為準。",
    "before_seo_title": "海濤花園｜油柑頭／汀九屋苑資料、租售放盤",
    "before_seo_description": "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，是油柑頭及汀九一帶的私人住宅屋苑。即睇海濤花園放盤。晉誠地產 C-018613。",
    "description": "海濤花園（Long Beach Gardens）位於青山公路汀九段103號，由兩座住宅大廈組成，是油柑頭與汀九一帶可供家庭比較的大面積住宅。公開資料所列單位實用面積逾千呎，適合先以室內空間需求篩選。\n\n希望增加睡房、工作間或家庭活動位置的買家，可把平面圖與實際傢俬尺寸一同比對。兩座大廈的樓層、單位位置與窗外環境各異，較大或特色戶也不宜直接套用一般分層單位的比較方式。美聯屋苑資料列有會所與泳池，選盤時可連同現行開放安排了解。自住評估宜同時包括大單位的裝修及管理開支，以及沿青山公路外出的行程，讓增加面積與日常支出取得合適平衡。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/24/241e4ed6a8f6913ebc420e9a13badeced4b3b752c796980f429a35e300f40f37.jpg",
    "seo_title": "海濤花園 Long Beach Gardens｜汀九大單位租售、屋苑資料",
    "seo_description": "海濤花園 Long Beach Gardens 位於汀九段103號，兩座住宅提供逾千呎家庭空間，資料列有會所與泳池。比較座別、戶型及生活安排，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "riviera",
    "name_zh": "麗海別墅",
    "district_slug": "ting-kau",
    "before_description": "麗海別墅（Riviera）位於青山公路汀九段369號，屬油柑頭及汀九一帶的私人住宅。\n\n麗海別墅為單幢住宅。睇樓時可重點比較單位間隔、實際採光及公共部分保養，並核對車位是否包含在放盤條件內。",
    "before_seo_title": "麗海別墅｜油柑頭／汀九屋苑資料、租售放盤",
    "before_seo_description": "麗海別墅（Riviera）位於青山公路汀九段369號，屬油柑頭及汀九一帶的私人住宅。比較麗海別墅租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "麗海別墅（Riviera）位於青山公路汀九段369號，是油柑頭與汀九一帶的單幢私人住宅。雖然名稱帶有「別墅」，物業資料實為分層單位，公開資料所列實用面積均逾千呎，適合從大單位生活需要出發比較。\n\n對想增加客飯廳或房間空間的家庭，這類小戶數住宅可與區內較大型屋苑一同比較。睇樓宜按單位位置及樓層，實際觀察開窗採光、室內私隱與房間動線，避免只憑物業名稱想像居住形式。由於物業落成已有一段時間，室內裝修與公共部分保養是選盤重點。可向代理查詢大廈維修紀錄、管理開支與車位條件，再把需要的翻新工程及沿青山公路的日常行程納入整體考慮。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/a/5/2/61b9e3267ef9e369eea3236791ad2d53.jpg",
    "seo_title": "麗海別墅 Riviera｜汀九大面積分層住宅租售、屋苑資料",
    "seo_description": "麗海別墅 Riviera 位於汀九段369號，是小戶數單幢私人住宅，提供逾千呎分層空間。了解家庭間隔、室內採光及大廈保養，查看油柑頭／汀九租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "both-wealth-garden",
    "name_zh": "均富花園",
    "district_slug": "castle-peak-road",
    "before_description": "均富花園（Both Wealth Garden）位於掃管笏村第一區，是掃管笏一帶的住宅項目。\n\n晉誠現有放盤以期數標示物業。搜尋及睇樓時宜一併核對期數、座別與完整地址，以分清不同單位。",
    "before_seo_title": "均富花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "均富花園（Both Wealth Garden）位於掃管笏村第一區，是掃管笏一帶的住宅項目。即睇均富花園放盤。晉誠地產 C-018613。",
    "description": "均富花園（Both Wealth Garden）位於掃管笏村第一區，住宅分布於多個座別。相對於以大型住宅塔樓選座的方式，這裡更需要把個別樓宇、樓層與實際出入口放在一起了解，才能掌握所睇單位的生活環境。\n\n晉誠現有放盤使用期數標示，而外部屋苑資料亦按不同座別記錄物業。選盤時可先請代理把期數、座名與確實門牌對照，再看室內間隔、窗外環境及步行路線，避免把相近名稱的單位混在一起。適合願意逐戶比較村內居住條件的自住客。日常生活的實際感受，宜連同單位入口、車輛上落客及步行出村安排觀察；若放盤提及附連戶外空間或泊車，則另按該物業文件核實使用範圍。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/1/8/e/7a6e8678e0447977e58ff48c0500499d.jpg",
    "seo_title": "均富花園 Both Wealth Garden｜掃管笏村住宅租售、屋苑資料",
    "seo_description": "均富花園 Both Wealth Garden 位於掃管笏村第一區，住宅分布多個座別，可按個別入口、室內條件與村內生活路線選盤。了解期數對照並查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "fiona-garden",
    "name_zh": "富安新邨",
    "district_slug": "castle-peak-road",
    "before_description": "富安新邨（Fiona Garden）位於青泰路28號，屬小欖及大欖一帶的住宅項目。\n\n屋苑以洋房住宅為主，現有放盤亦使用「富安新村」名稱。比較單位時，宜核對獨立門牌及戶外範圍。",
    "before_seo_title": "富安新邨｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "富安新邨（Fiona Garden）位於青泰路28號，屬小欖及大欖一帶的住宅項目。比較富安新邨租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "富安新邨（Fiona Garden）位於青泰路28號，是小欖及大欖一帶以洋房組成的住宅項目。公開屋苑資料列二十二伙，與大型分層屋苑的居住形式不同，適合以整幢空間、屋號及家庭動線作初步篩選。\n\n放盤亦會使用「富安新村」名稱，睇樓前可一併對照英文名稱、青泰路地址與獨立屋號。對希望增加室內活動或房間空間的家庭，宜實際了解各層分配、採光與上下樓安排，再衡量是否適合長幼同住。各洋房的裝修及附連條件需要分別看待。如附有花園、天台或車位，可向代理索取範圍資料，並把屋頂防水、外牆及戶外打理所需支出列入預算；日常出入則可從青泰路的實際入口開始測試。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/1/8/1/fdf6b5d2e4d5eb76b684e938434a2f26.jpeg",
    "seo_title": "富安新邨 Fiona Garden｜小欖青泰路洋房租售、屋苑資料",
    "seo_description": "富安新邨 Fiona Garden 位於青泰路28號，屬小欖／大欖一帶二十二伙洋房項目。比較整幢空間、屋號與家庭分層動線，查看租售放盤及個別附連條件。晉誠地產 C-018613。"
  },
  {
    "slug": "dragon-inn-court",
    "name_zh": "容龍居",
    "district_slug": "castle-peak-road",
    "before_description": "容龍居（Dragon Inn Court）位於三聖青霞里9號，是青山灣及三聖一帶的私人住宅屋苑。\n\n屋苑由四座住宅大廈組成。選盤時可按座別、樓層與間隔比較，並實地了解單位及公共部分的保養。",
    "before_seo_title": "容龍居｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "容龍居（Dragon Inn Court）位於三聖青霞里9號，是青山灣及三聖一帶的私人住宅屋苑。比較容龍居租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "容龍居（Dragon Inn Court）位於三聖青霞里9號，由四座住宅大廈組成，是青山灣一帶可供家庭比較的中型屋苑。不同單位在房間與客飯廳空間上有取捨，可先按家庭人數及所需功能篩選，再深入看座別與樓層。\n\n希望增加室內空間的住戶，可把不同面積戶型的平面圖並排比較，了解睡房擺位與收納。睇樓則宜由屋苑入口走到所選大廈，連同窗外環境、採光及公共部分保養一起觀察，掌握四座之間的實際差異。公開屋苑資料列有兒童遊樂及網球等設施，重視家庭康樂的買家可查詢現行使用安排。個別成交或放盤會提及車位，但不能推定每戶均連車位；亦宜一併了解日常採購與往返青山公路的步行路線。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/7/5/2/17ceacec2610f8161e6b97186f470ef6.jpeg",
    "seo_title": "容龍居 Dragon Inn Court｜三聖青山灣家庭住宅租售",
    "seo_description": "容龍居 Dragon Inn Court 位於三聖青霞里9號，四座住宅提供不同家庭戶型，資料列有兒童遊樂及網球設施。比較座別、採光及個別車位條件，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "tuen-mun-court",
    "name_zh": "屯門閣",
    "district_slug": "castle-peak-road",
    "before_description": "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青榕街一帶的私人住宅大廈。\n\n屯門閣屬單幢住宅，與鄰近青榕街4號的雅翠苑為不同物業。比較放盤時宜核對大廈名稱、門牌及樓層。",
    "before_seo_title": "屯門閣｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青榕街一帶的私人住宅大廈。比較屯門閣租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "屯門閣（Tuen Mun Court）位於三聖青榕街2號，是青山灣一帶的單幢私人住宅。公開資料所列單位實用面積約一千二百多至一千四百多呎，適合以較大室內空間及單層家庭生活作選盤方向。\n\n對需要多用途房間或較完整客飯廳的家庭，可把不同戶型的房間分布、傢俬擺位與採光逐項比較。它與鄰近青榕街4號的雅翠苑屬不同物業，搜尋放盤及參考成交時，應先分清大廈名稱及門牌。屯門閣是成熟單幢物業，室內翻新程度、升降機及公共部分保養都值得實地了解。部分成交附有車位，選盤可同時查問車位位置與權益，並從大廈入口試走往青山公路的路線，衡量日常出入是否順暢。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/1/0/2/05d18e188a23b68f3eb743f154514631.jpg",
    "seo_title": "屯門閣 Tuen Mun Court｜三聖青榕街大單位租售",
    "seo_description": "屯門閣 Tuen Mun Court 位於三聖青榕街2號，為大面積單幢住宅，單位以逾千呎家庭空間為比較重點。了解戶型、公共保養與個別車位條件，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "elegant-villa",
    "name_zh": "雅翠苑",
    "district_slug": "castle-peak-road",
    "before_description": "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青榕街一帶的私人住宅。\n\n雅翠苑與青榕街2號的屯門閣為不同物業。搜尋或安排睇樓時，宜一併確認屋苑名稱及門牌。",
    "before_seo_title": "雅翠苑｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青榕街一帶的私人住宅。比較雅翠苑租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "雅翠苑（Elegant Villa）位於三聖青榕街4號，是青山灣一帶的單幢私人住宅。公開屋苑資料所列實用面積為一千三百多呎，對需要較大分層空間的家庭，可作比較客飯廳、睡房與工作位置的選擇。\n\n由於面積資料較集中，選盤可多看樓層、座向及室內裝修如何影響實際用途；即使面積相同，改裝後的房間分布及採光感受也要現場確認。它與青榕街2號的屯門閣是不同物業，成交資料宜分開參考。成熟單幢住宅的生活體驗，也取決於公共部分保養及日常出入安排。睇樓可沿入口走到單位，觀察升降機與公共空間，再向代理查詢維修紀錄、管理開支及車位條件，把面積以外的支出一起計算。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/3/7/6/cd96f59acb42cbb327d4bf070a9a9a3a.jpg",
    "seo_title": "雅翠苑 Elegant Villa｜三聖青榕街大面積住宅租售",
    "seo_description": "雅翠苑 Elegant Villa 位於三聖青榕街4號，是提供一千三百多呎空間的小戶數單幢住宅。比較家庭間隔、樓層採光與室內裝修，查看青山灣一帶租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "pearl-island-bungalow",
    "name_zh": "龍珠島平房",
    "district_slug": "castle-peak-road",
    "before_description": "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的住宅項目。\n\n現有放盤包括F1及F5座。它與青龍路11號的龍珠島花園為不同屋苑，選盤時應按名稱、門牌及座別分辨。",
    "before_seo_title": "龍珠島平房｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的住宅項目。比較龍珠島平房租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "龍珠島平房（Pearl Island Bungalow）又稱龍珠島別墅，位於青龍路9號，是龍珠島上的多座住宅項目。名稱雖有「平房」或「別墅」，公開資料所列為多層住宅樓宇，選盤應以實際座別與樓層了解居住形式。\n\n晉誠現有資料包括F1及F5座，適合先比較各座位置，再看室內間隔及窗外環境。不同樓層的入口、上落安排及採光宜實際觀察，若重視露台或戶外使用範圍，也要按所睇單位確認，不能由名稱推定。這裡與青龍路11號的龍珠島花園、7號的龍珠花園均屬不同物業。安排睇樓時，宜一併了解進出龍珠島、由落車處到所選座別及日常採購的路線，把島上住宅位置與生活便利程度一起衡量。",
    "hero_image": "https://imgs.property.hk/largePhotos/2026/a/5/e/534dfb816d73e407eaaa1878c96d485e.jpg",
    "seo_title": "龍珠島平房 Pearl Island Bungalow｜青龍路住宅租售",
    "seo_description": "龍珠島平房 Pearl Island Bungalow 又稱龍珠島別墅，位於青龍路9號，屬多座低層住宅項目。了解F座位置、樓層與島上生活路線，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "pearl-garden",
    "name_zh": "龍珠花園",
    "district_slug": "castle-peak-road",
    "before_description": "龍珠花園（Pearl Garden）位於掃管笏青龍路7號，是龍珠島一帶的私人住宅屋苑。\n\n屋苑由四座住宅大廈組成，與青龍路9號的龍珠島平房及11號的龍珠島花園均為不同物業。搜尋放盤時宜按正式名稱及門牌分辨。",
    "before_seo_title": "龍珠花園｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "龍珠花園（Pearl Garden）位於掃管笏青龍路7號，是龍珠島一帶的私人住宅屋苑。即睇龍珠花園放盤。晉誠地產 C-018613。",
    "description": "龍珠花園（Pearl Garden）位於青龍路7號，是龍珠島一帶由四座住宅組成的小型私人屋苑。公開資料所列面積涵蓋六百多至一千多呎，住戶可按家庭人數、房間需要與可用客飯廳空間選擇合適戶型。\n\n對希望在同一生活圈比較不同面積的家庭，選盤可先分清座別與間隔，再實地觀察樓層、採光及窗外環境。小型屋苑的各座位置會影響由入口到單位的路線，睇樓時不妨把這一段也走完整。龍珠花園與青龍路9號的龍珠島平房、11號的龍珠島花園是不同物業。查看放盤或參考成交時，宜同時對照正式名稱與門牌；日常生活則可由進出龍珠島、採購及上落客安排，判斷是否符合家庭習慣。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/d2/d26242b165dd439bb04e3052ff65994f07ed2652a0d570a3ec450167616c8557.webp",
    "seo_title": "龍珠花園 Pearl Garden｜龍珠島青龍路住宅租售",
    "seo_description": "龍珠花園 Pearl Garden 位於青龍路7號，四座小型住宅提供六百多至一千多呎戶型。比較家庭間隔、座別與龍珠島生活路線，查看租售放盤。晉誠地產 C-018613。"
  },
  {
    "slug": "peak-castle",
    "name_zh": "珀居",
    "district_slug": "castle-peak-road",
    "before_description": "珀居（Peak Castle）位於小欖冠發街，正式門牌包括8A至8H、8J、10、12、16、18、20及22號。\n\n項目由洋房組成。選盤時宜核對各洋房的獨立門牌，以及花園、天台、泳池及車位等範圍是否屬於放盤條件。",
    "before_seo_title": "珀居｜小欖至三聖屋苑資料、租售放盤",
    "before_seo_description": "珀居（Peak Castle）位於小欖冠發街，正式門牌包括8A至8H、8J、10、12、16、18、20及22號。比較珀居租售單位及睇樓條件。晉誠地產 C-018613。",
    "description": "珀居（Peak Castle）位於小欖冠發街，是以洋房組成的私人住宅項目，各幢使用獨立門牌。選盤可從整幢居住空間及家庭分層需要出發，把室內動線、戶外使用與車輛出入安排放在一起考慮。\n\n晉誠個別放盤以獨立泳池及車位作介紹，對重視戶外活動的買家，可作進一步了解的方向；惟這些條件須對應實際洋房，不能概括到整個項目。睇樓宜索取範圍資料，並親身觀察室內外的連接。洋房自住的長期支出亦包括整幢保養，以及個別戶外設施的清潔和維護。比較時可先確認門牌及物業範圍，再了解管理與維修責任；沿冠發街試行日常出入，亦有助判斷是否適合家人的生活習慣。",
    "hero_image": "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/62/62051f93d6f782391f0e9ba95514217b5c68afd32ba746f5e3f5a531c6824c55.webp",
    "seo_title": "珀居 Peak Castle｜小欖冠發街洋房租售、屋苑資料",
    "seo_description": "珀居 Peak Castle 位於小欖冠發街，為各幢有獨立門牌的洋房項目。比較整幢空間與個別花園、泳池及車位條件，了解家庭生活動線並查看租售放盤。晉誠地產 C-018613。"
  }
]
$editorial_content$::jsonb) AS r(
 slug text,name_zh text,district_slug text,
 before_description text,before_seo_title text,before_seo_description text,
 description text,hero_image text,seo_title text,seo_description text)
), candidates AS (
 SELECT e.slug,
  CASE WHEN NULLIF(trim(e.description),'') IS NULL OR e.description=r.before_description
    THEN r.description ELSE e.description END AS description,
  COALESCE(NULLIF(trim(e.hero_image),''),r.hero_image) AS hero_image,
  CASE WHEN NULLIF(trim(e.seo_title),'') IS NULL OR e.seo_title=r.before_seo_title
    THEN r.seo_title ELSE e.seo_title END AS seo_title,
  CASE WHEN NULLIF(trim(e.seo_description),'') IS NULL OR e.seo_description=r.before_seo_description
    THEN r.seo_description ELSE e.seo_description END AS seo_description
 FROM estates e JOIN reviewed r ON e.slug=r.slug
  AND e.name_zh=r.name_zh AND e.district_slug=r.district_slug
 WHERE e.published=true
)
UPDATE estates e SET description=c.description,hero_image=c.hero_image,
 seo_title=c.seo_title,seo_description=c.seo_description,published=true,updated_at=now()
FROM candidates c WHERE e.slug=c.slug
 AND (e.description,e.hero_image,e.seo_title,e.seo_description)
  IS DISTINCT FROM (c.description,c.hero_image,c.seo_title,c.seo_description);

COMMIT;
