# 28hse + Property.hk 雙網站爬蟲及合併技術規格

## v2.0 — 獨立爬蟲與排程版本（不使用 Hermes Agent）

**文件日期：** 2026-09-06  
**適用項目：** 晉誠地產樓盤資料同步  
**閱讀對象：** Backend、Data Engineering、DevOps、QA，以及協助開發的 Codex  
**主要來源：** 28hse `/agent/540`  
**輔助來源：** Property.hk／宅谷 EPW、EPS、EPT  
**文件性質：** 開發及驗收規格；不是已完成的程式，也不是對目前網站或 repository 的實測報告。

> **本版架構：兩個獨立 Python 爬蟲，由 cron／systemd timer 排程執行；28hse 沿用主資料同步流程，Property.hk 由自建程式提交 JSON 至接收 API。全流程不依賴 Hermes、AI Agent、LLM 推理或 Agent 平台。**

---

## 0. 文件依據與本版變更

### 0.1 文件依據

本文件整合以下兩份提供的原始規格及本次「不使用 Hermes Agent」要求：

- **來源 A：** `codex_instructions_28hse_scraper (1).md`：28hse 自家盤每日爬取、snapshot、diff、soft delete、完整性檢查。
- **來源 B：** `codex_instructions_hermes_sync_endpoint.md`：Property.hk JSON 格式、接收 API、28hse 優先合併、衝突紀錄、認證、冪等及 rate limit。

來源 B 的檔名保留在此，只為追溯舊規格；**它不代表本版有任何 Hermes 執行依賴。**

### 0.2 明確保留的原有規則

1. 28hse 為 primary source，Property.hk 為 secondary source。
2. 28hse `/agent/540` 逐頁完整爬取，不 hardcode 總頁數。
3. 同一來源以 `property_id` 識別放盤；每日比較新盤、落架及欄位變更。
4. 落架只做 soft delete，不代表已售或已租。
5. Property.hk 使用「屋苑＋座號＋樓層＋室號」配對。
6. 匹配後只補充缺失欄位；不覆寫 28hse 已有文案或數值。
7. 數值衝突保留 28hse，另一來源的值寫入 `conflict_log`。
8. 相同資料重送不得新增重複紀錄。
9. 數量比上一次成功、同範圍結果下降超過 30%，拒絕業務資料寫入。
10. API 接收端不執行 browser crawling。

### 0.3 本次要求直接改動

| 項目 | 舊安排 | 本版安排 |
|---|---|---|
| Property.hk 爬取者 | 外部 Agent | 自建 `crawl_propertyhk.py` |
| 排程 | Agent 內建排程 | cron／systemd timer／現有 job scheduler |
| 取得資料方式 | Agent 操作 browser | 確定性的 fetch、browser rendering、parser |
| JSON 提交者 | Agent | 自建 `sync_propertyhk.py` |
| 開發責任 | 主要實作接收端 | 同時實作爬蟲、payload builder、提交程式及接收端 |
| LLM／Agent 依賴 | 依外部系統 | 無；核心流程不需要 AI API key |

### 0.4 標記方式與未確認項目

以下章節把額外設計標示為 **「本版補充」** 或 **「建議實作」**，不把它們冒充為原文件已確認的現況。

目前資料**沒有提供或未在本次核實**：

- EPW／EPS／EPT 的完整 Property.hk URL、分頁 URL 及 DOM selectors。
- Property.hk listing ID 是否全站唯一，還是只在分行範圍內唯一。
- 兩個網站目前的動態載入方式、驗證頁及實際欄位完整率。
- 現有 repository 的 ORM、完整 DB schema、現行寫入服務及 route 實際內容。
- 網站抓取、資料重用及相片展示的授權範圍。

以上項目需要工程師在有權存取的環境以設定、fixture 或現有程式確認；**不可自行捏造 URL、selector、API 或已成功測試的結果。**

---

## 1. 核心原則

> **28hse 決定主資料，Property.hk 補充缺口；兩個來源的原始記錄分開保存，只在確認同一單位時建立合併關係。**

對開發而言，必須分開處理三種概念：

- **來源放盤（source record）：** 某網站的一個放盤 ID。
- **單位配對（unit matching）：** 判斷兩筆來源資料是否指向同一實體單位。
- **展示主記錄（canonical listing）：** 網站對外使用的整合記錄，保留來源及欄位出處。

同一來源的 ID 去重，不等於跨網站單位合併。合併亦不等於可以刪除另一來源記錄。

---

## 2. 開發範圍

### 2.1 Line 1：28hse 全站市場監察 — 不在本次修改範圍

原文件提及既有 `/buy` 市場監察及跨代理比較流程。本版不要求重寫、刪除或擴大該流程。

其資料範圍、snapshot 及去重結果不得混入自家 `/agent/540` 的每日落架判斷。

### 2.2 Line 2：28hse 自家盤每日同步 — 本次主要資料線

```text
/agent/540 → 全部分頁 → 詳情補取（如需要）
→ 暫存 snapshot → 完整性檢查 → 正式 snapshot
→ new / delisted / changed diff → 主資料庫
```

本線按放盤 ID 同步；不因同一公司的兩筆廣告面積相似而自行合併。

### 2.3 Line 3：Property.hk 分行資料 — 本次補充資料線

```text
EPW / EPS / EPT → 自建爬蟲 → 驗證 snapshot
→ 建立固定 JSON payload → 自建 HTTP client
→ Property.hk sync API → matching / merge / conflict log
```

### 2.4 MVP 不做

- LLM extraction、AI Agent 排程或自主瀏覽決策。
- 只靠價格、面積、相片或標題的 fuzzy auto-merge。
- 自動多代理比較介面。
- 自動繞過登入限制、CAPTCHA、封鎖或其他存取控制。
- 自動推斷「落架＝已售」或「落架＝已租」。

---

## 3. 架構與責任邊界

```text
┌───────────────────────────────────────────────────────────────┐
│ 自有 VPS／可執行 browser job 的 worker                         │
│                                                               │
│ cron / systemd timer / 現有 scheduler                          │
│       │                                                       │
│       ├── run_28hse_sync.py                                   │
│       │      ├── crawl_agent540.py                             │
│       │      ├── snapshot + completeness                      │
│       │      ├── diff_agent540.py                             │
│       │      └── 沿用既有的主資料寫入介面                       │
│       │                                                       │
│       └── run_propertyhk_sync.py                              │
│              ├── crawl_propertyhk.py                          │
│              ├── snapshot + completeness                     │
│              ├── payload builder                             │
│              └── sync_propertyhk.py ─── HTTPS POST ───────┐   │
└───────────────────────────────────────────────────────────│───┘
                                                            ▼
                              POST /api/admin/propertyhk-sync
                                  認證、驗證、去重、完整性 gate
                                  normalize、match、merge
                                  DB transaction、logs、summary
                                                            │
                                                            ▼
                          listings / listing_source_records
                          contacts / change_log / conflict_log
                          sync_runs / source_snapshots
```

### 3.1 建議採用的整合方式

**Property.hk 採用「自建 worker → API」為預設。** 這保留原文件的接收端合約，只替換資料取得與推送端。

28hse 則沿用既有主資料寫入方式。原文件未指定該方式必須是 API 或 direct DB；工程師應接現有 server-side service，不自行假設另一條 endpoint 已存在。

### 3.2 可替代的部署方式

