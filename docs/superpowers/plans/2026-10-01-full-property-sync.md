# EarnestProperty 每日盤源同步完整修復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 執行模型：Codex GPT‑6.1 Sol；按依賴逐項完成。此文件是實作交接計劃，並非已部署或已驗收證明。

**Goal:** 恢復 28Hse 每日全量採集、差異匯入、合資格上架及首頁最新放盤；完成 Property.hk EPS／EPT／EPW 正式接入；提供可操作的同步監察、失敗恢復及撤盤核實。

**Architecture:** 延用 Python 採集、不可變 request／receipt、Node ingestion、Neon canonical inventory、Vercel Blob 圖片及既有公開查詢。GitHub Actions 負責排程及分階段執行；原始證據保存在私有目的地。Property.hk 在獲准資料入口及真實解析驗證完成後獨立啟用，沿用既有 `branches:EPW,EPS,EPT` 完整基準，不另建重複樓盤資料庫。

**Tech Stack:** 現有 TanStack Start／React 19／TypeScript／Vite／Nitro；Neon raw SQL；Python＋BeautifulSoup；Node `.mjs`；GitHub Actions。沿用 lockfiles；不改框架、不引入 ORM；Crawl4AI 僅在確有正常渲染需要及供應商允許時使用。

**Spec:** 使用者本次要求；`EarnestProperty_28Hse_Evidence_2026-10-01.zip`；PR #207；`docs/specs/28hse_propertyhk_scraping_merge_spec_no_hermes_v2.md`；`docs/deployment/property-sync-no-hermes.md`；`docs/deployment/property-sync-daily.md`；`docs/audits/EarnestProperty_Inventory_Freshness_Audit_2026-10-01_zhHK.md`。實作開始時核對最新 `CLAUDE.md`／`AGENTS.md`。歷史文件的日期、排程及啟用狀態不能蓋過當前程式、正式 receipt 或新的實測。

## 0. 已核實起點與證據

2026-10-01 香港時間約 11:25 後查核：

| 項目 | 已核實狀態 | 實作含意 |
|---|---|---|
| Repository | https://github.com/YNWAforever/earnestproperty | 只在此 repo 實作 |
| main | `e8997f290045fde37625be99863d803f4f72c7b5` | 開始時重新核對，不強行重設其他人更新 |
| PR #207 | open、draft、未合併；head `1e2a3459691fc06ba0deb8b09cf8dd5f57a2fcd0` | 延用已有修正，避免重寫／重複 cherry-pick |
| 主分支 workflow | `Property collection on demand`；只有 workflow_dispatch | 有檔名 daily 並不等於有每日排程 |
| PR #207 workflow | 20:17 UTC，即香港 04:17；仍有啟用 gates | 合併到預設分支及操作配置後才會每日執行 |
| 28Hse 生產來源 links | 356；唯一來源為 `28hse_agent_540` | 不是 356 個公開物業；不可混淆統計單位 |
| 最近接受完整基準（先前 read-only 核對） | 2026-09-24T21:45:54.42192Z，279 個廣告 | 重新查證；不可拿 dry-run 冒充 production baseline |
| Property.hk 生產 | 0 個 source links，無啟用 policy | API／schema 存在不代表正式接通 |
| Property.hk adapter | branch_urls、selectors、id_scope 等未填妥；僅 synthetic coverage | 必須用真實獲准來源驗證 |
| Property.hk 存取 | 已有 detail 請求 403 安全驗證頁證據 | 不能當空盤源；也不能推論所有獲准部署環境都不可用 |
| 自動發佈 | `daily-publication.mjs` 限定 28Hse；每次最多嘗試 20 個 draft、36 小時新鮮度 | Property.hk 不能只改開關，必須補齊發佈及媒體規則 |

### 0.1 ZIP 必讀與完整性

- ZIP：`EarnestProperty_28Hse_Evidence_2026-10-01.zip`
- ZIP SHA-256：`5f05410bb34fd9d0d44877b31ea25eb8aea379c0f816dbb2308e3bf2787b8745`
- request：`collection/snapshots/28hse/agent-540/2026-10-01/5163860d-1a4b-4261-8afb-3efe909a2c11/request.json`
- request SHA-256：`b458d085b60aeb241006daf0f11919a54a5e9ef490528854b594d522cac3bd55`
- 先讀 `audit/collection-summary.json`、reconciliation CSV、before-state；raw HTML 僅按指定錯誤／樣本讀取，避免將 100MB 級 raw evidence 放入模型上下文。
- ZIP 含盤源聯絡資料；不得提交至公開 GitHub、公開 release、公開 artifact 或瀏覽器 bundle。
- 採集開始約 01:56:32Z，完成 `02:50:22.963602Z`，約 54 分鐘。ZIP 的 `collection-timing.json` 中 43.6 分鐘是過程中觀測值，不能當成最終耗時。

| 計數 | 實測 | 正確解讀 |
|---|---:|---|
| unique advertisements | 286 | 售 226、租 60；不是 286 個唯一實體物業 |
| source lifecycle | active 284、explicit delisted 2 | 明示售出來源不等於已記錄內部成交 |
| page results | 22；failed 0；rejected 0 | 本次本地 full gate 通過，未等於正式匯入成功 |
| 新來源 IDs | 46 | 不等於 46 個新物業或應全部新增公開盤 |
| historical active missing candidates | 132 | 僅供核實，NOT_APPROVED；不得直接批量下架 |

