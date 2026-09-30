# 人工轉交查詢 browser 修復與驗證（T10／T14）

## 範圍及結果

本次延續原計劃 LE01–05／UC11、UC13，沿用 `/admin/leads`、現有 CRM activity、`saveForwardedEnquiry` 及其 SQL request-id 冪等性。沒有新增 CRM、migration、dependency、provider、runtime config 或正式環境操作。產品 commit、完整 committed run 與結果 JSON 於下節記錄。

## 已重現及修復

1. 保存已發出、回應未知後重新整理：原表單丟失原文與 request ID，可能另建查詢。現按 Neon Auth 使用者 ID 在同一分頁 sessionStorage 保存版本化草稿及送出前的完整 payload；未知結果鎖定內容，重開／重新整理仍以同一 request ID 與 payload 重試現有冪等 capture。正常取消未送出草稿會清除，未知結果關閉會保留，收到成功 readback 後才清除。
2. 保存期間表單仍可改動，Dialog 沒有 pending 關閉 guard。現同步 in-flight guard 擋同一 tick 的第二次提交，保存期間停用所有欄位、取消及 Dialog 關閉。瀏覽器返回／離開 route 可繼續，延遲回應不會重新打開舊查詢。
3. 不完整跟進事項或不安全來源網址到 API 才報錯。現沿用同一純 validator，在寫 journal／呼叫 capture 前驗證；失敗保留可編輯內容，沒有 API 呼叫。Server 的 Auth、validation、SQL scope 再驗仍保留。
4. 延遲成功回應在離開 CRM 後把使用者導航回舊 lead，已以實際 route 重現。現 unmount guard 阻止過期 UI callback，已有成功結果可清除原 actor 的 journal。
5. 修復期的負向驗收再捕捉到：受損的未知結果 journal 會靜默被新 request ID 取代。現版本／欄位／pending payload／request ID 不合法或 storage 不能讀取時，保留舊紀錄並停止新提交，顯示支援核對狀態；不自行清空未知請求。

以上各項均先觀察到 browser RED，再修復至 GREEN。第一輪三項全部失敗；stale callback 與 corrupt journal 各另有 RED→GREEN。範本／workflow／原 audit probes 未改。

## 證據層次

- 實際 TanStack `/admin/leads` 與 `/admin/whatsapp` routes、AdminShell、Radix dialogs、Tailwind、Inter／Noto Sans TC；只有 Auth/API imports 使用 test-only adapter。
- 新增 12 個 CRM browser cases，加上原 24 個 inbox cases。包括 360／390／1280px、保存後 reload、原文／來源／轉交者、沒有電話仍保存而沒有相關 reply link、下一 actor 顯示跟進事項、actor 草稿隔離、取消、Escape、同時提交、未知結果、storage failure、corrupt journal、離開 route 後的遲到回應。
- CRM adapter 的狀態是分頁內合成模型。API attempt payload 的一對一比較、相同 ID 回讀、模型只有一筆 lead 是 **UI 到 adapter 的證據**，不是 DB concurrency、真 Auth／HTTP authorization 或真 provider 證據。原 PGlite SQL tests 另證 scope、duplicate／conflict、inactive actor、CRM activity 不重複及沒有 opt-in／訊息時窗。
- Runner 只對自己建立的 loopback GET／HEAD server 取資源；拒絕外部及網絡 mutation。唯一允許的合成 mutation 是 `syntheticForward`，只寫 test sessionStorage。其餘 customer reply、template、contact edit、AI、bulk、provider 等 adapter 一律禁止，沒有真 DB／provider／LLM。
- `draftKey` 只作瀏覽器草稿區分，不授予權限。Journal 只在原分頁 session 保留；分頁關閉、不同裝置／瀏覽器、手動清 storage 不保證 client request ID 可恢復，需支援核對已有查詢。不能用此 browser 層宣稱正式 tenant 接駁已驗收。

## Committed verification

產品／fixture commit：`c7ecdfb2ba6ba688f5012eaac686c3ed844babf6`。

| Command | Exit／結果 | 環境／SHA |
| --- | --- | --- |
| `npm.cmd run acceptance:whatsapp-no-link:synthetic` | 0；36/36，零 skip | committed `c7ecdfb`；Windows Node 24.18.0、Chromium 151.0.7922.34；real routes／synthetic Auth/API |
| `npm.cmd run test:no-link` | 0；96 Node/PGlite＋9 Bun | committed `c7ecdfb`；Windows Node／Bun 1.3.14；沒有 live DB |
| `npm.cmd run test:command-center` | 0；82 Node＋8 Bun | committed `c7ecdfb`；Windows Node／Bun；沒有 live DB |
| `node --test src/lib/whatsapp-enquiries/forwarded-enquiries.test.mjs src/lib/whatsapp-enquiries/forwarded-enquiries.db.test.mjs` | 0；2/2，零 skip | 同一產品 patch 提交前；純 validator／PGlite SQL；與 browser 模型分開 |
| `npm.cmd run typecheck`／`npm.cmd run lint`／`npm.cmd run build` | 全部 0；lint 保留 3 個既有 React Refresh warnings | 最終產品 patch 提交前；Windows；build-generated routeTree 沒有語義 diff，已還原 |

Machine readback：`2026-09-30-forwarded-enquiry-browser-results.json` 包含上述 committed SHA、36 case 結果、版本及 `database:false`／`providerSend:false`。`2026-09-30-forwarded-enquiry-browser-390.png` 是未知結果警示及鎖定欄位的合成畫面；長表單使用既有 Dialog scroll，並非所有欄位同時在 viewport。原 24-case inbox report／JSON 保留作歷史證據。正式 release 仍為 **VERIFICATION_BLOCKED**，PropertyHK mapping 為 **NOT_READY**。

## 覆蓋及剩餘 gate

原 18 UC／76 AC、1,291 action candidates 全部保留。`N-T10-forward-capture` 只新增 presentation evidence：總 presentation 5/1,291；完整角色／DB action acceptance 仍是 0/1,291（812 BLOCKED_EXTERNAL，479 NOT_TESTED），UC 完整驗收仍是 0/18。新 CRM browser 證據不代表 contact edit、bulk、shared controls 或各 branch server scope 已驗收。

仍需真 Auth/session HTTP boundary、隔離 Neon 的 multi-session 保存／refresh／下一 actor、stale permission／branch／inactive readback，及原 runbook 的 provider／shadow／canary／production gates。本次沒有 customer/staff 訊息、deploy、merge 或 production mutation。

Ruling: 對保存 endpoint 的 transport error 採未知結果，鎖定原 payload 並重試現有 request-id 冪等 capture；不猜未保存、不換 ID，不重送任何 provider 訊息。成本是權限失效等 server 拒絕亦需回復權限或支援核對，而不能當場修改未知請求。損壞 journal 維持 fail-closed，不為方便新建而覆寫。此為單一 agent 作者自我審查，沒有獨立 reviewer。
