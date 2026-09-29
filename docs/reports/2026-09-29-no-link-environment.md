# 免連結查詢：T00 環境與安全門檻

檢查日期：2026-09-29（HK）；基線 SHA：`b1263bc06aef4d45891dd0b78380574292f70a4b`。此檔記錄本地檢查，不代表正式站目前狀態。

| 能力 | 狀態 | 證據／界線 |
|---|---|---|
| 純 Node tests | AVAILABLE | Node v24.18.0；`npm.cmd ci --ignore-scripts --no-audit --no-fund` exit 0；`node scripts/no-link-safe-checks.mjs` 40/40 pass |
| PGlite | AVAILABLE | 同一安全 runner 執行審核 P05 原 SQL 探針；只證明指定函數行為 |
| isolated multi-session Neon | BLOCKED | `ASTRA_TEST_DATABASE_CONFIRMED`、`ASTRA_TEST_BRANCH_ID`、測試 DB URL 均未設定；`assertDisposableNeonTestTarget` 必須核對 Neon server branch/database/endpoint 後才容許寫入 |
| synthetic browser | BLOCKED | 無 `PLAYWRIGHT_BASE_URL`／`STAFF_HANDOFF_BROWSER_FIXTURE`；必須先由既有 fixture preflight 驗證本地或隔離 staging，禁用正式站 mutation |
| live provider | BLOCKED | 無已證明 channel/app、簽名事件、Folder／assignee readback、同意測試收件人；不能用 fake provider 證明真送達 |
| production DB／config／send／deploy | NOT APPLICABLE | 本實作未獲授權，沒有執行 |

原 `evidence/run-safe-checks.py` 在 Windows 的狹窄 environment 下令 Node 啟動時 CSPRNG assertion 失敗（exit 134），不是產品測試失敗。新 runner 只繼承 PATH／SystemRoot／WINDIR／TEMP／TMP／LANG，並固定 `OPS_EVENT_WAKE_ENABLED=false`；不繼承 DB URL、provider key、auth cookie 或部署 flag。原五個 probes 只有在 SHA 仍等於審核基線且內容 hash 符合時才允許執行。新 runner 不載入 .env。

既有 worker 使用 `ops_jobs`、`job-handlers.server.ts` registry、commit 後 wake 與 Cloudflare Durable Object alarm；沒有例行 cron 本身不是缺陷。Webhook 驗簽後進 `ingestWoztellEvent`。目前 observe/active 在 transcript transaction 前檢查可選 workflow schema，故未有獨立的最小 inbound receipt 根表；`whatsapp_delivery_events` 是 outbound status，不是 inbound 原文保底。T01 在 `20260929100000_whatsapp_inbound_receipts.sql` 增量建立最小 receipt，並重用現有 transcript、jobs 及 worker，不新增平行 CRM 或 queue。migration 清單最後版本為 `20260927172000_media_asset_variants.sql`；所有既有 migration 保持唯讀。

合成 actor：A_admin、M_branch_A/B、G_owner、G_other、V_viewer、G_inactive；合成 channel A/B、customer C、P1/P2、S1/S2。樣本中的 Terence 僅作原文，不是正式 staff ID。收件號碼、provider tenant、worker revision、正式 migration state、真人 App echo／staff phone receipt 目前 UNKNOWN。待外部 gate 具體列於最終 runbook。