指定驗收樣本：4033913 → A072390（黃金海灣珀岸）；4034357 → B059410（THE CARMEL）；4034591 → A057717（上源）。當前來源可能已變更：離線回歸必須包含三者；正式上線以新鮮來源狀態決定，不得強迫已撤盤樣本重新上架。

## Global Constraints

1. Scope：本次只處理盤源同步、發佈、首頁最新排序、同步後台及撤盤核實；不要順手修改 CRM／WhatsApp／影片 cron，亦不要發送真實訊息。
2. 現有 canonical properties、UUID、公開 listing number、source links、員工覆寫及欄位 provenance 必須保留；禁止 truncate／重建 inventory／整批重配 ID。
3. `property_source_links.status` 是關聯審批狀態（proposed／active／rejected），不是廣告 lifecycle；不能寫 `delisted`。來源 lifecycle 在 `mls_source_state.source_status`。
4. `publish_enabled` 是 ingestion 寫入授權，不等於 draft 公開發佈完成。收集、接受、上架、首頁可見必須分開計數及驗收。
5. 每一來源只有一個 canonical writer；跨來源 canonical 更新沿用 `earnestproperty:mls-sync` lock、server policy 及 staff overrides。不要重新啟用 retired systemd／舊 Cloudflare writer。
6. source identity 不能僅憑標題／同名員工／模糊地址／公司盤號猜測。28Hse 延用已批准 company-number 規則；Property.hk 延用 exact-unit 規則直到有独立真實證據支持變更。
7. 對 403、登入頁、CAPTCHA、timeout、DOM 變更、分頁不完整、可疑空頁／大幅跌幅一律 fail closed。不可換代理、隱藏指紋、複製 challenge cookies 或繞過驗證。
8. 所有 DB 測試在經核對的 disposable branch；不得把 destructive fixture suites 指向 production；skip 必須報 SKIPPED，不能算 PASS。
9. GitHub／Vercel／DB secrets 使用受管理環境；不進命令參數、公開 log、HTML、repo。HTTP 接口保留認證、origin 限制、payload size 及 idempotency。
10. 本計劃預設香港時間；原始紀錄用 UTC timestamptz，UI 顯示 Asia/Hong_Kong。自行排程每天約 04:17，不承諾準點 SLA。
11. 用版本化 migration／policy 做變更。不要直接改已被 receipt 引用的 parser／policy，也不要假設換 policy_version 無需 schema／contract 相容更新。
12. 當 Property.hk 外部存取受阻，繼續完成 28Hse 及可驗證的程式部分；將其標為 BLOCKED_EXTERNAL，不冒稱全案完成。

## Review Focus

- 收到 DB commit timeout 後重試：查 receipt，再用同一 bytes／hash 重播；不重複建盤或進基準。（T3、T4）
- 來源只有其中一分行成功、終頁重複或廣告同時售租：不可漏盤／錯當全量成功。（T7）
- 多分行重複廣告及多來源同一實體物業：不把數量膨脹當新盤，不讓價格／狀態跨租售污染。（T8）
- 排程完全沒有開始、人工取消、無權讀取 private evidence：也要在後台顯示失效，不只監察 success/failure callback。（T2、T9）
- bulk 預覽後有人更新盤源／人工覆寫：必須拒絕過期操作，不能根據舊差異下架。（T10）

## 1. 分批交付與依賴

- **交付 A／28Hse 恢復：** T0 → T1 → T2 → T3 → T4 → T5 → T11-A。先完成此生產旅程，不等 Property.hk。
- **交付 B／Property.hk：** T6 → T7 → T8 → T11-B。重用 A 的採集／證據／提交契約。外部存取可能阻塞 T7 真實驗收，但不阻塞 A。
- **交付 C／SME 操作及撤盤：** T2／T3 的事件契約 → T9；T7／T8 的來源一致性 → T10 → T11-C。
- 本機從已合併 main 或 PR #207 可用 head 建立隔離 feature branch；明確記錄 ancestry。保留 PR #207 已有 homepage／privacy 修正。後續可分 PR，但不得讓互相依賴的新 workflow 提早上線。
- 整體狀態只有在 A/B/C 各自 live acceptance 完成後才能寫 COMPLETE；可分別報 A LIVE、B BLOCKED_EXTERNAL、C READY。

## 2. 檔案責任與介面契約

以下 `Create` 是擬新增路徑，不代表現有實作；若最新 repo 已有同責任模組，擴充它並在交付紀錄列明替代路徑。

