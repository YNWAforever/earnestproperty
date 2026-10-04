# EP-17 績效報表身份隔離與獨立讀回

產品修復 `ddd9318464c09c0eb32d19dcd5a16f04ec5d0f2e`；測試補驗 `fa379ea97ed906155a27e29d3f9cf44325481fda`。fresh main仍51cb0e9。產品只改admin.analytics：以已驗證user/staffId/roles作workspace身份，讀取未完成或無主管權限不載入報表；切換重建state並清除舊報表／options／明細／CSV。原請求取消／明細epoch隔離晚到回應，已離開workspace的quality/qualification回應不啟動新的讀取。兩SHA只有e2e及舊static-render test不同，runtime tree相同。沒有新DTO/schema/migration/runtime/provider ID或正式flag/config。

## RED與測試接駁

三個canonical RED：切actor舊CSV仍可匯出；同actor改staff binding仍4而非1；切actor後釋放舊report response顯示4而非1。原3FAIL log中的late case最初先等待新read而失敗，另1FAIL log改為先釋放舊回應，以後者作晚到結果證據；同scenario不加算第四缺陷。

新fixtures首次24 PASS／8 FAIL因誤把CRM lead推算成「唯一客戶」及錯用成交卡片名；改為保留unknown與既有已核實成交label。SQL曾錯用title欄及responses key；從實際migration／allowed keys修正。e2e global type曾TS2339；正確shared type載入後通過。舊static-render fixture未提供新增Auth/staff ports，Node64 PASS／1 FAIL；補synthetic verified manager ports後65 PASS，原零值／GA4 unavailable／私隱斷言保留。這些失敗均保留及hash，並非產品RED或PASS。新增cleanup lint warning已修正，只餘3 baseline warnings。

## 分層結果

- latest test SHA四viewport1440/1280/768/390各12＝48 PASS、0FAIL/SKIP。actual analytics route、dashboard、table、AdminShell、staff store及CSS；synthetic Auth/API、GET/HEAD owned loopback、獨立build目錄。actor/binding/role轉換、晚到report/records、降權零新report reads與恢復、非法URL明確reset、flagoff零績效reads、filter及明細失敗無舊CSV／假零均已操作。
- 日期／分行／同事／來源／租售／30日觀察期均真的操作；URL reload保留全部值，filtered rent記錄1及CSV1逐ID核對。baseline cohort含quality production4/test1/spam1/unknown1；HK midnight邊界排除翌日，duplicate inquiry仍是查詢4，但不加造第二個sale numerator，所以1/4＝25%。unique customers unavailable。message-derived28hse1、tracked-open enquiry1、unknown-origin2分開；click denominator未知，不顯示0%／100%。assignment1、真人回覆1、未回覆3；assignment/internal ack不是真人回覆。
- 新owned PostgreSQL17/full85 actual getSalesPerformance/listPerformanceRecords/options＋獨立raw SQL4 PASS。SQL fixtures另設tracked open1、unknown3；不是同一browser/SQL聯合旅程。production4及明細IDs1/2/3/4、duplicate lead不複製成交numerator、真human-response trigger、assignment未回覆、sale10m與rent18k、公司成交2、60/40信用份額及known commission100k/sample1；manager分行1/4、外分行403與agent403。是既有SQL guard獨立讀回，無本次SQL產品修復，trusted actor port不等於真Auth。
- latest fixture SHA analytics Node65+Bun3、typecheck/lint exit0；產品SHA no-link99+Bun9、shared actual-route115及build exit0。runtime tree相同；各raw evidence均列實際SHA，不把static fake Auth當登入驗收或將115另當new48。390 screenshot已目視，table只在卡片內捲動；四尺寸overflow assertion和images保留。focused self review；舊independent review不涵蓋本slice。

## 動作、歷史與限制

ACT55/56/57 LOCAL_PARTIAL。ACT56只有drilldown，品質修正Button未驗；15 source控制項是實際Input/select/tab/Button，重疊business action，不另當15個business actions。MetricCard只有已操作的查詢／首回覆中位數variants；caller component、未點quality Buttons／backlog tab／其他control不升格。

兩份CSV保留原29 PASS／9 FAIL／22 BLOCKED、22 planned NEW、82 cases、execution40 PASS／28 PARTIAL／14 BLOCKED；1400 IDs及408歷史render observations不改。NEW17仍PARTIAL，TEST46仍BLOCKED。真Auth/expiry/deep-link/full roles/flag／combinedSQL browser、quality edit/canary、Property.hk full detail/media與正式排程仍未完成。沒有新增native run，baseline1/3、repair production0/3不變。

## Dry-run及rollback

runtime config／migration／provider差異0；CI只加owned性能browser48和SQL4 scripts。full85 migrations只在新owned PG17 dry-run。保留普通portal零EPWA、parser/receipt/CAS/drafts/批量links/Inbox picker/分段sync、source/account/branch/ad/offer/canonical及人工protected edits／歷史outbound intents。未merge／正式deploy/config/migration／真send／paid model。

local performance身份隔離／filter→drilldown→CSV READY；正式Auth／flag／combined旅程BLOCKED，full role/action與native三次NOT_READY。Rollback回compatible app仍保留events/quality revisions／交易credit history，不補造click或response。回退介面前先限制受影響報表讀取，避免重新顯示舊scope數字；重新讀回目前權限範圍後才恢復匯出。
