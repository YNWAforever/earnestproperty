# YouTube 修復驗證記錄 — 2026-10-16

本輪完成本機 source 修復、隔離測試及獨立 review；正式環境沒有套用本輪變更。
修復分支為 `codex/youtube-daily-sync-20261016`，base 為
`a9533a58c7dc9ee007986abe4aeb527125d6c692`。修復 commit 以包含本文件的本機 Git
版本為準；沒有 push、merge、deploy、啟用正式 cron、付費 API 呼叫或正式資料寫入。

## 現況與根因

- 起始與交付前的遠端 main 均為 `a9533a58`；交付前沒有開啟中的 YouTube 修復 PR。
- 唯讀 Vercel metadata 確認 `www.earnestproperty.com` 對應正式
  `dpl_ArxnwFDy5mVwmfmbBtQZqKbrEtxU`，source 同為 `a9533a58`。
- `efd0c912`（2026-09-25）移除每日增量及每月完整同步；base 的 `vercel.ts`
  仍為 `crons: []`。這是停止自動更新的直接根因。
- 2026-10-16 約 19:00 HKT 的公開 loader 有 135 個唯一影片 ID，最新發布時間為
  2026-09-24T08:31:14Z。頻道 videos 首頁 30 個、Shorts 首頁 14 個及 RSS
  15 個結果，交叉確認 14 條一般影片及 1 條 Short 未出現在公開列表。
  沒有宣稱缺 20 條、完整頻道覆蓋或 15 個必定新增的 DB rows。
- 既有增量以 YouTube ID 截止，沒有日期截止。新程式允許已核准 staff 請求帶明確
  `backfillVideoIds`，補查 cutoff 後的指定較舊 ID，不轉成 full reconciliation。

操作方式、配額公式、回復及正式批准步驟見 `docs/youtube-sync-operations.md`。

## 最終驗證

主要本機測試與 build 使用不帶 DB URL／provider key／token 的 OS allowlist 子程序環境；額外 CI 接線 contracts 只讀 source。
沒有 `.env`、`.env.local` 或 `.env.production`。瀏覽器只允許 loopback；
實際 YouTube iframe、圖片與其他外部請求均中止。

| 實際指令／檢查                                                                                                                                                                        | 最終結果                                 | 證據限制                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `npm run test:youtube-sync`                                                                                                                                                           | PASS：107 Bun + 12 Node，0 fail / 0 skip | mock provider、離線 CLI、記憶體 PGlite                       |
| `npm run test:videos`                                                                                                                                                                 | PASS：113，0 fail / 0 skip               | 現有影片呈現、描述、分類及 route contracts                   |
| `npm run test:youtube-sync:ui`                                                                                                                                                        | PASS：36，0 fail / 0 skip                | 真實 route/component，合成 loader／router 邊界，桌面＋390px  |
| `node --test src/routes/control-plane.routes.test.mjs src/lib/http/bearer-secret.test.mjs src/test-wiring.test.mjs scripts/vercel-config.test.mjs src/lib/http/public-cache.test.mjs` | PASS：49，0 fail / 0 skip                | 排程／認證／cache／CI 接線 contracts                         |
| `node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/neon/data-hygiene.owned.db.test.mjs`                                                                       | PASS：21，0 fail / 0 skip                | 已驗證的新 disposable Docker，套用現有 migrations            |
| `npm run typecheck`                                                                                                                                                                   | PASS                                     | 最後產品 TS／TSX 與 e2e                                      |
| `node node_modules/typescript/bin/tsc --project .audit/youtube-cli-tsconfig.json --noEmit`                                                                                            | PASS                                     | 臨時 config extends 專案 strict config，額外涵蓋 CLI         |
| `npm run lint`                                                                                                                                                                        | PASS：0 errors，9 個既有 warnings        | 新增 fixture scoped lint 亦為 0 errors / 0 warnings          |
| `npm run build`                                                                                                                                                                       | PASS                                     | 本機 bundle；沒有部署，保留既有 deprecation／bundle warnings |
| CI 新接線 contracts                                                                                                                                                                   | PASS：18（與上述 suite 有重疊）          | UI script 在現有 Chromium install 之後執行                   |

