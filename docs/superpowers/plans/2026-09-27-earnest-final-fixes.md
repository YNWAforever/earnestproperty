# Earnest Property Final Fixes — Codex GPT-6 Sol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task when available. 執行者：Codex GPT-6 Sol。步驟使用 checkbox 追蹤；本次交付只包含計劃，沒有實作或部署。若執行環境沒有該技能，按本文件的任務、驗證及證據要求執行。

**Goal:** 完成最終審核 R01–R16，讓管理員容易連接同事 Inbox、批量建立可追蹤連結，並以正確成交及跟進資料呈現代理績效。

**Architecture:** 延伸既有 TanStack Start server-function 邊界、Neon SQL、WhatsApp readiness、批次快照及工作佇列；不重建整套後台。先建立版本化身分證據及成交歸因，再接上 UI 和報表。公開網站採讀取已建立連結和媒體變體的方式，不在頁面 GET 中建立資料。

**Tech Stack:** 稽核基準為 React 19、TanStack Start／Router、Vite／Nitro、TypeScript、Zod 3、Neon Postgres raw SQL、Neon Auth、Tailwind／shadcn、Vercel、既有 WhatsApp provider adapter 及 worker。實作前由 T00 核對實際版本；不因本計劃擅自升級主要套件或換框架。

**Spec:** 套件內 `references/EarnestProperty_Final_Audit_WhatsApp_Analytics_2026-09-27_zhHK.md` 及同名 `.html`，兩份都要讀；另有 `references/README.txt`。本次附件與上一輪已審核報告逐 byte 相同。原審核 commit：`3ebe4e3cb47807e8d870f2b9eac90954f73f4f11`，不是要求退回此版本。

**Repository:** https://github.com/YNWAforever/earnestproperty  
**Public:** https://earnestproperty.vercel.app/  
**重點路徑:** `/admin/whatsapp-settings`、`/admin/whatsapp-links`、`/admin/analytics`、`/admin/transactions`。

## Global Constraints

- 依執行時最新 `main` 及適用 `AGENTS.md`／repository 指示工作；保留其他未提交修改。先核對再改，不盲目重做已修項目。
- 繁體中文香港用語為產品介面預設。技術 ID、provider error code 放進管理員進階詳情，主要流程顯示名稱與可操作提示。
- 保留 `dateOrNull` 日期 DTO 修正、公開樓編、租售區分、contextual WhatsApp fallback、權限檢查、版本、快照、冪等及結果不明查證流程。
- 「最多 1,000 行預覽」「每次 50 行提交」「10 分鐘預覽有效期」「分析日期最多 90 日」是本計劃沿用的既有限制。多來源展開後仍受 1,000 行限制。
- `ready`、供應商接納、分派讀回、delivered receipt、同事確認分開；不要以勾選框、HTTP 200 或 provider accepted 宣稱已送達。
- 不猜 Haze 的帳戶、Folder、電話、Channel 或分行。不把網站 staff UUID 當 provider identity；同名／同電郵只能作匹配候選。
- 不假設存在「列出全部 Folder」API。保留目前 direct assignment 的 Folder 必須已匹配政策；此輪不新增自動搬 Folder 的隱藏副作用。
- 不為消除阻擋而全域開啟發送、跳過映射核實、批量改派客戶、偽造佣金或成交資料。
- 資料庫修改採新增 migration，不能改寫已部署 migration；優先沿用既有表及型別，不另造平行 CRM。
- 生產環境批量寫入、發送及部署按既有授權範圍執行。先完成程式、隔離環境驗證及可審閱變更，再處理尚欠的具體操作授權；缺少外部條件只阻擋該驗收項目。
- 本計劃的新檔名、介面及設定預設屬設計決定，不代表 repository 已經存在；T00 若找到等價模組，沿用並記錄對應，避免雙軌實作。

## Review Focus

1. 同名職員、同一 provider 帳戶跨 Channel、目錄翻頁後找不到人：不得錯綁或把「尚未載入」當「不存在」。T02、T03 測試。
2. 管理員開著舊頁，另一人已停用映射／換收件端點：儲存、建立連結及試送均不得沿用舊授權。T01、T04、T07 測試。
3. 多來源表格有全形空白、重複列、無效網址或一個 blocked 行：保留草稿，明示問題，不偷改來源、不默默漏行。T06、T07 測試。
4. 同事調分行、多人分佣、成交取消或歷史歸因缺失：歷史績效不能跟目前人事資料漂移，空缺不可自動猜填。T10–T14 測試。
5. 營業時間邊界、尚未成熟的轉換 cohort、重複 receipt、試送混入客戶資料：不得美化 SLA 或重複計數。T04、T12、T13 測試。

---

## 1. 交付方式、依賴與 PR 順序

計劃分成三個工作包，各自有可驗收結果；可在同一分支依序實作，再拆成依賴清楚的 PR。執行者不需要等全部完成才提供可審閱的修復。

| 工作包 | 任務 | 產出 | 建議 PR |
|---|---|---|---|
| 基準與證據 | T00 | 最新 SHA、差異清單、可跑的測試與隔離環境 | 文件／測試基線 |
| A：同事與 WhatsApp | T01–T08 | Inbox 選擇、核實、試送狀態、批量連結及網站覆蓋 | A1 身分與設定；A2 批量與覆蓋 |
| B：營運與績效 | T09–T14 | 正確公開數量、成交歸因、指標與報表 | B1 數據／成交；B2 分析 |
| C：公開體驗 | T15–T16 | 正確媒體／交通文案、真實縮圖 | C1 內容與媒體 |
| 驗收與發布 | T17–T18 | 性能結果、回歸、migration、rollout／rollback 證據 | 最終驗收記錄 |

**必要依賴：** T00 → 全部；T01 → T02 → T03 → T04 → T05；T03＋T06 → T07；T07＋T09 → T08；T10 → T11 → T12 → T13 → T14；T09 → T14；T08、T14、T16 → T17；所有功能任務 → T18。T09、T10、T15、T16 不必等 provider credentials。T05 的真人收件驗收受外部條件影響時，繼續其他任務。

**建議實作次序：** T00、T09、T01、T02、T03、T04、T06、T07、T08、T10、T11、T12、T13、T14、T15、T16、T05、T17、T18。不要用工時預估代替可核對完成條件。

## 2. R01–R16 覆蓋矩陣

