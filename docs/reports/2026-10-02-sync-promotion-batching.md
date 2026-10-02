# 每日同步 T3：推廣證據批次寫入驗證

日期：2026-10-02（香港）；程式 commit `21c7cc96b083c887ef0517efde59a3f55cd86940`，基於已合併 main `a494782ea7ae8529b7dad4e7169a82c45377ff79`。狀態：**DEPLOYED／SCHEDULED_VERIFICATION_PENDING**。

以下本機測量及原「正式 readback」保留為合併前紀錄；最新部署 checkpoint 見文末。

## Finding 與修復

已通過的 hosted canary 匯入 job 用時 924 秒；worker 子程序仍維持原有 900 秒限時。按 systematic-debugging 追查，推廣級別保存雖已一次讀取舊級別，仍逐筆 INSERT。這是可量測的其中一段耗時，不能據此斷言整段匯入已達到新的正式時限。

使用合成的 281 個 source/deal offers，在已核對實際 server identity 的 disposable Neon、connection-local temporary table 重現：原程式 282 次 DB requests／27333ms。新程式採用現有 caller connection 的 parameterized SQL，每批最多 250 筆；初次 green 為 3 requests／601ms，完整回歸中的最後測量為 3 requests／161ms。這些是此環境的局部測量，不是 production SLA；281 不代表新增 281 個物業。

重複 identity 在同一批內先 flush，保留先後次序及每個已接受 observation 的 schema checks，避免 multi-row upsert 的重複 key 錯誤，也不以最後一筆掩蓋較早的 invalid evidence。partial snapshot 會記住本輪已接受的升級：原程式在舊 normal 下先收 gold 再收 pinned，錯誤降回 pinned；新增正向 regression 先 RED，修復後保留 gold。完整 snapshot 仍可按觀察降級。sale/rent、raw grade、原始微秒 timestamp、observation UUID、unknown 與 skipped 語義分開驗證。

## 測試證據

以下均在此程式 tree 執行，exit 0；PASS、零 skip。完整 logs 與環境身份保留私有。

| Command／層級 | 結果 |
|---|---|
| `npm.cmd run test:mls` | PASS 643/643 |
| `npm.cmd run test:property-sync` | PASS 75/75 |
| `npm.cmd run test:property-sync:daily` | PASS 38/38 |
| `npm.cmd run test:listing-priority` | PASS 38/38 |
| `npm.cmd run test:property-sync:python` | PASS 122/122 |
| `test:property-sync:db` 的完整八檔 Node command，protected disposable env 注入 | PASS 47/47 |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS exit 0 |
| touched files Prettier check／`git diff --check` | PASS |
| disposable readback | properties 0；remaining custom schemas 0 |

DB command 實際使用 `node --env-file=.task-logs/.env.test-target --test --test-concurrency=1`，檔案集合與 `package.json` 的 `test:property-sync:db` 相同。此 env 檔為 ignored 私有配置，未提交。新增真實 SQL suite 已加入既有 DB runner；deterministic budget／partial duplicate regressions由既有 MLS及listing-priority CI 執行。

RED 證據：原 DB budget subtest 在 282 requests 失敗（exit 1）；unit budget及partial duplicate兩項失敗（8 pass／2 fail，exit 1）。既有正向斷言保留。GREEN 的真實 SQL包含跨 chunk／同 chunk duplicates、invalid observation不得被丟棄、late failure caller transaction rollback、sale/rent分隔及非空 observation UUID。完整 ingestion DB 回歸另驗 canonical UUID／aliases、manual overrides、source precedence、writer locks、quota／stale gates、receipt replay及lost commit acknowledgement。

環境工具問題亦有區分：系統 Python 缺 BeautifulSoup 的首頁 readback 改用既有 collector venv後成功；私有 edit helper 的 cp950問題改用 UTF-8後重跑 RED。這些不是 product tests PASS 的替代證據。

按使用者要求單一 agent 執行，作者另作 diff review；沒有啟用子代理。沒有未解決的 code review finding。合併前仍需正常 PR CI gate。

## 正式 readback 與未完成項

本輪核對 PR213 已合併、main CI SUCCESS、production READY及兩個正式 aliases；main相對前一正式程式只有驗收文件差異。首頁 www/apex HTTP200，六張最新卡顯示約 8 小時前更新。當前 accepted summary仍為281 advertisements／281 offers、canonical created0／changed0／unchanged165；指定三盤為 A072390 draft、B059410 inactive、A057717 active。沒有在本輪重新採集或apply。

| Journey | 狀態／剩餘 gate |
|---|---|
| 28Hse collect→private freeze→ingest→publish→public | 上輪 hosted shadow／canary PASS；daily已啟用，**MONITORING 0/3** native scheduled cycles |
| 本次 performance fix | 本機／隔離 PASS；**NOT_DEPLOYED**，尚待合併授權、CI、部署及實際耗時觀察 |
| Property.hk EPS／EPT／EPW | **BLOCKED_EXTERNAL**：合法 index evidence已有；detail403、完整地區及ID scope／detail authority尚未驗收 |
| 後台同步／受控retry | **VERIFICATION_BLOCKED**：Vercel Production workflow token metadata仍缺；真實authenticated roles驗收未完成 |

保留所有未測項在分母。manual／replay不計為 scheduled；三次真實 scheduled未完成不能宣稱穩定上線。

## Migration、config及回退

本輪沒有 migration、production data/config mutation、deploy、workflow dispatch、批量撤盤或真實WhatsApp/email。原120／20／45／10分鐘各 job budgets、20次 publication attempts、36小時 freshness、canonical writer／locks、staff overrides／source priority及absence-off不變；不啟用舊writer。

若日後此 PR獲准合併部署而需回退，透過reviewed revert本次程式commit並部署上一已驗版本；保留receipt、current baseline、IDs、media及私有證據。未知commit結果按既有recovery runbook先read-only reconcile，不盲重送、不再次爬取。局部SQL加速不取代三次實際 scheduled及public verification。


## 2026-10-02T11:46Z 正式 checkpoint

[PR214](https://github.com/YNWAforever/earnestproperty/pull/214) 已由使用者合併至 main `be7710b24920952195ee9e71d115907ebecbdf32`，與測試通過的 PR head tree 相同。Exact main CI [37001281583](https://github.com/YNWAforever/earnestproperty/actions/runs/37001281583) 的四個必需 jobs PASS；browser-staging SKIPPED。Production 同 SHA READY、兩正式 aliases 核對；真 Chromium 正式 desktop／mobile 各 6 張首頁卡與 cover、7 個詳情頁及 49 個已載入 gallery image nodes PASS。

Guarded SQL 唯讀核實 accepted full 原時間／receipt／request hash 及三指定盤狀態保持；沒有新 ingestion／publication。本次 batching 已部署，但整段正式 ingestion 耗時仍等待真正 scheduled cycle，不能以局部 3 requests 測量代替。Daily 啟用、manual apply 關閉，**MONITORING 0/3**；Property.hk detail/scope 及後台 workflow token／真角色仍獨立 blocked。最新 credentials metadata 是 87 個可見變數、hidden Production count 0，未見 PROPERTY_SYNC_WORKFLOW_TOKEN。

完整逐層結果、保持不變的限制及 rollback 見 [release checkpoint](2026-10-02-full-sync-release.md)。原尚未部署／待合併句子只適用於上方歷史 snapshot；本輪沒有新增 migration、資料 apply 或 operator deploy。