| 範圍 | 現有主要檔案 | 擬新增／擴充責任 |
|---|---|---|
| 排程 | `.github/workflows/property-sync-daily.yml`、`scripts/property-sync/daily_artifacts.py` | 分 jobs、來源隔離、跨 job evidence manifest |
| 採集 | `scripts/property-sync/scraping/worker.py`、`run_28hse_sync.py`、`run_propertyhk_sync.py` | durable checkpoints、分行驗證；採集不得持 DB credentials |
| 恢復 | `replay_28hse_sync.py`、`sync_propertyhk.py`、`scripts/mls/apply-source-snapshot.mjs` | bytes-preserving replay、receipt 對帳 |
| 發佈 | `src/lib/mls/daily-publication.mjs`、`scripts/mls/publish-daily-listings.mjs`、`scraping/publication.py` | source-aware publication、eligible draft backlog |
| Canonical | `ingestion-contract.mjs`、`ingestion-repository.mjs`、`source-snapshot-gates.mjs`、`source-selection.mjs` | 來源規則／完整性／多分行不衝突合併 |
| 首頁 | `src/lib/queries.ts`、`src/lib/neon/public-data.ts`、`public-data.server.ts` | 延用 PR #207 newest 排序 |
| 後台 | `src/components/admin/AdminShell.tsx`、`src/routes/admin.listings.tsx` | 新入口「盤源同步」，樓盤管理連到來源詳情 |
| 新：run contract | `src/lib/mls/sync-run-contract.mjs` + `.d.mts` + `.test.mjs` | 同步階段狀態、計數及公開錯誤碼 |
| 新：checkpoint | `scripts/property-sync/scraping/checkpoint.py`、`tests/test_checkpoint.py` | 原始回應／進度分段落盤、原子 final manifest |
| 新：run persistence | `src/lib/mls/sync-run-repository.mjs` + tests；新 timestamp migration | additive run／stage／branch summaries；不複製 ingestion ledger |
| 新：admin boundary | `src/lib/neon/admin-property-sync.ts`、`.server.ts`、`.types.ts` | authenticated read／enqueue／review；既有 two-file pattern |
| 新：UI | `src/routes/admin.property-sync.tsx`、`src/components/admin/property-sync/PropertySyncWorkspace.tsx` + tests | 4 個來源卡、history、問題列及受權操作 |
| 新：withdrawal review | `src/lib/mls/withdrawal-review.mjs` + tests | pending evidence、版本化 preview/apply；重用現有管理服務 |

### 核心契約（新增部分需實作測試）

`SyncRunSummary`：`runId, source, scopeId, policyVersion, parserVersion, requestHash, gitSha, workflowRunId, startedAt, finishedAt, stages, branches, counts, errorCode, privateEvidenceRef`。

- `stages`：collection／ingestion／publication／verification；各自 `pending|running|succeeded|failed|blocked|unknown|cancelled`、時間及錯誤碼。ingestion succeeded 必須有有效 receipt；publication succeeded 不代表所有盤已公開，held 數需顯示。
- `counts`：`advertisementsObserved, sourceIdsNew, canonicalCreated, canonicalUpdated, published, held, withdrawalCandidates`。actual-write 數字取 receipt／transaction，dry-run 的寫入數必須為 0。
- `branches`：EPW／EPS／EPT 各自 pagesExpected（若來源有提供）、pagesRead、terminalVerified、observedCount、failedCount、lastSuccessAt。display 三分行，但 canonical scope 保持既有合併 scope。
- `privateEvidenceRef` 只含受保護 object／asset 識別，不輸出 signed URL 或 credentials。
- `RunManifest v1`：`runId, source, scopeId, collectedAt, parserVersion, policyVersion, gitSha, request {key,sha256,bytes}, raw {key,sha256,bytes}, gate {allowed,full,reasons}, branchSummaries`；只接受符合 schema、size、hash、source/scope 的資料。
- 擬新增純函數 `deriveSyncHealth(summary, now)`：`never_synced|healthy|running|stale|failed|blocked|unknown`。30 小時沒有 accepted full ingestion 即 stale；從未啟用來源顯示「未接通」，不捏造最後成功時間。發佈時間獨立显示。
- 擬新增 `previewWithdrawals({source, scopeId, candidateIds, actor}) -> {previewId, expiresAt, rowVersions, rows, blocked}`；`applyWithdrawalPreview({previewId, selectedIds, expectedVersions, idempotencyKey, reason, actor}) -> perItemResults`。服務端重驗權限、選取子集、source state、staff override、有效期與 receipt。

## T0. 鎖定起點及重現現況

**Files:** Read CLAUDE／現有 specs／ZIP／PR #207；Create `docs/reports/2026-10-01-full-sync-implementation-status.md`（只放非敏感摘要）。

**Consumes:** 此計劃及 evidence ZIP。**Produces:** commit／環境／證據矩陣、實際 rollout blockers。

- [x] 核對 repo remote、main、PR head／merge 狀態；確認 workspace 無未保存改動。讀最新 instructions，不覆蓋別人工作。
- [x] 安全解壓 ZIP：拒絕 traversal、symlink、超大展開；驗 SHA-256。定位 summary／request，不先重新跑 54 分鐘爬取。
- [x] 用 read-only SQL 核對 policy、scope receipt、source counts、draft backlog、staff overrides；查目前 schedule／最近 run。報表不含 secrets／原始聯絡人。
- [x] 在乾淨環境執行既有相關單元測試，記錄 baseline failures 與所用 commit；本步不產生業務写入。
- [x] 提交狀態文件；將「程式已有／離線測試／live source verified／production accepted」分欄。

## T1. 私有證據及正式基準配置

**Files:** Modify `daily_artifacts.py`、`docs/deployment/property-sync-daily.md`、`tests/test_daily_artifacts.py`；新增 manifest schema／驗證 helper 可置於同目錄。

**Consumes:** RunManifest v1、已接受 receipt。**Produces:** 有 hash 的私有 evidence handoff，正確恢復 baseline。

