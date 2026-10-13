# EarnestProperty 後台導覽與日常工作規格

日期：2026-10-13（Asia/Hong_Kong）｜交付性質：稽核補充、實作規格及測試設計；本輪未修改產品或部署。

本規格承接使用者要求：以 `EarnestProperty_Admin_Audit_2026-10-02_zhHK.zip` 作基準，供 Codex GPT-6.1 Sol 實作；改善側邊導覽、每個後台內頁的對齊，以及管理員和代理的日常工作。HKWTIA 是使用者指定的介面參考。本輪兩站均要求職員登入，未取得其登入後畫面；以下尺寸、收合及分組是明確設計提案，並非聲稱已量度或複製 HKWTIA。

## 已核實基準與限制

| 項目 | 本輪結果 | 證據層 |
|---|---|---|
| GitHub | `YNWAforever/earnestproperty`，main `433ab194f9e51c789d89d49216fe2983f2791616`；2026-10-12T16:34:35Z 的 PR #262 merge | GitHub connector 讀取 |
| 原稽核包 | SHA256 `ffcfe4160a23080caee6b0bf7ca126df298cf29a3ae60bd14394486ba6acb2d2` | 已下載、核對及閱讀 |
| 現有技術 | TanStack Start/Router、React 19、Vite 7、Neon raw SQL/Auth、Tailwind v4、shadcn/ui | CLAUDE.md、package.json |
| Earnest live | `/admin/` 導向 `/admin`，顯示「職員登入」及「登入後台」 | live-only；未登入 |
| HKWTIA reference | `/zh/admin` 導向 `/zh/admin-login?next=%2Fadmin`；Google／職員電郵登入 | live-only；未看到 sidebar |
| 全部內頁 | 25 個 admin route templates、17 個 sidebar destinations；逐檔讀取 | code-only；100 個 viewport 實例尚未執行 |
| 產品測試 | 本輪沒有安裝／執行產品測試，沒有 Auth→DB→provider 實測 | 新案例全部 not-tested |
| 正式版本 | 未讀取正式 app/worker/schema 版本與 flags | repo 與 live 版本是否一致：unknown |

原 ZIP 的 `02_Action_Inventory.csv` 有 68 個 BUSINESS_ACTION + 1,332 個 SOURCE_CONTROL_CANDIDATE；`03_Test_Results.csv` 有 60 個 REQUIRED_SCENARIO + 68 個動作驗收 + 1,332 個候選驗收。歷史核心測試 29 PASS／9 FAIL／22 BLOCKED 只屬 10 月 2 日；不可把 1,460 列當成已執行測試，亦不可搬作本輪結果。

## 本輪發現

| ID／優先度 | 目前可證明的事實 | 修改方向／驗收 |
|---|---|---|
| UX-F01／P2 | `AdminShell.tsx` 已有三組選單、240px desktop sidebar、mobile Sheet、active indicator、角色過濾及待辦 badge；沒有 desktop collapse 控制 | 保留現有能力；改為固定寬度可收合導覽及更清楚的日常／管理／設定分組；不是從零另建 admin |
| UX-F02／P2 | Shell 用 `max-w-7xl`、grid gap、外層 px-4 及內容 lg:px-6；表單另有 max-w-2xl/3xl/5xl；篩選有 AdminToolbar、fieldset、form 等不同實作 | 建立三種明確內容寬度，統一頁首／toolbar／內容外緣；目前只證明樣式不一致，未量度正式畫面的偏移 |
| UX-F03／P2 | `admin.listings.tsx` 的「查看盤源同步及待處理紀錄」Link 沒有角色條件；sidebar 的同目的地只准 admin/manager | 代理不顯示這個無權入口；直接 URL 仍由 server 拒絕，不放寬 ACL |
| UX-F04／P2 | Shell h1 使用 truncate；代理及屋苑新增／編輯頁未傳入 breadcrumb；部分主要操作在 toolbar，team 卻在 header actions | 長標題可換行；所有 editor 有返回路徑；每頁只有一個主要操作位置 |
| UX-F05／驗收缺口 | 兩個網站均需職員登入；現有 owned browser suites 大量使用 synthetic auth/API | reference 比對、真角色任務及資料讀回必須獨立列證據；本輪不能判斷登入後已修好 |