| Finding | 主責任務 | 關閉條件 |
|---|---|---|
| R01 Haze 不可用 | T03、T04、T05 | 真實綁定及每種啟用能力分別驗收；真人未測標明 external-blocked |
| R02 技術 ID 表格 | T02、T03 | 一般流程以帳戶／Folder／分行名稱選取，無須抄 ID |
| R03 核實混淆 | T01、T04 | 證據類型、時間、版本及 receipt／ack 分開 |
| R04 Folder 語意 | T02、T03、T05 | 先核對存取權；對話 Folder 不符時明確阻擋，不暗中搬移 |
| R05 績效缺失 | T12–T14 | 來源／代理／分行、跟進、成交及佣金有可下鑽資料 |
| R06 成交歸因缺失 | T10、T11 | 私有成交資料與多人貢獻可儲存、核實、取消及審計 |
| R07 公開數量錯配 | T09 | 總覽與 canonical 公開物業列表同口徑 |
| R08 網站追蹤不足 | T08 | 覆蓋率、補建及公開 CTA 讀取有效版本全部驗證 |
| R09 批量輸入繁複 | T06 | 多來源展開、URL／CSV／貼表格及逐行錯誤 |
| R10 blocked 阻擋整批 | T07 | 明確提交合格子集、新 token、不漏行、可恢復 |
| R11 通知步驟混雜 | T03、T04 | Channel 等自動帶入、外部代碼進階化 |
| R12 試送／導航不清 | T03、T04 | 三能力卡、不同按鈕、修復連結及未儲存提醒 |
| R13 映射競爭覆蓋 | T01 | expectedVersion、409 差異、停用後舊要求失效 |
| R14 統計口徑 | T12、T13 | test／spam 排除、cohort 與 backlog 分開、分母可查 |
| R15 內容不符 | T15 | 無 VR 時不寫 VR；交通按已核實屋苑內容 |
| R16 縮圖／性能 | T16、T17 | 真實變體被瀏覽器取用，附傳輸量及性能結果 |

每項狀態用 `not-started / in-progress / fixed-local / verified-staging / verified-production / external-blocked`。只有驗收證據支持才提高狀態；程式完成與營運啟用分兩欄記錄。

## 3. 檔案責任與共同契約

### 3.1 既有檔案入口

| 領域 | 既有檔案／位置 | 修改責任 |
|---|---|---|
| 映射 | `src/components/admin/whatsapp/StaffMappingWizard.tsx`、`src/lib/neon/whatsapp-assignment.ts`、`src/lib/whatsapp-enquiries/assignment.server.ts` | 新帳戶選擇／核實 API、版本化儲存 |
| Provider | `src/lib/woztell/inbox-api.server.ts` | 只讀目錄與權限查證，沿用 provider fetch 邊界 |
| Readiness | `src/lib/neon/whatsapp-readiness.types.ts`、`whatsapp-readiness-policy.ts`、`whatsapp-readiness.server.ts` | 擴充證據及修復動作，不合併三種能力 |
| 通知 | `src/components/admin/StaffEndpointEditor.tsx`、`src/components/admin/whatsapp/StaffTestNotificationDialog.tsx`、`src/lib/neon/staff-endpoints.server.ts` | 預設值、端點版本、試送及結果呈現 |
| 連結 | `src/components/admin/whatsapp/WhatsappLinkWizard.tsx`、`WhatsappLinksTable.tsx`、`src/lib/neon/whatsapp-link-batches.server.ts`、`src/lib/whatsapp-enquiries/link-batch-policy.ts` | 多來源輸入、子集預覽、能力解釋 |
| 批量狀態／匯出 | `src/lib/admin/whatsapp-link-batch-client.ts`、`whatsapp-link-selection.ts`、`whatsapp-link-export.ts`、`whatsapp-link-export.server.ts` | 草稿恢復、範圍、CSV、結果查證 |
| 公開／總覽 | `src/lib/neon/public-data.server.ts`、`admin-property-management.server.ts`、`admin-data.server.ts`、`src/routes/admin.index.tsx` | canonical 數量及批次解析 CTA |
| 成交 | `src/components/dashboard/TransactionForm.tsx`、`src/lib/neon/admin-data.ts`、`admin-data.server.ts`、`src/routes/admin.transactions.tsx` | 私有成交／歸因編輯，保留公開 DTO 隔離 |
| 分析 | `src/lib/analytics/reporting.ts`、`reporting.server.ts`、`reporting-client.ts`、`src/routes/admin.analytics.tsx` | 指標、聚合、篩選、明細及狀態 |
| 公開文案 | `src/lib/property-public.ts`、`src/routes/index.tsx`、`listings.tsx`、`property.$listingNo.tsx`、`src/content/estate-pages.ts` | 共用顯示文案與地區內容 |
| 圖片 | `src/components/media/AppImage.tsx`、`src/lib/media/responsive-images.generated.json`、`scripts/media/generate-responsive.mjs` | 延伸現有媒體方式處理遠端 MLS 圖片 |
| Schema／驗收 | `neon/migrations/`、`scripts/test-staff-handoff-browser.mjs`、`scripts/test-whatsapp-link-handoff-browser.ts` | 新增 migration、延伸 fixture 及端到端驗證 |

表中同一格省略路徑前綴的檔名，沿用該格最近列出的目錄。新增模組在各任務標為「新增」；先查是否已有等價功能，再落實路徑。

### 3.2 共用設計決定

1. **身分範圍**：provider tenant／integration＋company Channel＋staff；證據再綁 inboxUserId、Folder、mapping version。目錄 cache 不能跨租戶／Channel；只有 admin／manager 可以讀目錄。
2. **映射證據**：延伸現有表，新增版本與 append-only 核實事件；舊人工 evidence 原樣保留並標 `legacy_manual`，不可轉成 provider 驗證成功。新 strict 流程逐同事推出；flag 未啟用時保留既有行為，不能部署後突然全公司停派。
3. **預設值（本計劃新設計）**：目錄 cache 最長 5 分鐘；新核實 token 10 分鐘內可儲存，綁 actor／scope／版本。到期重新核實；已儲存證據不等同永久可用，送出前仍檢查權限、版本及既有 provider readback。不得把 provider transient failure 當帳戶不存在。
4. **通知狀態是證據集合**：provider acceptance、delivery、manual receipt confirmation、acknowledgement 各有時間及來源。可能沒有 delivered receipt，這時可記同事人工確認，但不可合成 provider receipt。
5. **連結草稿**：沿用 `rowKey`／batchId／chunkId；修改快照內容或提交子集都建立新 batch／preview。使用者確認跟進路線；預設保持總台但不得隱藏路線。
6. **貨幣及貢獻**：HKD 金額在 DB 用固定精度 numeric，API 使用十進位字串；分配使用整數 basis points，完全歸因合計 10,000。未知佣金為 null，確定無佣金才是 0。
7. **分析時間**：Asia/Hong_Kong，起日含、翌日午夜不含；period created cohort、成交日期、回覆時間及 current backlog 分開。新轉換 cohort 預設觀察窗口 90 日，可選 30 日，清楚顯示未成熟 cohort；這是本計劃建議產品預設，不是報告量得的結果。
8. **身份去重**：沿用 contact ID／已驗證合併關係，不以姓名或推測電話合併。無 contact 的查詢計入查詢量，顯示無法辨識客戶數，不補成唯一客戶。

---

## 4. T00：重核基準及建立執行紀錄

**Files:** 讀 `AGENTS.md`（如有）、`CLAUDE.md`、`package.json`、lockfile、現行 migrations；新增 `docs/reports/2026-09-27-final-fixes-ledger.md`。把本計劃放到 `docs/superpowers/plans/2026-09-27-earnest-final-fixes.md`，兩份 spec 放到同層 `references/`。

**Consumes:** 兩份附件、GitHub repository、審核 SHA。**Produces:** 每個 R 項目的最新重現／已修證據、目前 HEAD、可用測試環境及檔案映射。