若兩條資料線與後端位於同一受控服務，開發團隊可改為直接呼叫共用 ingestion service；這是替代方案，不是另一套合併邏輯。

不論 transport 是 HTTP 還是內部呼叫，validation、completeness、idempotency、source priority 與 transaction 規則必須一致。

### 3.3 各 component 責任

| Component | 必須負責 | 不應負責 |
|---|---|---|
| Crawler | URL traversal、render／fetch、parse、來源證據、retry | 決定跨站 canonical 合併 |
| Snapshot builder | 去重後的資料集、run metadata、完整性證據 | 更新網站 active／delisted |
| Diff service | 按 ID 比較兩次成功資料 | 以價格相近判斷同盤 |
| Sync client | 提交固定 payload、安全認證、受控重試 | 每次 retry 改寫 `scraped_at` |
| Ingestion API | 驗證、去重、配對、合併、transaction | 啟動 crawler 或 browser |
| Repository layer | 原子寫入、唯一索引、history、source link | 隱藏衝突或靜默覆寫 |
| Scheduler | 執行次序、lock、exit code、通知 | 把 failed run 標示為成功 |

---

## 4. 技術選擇與依賴

### 4.1 延用原有方向

- Python 3.11+。
- 原規格的 `crawl4ai` 作 browser-based crawling 工具。
- `pandas` 可用於 CSV snapshot／diff。
- cron／systemd timer 或公司現有 scheduler。
- 按現有 repository 的語言、ORM、migration 與 route conventions 接入。

### 4.2 不需要的依賴

- Hermes 或其他 Agent runtime。
- OpenAI、Claude 或其他 LLM API key。
- 以 LLM 判斷是否同一單位的服務。
- 為完成本需求額外引入的 vector DB、Agent memory 或 multi-agent framework。

### 4.3 Parser 原則

沿用原文件的無 API key 抽取方向：可取得 rendered HTML／Markdown，再用確定性 selector、欄位標籤或 parser 處理。

**Markdown 不是正確性的保證。** 原始 ID、連結、電話或單位欄位若在 Markdown 中缺失，應從授權可見的 HTML／詳情頁取得；不得叫 LLM 猜出欄位。

工程師應鎖定並記錄實際測試的 dependency 版本。不在本文件聲稱某個未驗證版本的 API 必定適用。

---

## 5. 來源設定

### 5.1 28hse 已提供的 URL

```text
https://www.28hse.com/agent/540?page=N
```

### 5.2 Property.hk 必須配置的資料

EPW、EPS、EPT 為原規格要求的分行代碼，但完整 URL 未提供。應由部署設定載入，不在 parser 中猜 URL。

**建議設定檔：`config/sources.json`**

```json
{
  "timezone": "Asia/Hong_Kong",
  "sources": {
    "28hse": {
      "scope_id": "agent:540",
      "list_url_template": "https://www.28hse.com/agent/540?page={page}",
      "request_delay_seconds": [2, 3],
      "page_retry_limit": 3,
      "max_drop_ratio": 0.30
    },
    "propertyhk": {
      "scope_id": "branches:EPW,EPS,EPT",
      "branch_urls": {
        "EPW": null,
        "EPS": null,
        "EPT": null
      },
      "request_delay_seconds": [2, 3],
      "page_retry_limit": 3,
      "max_drop_ratio": 0.30,
      "absence_detection_enabled": false
    }
  }
}
```

說明：

- Property.hk 的 delay／retry 數值是**本版建議起始設定**，不是已驗證的網站限制。
- `null` 是未配置狀態；runner 必須 fail fast，不能把未爬的分行當作零個盤。
- `absence_detection_enabled=false` 是本版對原文件未定義的宅谷缺席處理所採用的 MVP 保守預設，詳見第 19 節。
- scope 改變後，不可直接使用舊 scope 的 count baseline。

---

## 6. 共用爬取流程

每個來源必須有自己的 adapter，不能用同一組 selectors 硬套兩個網站。

```text
1. 載入來源設定與 run_id。
2. 取得 scope lock，避免同一資料範圍同時執行兩次。
3. 讀取列表頁，識別有效 listing IDs 與 detail URLs。
4. 逐頁前進；以 ID 去重，不以卡片位置去重。
5. 若列表缺必需欄位，進入對應 detail page。
6. 保存 raw data、normalized candidates、錯誤及頁面結果。
7. 完成所有指定分行／頁面。
8. 執行 validation 與 completeness gate。
9. 合格才產生可供同步的 immutable payload。
10. 同步成功才更新 last successful applied baseline。
```

### 6.1 空頁與失敗頁必須分開

**本版補充：** `沒有抽到 listing` 不足以判斷正常完結。

| 結果 | 處理 |
|---|---|
| 已識別的正常空列表／明確無資料提示 | 可作 pagination 終點 |
| HTTP 403／429、驗證頁、CAPTCHA | 標記 blocked／rate_limited，停止或按允許方式重試 |
| timeout／network failure | 有上限重試；仍失敗則 incomplete |
| HTTP 200 但 DOM 結構不符 parser | parser_error，不當作空頁 |
| 分頁重複返回同一批 ID／形成循環 | pagination_error，不能假稱全量完成 |
| 未配置分行 URL | configuration_error；不進入業務寫入 |

可以設定防失控的最大頁數／執行時長。但達到安全上限時必須標示 incomplete，**不是**成功抓完；這與 hardcode 正常總頁數不同。

### 6.2 抓取授權

部署前確認允許抓取及資料重用的範圍；只存取已獲授權的頁面。遇到存取限制，不提供或啟用繞過驗證與封鎖的設計。

本文件未查核兩個網站的現行條款，亦不代表取得任何抓取或相片轉載授權。

---

## 7. Line 2 — 28hse 爬蟲規格

### 7.1 基本 traversal

- 由 `page=1` 開始。
- 按 `?page=N` 前進。
- 遇到已確認的正常空列表或「沒有找到任何資料」才停止。
- 任一必需頁面最終失敗，本次 snapshot 不可用來推斷落架。
- 每筆必須取得 `property_id`。
- 保留 title 的公司前綴原文。

### 7.2 欄位

| 類別 | 欄位 |
|---|---|
| 識別 | `property_id`、`source_url`、`source_site=28hse` |
| 原文 | `title`、`raw_payload`、可取得的 `description` |
| 地址 | `district`、`estate`、`block`、`floor`、`unit` |
| 面積 | `gross_area`、`saleable_area` |
| 價格 | `price`、`gross_unit_price`、`saleable_unit_price` |
| 物業 | `bedrooms`、`bathrooms`、`orientation`、`estate_type`、`developer`、`tags` |
| 聯絡人 | `agent_name`、`agent_license` |
| 時間 | `snapshot_date`、`scraped_at` |

**本版補充欄位：** `deal_type`、`rent`、`agent_phone`、`run_id`、`scope_id`。只保存來源實際可取得的值；缺值為 `null`，不虛構。

### 7.3 ID 清洗

例如 `#3947483` 可清洗成 `3947483`，但保留 `raw_property_id`。清洗規則要有 fixture；不可變更到兩個不同來源 ID 被壓成同一個。

同一來源同一 ID 重複出現在置頂及普通列表，只計作一筆 source listing，保留多次出現的位置作診斷資料即可。

---

## 8. Line 3 — Property.hk 自建爬蟲規格

### 8.1 新增 `crawl_propertyhk.py`

程式必須：

