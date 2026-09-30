# 推廣群組及 queue 結果修復驗證（T12／T14）

產品／測試 commit：`8f5310e02d9768a9008fac3a217b0a5943fd7921`。沿用既有 TanStack `/admin/blasts`、Neon raw SQL、campaign recipient／queue／ops_jobs／audit 與 Woztell delivery；沒有新增另一套發送系統。對應 T12 BL01–08／UC16、17；每項 local 證據與 full acceptance 分開。

## RED → 修復 → GREEN

- 完整本地 Postgres RED：campaign 沒有 saved audience 時，materialize 仍把 null filters 轉成無篩選條件，讀取全部 7 個聯絡人並返回 ok。現 JOIN 結果必須有實際 audience，否則 `AUDIENCE_NOT_FOUND`，不讀取全庫候選、不寫 recipient／audit。GREEN fixture 另有明確 opt-in 的全庫候選，仍零 recipient／audit，campaign 保持 review。
- 第二個 Postgres RED：先 materialize 合法群組，再刪除群組，舊 queue SQL 仍建 delivery job、status queued。現 queue 寫入 WHERE 同時核對 current audience 存在，沒有群組則 `CAMPAIGN_NOT_ELIGIBLE`，零 delivery job，保持 review。重新連上合法合成群組後，兩個實際 pool calls 同時 queue 只一個成功、一筆 queue audit及一個 ops_job；後續 retry 被既有 status guard 拒絕。
- Browser RED：queue 成功顯示「已發送」、pending 仍可更改 provider 覆核勾選、timeout 仍顯普通錯誤並可再確認。現只顯「已加入發送佇列」及送達須另核對；pending 鎖勾選／取消，同步 guard 防同一事件迴圈 duplicate。
- 任一 queue error／未知結果先鎖定所有新 queue，清除舊 preview stamp，提供「重新載入 Campaign 狀態」。讀回只走原 authorized campaign/options reader；失敗或沒有目標列仍鎖定，沒有 resend。關閉確認窗仍保留同一頁的 recovery 入口。成功讀回後清除舊人數及覆核勾選；只有重新 preview、重新確認才可開始下一次明確操作。
- 追加 Browser RED：保存後的編輯視窗仍採用 draft.status，讀回已 queued 後再次顯示可發送。現依目前 row.status 核對，保留表單草稿並提示「目前 Campaign 狀態不能加入發送佇列」。requestSend 亦核對現時 row status。
- 原來已修好的 pristine close、同名群組用途／更新日、無範本、inactive template、stale preview、手動計劃時間與1280px去重統計，在此次 real-route fixture 補正向證據，沒有為舊 finding 盲改。統計顯示4總數、2電話去重合資格、2按收件人去重排除；原因可重疊。

沒有 migration／manifest、package／dependency、runtime config、activation 或 HTTP payload 變更。所有78 migrations保持原檔，沒有 production apply。既有 consent／identity／status／template／permission／idempotency guard保留，沒有 provider send、真人訊息、deploy 或 merge。

## 分層結果

| Command                                             | Exit／結果                                      | 環境／SHA                                                                                       |
| --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm.cmd run acceptance:whatsapp-no-link:synthetic` | 0；69/69；零 skip                               | committed `8f5310e`；Windows Node24.18.0／Chromium151.0.7922.34；實際routes／synthetic Auth/API |
| `npm.cmd run test:no-link:local-postgres`           | 0；11/11；零 skip                               | committed `8f5310e`；owned pinned loopback Postgres17，78 full migrations                       |
| `npm.cmd run test:no-link`                          | 0；99 Node/PGlite＋9 Bun；零 Node skip          | committed `8f5310e`；不讀 live DB                                                               |
| `npm.cmd run test:woztell`                          | 0；151 Node＋8 Bun；零 Node skip                | 最終產品 patch 提交前；Windows                                                                  |
| `npm.cmd run test:whatsapp-enquiries`               | 0；103/103；零 skip                             | 最終產品 patch 提交前；含既有links／batches／partial／mapping regression                        |
| `npm.cmd run test:command-center`                   | 0；82 Node＋8 Bun；零 Node skip                 | 最終產品 patch 提交前；Windows                                                                  |
| `typecheck`／`lint`／`build`                        | 全部 exit0；lint 3個既有 React Refresh warnings | 最終產品 patch 提交前；generated routeTree無語義差異，已還原                                    |

JSON：`2026-10-01-campaign-browser-results.json`。原57 cases保留，新增12 campaign cases：queue狀態用語、pending／duplicate、lost response／讀回失敗／reload、pristine close／cancel／同名用途、stale preview、failed preview／inactive template、denied model actor、unknown close、refused queue後重新read/preview/confirm、saved draft讀回、missing template無寫入及desktop統計。

Browser `syntheticCampaignQueue`／`syntheticCampaignSave`只改 test sessionStorage；沒有真正 Auth、HTTP mutator、SQL job 或 provider，Runner禁止外部／mutation network requests。Model actor deny 是介面證據。真server handler/Postgres的群組與CAS證據另外記錄，actor inputs仍合成，未經真Auth HTTP。

Node test-only resolver補足Vite的extensionless TS／本repo alias解析；不修改或抽取production source。DB module adapter的query／transaction實際使用同一 owned Postgres pool，沒有接受remote URL。首次import setup失敗不算product RED；desktop case最初用了錯誤label，改為核對已有HK文案與實際數值，沒有放寬行為。

RED logs：`.audit/campaign-materialize-red-resolved.log`、`campaign-queue-race-red.log`、`campaign-browser-red.log`、`campaign-draft-readback-red.log`。作者按單一agent自我審查，沒有獨立reviewer。

## 分母及外部 gates

原1277 audit rows／1261 source occurrences／18 UC／76 AC全部保留。新增一個queue readback候選：總1296。Presentation21/1296；完整角色／DB action acceptance **0/1296**（817 BLOCKED_EXTERNAL、479 NOT_TESTED），完整UC **0/18**。新增presentation只標8個已實際操作的original campaign controls、manual template review及readback；沒有把wrapper、delete、campaign cancellation或真provider覆核冒充已驗。

已核准範本全文／provider版本仍未取得，現有 `preview_unavailable`與人工Woztell覆核保留；勾選並非verified provider preview。Queue不是accepted provider request、delivered、read或human reply。此修復不加入自動排期。

Recovery鎖只保存在目前頁面；跨tab／route leave／reload不保證保留未知UI狀態，重新開啟須先讀現時campaign／job／recipient evidence並重新覆核。未找到列、scope變更或provider outcome unknown需要授權support reconcile，不能用刷新當成沒有寫入或盲重送。現有SQL status CAS防重queue及recipient `WOZTELL_DELIVERY_UNKNOWN`保護仍保留。

仍需真Auth的成功／直接越權HTTP、隔離Neon多session／角色／inactive／refresh／下一actor、tenant範本body/media/buttons/version及目的地、provider outcome reconcile／delivery證據。所有正式critical journey狀態維持原readiness表：PropertyHK自動mapping NOT_READY，其餘VERIFICATION_BLOCKED。無production授權；shadow→review→canary→production及effects-off rollback依runbook，保留recipient/job/audit/unknown證據，不drop或盲重送。
