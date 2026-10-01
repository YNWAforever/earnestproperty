# 每日盤源同步：恢復、啟用及回退

本手冊對應 codex/full-property-sync-20261001；程式準備完成不代表正式啟用。正式修改只由獲本 session 明確授權的 release operator 執行。2026-10-01 本 session 正式操作只有 read-only：核對 GitHub、DB host/policy/full receipt、首頁 HTTP 與一次 Property.hk 正常存取；未執行正式 migration、apply、排程 dispatch、config、撤盤、訊息或 merge。

## 五步員工手冊

1. **睇狀態**：後台「盤源同步」四張卡顯示28Hse／EPS／EPT／EPW。30小時沒有 accepted full ingestion 顯示 stale；從未接通獨立顯示。「上架成功」不會替代「匯入成功」。
2. **睇待處理**：查看今日處理上限、圖片待核實、需補屋苑、來源身份衝突或人工修改。Source IDs／receipt 只在支援詳情展開；正常操作用盤名與公開盤號。
3. **重試階段**：admin 可啟動受控同步、重試同一 request 匯入或只重試上架；manager 可讀同步紀錄及逐盤核實。按鈕禁用會顯示未接通原因。提交被接受只代表排入 workflow，完成另看 stage／receipt。結果未知先核對，不重按。
4. **核實撤盤**：只選本頁已載入候選（最多100）→預覽→查看每項允許／阻擋原因→填理由→確認。歷史缺席 NOT_APPROVED 不是撤盤指令。Preview15分鐘有效；取消不下架；衝突須重新預覽。另一來源仍 active、人工保護或故障區間均阻擋。
5. **查看紀錄**：逐項看 before/after/version、actor、reason、batch結果；partial failure只處理未完成項。未知提交用「核對提交結果」只讀對帳。agent沒有全公司同步／撤盤入口。

## 責任與最小外部 gate

| Gate | 負責人 | 必需證據 |
|---|---|---|
| Reviewed PR／release | Repository maintainer | PR207仍draft且未合併，review ancestry與CI；新PR可包含其既有修正但不重複套用 |
| 私有證據 | GitHub operator | private evidence repo、property-sync-evidence release、least privilege token、upload/download hash readback；原 ZIP／raw／contacts不公開 |
| 正式 baseline recovery | DB＋sync operator | current full receipt、exact original request、canonical payload hash、source/scope/parser/policy一致；舊request必須有正式權威核對 |
| 兩個 additive migrations | DB operator | host／server branch／app_migrations prerequisites、精確checksums、transaction readback；不跑未篩選的全repo migration |
| 後台 managed token／login | App operator | workflow-only repo Actions write能力、off→read-only驗收→受控啟用、實際admin/manager/agent對帳 |
| Property.hk | Provider＋sync operator | 獲准EPS/EPT/EPW含原SID入口、第一頁/終頁、dt範圍、牌照、IDscope、real HTML/feed、sourceURL grammar及media使用權；403不可當空盤 |
| 三次每日驗收 | Sync operator | 同一正式commit的manual E2E後3個實際scheduled cycles，hash／receipt／counts／public證據；未完成只能MONITORING |

28Hse可以先完成A gate；Property.hk受阻不阻擋A。不得啟用舊writer，亦不得修改CRM／WhatsApp／影片排程。

## 配置：names only，沒有secret values

GitHub source workflow沿用：PROPERTY_SYNC_DAILY_ENABLED、PROPERTY_SYNC_EXPECTED_BRANCH、PROPERTY_SYNC_POLICY_APPROVED、PROPERTY_SYNC_EXPECTED_DATABASE_HOST、PROPERTY_SYNC_EVIDENCE_REPO；managed secrets DATABASE_URL_UNPOOLED、BLOB_READ_WRITE_TOKEN、PROPERTY_SYNC_EVIDENCE_TOKEN。Code token保持contents-read；evidence token僅private evidence repository contents read/write。後台 managed PROPERTY_SYNC_WORKFLOW_TOKEN限制同一repo Actions write，不用它公開evidence或更改repository權限。