1. 讀取 EPW／EPS／EPT 的設定 URL。
2. 按各分行實際確認的分頁方式遍歷。
3. 抽取來源 ID 與詳情 URL。
4. 必要時抓取詳情頁。
5. 依第 9 節輸出來源欄位。
6. 分別記錄每個分行的頁數、完成狀態、listing IDs、錯誤及筆數。
7. 產出 source snapshot，不直接改寫 canonical listing。

**責任已改變：這個爬蟲及其 parser／tests 必須由本次開發團隊交付，不再視為外部 Agent 已提供的能力。**

### 8.2 ID 唯一性確認

原文件只指定 `property_id`，未說明其跨分行唯一性。

- 確認全站唯一後，source key 用 `(propertyhk, property_id)`。
- 若確認只在分行內唯一，須定義無碰撞的內部 `source_property_id`，同時保留原始 ID 及 branch。
- 不可在未確認前擅自移除分行前綴、把 URL slug 當作穩定 ID，或按地址產生假的原站 ID。
- 若同一 ID 在多個分行出現且確為同一廣告，source record 只建一次；另外保留分行 membership。需要時將已驗證的 `branch_memberships` array 作為版本化 payload 擴充，原 `branch_code` 仍保留為主要分行；不可去重後丟失其他分行關係。

### 8.3 不完整分行

MVP 以 EPW／EPS／EPT 全部完成的整批同步為預設。任何必需分行抓取失敗，不提交為完整批次。

將來如要分行獨立同步，必須有獨立 scope、baseline、lock 及缺席判斷；不能只更改 `branches` array 就沿用全公司基準。

---

## 9. 共用資料格式與正規化

### 9.1 Canonical input 欄位

| 欄位 | 類型／要求 |
|---|---|
| `source_site` | `28hse` 或 `propertyhk`，由受控 adapter／API 指定 |
| `property_id` | 非空來源 ID 字串 |
| `source_url` | 來源頁面 URL；缺失時保留問題狀態，不捏造 |
| `title` | 原始標題，保存公司前綴 |
| `estate`、`district` | 原規格中的地址欄位；不從價格猜出 |
| `block`、`floor`、`unit` | string 或 null；缺值不具自動 matching 資格 |
| `price`、`rent` | number 或 null；使用明確貨幣及單位 |
| `gross_area`、`saleable_area` | number 或 null，建築／實用不可互換 |
| `bedrooms` | integer 或 null；開放式可為 0，不當成缺值 |
| `deal_type` | `sale` 或 `rent`；無法判斷則待驗證 |
| `agent_name`、`agent_license`、`agent_phone` | string 或 null |
| `branch_code` | Property.hk 只接受 EPW／EPS／EPT |
| `scraped_at` | ISO 8601 timestamp，DB 統一存 UTC |
| `raw_payload` | 保留抽取原文及來源證據 |

### 9.2 正規化規則

- trim、合併多餘空白、處理全形／半形及英文大小寫。
- 用經確認的 alias mapping 統一屋苑名；保留原始屋苑文字。
- `Tower 2`／`2座` 可按已驗證規則轉為一致值；不可丟失期數或 `2A` 中的字母。
- `12/F`／`12樓` 可轉為精確樓層 `12`。
- `高層`／`中層`／`低層` 保留為 floor band，不能當作精確樓層。
- `Flat A`／`A室` 可轉成 `A`；不可任意移除有辨識作用的前導零。
- `$5.38M`／`538萬` → `5380000`；原始字串仍保存。
- `520呎` → `520`，同時保留 area type 及 unit。
- 電話以字串儲存，不以數字欄位丟失 `+`、前導碼或分機資訊。

### 9.3 空值規則

`null`、空字串與 `0` 不相同。

`0` 是否有效，應由欄位 validation 決定；不能用 `if not value` 把所有零值視為缺失。`面議` 是未有數值，不可解析成零元。

本版不要求圖片、影片等額外資產合併；若擴展，需另訂來源、授權及重用規則。

---

## 10. Snapshot、run metadata 與歷史

### 10.1 不覆寫歷史

原文件要求每日 CSV。本版建議保留此輸出，並增加 run 子目錄，避免同日重跑覆寫證據：

```text
snapshots/
  28hse/agent-540/2026-09-07/<run_id>/
    listings.csv
    records.jsonl
    manifest.json
  propertyhk/EPW-EPS-EPT/2026-09-07/<run_id>/
    listings.csv
    records.jsonl
    manifest.json
    request.json

diff_report/
  28hse/2026-09-07/<run_id>/changes.csv
```

CSV 採 UTF-8-sig；JSON／JSONL 採 UTF-8。

### 10.2 建議 manifest

```json
{
  "schema_version": "2.0",
  "run_id": "example-run-20260907-001",
  "source_site": "propertyhk",
  "scope_id": "branches:EPW,EPS,EPT",
  "scraped_at": "2026-09-06T19:00:00Z",
  "crawl_complete": true,
  "pages_failed": 0,
  "valid_unique_count": 120,
  "rejected_count": 0,
  "branch_results": {
    "EPW": {"complete": true, "valid_unique_count": 40},
    "EPS": {"complete": true, "valid_unique_count": 45},
    "EPT": {"complete": true, "valid_unique_count": 35}
  }
}
```

上例是**測試示例，不是實際爬取結果**。跨分行同一 ID 的 membership 可重疊，因此正式系統不可假設三個分行 count 的總和永遠等於全局 distinct count。

### 10.3 上一次成功基準

**本版補充：** 正常情況比較昨日 snapshot；若昨日失敗，使用同來源、同 scope 的上一次成功且已套用 snapshot，不使用昨日的失敗檔。

成功爬取但 DB 提交失敗，不得推進 `last_applied_run_id`。先重送原 payload 或修復該 run，避免從未入庫的 snapshot 成為落架基準。

---

## 11. 完整性檢查

### 11.1 原有 30% gate

```text
previous = 同來源、同 scope、上一次成功可比較結果的 valid unique count
current  = 本次 valid unique count

drop_ratio = (previous - current) / previous

若 previous > 0 且 drop_ratio > 0.30：
    拒絕業務資料寫入
    不做 delisted
    不更新 accepted last_seen
    不推進成功 baseline
    記錄 rejected_incomplete 並告警
```

30% 是防誤刪的門檻，不是完整性的證明。剛好跌 30% 只代表未觸發此 gate，仍須通過其他檢查。

### 11.2 其他必須檢查的條件（本版補充）

- 全部必需分行及頁面完成。
- 沒有未處理的 timeout、parser error、pagination loop 或 blocked page。
- 必需詳情頁完成；若少了 ID 或狀態證據，不能作缺席判斷。
- count 以 distinct source keys 計算，不以卡片數或重複筆數計算。
- Property.hk 另檢查分行完整性；一個分行全失敗不能被另一分行增加的數量抵銷。
- 第一個 run 沒有 baseline：須通過 structural validation，且不執行歷史落架比較。
- 新 scope、parser 大改或異常零筆時，需受控 bootstrap／覆核，不自動把零筆設為可信基準。

### 11.3 單筆 validation error 與整批安全性

保留原規格：無效 `branch_code` 只拒絕該筆，其他有效記錄可以處理。

但要分開以下情況：

