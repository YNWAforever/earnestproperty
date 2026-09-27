# Earnest Property 最終覆核：WhatsApp、同事設定及銷售分析

**覆核日期：2026-09-27（香港時間）｜結論：局部修復已上線，仍未達到完整營運驗收。**

本次以 GitHub `main` **3ebe4e3cb47807e8d870f2b9eac90954f73f4f11** 為程式基準；核對的 Vercel production deployment 使用相同 SHA。最新修正為 PR #202：WhatsApp 連結列表日期序列化問題。以下是當日再覆核的結果，並非重複引用上一份報告的未修狀態。

## 1. 決策摘要

1. **連結列表已可正常使用。** 實際載入 3 條連結，樓編搜尋、來源／同事／狀態篩選、分頁和匯出入口均存在；本次沒有再遇到日期物件導致畫面崩潰。
2. **Haze 仍未就緒。** 同事設定沒有 Inbox 映射及通知目的地；分派、私有備註、同事 WhatsApp 三項均顯示阻擋。手機通知另有運作模式未啟用、供應商能力未核實。
3. **Haze 連結預覽會正確阻擋。** A074714／售／網站／指定 Haze →「指定同事缺少已核實 Inbox 映射」，建立按鈕停用。同一樓盤改為總台 → 預計建立 1、阻擋 0。這證明預覽防線生效，並不證明 Haze 已能收到訊息。
4. **四步設定仍是技術表格。** 畫面把欄位分成幾步，但沒有讓使用者選取真實 Inbox 帳戶、資料夾、分行及自動核實；因此 Haze 的設定困難仍然成立。
5. **銷售及代理績效分析尚未完成。** 現有分析頁是按建立日期統計查詢、線索和對話；成交表單也未提供負責代理、佣金及 CRM 關聯，未具備完整績效計算資料。
6. **追蹤覆蓋仍有缺口。** 首頁抽查 6 個樓盤 WhatsApp 按鈕，全部直接使用 `wa.me`，沒有經 `/w/` 追蹤短連結。預填文字已改善，但不可把這些按鈕當成完整可歸因入口。

**建議發布判定：** 可保留現有瀏覽、搜尋及總台查詢；暫不把「指定同事自動接收」「完整批量推廣」「代理績效報表」標示為全部完成。是否可以正式啟用指定同事流程，應以真實帳戶映射、分派讀回、供應商結果和同事收件證據決定。

## 2. 覆核範圍與證據界線

| 類別 | 本次完成 | 未完成／不作結論 |
|---|---|---|
| 程式 | 最新 commit 的 WhatsApp 精靈、設定、供應商 adapter、批次預覽、分析 SQL、總覽及成交表單 | 並非整個 repository 的全面滲透測試 |
| 公開網站 | 首頁、A074714 搜尋、售盤詳情、CTA、相片 DOM | 未逐一覆核所有屋苑文案；沒有本次 mobile CWV／負載基準 |
| 後台 | 已登入管理員的總覽、物業管理、WhatsApp 連結／設定、分析、成交列表及新增表單 | 未重新執行完整邀請、密碼重設及 agent 身分權限矩陣 |
| 預覽 | Haze 阻擋及總台可建立兩條路線 | 未按「確認建立」；未測真實新增、重複提交或大量資料寫入 |
| 通知 | 閱讀實際 readiness 及程式控制 | 沒有試送；Haze 沒有可核實收件目的地，不能宣稱已送達 |
| 測試 | 本地 20 個相關純邏輯測試通過 | 未重跑完整 build、資料庫整合測試或全部 CI |

預覽 API 會建立有效期 10 分鐘的暫存預覽紀錄；本次沒有新增追蹤連結、修改同事映射、改派客戶或發送 WhatsApp。完成後已從畫面清除未提交預覽。未因測試而把 Haze 勾選為「已核實」。

## 3. 已確認改善