- [ ] 執行 `git status --short`、`git rev-parse HEAD`、`git log -5 --oneline`；核對 repository remote，依既有工作方式建立隔離分支，保留其他工作。
- [ ] 讀完整 spec，對最新 HEAD 檢查 R01–R16；已修項保留 regression evidence，不能為迎合舊報告再改回去。
- [ ] 核對實際 package scripts、Node／Bun 及 lockfile。檢查 provider／DB 的設定是否存在，但不輸出 secret；先用 fixture，不把 production 當測試庫。
- [ ] 將 `CLAUDE.md` 中過時的排程描述與當前 worker 實作核對；不因舊文件擅自改現有排程架構。
- [ ] 建立 ledger：finding、task、status、commit、test command、pass/fail/skip、staging URL、production evidence、external blocker。基準驗證結果與本次將新增的測試分開。
- [ ] Commit：`docs(audit): establish final remediation baseline`。

**驗收：** 可以指出最新 SHA 與報告 SHA 的差異；附件兩版本沒有未解釋的內容矛盾。沒有 DB／provider credentials 時仍可開始純邏輯及 UI 任務。

## 5. 工作包 A：WhatsApp 身分、通知與批量

### T01：映射版本與可追溯核實證據

**Depends:** T00。**Finding:** R03、R13。

**Files:** 修改 `src/lib/whatsapp-enquiries/assignment.server.ts`、`src/lib/neon/whatsapp-assignment.ts`、readiness 型別；新增 `src/lib/neon/staff-mapping-review.types.ts`、`staff-mapping-review.server.ts`、`src/lib/whatsapp-enquiries/mapping-review.test.mjs`、`mapping-review.db.test.mjs`；新增 migration（按當時序號命名，後綴 `staff_mapping_review_versions.sql`）。

**Interfaces:** 新增 `saveReviewedStaffChannel({staffId, expectedVersion, evidenceId, eligible}, actor)`，回傳 `{mappingId, version, evidenceId}`；新建 `expectedVersion:null`，更新必須帶整數版本。`retireStaffChannel({mappingId, expectedVersion, reason}, actor)` 獨立停用。`MappingReviewEvidence` 含 ID、staff、provider scope、inboxUserId、folderId、basis、result、checkedAt、expiresAt、actor、mappingVersion；敏感 provider response 不直接回前端。

- [ ] 加入 DB 行為測試：兩個 v1 更新同時送出，只可一個成功；另一個 409；舊版不能復活已停用資料；跨 staff／Channel／actor evidence 被拒。
- [ ] 在已確認的隔離 DB 跑 `node --test src/lib/whatsapp-enquiries/mapping-review.db.test.mjs`，先確認測試指出現有缺陷，不以無 DB skip 當成功。
- [ ] migration 增加 mapping version、核實事件及 scope 索引；保留歷史人工證據，新增 append-only audit；既有公開／通知 DTO 不洩漏 provider payload。
- [ ] 儲存採單一 transaction＋version compare-and-swap；evidence 必須匹配 scope、未過期、未被其他修改失效。相同 provider identity 重複綁不同 staff 預設拒絕；既有衝突標示待核對，不盲建唯一索引造成 migration 失敗。
- [ ] 停用不要求重新填核實紀錄；使後續候選及未送出工作重新判斷，保留已完成歷史。回傳 409 可比較的已淨化最新版本摘要。
- [ ] 跑新增兩個測試及 `npm run test:staff-notifications`；隔離 migration 前後資料守恆；commit `feat(whatsapp): version staff mapping evidence`。

**核心斷言：** `successes.length === 1`；`conflict.status === 409`；`legacy.basis === 'legacy_manual'`；沒有 provider call 的人工事件不得產生 `provider_verified`。

### T02：Inbox 帳戶目錄與 Folder 存取核對

**Depends:** T01。**Finding:** R02、R04。

**Files:** 修改 `src/lib/woztell/inbox-api.server.ts`；新增 `src/lib/neon/inbox-directory.ts`、`inbox-directory.server.ts`、`inbox-directory.types.ts`、`src/lib/woztell/inbox-directory.test.mjs`；T01 migration 後另加 named Folder catalog migration（只在現有模型沒有等價 catalog 時）。

**Interfaces:** `listInboxCandidates({query, folderKey?, cursor?}, actor): Promise<{items: InboxCandidate[], nextCursor: string|null, checkedAt: string}>`；`InboxCandidate={userId, displayName, email, channelId, role}`。`listInboxFolders(actor)` 返回 `{folderKey, displayName, providerFolderId, source}` 清單。`verifyInboxSelection({staffId, userId, folderKey, expectedVersion}, actor): Promise<{evidenceId, result, expiresAt, reasons}>`，evidence 使用 T01 型別；分行由本地職員資料讀取，不當 provider Folder。

- [ ] 測 pagination、同名、wrong Channel、Folder access denied、provider 401／403／429／5xx、malformed response、cursor 重複；fake provider fixture 放在測試內，不使用真實帳戶資料。
- [ ] 執行 `node --test src/lib/woztell/inbox-directory.test.mjs`，先取得失敗案例。
- [ ] 依執行時官方文件與已配置能力實作 server-only `list-users`。查詢字串只作本地安全篩選，不杜撰供應商的 email search 參數；正確處理分頁及未載入完整目錄的結果。
- [ ] Folder catalog 沿用已確認租戶能力；沒有目錄 API 時提供管理員維護名稱／ID 的單次進階設定。每次綁定仍以 provider 讀取核對該 user 在該 Channel／Folder 的存取權。空查詢不等於驗證成功。
- [ ] API URL／憑證只來自伺服器設定，不接受前端任意 provider URL；伺服器限流、timeout、scope cache；錯誤提供下一步但不輸出 credential。核實 token 綁 T01 scope；外部 request timeout 不留假成功證據。
- [ ] 重跑測試，檢查 unauthorized agent 被拒及 cache 不跨 Channel；commit `feat(whatsapp): add scoped inbox directory verification`。

**驗收：** 一般管理員可由名稱／電郵辨識候選；無 API／權限時顯示「需管理員完成公司連接」，不退回要求每位同事猜 ID。

### T03：把四步精靈改成可完成的工作流程

**Depends:** T01、T02。**Finding:** R01、R02、R04、R11、R12。

**Files:** 修改 `StaffMappingWizard.tsx`、`src/routes/admin.whatsapp-settings.tsx`；新增 `src/components/admin/whatsapp/InboxAccountPicker.tsx`、`StaffConnectionSummary.tsx`、`StaffMappingWizard.test.tsx`。

**Interfaces:** 消費 T02 candidates／folders／verify 與 T01 save／retire；使用既有 `StaffWhatsappReadiness`。路由 search 加入經驗證的 `{staffId?, step?, draftId?}`；draftId 只恢復登入者自己的草稿，不可接受任意外部 return URL。