| 情況 | 有效記錄能否寫入 | 能否用缺席判斷落架 |
|---|---|---|
| 完整批次、全部有效、count gate 通過 | 可以 | 依來源規則 |
| 完整取得頁面、少量記錄 validation 失敗、count gate 通過 | 可寫有效記錄，回報 partial success | 不可以 |
| 中途失敗／分行未完成／跌幅超過 30% | 不可寫業務資料 | 不可以 |

被拒絕的原始 batch、錯誤及 `sync_runs` 可保存作診斷；「拒絕寫入」指不能修改 canonical listings、accepted source state、contacts 或正式成功基準。

---

## 12. 28hse 每日 Diff

以清洗後 `property_id` 比較，按欄位名稱，不按 CSV column index。

| Change type | 條件 | 行為 |
|---|---|---|
| `new` | 本次有，上次成功 snapshot 無 | upsert source／listing，設定 active，保存首次觀察時間 |
| `delisted` | 上次有，本次完整 snapshot 無 | 標記來源落架、記錄時間；不 hard delete |
| `changed` | 兩次都有，受監察欄位不同 | 更新欄位並寫 old/new change log |
| `unchanged` | 兩次都有，欄位相同 | 不寫重複 change log；更新 accepted last_seen |

### 12.1 監察欄位

原規格：售價、建築／實用面積、呎價、標題。

若本次擴展租盤，可加入 `rent`，但售價與租金獨立比較；不把月租與售價當成同一欄位。

### 12.2 同一 ID 重新出現

歷史上已存在、曾落架的同一 source ID 再出現，重新啟用原記錄；不要建立第二個 listing。可補充 `reactivated` 事件，不改寫原 `first_seen_at`。

### 12.3 狀態與事件分開

**本版補充：** `new`、`changed`、`price_changed` 是變更事件；`active`／`delisted` 是生命週期狀態。

若現有 schema 使用 `price_changed` 作 UI flag，應與 active 狀態分開或保留兼容 mapping，避免「改價」令盤源不再 active。

來源上架日期未提供時，`first_seen_at` 只表示系統首次觀察日期，不聲稱是原網站的真正首刊日期。

---

## 13. 跨來源識別與 Matching

### 13.1 來源唯一 key

```text
(source_site, source_property_id)
```

不同網站剛好有同一數字 ID，不代表同一單位。

### 13.2 先查 source ID，再查 unit key

每筆 ingestion 順序必須是：

```text
先找既有 source record
    ├── 已存在 → 更新該 source 與既有關係，不重建 canonical listing
    └── 未存在 → 檢查跨網站 unit match → 唯一候選才綁定
```

這是冪等的基礎。只做 unit matching 而不先查 source ID，會令缺樓層／室號的盤每次同步新增一筆。

### 13.3 原有 exact unit key

```text
normalized_estate
+ normalized_block
+ exact_floor
+ normalized_unit
```

四項必須全部存在，且 normalize 後一致；缺任何一項不 auto-merge。

### 13.4 安全限定（本版補充）

- 屋苑 identity 需能分清期數／地段；不能把不同期同名座號壓成一個 key。
- `高層` 等不等於精確樓層，不能參與 exact match。
- 四欄一致只產生自動匹配資格，不宣稱現實世界 100% 無誤。
- 查到多個 canonical candidates 時，標記 `ambiguous`；不能任選第一筆。
- 同地址的 sale／rent 不互相覆寫。MVP 可用 `(unit_key, deal_type)` 區分展示記錄；若現有 DB 已將實體單位與售租 offers 分層，沿用既有模型。
- 同一 source ID 的單位識別字段發生重大變更，保存新證據並送 review，不靜默改掛到另一個單位。
- alias／normalization 版本更新後，不能直接對全庫無審核重新合併。

### 13.5 禁止單獨觸發 auto-merge 的依據

價格、面積、相片、房數、agent、標題或描述相似，均不能代替四欄 unit key。

疑似同盤可保留為候選；MVP 寧願有兩筆待處理記錄，也不要錯合併。

---

## 14. 合併與欄位優先

| 情況 | 結果 |
|---|---|
| 新 28hse source，未找到已匹配的 Property.hk 記錄 | 建立主 listing，primary 為 28hse |
| Property.hk 精確匹配 28hse | 綁到同一 canonical listing，只補允許且缺失的欄位 |
| Property.hk 無 match | 建立 Property.hk 主記錄並清楚標記來源 |
| 新 28hse 精確匹配既有 Property.hk 主記錄 | 加入 28hse source，提升 28hse 為 primary，保留原 listing ID 與歷史 |
| 同欄位兩來源數值不同 | 顯示值保留 28hse；寫 conflict |
| unit key 不足／候選多於一個 | 不自動合併，保留獨立或 review |
| 同 source ID 重送 | 更新或回傳已有結果，不新增另一個 canonical listing |

### 14.1 欄位選擇

```text
如果原始 28hse 欄位有有效值：
    使用 28hse 值
    若 Property.hk 同欄有不同值，保存 conflict

如果原始 28hse 欄位缺失：
    只在已成功匹配且該欄允許補充時，使用 Property.hk 值
    記錄 field provenance = Property.hk source record
```

標題與描述保留原文；不得用 Property.hk 文案覆蓋已有 28hse 文案。是否允許補入空白描述，應在 `fillable_fields` 中明確列出，不能靠模糊的「補空」把所有欄位直接展開。

### 14.2 本版建議 `fillable_fields`

```text
gross_area
saleable_area
bedrooms
其他經業務確認可補充的非身份欄位
```

`block`／`floor`／`unit` 是 matching 依據：若 28hse 缺其中之一，MVP 本來就不能 automatic match，因此不能先從 Property.hk 猜出這些欄位再反過來聲稱 exact match 成立。人工確認後的補充需保留審核記錄。

### 14.3 Field provenance

每個對外值至少可追溯：

```text
listing_id
field_name
selected_source_record_id
selected_at
selection_reason = primary | fill_missing | manual_verified
```

衝突比較要比較兩個 source 的 normalized 原始值，不能把 canonical 中已由 Property.hk 補入的值，誤當作 28hse 自己提供的值。

若 28hse 日後補回欄位，按 primary 規則重新選值，不把 fallback 永久寫死。

---

## 15. 代理／聯絡人處理

本版把「每盤先展示一位主要聯絡人」當作 MVP 產品規則，不把它聲稱為已核實的兩個網站所有頁面限制。

### 15.1 聯絡人跟來源保存

```text
listing_contacts
- source_record_id
- agent_name
- agent_license
- agent_phone
- branch_code
- contact_status
```

### 15.2 不可逐欄拼成另一個人

**本版補充：** 不能使用「28hse agent A 的姓名＋Property.hk agent B 的電話」。

主要聯絡人應選一整組經驗證的 contact。若 28hse contact 不足以聯絡，可顯示完整的 Property.hk contact 作具來源標示的 fallback，或標記待補；不是把別人的電話當作 A 的缺失欄位。

### 15.3 顯示規則

1. 優先顯示有效、可用的 28hse contact。
2. 沒有可用主 contact 時，才按產品政策顯示已匹配的 Property.hk contact，並保留來源。
3. 已落架來源的 contact 不自動維持為 active primary contact。
4. V2 多代理需已確認同盤，且每位代理有獨立來源／報價脈絡；不得把 28hse 的價格暗示為另一代理的報價。

---

## 16. Property.hk API 合約

### 16.1 Route

```text
POST /api/admin/propertyhk-sync
```

原文件指定的 route 檔案：

```text
src/routes/api.admin.propertyhk-sync.ts
```