Docker context 先唯讀核對為 `desktop-linux`、
`npipe:////./pipe/dockerDesktopLinuxEngine`／`docker-desktop`。
既有 pinned image digest 為
`sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0`。
專案 harness 在建立 pg client 前，驗證新 container 名稱、相同 image digest、
動態映射且只綁定 127.0.0.1 的 port；不接受任何 DB URL，沒有 ambient fallback。
測試 mock 所有 provider fetch 並關閉 ops wake；harness 完成後停止自己的 container。
這與外部 Neon integration 分開，不是正式 DB 或 Neon runtime 驗收。

## 回歸與 review 修正

- 新片、Shorts、發布日期、超過 50 項分頁、穩定 ID、重跑／競爭 lease、
  無變更不改寫、暫時漏項不下架、401／403／quota／timeout／429、
  第二頁失敗不寫入、同一 SQL 失敗整體 rollback、有限重試及預算均有覆蓋。
- 狀態記錄重用 `ops_audit_logs`。失敗／部分完成／中斷不推進最後完整成功，
  未知失敗影片數保留 null；沒有 migration，也不記錄 provider error 原文或憑證。
- CMS 頁面及唯讀 server function 使用相同 `cms.publish` 權限；
  沒權限角色不會看到永遠失敗的重試面板。
- 獨立 review 的 P2 在實際 owned Docker suite 重現：
  舊測試要求相同增量必須改寫 updated_at。修正後無變更斷言維持不變；
  再加一輪 full bookkeeping 更新，保留「updated_at 變但 staff version 不變」
  及原有已開啟編輯頁可儲存的驗證。RED 的 2 個 failure 是該子測試及其父測試，
  GREEN 為 21/21，沒有削弱 staff 版本或儲存斷言。
- 獨立 review 的 P3 角色面板問題已修正；新增 contract 有 RED→GREEN 記錄。
- 瀏覽器 fixture 有日期排序錯誤、攔截被 catch 的 POST、移除 query alias 的
  intentional RED；還原後 36 項通過。沒有把 synthetic browser 當成完整 app SSR、
  真實 auth、DB query/cache 或正式 UAT。
- UI 使用獨立 `test:youtube-sync:ui`，CI 安裝 Chromium 後才執行；
  原 `test:videos` 保留全部 113 個單元測試。

獨立 reviewer 最後覆核核心、預覽與 CI 接線後，沒有未解決的 P1／P2／P3。
Reviewer 另自行重跑 source／test-wiring contracts，18 passed、0 failed、0 skipped；
Docker 21/21 及 browser 36/36 為 reviewer 讀取本輪已保存 logs，沒有冒充 reviewer
自行重跑這兩項整合。

## 補回預覽與未驗證項目

- 合成輸入位於 `scripts/fixtures/youtube-sync/`。已實際跑 CLI，
  樣本條件比較為 2 insert、1 unchanged；既有隱藏影片維持隱藏。
- 真實公開快照的私有報告為原工作區
  `.private-sync-evidence/youtube-daily-20261016/public-only-preview.json`／`.md`；
  `public-inventory.json` 保存 135 個已知公開 ID。15 個候選全為 unresolved，
  exact write counts 為 null。沒有 provider description、完整 CMS rows 或 saved cutoff，
  因此沒有猜測新增／更新數及實際公開決定。
- 外部 `test:youtube-sync:db` **NOT RUN**：沒有可證明身份的獲准 disposable Neon target。
  自動審批拒絕了該命令，未執行後才改用上述已核實的本機 owned Docker；
  沒有換路徑連外部 DB。本輪亦為該 opt-in suite 加上既有 target identity gate，
  放在 client、migration、cleanup 之前。
