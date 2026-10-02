# EP-08 — 28Hse 配置讀回及每日排程驗收

核對 main/audit base `51cb0e9c08269ebabeb0b593d4dea611b9246c32`：現有 collect/ingest/publish/verify 為 120/20/45/10 分鐘；cron `17 20 * * *` 是香港 04:17。沒有按過時的手動-only／60 分鐘假設改 workflow。

2026-10-03 本輪 GitHub variables 唯讀核對：DAILY_ENABLED=true；MANUAL_APPLY_ENABLED=false；EXPECTED_BRANCH=main；POLICY_APPROVED=python-v2.2；EVIDENCE_REPO=YNWAforever/earnestproperty-sync-evidence。daily enabled 在 2026-10-02T06:36:30Z 更新。沒有修改任何 variable/secret。

| run ID | event | conclusion | SHA | 驗收計數 |
|---|---|---|---|---|
| 36972256552 | workflow_dispatch | success | d1eb1c08b446d589c20aa9ef2caaa43ef88153f0 | 0 |
| 36971886350 | workflow_dispatch | success | d1eb1c08b446d589c20aa9ef2caaa43ef88153f0 | 0 |
| 36968501981 | workflow_dispatch | success | 96f2ba88e59152751d9e1c3a5b8da8ebffbc52de | 0 |
| 36943339534 | schedule | skipped | 2e98167a6545198ffc3fda2f1470affd1fbd2911 | 0 |

最新 manual run 的 collect/ingest/publish/verify/record jobs 成功；這是 workflow metadata，不能代替其 private frozen evidence/accepted baseline/public DB 同版本讀回。先前 schedule 成功在舊版本，不計新修復的 3 次。

本地：daily Node38、Python122、sync-admin Node17 PASS；source-sync real-component synthetic browser46 PASS。owned publication/replay 另有 4 PASS；Golden C 將受控改價→canonical→durable AI repair→fresh retrieval 串起來。這些不叫 native schedule。

仍待 readback：private store 實際讀寫 scope/checksum、production DB target metadata、最近 full accepted snapshot/hash、每來源完整成功與 public verification 時間。沒有 credentials，不以 secret 名稱存在當 capability-ready。現值配置方案先保持不變；取得證據後才評估是否需變更。

G08：0/3 eligible native schedule，NOT_READY。交接由盤源 owner 保存每次 event=schedule 的完整成功與同 run 公開讀回；manual/replay/skip 只作診斷。尚未部署本修復，所以本修復版本不可有正式三次證據。本回合結束後不自行監看。

回退停新 apply，保留 frozen evidence、receipts、accepted snapshot 與人工 overrides，從原 checkpoint 恢復；unknown apply 先讀原 operation。不可把 ingest success 蓋過 held/publish failure。