原文件亦要求參考既有 `api.mls-sync.ts` 及 `api.admin.woztell.send.ts`。實作前先閱讀現有檔案；本文件未查閱 repository，不預設它們的實際框架或 helper 內容。

### 16.2 認證

```http
Authorization: Bearer {PROPERTYHK_SYNC_SECRET}
Content-Type: application/json
```

- Secret 只存 worker／server environment 或現有 secret store。
- Token 無效回 401，不洩漏內部細節。
- 不把 secret 放進 repository、snapshot、log 或 client bundle。
- Token 綁定 Property.hk 及指定業務 scope，不接受 request 任意指定其他公司／來源來覆寫資料。

### 16.3 保留的業務 payload

以下是可解析 JSON，所有盤源內容均為示例：

```json
{
  "source": "propertyhk",
  "branches": ["EPW", "EPS", "EPT"],
  "scraped_at": "2026-09-06T19:00:00Z",
  "listings": [
    {
      "property_id": "EXAMPLE-0001",
      "title": "示例屋苑 2座 12樓 A室",
      "estate": "示例屋苑",
      "district": "示例地區",
      "block": "2",
      "floor": "12",
      "unit": "A",
      "price": 5380000,
      "rent": null,
      "gross_area": 700,
      "saleable_area": 520,
      "bedrooms": 2,
      "agent_name": "示例代理",
      "agent_license": null,
      "agent_phone": null,
      "deal_type": "sale",
      "branch_code": "EPW"
    }
  ],
  "meta": {
    "schema_version": "2.0",
    "run_id": "example-run-20260907-001",
    "scope_id": "branches:EPW,EPS,EPT",
    "crawl_complete": true,
    "pages_failed": 0,
    "worker_rejected_count": 0,
    "eligible_for_absence": true,
    "completed_branches": ["EPW", "EPS", "EPT"]
  }
}
```

`meta` 是**本版新增的版本化擴充**，方便 worker 提交完整性證據；原業務欄位保留。正式 v2 worker 應提交它。

若接收舊 schema，需明確 compatibility mode；沒有 completeness metadata 的資料不得用來作缺席／落架判斷。API 仍要自己計算 valid distinct count，不能只信任 caller 宣稱完整。

Worker 必須回報 `worker_rejected_count`；不可先刪掉解析失敗記錄，再把剩下資料聲稱為全量有效。`eligible_for_absence` 是來源證據的資格，不是啟用宅谷自動落架的指令：API 還要檢查 server-side policy、scope、所有 gate 及自身 validation。任一側有 records 被拒，均不得以缺席推斷落架。

可新增 `source_url` 等已確認欄位，但兩端 schema 要同步。

### 16.4 建議 response

以下是獨立的三筆資料 response 示例，展示「兩筆有效、一筆被拒」；不是上方單筆 request 的實測回傳。

```json
{
  "success": true,
  "status": "partial_success",
  "sync_run_id": "example-response-run-003",
  "replayed": false,
  "summary": {
    "received": 3,
    "valid": 2,
    "rejected": 1,
    "new": 1,
    "updated": 1,
    "unchanged": 0,
    "skipped_conflict": 1,
    "conflicts_created": 1
  },
  "conflicts": [
    {
      "listing_id": "example-listing-002",
      "field_name": "price",
      "primary_source": "28hse",
      "primary_value": 5380000,
      "secondary_source": "propertyhk",
      "secondary_value": 5500000,
      "resolution": "keep_28hse"
    }
  ],
  "validation_errors": [
    {
      "row_index": 2,
      "property_id": "EXAMPLE-INVALID",
      "field": "branch_code",
      "code": "invalid_branch"
    }
  ]
}
```

`success=true` 表示允許處理的業務交易已提交，不等於每筆皆有效；操作人員與 scheduler 必須同時讀取 `status`。有 rejected records 時使用 `partial_success`，不可發出「全量成功」通知或推進完整性 baseline。

`skipped_conflict` 保留原 response 欄位，定義為「至少一欄次要來源值未覆寫主值的有效 listing 數」。`conflicts_created` 為衝突事件數。兩者可能重疊，不能加進 new／updated／unchanged 作總數。

若同一 payload 有重複 ID，另回傳 `duplicate_in_payload`；validated distinct records 才進入業務處理。

### 16.5 HTTP status（本版建議統一）

| Status | 用途 |
|---|---|
| 200 | 成功；或相同批次 retry 回傳之前結果；單筆拒絕以 body 表示 partial success |
| 400 | Malformed JSON／batch schema 無效 |
| 401 | 未授權 |
| 409 | 同 idempotency key 不同內容、舊批次覆蓋新資料、scope 狀態衝突 |
| 413 | Payload 超過明確配置的大小限制 |
| 422 | 完整性 gate 不通過 |
| 429 | 新批次超過 rate limit，應有 Retry-After |
| 500／503 | 內部／暫時性錯誤，response 不含 stack trace、SQL 或 secret |

---

## 17. Idempotency、順序及 transaction

### 17.1 三個層次的唯一性

| 層次 | 合約 |
|---|---|
| Current source record | unique `(source_site, source_property_id)` |
| Source snapshot | unique `(source_site, source_property_id, scraped_at)` |
| Batch receipt | unique `(source_site, scope_id, scraped_at)`，附 canonical payload hash |

若實際 ID 只在 branch 範圍唯一，先按第 8.2 節定義 source key，不能沿用有碰撞的索引。

### 17.2 原 payload 重送

原規格要求冪等及每小時一次完整 sync。本版補充具體次序：

```text
認證與基本 request-size 限制
→ 解析及 batch validation
→ 計算固定 batch key + payload hash
→ 查有否相同、已成功的 receipt
    ├── 同 key + 同 hash → 回傳舊結果，不重新寫入
    ├── 同 key + 不同 hash → 409
    └── 新批次 → 檢查完整 sync rate limit
→ 取得 scope lock
→ 再確認 receipt / baseline / chronological order
→ completeness gate
→ transaction
```

相同成功批次的 retry 不應因完整 sync quota 被擋成另一個新批次；但一般 request abuse limit 仍可適用。

### 17.3 Out-of-order

同 scope 舊 `scraped_at` 在新 run 成功後才到達：不得覆寫較新的 current values／source status。可拒絕為 stale batch，或只存歷史；行為必須固定並有測試。

### 17.4 Transaction 邊界

同一 logical batch 的業務更新須具原子性：

- source records／snapshots；
- canonical mapping／欄位；
- contacts；
- change log／conflict log；
- 成功 receipt 與 baseline pointer。

原始 payload 與 run 開始／失敗紀錄可以先獨立保存，以便 transaction rollback 後仍有失敗證據。

若資料量超過既有平台可接受的 request／transaction 大小，先 staging 再 finalise；不可自行切成多個「完整批次」後分別推斷落架。實際限制由工程師按部署設定確認。

---

## 18. Conflict Log

至少保存：

```text
listing_id
primary_source_record_id
secondary_source_record_id
field_name
primary_value
secondary_value
primary_observed_at
secondary_observed_at
first_detected_run_id
last_seen_run_id
resolution = keep_28hse
review_status = unreviewed | reviewed
```

### 18.1 示例

```text
同一已匹配 sale listing：
28hse price      = 5,380,000
Property.hk price = 5,500,000

canonical display price = 5,380,000
secondary raw price      = 5,500,000
conflict                 = price / keep_28hse
```

