# EP-17 品質修正草稿與目前範圍讀回

首個產品／驗收 commit `3cc1e1027a06f1195d1f97f9fbd4e10eb51d083e`；獨立審閱修正 `19105d2c07448a5eedb8d158de3e229e04c04b84`。基線 `6e970b07660a016d2ea838bf6392a84f9171cd0e`，正式 main仍 `51cb0e9c08269ebabeb0b593d4dea611b9246c32`。本輪品質修正可保留較新的人工草稿，待原儲存完成後重新讀取使用者目前選擇的範圍；重新載入明細後表單仍可見，同一表單關閉再開可原樣繼續提交。未知 click 分母仍未知；assignment/internal acknowledgement 不當真人回覆。

## RED、審閱及一次修正

基線兩個 canonical RED：原儲存晚到清空另一行較新的 reason；篩選已切租盤後原儲存晚到重新讀取舊 null 租售範圍。修正 fixture 的 event drilldown 入口後保留有效2 FAIL／5 PASS；另 concurrent RED1證明其他行仍可提交。新同步 shared submit guard、editor revision、目前 drilldown callback處理這些問題。最初錯用 event入口及 tab label的失敗均保留，不能加算產品缺陷。

Fresh-context Astra read-only whole-branch review於3cc：inspected paths Critical0、Important1、Minor0；並非逐行完整重審。獨立 owned browser probe重現延遲 records讀回後第二行草稿藏在關閉的 native details；使用者重開時 reason及quality被重設。原80 PASS只查值／enabled，沒有證明可見及可繼續提交，故保留為 pre-review evidence，不能當最終驗收。新增 actual route測試在3cc確實 RED1（expected visible，received hidden）；一次修正19105d2以 kind/id/editor type控制開關，同一 editor close/reopen不清草稿，錯 editor不得提交。focused10 GREEN，再跑 exact committed全套。沒有第二位 reviewer；審閱者未獨立重跑全套 browser／SQL／shared／typecheck／lint／build。

獨立 reviewer同時檢視 Auth/source revision/repair/knowledge/campaign/bulk相關累積路徑及 diff check；累積輸出曾截斷，不能聲稱所有 branch行數都覆核。拒絕延伸範圍的裁決：true Auth/session expiry/full roles/scopes/routes/flags、provider/model/transport、品質寫入 committed但回應遺失的 unknown outcome恢復、完整 qualification旅程、combined real UI/SQL、native IME/clipboard、production app/worker/schema/config、Property.hk完整 dt/detail/media及三次 native schedules，維持 BLOCKED／NOT_READY。誤當通過的代價是錯權限／虛構 delivery或模型預算／重複不明寫入／錯誤撤盤／全動作及排程誤批准。本次沒有拒絕 Important finding；Minor0。

## 分層驗收