- [ ] UI 測試：名字相同需選帳戶；Folder 未核實不能啟用；切同事不洩漏上位資料；版本衝突保留輸入；返回批次可恢復 draft。
- [ ] 跑 `bun test src/components/admin/whatsapp/StaffMappingWizard.test.tsx`，確認既有表格不能滿足上述案例。
- [ ] 第一步顯示姓名／工作電郵／分行；第二步改帳戶與 Folder 選單及「檢查連接」。ID 只讀放進進階；direct adapter 隱藏 Routing Node，保留原值但不暗改路由。
- [ ] 驗證成功後摘要顯示時間與結果，儲存使用 evidenceId，不讓前端自行宣稱 verified。補上獨立「停用接單」與版本衝突比較。
- [ ] 四步可瀏覽，但不能把未完成步驟畫成完成；離開未儲存欄位提示。沒有能力可用時給修復按鈕。把 28hse／YouTube 外部 staff reference 放進明確的進階區。
- [ ] 重跑 UI＋readiness tests；在窄屏與鍵盤操作驗證下拉、focus、錯誤摘要；commit `feat(admin): simplify staff inbox onboarding`。

**驗收目標：** 公司連接與 Folder catalog 完成後，管理員連接 Haze 的主要畫面不用手打 provider ID／Channel ID／核實編號；目錄失效有明確處理，不偽造候選。

### T04：通知預設、三種能力與試送證據

**Depends:** T03。**Finding:** R03、R11、R12。

**Files:** 修改 `StaffEndpointEditor.tsx`、`StaffTestNotificationDialog.tsx`、`src/lib/neon/staff-endpoints.server.ts`、readiness policy／server；沿用 `src/lib/neon/whatsapp-test-notification` 對應 server 邊界及既有 receipt／attempt 儲存；新增 `src/components/admin/whatsapp/StaffNotificationSetup.test.tsx`。

**Interfaces:** 沿用 `previewStaffTestNotification`、`enqueueStaffTestNotification`、`getStaffTestNotification`，不要另建發送通道。擴充 status DTO 為 `{state, providerAcceptedAt, providerDeliveredAt, recipientConfirmedAt, acknowledgementAt, evidenceSource, endpointVersion, mappingVersion}`，nullable 證據保持 null。每個 `ReadinessReason` 使用既有 `actionHref` 指向可修復步驟。

- [ ] 測 opening／save 不發訊息；兩個 transport 顯示不同按鈕；accepted 無 receipt 仍不是 delivered；同 requestId 重複提交只一個 attempt；舊 endpoint／mapping version 被拒。
- [ ] 跑 `bun test src/components/admin/whatsapp/StaffNotificationSetup.test.tsx` 及對應既有 attempt DB test，確認新增需求的失敗。
- [ ] 公司 Channel 由 server 帶入；私有備註可引用已核實 mapping，保存後記版本依賴。手機通知維持獨立 verified destination、許可、quiet hours、session／template 限制，不把 userId 當 phone ID。
- [ ] 三能力卡各自顯示 ready／blocked／unknown 與修復動作。「測試 Inbox 私有備註」「測試同事 WhatsApp」分開；preview 顯示遮罩目的地、完整測試文案、版本及阻擋原因。
- [ ] 沿用 queued／accepted／unknown／failed 等既有狀態，附獨立 receipts／人工確認；重複或亂序 receipt 不倒退、不重複計。unknown 先查 status，不換 requestId 自動重發；處理刷新後恢復 attempt。
- [ ] 跑 UI、`npm run test:staff-notifications` 及 `npm run test:woztell` 相關子集；commit `feat(whatsapp): clarify notification setup and delivery evidence`。

**文案：** accepted＝「供應商已接納，尚未核實送達」；人工收件確認＝「同事已確認收件（人工紀錄）」；不得將 private note 描述成手機 WhatsApp 已送達。

### T05：Haze 端到端驗收與營運操作表

**Depends:** T04；真實驗收依所需配置。**Finding:** R01、R04。

**Files:** 延伸 `scripts/test-staff-handoff-browser.mjs`；新增 `docs/runbooks/whatsapp-staff-onboarding.md`、`docs/reports/haze-routing-acceptance.md`。不要在測試 fixture hardcode production staff UUID。

**Interfaces:** 使用 T03／T04 UI 和既有 assignment readback；產出每能力 `{environment, staffId, mappingVersion, endpointVersion, testedAt, result, evidenceRef}` 的淨化驗收紀錄。

- [ ] 在隔離 fixture 驗證未映射 Haze → blocked；有效測試帳戶 → 可預覽；Folder 不符 → 明確阻擋；只有 readback 對應同一測試 conversation 才記分派確認。
- [ ] 以已確認的隔離 target 執行 `npm run test:staff-notifications:e2e`；記錄 environment 與 skip，不能只看 exit code。
- [ ] 準備真實驗收卡：Haze 的網站帳戶、已核實 provider identity／Folder、選用能力、遮罩目的地、獨立測試 conversation、訊息「[測試] 晉誠地產同事接收驗證，請回覆確認。」，不含客戶資料。
- [ ] 既有授權明確涵蓋該收件人與試送時可執行；只有姓名而無可核實目的地時先補資料，不猜 recipient。provider 設定缺失時標 external-blocked，先完成程式與其他任務。
- [ ] 分別記錄分派讀回、private note、WhatsApp acceptance、可取得的 delivery receipt、Haze 收件確認；不因一項成功推定全部成功。
- [ ] 移除僅供驗收的草稿／測試連結時採既有停用機制，保留審計；提交操作指引及證據，commit `docs(whatsapp): record staff routing acceptance`。

**關閉條件：** 有真實證據才關閉 R01 的 production 部分；只有 fixture 成功則 status 為 verified-staging，缺口照列，不停下整個修復項目。

### T06：多來源、網址與 CSV／貼表格匯入

**Depends:** T00。**Finding:** R09。

**Files:** 修改 `WhatsappLinkWizard.tsx`；新增 `src/lib/whatsapp-enquiries/link-batch-import.ts`、`link-batch-import.test.mjs`、`src/components/admin/whatsapp/WhatsappBatchImport.tsx`。

**Interfaces:** `parsePlacementInput(source, value): {placementId:string}|{errorCode:string}`；`parseBatchImport(text, format:'csv'|'tsv'): ImportResult`；`expandBatchDraft(offers, sources, placements): DraftExpansion`。在同一檔輸出 `ImportRow={publicListingNo,dealType,source,placementInput,staffReference?}`、`ImportResult={rows,errors}`、`DraftExpansion={rows,errors,offerCount,rowCount}`，輸出 rows 沿用 `BatchRowDraft`。

- [ ] 測 20 筆租售 × 3 個來源＝60 行；展開 1,001 行拒絕；售租分離；全形空白／UTF-8 BOM／quoted comma／重複行；來源錯配網址有錯誤而非猜 ID。
- [ ] 跑 `node --test src/lib/whatsapp-enquiries/link-batch-import.test.mjs`，先建立 red case。
- [ ] 以純 URL parser 抽取已確認的 28hse／YouTube URL 格式，不 fetch 任意網址、不追蹤短網址；支援 YouTube watch／youtu.be／shorts，28hse 格式從實際 fixtures 驗證。未知格式保留原輸入請人核對。
- [ ] 匯入模板固定欄位 `public_listing_no,deal_type,source,placement_url_or_id,staff_reference`；staff reference 需在所選來源範圍查對既有映射，無法辨識標 blocked，不以姓名自動綁定。
- [ ] 輸入階段顯示每行位置／欄位錯誤、物業數、租售數、來源數、展開總行數；網站 placement 使用既有 canonical identity。重複行提示重用／移除，不能默默丟棄。
- [ ] 重跑新測試及 `npm run test:admin-properties` 對應前端子集；commit `feat(whatsapp): import multi-source link batches`。