- [x] 先加失敗測試：公開 destination 被拒；缺 request／raw／錯 hash／錯 scope／過期 parser／偽造 receipt baseline 被拒；private evidence token 無權限回報明確 code。
- [ ] 保留 PR #207 的 `PROPERTY_SYNC_EVIDENCE_REPO`／`PROPERTY_SYNC_EVIDENCE_TOKEN` 支援；確認 destination private、release 存在、必要 read/write 權限可用。使用最小權限服務憑證，不輸出值。
- [x] metadata 包含精確 request/raw bytes hash；凍結前不允許 ingestion。archive 暫存寫完 fsync／rename 後才標 ready；upload 後驗 object hash／size，不把半檔當成功。
- [x] latest baseline 必須與 DB current full receipt 的 source/scope/policy/parser/hash 一致；若 DB 已有 baseline 而私有檔案遺失，進 recovery，不可 bootstrap 蓋過它。
- [x] 保留 current baseline／未解決 request receipts；raw 7 日、compact 90 日作為起始 retention，另對 release assets 實作清理及 pinned exception，不能誤以為 Actions retention 會刪 release。
- [x] 執行 `python -m pytest scripts/property-sync/tests/test_daily_artifacts.py -q`；通過後提交 `fix(sync): verify private evidence and accepted baselines`。

## T2. 分階段排程與可恢復採集

**Files:** Modify `.github/workflows/property-sync-daily.yml`、`worker.py`、`scripts/property-sync-daily.test.mjs`；Create checkpoint module/tests、sync-run contract/tests。

**Consumes:** T1 manifest。**Produces:** durable collection output、分階段 run summary。

- [x] 先加失敗測試：collection 無 DB／Blob secret；ingestion/publication 無 source fetch；collector 中途終止仍保留 raw checkpoint，但 full=false；重複 invocation 不並行。
- [x] 把 workflow 拆成 preflight → collect（120 分鐘）→ ingest（20 分鐘）→ publish（45 分鐘）→ verify/report（10 分鐘）；這是初始每 job 上限，首 3 次實測再調校，不是 SLA。
- [x] workflow-level concurrency 覆蓋整條 source/scope 工作；28Hse 與 Property.hk 独立組，canonical DB 仍用共用 writer lock。不要以每 job lock 取代全 run 防重。
- [x] collect 逐頁／逐 detail 原子保存原始回應和進度，受既有 delay/robots/limits 約束；不在結束時才一次寫全部 raw。失敗／取消時以 always/best-effort 上傳 checkpoints；硬終止未上傳部分需標缺證據。
- [x] checkpoint 僅保存調試與本 run 恢復證據；不能把昨日頁面混入今日 full snapshot。不同觀測時間的拼接不得產生 absence-eligible full baseline。初版失敗 collection 可重新採集；下游失敗只重播 request。
- [x] 只有收集 full gate 通過、request及raw已私有持久化、manifest核對通過才啟動 ingestion；partial／blocked 不進寫入。
- [x] 保留 shadow／apply／replay-shadow／replay-apply；新增「只重試發佈」獨立入口，驗 accepted current receipt及freshness，不能重新爬取或更改時間戳。
- [x] 正式排程沿用香港 04:17；Property.hk 未 ready 時停用其 schedule。新增每日香港 08:15 read-only watchdog：即使主 job 根本未開始也記錄 stale/overdue；外部訊息渠道未另獲授權前只做內部提示／既有授權渠道。
- [x] 跑 `node --test scripts/property-sync-daily.test.mjs src/lib/mls/sync-run-contract.test.mjs` 及 checkpoint pytest；核對真實 job 權限／handoff，不只做 YAML 字串測試；提交。

## T3. 安全匯入、receipt 對帳與跨 job replay

**Files:** `replay_28hse_sync.py`、`sync_propertyhk.py`、`apply-source-snapshot.mjs`、`ingestion-service.mjs`／`ingestion-repository.mjs` 及對應 tests。

**Consumes:** T1 frozen manifest。**Produces:** immutable receipt、actual-write counters、accepted full baseline。

- [x] 先加測試：相同 request 重播兩次只產生一次業務效果；DB commit 已成功但回應 timeout 時進 unknown/reconcile；錯 DB host／scope／policy在寫入前拒絕。
- [x] 先執行 `verify-daily-target.mjs`，只允許已核實 direct host＋database；不用從輸入 payload 或 UI 任意指定 database。
- [x] 由 exact frozen request 產生／找回 receipt；timeout 查 hash/run identity 再決定重播，不建立新的爬取 run 來掩蓋結果未知。
- [x] baseline 只有 accepted full receipt 可推進；不倒退、不從 publication 成功推定 ingestion 成功。私有 baseline upload 失敗時標「已匯入／紀錄保存待恢復」，下一步先對帳。
- [x] 验證 source ID、canonical identity、field provenance、staff override 保持；新來源與現有盤相配時不重建物業。
- [x] 跑 `npm run test:property-sync`、`npm run test:property-sync:python` 及 disposable DB 的 `npm run test:property-sync:db`；記錄 PASS／SKIPPED；提交。

## T4. 28Hse 發佈恢復及 backlog

**Files:** `daily-publication.mjs`、`publish-daily-listings.mjs`、`publication-media-retry.mjs`、相應 publication tests。

**Consumes:** T3 current accepted full receipt。**Produces:** publication report／ready／held／alreadyPublic，以及可重試發佈。