| 項目 | 現場結果 | 判定 |
|---|---|---|
| WhatsApp 連結列表崩潰 | 3 條既有資料正常呈現；DTO 已使用 `dateOrNull` | 本次未再重現，修正與現場一致 |
| 公開樓編搜尋 | 首頁搜尋 A074714 → 1 個正確售盤 | 通過抽查 |
| 客戶預填文字 | 含 A074714、出售及樓盤標題 | 通過抽查 |
| 詳情麵包屑 | 顯示公開編號 A074714 | 通過抽查 |
| 不可用同事路線 | Haze 被預覽阻擋，建立按鈕停用 | 通過負面案例 |
| 總台路線 | 同一售盤可通過預覽 | 通過預覽，未驗證提交及收件 |
| 能力分開顯示 | Inbox 分派、私有備註、手機通知分開 | 方向正確，仍需改善操作 |
| GA4 缺資料 | 顯示「未接駁」，沒有假裝成 0 | 正確 |
| 服務承諾 | 首頁改為「由團隊按可用人手跟進」 | 抽查頁面未再看到 5 分鐘承諾 |
| 批量基礎 | 物業管理有本頁已選／全部符合篩選入口；程式有預覽、50 行提交、恢復進度 | 已有基礎；不應重新當成完全沒有批量功能 |

## 4. 剩餘問題清單

優先級：P1＝阻礙核心營運或造成重要數據誤讀；P2＝明顯效率／體驗／內容缺口。本表的「程式」表示靜態確認，不代表已在 production 製造相應故障。

| ID | 優先 | 問題與影響 | 證據 | 修復方向 |
|---|---|---|---|---|
| R01 | P1 | Haze 沒有映射及目的地，指定路線不可建立、不可試送 | 現場＋預覽 | 先完成真實身分連接；以各能力結果分別驗收 |
| R02 | P1 | Inbox 設定要求人手填技術 ID，沒有帳戶搜尋及權限核對 | 現場＋程式 | 供應商帳戶選擇器、具名稱的 Folder 選單、伺服器核實 |
| R03 | P1 | 人工「已核實」紀錄與供應商自動核實未明確分級 | 程式 | 分為人工審核、供應商核實、試送接納、已送達、同事確認 |
| R04 | P1 | Folder 語意不清：目前 adapter 要求對話本來已在指定 Folder，不會自動搬 Folder | 程式 | 顯示路線前提；提供正確政策及例外處理，避免猜填私人 Folder |
| R05 | P1 | 銷售／代理分析缺少成交、佣金、看樓、回覆及分行／同事維度 | 現場＋SQL | 補齊資料模型、指標定義、篩選和明細下鑽 |
| R06 | P1 | 成交表單沒有負責代理、分佣、CRM／樓盤關聯 | 現場＋表單 | 先補成交歸因資料，才建立績效排名 |
| R07 | P1 | 總覽「公開放盤 1,185」實際取全部 `properties` rows；物業管理是 327 個目前公開物業 | 現場＋SQL | 使用同一公開資格及去重規則；分開物業數與租售盤數 |
| R08 | P1 | 首頁抽查 6/6 樓盤 CTA 未經追蹤短連結 | DOM | 建立網站入口覆蓋率及補建流程；公開渲染使用對應有效版本 |
| R09 | P2 | 批量精靈一次只選一個來源，外部投放 ID 要逐行輸入 | 現場＋程式 | 多來源矩陣、網址解析、貼上表格／CSV 匯入、範本 |
| R10 | P2 | 一行 blocked 即停用整批提交；修正跳回第 1 步 | 現場＋程式 | 行內修正／前往該同事設定；明確選擇只提交合格行並重新預覽 |
| R11 | P2 | 通知步驟混入外部職員代碼映射，重複要求 Channel／目的地／證據 | 現場＋程式 | 外部來源代碼移到進階；能安全推導的欄位自動帶入 |
| R12 | P2 | 試送按鈕兩個同名，阻擋原因沒有直接修復操作；空白步驟可一路下一步 | 現場 | 分開命名、具體修復連結、完成／未設定狀態及未儲存提醒 |
| R13 | P2 | 映射儲存沒有 expectedVersion，兩位管理員可能互相覆蓋 | 程式，未製造競爭 | 樂觀鎖、409 衝突、差異比較及更新審計 |
| R14 | P2 | 分析查詢未排除測試／垃圾資料；建立日期 cohort 與即時待辦容易混讀 | SQL＋現場 | 指標逐項定義分母及時間口徑；提供資料品質旗標 |
| R15 | P2 | A074714 標題仍寫 VR 實景，但詳情僅相片；附近交通出現青龍頭內容 | 現場 | 按實際媒體能力顯示文案；屋苑／地區交通內容重新核對 |
| R16 | P2 | 76px 縮圖仍使用與主圖相同 Blob URL，未提供 srcset | DOM | 真正產生／供應縮圖變體，配合 sizes、lazy loading；量度後驗收 |