**驗收：** 可貼一張表完成多來源；缺少外部投放識別的行不捏造值；CSV 匯出保留現有防公式注入。

### T07：行內修正、合格子集與草稿恢復

**Depends:** T03、T06。**Finding:** R10，支援 R13。

**Files:** 修改 `WhatsappLinkWizard.tsx`、`src/lib/admin/whatsapp-link-batch-client.ts`、`src/lib/neon/whatsapp-link-batches.server.ts`、既有 `link-batches` DB tests；新增 `src/lib/admin/whatsapp-batch-draft.ts`、`whatsapp-batch-draft.test.ts`。

**Interfaces:** `prepareEligibleSubset(draft, preview, selectedRowKeys): {rows:BatchRowDraft[], excludedRowKeys:string[]}` 只整理資料；真正提交前仍呼叫既有 `previewWhatsappLinkBatch` 取得全新 batchId／token。`saveDraft(actorScope,draft)`／`loadDraft(actorScope,draftId)` 用版本化 local draft，不儲存 JWT／provider ID／原始收件資料；登出／換帳戶清除或隔離。

- [ ] 測 60 行其中 1 blocked → 使用者確認後只預覽 59 行；舊 token 不能提交新子集；修改 staff 後舊 preview 失效；重試不得重建已完成 chunk。
- [ ] 跑 `bun test src/lib/admin/whatsapp-batch-draft.test.ts` 及既有 `link-batches` 測試，先確認缺陷。
- [ ] 預覽列顯示來源、公開樓編、租售、投放 ID、同事、create／reuse／blocked 及能力摘要；提供行內編輯和「修正 Haze 設定」，保留 draftId 返回位置。
- [ ] 新增「只提交已核對的合格行」，顯示提交／重用／排除數；重新預覽新內容，不切改已簽快照。修改設定返回最近相關步驟，不清掉所有輸入。
- [ ] 送出前重新驗 mapping／endpoint 相關版本、盤源及權限；保留 50 行 chunk、status 查證與 session 恢復。另存未完成行；完成頁可複製全部、按來源匯出及只修失敗行，不混入未知結果行重發。
- [ ] 跑 `npm run test:whatsapp-enquiries`、`npm run test:admin-properties`、`npm run acceptance:whatsapp-link-handoff`（先驗證 target）；commit `feat(whatsapp): recover and submit eligible batch rows`。

**驗收：** 停用同事與建立連結並發時，不能用 preview 時的舊 ready 狀態繞過 commit 檢查；UI 不承諾「連結建立＝已刊登外部平台」。

### T08：網站追蹤覆蓋與可控補建

**Depends:** T07、T09。**Finding:** R08。

**Files:** 新增 `src/lib/neon/whatsapp-coverage.ts`、`whatsapp-coverage.server.ts`、`whatsapp-coverage.types.ts`、`src/lib/whatsapp-enquiries/coverage.test.mjs`、`coverage.db.test.mjs`；修改 `WhatsappLinksTable.tsx`、`src/lib/neon/public-data.server.ts`、`src/lib/whatsapp-enquiries/public-context.ts` 及三個公開 renderer。

**Interfaces:** `getWebsiteTrackingCoverage(filters, actor): {eligibleOffers,coveredOffers,missingOffers,conflictedOffers,checkedAt}`；`previewCoverageBackfill(selection, actor)` 產生既有 batch preview。public 查詢用 `resolveWebsiteActions(offers)` 批次回傳每個公開租售的有效 `/w/` 或既有 contextual fallback，不暴露 staff 私有 ID。

- [ ] Fixture 測 6 筆首頁租售中 2 covered、3 missing、1 conflicted；inactive offer 不入分母；同一公開號售租分開；只有其他來源連結不能算網站 covered。
- [ ] 跑 `node --test src/lib/whatsapp-enquiries/coverage.test.mjs src/lib/whatsapp-enquiries/coverage.db.test.mjs`，確認現有缺口。
- [ ] Coverage 使用 T09 同一 canonical 公開资格；顯示分母及時間，可篩「未有網站連結」。補建走既有 preview／commit，不讓頁面 GET 或 cron 偷建一批。
- [ ] 系統可核對網站公開 placement，取代毫無依據的人工勾選；對外平台仍需人核對。若多條連結／路線衝突，顯示人工選擇，不任意挑第一條。
- [ ] 公開 renderer 共用既有 context helper，批次取得有效版本；連結被停用、供應商或 DB 暫不可用時，保留有公開樓編／租售的 fallback，不讓公開頁整頁壞掉。coverage 區分「已覆蓋」與「fallback」，不要假稱 fallback 可完整歸因。
- [ ] 跑 public-context、redirect、listing-search 回歸，隔離環境補建後再點 CTA／入站歸因；commit `feat(whatsapp): manage website tracking coverage`。

**驗收：** 同一 approved placement 的不同網站呈現可共用既有 `website:primary`；若需要額外區分首頁／詳情點擊，另加事件維度，不能隨意改 placement identity 造成重複連結。prefetch／HEAD／健康檢查不灌水點擊。

## 6. 工作包 B：資料口徑、成交及代理績效

### T09：統一公開物業與租售數量

**Depends:** T00。**Finding:** R07。

**Files:** 修改 `src/lib/neon/admin-data.server.ts`、`admin-property-management.server.ts`、`src/routes/admin.index.tsx`；新增 `src/lib/neon/public-inventory-counts.server.ts`、`public-inventory-counts.db.test.mjs`，若已有共用 canonical query 則延伸該模組。

**Interfaces:** `getPublicInventoryCounts(): Promise<{publicProperties:number,publicOffers:number,checkedAt:string}>`；使用與管理列表相同 canonical latest-version selection／status predicate。Overview DTO 新增明確欄位，遷移舊 `properties` 消費端。

- [ ] Fixture 含一個公開物業售租兩盤、舊來源重複、最新下架及草稿；斷言物業計一次、有效租售計兩次、下架及草稿不算。
- [ ] 在隔離 DB 跑 `node --test src/lib/neon/public-inventory-counts.db.test.mjs`，確認 raw count 缺陷。
- [ ] 提取／共用公開資格與去重查詢；不要在首頁載入完整列表來計數，也不要把 327 寫死。
- [ ] 總覽顯示「目前公開物業」及必要的租售數說明；link 帶一致篩選。保留 raw source row count 僅作匯入診斷，不放公開 KPI。
- [ ] 測刷新、零資料、DB error 顯示不同狀態；比對同一 snapshot 的列表 total 與 overview count，並納入租售／來源重複 fixture。
- [ ] 跑新增 test 及 `npm run test:admin-properties`；commit `fix(admin): align public inventory counts`。

### T10：成交歸因、佣金與歷史快照模型

**Depends:** T00。**Finding:** R06，支援 R05。

