# 2026-10-02 每日盤源同步 release 執行紀錄

本紀錄更新 2026-10-01 的正式狀態。使用者已授權 PR208、兩個盤源 migration、部署、shadow/canary、通過後每日同步及三次監測；其後明確要求解除 PR209＋十個 webhook migration、兩個 managed token、Property.hk、精確50個公開證據副本阻塞。禁止批量撤盤、真實 WhatsApp/email、無關 cron 變更仍有效。

## 已完成的正式操作

- [x] PR207/208 已合併；PR208 maintainer merge `cbcab28d2d319218afabaa46d0ec54e8446f4b44`。
- [x] PR209 由 YNWAforever 於 2026-10-01T18:17:58Z 合併，merge `2e98167a6545198ffc3fda2f1470affd1fbd2911`。Agent 核對並沿用，沒有重複 merge。
- [x] 新同步前暫停 `PROPERTY_SYNC_DAILY_ENABLED=false`，readback 一致；沒有先啟用每日排程去做 canary。
- [x] 建立 private `YNWAforever/earnestproperty-sync-evidence` / `property-sync-evidence` release；code repo 的 `PROPERTY_SYNC_EVIDENCE_REPO` 已指向私有庫。
- [x] 原 Sep24 accepted archive、exact request、unresolved raw 恢復及安全 unpack/restore 通過；不是用 Oct1 ZIP 冒充 baseline。
- [x] 50個歷史證據檔共138,531,553bytes已私有保存及逐檔SHA/size回讀。按追加授權再下載驗50/50後刪除精確public asset IDs；public剩0、private保留50。[精確清單](2026-10-02-public-evidence-cleanup-preview.md)。
- [x] runbook兩個盤源 migration及追加10個 webhook migration 已依精確allowlist、Git blob hashes、manifest、host/branch/DB identity、transaction lock套用。正式 `app_migrations` **81/81**，無pending；[十檔及隔離演練](2026-10-02-deployment-schema-prerequisites.md)。
- [x] PR209正式部署 `dpl_9JtrJVJ4ncSqumDvEFFxExfTookC` READY，earnestproperty.com／www alias 已指向新版。未用 vulnerable dependency bypass。

## 正式 DB／baseline readback

Target：`ep-divine-frost-aokzrg7f.c-2.ap-southeast-1.aws.neon.tech`／`neondb`／`br-polished-sea-aom4i1ct`。兩個盤源DDL前後 properties1185、public members1185、source links356、manual overrides0。追加十檔前後 properties1185、messages68、outbound_intents1、inquiries6、withdrawal_batches0；property/status fingerprint 始終 `f4c1ecb02c388de66ed1b5f4eb504e5a`。没有來源inventory、withdrawal或訊息DML。

原accepted權威：source `28hse_agent_540`、scope `agent:540`、policy `no-hermes-v2`、parser `python-v2.2`、receipt `60895ce3-6a1d-4225-84f1-455d6e47f181`、full success、279廣告。原scraped_at `2026-09-24T21:45:54.421920Z`；沒有改時間。request byte/canonical hash `6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e`。

| 原 baseline asset | Bytes | SHA-256 | 私有回讀 |
|---|---:|---|---|
| accepted-20260924T214554421920Z-36062151356-1.tar.gz | 46599 | cb9e6a47c01c8b9a5d9f5d8d5d02ecad170b8b8269c3a37e1cb7858cdd302d83 | PASS |
| request-36062151356-1.json | 404131 | 6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e | PASS |
| unresolved-36062151356-1.tar.gz | 22395358 | ec27bc37cac6be73e00aabf5ba63a61faef3e8c6acb2ec8013594cee3d9028ae | PASS |

Sep24 artifact quota失敗不代表ingestion未commit；已用正式receipt核對。Oct1ZIP的286是廣告、46新source IDs不是46物業，132历史缺席仍NOT_APPROVED。

## 部署與測試證據