- [x] 先加測試：已公開不重複；媒體上传中斷可復用已验证資產；大於36小時或非current receipt拒絕；重新 ingestion 後不能套用舊發佈結果。
- [x] 預設保留每次20個「嘗試」上限；顯示 eligible backlog／最舊等待時間／held原因。每日選取使用穩定排序，已知 held 有原因可追蹤，避免一批永遠餓死後面。
- [x] 初次46個新source IDs先做canonical reconciliation，不能迴圈強行全部公開。若需加大daily budget，另列量化實測、媒體配額及可review的配置變更；不能暗中移除20個cap。
- [x] 重試發佈仍驗description、estate、金額／面積、source URL、owned media、manual edits和source conflicts。現有內容需review的限制不能為三個樣本隨便關掉。
- [x] 失敗結果按盤顯示：「需補屋苑」、「圖片待核實」、「人工修改需確認」、「來源身份衝突」、「今日處理上限」；標示寫入成功但未公開。
- [x] 跑 `npm run test:property-sync:daily` 及 disposable `npm run test:property-sync:publication:db`；提交。

## T5. 首頁「最新放盤」及公開一致性

**Files:** 延用 PR #207 的 `queries.ts`、`public-data.ts`／`.server.ts`、`featured-promotion.contract.test.mjs`；必要時擴充 DB query tests。

**Consumes:** 已公開 canonical listings。**Produces:** 真實最新且穩定的首頁列表。

- [x] 先加有資料的排序測試：新廣告在舊廣告之前；每日 last_seen refresh 不 bump；proposed/rejected source link 不参与排序；同一盤重複廣告不吃掉所有6張卡；下架盤不可見。
- [x] 保留 newest 與 promotion 兩個模式；只有首頁最新放盤用 newest。confirmed active source links＋active source states 的 first_seen 排序；fallback created_at＋stable ID；canonical 去重與地域限制先於 LIMIT。
- [x] 若有 cache，沿既有 cache mechanism 實作發佈／下架後失效；不全站關cache或單純把「更新日期」換成現在。
- [x] 離線三樣本必須有mapping；live sample仍active且合資格則在listing/detail可查；首頁只要求在正確排序及展示數量下可見，不強制三者永久佔位。2026-10-02 fresh三樣本mapping核對；當前staff review/inactive/media held有實證原因，未強制公開。
- [ ] 跑 relevant listing-priority/search tests及typecheck；登入/preview受阻寫BLOCKED，不當UI pass。桌面＋手機核對照片、價錢、link與active filter；提交。

## T6. Property.hk 正式存取決策及分行登記

**Files:** `scripts/property-sync/config/sources.example.json`、`docs/deployment/property-sync-no-hermes.md`；Create `docs/reports/propertyhk-access-verification.md`（只含遮罩摘要／證據references）。

**Consumes:** 使用者三分行地址及provider可用方式。**Produces:** 明確驗證的 transport/config，或有證據的外部阻塞。

| Branch code | 分行 | 使用者提供地區參數 | 第一頁要求 |
|---|---|---|---|
| EPS | 麗都花園 | NTW | 原連結 p=9 必須改為經實測的第一頁，不可只抓第9頁 |
| EPT | 青龍頭村 | NTM | 驗證分頁起點、公司牌照及完整範圍 |
| EPW | 海韻花園 | NTW | 同上 |

- [x] 先檢查現有部署／營運文件及已授權connector，找provider feed、定時export、既有合作host或批准的crawler方式；不要要求重做已有功能，也不要假設存在公開API。
- [ ] 區分 `dt` 是代理目錄分類還是盤源filter，驗證它是否排除了分行其他地區樓盤；不得把使用者提供參數不經檢查當全分行inventory。
- [ ] 記錄供應商支援的入口、身份、配額、分頁、ID scope、更新時間、售租／撤盤語義；缺項先做能完成的28Hse工作，再一次列出最小外部需求。
- [ ] 原網址SID／query不能擅自去除：之前去SID跳到generic directory，不是成功。秘密／session只存受管理配置，不在公開repo保存；若SID是公開固定代理識別亦需由實證確認。
- [ ] 供應商允許靜態HTML則沿現有HTTP；支援feed/export則加相應adapter；只有正常頁面需要JS且獲准自動化時才加browser transport，保持origin/path/robots/size限制。
- [x] 403/challenge現場停在存取問題，與供應商處理allowlist／服務帳戶等正式安排，不以代理或挑戰破解解決。固定IP僅在供應商認可時使用，不把它當避封鎖手段。
- [x] 未驗證時維持 id_scope_verified=false、publish關閉；完成access report並提交。此步不聲稱live同步已完成。

## T7. 三分行真實解析、全量gate及scope隔離

**Files:** `worker.py`、新增 `scraping/propertyhk.py`（若適合抽出）、`tests/test_propertyhk.py`、sanitized fixtures、`ingestion-contract.mjs`、`source-snapshot-gates.mjs`、`daily_artifacts.py`及tests。

**Consumes:** T6實證輸入。**Produces:** source=propertyhk、scope=branches:EPW,EPS,EPT 的frozen完整request及branch summaries。