**Files:** 沿用 `transactions` 及現有 provenance migration；新增 timestamped migration 後綴 `transaction_sales_attribution.sql`，新增 `src/lib/neon/transaction-performance.types.ts`、`transaction-performance.server.ts`、`transaction-performance.db.test.mjs`。修改既有 admin transaction write 邊界。

**Interfaces:** `saveTransactionPerformance(input,actor): Promise<{transactionId,version}>`；`input={transactionId,expectedVersion,leadId:null|string,publicListingNo:null|string,dealType,confirmedAt:null|string,commissionReceivable:null|DecimalString,commissionReceived:null|DecimalString,credits:AgentCredit[],attributionStatus,reason}`；`AgentCredit={staffId,branchIdAtClose:null|string,shareBps:number}`。沿用既有成交價／成交日，不另寫第二份交易金額來源。

- [ ] 測兩代理 6,000＋4,000 bps 成功、9,999／10,001 拒絕、同代理重複拒絕；null 佣金與 0 不同；sale／rent 單位分開；併發更新 409；公開 DTO 不含佣金／contact。
- [ ] 跑 `node --test src/lib/neon/transaction-performance.db.test.mjs`，先確認現有 schema／API 缺失。
- [ ] 優先以私有 extension 表及 credits child table 關聯既有 transaction；金額 numeric 非 float，nonnegative，HKD，版本及審計。新欄位 nullable，可逐筆核實，不為歷史記錄填目前樓盤代理。
- [ ] 延伸業務核實／取消／更正，不把既有「已核實並發布」直接當所有內部績效已核實。保留 provenance 的本公司成交資格；未歸因成交可計公司已核實宗數，但進未歸因 bucket，不分給任何人。
- [ ] 成交確認時保存代理及分行快照；後續更正要理由及新版本；調分行不改舊快照。取消保持歷史但排除現行有效成交 KPI；commission refund／超收採現有付款模型，若沒有則明確 validation，不隱式負數。
- [ ] Migration 驗 row count／FK／舊 reader 相容；跑新增 test 與 `src/lib/neon/admin-transactions.contract.test.mjs`；commit `feat(crm): record verified transaction attribution`。

**重要邊界：** Credit-weighted 金額按 bps 分配；公司成交宗數 distinct transaction 計一次。代理「參與宗數」可多人各加一，不能相加當公司宗數；另提供 weighted deals＝shareBps／10,000。

### T11：成交表單及日常維護流程

**Depends:** T10。**Finding:** R06。

**Files:** 修改 `TransactionForm.tsx`、`src/routes/admin.transactions.tsx`、admin transaction editor 路由及 server wrapper；新增 `src/components/admin/TransactionAttributionEditor.tsx`、`TransactionAttributionEditor.test.tsx`。

**Interfaces:** UI 消費 T10 DTO；新增 lookup endpoints 沿用 staff／lead／property 授權查詢，不把全量客戶清單送到瀏覽器。核實／取消／更正呼叫 T10 write API。

- [ ] 測搜尋樓編／lead、售租不一致、60/40 分配、未歸因歷史記錄、公開發布與內部核實獨立；agent 不得透過改 request 越權核實／看他人佣金。
- [ ] 跑 `bun test src/components/admin/TransactionAttributionEditor.test.tsx`，先確認缺失。
- [ ] 加入「成交歸因」區：公開樓編／租售、關聯 lead、負責／合作同事、分行快照、分配、佣金；必填程度依 draft／verified 狀態決定，可先存草稿。
- [ ] 列表加未歸因／待核實篩選及資料品質提示。分佣未滿 100% 不可標完整歸因；沒有佣金證據保留未知。
- [ ] 同時改 published 狀態不得曝光私有財務欄位；權限沿用 server actor 的實際授權，admin／manager 與 agent 能力明確測試，不假設所有 manager 跨分行都有權。
- [ ] 重跑 UI＋T10 DB tests，驗證公開成交頁資料 shape；commit `feat(admin): add transaction attribution workflow`。

### T12：跟進事件、資料品質與可歸因來源

**Depends:** T10、T11。**Finding:** R05、R14。

**Files:** 新增 `src/lib/analytics/performance-events.ts`、`performance-events.server.ts`、`performance-events.test.mjs`、`performance-events.db.test.mjs`；延伸既有 CRM 活動、入站、assignment-confirmed、first-human-response 處理入口。若缺少必要欄位再加 migration 後綴 `performance_event_quality.sql`。

**Interfaces:** `recordPerformanceEvent(event,actorOrSystem)`；`event={idempotencyKey,type,inquiryId?,leadId?,transactionId?,staffId?,branchIdAtEvent?,occurredAt,source,quality,policyVersion?}`。type 固定為 `lead_qualified | viewing_completed | assignment_confirmed | human_response | deal_confirmed | deal_cancelled`；quality 使用 `production | test | spam | unknown`，沿用現有等價欄位／事件優先，不能對同一活動保存兩份權威狀態。

- [ ] 測重複 webhook／receipt 不重複事件，bot／試送不產生真人回覆，取消看樓不計 completed，未知歸因保留 unknown；HK 午夜及離線補錄保留 occurredAt。
- [ ] 跑新 events pure／DB tests，確認現有不足。
- [ ] 選定現有權威來源：CRM 活動完成→看樓、provider readback→confirmed assignment、合格職員 outbound→human response、T10 核實→deal。用同一 transaction 或既有 outbox 保證事件與業務寫入一致。
- [ ] 權限及業務資格在 server 驗證；event type 不能靠 browser 任意提交來美化績效。資料修正保留 audit／reversal，不能直接刪歷史。
- [ ] 最小新增「標為測試／垃圾／恢復有效」管理操作，需原因；報表重算受影響日。歷史無可靠證據標 unknown，不把所有舊資料直接當已驗證 production，也不默默全部排除；報表另列 unknown 及 coverage。
- [ ] 跑 events tests＋既有首回覆／staff-event isolation 測試；commit `feat(analytics): capture qualified performance events`。

### T13：銷售與代理指標 API

**Depends:** T09、T12。**Finding:** R05、R14。

**Files:** 新增 `src/lib/analytics/sales-performance.types.ts`、`sales-performance.ts`、`sales-performance.server.ts`、`sales-performance.test.mjs`、`sales-performance.db.test.mjs`；延伸 `reporting-client.ts` 的已授權 server boundary。

**Interfaces:** `getSalesPerformance(filters,actor): Promise<PerformanceReport>`；`filters={start,end,branchId?,staffId?,source?,dealType?,cohortWindowDays:30|90}`。`PerformanceReport={range,asOf,qualityCoverage,acquisition,followup,sales,backlog,agents,definitions}`；每 metric 為 `{value:null|number|string,unit,denominator:null|number,sampleSize,status,drilldownKey}`。`listPerformanceRecords({filters,drilldownKey,cursor},actor)` 分頁明細採同一 predicate，不能用 client 提供 SQL。