## 5. Haze 同事接收設定：應如何改

### 5.1 現有欄位的正確意思

| 欄位 | 現時要填甚麼 | 應改成甚麼 | 不應如何處理 |
|---|---|---|---|
| 實際 Inbox User ID | Haze 在該 WOZTELL 租戶／公司 Channel 的真實 Inbox user identity | 搜尋名稱／電郵，顯示帳戶、角色、Channel；選取後記錄 ID | 不可填網站 staff UUID、姓名或猜測電話 |
| 已核對 Folder ID | 已確認 Haze 可接觸、並符合實際對話路線的 Folder | 顯示 Folder 名稱及可存取狀態；選擇後伺服器核對 | 不可一律猜 `main`，也不可當成系統會自動搬 Folder |
| Routing Node ID | 只有選用相應節點路由時才有意義 | 依實際 adapter 顯示；direct assignment 模式隱藏 | 目前 direct adapter 不使用它，不應為完成表格隨便填 |
| 分行 ID | 本網站團隊／分行範圍限制 | 既有分行選單，能由職員資料帶入時帶入 | 不可混用 provider Folder ID |
| 核實紀錄編號 | 指向真實人工核對證據的參照 | 系統產生核實事件 ID、時間、操作者、驗證結果；人工補證可附註 | 不可把任意文字當作已取得供應商核實 |
| 已核實且可列為分派候選人 | 允許該映射參與分派 | 只有必要檢查通過才可啟用；停用另設明確操作 | 不應用這個勾選框代替連線、身分或收件驗證 |

本次無法從網站取得 Haze 的真實 provider User ID／Folder，也沒有替她猜填。這是應由系統查詢並讓管理員確認的資料。

### 5.2 建議的四步操作

**第一步：選同事。** 顯示 Haze 的網站帳戶、分行、工作電郵及啟用狀態。只有同名不能自動綁定；電郵匹配也先提供候選，由管理員確認帳戶。

**第二步：連接 Inbox。** 按「搜尋 Inbox 帳戶」→ 選取具可辨識資料的候選 → 選具名稱的 Folder → 按「檢查連接」。成功才顯示綠色身分與存取證據；錯誤要分為權限不足、帳戶不存在、Channel 不符、Folder 不可用、暫時無法連線。ID 放到可展開的進階區。

**第三步：選通知。** 使用者選「只在 Inbox 接單」「另加私有備註」「另加 WhatsApp 通知」。公司 Channel 由設定帶入；私有備註目的地可引用已核實的 Inbox mapping，仍保持獨立能力驗證。手機通知保留獨立收件身分、遮罩顯示、許可及可用時段，不直接把 Inbox ID 當 WhatsApp 收件 ID。28hse／YouTube 外部職員代碼移到選填進階設定。

**第四步：驗證。** 三張獨立狀態卡，每張有具體下一步。「測試 Inbox 私有備註」及「測試同事 WhatsApp」使用不同名稱，顯示實際目的地摘要、訊息內容、證據時間及重試狀態。分派成功須有 provider readback；發送接納、已送達及同事確認分開記錄。