兩個值的觀察時間均須保留，避免把不同時間的資料說成同一時刻雙方報價。

### 18.2 衝突去重（本版補充）

相同 batch 重送不重建 conflict。同一值組合跨日持續存在，可更新 conflict 的 `last_seen_run_id`，另由 snapshot history 保存各次觀察，不需要每天生成完全相同的告警。

數值 normalize 後相等，不因千位逗號或單位文字不同而報衝突。實際數值不同仍需留痕；不能引入未批准 tolerance 把差異吞掉。

---

## 19. Source 狀態、落架與 freshness

### 19.1 28hse

保留原規格：完整、成功、同範圍 snapshot 缺席 → source `delisted`，保存歷史，不代表售出或租出。

### 19.2 Property.hk

原始 Property.hk endpoint 文件未定義「本次缺席是否落架」。**本版 MVP 預設只 upsert，本次缺席不自動 delist。**

可啟用的後續擴充需同時滿足：

- 設定 `absence_detection_enabled=true`；
- 有完整、相同 branch scope 的成功 baseline；
- 必需頁面、詳情及 validation 全部通過；
- 無錯誤或被拒 records 影響缺席判斷；
- count gate 通過；
- 只改該來源／該 scope 的狀態，不跨來源刪除。

### 19.3 Canonical 狀態（本版保守預設）

- 已有 28hse 主來源的 listing，以 28hse 成功觀察的狀態為準。
- 28hse 明確落架但 Property.hk 仍顯示 active：不自動讓舊 secondary 記錄重新啟用主盤；保留來源差異並送 review。
- Property.hk 獨有盤使用其來源狀態與 freshness 規則。
- 任一來源 crawl failure 只更新 ingestion health，不當作盤源落架。

這是本版對「28hse 主來源」的保守操作預設；如業務選擇「任一新鮮來源 active 即繼續展示」，必須另行記錄為政策變更，不靜默套用。

### 19.4 Freshness 與可見性

保存 `last_observed_at`／`last_accepted_seen_at`，並由可配置 freshness policy 標記過期資料。MVP 不對 Property.hk 缺席自動落架，不代表舊資料可以永久展示為剛更新。

過期價格或 contact 是否隱藏／標示待更新，由產品 policy 明確設定；不可把 sync failure 的時間寫成來源最近確認時間。

---

## 20. 建議資料模型

不要求重建現有 DB。先將以下 entity responsibility 映射至現有 schema，再做最少量 migration。

| Entity | 主要責任 | 重要欄位／約束 |
|---|---|---|
| `listings` | 對外 canonical 記錄 | ID、地址、售／租維度、primary source、選定價格、狀態 |
| `listing_source_records` | 每網站 current source | source key unique、listing link、raw／normalized、source status、accepted seen |
| `source_snapshots` | 每次來源觀察 | source key＋scraped_at unique、payload、run_id |
| `listing_contacts` | 來源所屬聯絡人 | source_record_id、完整 contact、可用狀態 |
| `listing_field_provenance` | 顯示值出處 | listing＋field、selected source、selection reason |
| `listing_change_log` | 單一來源／主盤變更 | change_type、field、old／new、run_id |
| `conflict_log` | 跨來源差異 | 兩個 source IDs、兩值、觀察時間、resolution |
| `sync_runs` | ingestion 審計 | source／scope、count、status、hash、時間、錯誤 |
| `source_scope_memberships` | 多分行同廣告的 membership | source_record_id＋branch／scope |
| `match_reviews` | 配對待審 | 候選、原因、證據、人工決定 |

### 20.1 關係

```text
listings 1 ── N listing_source_records
listing_source_records 1 ── N source_snapshots
listing_source_records 1 ── N listing_contacts
listing_source_records 1 ── N source_scope_memberships
listings 1 ── N listing_change_log / conflict_log / field_provenance
sync_runs 1 ── N snapshots / changes / conflicts
```

### 20.2 Schema 保護

- `listing_source_records.listing_id` 可在 staging／review 時為 null；或先建立獨立 canonical 再 link。不能先 insert 一筆缺必填 FK 的 source row。
- existing source ID 不可在 retry 建立另一個 listing。
- 金額使用適合精確比較的 decimal／整數最小單位，不以浮點誤差判斷改價。
- unique indexes、scope lock 與 transaction 共同防止 concurrency duplicate。
- raw payload 的存取權限及保留期需受控；電話及其他個人資料避免寫進一般 debug log。
- 移轉前先 dry-run、備份及提供 rollback 計劃；不使用 destructive migration 掩蓋來源衝突。

---

## 21. Sync Client 與重試策略

### 21.1 `sync_propertyhk.py`

輸入已通過 worker validation 的 `request.json`，完成以下工作：

1. 驗證 endpoint 在受控設定內，避免將 token 送到任意 URL。
2. 從環境／secret store 讀取 token。
3. 以 HTTPS POST 提交固定 bytes／等價 canonical JSON。
4. 保存 HTTP status、request correlation ID、summary 及錯誤類型。
5. timeout 或 retry 不改 `run_id`、`scraped_at` 或 listings。

### 21.2 Retry 分類

| 結果 | 處理 |
|---|---|
| Network timeout／暫時性 5xx | 有上限的 exponential backoff；重送同一 payload |
| 200 replay | 視為已完成，不重跑 crawler |
| 400／401／409／413／422 | 不盲目重試；修正設定、schema 或 run 狀態 |
| 429 | 尊重 Retry-After；不可每秒重送 |
| Retry 全部失敗 | run 標記 failed，保留 payload 供恢復 |

backoff 次數／上限由配置控制。API timeout 後，應先依 idempotency 查詢／重送取得結果，不能假設 server 未入庫而建立另一批次。

---

## 22. 排程與部署

### 22.1 建議順序

```text
02:00 HKT  28hse crawl → gate → snapshot → diff → apply
03:00 HKT  Property.hk crawl → gate → fixed payload → API
完成後      summary／alert
```

時間是配置示例，不是執行時長保證。真正依賴要由 run 狀態／job dependencies 判斷，不能只靠「相隔一小時應該跑完」。

28hse 暫時失敗時，Property.hk 可以保留 raw snapshot；不要利用這次失敗把 secondary 自動升級成新的權威。

### 22.2 cron 範例

以下命令為**待開發 CLI 合約**，不是聲稱目前已有對應程式。cron 範例假設 host timezone 已設為 `Asia/Hong_Kong`；否則需按 scheduler 的 timezone 設定調整。

```cron
0 2 * * * /opt/estate-sync/.venv/bin/python /opt/estate-sync/run_28hse_sync.py --config /etc/estate-sync/sources.json >> /var/log/estate-sync/28hse.log 2>&1
0 3 * * * /opt/estate-sync/.venv/bin/python /opt/estate-sync/run_propertyhk_sync.py --config /etc/estate-sync/sources.json >> /var/log/estate-sync/propertyhk.log 2>&1
```

runner 內需有 scope lock。若用 systemd timer，沿用相同程式與 exit code，避免再寫第二套業務流程。

### 22.3 Secrets

```text
PROPERTYHK_SYNC_URL=https://<your-domain>/api/admin/propertyhk-sync
PROPERTYHK_SYNC_SECRET=<secret-from-managed-environment>
```

上述為設定占位符，不是可用 endpoint／secret。Secret 不要寫入 cron command 或可被一般使用者閱讀的 shell script；使用受控 environment file／service secret。

