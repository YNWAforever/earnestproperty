# 本次查詢修正及讀回驗證（T06／T09／T14）

產品／測試 commit：`57c63123e106edb95a8dc3a5808baf2a02d41aff`。Findings UX01／UX02／NL02／R13，主要 UC05／06／12／14。沿用現有 TanStack route、Neon raw SQL、enquiry revision／CAS、職員權限及 provider 整段對話覆核。

## 已重現及修復

- PGlite RED：明確清除 requestedStaffId 後，detail 仍讀回原始 requested_staff_id。現讀取 enquiry_resolution 的有效修正；原欄位保留作原始證據，沒有改寫 parser、first-touch 或 verified transport。
- Browser RED：保存中修正原因仍可編輯；回應未知沒有讀回入口；修正視窗沒有本次查詢原文。現 pending 欄位、取消及 Escape 關閉均停用，同步 guard 阻止同一事件迴圈重複提交。視窗顯示 server 已授權、最多 50 則本次查詢入站原文，React 文字呈現，不 fetch portal 或新增回覆目的地。
- 保存或保存後讀回失敗一律先核對結果；403 不宣稱沒有寫入。重新讀回失敗時移除舊 detail，保留草稿並鎖定，不以舊版本再寫。讀回目前值已符合草稿時，停用重複保存，沒有宣稱是哪一次請求寫入。
- 重新讀回核實選項時，已失效的選擇以「先前選擇已不可用」保留；原因不丟失，必須明確重新選擇。候選名稱來自現有已授權 DTO，日常操作不要求 UUID。
- 背景 assignment evidence 載入失敗曾令成功保存視窗被卸載（追加 browser RED）。現 keyed Dialog 保留已讀回結果、修正狀態及草稿；修正後刷新 parent evidence。離開 route 的遲到保存 callback 不會在另一頁重新讀回或開舊查詢；切換 enquiry 保持身分及草稿分離。

沒有 migration、manifest、package、dependency、runtime config 或 HTTP payload 契約變更。78 個 migration 保持原檔；原五個缺陷 probes 保留。沒有 production 變更、provider action、發訊息、deploy 或 merge。

## 分層證據

| Command                                             | Exit／結果                                        | 環境／SHA                                                                                        |
| --------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm.cmd run acceptance:whatsapp-no-link:synthetic` | 0；57/57；零 skip                                 | committed `57c6312`；Windows Node24.18.0／Chromium151.0.7922.34；real routes、synthetic Auth/API |
| `npm.cmd run test:no-link`                          | 0；99 Node/PGlite＋9 Bun；零 Node skip            | committed `57c6312`；Windows；沒有 live DB                                                       |
| `npm.cmd run test:no-link:local-postgres`           | 0；9/9；零 skip                                   | committed `57c6312`；owned pinned loopback Postgres17 container；78 full migrations              |
| `npm.cmd run test:whatsapp-enquiries`               | 0；103/103；零 skip                               | 最終產品 patch 提交前；Windows                                                                   |
| `npm.cmd run typecheck`／`npm.cmd run lint`         | 0；lint 0 errors、3 個既有 React Refresh warnings | 最終產品 patch 提交前；Windows                                                                   |
| `npm.cmd run build`                                 | 0                                                 | 最終產品 patch 提交前；Windows；generated routeTree 無語義差異，已還原                           |

JSON：`2026-09-30-enquiry-resolution-browser-results.json`。保留原 46 cases，新增 11 修正流程 cases：pending／同一事件迴圈 duplicate／Escape、lost response／讀回／不重建 revision、本次原文、360px 保存及證據 outage／refresh／下一 actor、取消／unchanged／短原因、agent read-only、initial read failure／403、stale＋讀回失敗／保留原因、retired candidate、route leave 遲回、下一 enquiry 隔離。其餘 24 inbox、12 manual-forward、10 contact/source cases 原樣保留。

Browser 的 syntheticCorrection 只改 test sessionStorage，沒有真 Auth、HTTP mutator、DB 或 provider。Runner 禁止 external／mutation network calls。Model actor 可見性只能證明介面，server ACL 另由 SQL 測試驗證。

完整本地 Postgres 新 case 使用兩個實際 pool calls 同步修正同一 expectedVersion：一個成功、一個 409、只一筆 revision。有效 requestedStaffId 清除、原始 requested_staff_id／MLS property／整段 conversation assignee／confirmed staff 保留。實際 server handler 拒絕 agent 直接修正及錯 branch manager，revision 數不變；管理角色只讀本次原文，另一 agent 403。Actor inputs 仍為合成，未經真正 Auth HTTP；本地 Postgres 不代表隔離 Neon。

同一 Postgres harness 的 exact Terence sample → signed receipt → durable 原文 → worker/parser／verified synthetic mapping → fake provider confirmed → staff ack → customer human reply／synthetic delivered/read 仍通過。Tracking record／click／portal fetch／LLM／外部 network 全為零。

本地 RED logs：`.audit/resolution-readback-red.log`、`resolution-browser-red-valid.log`、`resolution-browser-expanded.log`。最初 label selector setup、route history／manager label setup及一次測試 patch 放錯位置均另作 harness 修正；沒有放寬 pending、duplicate、scope 或保存斷言。作者按單一 agent 自我審查，沒有獨立 reviewer。

## 分母、操作及外部 gate

原 1,277 audit records／1,261 source occurrences、18 UC／76 AC 均保留。新增一個修正讀回候選，合共 1,295。Presentation 11/1,295；完整角色／DB action acceptance **0/1,295**（816 BLOCKED_EXTERNAL、479 NOT_TESTED），完整 UC **0/18**。沒有把合成角色或本地 DB 當作 full acceptance。

普通已核實 28Hse 查詢仍不需要逐次造 link／EPWA；只有例外才由現有有權角色修正。本次修正不通知同事、不回覆客戶、不轉移整段對話；整 thread provider constraint 繼續顯示 review。收到結果不明時用「重新載入並檢查草稿」只讀核對，不能盲重送。修正草稿不跨 tab 持久化；關閉後重新開啟須讀最新 scoped detail，未知舊操作由授權者核對 revision／現值。

下一 gate：真 Neon Auth 的直接 HTTP 授權／越權、角色／branch／inactive readback、隔離 Neon multi-session CAS／rolling reader、本次原文 scope／兩 actor refresh，以及正式 tenant webhook／worker／provider confirmation／reply／獨立 staff receipt。PropertyHK live shape 未核實仍 NOT_READY；其他 formal critical journeys 維持 VERIFICATION_BLOCKED。Shadow → review → canary → production 及 effects-off rollback 依原 runbook、另須明確授權；保留原文、revision、triage及未知操作 reconcile。