新增off-default：PROPERTY_SYNC_OBSERVABILITY_ENABLED、PROPERTY_SYNC_ADMIN_DISPATCH_ENABLED、PROPERTY_SYNC_WITHDRAWAL_REVIEW_ENABLED。Operator migration使用PROPERTY_SYNC_EXPECTED_DATABASE_BRANCH、PROPERTY_SYNC_MIGRATION_APPROVED；cleanup另用PROPERTY_SYNC_EVIDENCE_RETENTION_APPROVED。本 session 沒有設定任何新增正式flag／token。

Disposable acceptance專用ASTRA_TEST_DATABASE_URL、ASTRA_TEST_BRANCH_ID、ASTRA_TEST_DATABASE_CONFIRMED與PROPERTY_SYNC_DB_ACCEPTANCE_ENABLED；只有manual workflow，先驗current_database／neon.branch_id／endpoint。不得使用正式DB secret，缺值必須fail而非skip當pass。原ZIP回歸使用本機私有PROPERTY_SYNC_PRIVATE_REGRESSION_REQUEST；不把ZIP放public CI artifact。

## Migration rehearsal／release

新增manifest entries：

| File | SHA-256 |
|---|---|
| 20261001120000_property_sync_operations.sql | 349af4a3d84122be226d19028b54451b7d5b8f4e822b7f3d42eaea7160f66c64 |
| 20261001130000_property_withdrawal_review.sql | ba68aaea2975c6c22e41997236c0fe7d3e96d2b3bcf1490223018bfbbd7c4e19 |

已在disposable DB隨機schema套用驗證。原有已套用migration檔沒有修改。T10透過新migration擴充既有admin_property_manage的inactive allowlist，原授權、鎖、group version、provenance、override及audit保持。

```bash
# 本機只列精確migration/hash；不連DB。
node scripts/mls/migrate-sync-operations.mjs
# 以下需要受管理target及release operator；本 session未執行。
node scripts/mls/migrate-sync-operations.mjs --check
# 僅在review後，managed PROPERTY_SYNC_MIGRATION_APPROVED=true才可執行。
node scripts/mls/migrate-sync-operations.mjs --apply
# unknown COMMIT：先read-only核對app_migrations，不重送DDL。
```

工具核對direct host/neondb、server branch、五個必要舊migration及兩個bytes hashes。採用migration advisory transaction lock、10s lock timeout、180s statement timeout及版本同transaction。它只處理上述兩個檔案。若prerequisite缺失，交DB operator核對；不自動補全其他未批准migration。

## Shadow → canary → production

1. **Read-only準備**：fresh fetch main／PR207；核對source policy owner=no-hermes-v2、parser=python-v2.2、agent:540、absence=false與accepted baseline。Managed production direct host於本session核對為ep-divine-frost-aokzrg7f.c-2.ap-southeast-1.aws.neon.tech/neondb；執行時重新確認server branch及host。不reset main，不重建inventory。
2. **Private recovery**：正式current receipt對應的exact request／accepted archive必須在private release可復原，並驗hash。現有receipt但缺private archive是recovery gate；bootstrap=false，不拿2026-10-01 ZIP或新run假裝舊baseline。
3. **Shadow**：reviewed branch合併/部署授權後，manual shadow agent:540，完整sale/rent第一頁→終頁，request/raw原子freeze、private readback、full gate；不進業務寫入。核對實際hosted120min採集預算及page counts。
4. **Canary**：經正式apply授權後，一個fresh同run走collect120→ingest20→publish45→verify10（minutes）；accepted full receipt、canonical actual writes與公開alias分開計數。保留20次publication嘗試/36h原始scraped_at freshness；held後重試只publish。不要把46source IDs當46新物業。
5. **Production**：04:17HK每日28Hse＋08:15HK只讀watchdog，沿既有full chain concurrency＋global MLS writer lock。記錄manual E2E及後續三次scheduled cycles；每次失敗有stage/receipt/readback及恢復結果。未完成3次，整體MONITORING。