- [ ] 固定 fixture：10 宗有效查詢、另 2 test／1 spam；6 qualified、3 completed viewing、2 linked confirmed sale；同一 90 日 cohort 成交轉換＝2/10，而不是同期所有成交÷查詢。未成熟 cohort 明示 provisional；空分母 rate=null。
- [ ] 固定成交 fixture：HK$10,000,000 售價、HK$100,000 佣金、60/40 credits → weighted sale HK$6m／HK$4m、commission HK$60k／HK$40k；公司宗數＝1；租月租 HK$20,000 不加入售價總額。
- [ ] 跑 `node --test src/lib/analytics/sales-performance.test.mjs src/lib/analytics/sales-performance.db.test.mjs`，先 red 再實作參數化 aggregate SQL，避免多個 one-to-many JOIN 相乘；先分別去重聚合再合併。
- [ ] 首回覆顯示 calendar elapsed median／p90及樣本數；business-time SLA 沿用既有 approved policy version 的 dueAt／timing，無對應證據顯示 unavailable，不能固定扣週末。未回覆行留在未回覆／逾期分母，不只報已回覆者。
- [ ] 分開 acquisition date cohort、deal closed date、current backlog；requested／confirmed／current assignee 選用明確 metric definition。歷史 branch 用事件／成交快照；unknown 歸因另列。唯一客戶採 verified contact identity。
- [ ] 所有查詢、明細及匯出在 server 限制實際 actor scope；cache key 含 scope／filter／data revision。重跑 90 日邊界、不同角色、zero/null、cancelled deal、late event、reassignment 回歸；commit `feat(analytics): calculate attributable sales performance`。

**口徑文件：** 每 metric 附公式、分子／分母、時間基準、排除規則、歸因時間點、aggregation unit、未知資料比率；income 不等於 property sale value。初版不聲稱重建過去每日 backlog，除非已有可信事件歷史。

### T14：可下鑽的營運及績效報表 UI

**Depends:** T13。**Finding:** R05、R14。

**Files:** 修改 `src/routes/admin.analytics.tsx`；新增 `src/components/admin/analytics/PerformanceDashboard.tsx`、`PerformanceTable.tsx`、`PerformanceDashboard.test.tsx`；沿用現有 operational report。

**Interfaces:** 消費 T13 report／drilldown；URL 驗證日期、分行、同事、來源、租售及 cohort window；未知 filter 顯示可修復錯誤，不能擴成全公司查詢。

- [ ] UI 測：無成交、未知佣金、缺 GA4、無權限、API 503、不同 scope、分行調動、分母 0；卡片明細總數與報表一致。
- [ ] 跑 `bun test src/components/admin/analytics/PerformanceDashboard.test.tsx`，確認新增需求尚未滿足。
- [ ] 分四頁籤／區域：「新增與轉換」「回覆及跟進」「成交及佣金」「當前待辦」。展示篩選、更新時間、比較口徑、資料品質；同事表欄位有定義 tooltip 及 sampleSize。
- [ ] 每項 KPI 可點開 matching records，保持篩選及權限；匯出欄位與角色權限一致，沒有默默超過目前可見範圍。只設完成價值明確的排序，不製造綜合分數排行榜。
- [ ] 未接駁 GA4 保留現有明確空狀態。GA4 接駁不列入這輪 mandatory scope，不以假 pageviews 補圖。agent 若尚無 route 授權，保留拒絕；如開放個人報表，必須同步完成 server scope tests。
- [ ] 跑 UI＋`npm run test:analytics`，驗窄屏、鍵盤、讀屏 table／空狀態；commit `feat(admin): present sales and agent performance`。

## 7. 工作包 C：公開內容與圖片

### T15：共用媒體文案及屋苑交通規則

**Depends:** T00。**Finding:** R15。

**Files:** 修改 `src/lib/property-public.ts`、`src/routes/index.tsx`、`listings.tsx`、`property.$listingNo.tsx`、`src/content/estate-pages.ts`；延伸 `src/lib/property-public.test.ts`、`src/content/estate-pages.test.mjs`。

**Interfaces:** 沿用／新增 `publicPropertyDisplayTitle(property): string` 和 `resolveEstateTransport(estateKey): {text,sourceRef,verifiedAt}|null`；共享同一 verified VR capability 判斷給 title、media tab、SEO 及 CTA text。普通 video URL 不自動代表 VR tour。

- [ ] 測「VR實景／VR 實景」無有效 VR capability 時去掉該宣稱；有 verified tour 時保留；其他物業描述不損壞。A074714 三個 renderer 共用結果；缺交通內容不套錯地區。
- [ ] 跑 `bun test src/lib/property-public.test.ts`、`node --test src/content/estate-pages.test.mjs`；確認 regression 可重現。
- [ ] 顯示層清理，保留原始來源文案供管理員核對；不能猜改房間數。同步檢查 OG／卡片／WhatsApp 預填與 title 一致。
- [ ] 交通以 verified estate mapping 選內容；沒有核實內容顯示中性地區指南 link，不能自行編巴士路線。修正星堤錯套青龍頭段問題，保留證據來源及管理入口。
- [ ] 抽查首頁、搜尋、詳情、分享 metadata 及無媒體 fallback；跑 `npm run test:seo`、`npm run test:property-experience` 對應子集。
- [ ] Commit `fix(content): align media claims and estate transport`。

### T16：遠端 MLS 圖片的真實尺寸變體

**Depends:** T00。**Finding:** R16。

**Files:** 修改 `src/components/media/AppImage.tsx`、`scripts/media/generate-responsive.mjs` 及 MLS media ingestion；新增 `src/lib/media/remote-variants.server.ts`、`remote-variants.test.mjs`、`remote-variants.db.test.mjs`；沿用既有 generated manifest／metadata pattern。

**Interfaces:** `ensureMediaVariants({assetId,sourceHash,sourceUrl},ports): Promise<VariantSet>`；`VariantSet={sourceHash,variants:Array<{width,url,bytes,format}>,status}`。公開 `AppImage` 只接可用 variants，無需連 provider。新設尺寸 160／320／640／960／1280px，永不放大低解析原圖；可按既有 manifest 支援尺寸調整並記錄。

- [ ] 測同 sourceHash 冪等、來源更換不讀舊 variant、失敗 fallback、160px thumbnail srcset、無 upscale、異常大小／非圖片拒絕；在 trusted source allowlist 下下載，不能開任意 remote image proxy。
- [ ] 跑 `node --test src/lib/media/remote-variants.test.mjs`，先 red；不以把原圖 URL 加 `?w=160` 當已完成變體。
- [ ] 使用既有 ingestion／worker pipeline 產生實檔、存 Blob metadata，限制 bytes／pixels／並發／重試。backfill 支援 dry-run、限批、checkpoint；不在公開 request 即時處理全部圖片。
- [ ] `AppImage` 提供 width／height、sizes／srcset；76px 縮圖用 160px 候選適配 2x；首屏主圖適當優先，非首屏 lazy；其他原圖保留可用 fallback。
- [ ] Browser 驗 `currentSrc`、實際 response bytes／尺寸、主圖品質及 layout shift；同 URL cache 不重複計算下載。驗 backfill 重跑不重建相同檔案。
- [ ] 跑 `npm run test:media` 及新增 DB test（隔離），commit `perf(media): serve responsive remote property variants`。

## 8. T17：性能、批量規模及端到端回歸

**Depends:** T08、T14、T16。**Finding:** R09、R10、R16，跨域驗收。

