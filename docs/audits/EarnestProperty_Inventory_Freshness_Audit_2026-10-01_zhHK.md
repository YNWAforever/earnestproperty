# EarnestProperty 放盤更新及下架審核

審核日期：2026-10-01（香港時間）。基準 commit：`e8997f290045fde37625be99863d803f4f72c7b5`。正式部署與此版本一致。

**結論：首頁過時有實際同步及排序原因；不能宣稱全部來源已更新。** 本次已準備有測試的程式修正，但正式資料庫、來源啟用政策及正式部署尚未更改。Property.hk 仍受來源安全檢查阻擋。來源讀取失敗不會作為下架依據。

## 1. 已確認原因

| 優先級 | 問題 | 證據及影響 |
|---|---|---|
| P0 | 每日收盤已改為手動 | `efd0c9127526407be3ed1541e3a2a664f33af4bb` 於 9 月 25 日移除 `.github/workflows/property-sync-daily.yml` 的 schedule。最新接受的 28Hse 完整快照仍是香港時間 **9 月 25 日 05:45:54**，279 個來源廣告。 |
| P0 | 公開程式庫與私人證據要求不相容 | 現時 GitHub repository 為 public；工作流程在收盤前要求證據目的地為 private。只補回 cron 仍會停在此檢查。不能刪除保護來繞過。 |
| P0 | Property.hk 三分行未真正接通 | 正式政策只見 `28hse_agent_540 / agent:540`；沒有 Property.hk 啟用政策。範例設定的三分行 URL、selectors、ID scope 仍未完成驗證。 |
| P1 | 「最新放盤」實際先按推廣級別排序 | `public-data.server.ts` 把 gold / pinned / normal 放在 `created_at` 之前。即使有較新盤，也可能被舊推廣盤壓下。 |
| P1 | 自動缺盤下架未啟用 | 正式 `absence_enabled=false`。來源狀態仍有 371 個 active、3 個 delisted；這與最後一次完整快照的 279 個廣告不是同一統計口徑，不能直接相減當作應下架數。 |
| P1 | 入庫與刊登是兩個關卡 | `publishDaily()` 每次最多嘗試刊登 20 個 draft。圖片、屋苑、身份、人工覆寫或現有內容等條件不符會保留待審，並非同步成功就全部公開。 |
| P2 | Actions 紅燈會混淆真正結果 | 已核對 run `36062151356`：收盤、套用、基線儲存及刊登步驟成功，後面的 artifact 上載因配額滿而失敗。整個 job 紅燈不能直接解讀為「沒有入庫」，亦不應因此重新寫入另一份快照。 |

## 2. 使用者提供的樣本

