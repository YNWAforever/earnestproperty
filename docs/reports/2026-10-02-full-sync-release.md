# 2026-10-02 每日盤源同步 release 執行紀錄

此紀錄更新 2026-10-01 報告的正式狀態；舊報告保留為當時證據。使用者本 session 已授權 PR208、runbook 兩個 migration、部署、shadow/canary、通過後每日同步及三次監測。批量撤盤及真實 WhatsApp/email 仍禁止。

## 已執行及 readback

- [x] PR207 及 PR208 已合併；PR208 由 repository maintainer 於 2026-10-01T17:02:55Z 合併，merge SHA `cbcab28d2d319218afabaa46d0ec54e8446f4b44`。本 agent 核對並沿用，沒有重複 merge。main CI run `36896501015` SUCCESS。
- [x] 在任何新同步前，設定 `PROPERTY_SYNC_DAILY_ENABLED=false`；GitHub variable readback 一致。
- [x] 建立 private repository `YNWAforever/earnestproperty-sync-evidence` 及 `property-sync-evidence` release；設定 code repo `PROPERTY_SYNC_EVIDENCE_REPO` 並 readback。
- [x] 從舊 release 找回原 Sep24 accepted archive、exact request、unresolved raw archive；安全 unpack/restore 與 manifest 通過。三件原 bytes 已存私有庫，重新下載 SHA/size readback 3/3 PASS。
- [x] 正式唯讀權威核對：source `28hse_agent_540`、scope `agent:540`、policy `no-hermes-v2`、parser `python-v2.2`、receipt `60895ce3-6a1d-4225-84f1-455d6e47f181`、full success、279 ads。原 scraped_at `2026-09-24T21:45:54.421920Z`，沒有改寫時間。精確 request SHA/canonical hash `6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e`。
- [x] 只套用 runbook 指定的 `20261001120000_property_sync_operations.sql` / `20261001130000_property_withdrawal_review.sql`。用既有 guarded helper 依序 dry-run / `--check` / `--apply`，exit0，hashes 與 manifest 一致；同 transaction 記錄 app_migrations。
- [x] 正式 DB identity：`ep-divine-frost-aokzrg7f.c-2.ap-southeast-1.aws.neon.tech` / `neondb` / `br-polished-sea-aom4i1ct`。DDL 前後 properties=1185、public members=1185、source links=356、manual overrides=0；property/status fingerprint 同為 `f4c1ecb02c388de66ed1b5f4eb504e5a`。新增 sync_runs=0、withdrawal_batches=0。沒有樓盤 DML。

## 原 baseline 私有回讀

| Asset | Bytes | SHA-256 | Readback |
|---|---:|---|---|
| accepted-20260924T214554421920Z-36062151356-1.tar.gz | 46599 | cb9e6a47c01c8b9a5d9f5d8d5d02ecad170b8b8269c3a37e1cb7858cdd302d83 | PASS |
| request-36062151356-1.json | 404131 | 6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e | PASS |
| unresolved-36062151356-1.tar.gz | 22395358 | ec27bc37cac6be73e00aabf5ba63a61faef3e8c6acb2ec8013594cee3d9028ae | PASS |

Sep24 native run 的 artifact quota 失敗不代表 ingestion 未 commit；原 accepted release assets 仍存在，已由正式 receipt 核實。沒有以 Oct1 ZIP 或新 crawl 取代舊 baseline。

## 部署安全修復

PR208 merge 的 Vercel deployment `dpl_2Phc1PmcsLMj7nF2tzt53HuUHik9` 在 build 後被 vulnerable TanStack Start 檢查拒絕。依 [GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8) 升級 react-start 至 1.168.60、start-server-core 至 1.169.39；配套 router 1.170.41。沒有設定 vulnerability bypass。修復 commit `c2baec6`。新 error boundary 的 unknown 型別先 narrow 再顯示，保留繁中 fallback 及 retry。固定 formatter 至原 lock 3.8.2，避免無關程式格式改動。routeTree 為新版 generator 產物，沒有手改。

首次 Vercel inspect 正式 alias 仍指向 READY `dpl_H8H6GyJoacWBfSDPruP5GAvR4qG4`；不能將已 merge 當成已部署。