Property.hk獨立gate：三個branch真實parser、原SID URL、IDscope/mappings/media已核實後才做fresh3/3full disposable rehearsal→first approved apply（absence off）→source-aware publication→public verify→新增獨立05:17HK schedule。**本次沒有添加Property.hk production schedule或啟用policy**；source-aware安全程式與synthetic tests不等於正式入口可用。

## Exact stage recovery

### Ingestion未知或private baseline upload失敗

保留exactrequest及handoff；先target guard及current receipt只讀核對：

```bash
node scripts/mls/verify-daily-target.mjs
node scripts/mls/read-sync-authority.mjs --payload PRIVATE/request.json --receipt PRIVATE/receipt.json --out PRIVATE/authority.json
```

這是28Hse authority helper；Property.hk操作須以server source/scope查其receipt，不挪用28Hse authority。Compare canonical JSON payload hash與byte SHA各自用途，兩者不可互換。若已commit，readback accepted receipt；private upload修復需同bytes同run，不能再爬。若不存在完整receipt，修復永久錯誤後才核准同exactasset的replay-shadow／replay-apply。慢於current baseline的payload不能推進baseline。

```bash
# 只有完成正式operator授權後：exactexistingasset由server read model選出。
gh workflow run property-sync-daily.yml --repo YNWAforever/earnestproperty --ref main -f mode=replay-shadow -f scope=agent:540 -f replay_asset=request-RUN-ATTEMPT.json -f bootstrap=false
# apply gate通過後，同asset mode=replay-apply；不換時間戳。
```

### Publication失敗

查current accepted full receipt與原scraped_at≤36h。驗source policy/URL、description、estate、price/area、manual edits、source conflicts及owned media。不增加每日budget去迴圈強上；修復held原因後只使用publication-only相同exactasset。過36h需正常新fresh collection；不能改舊ZIP時間冒充fresh。重新ingestion後舊publication結果不得套用。Owned照片已驗證可復用，不重覆上傳。

### Collection取消／Property.hk403

停止full gate：保存可得raw/page/detail checkpoints，缺上傳部分明示missing evidence；不得拼昨日頁面成今日full。任一branch未complete即全Property.hk業務apply=0；current baseline保持，沒有missing下架。403／challenge不可retry繞過，交provider；其他來源工作繼續。Collection重做是新觀察，downstream retry則不得再collect。

### 後台dispatch未知／stale

GitHub204=dispatch accepted，未等於job開始/完成。Timeout／5xx=unknown；後台保存原 idempotency key 至已核實 user 的 browser-tab sessionStorage，重新載入仍保持待核實。按「核對工作流程結果」只讀同 staff/key 的結果，DB 重新核對 active admin role，不 dispatch 或寫入。確定 provider rejection，或具有完整四階段 native 終結紀錄且成功 ingestion receipt 的 source/scope/hash 相符，才解鎖；accepted／缺 callback／缺階段／unknown outcome 仍鎖定。核對完成只代表該 operation 結果已知，各階段失敗仍按紀錄處理。若原 key 已遺失或歷史 unknown 沒有 callback，由 operator 唯讀查 native workflow/run operation identity；不得換 key 盲重送。現有 reservation 仍阻擋 blind redispatch。Run metadata只存bounded IDs/counts/stages/private asset reference；terminal結果不倒退。原full receipt可作accepted historyfallback；callback未執行不能宣稱publication完成。30h無accepted full ingestion與從未接通分開，不能以最近publication時間洗白。

### 公開驗證與安全摘要

verify job 為了保留故障摘要會 always 執行；job success 本身不代表公開檢查執行過。只有實際 HTTP checker 通過後才輸出 native public_verified=true，後台才記錄 verification succeeded。Shadow／publication skipped或failed未執行check，verification保持未開始；缺proof顯示待核實。HTTP proof也不代替登入／照片／桌面手機live browser驗收，這些仍需release operator獨立記錄。

