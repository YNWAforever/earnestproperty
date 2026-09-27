# Earnest Property 網站及 WhatsApp 工作流程審核

審核日期：2026 年 9 月 26–27 日（香港時間）  
範圍：[公開網站](https://earnestproperty.vercel.app/)、[管理後台](https://earnestproperty.vercel.app/admin)、GitHub 程式碼、Vercel 部署資料。  
版本：[098844e6a97545e1b590f45c756a8d2ca77db7bb](https://github.com/YNWAforever/earnestproperty/commit/098844e6a97545e1b590f45c756a8d2ca77db7bb)。Vercel 正式部署與此提交一致。

## 1. 決策摘要

網站已有可用的樓盤展示、登入、物業批量管理，以及具備權限、版本控制及稽核概念的 WhatsApp 後端。現時最需要修復的是「客戶找到樓盤 → 帶着正確樓盤資料查詢 → 正確同事接手 → 管理員確認送達」這條完整流程。

本次實測確認：公開樓盤編號搜尋失敗、部分 WhatsApp 入口遺失樓盤資料、分派證據面板持續報錯，以及後台對「設定存在」「可分派」「可發送」「已送達」的顯示未有清楚區分。批量 WhatsApp 建立接口已存在，前台操作尚未接通。

**實際發送測試未完成，今次沒有向任何同事或客戶送出 WhatsApp。** 畫面只見名為「test」的 Inbox 私人備註通知端點，未見可核實的同事 WhatsApp 手機接收端點；使用者亦未指定實測收件同事。追蹤連結開啟嘗試另被受管瀏覽器的組織存取政策攔截。這不是網站故障的證據，亦不代表收到訊息。以下把此項列為未通過驗收，而非成功測試。

| 優先次序 | 應先處理 | 驗收重點 |
|---|---|---|
| P1 | 修正樓盤公開編號搜尋及所有查詢入口的編號 | A074714 可搜尋；客戶訊息不出現 SYNC UUID |
| P1 | 修復 WhatsApp 分派證據讀取 | 面板可讀到 enquiry、指定同事、實際分派及失敗原因 |
| P1 | 建立一位真實同事的接收映射並完成單筆端到端測試 | 分清 Inbox 分派、私人備註、同事 WhatsApp；取得送達證據 |
| P1 | 接通網站入口與追蹤連結 | 查詢保留樓盤、租售及來源；缺少追蹤連結時仍有完整查詢文字 |
| P2 | 接通批量建立、查重、匯出、同事就緒檢查 | 可在樓盤列表一次建立多盤、多來源連結；重試不重複 |
| P2 | 修正 onboarding、健康狀態和公開內容 | 「已啟用」與「可登入／可接單」分開；刪除工程用語 |
| P2 | 量度及優化首次回應、查詢及圖片 | 先有香港使用者數據，再判斷伺服器、資料庫及圖片改善 |

P1 = 影響核心查詢或營運可靠性，應先於擴大投放處理。P2 = 日常操作、規模或信任問題，排入下一輪。未發現可據此宣稱的 P0 緊急事故；本報告不是完整滲透測試或安全認證。

## 2. 測試方法與界線

- 已成功登入正式後台；檢查總覽、WhatsApp 對話、追蹤連結、映射設定、團隊成員、系統營運、樓盤管理。
- 公開頁面檢查首頁、樓盤列表、A074714 詳情、星堤屋苑及文章頁；實際操作關鍵字搜尋、篩選、邀請對話框及分派證據重試。
- 讀取相關路由、服務、權限、資料庫 migration、通知 transport 及測試等 99 個來源檔案；未把整個 repository 每一檔案逐行審完。
- 執行 5 個獨立測試檔案，36 個測試全部通過。未執行完整依賴安裝、build、lint、完整資料庫整合測試或手機裝置測試。
- 沒有修改程式碼、部署、建立邀請、變更角色、更新映射、批量產生正式連結或發出訊息。沒有進行正式環境壓力測試。
- 「實測」指可在 live UI 重現；「程式碼」指靜態控制流程或資料結構證據；「待核實」指需資料庫、實際收件端或更完整量測才可定論。

## 3. 公開網站與內容問題

### F01 · P1 · 公開樓盤編號搜尋不到現存樓盤【實測＋程式碼】

**重現：** A074714 詳情可正常開啟，樓盤管理也顯示為公開售盤。在公開列表搜尋 A074714，結果為 0。列表未加關鍵字時顯示 327 個物業。

**原因：** `public-data.server.ts` 的 keyword 條件包含內部 `p.listing_no`，未包含 current offerings 的公開樓盤編號。匯入物業的內部編號為 SYNC UUID，與客戶認識的 A074714 不同。

**修復：** 搜尋明確包含 canonical public listing number 及有效舊編號別名；公開編號精確匹配優先，再進行屋苑／標題文字搜尋。保留最新放盤及已下架判斷，避免為了命中而顯示過期來源。

**驗收：** A074714、大小寫及前後空白均找到同一公開物業；同一樓盤的租售不重複計數；已下架來源不復活。

### F02 · P1 · 內部 SYNC 編號出現在客戶介面【實測＋程式碼】

A074714 詳情的主要編號正確，但 breadcrumb 顯示「編號 SYNC」；表單查詢提示包含完整 SYNC UUID。首頁樓盤卡的 WhatsApp 文字亦使用內部 `property.listing_no`。

**影響：** 客戶與同事使用不同編號，查詢需要再次問盤，降低信任，亦妨礙歸因核對。

**修復：** 建立一致的 public listing view model；畫面、預填訊息、分享、表單及分析事件都使用 `publicListingNo`。內部資料庫 ID 只用作內部關聯。不可用 `split('-')[0]` 把編號截成 SYNC。

### F03 · P1 · WhatsApp 入口未全面接上追蹤及樓盤上下文【實測＋程式碼】

A074714 詳情的 WhatsApp 按鈕預填通用「您好，我想向晉誠地產查詢。」；缺少 A074714、星堤和出售資料。首頁另走直接 wa.me 路徑。後台當時只有兩條 28hse 來源連結，未見 website 來源連結。

`resolveTrackingLinks` 尋找對應 website/current offering 連結；找不到時採用通用 fallback。因此「有 WhatsApp 按鈕」不代表「有樓盤歸因」。

**修復：** 首頁、列表、詳情及手機固定 CTA 共用解析流程。在發佈／匯入完成後提供補建追蹤連結工作；公開讀取本身不應建立記錄。Fallback 仍保留公開樓盤編號、租售和標題；分析上明確標示未能追蹤。

### F04 · P2 · 公開內容含工程用語與地區模板錯配【實測】

星堤頁出現「獨立 SEO 頁」「已接入舊站公開 MLS 匯入流程」「factual trust proof」等內部說明。頁面介紹掃管笏，附近交通段落卻沿用青龍頭／深井敘述；業主 CTA 仍指向「深井業主估價報告」。

**修復：** 刪除工程及資料流程文字；逐屋苑核對地區、交通、報告和 CTA。把資料來源及核實日期用客戶能理解的方式呈現。此處指出的是頁內不一致，交通班次等外部事實仍須由內容負責人核實。

### F05 · P2 · 五分鐘服務承諾缺乏可見的營運支持【實測；承諾真實性待核實】

首頁有「平均 5 分鐘內回覆」「5 分鐘內專人回覆」及直達負責代理等承諾，但目前映射覆蓋不足，部分樓盤未指派代理。對話列表亦有歷史長時間待回覆項目，但可能包括測試資料，不能據此計算真實 SLA。

**修復：** 先以實際營業時間、值班表及排除測試／垃圾後的首個真人回覆數據驗證承諾；未有證據前改為有條件的服務說明。避免把點擊或機械回覆算作真人回覆。

### F06 · P2 · 樓盤內容質素及媒體承諾不一致【實測】

匯入標題保留大量宣傳前綴、重複感嘆號及「Patry」拼字；「3房套工」與 4 房資料可能把工人房混為睡房。A074714 標題標榜 VR，所檢查介面未見可用 VR 入口。後台亦可見未填屋苑及「資料有差異，待核實」的公開物業。

**修復：** 顯示標題與原始來源文案分開；結構化睡房／套房／工人房；有 VR 或影片 URL 才展示相應標籤。把缺屋苑、相互矛盾和未核實資料放入內容待辦，保留來源與人工更正的優先次序。

### F07 · P2 · 詳情頁社交分享 URL 指向首頁【實測＋程式碼】

A074714 canonical 是該物業頁，但 `og:url` 為網站根網址。Root head 使用固定 SITE_URL，詳情未完整覆寫。

**修復及驗收：** 每個物業的 title、description、image、og:url 和 canonical 對應同一公開樓盤；用實際分享預覽驗證。不應推斷目前所有分享預覽已壞。

## 4. WhatsApp 分派與同事映射

### F08 · P1 · 分派證據面板持續載入失敗【實測；根因待資料庫確認】

在含 EPWA 參考碼的歷史測試對話打開查詢／分派區，顯示「未能載入查詢及分派證據，請重新整理。」按重新整理仍失敗。上方卻顯示 WhatsApp 發送可用。

**高可信根因候選：** `readAssignmentContext` 使用 `r.role=ANY($2::text[])`；migration 把 `staff_roles.role` 定義為 `staff_role` enum。enum 對 text[] 的比較存在型別不匹配風險。沒有取得相應 SQL runtime error 或直接在正式 DB 執行，因此不把這個原因當作已證實。

**修復步驟：** 在隔離 DB 以相同 schema 重現查詢；確認後使用相容 enum[] 參數或明確 `r.role::text` 比較。保留角色和對話範圍校驗。UI 顯示可追查的錯誤編號；禁止只用無限重新整理掩蓋固定錯誤。

**驗收：** 管理員／經理可讀合法對話；agent 只能讀獲授權對話；越權仍被拒；畫面能同時顯示指定、待確認及已確認同事。

### F09 · P1 · 「同事已啟用」不等於「可以接 WhatsApp」【實測＋程式碼】

團隊顯示 27 位已啟用成員，映射頁只見 test 的已核實 Inbox mapping。連結建立介面的同事選單仍提供大量未有對應映射的成員；建立校驗只檢查同事 active，沒有把可分派及可通知狀態清楚交代給操作者。

**修復：** 同事選擇器展示「可分派」「缺 Inbox 映射」「可收手機通知」「需重新核實」；預設選樓盤負責代理，缺設定者提供明確修復入口。可儲存草稿，但啟用指定同事連結前必須通過所需能力檢查。未指派樓盤可明確選總台接待，不應默默冒充直達代理。

### F10 · P1 · Inbox 私人備註與同事手機通知容易被混淆【實測＋程式碼】

目前可見端點為 `test · inbox_private_note · v2 · 啟用`，不是 `staff_whatsapp`。三件事需要分開看：

| 能力 | 作用 | 成功證據 |
|---|---|---|
| Inbox assignment | 把客戶對話交給同事 | Provider 確認的 assignment 與同事 ID |
| Inbox private note | 在 Inbox 加內部通知 | 私人備註成功記錄 |
| Staff WhatsApp | 向同事自己的 WhatsApp 發通知 | 指向同事端點的 provider message ID、送達回執及收件核對 |

**修復：** 設定頁和對話頁用以上三種明確名稱；不要把任一成功呈現為全部成功。「發送可用」須標明是客戶回覆通道，不能代表同事通知已就緒。

### F11 · P1 · 同事 WhatsApp 模板傳送能力尚未實作完成【程式碼】

`staff-whatsapp-transport.server.ts` 收到 `templateName` 即拒絕，錯誤為 `STAFF_TEMPLATE_CONTRACT_UNVERIFIED`。通知服務亦有 24 小時 inbound 條件及模板能力限制。這是當前程式的保護邊界；不能只在設定頁填 template name 便宣稱支援主動通知。

**修復：** 未完成供應商模板參數、語言、結果解析及回執測試前，UI 清楚標示模板不可用。要全天候接收，需完成並驗證模板 transport；或在現有能力範圍顯示「暫時只能經 Inbox 接收」。不要移除端點、同事身份、permission、correlation 及 reply-context 校驗來強行發送。

### F12 · P2 · 缺少可理解的映射及試送流程【實測】

單頁同時要求 Inbox user ID、Folder ID、routingNodeID、branchID、evidence reference、外部同事 reference，以及通知 endpoint。多處重複「同事」下拉；操作人員需要理解供應商技術欄位和手動貼 UUID。現有列表不足以辨認實際收件端，也沒有端到端測試按鈕。

**建議改為同事詳情的四步設定：** 選擇同事 → 連接 Inbox 身份 → 設定通知方式／遮罩目的地 → 核實並試送。技術欄位放進進階區。顯示最近核實時間、最近試送結果及需修復原因。私人備註與手機通知分開試送。

### F13 · P2 · 模式及 policy 畫面互相矛盾【實測＋程式碼】

營運頁顯示 active 模式，但映射頁固定文案仍說「自動分派仍未開放」。Policy 編輯區顯示新草稿的 POLICY_MISSING JSON，容易與已有核准 policy 混為一談。Active 亦不等同自動服務已開啟，當時畫面自動服務仍為 OFF。

**修復：** 用單一 runtime status DTO 顯示目前模式、assignment capability、自動服務開關及核准 policy 版本；草稿與生效設定分開。一般使用者看可執行中文解釋，技術 JSON 放進診斷區。

## 5. 追蹤連結及批量工作

### F14 · P2 · 單筆建立容易把樓盤查詢誤建成一般查詢【實測＋程式碼】

搜尋有結果後仍要在另一原生下拉選擇樓盤；預設為一般查詢。搜尋結果有一項亦不等於已選中。來源同事 reference 用原始 UUID，儲存後沒有清晰成功摘要／下一步。

**修復：** 選盤卡清楚顯示公開編號、屋苑、租售、價格；一般查詢獨立入口。提交前顯示人類可讀的完整預覽；成功後給「複製連結／繼續建立／返回列表」。Reference 改用有姓名與來源的搜尋選擇器。

### F15 · P2 · 連結列表缺乏日常管理資料且最多顯示 500 筆【實測＋程式碼】

列表主要為編號／來源／版本／開關／不透明短碼，只有複製與停用；缺指定同事、投放 ID、核實狀態、最後測試、點擊及實際查詢。沒有搜尋／篩選／分頁／編輯／重新啟用／批量匯出。後端 `LIMIT 500`，超過後較舊資料會從此列表消失。

**修復：** 伺服器分頁與總數，支援編號、同事、來源、狀態、活動、日期篩選；顯示版本與歷史，不把短碼當主要名稱。複製後有成功／失敗提示。本次 clipboard 回讀未能可靠確認複製結果，故不把「複製壞了」列作已證實缺陷。

### F16 · P2 · 已有批量 API，但 UI 未接通且缺少重試查重【程式碼＋實測】

`provisionWhatsappLinks` / `provisionTrackingLinks` 已支援每次 1–50 筆及 transaction。現在 UI 僅用單筆 save；批量 API 每次產生新的 random ID/code，沒有業務 idempotency key。同一批請求重試可新增另一批連結。

**修復：** 直接延伸既有樓盤管理的勾選列，加入「建立 WhatsApp 連結」。用 batch request ID 和 row key 保證重試穩定；依公開編號、租售、來源、投放身份及接收策略提示可重用的連結。不同廣告 placement 可合理有多條連結，不能粗暴把同盤所有來源合併。

### F17 · P2 · 過期同事 reference 可能令停用操作也失敗【程式碼；未在正式環境改資料重現】

`saveTrackingLink` 在停用前仍執行 `validateLink`；referenceMappingId 的有效期檢查沒有按 enabled 區分。若舊 reference 已過期，會在停用前拋 `STAFF_REFERENCE_CONFLICT_OR_EXPIRED`。

**修復：** 停用保留管理權限、目標存在和 expectedVersion 校驗，但不要求舊投放／舊 reference 再次有效；重新啟用才重新驗證全部依賴。加入過期 reference 停用及過期版本衝突測試。

### F18 · P2 · 全站共用每分鐘 300 次 redirect bucket【程式碼；容量風險】

所有 `/w/` 連結共用一個資料庫限流 key，超過 300 回 429。不同活動會互相消耗配額，也集中更新同一行。未有壓力測試，不能宣稱日常流量已超限。

**修復：** 按預期投放量設計全域上限＋受控分區配額／邊緣限制；維持有限儲存及私隱要求。對正常客戶提供保留樓盤文字的 fallback、可觀察的限流計數和告警。先測試多活動同時突發，避免取消所有保護。

## 6. 建議的批量 UX 及驗收規格

**入口：** 樓盤管理勾選物業 →「建立 WhatsApp 連結」。保留現有「只選本頁」規則，另提供明確的「選擇全部符合篩選條件」及總數確認；不要靜默把 30 筆擴大為 327 筆。

| 步驟 | 操作人員看到的內容 | 系統行為 |
|---|---|---|
| 1 選樓盤 | 已選數、屋苑、售／租；可刪除單項 | 展開為真實且有效的 offering；不存在租盤不自動建立 |
| 2 選來源 | 網站、28hse、YouTube；活動名稱 | 對應來源才問 external listing ID 或 video ID |
| 3 選接收人 | 跟樓盤代理／統一同事／逐行指定／總台 | 展示映射與通知就緒狀態；不能接收者顯示原因 |
| 4 檢查預覽 | 例如 20 個有效放盤 × 3 來源 = 60 條；新增／重用／有問題 | dry-run 找重複、過期、缺映射與無效 ID；可選只處理有效項 |
| 5 建立及匯出 | 成功、重用、失敗數；可下載 CSV、複製選中行 | 依現有上限分批 50；顯示每批原子結果；重試不重建成功行 |

**建議列表欄位：** 選取、公開樓盤編號、屋苑、租售、來源、placement／活動、指定同事、Inbox 就緒、手機通知就緒、短連結、版本、啟用、最後測試、open 數、有效 enquiry 數、操作。

**CSV 範例欄位：** `public_listing_no, deal_type, source, placement_id, staff_name, tracking_url, status, last_verified_at`。不匯出客戶號碼、供應商機密或內部身份令牌。

**驗收要點：**

1. 20 個有效放盤 × 3 來源可建立預覽中的 60 條，分成最多 50 的批次；數目可核對。
2. 重按提交、網絡斷線重試及只重試失敗批次不產生重複。
3. 其中一個來源下架或同事被停用時，預覽及提交重新校驗，逐項報告；不指向其他盤冒充成功。
4. 可篩選與取回超過 500 條的較舊連結；有選中／全部篩選兩種明確範圍。
5. 編輯／停用使用 expectedVersion；衝突時要求重新讀取，不能覆蓋其他人的更改。
6. 「批量建立連結」不等於批量發訊息。試送是獨立、可核對收件人的操作。

## 7. Onboarding 與後台可用性

### F19 · P2 · 成員 active 狀態與帳戶、邀請、角色混為一談【實測】

團隊畫面顯示 27 已啟用、0 已邀請、0 需跟進；可見多位成員沒有電郵、角色欄空白且未邀請。這只能證明人員記錄 active，不能證明這些人都可登入或接單。

**修復：** 拆分人員在職、邀請已建立／已分享、電郵已核實、登入身份已綁定、角色／分行、WhatsApp 映射、通知測試。總覽「需跟進」按這些必要步驟計算。經紀公開檔案、登入帳戶和 WA identity 用同一 staff ID 關聯，避免同名但不同記錄。

### F20 · P2 · 邀請及首次登入缺少閉環【實測＋程式碼】

邀請 dialog 明確說系統不自動發電郵，需人工分享註冊連結；登入介面為英文，並帶公開網站頁首／大型 footer 和註冊入口。現有受保護的登入流程已可使用，沒有重現登入失效。

**修復：** 首輪可保留人工分享，但要有複製成功提示、到期時間、待接受清單及重發／撤回操作；未真正發電郵就不能顯示「已寄出」。提供繁中 staff login 與首次登入步驟；非獲邀帳戶顯示清楚申請途徑。保留電郵驗證後綁定及既有 owner／角色保護。

### F21 · P2 · 健康指標未能反映真實接單能力【實測＋程式碼】

營運頁顯示正常，但 WOZTELL／排程健康部分依賴設定是否存在，而非成功端到端結果。「未核實映射 0」只數現存 mapping 的核實狀態，漏掉完全沒有 mapping 的同事。Heartbeat 當時約 22 小時前，但目前 worker 為事件驅動，閒置本身不等於排程壞了。

**修復：** 顯示「需要接單同事中的 X/Y 位已就緒」；將憑證存在、最近成功處理、待執行工作時限、webhook 接收、分派確認、通知送達分開。以工作應執行時間判斷事件驅動 worker 是否停滯。文件的 cron 描述須與目前 Durable Object alarm 架構一致。Migration 的「待套用」狀態與總健康結論亦需核對，不能直接盲目執行 migration。

### F22 · P2 · 樓盤批量基礎可沿用，但代理及內容缺漏需進入待辦【實測】

樓盤頁已有本頁全選、批量上下架／草稿／已售／指定代理和修改核對，值得保留。所檢查首批多個公開盤顯示未指派代理，亦有缺屋苑／資料差異標籤，卻未連到 WhatsApp 建立前的完整性檢查。

**修復：** 加入「未指派代理」「缺 WhatsApp 連結」「缺映射」「待核實內容」快速篩選和可執行待辦；從現有列表完成資料補全與連結建立，減少跨 3–4 頁來回。

## 8. 效能

### F23 · P2 · 外部 HTTP 首位元組延遲偏高，需定位瓶頸【量測；非使用者端基準】

| 樣本 | HTTP | TTFB | 完整傳輸 | 備註 |
|---|---:|---:|---:|---|
| 首頁，壓縮回應 | 200 | 11.991 秒 | 12.720 秒 | 傳輸約 55.7 KB |
| A074714 詳情，壓縮回應 | 200 | 13.211 秒 | 13.465 秒 | 傳輸約 15.1 KB |
| 列表原 URL | 307 | 10.206 秒 | 10.207 秒 | 只量到 redirect，不能當完整列表時間 |

另一次未壓縮首頁樣本 TTFB 為 11.175 秒，傳輸約 341 KB。以上來自此次執行環境，包含網絡／代理及可能冷啟動影響；樣本少、地理位置不代表香港，不能宣稱香港客戶全部需等 12 秒。未量測 Lighthouse、LCP、INP、CLS 或 p75。

**修復次序：** 加 Server-Timing／trace，拆分 auth、DB、SSR 和 redirect；以香港桌面／手機多時段量度 cold/warm；檢查部署 iad1 與實際 Neon region 距離後才決定搬 region。對公開資料設定有界快取及發佈／下架失效機制；不要快取 staff/customer 私人資料。

列表使用 canonical ranking CTE，count 與資料頁查詢各自執行；先 EXPLAIN ANALYZE，再决定索引、預計算 current offerings 或快取 count。不可為快取速度犧牲下架優先及公開編號一致性。

### F24 · P2 · 圖片尺寸及批量服務有可優化之處【DOM＋程式碼】

詳情約 76px 的縮圖載入 natural width 750/1200 圖片，未見對應 srcset；約 210px 的 logo 亦使用 1200px 圖片。主要圖及首屏 hero 的需求不同，不宜全部 lazy-load。

批量 provision 逐項 await 驗證，最多 50 條會累積查詢往返；映射頁分散讀取亦可增加等待。

**修復：** 縮圖提供符合 DPR 的尺寸，設 sizes/srcset、固定比例及適當壓縮；主要首屏圖保留優先載入。批量先以集合查詢取得物業、同事及 reference，再做逐行判斷，提交仍重新校驗及 transaction；大批工作可加入可重試 job。後台用整合 readiness API 和快取減少重複授權／讀取。未計算實際可節省百分比。

## 9. 指定同事發訊息：本次結果及下一次驗收

| 階段 | 本次結果 | 解讀 |
|---|---|---|
| Staff 登入 | 通過 | 已成功存取後台 |
| 既有 tracking link 可見 | 通過 | 2 條 28hse 來源，並非網站全量覆蓋 |
| 點擊 `/w/` 並開啟 WhatsApp | 未完成 | 受管瀏覽器組織政策攔截；不能歸咎網站 |
| 實際客戶測試訊息送入公司 WhatsApp | 未執行 | 沒有從測試手機送訊息 |
| 當次 enquiry／assignment 證據可讀 | 失敗 | 既有對話的證據面板持續報錯 |
| 指定同事 Inbox 映射 | 部分具備 | 只見 test 的映射；不等於真實收件同事已設定 |
| 同事 WhatsApp 端點 | 未核實 | 可見的是私人備註端點 |
| 當次 provider acceptance／delivered／read | 無 | 不能以歷史 job 成功代替 |

**關鍵行為：** 點擊連結只會產生開啟／reference 資料；客戶需要真的送出含 EPWA reference 的預填訊息，webhook 才能建立及歸因查詢。不能把「點擊後同事沒有立即收到訊息」單獨判作故障。

**下一次正式驗收腳本（待指定實測同事及核實接收端點）：**

1. 選一名有姓名、staff ID、已核實 Inbox 身份及自己 WhatsApp 端點的同事；在 UI 顯示遮罩目的地及 transport。
2. 使用標示 TEST 的單一樓盤／來源連結及專用測試手機，避免把現有客戶對話改成測試。
3. 預覽文字：「【測試】查詢樓盤 A074714（出售），請轉交指定同事。EPWA:〈系統產生參考碼〉」。不手作可冒充真實 token 的內容。
4. 開啟連結，核對預填樓盤與來源；由測試手機真正送到公司 WhatsApp。
5. 以同一 correlation ID 核對 open → inbound → enquiry → requested staff → assignment request → provider-confirmed staff。
6. 分別核對 Inbox private note 與 staff WhatsApp 的 endpoint、attempt、provider message ID；供應商接受只算 accepted，有 delivery receipt／實際收件確認才算 delivered。Read 另列，不保證一定有。
7. 同事打開工作連結並回覆；驗證回覆關聯正確且不會錯發給客戶或另一同事。
8. 重送相同 webhook／工作重試，確保不重複建立查詢及通知；停用映射／端點時出現清楚阻擋原因。

歷史營運數字含少量測試：曾顯示 4 opens、2 enquiries、2 attributed、1 confirmed assignment、0 human response。樣本不足，也不是本次觸發結果，不應當作轉換率報告。

## 10. 修復安排與交付門檻

| 次序 | 工作包 | 主要負責 | 完成門檻 |
|---|---|---|---|
| A | 公開編號搜尋、UI 和 WhatsApp fallback 一致化 | Full-stack | F01–F03 的 live regression 通過 |
| B | 分派查詢、角色範圍及錯誤診斷 | Backend | 面板可讀且越權仍拒絕；SQL 根因經重現確認 |
| C | 一名同事 onboarding、映射、單筆試送 | 營運＋Backend | 本報告第 9 節有完整當次證據 |
| D | 批量預覽、idempotency、50 筆分批、結果匯出 | Full-stack | 第 6 節六項驗收完成 |
| E | 接單 readiness、健康指標、團隊待辦 | Full-stack＋營運 | 缺映射可見；模式及生效 policy 一致 |
| F | 內容清理及效能量度／優化 | 內容＋Frontend／Backend | 屋苑內容核實；香港基準及改善前後數據 |

A、B 可獨立展開；C 完成後才把指定同事流程擴大至全隊及多來源投放。D 的設計可先行，但不得把未就緒同事默認為可接單。此為建議工作次序，尚未實作或部署。

## 11. 程式碼證據索引

以下連結固定在已審核版本，可交予開發人員定位。GitHub private repository 需要既有權限。

| 議題 | 主要來源 |
|---|---|
| 公開搜尋 | [public-data.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/neon/public-data.server.ts#L486) |
| 首頁查詢編號 | [index.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/routes/index.tsx#L1048) |
| 詳情 breadcrumb／表單／CTA | [property.$listingNo.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/routes/property.$listingNo.tsx)（342、863、1040、1079 附近） |
| 分派 enum/text[] 比較 | [assignment.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/whatsapp-enquiries/assignment.server.ts#L96) |
| staff_role schema | [初始 migration](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql) |
| 分派面板錯誤 | [WhatsappEnquiryContext.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/components/admin/WhatsappEnquiryContext.tsx) |
| 連結列表／驗證／批量／fallback／限流 | [whatsapp-enquiries.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/neon/whatsapp-enquiries.server.ts)（54、60、168、190、290 附近） |
| 批量入口 schema | [whatsapp-enquiries.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/neon/whatsapp-enquiries.ts#L47) |
| 連結 UI | [admin.whatsapp-links.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/routes/admin.whatsapp-links.tsx) |
| 映射 UI | [admin.whatsapp-settings.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/routes/admin.whatsapp-settings.tsx) |
| 同事 WhatsApp transport | [staff-whatsapp-transport.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/woztell/staff-whatsapp-transport.server.ts) |
| 通知 preflight／目的地／版本 | [staff-notifications.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/whatsapp-enquiries/staff-notifications.server.ts#L153) |
| 映射健康統計 | [service-health.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/whatsapp-enquiries/service-health.server.ts) |
| 整體健康檢查 | [health.server.ts](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/lib/control-plane/health.server.ts) |
| 團隊 onboarding | [admin.team.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/routes/admin.team.tsx) |
| 全域 meta | [__root.tsx](https://github.com/YNWAforever/earnestproperty/blob/098844e6a97545e1b590f45c756a8d2ca77db7bb/src/routes/__root.tsx) |

## 12. 已執行測試

Node v24.19.0；以下 36 個測試通過，0 失敗：

```sh
node --test \
  src/lib/whatsapp-enquiries/links.test.mjs \
  src/lib/whatsapp-enquiries/service-policy.test.mjs \
  src/lib/whatsapp-enquiries/staff-reference.test.mjs \
  src/lib/whatsapp-enquiries/release-readiness.test.mjs \
  src/lib/woztell/provider-result.test.mjs
```

覆蓋 reference 生成與預取限制、policy、外部 staff reference、release readiness、provider result 解析等。不能據此證明正式資料庫查詢、供應商身份或手機送達正常。較早擴大測試曾因審核工作區缺少依賴檔案而中止，未把工作區缺依賴當作產品失敗。

可保留的基礎包括：受權限保護的寫入、不可變連結版本及 expectedVersion、分派確認狀態、客戶目的地不能冒作同事目的地、公開讀取不能偷偷 provision、連結預取不建立有效查詢。修復時應延續這些邊界。

## 13. 實測截圖

視覺版報告內附三張原始截圖：A074714 詳情、WhatsApp 連結管理及 A074714 搜尋零結果。截圖只作當次 UI 證據；當中短連結或計數不代表已發送／已送達。後台截圖屬內部審核資料。

<!-- AUDIT_SCREENSHOTS -->
