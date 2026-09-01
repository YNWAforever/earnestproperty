# Earnest Property：17 個屋苑詳情頁 Claude 實作主規格

**版本：** 1.0  
**日期：** 2026-09-01  
**參考頁：** [https://earnestproperty.vercel.app/estate/sea-crest-villa](https://earnestproperty.vercel.app/estate/sea-crest-villa)  
**目標 repo：** [https://github.com/YNWAforever/earnestproperty](https://github.com/YNWAforever/earnestproperty)  
**預設狀態：** 私人預覽；17 頁全部 `published=false`、`verified_at=NULL`

## 1. 任務

沿用現有 `/estate/sea-crest-villa` 的資訊架構、視覺層級、真盤、成交、估價與 WhatsApp 轉換流程，加入 17 個屋苑詳情頁。用戶文字中的「上源 The Carmel」按 17 個總數解讀為兩個獨立屋苑：**上源**與 **The Carmel**。

不要建立 17 個 route。現有 `src/routes/estate.$slug.tsx` 已是動態 route，應以同一份資料模型承載全部屋苑。

每頁須有：動態地區 hero、Answer Summary、有來源和日期的 facts、市場快照、介紹、客群、優點、注意事項、交通、校網、鄰近比較、相關代理／影片／文章、最新真盤、買／租／估價 CTA、業主估價及 FAQ structured data。

## 2. Canonical identity

| # | 中文名 | 英文名 | Canonical slug | 顯示地區 | DB district_slug | 校網 | Parent |
|---:|---|---|---|---|---|---:|---|
| 1 | 海雲軒 | Anglers' Bay | `hoi-wan-hin` | 深井／青龍頭 | `sham-tseng` | 62 | — |
| 2 | 帝華軒 | Royal Sea Crest | `tai-wah-hin` | 青龍頭／深井 | `tsing-lung-tau` | 62 | `sea-crest-villa` |
| 3 | 海韻臺 | Rhine Terrace | `hoi-wan-toi` | 深井 | `sham-tseng` | 62 | — |
| 4 | 縉皇居 | Ocean Pointe | `chun-wong-kui` | 深井 | `sham-tseng` | 62 | — |
| 5 | 龍騰閣 | Lung Tang Court | `lung-tang-kok` | 青龍頭 | `tsing-lung-tau` | 62 | — |
| 6 | 滿名山 | The Bloomsway | `mun-ming-shan` | 掃管笏 | `castle-peak-road` | 71 | — |
| 7 | 香港黃金海岸 | Hong Kong Gold Coast | `wong-gam-hoi-ngon` | 青山灣／掃管笏 | `castle-peak-road` | 71 | — |
| 8 | 愛琴海岸 | Aegean Coast | `oi-kam-hoi-ngon` | 掃管笏 | `castle-peak-road` | 71 | — |
| 9 | 帝御 | The Royale | `tai-yu` | 青山灣／掃管笏 | `castle-peak-road` | 71 | — |
| 10 | 黃金海灣 | Gold Coast Bay | `wong-gam-hoi-waan` | 青山灣 | `castle-peak-road` | 71 | — |
| 11 | 星堤 | Avignon | `sing-tai` | 掃管笏 | `castle-peak-road` | 71 | — |
| 12 | 上源 | Le Pont | `seong-yuen` | 掃管笏 | `castle-peak-road` | 71 | — |
| 13 | The Carmel | The Carmel | `the-carmel` | 大欖／掃管笏 | `castle-peak-road` | 71 | — |
| 14 | OMA OMA | OMA OMA | `oma-oma` | 掃管笏 | `castle-peak-road` | 71 | — |
| 15 | 漣山 | The Hillgrove | `lin-shan` | 小欖 | `castle-peak-road` | 71 | — |
| 16 | 浪濤灣 | Aqua Blue | `long-tou-waan` | 小欖 | `castle-peak-road` | 71 | — |
| 17 | 帝濤灣 | Palatial Coast | `tai-tou-waan` | 小欖／大欖 | `castle-peak-road` | 71 | — |

名稱規則：

- `hoi-wan-toi` 正式顯示 **海韻臺**，保留「海韻台」alias。
- `wong-gam-hoi-ngon` 正式顯示 **香港黃金海岸**，保留「黃金海岸」alias。
- `tai-yu` 英文為 **The Royale**，並收錄金灣、星濤、嵐天三期中英文 alias。
- `the-carmel` 和 `oma-oma` 沒有另行杜撰中文名。
- `tai-wah-hin` 為浪翠園第 5 期，但按需求保留獨立 slug，並加入 `parentEstateSlug: "sea-crest-villa"`。

## 3. 不可違反的原則

- 保留以上現有 provisional slugs；不要為「更漂亮」而改 URL。
- 不寫死平均呎價、成交量、放盤數、租金或售價；全部由 Neon／MLS 動態取得。
- NULL／樣本不足時顯示「暫未有足夠資料」，不可輸出 `$0`、`0 伙`、`NaN` 或虛假平均值。
- 不 hotlink 第三方地產網站圖片。未有合法高解像度圖片時保持 `photo=null`。
- 學校網只由教育局 2026 資料／GeoInfo Map 確認；不要從地產平台抄入具名學校清單。
- 所有 17 個屋苑保持 unpublished/unverified，逐個通過發布 gate 才公開。
- 不替換或簡化 Neon、CMS revision、MLS、auth、CRM、analytics、WhatsApp intent 或現有 public behavior。
- 所有 facts、來源、資料日期及 caveat 在 UI 可追溯。

## 4. Repo 現況與應採架構

Claude 開始前先重讀 `main`。本規格基於以下現況：

- `src/content/estate-registry.ts` 已有 17 個 placeholder；更新原 entry，不要新增重複 slug。
- `neon/migrations/20260830130000_estate_expansion.sql` 已建立未發布、無 facts 的 rows。
- `src/routes/estate.$slug.tsx` 是單一動態頁。
- `estate-pages.ts` 和 `seo.ts` 目前只覆蓋原核心屋苑。
- `school-nets.ts` 目前只有 62 網資料結構。
- `normalize-old-site.mjs` 目前只識別原核心屋苑。
- sitemap 目前由 `estateSeo` 列舉；擴充後不可把未發布頁送入 sitemap。

## 5. 檔案級實作

### `src/content/estate-registry.ts`

更新 17 個現有 entry：`nameEn`、aliases、district、corridor membership、parent relationship、school net、location label、district href 和 hero eyebrow。`hasPage=true` 只表示內容／route 已準備，不等於公開；公開狀態仍由 Neon `published` 控制。圖片未到前保持 null。

### `src/content/estate-pages.ts`

把 `estate-expansion-17.patch.ts` 每個 record 的 `content` 合併進既有 `estatePageContent`，繼續由 registry identity helper 取得 slug/name，不要再建立一套名稱映射。每頁必須有 2 段 overview、3 個 buyer fit、3 pros、3 watchouts、transport、market note、3 CTA、2 FAQ、3 related links。

### `src/content/seo.ts`

加入 17 個 SEO records，identity 仍由 registry 派生。未發布頁輸出 `noindex,follow` 且不進 sitemap；發布後才使用 canonical `/estate/{slug}`。只有合法圖片存在時才使用 estate-specific OG image。

### `src/routes/estate.$slug.tsx`

把目前硬編碼的深井假設改成 data-driven：

- hero eyebrow
- CTA districtName
- breadcrumb 第二層 label/href
- school net 62/71
- transport fallback
- completion label 與 building composition
- structured data 的 area/name/URL

不要以 `district_slug === "sham-tseng"` 決定是否顯示校網。找不到 corridor segment 時可使用已審閱的 `transportLifestyle`。`EstateMarketSnapshot` 必須保留 null semantics。

### `src/content/school-nets.ts`

改成 `schoolNets` map + `getSchoolNet(code)`，加入 71 網。62 和 71 的 `primarySchools` 先保持空陣列，除非同一年度教育局名冊已逐校輸入。UI 顯示 admission year、verified date 和 caveat。

### `src/lib/mls/normalize-old-site.mjs`

加入全部 aliases，並遵守以下優先序：

```json
[
  {
    "slug": "tai-wah-hin",
    "patterns": [
      "帝華軒",
      "浪翠園5期",
      "浪翠園五期",
      "ROYAL SEA CREST",
      "SEA CREST VILLA PHASE 5"
    ],
    "mustPrecede": [
      "sea-crest-villa"
    ],
    "reason": "避免被泛稱浪翠園先行吞併。"
  },
  {
    "slug": "hoi-wan-toi",
    "patterns": [
      "海韻臺",
      "海韻台",
      "RHINE TERRACE"
    ],
    "mustPrecede": [
      "rhine-garden"
    ],
    "reason": "避免與海韻花園 RHINE GARDEN 混淆。"
  },
  {
    "slug": "wong-gam-hoi-waan",
    "patterns": [
      "黃金海灣",
      "GOLD COAST BAY",
      "意嵐",
      "THE UPPLAND",
      "珀岸",
      "THE RESERVE"
    ],
    "mustPrecede": [
      "wong-gam-hoi-ngon"
    ],
    "reason": "避免與香港黃金海岸混淆。"
  },
  {
    "slug": "tai-yu",
    "patterns": [
      "帝御金灣",
      "帝御‧金灣",
      "SEACOAST ROYALE",
      "帝御星濤",
      "帝御‧星濤",
      "STARFRONT ROYALE",
      "帝御嵐天",
      "帝御‧嵐天",
      "SKYPOINT ROYALE",
      "帝御",
      "THE ROYALE"
    ],
    "mustPrecede": [],
    "reason": "保留三期 alias 並歸入帝御。"
  },
  {
    "slug": "tai-tou-waan",
    "patterns": [
      "帝濤灣",
      "帝濤灣浪琴軒",
      "帝濤灣海琴軒",
      "GRAND PACIFIC VIEW",
      "GRAND PACIFIC HEIGHTS",
      "PALATIAL COAST"
    ],
    "mustPrecede": [],
    "reason": "兩期常以不同中英文名稱出現。"
  }
]
```

必測案例：

- `浪翠園5期 帝華軒` → `tai-wah-hin`
- `浪翠園 第3期` → `sea-crest-villa`
- `海韻台`／`海韻臺`／`RHINE TERRACE` → `hoi-wan-toi`
- `海韻花園`／`RHINE GARDEN` → `rhine-garden`
- `黃金海灣 意嵐` → `wong-gam-hoi-waan`
- `香港黃金海岸` → `wong-gam-hoi-ngon`
- `帝御‧嵐天` → `tai-yu`
- `帝濤灣 浪琴軒` → `tai-tou-waan`

同步修正 `inferDistrictSlug`；海雲軒和縉皇居不可因舊規則誤歸 `tsuen-wan`。

### Neon migration

以附帶的 `20260901090000_estate_page_content_17.sql` 為起點。它只更新 draft/unverified rows，永不 seed `avg_saleable_psf`，也不直接插 FAQ。FAQ 和內容發布須走 CMS revision workflow。套 migration 前執行 drift check。

### Sitemap、搜尋及入口

公開 sitemap、首頁、地區頁、autocomplete 和公開搜尋只顯示已發布屋苑。Admin/CMS selector 可先看 17 個 drafts。建議先在 `/castle-peak-road` 增設分區屋苑目錄，不要一次把首頁塞入 17 張新卡。

## 6. 人工核實／發布阻擋

| 屋苑 | Slug | 屋苑特定 blocker |
|---|---|---|
| 海雲軒 | `hoi-wan-hin` | 總伙數需由屋苑文件確認（公開來源互相矛盾）<br>地址應正式標示深井段或青龍頭段需確認 |
| 帝華軒 | `tai-wah-hin` | 1,056–1,086 呎是否涵蓋所有特殊戶型需核實<br>MLS 必須先匹配期數再匹配泛稱浪翠園 |
| 海韻臺 | `hoi-wan-toi` | 正式顯示採「海韻臺」，但必須保留「海韻台」alias<br>公開平台曾出現 212、243、248 伙差異，需再覆核 |
| 縉皇居 | `chun-wong-kui` | 558／560 伙差異需以屋苑文件確認<br>現有 registry 的 ting-kau district 應改為 sham-tseng |
| 龍騰閣 | `lung-tang-kok` | 發展商保持 NULL，待屋苑文件確認 |
| 滿名山 | `mun-ming-shan` | 1,100／1,101 伙需以正式屋苑文件確認 |
| 香港黃金海岸 | `wong-gam-hoi-ngon` | 2,052／2,168 伙統計口徑需以正式文件確認<br>必須與黃金海灣 Gold Coast Bay 完全分離 |
| 愛琴海岸 | `oi-kam-hoi-ngon` | 正式發展商中文排列及地址字式需由屋苑文件確認 |
| 帝御 | `tai-yu` | 最小面積 184／185 呎差異需核實<br>搜尋及市場數據必須保留三期標籤 |
| 黃金海灣 | `wong-gam-hoi-waan` | 兩期入伙／關鍵日期須按最新售樓說明書及成交資料核實<br>不可與香港黃金海岸共用 alias 或 estate_id |
| 星堤 | `sing-tai` | 最大實用面積有約 2,766／4,054／4,484 呎差異，DB area_max 保持 NULL<br>分層與洋房不可混合計算平均呎價 |
| 上源 | `seong-yuen` | 座數有 5 座大廈／10 個 A-B 子座兩種口徑，DB blocks 保持 NULL |
| The Carmel | `the-carmel` | 項目未有獨立中文屋苑名，nameZh 與 nameEn 均保留官方英文 |
| OMA OMA | `oma-oma` | 不同平台把入伙月份寫作 2021 年 2 月或 3 月，頁面只顯示年份 |
| 漣山 | `lin-shan` | 發展商中文名稱及公司關係需由屋苑文件最終確認 |
| 浪濤灣 | `long-tou-waan` | 部分平台欄位顯示 259 伙，但主流正文為 242 伙，需最終確認<br>分層與洋房必須分開 |
| 帝濤灣 | `tai-tou-waan` | 最大實用面積有 2,841／3,421 呎差異，DB area_max 保持 NULL<br>兩期中文／英文名稱配對需由晉誠確認 |

## 7. 圖片規格

最終路徑：`public/estates/{slug}.jpg`。真實屋苑外觀、已確認使用權、建議至少 1,600px 寬、landscape、無第三方 watermark／電話／價格，經 sharp 壓縮；alt 為「中文名 英文名 地區屋苑外觀」。圖片未到前不要提交不存在的 path。

## 8. 發布 gate

每個屋苑逐個通過：

1. 名稱、alias、地址、district 已核實。
2. 發展商、年份、期數／座數、伙數、面積衝突已解決。
3. 校網由教育局／GeoInfo Map 確認。
4. 合法 hero image 已到位。
5. SEO、正文、CTA、FAQ、related links 已審批。
6. MLS alias collision tests 通過。
7. route 200，沒有 0／NaN／空 structured data。
8. mobile、keyboard、contrast、accordion、WhatsApp CTA 通過。
9. CMS revision 有 draft → approved/published 紀錄。
10. 寫入 `verified_at`。
11. 最後才把單一 row `published=true`。
12. sitemap 只在發布後出現 URL。

## 9. 測試

先新增 contract tests，再改 production code。至少覆蓋：identity parity、17 slug 唯一、每頁文案完整、related links 有效、62/71 校網、alias collision、動態 breadcrumb/CTA/eyebrow、unpublished isolation、NULL market metrics、canonical、FAQ JSON-LD。

```bash
bun run test:estate-conversion
bun run test:seo
bun run test:corridor
bun run test:listing-search
bun run typecheck
bun run build
```

有 Playwright 環境再跑：

```bash
bun run test:a11y
```

## 10. 完成回報

列出修改檔案、migration 名稱與是否套用、17 個 final identity、已解決／未解決 facts、圖片權利狀態、測試結果，以及明確確認沒有部署、沒有自動公開 17 頁。

## 11. 來源

共同校網來源：

- [香港教育局：POA School Net](https://www.edb.gov.hk/en/edu-system/primary-secondary/spa-systems/primary-1-admission/school-lists/index.html) — 以 2026 年度資料、GeoInfo Map 及個別地址作最終確認。

### 1. 海雲軒 / Anglers' Bay

- [中原地產：Anglers' Bay](https://hk.centanet.com/estate/en/Anglers-Bay/2-KEPPWPPRPB) — 2 座、469–1,427 呎、總伙數爭議
- [中原放盤頁：海雲軒](https://hk.centanet.com/findproperty/en/detail/ANGLERS%27-BAY%E3%83%BBTower-2_CDB960?theme=rent) — 地址、發展商、62 校網及 247 伙紀錄
### 2. 帝華軒 / Royal Sea Crest

- [中原地產：Sea Crest Villa Phase 5](https://hk.centanet.com/estate/en/Sea-Crest-Villa-Phase-5-Royal-Sea-Crest/2-QSVRFRCXRR) — 地址、發展商、座數、單位數及主要戶型
- [28Hse：帝華軒](https://www.28hse.com/estate/detail/%E5%B8%9D%E8%8F%AF%E8%BB%92-4527) — 1997 年、2 座、168 伙及別名
### 3. 海韻臺 / Rhine Terrace

- [中原地產：Rhine Terrace](https://hk.centanet.com/estate/en/Rhine-Terrace/2-AKBDGPSXPP) — 地址、年份、座數、212 伙、面積及校網
- [28Hse：海韻臺](https://www.28hse.com/estate/detail/rhine-terrace-4548) — 中文名稱、發展商及資料差異
### 4. 縉皇居 / Ocean Pointe

- [中原地產：Ocean Pointe](https://hk.centanet.com/estate/en/Ocean-Pointe/2-AAPPWPPJPB) — 地址、3 座、558 伙、653–1,609 呎
- [中原放盤頁：Ocean Pointe](https://hk.centanet.com/findproperty/en/detail/Ocean-Pointe-Tower-1_CCP474?costctrno=BLG&theme=buy) — 地址、嘉里及屋苑位置
### 5. 龍騰閣 / Lung Tang Court

- [中原地產：Lung Tang Court](https://hk.centanet.com/estate/en/Lung-Tang-Court/2-QSVVQRFYRR) — 地址、1981 年、1 座、48 伙、1,743–1,958 呎及 62 校網
- [中原成交頁：Lung Tang Court](https://hk.centanet.com/findproperty/en/transaction-detail/Lung-Tang-Court-_HKG202503R1757) — 地址及實用面積紀錄
### 6. 滿名山 / The Bloomsway

- [House730：The Bloomsway](https://www.house730.com/en-us/estate-23796/Castle-Peak-Road-The-Bloomsway/) — 地址、嘉里、2017 年、組成、伙數、面積及 71 校網
### 7. 香港黃金海岸 / Hong Kong Gold Coast

- [28Hse：Hong Kong Gold Coast](https://www.28hse.com/en/estate/detail/hong-kong-gold-coast-4501) — 地址、信和、5 期、30 座、2,168 伙、面積及校網
- [美聯物業：Hong Kong Gold Coast](https://www.midland.com.hk/en/estate/-Hong-Kong-Gold-Coast-E00089) — 期數、座數、伙數及屋苑資料
### 8. 愛琴海岸 / Aegean Coast

- [中原地產：Aegean Coast](https://hk.centanet.com/estate/en/Aegean-Coast/2-KEPPWPPJPG) — 7 座、1,624 伙及面積
- [28Hse：Aegean Coast](https://www.28hse.com/en/estate/detail/aegean-coast-4500) — 地址、發展商、2002 年、面積及 71 校網
### 9. 帝御 / The Royale

- [28Hse：The Royale](https://www.28hse.com/en/estate/detail/the-royale-28649) — 地址、發展商、3 期、6 座、1,782 伙及面積
- [28Hse：Starfront Royale](https://www.28hse.com/en/new-properties/starfront-royale) — 第 2 期名稱及產品資料
### 10. 黃金海灣 / Gold Coast Bay

- [利嘉閣：Gold Coast Bay](https://www.ricacorp.com/en-hk/property/estate/gold-coast-bay-bigest-so-kwun-wat-hma-en) — 地址、發展商、2 期、6 座、1,323 伙及校網
- [黃金海灣官方網站：The Uppland](https://www.goldcoastbay.hk/en/the-uppland/) — 第 1 期正式名稱及地址
### 11. 星堤 / Avignon

- [中原地產：Avignon](https://hk.centanet.com/estate/en/Avignon/1-KEPPWEPSPG) — 地址、新鴻基、組成、459 伙及面積紀錄
- [House730：Avignon](https://www.house730.com/en-us/estate-23791/Castle-Peak-Road-Avignon/) — 組成、伙數及 71 校網
### 12. 上源 / Le Pont

- [28Hse：Le Pont](https://www.28hse.com/en/estate/detail/le-pont-22809) — 萬科、地址、年份、5 座及30洋房、1,154 伙及面積
- [House730：Le Pont](https://www.house730.com/en-us/estate-23799/Castle-Peak-Road-Le-Pont/) — 組成、面積及 71 校網
### 13. The Carmel / The Carmel

- [中原地產：The Carmel](https://hk.centanet.com/estate/en/The-Carmel/2-KESPWPPXPD) — 地址、2019 年、2 座及48洋房、178 伙、面積及校網
- [28Hse：The Carmel](https://www.28hse.com/en/buy/apartment/a3/dg52/di52-111/c22525) — 永泰、178 伙及產品組成
### 14. OMA OMA / OMA OMA

- [永泰地產：OMA OMA](https://www.wingtaiproperties.com/en-US/property_developments/detail/20) — 官方地址、466 伙及面積
- [中原地產：OMA OMA](https://hk.centanet.com/estate/en/Oma-Oma/2-KESPWPPHPG) — 4 座、466 伙、面積及校網
### 15. 漣山 / The Hillgrove

- [House730：The Hillgrove](https://www.house730.com/en-us/estate-23788/Castle-Peak-Road-The-Hillgrove/) — 地址、發展商、2002 年、17 座、216 伙、面積及校網
### 16. 浪濤灣 / Aqua Blue

- [中原地產：Aqua Blue](https://hk.centanet.com/estate/%E6%B5%AA%E6%BF%A4%E7%81%A3/2-KEPPWPPHPG) — 南豐、地址、2002 年、6 座及32洋房、242 伙、面積及校網
- [House730：Aqua Blue](https://www.house730.com/estate-23790/%E9%9D%92%E5%B1%B1%E5%85%AC%E8%B7%AF-%E6%B5%AA%E6%BF%A4%E7%81%A3/) — 組成、242 伙、面積及校網
### 17. 帝濤灣 / Palatial Coast

- [中原地產：Palatial Coast](https://hk.centanet.com/estate/en/Palatial-Coast/3-ZMNMIHMXHI) — 2 期、9 座、856 伙、1999 年、面積及校網
- [28Hse：Palatial Coast](https://www.28hse.com/en/estate/detail/palatial-coast-4502) — 地址及最大面積差異

## 12. 附件用途

- `estate-expansion-17.data.json`：完整 facts、文案、SEO、sources、blockers。
- `estate-expansion-17.patch.ts`：可拆分合併到 registry/pages/SEO/school-net/MLS 的資料貼片。
- `20260901090000_estate_page_content_17.sql`：安全 draft migration。
- `EarnestProperty_17_Estate_Claude_Prompt.txt`：直接貼給 Claude Code。