| 來源 ID | 來源核對 | 正式 inventory 核對 |
|---|---|---|
| [28Hse 4033913](https://www.28hse.com/buy/apartment/property-4033913) | 詳細頁 HTTP 200；黃金海灣，代理物業編號 A072390 | 查無此來源 ID 的 `property_source_links` |
| [28Hse 4034357](https://www.28hse.com/buy/apartment/property-4034357) | THE CARMEL；B059410；刊登及更新 2026-09-29；售價 $590 萬、實用 805 呎 | 查無此來源 ID；另有舊 B059410 記錄為 inactive，須經身份及狀態所有權檢查，不能直接建立重複盤或強制恢復 |
| [28Hse 4034591](https://www.28hse.com/buy/apartment/property-4034591) | 上源；A057717；刊登及更新 2026-09-29；售價 $395 萬、實用 404 呎 | 查無此來源 ID 的 `property_source_links` |
| [Property.hk 6826616](https://www.property.hk/asking_detail/6826616.html) | 自動讀取收到 HTTP 403「正在驗證您的瀏覽器」安全檢查；未能核實目前詳細資料 | 查無此來源 ID 的 `property_source_links`；不能將讀取失敗標為撤盤 |

「查無來源 ID」代表該廣告尚未建立來源連結，不等於物業本身必然完全不存在。物業身份應以已驗證的公司物業編號、買賣／租賃類型及現有映射作判定，不能只憑屋苑、價錢、姓名或模糊地址合併。

### Property.hk 分行範圍

| 分行代碼 | 使用者提供的地區參數 | 要求 |
|---|---|---|
| EPS | `dt=NTW` | 使用者連結由 `p=9` 開始；完整收盤須從第 1 頁開始，核對所有後續頁及終止頁 |
| EPT | `dt=NTM` | 獨立核實分行身份、總數、買賣／租賃範圍及分頁 |
| EPW | `dt=NTW` | 獨立核實分行身份、總數、買賣／租賃範圍及分頁 |

這三個代碼是使用者指定範圍，並非本次已成功抓取的證明。原連結包含 SID；不能假設只保留 agent/dt 便一定到達同一分行。本次簡化 EPS URL 在瀏覽器回到一般代理目錄，沒有取得可驗證的分行清單。應向來源取得支援的 feed/export 或解決正常存取，再驗證 selectors、分頁、跨分行廣告 ID 是否全域唯一。不得複製驗證 cookies、偽造成功或用失敗結果覆寫完整基線。

## 3. 首頁實際觀察

正式首頁六張卡片是 A074714、T027759、T025941、A066498、A055113、A065407，顯示約 9–16 日前更新。資料庫同時存在較新的 active 記錄，因此不是單純瀏覽器未刷新。首頁現有範圍包括青山公路及已批准屋苑；黃金海灣、THE CARMEL、上源已有屋苑設定；亦已查證正式 ingestion policy 的「黃金海灣 黃金海灣珀岸」、「THE CARMEL 大廈」及「上源」映射均存在。本次沒有擴大地區範圍，亦沒有把所有重複來源列成獨立物業。

## 4. 已準備的程式修正

分支：`fix/listing-freshness-20261001`；[修正草稿 PR #207](https://github.com/YNWAforever/earnestproperty/pull/207)。

1. **首頁明確要求 `order: "newest"`。** 以已接受、active 且具有已確認來源連結的 `mls_source_state.first_seen_at` 排序，沒有來源狀態時回退 `properties.created_at`，最後以 ID 固定次序。排序及物業去重在 SQL 的 LIMIT 之前完成。重新抓取不會更新 first-seen，因此不會把所有舊盤每日推上頂。其他需要推廣排序的呼叫保留原模式。
2. **只恢復物業收盤排程。** 香港時間每日 04:17，仍受啟用旗標、指定分支、parser、資料庫目標及不可變 request/receipt 保護。GitHub 排程可能延遲，不承諾準時至分鐘。不恢復 WhatsApp、CRM 或影片輪詢。
3. **支援獨立私人證據庫。** `PROPERTY_SYNC_EVIDENCE_REPO` / `PROPERTY_SYNC_EVIDENCE_TOKEN` 指向私人 release；目的地仍必須通過 private 檢查。沒有設定時，只有私人 code repository 才能沿用舊預設。
4. **修正 artifact 配額造成的誤報。** 原始及精簡證據存入私人 release；publication 結果亦納入精簡包。Actions artifacts 只在私人 code repository 提供可選副本，配額失敗不會把已完成同步偽裝成失敗。私人 release 儲存失敗仍屬真正失敗。

排序的精確定義是「本系統首次接受的現行來源廣告」，**不是來源網站原始刊登日期**。本次沒有新增來源刊登日期欄位；大量回補同一時間接受的廣告，會按建立時間及 ID 作穩定排序。如業務要求與來源刊登日期逐項一致，需另加有格式驗證及時區定義的 `source_published_at`，不能把爬取時間冒充刊登時間。

## 5. 「設為下架」的安全規則

不刪除物業。通過核對後使用現有 inactive 狀態，保留來源記錄、操作原因及恢復能力。舊站匯入盤未必有現行來源映射；不能只因沒有來源連結就直接下架。

| 情況 | 應採取的動作 |
|---|---|
| 完整、同一公司及範圍的成功快照，並有已接受的上一個完整基線 | 才能考慮來源缺盤；仍須檢查人工狀態覆寫及狀態所有權 |
| 403、驗證頁、逾時、空白頁、缺少分頁、詳情解析失敗、異常跌幅 | 標為同步受阻；保留原狀態及上一個完整基線 |
| 員工手動下架／鎖定／修訂狀態 | 保留人工決定，建立待審原因，不由爬蟲覆蓋 |
| 同一物業有多個有效來源廣告 | 按現有身份及來源選擇規則核對；不能只因其中一個 URL 消失就整個刪盤 |
| 歷史舊盤早已不在最近一次基線 | 另做歷史對帳清單，不可期待開啟 `absence_enabled` 自動清掉全部 |

現有程式以 28Hse 作主要來源，其明確／已核准的缺盤狀態可壓過 Property.hk 次要來源。這與「任何一個來源仍有效便保留」是不同業務規則；本次未擅改。三分行接通後，需把跨來源撤盤、重新出現、同盤多廣告、人工撤盤四組個案列為正式驗收。

## 6. 上線及補數次序

1. 合併前配置私人證據 repository、受限 token 及 `property-sync-evidence` release；搬入最新 accepted baseline 的原始 request/receipt，核對 hash。不能因新證據庫是空的就重新 bootstrap 正式庫。
2. 先 shadow 完整收集 agent:540 的 sale/rent 全部分頁，核對公司牌照、總數、三個 28Hse 來源樣本及拒絕記錄。若不完整則停止套用，先修復具體解析／網絡問題。
3. 以同一份凍結 request 套用現有 ingestion，保留 receipt；逐一檢查新增、更新、身份衝突、舊盤重新出現及人工覆寫。不得用寬泛 UPDATE 強制全部 active。
4. 檢查 `publication.json`，把 ready / alreadyPublic / held 分開。每批不超過現有 20 個刊登嘗試；對每日上限、圖片、既有內容及身份衝突等 held 原因逐項處理。缺圖或身份不明的盤不應偽裝成刊登成功。
5. 部署首頁修正，按最新已接受的 active 來源對照首頁六張卡片，檢查詳情頁、售價／租金、圖片、重複盤、手提電話版及失效盤隱藏。
6. 先輸出歷史下架候選及受保護清單，逐項附來源／公司物業編號、之前狀態、最後見到時間、完整快照 receipt 及原因；審核後分批套用，記錄 before/after，不做 DELETE。
7. 在 provider 正常支援的存取方式下完成 EPS/EPT/EPW 三分行 adapter、ID scope 及 policy 驗證；每分行獨立基線，逐分行 shadow → apply → publication，不把三分行任一失敗當作全站缺盤。
8. 恢復 daily flag 後核對下一次 scheduled run 的 accepted receipt 及 publication，而非只看 workflow 綠燈。監察最後成功時間、抓取／解析／拒絕數、待審量、刊登量、下架量；超過 30 小時無成功完整快照應通知管理員。

私人 release 的資產不會自動按 Actions 的 7／90 日設定刪除。需另設保留政策，永遠保留目前 accepted baseline 及未解決 request/receipt；本次未刪除任何舊資產。

## 7. 驗證及尚未完成的項目

- 75 個 Node 聚焦測試通過：最新排序、推廣模式、去重、withdrawal 抑制、地區範圍、同步完整性、身份及刊登規則。
- 65 個 Python 測試通過：收盤 worker 及 evidence archive，包括 publication 結果保存。
- TypeScript `tsc --noEmit` 通過。
- 首個修正 commit `add90e2` 的 Vercel preview 部署為 READY；瀏覽器實測被導向 Vercel 登入頁，未繞過保護，因此不宣稱已完成 preview UI 驗收。
- 新增回歸測試先在修改前失敗，再於修正後通過；使用 PGlite 執行實際首頁查詢，並非只比對 SQL 字串。
- 沒有聲稱完成正式部署、所有盤補數、Property.hk 三分行同步、批量下架或端到端正式刊登。
- 正式環境仍需私人證據目的地及可用來源存取。來源數量與正式公開物業數量須分開驗收。

完整重新收集的結果及差異會記錄於本報告補充節；只有通過完整性驗證的快照可用於補數／缺盤判斷。

## 8. 可追溯位置

- [正式網站](https://earnestproperty.vercel.app/)
- [基準程式碼](https://github.com/YNWAforever/earnestproperty/tree/e8997f290045fde37625be99863d803f4f72c7b5)
- [移除排程的 commit](https://github.com/YNWAforever/earnestproperty/commit/efd0c9127526407be3ed1541e3a2a664f33af4bb)
- [已核對的 Actions run](https://github.com/YNWAforever/earnestproperty/actions/runs/36062151356)
- 首頁：`src/lib/queries.ts`、`src/lib/neon/public-data.server.ts`、`src/lib/neon/public-listing-query.js`
- 同步：`.github/workflows/property-sync-daily.yml`、`scripts/property-sync/scraping/worker.py`、`src/lib/mls/source-snapshot-gates.mjs`、`src/lib/mls/ingestion-repository.mjs`
- 刊登：`src/lib/mls/daily-publication.mjs`
- 啟用程序：`scripts/property-sync/README.md`
