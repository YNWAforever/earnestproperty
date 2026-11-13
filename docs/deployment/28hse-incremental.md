# 28hse 每日增量同步

公司範圍為 `agent:540` 的售盤及租盤。每天讀完整列表及終頁證據，只抓新 ID、列表有效資料有變、重試項目及到期的定期校驗詳情。來源沒有可驗證的更新時間時，記錄為 unknown；不以相對時間、瀏覽數或列表位置判斷更新。

## 排程及開關

沿用 [Daily property sync workflow](../../.github/workflows/property-sync-daily.yml) 的香港 09:00 排程（UTC `0 1 * * *`，Actions 可以延遲）。增量與舊有 owner publication 使用獨立 gates；舊的手動 full collector 仍保留。

| Repository variable                                    | 初始／預設    | 用途                                                       |
| ------------------------------------------------------ | ------------- | ---------------------------------------------------------- |
| `PROPERTY_SYNC_28HSE_INCREMENTAL_ENABLED`              | false／未設定 | 每日 live 增量 apply，亦供 watchdog 選擇增量健康基準       |
| `PROPERTY_SYNC_28HSE_INCREMENTAL_MANUAL_APPLY_ENABLED` | false／未設定 | 手動 incremental apply；不會開啟舊 full apply              |
| `PROPERTY_SYNC_INCREMENTAL_MAX_DETAIL`                 | 100           | 單次詳情請求 URL 上限                                      |
| `PROPERTY_SYNC_INCREMENTAL_MAX_REQUESTS`               | 250           | 實際 provider HTTP attempts 上限，包含 retry／key failover |
| `PROPERTY_SYNC_INCREMENTAL_CACHE_TTL_DAYS`             | 7             | 定期校驗年齡；不是把快取重新標成新資料                     |
| `PROPERTY_SYNC_INCREMENTAL_MAX_REFRESH`                | 40            | 每日最多校驗的 index 未變舊詳情；新／變動／重試項目優先    |
| `PROPERTY_SYNC_28HSE_INCREMENTAL_STALE_HOURS`          | 30            | 每日增量的新鮮度閾值                                       |

沿用已配置的 approved branch、DB host、python-v2.2 policy、private evidence repository/token、Production 的 Firecrawl primary/backup key、DB 及 Blob secrets。不在 repository variables 或日誌保存 secret 值。

## 執行

只在 main 上執行；功能合併前，default branch 不會認識新 modes。

```powershell
# 新的 live 抓取；正式 inventory 不寫入，會消耗本輪必要的 Firecrawl 用量。
gh workflow run property-sync-daily.yml --repo YNWAforever/earnestproperty --ref main -f mode=incremental-shadow -f scope=agent:540

# 取得真實 run ID，讀 Summary 的 privateBundle 與計數。
gh run list --repo YNWAforever/earnestproperty --workflow property-sync-daily.yml --limit 5
```

覆核私有 evidence 的新／變動項目及 dry-run 後，operator 開啟 manual incremental gate，再指定該次 shadow 的確切 bundle（不是重新抓取另一份資料）：

```powershell
gh variable set PROPERTY_SYNC_28HSE_INCREMENTAL_MANUAL_APPLY_ENABLED --repo YNWAforever/earnestproperty --body true
gh workflow run property-sync-daily.yml --repo YNWAforever/earnestproperty --ref main -f mode=incremental-apply -f scope=agent:540 -f replay_asset=incremental-bundle-<SHADOW_RUN_ID>-<ATTEMPT>.tar.gz
```

首輪正式 receipt、保護規則、公開頁驗證及 cache readback 通過後，才啟用 daily gate：

```powershell
gh variable set PROPERTY_SYNC_28HSE_INCREMENTAL_ENABLED --repo YNWAforever/earnestproperty --body true
```

連續三個真實 scheduled incremental cycles 才算每日排程驗收完成。手動 canary 和 owner capture 重播均不計入。日常完全沒有新／改動時，detailFetched=0 亦應成功。

## 快取及寫入規則

- 首次從 production 權威 full receipt 對應的已接受 request 及 immutable raw handoff 初始化；以 bytes/hash 及 collector identity 對帳，支援 native／operator accepted archive。找不到匹配證據就停止，不退回任意舊快取。
- 完整 index membership 與 fresh detail records 分開。unchanged cached facts 不放入本輪寫入；index_seen_at、detail_fetched_at、source_updated_at 分開記錄。
- 有效增量永遠是 partial：不推進 full_receipt_id/full_count，不按本輪未重抓／缺席推斷下架。完整列表缺席只列 withdrawalCandidates，須另外核實。
- 新／變動／重試先處理；到期校驗按最舊優先並分批。已知必要詳情超出 hard cap、index 不完整或 detail 失敗會停止該輪 apply；不能硬改成 full／成功。定期校驗的 deferredRefresh 另列，保留舊詳情驗證時間。
- 既有公司物業編號＋租售身份、ownership fence、manual/admin override、inactive/draft 保護沿用。新 canonical 保持 draft，只有符合既有媒體／屋苑／人工保護規則的項目才能上架。
- 發佈仍有每輪 20 個媒體嘗試上限。因 daily_publication_limit 未嘗試的項目會帶進下輪 retry；需要人工／媒體 review 的 holds 保留人工處理。
- input/raw/cache-next 先封存私有 bundle 並 hash readback，才讓 DB stage 接觸。成功 receipt、publication 和 public verification 後，再寫 immutable acceptance marker。只允許 DB 最新 accepted receipt 對應的快取成為下輪基準。
- COMMIT 回覆遺失或 apply bridge 結果不明，先按相同 scraped_at＋payload hash 只讀查 receipt。查到完全匹配的 successful incremental receipt 才恢復；不能確定則維持 unknown，不自動第二次 apply。之後 operator 可指定原 bundle 做受控對帳／重播。

## 日誌及健康

[GitHub workflow 歷史](https://github.com/YNWAforever/earnestproperty/actions/workflows/property-sync-daily.yml) → run → incremental job／各 step。Summary 和公開 artifact `incremental-summary-<run>-<attempt>` 只包含安全計數、時間及證據參照；完整 request/raw/cache/receipt/publication report 都在私有 evidence release。

每天看 indexComplete、detailCandidates/detailFetched、unchangedSkipped、pendingDetails、deferredRefresh、providerRequests、created/updated、published/held、publicationRetries、withdrawalCandidates 及 receiptId。created/updated=0 可以是正常無變動；pendingDetails>0 或 source health stale/unknown 須處理。

[後台盤源同步](https://www.earnestproperty.com/admin/property-sync) 分開列最後增量匯入及最後完整匯入。增量健康以獨立 accepted incremental 時間計算，不冒充 full receipt 已刷新。

[獨立 watchdog](../../.github/workflows/property-sync-watchdog.yml) 預設每天 08:15 HKT，只讀 DB；增量啟用後用 30 小時閾值。stale/unknown/never_synced 會令工作失敗，避免檢查程序成功卻只顯示綠燈。

暫停增量每日寫入：將 daily incremental gate 設為 false。暫停手動增量寫入：將 manual incremental gate 設為 false。這兩個開關不改變舊站的 OLD_SITE_SYNC_APPLY，亦不開啟舊的 PROPERTY_SYNC_MANUAL_APPLY_ENABLED。
