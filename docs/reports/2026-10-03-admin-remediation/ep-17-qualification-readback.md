# EP-17 線索核實、來源與品質讀回

線索核實修正 `af2bd3599605c6e48acf16b3fdbd2b9b1e640809`；累積分支審閱修正 `94dc4799fb8c1c81a36c4d0680a76ac7ad41e760`；本批基線 `a45ed6d8e4b3eb8771d56c76f2e34e3c298ef439`。正式 main仍 `51cb0e9c08269ebabeb0b593d4dea611b9246c32`。核實寫入現在重新核對當前 active actor、auth account binding、目前角色、來源階段、擁有者及分行；cached admin降為manager後不能單憑舊global權限跨分行寫入。精確 UUID驗證會拒絕非法尾碼400。重複／不合資格／範圍外仍409，失效身份403，沒有虛構成功。

## 有效 RED 與分層 GREEN

- 原a45 runtime加新測試：7 PASS／9 FAIL（含parent），8個有效leaf RED：manager/admin各 inactive、role revoked、account rebound；cached admin downgrade跨分行；非法UUID未正確拒絕。修正後owned PostgreSQL17、all85 actual migrations及實際 qualify/report/quality handlers＋獨立raw SQL16 PASS／0 FAIL/SKIP；af2提交後另一次16 PASS。這四個qualification產品／測試檔在final94與af2完全相同，保留原SHA歸屬。
- 同時核實同一lead只產生一個immutable qualification及lead_qualified event；原 qualified_by／時間／trimmed證據及source key保留。初始品質unknown，經明確production品質修正才計入qualified KPI。核實發生於下一個香港日仍沿同一inquiry cohort，分母4與record/CSV身份一致；assignment1、真人回覆median15分鐘、未回覆3均不受核實影響。CRM lead原事實及append-only歷史保留；DELETE拒絕。trusted actor/direct SQL並非真登入。
- final94 actual analytics route/dashboard/table/AdminShell/staff store/CSS＋synthetic Auth/API，owned loopback四尺寸390/768/1280/1440各27＝108 PASS／0 FAIL/SKIP。原84品質／scope cases保留，加24 qualification cases：trim驗證、unknown→明確品質審核→qualified明細／CSV／reload、duplicate保留原證據、pending qualification保留另一行較新quality草稿且序列化提交、目前rent scope晚到讀回、write前明確拒絕後顯式retry、actor轉換不讀舊workspace。不是unknown committed qualification-outcome recovery，亦不是combined real UI/SQL/Auth。
- final94 analytics Node65+Bun3、no-link Node99+Bun9、content Node77+Bun34、shared synthetic browser115 PASS；115與108分開。typecheck、lint、build分開exit0；lint3個baseline warnings。四尺寸overflow斷言及新命名screenshots hash保留；390已目視。af2 pre-review108及prior84 summary保留，沒有覆寫舊品質圖片。

## 最終本機 DB 啟動失敗

final94的qualification DB重跑兩次各0 PASS／1 FAIL，content/CRM DB一次0 PASS／2 FAIL，均於Docker run的spawnSync ETIMEDOUT、migration／案例尚未開始。原因UNPROVEN。Docker metadata唯讀可回覆Linux29.7.2及109個running containers；這只是觀察，不能判定原因或擅自停止其他容器。本輪沒有改helper timeout或放寬測試。原有效16及precommit finalfix snapshot37 GREEN保留；final committed完整owned DB驗證由PR exact-head CI獨立補齊，結果另記PR body及publication-readback，不能把本機setup失敗當PASS或產品RED。最終knowledge本機重跑仍受此環境限制。

## 獨立審閱與裁決

Fresh-context Astra read-only whole-branch review於af2，inspected Critical0／Important1／Minor0；193個累積changed files為抽樣路徑覆核，並非逐行完整審核。qualification沒有另一項confirmed defect。Important是內容建議的引用FAQ可在revision檢查後、proposal寫入前改變，仍被接受為applied；實際owned full85獨立重現。一次TDD修正94：request/save/apply三個leaf RED→37 GREEN，詳見[EP-04引用來源報告](ep-04-cited-source-transition-readback.md)。沒有第二 reviewer。Reviewer另獨立analytics unit13 PASS，沒有重跑full browser/DB/build/Auth；第一次private DB setup終止causeUNPROVEN，之後content_hash漏填fixture錯誤已更正才有效重現，不能算產品RED。

裁決保留所有declined範圍：real Auth/session、unknown committed qualification／quality寫入結果、production app/worker/schema/native scheduling、Property.hk完整access及132held、paid model/provider delivery、production-scale performance及every role/action。相應BLOCKED／NOT_READY；誤判代價為錯權限、重複不明寫入、錯撤盤、虛構delivery／budget或全動作／排程批准。支持來源的鎖已實作，受控交錯驗收具體是FAQ三階段；不聲稱所有phantom／worker／production併發變體。Minor none。

## 動作、歷史、config與rollback

ACT55/56/57＋24 overlapping source controls＝27記錄，仍LOCAL_PARTIAL。從原main/catalog確認再實際操作0199未知跟進Button、0212 qualification summary、0213 form、0214 Input、0215 submit Button；0213是form，0212已有原summary ID，沒有捏造select／Label ID。其他variants／close/load-more未升格。1400 IDs／baseline欄位及408歷史render observations不改；舊action/report/JSON keys保留。

CSV只追加EP17、NEW17／TEST44／45／46和EP04／NEW04的execution結果／SHA／環境／證據；原60的29 PASS／9 FAIL／22 BLOCKED、22 planned NEW、82 cases、execution40 PASS／28 PARTIAL／14 BLOCKED不變。TEST46仍BLOCKED，NEW17及NEW04仍PARTIAL。原AI probes PASS表示缺陷仍在，不能當修好。新keys為performanceQualificationFollowup及contentCitationTransitionFollowup。

Config／DTO／runtime／provider IDs／schema／neon migration／package／workflow diff0；full85只在owned DB dry-run。普通portal零EPWA、parser／receipt／CAS／草稿隔離／batch links／Inbox picker／分段sync、source/account/branch/ad/offer/canonical、protected edits、歷史receipt及outbound intents保留。無merge、production deployment/config/migration、真send、provider request或paid model call。Rollback先限制qualification／受影響proposal入口，讀回原source、qualification、event、品質修訂與run/provenance，再回退相容server/UI；不delete immutable證據，不恢復整個DB，不把unknown補成production，也不在未核對不明結果前重試。

owned qualification／當前scope讀回 **READY**；final本機Docker重跑、trueAuth／provider／combined／unknown committed outcome **BLOCKED**；full角色／動作／修復版本native三次 **NOT_READY**。28Hse120/20/45/10、04:17HKT保留；baseline eligible1/3、repaired production0/3、agent-triggered0。watchdog37099627650不是Daily collection；latest daily37079390201。Property.hk逐EPS/EPT/EPW及approved dt須page1→terminal＋真detail/media；403／partial／index-only不代表撤盤，132候選held。formal首頁／admin匿名GET200只證明availability，沒有deployed SHA／schema／Auth acceptance。