- [ ] 先從合法取得的真實sale／rent／dual-offer／無盤／終頁／已撤盤HTML或feed做去個資fixtures；synthetic tests標明用途，不能替代live證明。
- [x] 加失敗測試：EPS漏第一頁、EPT第二頁403、EPW重複分頁、缺牌照、generic directory、fake empty、ID跨分行碰撞、不同deal同ID、detail少一個、跌幅超過30%。全部不得成為full或absence eligible。
- [ ] source ID global/branch用供應商contract或跨分行樣本驗證；同一ID出現在三分行若有欄位衝突要保留branch provenance並進review，不用last-write-wins。
- [ ] 解析金額／萬／租金／呎價分開、面積單位、公司盤號、樓層與exact unit、來源更新時間、圖片及聯絡人；未知值null，不猜單位／成交日期。dual-offer產生獨立sale/rent keys。
- [x] 逐分行從第一頁到已驗證終頁；保留獨立page/count結果。全部三分行完成才合成full；任何一行blocked，本輪不提交業務寫入，不推global baseline。
- [x] Generalize T1 evidence selection、latest／restore／baseline paths，按source+scope+policy+parser隔離；不能把28Hse的baseline灌入Property.hk。允許儲存分行checkpoint，不建立另一套canonical baseline語義。
- [x] Property.hk rate limit沿provider規則；預設慢速單request、最多既有3次可重試；401/403與challenge不可暴力重試。源資料消失不憑HTTP404單點自動下架。
- [ ] 跑new pytest、ingestion contract／gate suites；用真實三分行fresh dry-run驗完整性及count。拿不到live資料時此task live gate保持BLOCKED；提交可验证部分。

## T8. Property.hk ingestion、跨來源去重及發佈

**Files:** `propertyhk-http.mjs`／route、`ingestion-contract.mjs`／repository、`source-selection.mjs`、`source-contract.mjs`、`daily-publication.mjs`、media policies、tests、必要additive migration。

**Consumes:** T7完整request及T6版本化server policy。**Produces:** 已接受Property.hk來源資料，無重複canonical，合資格公開牌。

- [x] 先測同一實體跨三分行／跨28Hse、同盤售租、未知公司盤號、exact unit缺失、多secondary矛盾。現有 `source-selection.mjs` 對多個Property.hk secondary會ambiguous；不能直接移除保護。
- [x] 同global ID的同offer先在adapter依實證合併branch provenance；不同IDs但同canonical使用明確一致性判定，衝突交review。保持28Hse主要欄位優先及人工覆寫；在没有新規格批准前保持既有lifecycle優先策略。
- [ ] 建立/啟用Property.hk server source policy須有已验证URLgrammar、id_scope、parser、estate/district mapping與first baseline證據。來源帳號不由client payload聲稱即可通過。
- [x] 發佈函數改為source-aware：target SQL參數化source/scope；sourceURL identity、media host allowlist、media source codec、observation schema逐一確認支援propertyhk。不能只把 `batch.source !== 28hse` 判斷移除。
- [x] 圖片host僅加入實際驗證及可使用來源；防SSRF／redirect／MIME／size與owned-media檢查沿用。零圖片／缺內容盤進held，不造描述或取錯分行圖片。
- [x] Property.hk已有28Hse同盤不新增公開牌；補充欄位遵守既有優先規則。新Property.hk-only盤通過public prerequisites後才能上架。
- [x] 用disposable DB做first import→replay→publication→next ingestion全鏈；驗唯一盤、public alias不變、照片不重覆上傳、staff overrides保持。
- [ ] 首次live apply檢查receipt及逐分行source counts；再加入獨立schedule（建議香港05:17，限T11-B gate通過後），不得改動28Hse正常排程；提交。


## T9. 後台「盤源同步」與看得見的故障

**Files:** 新增檔案見第2節；Modify AdminShell／樓盤管理；擴充existing ops jobs或提供server-only workflow dispatch adapter（確有缺口才新增）；additive run metadata migration。

**Consumes:** SyncRunSummary、receipts及publication report。**Produces:** staff可理解的read模型、admin受控操作及staleness。

- [x] 先寫health與RBAC測試：never synced／30h stale／partial/blocked／unknown／cancelled；讀取失敗不能顯示0盤成功。新run事件不能倒退terminal state。
- [x] Dashboard 4張卡：28Hse、EPS、EPT、EPW。主資訊為狀態、最後成功採集／匯入／公開時間、盤數與變動；全站Property.hk只有三行全部完整才標整體成功。
- [x] Run detail顯示4階段、page progress、actual writes、held、重複／conflict與簡單補救步驟；技術IDs和證據references收在展開區。
- [x] Exact UI copy：「同步失敗，保留現有資料」、「已匯入，部分樓盤待上架」、「等待核實，暫不下架」、「從未成功同步」、「結果待核實，請勿重複提交」。
- [x] 讀取admin/manager；agent只可在既有樓盤權限範圍看來源時間。啟動run／replay僅admin；review/publish可admin/manager但需逐盤existing authorization。前後端同時檢查，route存在不等於授权。
- [x] 「立即同步」只enqueue／dispatch allowlisted workflow+source+main，不在web request執行長爬蟲。使用具workflow-only權限GitHub App/managed token；server allowlist、run dedupe、限流、審計。無provider capability時明確禁用並顯示配置項，不造假成功toast。
- [x] 「重試匯入」／「重試上架」分開，exactrequest manifest由server選；禁止使用者提交任意URL、shell、branch、DB或payload hash當權威。
- [x] 來源變量／憑證／開關放「進階設定」且不顯示secret；普通員工不用輸入policyVersion／Inbox等不相關technical IDs。
- [x] API用bounded pagination（預設25、上限100）、必要indexes及aggregate summaries，不在頁面掃raw HTML；基於現有schema做EXPLAIN，記錄資料量與p50/p95，避免無測量承諾。
- [x] 加desktop/mobile UI journey tests：第一次／loading／empty／denied／failure／retry／doubleclick／longhistory；query及RBAC用integration驗證，typecheck；提交。

## T10. 撤盤候選、批量核實及安全下架

**Files:** Create withdrawal-review及tests；Modify existing admin-property-management／bulk service、source-snapshot-gates／source-selection（僅必要明確policy變更）、new additive review metadata migration。

