# 2026-09-30 本機免連結收件匣 browser 驗證

結果：**LOCAL_UI_VERIFIED / VERIFICATION_BLOCKED for release**。

Code commit：`473d2c9d5271346e5fb3a579bb1fe2499e400378`。同一 PR #206 的隔離 worktree；根 checkout 的現有修改保留。

## 三項新發現及修復

1. **T08/T09 名稱及分派狀態**：server DTO 已提供 `proposedStaffName`、`confirmed_staff_name`、`requestedStaffName`，畫面仍顯示 UUID；confirmed 狀態仍顯示「尚未執行自動分派」。真正 route 的 Chromium 測試先失敗。現在顯示已讀回的名稱及香港繁中狀態；缺名稱明示待核實，unknown 不顯示 confirmed。UUID、reason/state code 留在可展開的「支援診斷」，沒有推測真 Terence ID。
2. **T08 數字搜尋 URL**：直接開啟 `?q=4033349` 時，TanStack JSON search parser 會產生 number；原 route 拋出 `inboxQuery.trim is not a function`。同一 browser 測試重現 RED。現在安全整數轉回字串，boolean／object／不安全整數不會進入 string 操作；外部 ID 的型別及 server search 邊界不變。
3. **T08/T14 最新訊息可見度**：只驗 CSS visibility 的初版檢查漏掉 viewport clipping。改為 Chromium IntersectionObserver 實際 viewport ratio 後，390px 最新訊息 ratio=0，測試 RED。查詢證據及 sheet 在訊息載入後改變 timeline 高度；新增 ResizeObserver，只在原本置底及沒有 older-page anchor 時重新置底。使用者閱讀較早訊息時，resize 保留 scrollTop，不強制移至最新訊息。

原五個 audit probes、permissions／provider／consent／window／canary guards、全部 migrations 不變。沒有 DB、runtime config 或 production activation 差異。

## 環境及證據界線

Command：`npm.cmd run acceptance:whatsapp-no-link:synthetic`，exit 0，**23/23，零 skip**。Node 24.18.0、Chromium 151.0.7922.34、Windows；CI 另用 lockfile 對應的 Linux Chromium revision。

Fixture 由 Vite 載入真正 `/admin/whatsapp` TanStack route、AdminShell、staff-session store、React components、Radix dialogs 及 repository Tailwind CSS。Test-only alias 替換 Auth hook 和 API imports；不修改正式 app 的 Vite config、routes 或 server adapters。這是 UI presentation／state regression，沒有真 JWT、HTTP server-function authorization、DB 或 provider。模擬角色拒絕畫面不能當作 server 越權拒絕證據；後者仍使用既有 SQL／local Postgres tests 分開記錄。

Runner 自建隨機 port 的 127.0.0.1 server；拒絕外來 `PLAYWRIGHT_BASE_URL`；asset path 留在自己的 `.audit` build directory。Builder 在清理 outDir 前核對 checkout 及絕對 target。CSP 和 Playwright 同時限制 network；只有此 origin 的 GET／HEAD，所有 external／mutation request 都令測試失敗。UI mutation adapters 禁止寫入，23 個 case 的 mutation call 數均為零。正常 API 的 `ai-read` 是合成已存建議讀取，不調 LLM。

Desktop case 依一般 document scroll 回到 workspace 後驗 composer；沒有聲稱 desktop 首屏免捲動。390×500 是縮短 viewport 的鍵盤模擬，不是真手機軟鍵盤。`isComposing` 是合成 keyboard event，不是真 OS 輸入法測試。360／390／768px 最新長訊息要求至少 25% viewport ratio；傳送按鈕要求完全在 viewport 內。

完整機器結果：[23-case JSON](2026-09-30-no-link-browser-results.json)；390px 合成畫面：[screenshot](2026-09-30-no-link-browser-390.png)。Runner 在 finally 關閉 browser、contexts 及自己建立的 server。原依賴真正登入 fixture 的 `e2e/whatsapp-no-link.spec.ts`／safe runner 保留，未標成 PASS。

## 已測 scenarios

- 已核實名稱、confirmed／unknown 狀態、缺名稱 fallback、展開 diagnostics。
- 360／390／768／1280px，30 條長訊息、textarea Enter 不發送、完整 send button 可達及 reload 保留草稿。
- 每 conversation 草稿隔離、手機 Escape 返回保留 filter／draft、手機選單進入收件匣。
- Timeline resize 置底及閱讀較早訊息不跳動；晚到的舊 detail response 不能覆蓋下一個 conversation 或草稿。
- External ID 搜尋及 reload；plain numeric deep link；boolean／object／不安全整數 query 不崩潰。
- 390×500 viewport；expired window 禁止 free reply；空範本／範本 error/retry 保留草稿。
- 合成 agent-b private-thread denial、viewer staff-shell denial、guest sign-in gate；合成 IME Enter 零 send。

另外 `test:no-link` 96 Node/PGlite + 9 Bun、`test:whatsapp-enquiries` 103、test-wiring 9 全通過；typecheck、lint、build exit 0。Lint 保留三個既有 React Refresh warnings；fixture import 路徑錯誤、錯誤假定 agent 不可看 Operations link，以及誤假定數字 search URL 不含 JSON 引號的測試 setup/assertion 已修正，與上述三項產品 RED/GREEN 分開記錄。

## Coverage 及剩餘 gates

原 1,261 source controls／1,277 audit records 保留；增加一個 diagnostics candidate，現在 14 個新 candidates，總分母 **1,291**。Action CSV 的 `presentation_execution_status` 分開記錄四個已執行 UI controls：搜尋 input、conversation row、reply textarea、diagnostics disclosure；其餘留 NOT_TESTED。僅 UI presentation 是 **4/1,291**；含真 role／DB readback 的完整 action acceptance 仍 **0/1,291**（812 BLOCKED_EXTERNAL、479 NOT_TESTED）。沒有把 wrapper、所有同名 control 或 provider send 一起升級成 PASS。

18 UC／76 原 AC 的 full acceptance 仍為 BLOCKED。仍需 isolated Neon、多角色真正 Auth browser、真 provider readback／delivery、approved PropertyHK sample、shadow／canary 及正式授權。Ordinary no-link local Postgres golden 的證據沿用前一份 report，不把此 synthetic browser layer 與 fake provider 合併成 production journey。

Single-agent self-review：重查 API aliases 只在 fixture、network／asset／outDir guards、verified name fallback、search input shape、observer cleanup／閱讀位置、late response／draft assertions；未宣稱獨立 reviewer。

Ruling：建立可自行啟動的真 route UI fixture並分層報告 — 可以完成缺少的本地 browser regression，保留真 Auth／DB／provider gates — 成本是此層不能證明正式登入或 server ACL。Desktop 正常 document scroll 與手機 sheet 分開驗；未因 desktop reload 不在首屏而改整個後台 layout。