PR208初次deployment `dpl_2Phc1PmcsLMj7nF2tzt53HuUHik9`因TanStack vulnerability拒絕。修復commit `c2baec6`升級react-start1.168.60、start-server-core1.169.39、router1.170.41，error boundary正確narrow unknown；formatter保持3.8.2。原失敗保留，不改為PASS。

| Verification | Environment / SHA | Result |
|---|---|---|
| typecheck、build、lint | PR209本機；lint 3既有warnings | PASS，exit0 |
| daily suite（原release） | PR209本機 | PASS 37/37，0 skipped |
| public browser | 已核對disposable Neon，PR209本機 | PASS 23/23，0 skip/flaky；fixture cleanup全0 |
| PR209 CI | [36901844472](https://github.com/YNWAforever/earnestproperty/actions/runs/36901844472) | PASS；browser-staging SKIPPED，不能充作live登入 |
| main CI | [36905792829](https://github.com/YNWAforever/earnestproperty/actions/runs/36905792829)，2e98167 | PASS：ci、local PostgreSQL、handoff及no-link browsers；browser-staging SKIPPED |
| 精確10檔migration check/apply | 正式DB；approved SQL ref a5c844b | PASS，exit0；十檔同transaction，readback81/81 |
| migration drift | [36906658363](https://github.com/YNWAforever/earnestproperty/actions/runs/36906658363)，正式唯讀 | PASS |
| deployment alias | 正式2e98167，dpl_9JtrJVJ4ncSqumDvEFFxExfTookC | READY |
| homepage checker、/listings、/admin GET | 正式唯讀，2026-10-01T18:24:57Z | PASS HTTP200；/admin僅login shell，非登入角色證據；detailsVerified0 |
| 精確50public副本cleanup | 原清單a5c844b，兩repo metadata＋bytes | PASS，public0/private50/hash50/50 |

首次本機browser app readiness timeout exit1已保留；停止並行build後未改runner重驗23/23。Disposable僅 `br-young-breeze-ao85rtx1`／`earnest_audit_acceptance_20260927`／`ep-square-leaf-aobruyvf`，production無fixture。

## 還需完成的 gate

1. **Managed credentials**：使用者選擇直接在平台設定。最後metadata讀取仍未見GitHub `PROPERTY_SYNC_EVIDENCE_TOKEN`；Vercel `PROPERTY_SYNC_WORKFLOW_TOKEN`待配置/readback。前者只private evidence repo Contents read/write；後者只code repo Actions read/write。不把gh CLI廣權token抄入，無secret值進chat/公庫。Browser control runtime啟動失敗，沒有假稱完成token建立。
2. **Manual canary isolation**：發現現有workflow將manual apply與daily schedule共用開關。已補off-default `PROPERTY_SYNC_MANUAL_APPLY_ENABLED`；manual apply只用它、schedule只用daily flag，兩者仍需parser policy批准。實際shell regression先FAIL，再38/38 PASS（exit0）。修復尚待review/merge；daily保持false。
3. **Property.hk**：使用者已提供EPS NTM/NTW、EPT NTM、EPW NTM原SID入口。四入口普通HTTPS200；25個index頁已逐bytes/hash核實及離線解析：EPS NTM65／NTW178、EPT NTM168、EPW NTM43個廣告，共454；展開售/租為504個offers，不能當作504物業。第一個詳情HTTP403，停止詳情採集。入口缺失已解除；完整dt範圍、real detail解析、IDscope、終頁/空頁、合法media rights仍須真實資料驗證。只作隔離驗收，正式apply0；[存取紀錄](propertyhk-access-verification.md)。
4. **正式端到端**：尚未shadow/canary；尚未live admin/manager/agent登入及三指定盤當前source/photo readback。不能以GET200或synthetic browser替代。

## 來源與三次週期

| Journey | Status | 實際狀態 |
|---|---|---|
| A28Hse | VERIFICATION_BLOCKED | baseline/private evidence/DDL/deployment PASS；managed token及manual E2E待完成；daily PAUSED |
| BProperty.hk | BLOCKED_EXTERNAL | 四入口首頁200；detail403；正式apply0，合併基準未推進 |
| C盤源同步 | VERIFICATION_BLOCKED | schema/deployment就緒；managed dispatch token及live role驗收待完成；withdrawal off |
| Scheduled cycles 1/2/3 | MONITORING 0/3，未開始 | 先shadow/canary PASS再啟用；manual/replay/skip不能算cycle |

已有本chat heartbeat「28Hse 三次每日同步驗收」（每日09:00香港時間），只讀監測；gate未過不把0/3洗成完成，無變化保持安靜。只有Property.hk隔離index證據採集；沒有28Hse新crawl、正式ingestion/publication、批量撤盤、真訊息或無關cron改動。

## Rollback

保持daily=false、manual apply=false（若已配置）、admin dispatch及withdrawal review off；保留12個已套用schema、50私有副本、accepted receipt、UUID/public numbers、人工overrides。禁止回退已知vulnerable Start版本；新app故障先停rollout再修補。未知DB/工作流程結果先read-only reconcile，不blind replay、不改scraped_at、不重新爬取下游。20次publication嘗試、36h freshness、120/20/45/10分鐘預算均保留。[操作runbook](../runbooks/property-source-daily-recovery.md)。


## 本次追加修復 ledger

| Finding / task | Commit | Command / environment | Result / remaining gate |
|---|---|---|---|
| Canary與schedule共用開關 | e9ff8b0 | `npm run test:property-sync:daily`；Windows本機，actual Bash gate | RED原manual daily=false被拒；GREEN38/38，exit0，0 skipped；新flag預設off，待review合併 |
| Property.hk real index contract / T6追加證據 | 55dd78c | `npm run test:property-sync:python`；Windows隔離、無DB | RED缺inspector/證據命令；GREEN115/115，exit0，0 skipped |
| Property.hk 25-page private readback | 55dd78c | `python scripts/property-sync/verify_propertyhk_index_evidence.py --manifest PRIVATE/capture-manifest.json --entries PRIVATE/approved-entry-urls.json --out PRIVATE/verified-index-report.json`；hash-checked真HTTP原件，offline | PASS25/25 index；detail403、完整branch scope/ID/media/DB驗收BLOCKED_EXTERNAL；full_snapshot=false |
| 10額外schema / public cleanup / PR209 deployment | 本文件及schema/cleanup紀錄 | 正式operator readback，未發訊息、撤盤或同步 | PASS81/81、public0/private50、deploymentREADY；不需再次批准已完成操作 |

依使用者single-agent限制，追加diff由同一agent獨立再讀self-review；沒有聲稱fresh reviewer、live角色或provider全鏈驗收。用現有raw SQL/worker/ops體系，未加入writer、schema、policy activation或無關cron。

## Heartbeat — 2026-10-02T01:01:44Z（香港09:01）

- **MONITORING 0/3，PAUSED**。GitHub `PROPERTY_SYNC_DAILY_ENABLED=false`；沒有新的shadow/canary通過證據。PR210仍OPEN、head168c1a0，未收到其新增合併授權；GitHub evidence-token secret仍未出現。本輪不重複索取已知待處理事項。
- 新native scheduled run [36943339534](https://github.com/YNWAforever/earnestproperty/actions/runs/36943339534)，created_at 2026-10-01T23:55:23Z，SHA `2e98167a6545198ffc3fda2f1470affd1fbd2911`；結論SKIPPED。preflight/collect/ingest/publish/verify/record六stage全部SKIPPED、各0步，符合暫停開關，**不計cycle PASS**。
- 本run沒有新的scraped_at、receipt、source/canonical/publication counts或public_verified proof；以上屬未執行，不能冒充成功或空inventory。沒有執行recovery/replay或公網發佈驗收。
- 正式alias仍為READY `dpl_9JtrJVJ4ncSqumDvEFFxExfTookC`；GitHub Production deployment6791886838對應SHA2e98167，未把PR210 preview當正式部署。
- 正式DB唯讀target guard及read-sync-authority均exit0：source28hse_agent_540／agent:540／no-hermes-v2／python-v2.2，accepted receipt仍`60895ce3-6a1d-4225-84f1-455d6e47f181`、full_count279、scraped_at2026-09-24T21:45:54.421920Z、accepted_at2026-09-24T21:45:58.940806Z。Payload hash仍`6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e`；既有publish_enabled=true不是本輪publication證據。
- Private release仍50assets，原accepted/request/unresolved三件size及GitHub digest與本報告原pins一致。本輪為metadata/hash比對，沒有宣稱重新下載50檔bytes。
- 全輪remote唯讀；僅本機追加此紀錄。沒有dispatch、merge/push、secret/config/DB修改、migration、deploy、訊息、撤盤或portal請求。狀態與已知阻塞不變，無新警報；heartbeat繼續保留，待啟用門檻滿足才計三輪。

## Homepage recovery — 2026-10-02（香港10:30後）

以上Sep24/heartbeat狀態是當時歷史；本次fresh canary更新如下，[完整byte/receipt/public browser證據](2026-10-02-homepage-stale-recovery.md)。

- PR210已由human合併至3432af370e75c0f378d7dd8b74ba02510f1b1107，正式deployment dpl_GBkJ6ZN8SVH3ZyUtJ2fM62FprmZu READY，未重複merge/deploy。
- 使用者已授權shadow/canary：original279 baseline的私有hash及正式server branch/endpoint核對後，當日collector fd5cb539-8d7f-4854-a801-0329d16e5f87於2026-10-02T01:44:32.218276Z收集281ads（sale222/rent59），fullgate PASS；request/raw/handoff私有upload/download exact PASS。
- 单次正式canary fullreceipt7e1cb08f-5ac9-486a-9b27-0439bb44f4e6：22created／6changed／10fields_changed，full281，reject/duplicate0；canonicalrequestSHA9592455f1be804631be0083d5fdfa71604081aedab1f9ad8b1c81f00304644c1及原scraped_at readback PASS。47absent只候選，撤盤0。
- 合資格publication15attempts內published14offers／13aliases，alreadyPublic192、held75、unknown0；eligibleBacklog1為A057717 blob_upload_failed，先reconcile。原cap20/36h不變。
- **公開首頁READY（人工恢復）**：HTTP homepage＋13unique詳情PASS；真Chromiumdesktop/mobile各6新卡/6ownedcovers，14售租詳情目標photo tabs所有圖片載入PASS；當日幾分鐘前更新，不改假日期。三指定盤正確mapping，但依當前review/inactive/media資格held，沒有強制reactivate。
- **保護readbackPASS**：1185原UUID/盤號、648aliases、1185memberships及原active保留；總properties1207／publicgroups665／members1207；overrides0、withdrawal0、messages68、outboundintents1未變。
- [PR211](https://github.com/YNWAforever/earnestproperty/pull/211) 520fd38修既有operator baseline UUID/原時間綁定與retention保守保留；RED3casesFAIL後Python119/119、focused26/26、daily38/38 PASS，CI36952698557 PASS（browser-staging SKIPPED），previewSUCCESS。待reviewed merge，無新schema/writer。
- **A每日VERIFICATION_BLOCKED／MONITORING0/3／daily PAUSED**：GitHub evidence secret仍缺，PR211新operator baseline須先進reviewed main及hosted shadow驗managedprivatepin；本次無native run，不計scheduledcycle。C workflowtoken/live角色仍blocked；B Property.hk detail403/fullscope gate仍blocked，正式apply0。
- 本輪正式只做獲准fresh shadow/privatefreeze→guardedcanary ingestion→eligiblepublication→read-onlypublic/DB verification；沒有新migration、secret/config更改、daily啟用、bulk撤盤、真訊息或無關cron改動。22件驗收proof另已私有freeze/upload/download/hash PASS，assetverification-operator-fd5cb539-8d7f-4854-a801-0329d16e5f87.tar.gz／1119332bytes／SHA d327b0c00d7269ae3f1e22097b8d1c65572e4b7a34fd0a0e883b16936e0db4e6。
