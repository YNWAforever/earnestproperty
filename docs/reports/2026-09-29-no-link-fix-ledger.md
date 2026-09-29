# 免連結 WhatsApp 修復台帳

執行分支：`codex/no-link-fixes-20260929`；起點 `b1263bc06aef4d45891dd0b78380574292f70a4b`。以 T00–T15 順序更新；task 狀態與驗收狀態分開。原 audit ZIP 及五個缺陷探針保持原樣。

| Task | Findings / UC | 狀態 | Commit | 本地證據 | DB / 外部阻塞 |
|---|---|---|---|---|---|
| T00 | 全部 | VERIFIED | bad4bd9 | 外層 7/7 SHA、內層 33/33 SHA；40/40 baseline tests；P01–P05 5/5 characterization | Neon、browser、live provider BLOCKED |
| T01 | NL03 / UC01,09,12 | IMPLEMENTED | 待本次 focused commit | RED 2/3 → GREEN 13/13 (含 migration manifest)、typecheck、focused lint；40/40 baseline | 新 migration 僅本地 PGlite apply；isolated Neon BLOCKED |
| T02 | NL04 / UC09,10 | TODO | | | |
| T03 | NL01 / UC01–04,07,08 | TODO | | | |
| T04 | NL01,R01,R02 / UC01,03–05,08,15 | TODO | | | |
| T05 | NL02 / UC01,06–09 | TODO | | | |
| T06 | UX01,NL02,R13 / UC05,06,12,14 | TODO | | | |
| T07 | R03,R04,R11–13,WA06 / UC01,09,10,12,13,17 | TODO | | | |
| T08 | UX01,WA01–06,SH01 / UC06,13,17 | TODO | | | |
| T09 | UX02,R01,R02,R04 / UC04,05,12,14,15 | TODO | | | |
| T10 | LE01–05 / UC11,13 | TODO | | | |
| T11 | R05,R06,R14 / UC18 | TODO | | | |
| T12 | BL01–08 / UC16,17 | TODO | | | |
| T13 | UX03,WEB01 / UC13,16 | TODO | | | |
| T14 | PF01、動作台帳 / 全部 UC | TODO | | | |
| T15 | 發佈 gate / 全部 UC | TODO | | | |

## T00：基線、所有權及核對

- `origin` 為 `https://github.com/YNWAforever/earnestproperty.git`；`origin/main=b1263bc`，與 audit SHA 相同，故 audit→目前 main 無程式差異。根目錄當時是較舊的 `codex/logo-lockup-placement@7246943`，有大量未追蹤檔及 `bun.lockb` 修改；未 stash/reset。獨立 worktree 從 main 建立。該新 worktree 的 `bun.lockb` 只有 Windows checkout mode 100755→100644 異動，沒有內容差異；不納入 focused commit。
- 附件 `Manifest.sha256` 7/7 相符；ZIP 先檢查絕對／相對跳路、反斜線、symlink、總解壓大小，安全解壓到 temp；內部 `evidence/hashes.sha256` 33/33 相符。未執行包內未審查腳本。
- 原審核 P01 是簽名訊息到 injected ingest；P02 無 portal references；P03 無 ID 同秒同文碰撞；P04 schema 缺失在原文寫入前拒絕；P05 第二盤錯併。P02–P05 是缺陷 characterization，不能算修復 PASS。新增正向 regression 須另立檔。
- Repo 無適用 AGENTS.md 檔，沿用使用者提供的 AGENTS 指令；已讀 CLAUDE、README、package/lock、migration manifest、worker、DB guard、provider/permissions 入口及相關 tests。現有能力映射：transcript `woztell-ingest.server.ts`、workflow `workflow.server.ts`、episode `episodes.server.ts`、assign `assignment.server.ts`、jobs `job-handlers.server.ts`／`ops_jobs`、notification `staff-notifications.server.ts`。receipt 尚須最小增量，不重建 CRM。
- `npm.cmd ci --ignore-scripts --no-audit --no-fund` exit 0（lockfile，無 lifecycle）；原 runner 在 Windows Node CSPRNG exit 134；新 `node scripts/no-link-safe-checks.mjs <verified probe path>` exit 0：40/40 原 tests、5/5 probes，SHA `b1263bc`，whitelisted process env，mock／PGlite。此證據不涉及 isolated Neon 或真 provider。
- 判定：NL01–04 在審核基線仍可重現；R02/R03/R05/R06/R07/R09–R16 已有程式能力，尚需逐 task 補驗；UX01/02/03、WA/BL/LE 等按原審核逐項測，不以歷史狀態冒充目前 live。
- Ruling: 新隔離 worktree 從 `origin/main` 的審核 SHA 起步，因 remote 目前未有更新且根 checkout 大幅落後並有他人改動；代價是其他未合併分支的新工作不會自動包含，合併前須重比對。
- Ruling: T01 最小 receipt 用新根表，因現有 transcript 會被可選 workflow schema 擋住；代價是需 additive schema、兼容 reader 與 durable repair 路徑。

## T01：最小耐久收件

- RED：`node --test src/lib/whatsapp-enquiries/inbound-receipts.test.mjs` exit 1，缺 schema 時 503 而非持久收件回 200；最小 store 故障反而回 200。GREEN：同組＋`inbound-receipts.db.test.mjs`＋`migration-versions.test.mjs` exit 0，13/13。PGlite 真 SQL readback 證明 signed webhook 在 workflow 缺失時保留原文／`blocked_schema`；DB 表缺失會拒絕；recovery 對舊 active receipt 強制 observe，off 保持 off。既有 40/40 Node baseline 在 `bad4bd9` 工作樹重跑仍綠。typecheck、focused ESLint exit 0。
- 新表只存受限 normalized event、scope、digest、capture snapshot、projection 狀態及 lease；不含 secret/header。T01 的 provider identity 去重尚待 T02。原 transcript 仍為對話主資料；P04 原探針保持 reference，新增正向測試驗證 webhook 入口。
- Ruling: 只把經 webhook 驗簽的 live path 接入最小 receipt；history import 保留獨立入口。原因是驗簽前不可接受可信 scope；代價是直接呼叫 ingest 的非 webhook 程式路徑不享最小 receipt，須保持只作 history／測試。
- Ruling: recovery 無論舊 active snapshot 都只以 observe 重投影，不復活舊 activation 的外發。代價是被擋下的舊 active 訊息須人工 triage 而不自動補發。普通投影仍按既有 workflow 契約；T15 新 no-link effects 有獨立 default-off gate。
- `runServiceJobs` 在既有 service worker lane 先作最多 20 筆租約掃描；無新外部 queue。worker alarm 缺失或 commit 後 crash 時，需既有手動 service wake 重新啟動掃描；不能把此說成已在正式環境自動復原。migration clean isolated Neon、真 worker revision及受權限 UI 可見性仍 BLOCKED_EXTERNAL；T09 補操作面板。