- final19105d2 actual analytics route/dashboard/table/AdminShell/staff store/CSS，synthetic Auth/API，owned loopback GET/HEAD，四尺寸1440/1280/768/390各21＝84 PASS、0 FAIL/SKIP；原48保留，新品質36包含有效原因 trim、同分母明細及CSV、reload後 fixture修訂讀回、另一行較新草稿、跨行單次提交、delayed records→表單可見→close/reopen→原樣第二次提交、目前 rent scope晚到讀回、write前明確拒絕及顯式 retry、晚到拒絕不貼錯行、test response event恢復 production、actor轉換不讀舊 workspace。拒絕 fixture在寫入前拋錯；這不是 committed-lost-response品質寫入恢復。
- separate fresh owned PostgreSQL17 full85 migrations，actual getSalesPerformance/listPerformanceRecords及reviseInquiryQuality/revisePerformanceEventQuality，加 independent raw SQL7 PASS、0 FAIL/SKIP（parent＋6）。production inquiry4→test3→production4、IDs/CSV cohort相符；原 inquiry事實未改；actor/reason及原修訂prefix完整，append-only DELETE拒絕。response event test後 median unavailable／未回覆4，恢復 production後15分鐘／未回覆3；assignment1及 inquiries4未變，原 event identity/content未改。manager403、空 payload／unknown enum／短reason400、missingevent404，不新增revision。zero-fetch guard實際0。這是既有 server guard驗收，本次沒有 server SQL產品修改；trusted actor port不等於真登入，browser與SQL不是聯合旅程。
- 3cc exact SQL初次0 PASS／1 FAIL於 helper SELECT1就緒檢查連線中斷，migration和case尚未執行；原因 UNPROVEN。保留原log及hash，沒有改 helper timeout。final19105d2另一次 standalone fresh owned執行7 PASS，不掩蓋setup失敗。早期 SQL期望漏掉原 production revision的5 PASS／2 FAIL（含parent）亦保留為fixture錯誤，已改為prefix完整再加test/production，不能當 server RED。
- final19105d2 analytics Node65＋Bun3、no-link Node99＋Bun9、shared actual-route synthetic browser115 PASS，shared115與84分開；typecheck、lint、build分開exit0，lint3個baseline warnings。既有TanStack validator deprecation／Vite builder warning屬build診斷，build確實完成。390 confirmed screenshot已目視；四尺寸overflow断言及獨立confirmed／totals圖片hash保留，表格只在卡片內捲動。

## 動作、歷史及限制

ACT55/56/57及19個 overlapping source controls＝22記錄，仍 LOCAL_PARTIAL，不能當22個business actions。本次新增原baseline ACT-S0200 test-followup Button、0208 form、0210 reason Input、0211 save Button，從原SHA檔案及catalog核對再實際操作。0208是form，沒有把select捏造成新ID；native summary亦沒有 invented baseline ID。未操作的quality variants、qualification、records close/load-more及其他元件不升格。

兩份CSV只追加 execution actual_result／SHA／環境／evidence，原60的29 PASS／9 FAIL／22 BLOCKED不覆蓋；22 planned NEW不是已通過；共82，execution40 PASS／28 PARTIAL／14 BLOCKED不變。TEST46仍BLOCKED，NEW17仍PARTIAL。原EP17 48/4及所有舊 execution-evidence keys保留；新entry `performanceQualityCorrectionFollowup`，1400 action IDs／baseline欄位及408歷史render observations不改。原AI probes PASS仍表示原缺陷存在。

## Config、migration dry-run與rollback

runtime/provider IDs、正式flag/config/schedule、DTO/schema/migration差異0；all85 migration只在新的 owned DB dry-run。普通portal零EPWA、parser/receipt/CAS/草稿隔離／批量links／Inbox picker／分段sync、source/account/branch/ad/offer/canonical、人工protected edits、歷史 receipts及outbound intents保留。無merge、production deployment/config/migration、真客戶發送、provider request或paid model call。

Rollback先限制受影響品質修正入口及匯出，獨立讀回目前actor/scope的原 inquiry/event和品質修訂，再回退相容介面。品質歷史、changed_by、reason、事件／來源身份及人工草稿保留，不補造click/response、不delete revisions；UI回退會失去較新草稿保護及目前scope讀回，恢復入口前要再次核對。結果不明的品質寫入須先確認原source/history，再決定是否重試；本輪沒有其完整UI恢復驗收。

owned品質草稿／目前scope修正讀回 **READY**；真Auth／provider／combinedSQL／unknown品質寫入結果／完整qualification **BLOCKED**；完整roles/actions與native三次驗收 **NOT_READY**。28Hse120/20/45/10、04:17HKT保留，baseline eligible1/3、repaired production0/3、new native collection runs0。此次唯讀metadata看到main51cb的watchdog37099627650於2026-10-03 13:22:43HKT schedule success；這是watchdog，不能增加Daily property collection的驗收次數。最新daily仍37079390201，baseline1/3；未觸發manual/replay。Property.hk EPS/EPT/EPW及approved dt須page1→terminal＋真detail/media；403/partial/index-only不能撤盤；歷史132候選仍held。