## 撤盤及復原

132historical缺席於本session沒有任何正式apply。候選須同scope兩個accepted full observations，原採集時間相隔≥24h、latest≤36h、collection/ingestion metadata可證完整、無failed/unknown區間。明示sold/rented獨立；draft、人工override/openreview、其他active source均阻擋。Property.hk absence永遠off，本次只人工review、不啟用automation。

Apply只通過既有locked管理writer設inactive並持續override；UUID／public alias／source links不刪。Preview之後source或staff版本變更會blocked；一批partial結果保留。COMMIT ack未知先用idempotency key只讀結果，禁止換key盲重送。

復原是**新的管理審核操作**：核對當前source/conflicts、freshness、manual變動、public prerequisites及current group version，manager經既有樓盤管理提交修正，再next actor／public readback。不能盲還原before JSON、bulk active、清override或重新啟舊writer。

## 私有證據cleanup

詳見deployment/property-sync-daily.md：preview default；1h exact review；raw7d／compact/request90d只對unpinned orphan objects；所有accepted history、readyhandoff、unresolved及explicit pins都保護。先暫停新dispatch再由單operator處理。DELETE前重新查pins/object identity；未知先reconcile-report，只讀確認缺席。No cleanup cron；本session沒有遠端刪除。

## Rollback（需operator正式變更授權）

```bash
# 只停此source的daily/apply；保持active transaction完成並對receipt。
gh variable set PROPERTY_SYNC_DAILY_ENABLED --body false --repo YNWAforever/earnestproperty
# 阻止新的dashboard workflow dispatch。
# App managed PROPERTY_SYNC_ADMIN_DISPATCH_ENABLED=false
# App managed PROPERTY_SYNC_WITHDRAWAL_REVIEW_ENABLED=false
```

同時停止新增publication-only dispatch／尚未批准的absenceautomation，等native run完成並read-only核對current receipt、private evidence與未解決operation。Property.hk schedule若日後啟用，由operator單獨停它，不停28Hse或改CRM／WhatsApp／video。取消web UI flags不undo accepted資料；留兩個additive schema、history、media、policies、canonical UUID/public aliases及baseline。新source錯誤用reviewed compensating mutation，保留audit；不truncate/drop history、不改receipt、不重寫applied migration、不無條件active/restore。

## 三次daily監測

| Cycle | Native scheduled run | 狀態 |
|---|---|---|
| 1 | 尚未正式啟用／執行 | MONITORING，未驗證 |
| 2 | 尚未正式啟用／執行 | MONITORING，未驗證 |
| 3 | 尚未正式啟用／執行 | MONITORING，未驗證 |

本session0/3；沒有自動排程Codex跟進或發訊息。Operator逐cycle記錄commit/run URL、原scraped timestamp/byte+canonical hashes、receipt、page及source counts、canonical changes/public held/public verification、elapsed/error/recovery。三次實際cycle及liveA/B/C全部通過前不可稱穩定上線。


### 可選private regression CI gate

`property-sync-acceptance.yml`的private_regression job在disposable四組先通過後，只有managed PROPERTY_SYNC_PRIVATE_REGRESSION_ENABLED=true才執行。Operator先在private property-sync-evidence release準備 exact原request asset `regression-28hse-20261001-request.json`（414631bytes／b458d085... SHA），另配置只讀該private repository contents的PROPERTY_SYNC_PRIVATE_REGRESSION_READ_TOKEN。此session沒有上傳asset、配置token或dispatch該workflow。Job驗repositoryprivate、asset完整/size、localbytes SHA及actualdisposabletarget，然後跑原ZIPreplay；不公開artifact，不用production/Blob/providercredential。缺資料時failclosed或gateSKIPPED，不能報PASS；本機exactZIPNeonPASS另有證據。這是可選CI回歸配置，不增加正式28Hse daily token權限。
