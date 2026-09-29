# 免連結 WhatsApp 修復台帳

執行分支：`codex/no-link-fixes-20260929`；起點 `b1263bc06aef4d45891dd0b78380574292f70a4b`。以 T00–T15 順序更新；task 狀態與驗收狀態分開。原 audit ZIP 及五個缺陷探針保持原樣。

| Task | Findings / UC | 狀態 | Commit | 本地證據 | DB / 外部阻塞 |
|---|---|---|---|---|---|
| T00 | 全部 | VERIFIED | bad4bd9 | 外層 7/7 SHA、內層 33/33 SHA；40/40 baseline tests；P01–P05 5/5 characterization | Neon、browser、live provider BLOCKED |
| T01 | NL03 / UC01,09,12 | IMPLEMENTED | a5fbd85 | RED 2/3 → GREEN 13/13 (含 migration manifest)、typecheck、focused lint；40/40 baseline | 新 migration 僅本地 PGlite apply；isolated Neon BLOCKED |
| T02 | NL04 / UC09,10 | IMPLEMENTED | 5cf75e0 | RED 4/4 → GREEN 19/19 receipt/identity tests；18/18 plan suite；6/6 manifest；40/40 baseline；typecheck／lint | 新 migration 僅 PGlite；多 session Neon/provider BLOCKED_EXTERNAL |
| T03 | NL01 / UC01–04,07,08 | IMPLEMENTED | bc4f8c0 | RED module absent → GREEN 8/8 parser, 17/17 parser+links, typecheck/lint | PropertyHK live shape NOT_TESTED；未接DB resolver |
| T04 | NL01,R01,R02 / UC01,03–05,08,15 | IMPLEMENTED | 本次 focused commit | RED module absent → GREEN 15/15 resolver+manifest, typecheck/lint；PGlite exact SQL | 新 migration 僅 PGlite；channel scope/real staff alias及Neon BLOCKED_EXTERNAL |
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
## T02：provider identity、重送及亂序

- 20 次相同 provider ID 重送只得一條 scoped receipt，delivery_count=20 而 repair attempt_count=1；不同 ID 同文分開，同原始 ID 跨 channel 會形成不同 scoped transcript ID。缺 ID 同秒同文保留兩條 ambiguous receipt 和兩則 transcript，不以 content hash 做 unique，不給 active effects；SENT/READ 及 READ-before-SENT 的狀態證據分開。
- RED 4/4 在 T01 store 重現；GREEN：
ode --test src/lib/whatsapp-enquiries/inbound-identity.test.mjs src/lib/whatsapp-enquiries/inbound-identity.db.test.mjs src/lib/whatsapp-enquiries/event-classification.test.mjs exit 0（18/18），T01/T02 收件組 19/19，manifest 6/6，
pm.cmd run typecheck exit 0，focused ESLint exit 0，baseline 40/40。測試使用合成資料與 PGlite 單序 SQL；Neon 多連線 20 併發尚需 isolated target。
- 新 migration 只加 delivery_count 與非空 identity_key 的 partial unique index，舊資料不 bulk backfill。相同 channel/provider 舊 ID 兼容；receipt identity scope 帶 tenant/app/channel/kind。unknown wrapper、BOT/MANUAL、internal note 沿既有分類 guard，6/6 classification tests。
- 待解風險：舊 CRM contact 的 whatsapp_member_id 為全域 unique；跨 channel 重複 member ID 且不同客戶電話的 legacy contact link 尚須隔離驗證。

## T03：免link portal parser

- 原始 28Hse 樣本逐字 fixture；parserVersion portal-intake-v1。解析外部 ID 字串 4033349、requestedStaffText、estateText、sale、訊息報價 HKD12680000。URL 保留原文及 span，canonical 只除已定義非 identity 的 t；未知 query 保留。未推 customer、internal property、click、campaign 或時間。
- RED：parser module 缺失，
ode --test src/lib/whatsapp-enquiries/portal-intake.test.mjs exit 1。GREEN：同命令 8/8 exit 0；與 links、link-batch-import 一起 17/17，typecheck、focused ESLint exit 0。純函數測試將 fetch 攔截並確認 0 call，無 model port。
- 前導零、不同 ID、重複 URL、多 URL、文字與 URL 衝突、全形標點、過長、spoofed host/userinfo/local URL 有邊界測試。PropertyHK 僅 exact host + unverified shape，沒有已驗證去識別樣本；live format NOT_TESTED，不推測 external ID。T04/T05 尚須把解析證據耐久接到 enquiry。

## T04：MLS／職員權威配對

- Batch resolver 只查明確 reviewed channel/source scope；migration 建表但不 seed 任何映射。使用 mls_source_state exact source+scope+external ID+deal、有效 observation、active source/link/public offer、30 日 accepted freshness 門檻。外部 ID 保持字串；matched snapshot 有 observation/policy/mapping 版本及 publication owner，訊息報價不改 MLS。
- requestedStaffText 只走現有 staff_external_references 同 namespace 的精確 verified record；沒有或多個、職員停用、撤刊、scope 不一致一律 review。PropertyHK shape 未驗，不能 auto match。加入 append-only interpretation/resolution snapshot；同 receipt/parser 版本重播一致才 idempotent，改變證據拒絕。
- RED：resolver module 不存在，new unit exit 1。GREEN：
ode --test src/lib/whatsapp-enquiries/portal-resolution.test.mjs src/lib/whatsapp-enquiries/portal-resolution.db.test.mjs src/lib/control-plane/migration-versions.test.mjs exit 0（15/15）。PGlite 測新 migration 無 authority seed、以實際 production SQL 配對 synthetic P1/S1、錯 channel 拒絕、snapshot 不可 UPDATE/DELETE。1000 refs 使用 3 次批量 port 呼叫。typecheck、focused lint exit 0。
- 此時 resolver 尚未由收件流程調用；T05 要接 receipt→interpretation→enquiry。正式 source scope／Terence ID 未知，不能 seed；isolated Neon migration／真 MLS 資料核對 BLOCKED_EXTERNAL。