PR：[209](https://github.com/YNWAforever/earnestproperty/pull/209)。

### 測試與環境

- RED：Vercel merge deployment 安全檢查失敗；升級後 typecheck 揭示 error boundary 的 Error/unknown 相容性問題。
- GREEN：修正後 `npm run typecheck` exit0；`npm run build` exit0；`npm run test:property-sync:daily` exit0，37/37、0 skipped。
- 首次 lint 因 npm 解鎖到 Prettier3.9.9 產生 21 個無關格式錯誤；已恢復原鎖定版本，`npm run lint` exit0，0 errors/3既有warnings。
- 首次 isolated public browser 因本機 app readiness timeout exit1；精確 fixture cleanup readback properties/groups/members/inquiries 均0。單獨本機 mortgage HTTP200；停止並行 build 後用未改動 runner 重驗 exit0，23/23 browser PASS、0 skipped/0 flaky（140.2s），cleanup 全0。首次啟動失敗保留，確切當時原因未能由 runner 隱藏的輸出確定，不把它改記 PASS。
- 所有 browser DB fixture 僅在重新核對的非 primary/default/protected branch `br-young-breeze-ao85rtx1` / `earnest_audit_acceptance_20260927` / endpoint `ep-square-leaf-aobruyvf`。正式 DB 不接受 fixture。

## 仍未通過的 gate

1. **Managed automation capability**：GitHub `PROPERTY_SYNC_EVIDENCE_TOKEN` 尚未配置；需僅 private evidence repo Contents read/write。Vercel `PROPERTY_SYNC_WORKFLOW_TOKEN` 需僅 code repo Actions write。現有 gh CLI 身分不能當作已接通 automation，不複製廣權 token。不要在 chat 貼 secret。
2. **公開歷史證據**：舊 public release 有50件、138531553 bytes。automatic approval review 最初因整批可能含 raw/contacts 且缺 exact payload 授權而拒絕；user 隨後明確授權複製及核對全部50檔。原50件皆核對GitHub原digest後複製到指定private repo，再下載核對，50/50 PASS（19 accepted、23 request、8 unresolved）。公開副本尚未刪除，等待精確清單cleanup授權。
3. **Property.hk**：EPS/EPT/EPW 原 SID/page1→terminal/real HTML-feed、IDscope、media rights 未提供及核實。所有 source flags/policy/schedule 維持未啟用；synthetic PASS 不代替真實接駁。沿用前次正常存取403證據，未繞過 challenge。
4. **其餘 migration drift**：唯讀 check 仍列10個 WhatsApp migration。它們不在本次指定兩檔授權內，沒有自動執行全 repo migration。此 drift 必須與盤源 migration 已套用分開報告。
5. **正式完整鏈與登入**：shadow/canary、正式角色登入/readback、當前3指定盤/source/photo、公網新版結果及三次 scheduled cycles 尚未完成。

## 來源與 cycle 判定

| Journey | Status | 實際狀態 |
|---|---|---|
| A28Hse | VERIFICATION_BLOCKED | 原 baseline/private copy/兩migration PASS；schedule PAUSED；managed token/security deployment/manual fresh E2E 未通過 |
| BProperty.hk | BLOCKED_EXTERNAL | 三分行真入口及 real contract 未核實；production apply0 |
| C盤源同步 | VERIFICATION_BLOCKED | schema 已準備；待新 deployment、managed dispatch capability、live roles；withdrawal off |
| Daily cycles1/2/3 | MONITORING 0/3，未開始 | 只有 manual E2E 通過後才 enable；沒有虛報任何 scheduled run |

## 回退與限制

保持 `PROPERTY_SYNC_DAILY_ENABLED=false`、admin dispatch/review off；保留兩個 additive migrations、private copies、accepted receipt/UUID/public numbers/人工 overrides。禁止回退到已知 vulnerable Start 版本；若新 app 驗收失敗，暫停 rollout 並修補。未知 ingestion/publication outcome 先 read-only reconcile，不改 scraped_at、不 recrawl 下游、不盲重送。20次 publication attempts、36h freshness、120/20/45/10分鐘 budgets 仍在。没有批量撤盤、真訊息、Property.hk正式啟用或無關cron變更。
