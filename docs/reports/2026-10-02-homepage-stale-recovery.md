# 2026-10-02 — 正式首頁 stale 恢復

## 結果及範圍

- **首頁當日放盤：READY（人工恢復已驗證）**。正式 www／apex 回讀及真 Chromium桌面／手機的「最新放盤」六張卡已由7–24天前改為當日幾分鐘前；新相片、link及盤號均從實際fresh ingestion/publication產生。
- **每日同步：VERIFICATION_BLOCKED；MONITORING 0/3；PAUSED**。本次是獲使用者授權的本機 operator shadow→canary，沒有 GitHub native run URL，不計 scheduled cycle。`PROPERTY_SYNC_DAILY_ENABLED=false`，managed evidence secret仍未存在。
- **Property.hk：BLOCKED_EXTERNAL**。先前四入口25頁真index證據仍保留；detail403及ID/scope/media完整驗收尚未通過。正式apply0，沒有推進其合併baseline或schedule。
- **後台受控重試：VERIFICATION_BLOCKED**。Vercel `PROPERTY_SYNC_WORKFLOW_TOKEN`及live登入角色驗收仍待完成；未把公開HTTP200視為登入驗收。

## 根因

正式首頁 HTTP200、Age0、`X-Vercel-Cache: MISS`，不是舊CDN頁。DB和accepted full receipt停在2026-09-24；daily開關false、private evidence automation token缺失。最新native scheduled run36943339534的六stage全部SKIPPED／0steps，沒有新request、receipt或publication。PR210已合併及部署，但部署程式不會自行匯入fresh盤源。

保留 `fetchFeaturedProperties` 的 newest排序：verified active source `first_seen_at`，再property creation；沒有改成routine `last_seen_at`排序，也沒有換假更新日期。普通listings排序沒有改动。

## 正式識別及原基準