以上 UX-F01/02/04 是有 source 依據的改善項目，不等同已重現正式使用者失敗。沒有證據支持本輪 P0 或正式資料外洩。

## Sidebar 規格

| 組別 | 順序與原 URL | 角色規則 |
|---|---|---|
| 日常工作 | 總覽 `/admin`；客戶查詢 `/admin/leads`；WhatsApp 收件匣 `/admin/whatsapp`；跟進工作台 `/admin/leads/command-center`；樓盤管理 `/admin/listings`；成交管理 `/admin/transactions` | 沿用 `admin-nav-roles.ts`；跟進工作台只准 admin/manager |
| 管理與推廣 | 營運與轉換 `/admin/analytics`；推廣活動 `/admin/blasts`；客戶分群 `/admin/segments`；內容中心 `/admin/cms`；屋苑管理 `/admin/estates`；WhatsApp 來源連結 `/admin/whatsapp-links` | admin/manager；來源連結是選用工作，不是普通問盤前置 |
| 設定與處理問題 | 團隊成員 `/admin/team`；經紀檔案 `/admin/agents`；WhatsApp 接收設定 `/admin/whatsapp-settings`；盤源同步 `/admin/property-sync`；系統營運 `/admin/operations` | 沿用目前讀取權限；operations 的 tabs/actions 仍按 capability 控制 |

代理六個 sidebar 入口必須維持：總覽、客戶查詢、WhatsApp、樓盤、成交、系統營運。viewer 只有系統營運。manager 能讀團隊頁不代表有 `staff.manage`；不可把頁面存取等同所有按鈕可用。

Desktop（≥1024px）展開 256px、收合 72px。選單可獨立滾動；帳戶及登出不因短螢幕失去入口。收合保留 icon 的可及名稱、focus tooltip、active 標記及待辦狀態；展開後文字完整。收合偏好只保存布林值，storage 不可用時仍能操作；SSR 預設展開，hydration 後讀取偏好，不存角色或客戶資料。<1024px 使用現有 Sheet，不顯示窄 icon rail。

登入、staff lookup、撤權、首次登入 checklist、sign-out confirm、attention identity 的現有生命週期保持。手機點選後關閉抽屜；Escape、焦點返回、Tab containment 與背景不可操作需測試。URL/query、返回上一頁及 editor deep links 保留；`/admin/leads/command-center` 只亮工作台，不同時亮客戶查詢；`/admin/whatsapp-settings` 不亮收件匣。

## 共用版面規格

| 項目 | 實作值／行為 |
|---|---|
| Shell | 全 viewport 的 grid；desktop `256px minmax(0,1fr)` 或 `72px minmax(0,1fr)`；不以多份 margin-left 補位 |
| Content gutter | <768px：16px；768–1279px：24px；≥1280px：32px；同一頁只有一層水平 gutter |
| Width variants | `standard`：max 1440px；`wide`：可用全寬；`form`：max 896px。全部 w-full/min-w-0，靠左；header、toolbar、body 共用同一 variant |
| Vertical rhythm | 頁首→toolbar/body 24px；section gap 24px；field gap 16px；label→control 8px |
| Header | h1、description、breadcrumb、actions 共用元件；長標題自然換行；手機 actions 在標題後換行；不要只用 title tooltip 才看到必要資訊 |
| Toolbar | 搜尋／篩選靠左，結果狀態及批量操作有明確位置；小螢幕換行；表單 label 對齊 control，Enter submit/IME 行為保留 |
| Forms | form variant；兩欄只在足夠寬度才出現。欄位錯誤貼近 label/control，摘要可定位首個錯誤；保留 dirty guard、draft、既有 submit handlers |
| Tables | `overflow-x-auto` 限在命名的表格區，主頁不橫向滾動；保留 row action、選取範圍、loading/empty/error/partial state |
| Drawers/dialogs | 使用現有 Sheet/Dialog；長內容只滾 body，操作列可達；保留焦點恢復與目前 AdminDetailPanel 的處理 |
| Touch/focus | 手機主要互動目標至少44×44px；明顯 focus ring、語義 labels、keyboard 可操作；不是只靠顏色顯示 active/error |
| Landmark | `__root.tsx` 已提供 main；不要新增巢狀 main。跳至內容 anchor 指向 shell 內可 focus 的內容區 |

