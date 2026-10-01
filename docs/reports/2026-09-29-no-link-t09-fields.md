# T09 欄位決定台帳

對照附件 audit 05 第 107–146 行。狀態是本分支的實作證據；未完成項保持未完成，建議值不代表已核准。

| 欄位 | 決定 | 本地狀態 |
|---|---|---|
| 同事姓名／工作電郵／分行（MappingWizard） | KEEP；從團隊帶入，無UUID | T09 本地 UI／guard 已處理；外部接駁待驗 |
| Folder名稱 | RENAME「接單群組」；唯一可預填，顯權限範圍 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| Inbox帳戶候選／搜尋 | KEEP＋AUTO-POPULATE verified user ID；目前picker已存在 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 本地Folder代碼 | ADVANCED ONLY；support管理 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| Folder顯示名稱 | KEEP於support設定 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| provider Folder ID | ADVANCED ONLY；無enum能力時不造假選項 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 停用原因 | KEEP；加目前待辦影響 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 來源／帳戶（StaffReferenceEditor） | MERGE為已核准來源帳戶選項；PropertyHK列舉需增量契約 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 來源帳戶識別碼 | AUTO-POPULATE from sync；ADVANCED ONLY override | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 原始同事代碼 | AUTO-POPULATE候選；核實後使用 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 核實紀錄編號 | AUTO-POPULATE由驗證操作生成；manual evidence交support | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 通知方式（EndpointEditor） | RENAME「內部備註」／「同事手機通知」；分區，預設不啟用手機通知 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 已核實同事WhatsApp收件ID | REMOVE FROM NORMAL FLOW；support verified named endpoint；遮罩電話核對 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 收件ID核實紀錄 | AUTO-POPULATE核實結果，保留審計 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 同事接收授權紀錄 | 可讀「通知用途／授權紀錄」；證據由受控流程保存，不能刪檢查 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 全天候通知 | SAFE DEFAULT false；有批准才開，對單endpoint明示 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 啟用目的地 | KEEP；按能力檢查，顯阻塞原因 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 試送人工收件確認／證據 | KEEP在支援試送結果；與provider receipt／接手分開 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| 政策載入版本 | ADVANCED ONLY；正常顯目前生效摘要 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 時區 | SAFE DEFAULT Asia/Hong_Kong建議值；部署仍須批准 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 工作日／假期／已核對假期表 | MERGE日曆控件，空表與未核對不同 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 08:00前／正好開門／正好關門 | MERGE「營業時段規則」摘要；advanced顯界線例子，不刪policy保障 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 日間期限跨關門／計時方式 | KEEP主管批准一項政策；用例示展示 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 總台查詢規則 | KEEP明示涵蓋對象，非agent日常決定 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 可接受來訊延遲秒 | ADVANCED ONLY；經測量的安全值，不能直接拿建議當實測 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 問卷有效時間秒 | ADVANCED ONLY；不阻普通intake | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 工作佇列容許延遲秒 | ADVANCED ONLY＋健康提示 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 人手已回覆後問卷 | SAFE DEFAULT不再打擾之建議；需正式policy approval才生效 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 負責經理 | KEEP；不手填staffId | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 文案版本 | AUTO-POPULATE revision | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 非辦公時間文案 | KEEP，顯示完整預覽及用途 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 模擬來訊時間／入口 | ADVANCED ONLY；本地時間picker＋時區，結果只模擬 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| 批准紀錄／生效時間 | KEEP受控管理；不可用簡化名義去除確認 | 保留既有保障；需隔離瀏覽器／provider 核實，未宣稱已簡化 |
| inquiry source／ID／requestedStaff | AUTO-POPULATE可讀結果，exceptions才修正 | T09 本地 UI／guard 已處理；外部接駁待驗 |
| campaign名稱／群組／範本／語言 | KEEP但中文「推廣活動」；同名群組加人數／更新時間 | T12 待處理；不可當已完成 |
| estate slug／district slug／agent ID | RENAME有權屋苑／地區／同事選擇器，ID由server解析 | T12 待處理；不可當已完成 |
| 範本變數／header／body／buttons | KEEP完整已核准預覽＋變數validation；unknown禁止確認 | T12 待處理；不可當已完成 |
| scheduled_at | RENAME「計劃發送時間（需人手確認）」；不擅自開無人發送 | T12 待處理；不可當已完成 |
| source／placement／route／verification（LinkWizard） | REMOVE FROM NORMAL FLOW；留推廣進階；維持舊URL與report | T12 待處理；不可當已完成 |
| tracking token／Channel／App／webhook secret | ADVANCED ONLY server config；任何日常查詢0手填 | T12 待處理；不可當已完成 |

政策時區／營業時間／問卷／retention 僅保留建議與既有驗證，沒有在本 session 啟用或改正式配置。接單群組須讀真實目錄；無列舉能力時只顯示支援人員管理的已核實設定。