---

## 23. 建議目錄與交付命令

```text
repo/
├── AGENTS.md
├── README.md
├── requirements.txt
├── crawl_agent540.py
├── diff_agent540.py
├── crawl_propertyhk.py
├── sync_propertyhk.py
├── run_28hse_sync.py
├── run_propertyhk_sync.py
├── config/
│   └── sources.example.json
├── scraping/
│   ├── source_28hse.py
│   ├── source_propertyhk.py
│   ├── normalization.py
│   ├── validation.py
│   ├── snapshots.py
│   └── completeness.py
├── src/
│   ├── routes/api.admin.propertyhk-sync.ts
│   └── services/listings/        # 按現有 repository 命名調整
├── migrations/
├── tests/
│   ├── fixtures/28hse/
│   ├── fixtures/propertyhk/
│   ├── test_diff_agent540.py
│   ├── test_propertyhk_parser.py
│   ├── test_normalization.py
│   └── test_completeness.py
└── docs/
    ├── payload-schema.md
    ├── deployment.md
    └── runbook.md
```

### 23.1 CLI contract（程式需由開發團隊實作）

```bash
# 保留原有 28hse CSV 輸出介面；runner 管理正式 run 路徑。
python3 crawl_agent540.py --output snapshots/example.csv

# 日常由 runner 選取 last successful applied snapshot。
python3 diff_agent540.py \
  --today snapshots/current.csv \
  --yesterday snapshots/previous-success.csv \
  --out diff_report/example.csv

# Property.hk：新增 crawler + snapshot producer。
python3 crawl_propertyhk.py \
  --config /etc/estate-sync/sources.json \
  --branches EPW EPS EPT \
  --out-dir snapshots/propertyhk/example-run

# 新增 client：提交固定 payload；URL 與 secret 從環境載入。
python3 sync_propertyhk.py \
  --payload snapshots/propertyhk/example-run/request.json

# 完整 runner：dry-run 不提交 API、不更新 baseline。
python3 run_28hse_sync.py --config /etc/estate-sync/sources.json --dry-run
python3 run_propertyhk_sync.py --config /etc/estate-sync/sources.json --dry-run
```

README 必須定義每個 CLI 的輸出、exit codes、retry 及恢復方式，不讓操作人員猜測「程式有印 summary」是否等於成功。

---

## 24. 核心處理 Pseudocode

以下是流程描述，並非可直接執行的完整程式。

### 24.1 Worker

```text
run_source_sync(source, scope):
    acquire_scope_lock(source, scope)
    run = create_run()

    raw_result = crawl_all_required_pages(source, scope)
    save_raw_evidence(run, raw_result)
    normalized, rejected = validate_and_normalize(raw_result)

    baseline = get_last_successful_applied_run(source, scope)
    gate = evaluate_completeness(raw_result, normalized, rejected, baseline)

    if gate.reject_business_write:
        finish_run_as_rejected(run, gate.reason)
        alert(run)
        return nonzero_exit

    payload = freeze_payload(run, normalized, rejected, gate)
    save_immutable_snapshot_and_payload(payload)

    result = submit_or_apply_using_existing_sink(payload)
    if result.business_commit_success:
        record_receipt(result)
        if gate.eligible_for_complete_baseline:
            advance_successful_baseline(run)
    else:
        preserve_payload_for_retry(run)
        return nonzero_exit
```

### 24.2 單筆來源入庫與匹配

```text
apply_record(tx, record):
    existing = find_source_by_unique_key(tx, record.source_key)

    if existing:
        preserve_source_snapshot(tx, record)
        if identity_changed_requires_review(existing, record):
            keep_existing_canonical_link_and_open_review(tx, existing, record)
        else:
            update_existing_source_and_contacts(tx, existing, record)
            reproject_canonical_fields_from_raw_sources(tx, existing.listing_id)
        return

    candidates = []
    if has_complete_exact_unit_identity(record):
        candidates = find_cross_source_candidates_same_offer_type(tx, record)

    if count(candidates) == 1:
        listing = candidates[0]
    else:
        listing = create_separate_canonical_listing(tx, record)
        if count(candidates) > 1:
            create_ambiguous_match_review(tx, listing, candidates)

    source = insert_source_linked_to_listing(tx, record, listing.id)
    preserve_source_snapshot(tx, record)
    store_contact_as_a_whole(tx, source, record.contact)
    reproject_canonical_fields_from_raw_sources(tx, listing.id)
    write_distinct_conflicts(tx, listing.id)
```

### 24.3 欄位與聯絡人不可共用盲目 merge

```text
select_display_field(field, matched_sources):
    primary = valid_28hse_raw_value(field)
    secondary = valid_propertyhk_raw_value(field)

    if primary exists:
        return primary with 28hse provenance

    if field in approved_fillable_fields and secondary exists:
        return secondary with Property.hk provenance

    return null

select_primary_contact(matched_sources):
    choose one usable contact object with its source identity
    never combine name from source A with phone from source B
```

---

## 25. Logging、監控與失敗恢復

### 25.1 必須可觀察

- source、scope、run_id、開始／完成時間及 duration。
- requested／succeeded／failed pages、是否被阻擋。
- raw count、distinct count、valid／rejected records。
- new／changed／unchanged／delisted counts。
- match／unmatched／ambiguous counts。
- conflict 新增數、持續存在數。
- completeness 結果、API status、replayed receipt。
- baseline 是否推進、最終 run status。

不得把 token、Authorization header、DB connection string 或未遮罩電話寫入一般 log。

### 25.2 告警

任一必需分行失敗、count 跌幅超過 30%、parser 大量失效、401／429、transaction rollback、連續排程失敗、old batch 覆蓋風險及多重 canonical 衝突均需可告警。

通知功能可預留 `--notify`；使用哪個通知服務由現有技術棧決定，不作核心爬取依賴。

### 25.3 恢復流程

| 問題 | 恢復方式 |
|---|---|
| 抓取未完成 | 修正網絡／parser 後開新 run；原 failed snapshot 留存 |
| 已抓完但 POST timeout | 重送同一 `request.json`，不改時間或 ID |
| DB rollback | 修正後依相同 receipt／payload 重試 |
| count 大跌可能是真實落架 | 人工確認完整性；記錄 override 原因／人員，不直接關掉全局 gate |
| 相同 run key 卻不同內容 | 回 409；找出 payload 被修改原因，禁止默默覆蓋 |
| 錯誤配對 | 根據 source links／history 人工解除與修正；原證據不刪除 |

---

## 26. 測試與驗收

### 26.1 Parser fixtures

兩個來源分別準備：正常列表、正常詳情、正常空頁、重複置頂 ID、缺 unit、驗證頁、timeout、分頁循環、欄位格式變化。

Property.hk 必須包含 EPW／EPS／EPT 樣本及跨分行 ID 唯一性測試。

沒有 live access 時可先測離線 fixture，但交付報告必須分開「fixture 測試通過」與「正式來源 smoke test 已通過」。

### 26.2 必測案例