- 真實 YouTube Data API、剩餘配額、正式既有 key／cron secret 是否可用、
  原生 daily cron 執行、正式補回及逐 ID 公開驗收 **NOT VERIFIED**。
- 遠端 CI **NOT RUN**，因為本輪沒有 push；本機成功不等於遠端 CI 或正式驗收。
- CLI 第一次額外 tsc 指令沒有沿用 strict／alias 設定，後來臨時 config 放在證據目錄
  亦無法解析 Bun types；這是驗證指令設定問題。以工作樹 `.audit` 中 extends
  專案 config 的正確指令重跑通過，沒有為此弱化產品型別。

本輪原始 RED、GREEN、build/lint/typecheck、公開快照及 CLI 報告保留在原工作區
`.private-sync-evidence/youtube-daily-20261016/`。瀏覽器原始紀錄及 source hashes
保留在修復工作樹 `.audit/youtube-videos-verification.json` 等檔案，均不提交到 Git。

## 修改檔案

- `.github/workflows/ci.yml`
- `CLAUDE.md`
- `docs/youtube-sync-operations.md`
- `docs/youtube-sync-verification-20261016.md`
- `e2e/youtube-videos.spec.ts`
- `package.json`
- `playwright.config.ts`
- `playwright.youtube-owned.config.ts`
- `scripts/browser-fixtures/build-youtube-videos.mjs`
- `scripts/browser-fixtures/youtube-videos/README.md`
- `scripts/browser-fixtures/youtube-videos/data.ts`
- `scripts/browser-fixtures/youtube-videos/index.html`
- `scripts/browser-fixtures/youtube-videos/main.tsx`
- `scripts/browser-fixtures/youtube-videos/router.ts`
- `scripts/browser-fixtures/youtube-videos/status-data.ts`
- `scripts/browser-fixtures/youtube-videos/status-ssr.tsx`
- `scripts/browser-fixtures/youtube-videos/synthetic-analytics.ts`
- `scripts/browser-fixtures/youtube-videos/synthetic-queries.ts`
- `scripts/browser-fixtures/youtube-videos/synthetic-site.ts`
- `scripts/browser-fixtures/youtube-videos/synthetic-status.ts`
- `scripts/fixtures/youtube-sync/inventory.synthetic.json`
- `scripts/fixtures/youtube-sync/uploads.synthetic.json`
- `scripts/youtube-sync-preview.ts`
- `src/components/admin/YouTubeSyncStatus.tsx`
- `src/lib/neon/data-hygiene.owned.db.test.mjs`
- `src/lib/youtube-sync/youtube-client.server.ts`
- `src/lib/youtube-sync/youtube-client.test.ts`
- `src/lib/youtube-sync/youtube-history.server.ts`
- `src/lib/youtube-sync/youtube-history.test.ts`
- `src/lib/youtube-sync/youtube-http.server.ts`
- `src/lib/youtube-sync/youtube-http.test.ts`
- `src/lib/youtube-sync/youtube-preview.test.ts`
- `src/lib/youtube-sync/youtube-preview.ts`
- `src/lib/youtube-sync/youtube-repository.server.ts`
- `src/lib/youtube-sync/youtube-safety.test.ts`
- `src/lib/youtube-sync/youtube-status.ts`
- `src/lib/youtube-sync/youtube-status.types.ts`
- `src/lib/youtube-sync/youtube-sync.integration.test.mjs`
- `src/lib/youtube-sync/youtube-sync.server.ts`
- `src/lib/youtube-sync/youtube-sync.test.ts`
- `src/lib/youtube-sync/youtube-sync.types.ts`
- `src/routes/admin.cms.tsx`
- `src/routes/api.youtube-sync.test.mjs`
- `vercel.ts`
- `workers/cron/README.md`