不同 width variant 是可解釋的工作需要，不要求聊天工作区與短表單同寬。逐頁 variant、路由、breadcrumb 及角色見 `04_Route_Coverage.csv`。不能靠全站強制 `overflow-x:hidden` 隱藏超出畫面或把所有頁面塞进同一個 fixed-height 容器。

## 日常工作與測試資料

管理員：早上看總覽→同 filter 查未分派查詢→指派／核實接手→更新樓盤→核對當日同步例外→檢視成交及報表→交接未完成項目。代理：登入原 deep link→看本人待辦→開已分派查詢→核對物業與客戶→草稿／服務回覆或內部備註→更新跟進→必要時維護授權樓盤／成交→下班保留待辦。

使用可拋棄的隔離資料：ADMIN、MANAGER-A、AGENT-A、AGENT-B、VIEWER；分行 A/B；各一筆本人與他人查詢、未分派查詢、已過期服務窗口對話、未知發送結果、售／租／雙 offer 物業、長中文標題、空白與大清單、stale revision。聯絡方式使用測試值，所有發送 endpoint 指向隔離 stub；真 provider canary 必須另外有指定測試收件者及發送範圍授權。

成功 toast 不作完成證據。寫入需重新取得 record/version；回覆需核對原 outbound intent／receipt；儀表板數字需與同範圍清單一致。無法登入、沒有 disposable DB、沒有 provider 授權各自標 blocked，不改成 skipped=pass。

## 原稽核追溯

| 原 finding／工作包 | 最新基準中的證據線索 | 本輪處理 |
|---|---|---|
| F01／RPK-01 | repo 已有 EP-01/02 canonical gate、durable repair 報告及測試 | T-UX00 核對歷史狀態；維持 regression，UI 任務不重寫 AI 索引 |
| F02／RPK-03 | EP-06/07 接駁、handoff 已有本地報告，正式 provider 狀態本輪未知 | ADM-03/08、AGT-04/07 需區分 synthetic 與真 provider |
| F03/F04/F05／RPK-02 | EP-03–05、EP-14 品質、stale apply、來源顯示已有實作記錄 | ADM-10、AGT-10 保留行為；不能把改名當已修復後端 |
| F06／RPK-04 | 後續 Property.hk/28Hse readback 檔已存在；本輪未重驗其外部能力 | ADM-09 不把 failed/partial 當空盤；另保留外部 backlog |
| F07／RPK-05 | picker、wizard、StaffNotificationPanel、EP-15 本地驗收已存在 | 接收設定移到適當分組；主管選業務名稱；原報告 `StaffNotificationSetup.tsx` 是舊稱，實際有同名 test，產品是 Panel 等元件 |
| F08／RPK-06 | repo 已有 EP-18 bounded conversation assist 報告與 test scripts | T-UX00 核對，不因 sidebar 任務重新改 SQL |
| RPK-07／UC01–20 | 多個 owned UI/DB suites 及 release 文檔已存在 | T-UX07/08 在本次 SHA 重跑相關部分，保留舊 IDs，新增 UX IDs；不搬用舊 PASS |

已存在實作與歷史本地驗收都不代表本次正式已驗證完成。本包聚焦使用者新增的 sidebar、所有內頁與每日工作要求；其他原稽核未解問題保留在獨立 backlog，不由此 UI 計劃自動結案。