| ID | 情境 | 預期 |
|---|---|---|
| T01 | 相同 28hse ID 出現在多頁 | 一筆 source record |
| T02 | 200 頁面其實為驗證頁 | 不當正常空頁；run incomplete |
| T03 | 中間頁 timeout 但總數只跌 5% | 仍不作完整 snapshot |
| T04 | 新 ID | new；原子寫入 |
| T05 | 完整 snapshot 缺少舊 ID | 28hse soft delisted，不標示已售 |
| T06 | 價格改變 | 保存 old/new；無其他重複欄位變更 |
| T07 | `#123` 與 `123` | 按已核准清洗規則視為同來源 ID |
| T08 | 昨天失敗 | 比較上一次成功已套用 snapshot |
| T09 | count 200 → 120 | gate 拒絕，不改業務資料 |
| T10 | EPW 失敗但其他分行增盤 | 不能聲稱全量完成 |
| T11 | API 同 payload 重送 | 回 receipt，不 duplicate |
| T12 | 同批次 key、不同內容 | 409 |
| T13 | 舊批次在新批次後抵達 | 不覆寫新資料 |
| T14 | 四欄唯一 exact match | 同一 canonical，保留兩個 sources |
| T15 | 只有面積／價格相近 | 不合併 |
| T16 | 相同屋苑、不同期但同座／層／室 | 不因 normalization 丟期數而合併 |
| T17 | floor 只有「高層」 | 不當精確樓層 |
| T18 | 缺 unit 且連續每日重爬 | 沿用既有 source，不能每日增盤 |
| T19 | 多個 exact candidates | review；不任選第一個 |
| T20 | 同單位 sale／rent | 不互相覆寫價格／contact |
| T21 | 28hse／Property.hk 售價不同 | 保留28hse＋conflict |
| T22 | 28hse 後來補回原本缺失欄位 | 主來源重新優先，更新 provenance |
| T23 | 28hse agent A 無電話、宅谷 agent B 有電話 | 不拼成 A＋B 電話 |
| T24 | 個別非法 branch code | 只拒該筆；不以部分有效批次判斷落架 |
| T25 | 交易中途錯誤 | rollback；baseline 不推進 |
| T26 | 第一個 run／零 baseline | 受控 bootstrap，不推斷歷史落架 |
| T27 | 同 scope 並發兩個 run | lock／索引防重，順序可追溯 |
| T28 | dry-run | 不 POST、不改 DB、不推進 baseline |

### 26.3 Definition of Done

- [ ] 新增 Property.hk 自建爬蟲與三分行 parser／fixtures。
- [ ] 沒有 Hermes／Agent runtime／LLM key 執行依賴。
- [ ] 28hse 既有 ID、前綴、CSV、diff 與 soft delete 合約保留。
- [ ] 自動分頁正常終止與 parser／network failure 能區分。
- [ ] Worker 和 API 都執行相應完整性防護。
- [ ] Source keys、snapshot keys、receipt keys 有 DB 層防重。
- [ ] 既有 source record lookup 優先於新 canonical 建立。
- [ ] 四欄 matching、source priority、conflict、contact provenance 均有測試。
- [ ] 秘密、endpoint scope、大小限制、rate limit 及安全 error response 已實作。
- [ ] Immutable snapshot、日誌、失敗恢復與 replay 可演示。
- [ ] 移轉方案、部署手冊、告警負責人及 rollback 步驟已交付。
- [ ] 報告清楚列出 live site／repo integration 尚未驗證部分，沒有把 fixture 測試當 live 成功。

---

## 27. 建議開發次序

### WP0 — 確認現有環境與 fixtures

讀現有 DB／routes，確認 EPW／EPS／EPT URL、parser、來源 ID 及授權範圍；保存可重複測試的樣本。未確認 selectors 前，不交付聲稱可用的硬編碼爬蟲。

### WP1 — 共用資料合約

實作 normalization、validation、run metadata、source keys、snapshot storage 及 completeness tests；完成最少量 migration。

### WP2 — 28hse 主資料線

保留原行為，完善 run-level 成功／失敗、last successful baseline、diff 與原子寫入。

### WP3 — Property.hk 自建 worker

實作三分行 crawler、parser、snapshot、固定 payload builder、HTTP client。先 dry-run，不進 production canonical DB。

### WP4 — 接收端與合併

依既有 backend style 實作認證、schema、冪等、rate limit、scope lock、matching、source priority、conflict 及 transaction。

### WP5 — 排程與交付

完成 scheduler、secret、告警、受控初次匯入、重試演練、shadow comparison、runbook 及驗收。

首版先完成單一主要代理、嚴格匹配和證據保存；多代理 UI、fuzzy candidate review 及更複雜缺席策略留待後續。

---

## 28. 可直接交給開發同事／Codex 的工作指令

```text
Goal
實作晉誠地產的 28hse + Property.hk 雙來源爬蟲及合併管道。
不使用 Hermes、AI Agent、LLM extraction 或 Agent 排程平台。

先讀取
- 本規格。
- 現有 AGENTS.md、爬蟲、DB schema、migrations、sync routes、tests。
- 28hse /agent/540 原有 snapshot / diff 流程。

必須交付
1. 保留並完善 crawl_agent540.py / diff_agent540.py。
2. 新增 crawl_propertyhk.py，涵蓋配置的 EPW / EPS / EPT。
3. 新增固定 payload builder / sync_propertyhk.py。
4. 新增或完善 /api/admin/propertyhk-sync 接收端。
5. 共用 normalization、validation、completeness、source matching。
6. Source records、snapshots、contacts、provenance、logs、sync runs 的
   最少量 migration 或現有 schema mapping。
7. Offline fixtures、unit / integration tests、cron / systemd 文件、runbook。

不可更改的規則
- 28hse primary；Property.hk 只補缺失且允許補充的欄位。
- 來源 ID 去重與跨網站單位匹配分開。
- 先找既有 source ID，不能每次重跑都新增 canonical listing。
- 四欄完整、精確、唯一候選才 auto-match；不靠價格或面積猜。
- 數值衝突保留 28hse 並寫 conflict_log。
- 不拼接不同代理姓名及電話。
- 落架只 soft delete；失敗頁不能當正常空頁。
- count 跌超過 30% 或必需頁面／分行未完成，不改業務資料。
- 同 payload retry 不 duplicate；舊批次不覆寫新資料。
- API 不啟動爬蟲；排程／browser 只在 worker 執行。
- Secret 不進 code、snapshot、log 或 client bundle。

實作自由
可以沿用現有 framework、ORM、job runner、storage、logging 與測試工具。
不要為本任務另造 Agent 平台，也不要無聲替換已存在的核心 infra。
原 schema 不足時，提出並實作最少量可回滾 migration。

缺失來源資訊
Property.hk 的完整 URL / selectors / ID 範圍需從設定與授權樣本確認。
未確認前，把未知項標記為 required config / parser fixture TODO；
不要捏造可用 selector、API 或測試通過結果。

Output
提供修改檔案清單、schema mapping / migrations、執行命令、測試結果、
部署及回滾步驟，以及仍需在真實來源或現有後端確認的事項。
分開回報 fixture tests、DB integration tests、live smoke tests。
```

---

## 29. 最終規則摘要

> **排程器啟動兩個自建爬蟲，不啟動 AI Agent。**

> **Property.hk 的新開發範圍包括爬蟲和提交程式，不再只做接收端。**

> **28hse 為主、Property.hk 為輔；原始來源與顯示主記錄分開。**

> **先 source-ID upsert，再跨站 matching；合併可追溯，衝突不丟棄。**

> **只有完整且可信的 snapshot，才有資格改變落架狀態。**

> **本版提供的是開發合約；URL、parser、現有 DB 整合與正式部署均需有實際驗證證據。**