**Files:** 新增 `scripts/acceptance/final-remediation.mjs`、`docs/reports/final-remediation-performance.md`；沿用既有 DB／browser fixtures。只有環境、load target 及 fixture ownership 驗證通過才執行負載。

**Interfaces:** runner 輸出 `{sha,target,fixtureId,caseId,durationMs,passed,skipped,reason,evidencePath}`；聚合 cold／warm、p50／p95、rows、SQL 計畫、errors，不能只輸出全綠字樣。

- [ ] 建立 1／50／300／1,000 行批次、20×3 來源、duplicate／expired／revoked／disconnect fixtures；同時納入成交多人歸因、資料量 10k／100k events 及 90 日報表。
- [ ] 執行 baseline 與 revised 同條件量測；warm request 至少 20 次，cold 另列，報告樣本少的限制。批次不使用 production 真實投放或客戶。
- [ ] 新增性能驗收目標（產品目標，非既有測量）：1,000 行 preview warm p95 ≤5s、50 行 commit p95 ≤3s、90 日 report p95 ≤2s；達不到時先檢 query plan／索引／集合查詢，不直接擴大 timeout。
- [ ] 分析 SQL 使用 `EXPLAIN (ANALYZE, BUFFERS)` 只限隔離資料；以查詢決定索引，避免全卡重掃。Preview 查詢數不得隨 rows 成為 N 次 HTTP；手機網站 target LCP≤2.5s／CLS≤0.1 作實驗室方向，INP 需現場資料，沒有 RUM 不宣稱達標。
- [ ] 統一跑本計劃測試清單中的相關 scripts、typecheck、lint、build；DB／browser 如 skip，列為未驗證，不因 exit0標通過。只對具體剩餘風險追加測試。
- [ ] Commit 性能結果及未過門檻處理，`test(acceptance): verify final remediation workflows`。

## 9. T18：遷移、逐步啟用、回退與最終交付

**Depends:** T01–T17 的可執行部分。**Files:** 新增 `docs/runbooks/final-remediation-rollout.md`，更新 ledger 及環境設定範例；不要 commit secrets。

**Interfaces:** 沿用平台既有 configuration／feature-flag 模式，按域提供 `staff_directory_setup`、`staff_review_enforcement`、`link_batch_import`、`sales_performance_reporting` 控制（名稱是建議，由 T00 對應實際機制）。flags 控制 UI rollout，不代替 server authorization。

- [ ] Schema 採 expand → migrate/backfill → verify → enable。先測舊 reader＋新 schema、新 reader＋完整 migration；mapping legacy evidence 保留；舊成交 attribution 留 unknown；圖片原圖不刪。
- [ ] 在隔離 DB 完成 migration、fixture、FK／row-count／constraint 檢查；輸出待執行 migration 清單、目標 DB／project 識別、備份／恢復點及可審閱 SQL。沒有 production 授權時只停在這個外部操作，繼續其他交付。
- [ ] 先開 Haze 或已核實試點帳戶，再小批網站補建；只在同事證據完整時啟用該同事的 strict mapping。新報表先與明細對數再開，raw／unknown data 不偽裝已清理。
- [ ] 生產 smoke：列表日期、公開樓編搜尋、6 個 CTA sample、Haze 設定、總覽 count、報表篩選與明細；生產驗收不得再次隨意產生訊息。記錄測試條件與部署 SHA。
- [ ] 回退：停新 UI／能力 flag、停未執行新工作、恢復上個相容 app；保留新增欄位／事件／已建立連結及審計，不 rollback drop table，不重播發送；遇資料錯誤用明確補償 migration。
- [ ] 提交 PR／handoff：每個 R 的狀態、改動、測試／skip、migration、設定需求、性能、畫面、外部未完成及下一步。只有取得證據的項目標 production verified。Commit `docs(release): finalize remediation evidence and rollout`。

## 10. 驗證指令及完成判定

以下 named scripts 存在於審核基準 `package.json`；T00 在最新 HEAD 核對後使用。新增測試加入相應 script／CI，不只保留手動指令。不要呼叫不存在的 `npm test`。

```bash
npm run typecheck
npm run lint
npm run build
npm run test:admin-properties
npm run test:whatsapp-enquiries
npm run test:staff-notifications
npm run test:analytics
npm run test:property-experience
npm run test:listing-search
npm run test:seo
npm run test:media
```

DB／browser 指令先確認 runner 的隔離 target guards 與 credentials，再執行：

```bash
npm run test:admin-properties:db
npm run test:whatsapp-enquiries:db
npm run test:staff-notifications:db
npm run test:public-performance:db
npm run acceptance:whatsapp-link-handoff
npm run test:staff-notifications:e2e
```

`npm run build` 不等於 typecheck；部分 named test scripts 包含 DB case，缺環境可能 skipped。不能沿用報告「20 tests passed」當成實作後證據。

### 必須保持的回歸案例

- A074714 公開號、售盤搜尋、detail breadcrumb、contextual WhatsApp 預填及 date DTO 不回退。
- 未核實 Haze 仍不能建立指定路線；總台 fallback 可用；取得有效證據後只開啟相應能力。
- 一次 preview 不發訊息、不改派、不建立追蹤連結；只建立有 TTL 的 preview snapshot。
- 同 token／requestId 重試不重複發送；unknown 不自動當 failed 重送。
- admin／manager／agent 範圍及外部來源隔離；公開 DTO 不含私有佣金、收件端點或核實 payload。
- GA4 未設定維持 unavailable；轉換分母 0＝null；sale value、租月租、佣金分別顯示。
- 表格支援鍵盤、focus、label、讀屏；窄屏不以橫向長 ID 逼使使用者抄資料。

### 完成定義

**程式完成：** R01–R16 都有任務、commit、必要測試與文件；無已知高優先 regression，CI 新增測試有執行。**隔離驗收完成：** migration、真實 DB 邊界、批次恢復、角色範圍及 browser 流程有證據。**生產營運完成：** 部署及設定已確認、Haze 各能力取得相應實際證據、網站覆蓋及報表可對數。

如 provider credentials、Folder catalog 或 Haze 收件確認未取得，交付其他已完成內容，列出具體缺口與可直接執行的下一步。不得把「不能試送」改寫成「程式一定正常」，也不得讓它阻擋所有程式交付。

## 11. 非本輪範圍

不重寫整個 CRM／CMS、不改用 Next.js 或新 ORM、不替換現有 job system、不自動刊登 28hse／YouTube、不新增未核實 Folder routing、不製作假 GA4 報表、不根據沒有歸因的資料生成代理排行榜。只做實現 R01–R16 所需且可驗收的變更。

## 12. 計劃自我核對

- R01–R16 全部映射到任務；技能要求的五項 Review Focus 有明確 owner tests。
- MD／HTML 附件的原始內容相同，來源 SHA 及限制已保留；本計劃沒有宣稱重新審核最新 live state。
- 新介面及檔案清楚標示為設計，修改時沿用既有 server-only／Zod／raw SQL 邊界。
- 不因沒有 Folder API、GA4 或 receipt 就假造成功；有明確 fallback 與外部阻擋狀態。
- 本輪只完成計劃及任務包，沒有執行上述 migration、build、CI、provider 發送或 production 部署。
