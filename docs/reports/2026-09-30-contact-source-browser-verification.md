# 客戶聯絡資料及相關對話修復驗證（T10／T14）

## 已重現及修復

產品／測試 commit：`6a76a33e73f8b60248b528c40f55fe1ba5eaa9e5`。Findings LE01–05、UC11／13；沿用現有 TanStack CRM route、Neon raw SQL、contact update function、audit 及 WhatsApp scope。

- `/admin/leads` 只 import 聯絡資料 editor 與相關對話元件，沒有 render。兩個新 browser cases 均因找不到編輯入口而 RED。現為已連結 contact 顯示姓名／電郵表單，讀取已授權的相關對話；沒有 contact 的人工轉交查詢顯示核實狀態，不假建客戶身分或回覆目的地。
- 舊 HTTP 更新路徑不核對 contact ID／開表單時的姓名和電郵。PGlite 三項 regression 先全部 RED。現 server 在同一 SQL statement 鎖 lead、鎖 contact、再核對 snapshot，沿用不可修改的 `wa_update_lead_contact` 函式執行及寫 audit。過期修改或 contact pointer 改變返回 409；當 desired 值已是 current 值，相同 retry 不再寫 audit。現時 actor active、role、lead owner 及 shared-contact 權限仍須通過，403／400 拒絕沒有寫入。
- 保存期間停用欄位及取消，同步 guard 阻止重複提交。保存／讀回的遲到 callback 在離開 route 後不能重新開舊 lead。只更新 detail 的 contact 欄位，保留未保存的預算、內部備註及跟進紀錄草稿。
- 保存回應未知、過期或成功後讀回失敗，鎖定表單並提供「重新載入聯絡資料」。讀回只讀、不 resend；成功讀回後才重新開表單捕捉新的 snapshot。電話、verified transport、consent、訊息時窗均不由此表單修改。
- 手機版核對狀態的按鈕橫向溢出亦先被測試捕捉，再以換行修復。現驗證 recovery button 在 viewport 內及 form 沒有水平 overflow。內部備註加固定 aria-label，避免 textarea 的內容影響名稱查找。
- 相關對話保留 server 的 lead 與 conversation 雙重 scope；讀取失敗不顯示 link，提供 retry。contact ID 改變時重掛讀取元件，避免保留原 contact 的來源列表。

沒有新增 migration、dependency、runtime config 或 provider port。`package.json` 只把三項新 SQL regression 接入 `test:no-link`。所有 78 migration／manifest 未改；原五個 defect probes 保留。

## 證據層次及 committed readback

| Command                                             | Exit／結果                                   | 環境／SHA                                                                                                            |
| --------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run acceptance:whatsapp-no-link:synthetic` | 0；46/46；零 skip                            | committed `6a76a33`；Windows Node 24.18.0／Chromium 151.0.7922.34；real routes／synthetic Auth/API                   |
| `npm.cmd run test:no-link`                          | 0；99 Node/PGlite＋9 Bun；零 Node skip       | committed `6a76a33`；Windows；不讀 live DB                                                                           |
| `npm.cmd run test:no-link:local-postgres`           | 0；8/8；零 skip                              | committed `6a76a33`；Postgres 17，pinned disposable loopback pgvector container；78 full migrations                  |
| `npm.cmd run test:command-center`                   | 0；82 Node＋8 Bun；零 Node skip              | 同一產品 patch 提交前；Windows；沒有 live DB                                                                         |
| `node --test src/test-wiring.test.mjs`              | 0；9/9；零 skip                              | 最終產品 patch 提交前；Windows                                                                                       |
| `npm.cmd run typecheck`／`npm.cmd run lint`         | 0；lint 保留 3 個既有 React Refresh warnings | 最終產品 patch；Windows                                                                                              |
| `npm.cmd run build`                                 | 0                                            | Windows 產品 patch；其後兩行 UI 換行／key 變更由 final-head CI 再驗；build-generated routeTree 沒有語義 diff，已還原 |

JSON：`2026-09-30-contact-source-browser-results.json`。46 cases 包括原 24 inbox、12 人工轉交及 10 contact／source cases。新 cases 測 360／390／1280px、保存／reload、原 snapshot payload、草稿保留、取消、invalid email、pending／duplicate、stale、timeout／讀取失敗、下一 model actor、離開 route 的遲回、source navigation／retry。未連結 contact 及沒有 reply link 仍由原人工轉交 cases 驗證。

Browser 的 `syntheticForward`／`syntheticContact` 只改 test sessionStorage；真 Auth、HTTP mutator、DB、Woztell、LLM 均沒有使用。Runner 拒絕 remote 或 mutation network requests。模型 actor 的可見性是 presentation 證據，不能作 server ACL 證明。

PGlite 另驗 current scope、other agent／inactive／shared contact 拒絕、pointer 改變、invalid payload、相同 retry 一個 audit、電話／同意／window 不變。原 related-link SQL test 保留 only-authorized conversation 及其他 actor 空結果。

完整本地 Postgres 另以兩個實際 pool sessions 同時提交不同姓名：一個成功、一個 409、一筆 audit，相同 retry 沒有新 audit。另一 session 持有並更改 lead pointer，觀察 CAS backend 確實等待 row lock 後才 commit；原請求 409，新 contact／audit 不變。這是實際 Postgres MVCC 證據，**不是隔離 Neon／真 Auth HTTP／真 tenant 證據**。同一 harness 的 signed exact Terence sample → durable receipt → worker／mapping → fake provider confirmed → staff ack → delivered/read synthetic human reply仍通過，沒有 tracking record、portal fetch 或 LLM。

本地 RED logs 保留於 `.audit/contact-update-red.log`、`contact-browser-red.log`、`contact-browser-layout-red.log`；中途 selector ambiguity 屬 test locator 修正，沒有放寬產品行為斷言。作者按單一 agent 作自我審查，沒有獨立 reviewer。

## 分母、兼容及外部 gate

原 1,277 audit records／1,261 source occurrences 及 18 UC／76 AC 全部保留。新增 contact refresh、related conversation、related retry 三個動作候選，總數 1,294。Presentation 9/1,294；完整角色／DB action acceptance **0/1,294**（815 BLOCKED_EXTERNAL、479 NOT_TESTED），完整 UC **0/18**。每項未驗保留分母。

HTTP contact update 新增 required `expectedContactId`／`expectedName`／`expectedEmail`；snapshot 保留原值，desired 值先 trim。舊 payload 或 app/client 版本不符時 fail closed，不降級成無 snapshot 覆寫。舊 SQL function 保持原狀供既有兼容 reader；rollout 必須以同一 app/server 版本測新表單、cached tab／refresh、403／409 與讀回。沒有 schema rollback；撤回 UI/app 後保留 CRM 資料及 audit。

仍需隔離 Neon multi-session、真 Neon Auth 的直接 HTTP 越權與角色／branch／inactive readback、正式 tenant 的 signed receipt／worker／provider confirmed assignment／customer reply／獨立 staff notification receipt。PropertyHK live URL shape 及 authoritative mapping 未認證，仍 NOT_READY；其餘 formal critical journeys 維持 VERIFICATION_BLOCKED。Shadow → 核對 → canary → production 依原 runbook 及明確授權，effects-off 保留 durable receipts／triage／unknown reconciliation，不能重放成 active 或盲重送。