| 項目 | 核對結果 |
|---|---|
| Repository/main | YNWAforever/earnestproperty；3432af370e75c0f378d7dd8b74ba02510f1b1107（PR210） |
| Production deployment | READY dpl_GBkJ6ZN8SVH3ZyUtJ2fM62FprmZu；GitHub deployment6799013534同SHA |
| Operator code | 520fd384b318aa7f38b557e045ec5729b24bb1c9；[PR211](https://github.com/YNWAforever/earnestproperty/pull/211) OPEN |
| Neon target | dawn-meadow-79190048 / br-polished-sea-aom4i1ct / ep-divine-frost-aokzrg7f；neondb；host ep-divine-frost-aokzrg7f.c-2.ap-southeast-1.aws.neon.tech |
| Source authority | 28hse_agent_540 / agent:540 / no-hermes-v2 / python-v2.2；publish_enabled=true；absence_enabled=false |
| Original accepted receipt | 60895ce3-6a1d-4225-84f1-455d6e47f181；279 ads；2026-09-24T21:45:54.421920Z |
| Original request SHA-256 | 6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e |
| Original archive SHA-256 | cb9e6a47c01c8b9a5d9f5d8d5d02ecad170b8b8269c3a37e1cb7858cdd302d83；private download、safe unpack、restore及正式authority核對PASS |

DB host guard及actual server db/branch/endpoint在寫入前核對；原 baseline不reset、不用Oct1舊ZIP冒充當日crawl。

## 同一fresh run的正式全鏈

Collector UUID：`fd5cb539-8d7f-4854-a801-0329d16e5f87`。原 `scraped_at=2026-10-02T01:44:32.218276Z`（香港09:44），整條鏈不變。

| Stage | Result | Actual evidence |
|---|---|---|
| Fresh collection shadow | PASS，exit0 | sale222／15頁＋終頁16；rent59／4頁＋終頁5；281ads／281offers；303HTTP原件；failed/rejected/duplicate0；full gate true |
| Advertisement diff | PASS | 49new、26changed、206unchanged、47absent；49source IDs不是49物業；47只是差異候選，撤盤0 |
| Bridge dry-run | PASS，exit0 | exactrequest full_snapshot=true，281/281；business writes0 |
| Private freeze | PASS，exit0 | request/raw/handoff均upload→download exactbytes及SHA核對；原採集時間保留 |
| Single guarded canary apply | PASS，exit0 | receipt7e1cb08f-5ac9-486a-9b27-0439bb44f4e6；22properties_created／6properties_changed／10fields_changed／138unchanged；full281、rejected0、duplicate0；沒有timeout盲重送 |
| Authority readback | PASS，exit0 | current full receipt及canonical request hash均匹配；original scraped_at unchanged |
| Accepted baseline | PASS，exit0 | operator UUID archive private download、safe unpack及restore exactrequest；見hash表 |
| Publication preview/apply | PASS，exit0 | ready15→attempted15（保留cap20/36h）；published14offers／13aliases；alreadyPublic192；held75；unknown0；eligibleBacklog1 |
| Public HTTP | PASS，exit0 | homepageVerified=true，detailsVerified13；checkedAt2026-10-02T02:14:45.665Z |
| Production browser | PASS，exit0 | desktop1440×1000＋mobile390×844：各6cards/6owned loadedcovers；14售租detail URLs的目標photo tab均200／owned圖片成功載入，共98rendered cover/thumbnail nodes（非98獨立照片）；含B057122售租兩offer |
| Protected records | PASS，exit0 | 原1185UUID/listing_no/非空canonical_property_no、648public aliases、1185memberships保留；原active沒有轉inactive；人工override／withdrawal／messages未變 |

正式總properties1185→1207，publicgroups648→665，publicmembers1185→1207。這是ledger/read-model總數，不把它們當本次published數。WhatsApp messages68、outbound intents1均不變；withdrawal batches0、admin overrides0。

新上架公開牌：A048391、B057122（sale/rent）、C004693、A034788、B072448、A054660、T027001、B052737、A056377、T026873、B052733、B048068、B051528。

首頁六張：A054660滿名山rent、B052737豪景花園sale、T027001碧堤半島sale、A034788星堤rent、A056377上源rent、C004693浪濤灣rent。沒有固定佔位或人工洗日期。

## 私有 byte evidence

所有raw／request／receipt／screenshots只在private `YNWAforever/earnestproperty-sync-evidence` 的 `property-sync-evidence` release；公庫只留摘要及hash。Operator使用既有CLI身份完成這次pin，沒有將CLI廣權credential複製成Actions secret。

| Asset | Bytes | SHA-256 | Private readback |
|---|---:|---|---|
| request-operator-fd5cb539-8d7f-4854-a801-0329d16e5f87.json | 407797 | 9592455f1be804631be0083d5fdfa71604081aedab1f9ad8b1c81f00304644c1 | exact PASS |
| raw-operator-fd5cb539-8d7f-4854-a801-0329d16e5f87.tar.gz | 44328553 | 8360bd7004a49e147cfedaa1a989ca82c720bf227ae134c5e1c9dd2c5580964d | exact PASS |
| handoff-operator-fd5cb539-8d7f-4854-a801-0329d16e5f87.json | 700 | 4dc00aba452a63be5115250715cd47217d7ccbea180c81a38ac9870f429f5ad0 | exact PASS |
| accepted-20261002T014432218276Z-operator-fd5cb539-8d7f-4854-a801-0329d16e5f87.tar.gz | 45249 | a6c16415381ef9572c16b18b26ebeab4204d88775fb503c6782f413e2d46def4 | exact＋safe restore PASS |
| verification-operator-fd5cb539-8d7f-4854-a801-0329d16e5f87.tar.gz | 1119332 | d327b0c00d7269ae3f1e22097b8d1c65572e4b7a34fd0a0e883b16936e0db4e6 | exact PASS；22proof/manifest files |

## 三指定盤及held原因（A06）

三個source IDs在當日fresh request都active，existing authoritative mapping正確；公開須另通過既有prerequisites，不能強制historical樣本上架。

| Source ID → company no | Current canonical state | Actual publisher decision |
|---|---|---|
| 4033913 → A072390 | draft；area306／sale3.48M | held staff_or_source_review，保留映射／職員核實門檻 |
| 4034357 → B059410 | inactive保留；area805／sale5.9M；existing21images | held not_imported_draft；不擅自reactivate原inactive |
| 4034591 → A057717 | draft；area404／sale3.95M | held media_review_required；actual DB記錄5eligible ownedwebp＋1upload_failed/blob_upload_failed；先reconcile Blob/record再受控重試 |

Held75分母保留：not_imported_draft41、staff_or_source_review19、area_or_estate_missing13、content_missing1、media_review_required1。沒有繞過人工鎖／review、假造內容／圖片或無限publisher迴圈。

## Focused code、tests及保留的失敗

PR211／commit520fd38使既有baseline選取、safe unpack及retention接受真operator UUID v4 archive，不假稱native GitHub run；仍綁原採集時間、UUID及後續authoritative receipt/hash/source/scope。Native timestamp/run/attempt排序保留；operator supporting objects保守保留。無migration或新writer。

| Check | Command / environment / SHA | Result |
|---|---|---|
| Operator regression RED | Python operator tests，original implementation，Windows noDB | 3新增case FAIL，exit1；保留失敗，不改壞行為為PASS |
| Python GREEN | npm run test:property-sync:python；Windows，520fd38 | 119/119 PASS，exit0，0skip |
| Focused recovery/retention | daily_artifacts＋evidence_retention Python suites；520fd38 | 26/26 PASS，exit0 |
| Daily/publication gates | npm run test:property-sync:daily；Windows actual Bash gate，520fd38 | 38/38 PASS，exit0，0skip |
| PR CI | [36952698557](https://github.com/YNWAforever/earnestproperty/actions/runs/36952698557)，520fd38 | ci／local PostgreSQL／handoff／no-link browsers PASS；browser-staging SKIPPED |
| Production canary/public readback | commands見下；verified production branch及public Chromium | PASS；不能以local/operator證據替代managed hosted Linux驗收 |

實際command（PRIVATE指向exact frozen檔，EXPECTED_HOST值只限上述正式target）：

```text
python scripts/property-sync/run_28hse_sync.py --root PRIVATE/shadow --dry-run
python scripts/property-sync/daily_artifacts.py freeze ...
python scripts/property-sync/daily_artifacts.py pin ...
node --env-file=MANAGED_DB_ENV scripts/mls/apply-source-snapshot.mjs --payload PRIVATE/request-operator-UUID.json --apply
node --env-file=MANAGED_DB_ENV scripts/mls/publish-daily-listings.mjs --payload PRIVATE/request-operator-UUID.json --report PRIVATE/publication.json
node scripts/mls/verify-sync-publication.mjs --report PRIVATE/publication.json --out PRIVATE/public-verification.json
node .task-logs/verify-live-recovery.mjs
node .task-logs/final-preservation.mjs
```

初次publication因本機DB env缺BLOB token在寫入前exit1：BLOB_TOKEN_REQUIRED。只核對linked Vercel特定Production BLOB_READ_WRITE_TOKEN metadata並讀該變量；secret只在childprocess memory，未寫檔／輸出／拉全環境。正式publication再執行exit0；未改任何secret/config。

首次browser assertion對whole main images包含舊「相關樓盤」A051491的Property.hk熱連結而FAIL，原report保留。source確認實際photo tab後，對14個新上架目標photo tab核對全部owned/loaded；這不是宣稱舊related-card圖片已修復。HTTP helper自己的browserVerification=BLOCKED_EXTERNAL仍保留，另以真Chromium report獨立證明此輪public browser結果。Authenticated staging/live角色仍SKIPPED/BLOCKED。

一次pin command早於本機freeze完成而argparse失敗，未upload/寫DB；等待exactfreeze完成後才正式pin。沒有以錯誤結果推進receipt或盲重試未知production結果。

## 啟用gate及rollback

1. PR211 reviewed merge（原使用者merge授權明確指定PR208，不擅自擴至新PR）。Main原版不能選本次operator accepted archive；先保留daily=false。
2. 建立fine-grained `PROPERTY_SYNC_EVIDENCE_TOKEN`：僅private earnestproperty-sync-evidence、Contents read/write；值直接設到**earnestproperty code repo Actions secret**。[建立／放置步驟](../runbooks/property-source-daily-recovery.md#managed-token-建立及放置)。不得把值貼chat。
3. 在reviewed main以受控hosted shadow驗私有upload/download/hash及current operator baseline/正式DB host；token metadata存在不等於可用，localHTTP成功不等於hosted來源完整。
4. 使用既有授權啟用daily，從下一個actual native scheduled全stage/publicproof PASS才開始1/3。三輪之前只報MONITORING；目前0/3。
5. Vercel workflow token/live角色是C gate；Property.hk合法detail/IDscope/media證據是B gate，不影響這次28Hse公開盤已恢復。

本輪没有merge/deploy、新migration、managedsecret/config修改、daily啟用、bulk撤盤、真WhatsApp/email或無關cron改動。PR210先前human merge後的正式app承接既有canary ingestion/publication。

若後續有異常，按source停止新daily/manual/dispatch/publication/absence；對已開始transaction及receipt做read-only reconcile；保留accepted原request、media、UUID/aliases/override/history。禁止reset到Sep24、改scraped_at、啟舊writer或刪history。錯誤盤只經reviewed compensating action修正。[Rollback runbook](../runbooks/property-source-daily-recovery.md#rollback需operator正式變更授權)。

## PR211 授權合併及正式部署 — 2026-10-02T02:42Z

- 使用者於本chat另明確授權「CI通過後合併PR211」。Approved head7b67aead24e62d5aefae848a8f597b31c7f1a325的CI36956056478 COMPLETED/SUCCESS；ci、localPostgreSQL、handoff及no-link browsers SUCCESS，browser-staging SKIPPED。
- Exact-head guard squash merge exit0；PR211 MERGED at2026-10-02T02:38:38Z，main96f2ba88e59152751d9e1c3a5b8da8ebffbc52de。原reviewed code520fd38及docs7b67aea已進main；本報告上方「PR211待merge」為較早gate歷史，該gate現已解除。
- Vercel production dpl_DLqFju38UgL6PzNQ3N5bbTUR2iiu READY，同96f2ba8；actualalias包含www.earnestproperty.com及earnestproperty.com。GitHubProduction deployment6799998254同SHA。Windows CLI只讀metadata首次有cp950／batch query解析失敗；改用UTF-8及已安裝NodeCLI直接參數後readback PASS，未觸發額外deploy。
- Post-deployment public HTTP回讀2026-10-02T02:42:14.436Z：homepageVerified=true、detailsVerified13；www/apex200、Age0/MISS，六卡30–33分鐘前更新。先前14detailphoto tabs＋desktop/mobile真Chromium PASS仍獨立保留；沒有宣稱登入browser PASS。
- Main CI36956576544仍IN_PROGRESS（此時snapshot），不宣稱main完整CI已PASS。合併條件是上述exactPRhead CI成功，已滿足。
- Secret names唯讀仍只有BLOB_READ_WRITE_TOKEN及DATABASE_URL_UNPOOLED；PROPERTY_SYNC_EVIDENCE_TOKEN尚未配置，daily=false。Managed hosted shadow/privatepin驗收尚未執行，0/3；未啟用blocked daily。PROPERTY_SYNC_WORKFLOW_TOKEN/live角色與Property.hk gates仍獨立待完成。