**Consumes:** fresh complete source receipts、canonical/link versions、人工覆寫。**Produces:** 可追溯候選、不可重複套用的bulk結果與可復原操作。

- [x] 先測：ZIP132 candidates只建立review候選，actual下架0；兩次完整觀察之間有failed run不算缺席證據；missing一個廣告而另一current來源仍活躍不能自動判死整個盤。
- [x] 明示撤盤與「未再看到」分開。absence候選預設需同scope兩次完整成功快照、相隔至少24小時均未出現；這是本計劃建議的新增保守規則，需版本化實作，並非現有功能。
- [x] 原生Property.hk absence gate目前永遠off；不能只翻config。先上candidate review，正式source lifecycle automation另經rule版本、測試及live基準驗收後才可啟用。
- [x] 歷史132不在previous baseline時，現有absence演算法未必會碰到；做獨立historical reconciliation流程，顯示before/current source evidence、canonical links、人工状态、其他來源及原因。
- [x] 多來源狀態相反（現有28Hse primary撤盤可能令canonical inactive，即使Property.hk active）要明確顯示conflict並人工核實；本次不能暗改成「任一來源active即上架」。若業務決定改policy，另做版本化decision table與rollback證據。
- [x] Bulk流程：filter→explicit選擇（上限100）→preview→逐盤允許/blocked原因→確認reason→apply；預覽15分鐘有效、expectedVersions及服務端重查。agent不可對全公司批次操作；不能「全選所有」暗含未載入盤。
- [x] 保留properties及aliases，只透過既有管理服務設inactive；保持人工鎖定／持續覆寫語義，避免下一次sync又上架。被保護／衝突盤不能透過此流程繞過保護。
- [x] 每項記錄actor、reason、source evidence、before/after/version、batch/idempotency；partial failure可逐項重試。復原是新審核操作，重查source/staff changes，不能無條件restore舊快照。
- [x] 測stale preview、兩個manager競爭、來源剛重新上架、重播duplicate、partial failure、role escalation、draft誤當active；disposable DB確認public query下架後不可見；提交。

## T11. 分批正式上線、驗收及回退

**Files:** Update deployment docs／status report；Create `docs/runbooks/property-source-daily-recovery.md`、`docs/reports/2026-10-01-full-sync-acceptance.md`。

**Consumes:** 各task通過的程式和source evidence。**Produces:** per-source live acceptance及操作手冊。

- [x] T11-A：review PR #207與後續依賴、CI、DB migrations target、private evidence、managed secrets與現有production baseline；先完成必要read-only及rehearsal。merge/deploy/正式啟用依當時使用者授權與平台門檻執行，不以此文件假裝已獲所有production權限。
- [x] 同一fresh28Hse run走 collect→freeze→ingest→publish→public verification；記錄exactcommit、runURL、hash、receipt、actualcounts及首頁screen evidence。不拿過期ZIP改scraped_at作新live資料。2026-10-02授權本機operator UUID fd5cb539-8d7f-4854-a801-0329d16e5f87，native runURL無；281ads→22created/6changed→14published offers/13aliases，desktop/mobile及14detail photo tabs PASS。Managed hosted/scheduled gate另仍未通過。
- [ ] T11-B：三分行存取與parser已verified後，disposable rehearsal→firstfullapply（absenceoff）→publication→publiccheck→schedule；外部未ready則此段BLOCKED_EXTERNAL，28Hse可先LIVE。
- [ ] T11-C：dashboard可讀live receipts／backlog；admin可受控retry；withdrawal先人工review模式；至少兩次fullfresh觀察及policy驗收後才考慮自動source absence。
- [ ] 證明至少一次manual end-to-end及其後3個實際scheduled daily cycles；失敗應有可見狀態及恢復結果。3日未走完報MONITORING，不提前寫「穩定每日同步」。
- [x] Drill：ingestion回應未知→receipt對帳；publication中途失敗→只重試發佈；一個Property.hk分行403→global無新full baseline／無下架；超30h無成功→UI stale。
- [x] Rollback：按source停新增schedule/apply，允許已開始transaction完成並對receipt；停publication／absenceautomation；保留history、media、IDs、policies與currentbaseline。錯誤data以reviewed compensating mutation修正，不刪ledger、不直接啟舊writer。
- [x] 交付每個PR、migration、正式配置names（不含values）、tests/skip/block、source counts、未完成外部事項、回退命令與owner。編寫5步SME手冊：睇狀態→睇待處理→重試階段→核實撤盤→查看紀錄。

## 3. 最低驗收矩陣