現有 adapter 已宣告 `listUsersUrl` 設定，但沒有暴露使用者清單查詢方法，精靈也未使用目錄。WOZTELL 官方文件的 `GET /list-users` 支援 Channel／Folder 篩選並返回 user ID、名稱及電郵，可作帳戶選擇器的基礎。官方文件將更新 Folder 與更新負責人分為不同 API。**本次未核實該租戶有「列出全部 Folder」介面**；若沒有，應由管理員維護具名稱的 Folder 清單，再核對帳戶存取能力，不能憑空假定存在該 API。[官方文件](https://doc.woztell.com/docs/integrations/inbox/inbox-integration-public-api/)

### 5.3 Haze 的驗收門檻

- 系統能辨識真實帳戶，不靠同名猜測；拒絕錯 Channel、無權存取 Folder 及已失效帳戶。
- 映射記錄含版本及核實來源；人工審核不顯示成 provider 核實。
- A074714 指定 Haze 預覽通過，且明示實際已就緒能力。
- 在經確認的測試對話中，分派要求與供應商讀回一致；沒有把真實客戶改派作試驗。
- 每種已啟用通知分別取得發送結果；如有 delivered receipt，顯示該 receipt；最後記錄同事實際收件確認。
- 未完成其中一項時保持該項「待核實／阻擋」，不以整頁「完成」取代。

## 6. WhatsApp 批量連結：下一版應解決甚麼

現有程式不是逐行 HTTP 查詢的舊做法：預覽已用集合式 SQL 接收最多 1,000 行，提交按 50 行分塊，並有進度與不確定結果處理。應保留這些設計，集中改善使用者輸入及例外修復。

### 6.1 建議操作流程

1. 在物業管理選本頁物業或全部符合篩選；顯示物業數與實際租售筆數，避免 20 個物業被誤認為固定 20 條連結。
2. 多選來源，例如「網站＋28hse＋YouTube」；預覽展開後的列數。20 筆租售 × 3 個來源＝60 行；只有有實際投放識別的行可建立。
3. 網站投放由系統核對公開路徑和租售狀態；28hse／YouTube 允許貼網址或貼表格，由系統抽取 ID，再讓人核對，沒有資料不自動捏造投放。
4. 指定同事選单顯示「Inbox 已連接／未連接」「手機通知未啟用」等狀態。預設路線需清楚選擇；不要把「有樓盤」默認等同「已指派代理」。目前預設是總台。
5. 預覽每行顯示樓編、租售、來源、投放識別、跟進同事、連結決策及具體阻擋原因；提供「修正 Haze 設定」並可返回原批次。
6. 有問題的行可另存待處理；使用者明確選「只提交 59 行合格資料」後重新產生對應預覽及 token，保留原有快照、去重及版本檢查。
7. 完成後提供「複製全部」「按來源匯出」「失敗行 CSV」「只處理未完成行」。建立短連結與已發布到外部平台使用不同狀態。

### 6.2 必須保留及新增的保護

- 同一投放重試重用既有連結；租／售、來源、跟進路線不錯配。
- 原快照不能被前端任意改行後沿用 token；合格子集需要重新預覽。
- 同事映射過期、停用、盤源下架及同時修改，提交時仍要重新核對。
- 斷線或不確定結果先查證已提交 chunk，不能直接重送。
- CSV 防公式注入、不可匯出收件憑證或原始私人目的地。
- 前端來源代碼映射尚未在連結精靈可選；現有 `referenceMappingId: null` 不等於其他查詢渠道完全未使用該功能。若業務需要在此選擇，加入有來源範圍的候選，而非另造重複映射。

### 6.3 量化驗收

在隔離測試環境驗收 1／50／300／1,000 行；另測 20 筆租售 × 3 來源、1 行無效、同事失效、重複匯入、預覽過期、提交斷線、兩位管理員同時修改。記錄 preview p50／p95、每 chunk 耗時、SQL 計畫及錯誤率，再制定服務目標。本次沒有執行 production 大量寫入或負載測試，不能把現有程式結構當成已達性能 SLA。

## 7. 銷售與代理績效：目前缺的是資料閉環

### 7.1 現場數據

分析頁預設 2026-08-29 至 2026-09-27：查詢 3、已連結線索 1、銷售線索 2、WhatsApp 對話 1；未分配查詢 2、未分配線索 1、未分配對話 1、未關閉對話 1。GA4 報表明確未接駁。成交列表未顯示任何成交。

報表 SQL 只聚合 `inquiries`、`crm_leads`、`whatsapp_conversations` 的建立日期及當前分派／狀態。沒有成交 JOIN 或代理分組。當前未關閉狀態會隨之後操作改變，因此這是「期間建立的資料，目前的狀態」，不是歷史某一天結算時的狀態。

總覽顯示待處理對話 9，分析頁顯示未關閉對話 1，可能各自在其口徑下正確：前者讀全期 open，後者只看期間建立而目前未 closed。需要明確區分；不能直接當成漏了 8 宗。

### 7.2 建議指標及計算契約

| 指標 | 應採用的資料及口徑 | 防止誤讀 |
|---|---|---|
| 查詢量 | 期間收到的有效查詢，按來源／樓盤／同事分組 | 排除 test／spam；點擊不算查詢 |
| 唯一客戶 | 去重後 contact identity；明示跨渠道合併規則 | 同一客戶多次詢問不能當多人 |
| 首次真人回覆 | 入站到首個合格真人回覆；median、p90、超時比例 | 排除 bot、系統回覆及測試；定義營業時間版本 |
| 接單／工作量 | requested、provider confirmed assignee、目前 owner 分開 | 網址指定人不等同實際接單人 |
| 看樓 | 已完成看樓 activity，關聯查詢／lead／agent | 預約未完成不可當完成 |
| 轉換 | 查詢→合格線索→看樓→成交，明示 cohort、去重及窗口 | 當日成交÷當日查詢通常不是同批轉換率 |
| 成交宗數 | 經核實的本公司成交，按成交日及租售區分 | 公開市場參考成交、重複記錄及取消成交另處理 |
| 成交金額 | 買賣總價；租務月租另列 | 不把月租與售價直接相加 |
| 佣金／代理貢獻 | 實際佣金、應收／已收、合作同事 credit share | 不把物業成交價稱為公司收入；分配合計需驗證 |
| 待辦存量 | 截至現在的未處理／逾期工作 | 與期間新增量分開，提供明細下鑽 |

### 7.3 資料與 UI 修改順序

先評估現有 `crm_leads` 的 `closed_won`／`closed_lost`、活動及成交表，補上缺少的關聯、成交核實狀態、成交代理／分行快照、佣金及合作分配。保留編輯審計；職員調分行不應無意改寫歷史歸屬。

之後新增日期、分行、同事、來源、租售篩選；分為「新增與轉換」「代理回覆及跟進」「成交及佣金」「當前待辦」。每個數字可以查閱相應記錄，顯示定義、更新時間及缺失資料率。agent 只看獲授權的資料，manager／admin 的全隊範圍必須在伺服器驗證。

對缺少負責人的歷史成交顯示「未歸因」，不要把建立者、目前樓盤代理或最後修改者自動當成成交代理。現時沒有成交資料時使用明確空狀態，不應生成假排行榜。

## 8. 公開內容與性能仍需跟進

**公開放盤數字：** `/admin` 的「公開放盤」取 `SELECT count(*) FROM properties`，未套用公開、租售版本或 canonical grouping；顯示 1,185。物業管理的目前公開列表顯示 327 個物業、租售合併計一次。兩者不能共用模糊名稱。應選擇同一 canonical 公開物業口徑，或把來源紀錄數明確命名為資料匯入統計。

**VR 與交通：** A074714 的首頁、搜尋及詳情標題仍帶「VR實景」，詳情媒體只有相片 tab；附近交通段落包含「青龍頭段」。這代表先前「顯示層清理」的工作記錄不能作全站完成證明。應追查實際 renderer 是否共用清理函式，以及「VR實景」是否被規則涵蓋；交通文案按屋苑地區核對，不能將通用內容當本樓盤專屬描述。

**圖片：** 現場 DOM 顯示 76px 縮圖與主圖使用相同 Blob URL，且未設 `srcset`；這證明未按此顯示尺寸提供候選來源，不等同已量得特定節省百分比。應建立變體供應／回填策略，讓縮圖真正取得較小檔案；同 URL 可由瀏覽器快取，亦不應把每次顯示都計成重複下載。

**報表效能：** 保留 server-side 聚合及最長 90 日日期限制；加入來源／agent 維度前先量度 query plan。按實際查詢選擇索引或每日聚合，避免每張卡各讀全表。按角色、分行、日期及資料版本分隔 cache，避免授權資料交叉顯示。這些是建議，並非本次已證實的 DB 延遲故障。

## 9. 交給 Codex 的修復次序

| 批次 | 範圍 | 主要入口 | 完成標準 |
|---|---|---|---|
| A | Inbox 目錄、Folder 核對、映射版本 | `StaffMappingWizard.tsx`、`assignment.server.ts`、`inbox-api.server.ts` | Haze 透過選擇完成；錯帳戶及版本衝突被阻擋 |
| B | 通知步驟與試送體驗 | `StaffEndpointEditor.tsx`、`StaffTestNotificationDialog.tsx`、readiness | 三能力分開、不同按鈕、清楚修復操作；真實收件另附證據 |
| C | 批量連結及網站覆蓋 | `WhatsappLinkWizard.tsx`、`whatsapp-link-batches.server.ts`、公開 CTA | 多來源、URL／CSV、行內修復、合格子集重預覽、網站覆蓋可追蹤 |
| D | 總覽數字與成交資料 | `admin-data.server.ts`、`admin.index.tsx`、`TransactionForm.tsx` | 公開數字口徑一致；成交可歸因且可審計 |
| E | 績效報表 | `reporting.server.ts`、`admin.analytics.tsx` | 指標可下鑽、權限正確、測試資料排除、歷史歸因一致 |
| F | 公開文案與圖片 | 首頁／搜尋／樓盤 renderer、媒體變體 | 無無依據 VR 承諾、交通正確、相片載入經量度 |

實作前以當時最新 HEAD 再核對，避免覆寫 PR #202 的日期修正及已完成的快照、冪等、權限與批次保護。若需要 schema migration，先在隔離環境驗證資料遷移及回退，不以這份審核報告視為已完成 production 驗收。

## 10. 可追溯程式與測試

以下連結均固定於本次 commit；行號可由對應檔案查閱。

| 證據 | 原始碼 |
|---|---|
| 映射精靈、必填欄位、步驟 | [StaffMappingWizard.tsx](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/components/admin/whatsapp/StaffMappingWizard.tsx) |
| 人工核實 upsert、無版本條件 | [assignment.server.ts](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/lib/whatsapp-enquiries/assignment.server.ts) |
| 預留 listUsers、Folder 必須已匹配 | [inbox-api.server.ts](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/lib/woztell/inbox-api.server.ts) |
| 通知目的地及重複輸入 | [StaffEndpointEditor.tsx](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/components/admin/StaffEndpointEditor.tsx) |
| 單來源、blocked 阻止整批 | [WhatsappLinkWizard.tsx](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/components/admin/whatsapp/WhatsappLinkWizard.tsx) |
| 批量 SQL、暫存預覽、分塊提交 | [whatsapp-link-batches.server.ts](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/lib/neon/whatsapp-link-batches.server.ts) |
| 日期 DTO 修正 | [whatsapp-enquiries.server.ts](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/lib/neon/whatsapp-enquiries.server.ts) |
| 分析聚合及未接駁 GA4 | [reporting.server.ts](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/lib/analytics/reporting.server.ts) |
| 總覽 properties 原始計數 | [admin-data.server.ts](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/lib/neon/admin-data.server.ts) |
| 總覽標籤 | [admin.index.tsx](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/routes/admin.index.tsx) |
| 成交欄位 | [TransactionForm.tsx](https://github.com/YNWAforever/earnestproperty/blob/3ebe4e3cb47807e8d870f2b9eac90954f73f4f11/src/components/dashboard/TransactionForm.tsx) |

本次本地執行：

```text
node --test src/lib/whatsapp-enquiries/readiness.test.mjs src/lib/woztell/provider-result.test.mjs
17 passed / 0 failed

node --test src/lib/analytics/reporting.test.mjs
3 passed / 0 failed
```

這些測試驗證能力分離、provider 回應判讀及聚合資料驗證，沒有取代 live provider、資料庫及端到端收件測試。

證據包附有 Haze 欄位、阻擋狀態、Haze 連結預覽、分析頁和 A074714 詳情截圖，以及測試輸出。截圖是本次已登入管理員的觀察，不應公開當作網站宣傳素材。