| Case | 操作／情境 | 必須結果 | 層級 |
|---|---|---|---|
| A01 | ZIP相同request重播2次 | canonical/write無重複、receipt可對帳 | disposable DB |
| A02 | source fetched success、publication fail | UI分開顯示；只retry publish，無再次採集 | workflow＋UI |
| A03 | collection中途被取消 | raw checkpoints可查；非full、不下架 | process failure |
| A04 | wrongscope／hash／DB host | 寫入前拒絕 | unit＋integration |
| A05 | main無schedule／30h未成功 | overdue/stale可見，不能healthy | schedule＋health |
| A06 | 三指定28Hse樣本 | 離線mapping正確；live依當前資格公開/held有理由 | fixture＋live |
| A07 | routine last_seen refresh | 首頁排序不被洗牌 | DB query |
| B01 | 三分行全pagination正常 | 3/3complete＋唯一合併scopefullreceipt | fixture＋live |
| B02 | EPS從9頁起或任一分行blocked | 不接受完整基準、不推missing下架 | gate |
| B03 | 同ID跨branch／同盤售租 | 按已驗證IDscope，無wrongmerge／sale-rent混淆 | parser＋DB |
| B04 | 多Property.hk secondary衝突 | review有原因，不能last-write-wins | reconciliation |
| B05 | 28Hse＋Property.hk同物業 | 唯一canonical／publicalias，priority及staffoverride保留 | DB |
| B06 | Property.hk-only新盤 | 入庫與發佈均有receipt／report；驗圖片與URL | end-to-end |
| C01 | ZIP132歷史缺席 | 只review，沒有自動批量inactive | DB |
| C02 | 403／fakeempty／drop>30% | nofull／nodownlisting；UI明確失敗 | gate＋UI |
| C03 | bulkpreview後source更新 | 過期或versionconflict拒絕，需重新preview | concurrency |
| C04 | 同batch重送或部分失敗 | 不重複效果、逐項結果、重試安全 | DB |
| C05 | 非授權角色／偽造dispatch參數 | 403／validationerror，無job、無secret外洩 | security boundary |
| C06 | 新員工手機看同步 | 無需技術ID，知上次成功、問題與下一步 | UI journey |

## 4. 驗證指令與證據要求

先讀 `package.json` 確认最新runner，以下為此計劃查核時的實際命令；新增tests需接入CI，不只在本機跑。只跑改動涵蓋的集合及必要整合門檻。

```bash
npm run test:property-sync
npm run test:property-sync:python
npm run test:property-sync:daily
npm run test:listing-priority
npx tsc --noEmit
```

在明確核對的disposable test branch注入既有test env後：

```bash
npm run test:property-sync:db
npm run test:property-sync:publication:db
```

新設checkpoint／propertyhk／admin／withdrawal suites依task加入實際CI命令。不得用「沒有npm test」作為跳過驗證理由。UI以repo既有browser測試工具建立journeys；預覽登入牆需合法登入，不能把blocked當pass。

每次測試記錄command、commit、time、passed/failed/skipped及skip reason；每次live run記錄source/scope、request hash、receipt、publication report及UI結果。純字符串contract測試不等於DB／安全／live接入證明。

## 5. 外部依賴與停止條件

| 缺項 | 仍可完成 | 何時需要人手／供應商 |
|---|---|---|
| 私有evidence destination未配置 | workflow/helper/tests與具體配置清單 | 有權操作帳戶者建立private destination及最小權限credential |
| GitHub Actions vars/secrets管理權限不足 | PR、CI、reviewable配置與runbook | 最後啟用步驟列精確names及原因；不要求把secret貼chat |
| Property.hk拒絕當前存取 | 28Hse完整交付、API/schema/fixtures原有回歸、dashboardblockedstate | 供應商確認支援入口／allowlist／serviceaccount；不能編造真實selectors |
| 無正式UI登入 | code/DB/API非互動驗證、測試環境journeys | 正常登入完成productionUI驗收 |
| DB receipt與私有baseline不一致 | read-only對帳及recovery方案 | 恢復正確evidence後再啟用；不可強制bootstrap |

不要因單一外部依賴就停止整個repo實作；也不要把未完成的live來源列為DONE。需要使用者處理時，一次提供具體阻塞、已完成部分及最小必要輸入。

## 6. Codex 最終回報格式

1. PR/commit與變更目的。
2. 分別報28HSe、EPS、EPT、EPW的程式／存取／採集／匯入／發佈／scheduled驗證狀態。
3. 改了甚麼、為何、測了甚麼；列SKIPPED/BLOCKED，不偽造PASS。
4. 最近成功時間、advertisement與canonical分開的counts、backlog及withdrawalreview數。
5. 正式環境確實做過的操作與尚待完成條件；不以PR merged推論live部署已更新。
6. 回退方法；raw evidence保持私有。

## References

- PR #207：https://github.com/YNWAforever/earnestproperty/pull/207
- Repo：https://github.com/YNWAforever/earnestproperty
- Public site：https://earnestproperty.vercel.app/
- GitHub schedules（只在default branch執行、可延遲）：https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Property.hk服務背景（不是晉誠API已存在的證明）：https://www.property.hk/profile.php

本計劃已以程式、GitHub PR狀態及ZIP內容核對；本次只交付計劃，未merge、部署、開啟排程或更改正式樓盤。


### 2026-10-01 execution gate notes

T5 offline three-mapping/query tests PASS; its live detail/mobile-photo checks remain unchecked. T7 synthetic/Neon parser/gate suites PASS; real source HTML/contract/fresh3branch dryrun remains BLOCKED_EXTERNAL. T11 checked items denote read-only/rehearsal and prepared reviewable code/runbooks only; fresh production E2E, live dashboard, Property.hk firstapply and3scheduledcycles remain unchecked. See19case acceptance report, with blocked cases retained in denominator.

### 2026-10-02 fresh manual recovery evidence

See docs/reports/2026-10-02-homepage-stale-recovery.md: T5/A06 fresh mapping and current held decisions verified; T11-A manual same-request full chain PASS. Native daily remains PAUSED/MONITORING0/3; managed token, PR211 reviewed merge and hosted shadow remain gates. T11-B/C and authenticated role checks remain BLOCKED; no production withdrawal/messages or new migration.
