# EP-16 批量連結最終草稿恢復及獨立讀回

## 審閱後最終讀回 `653695a0226b856876c9fb4d5dbd58613de79f39`

初次051119d44/7及ea97d6956/7是中間證據。fresh-context whole-branch審閱找到四個P2，均先RED再修：deferred5儲存存在卻無UI入口；failed row回復preview前舊placement；同actor跨tab globalpointer把原batch綁到別份draft；optional lineage升級write quota把valid unknown journal刪除。review RED兩個＋cross-tab current/legacy兩個（同一缺陷）＋quota一個，並非五個獨立P2。原三個產品缺陷另計。

新增同actor validated nonempty草稿入口，freshpreview及核對後才提交；cleanup以最新result.rows覆寫同rowKey未完成資料並留deferred；LinkBatchProgress新增optional draftId，每個preview路徑記原draft，reload及cleanup用原lineage，globalpointer不蓋sessionbatch。舊progress只在唯一sameactor validated draft包涵全部rowKeys才推定；missing/ambiguous不猜，不清其他草稿。valid恢復先還原，optional lookup/write失敗不刪journal；corrupt/read-unavailable保留raw並阻止新preview/create。pointer只在仍指向原draft時清除。

最終60browser PASS/0FAIL/SKIP，四尺寸各15；原5實際在第二50完成/reload後開啟→核對→freshpreview→commit5；formula-like Chinese最新failed edit存留、reload點known-failed repair→freshpreview→commit50；兩tab控制實際sharedlocalstorage改pointer，新舊progress原receipt清A50且B5逐JSON未變／zero secondcommit；quota保留原serialized unknown batch/chunk IDs，原read操作及no-new-batch gate。是synthetic Auth/API browser，非真Auth/SQL聯合旅程。final同SHA actual full85 SQL7、properties29+Bun28、typecheck/lint/build PASS，enquiries103在初次051同server tree保留，CI會另按發布head全驗。最新四尺寸screens/overflow有實際SHA/hash；初次同名screens已由final run取代，只保留初次raw logs/summary。legacy ambiguity／invalid actor/version/schema unit guards保留。獨立審閱 final653695a：四P2全resolved，reviewed scope無open concrete P1/P2；實際functions RAM檢查/diff check，沒有獨立重跑browser/SQL或驗正式Auth/provider/production。

ACT59-62及18重疊source controls仍LOCAL_PARTIAL；0434 known-failed repair現在真的操作，舊21-control證據保留自己的051 SHA。新draft chooser為新增控制，不捏造original actionID。copy-all／normal multichunk continuation未操作。两CSV原29/9/22、22plannedNEW、execution40/28/14及82/1400/408不改。最終local draft recovery/latest edits/provenance/quota read gate/safeCSV READY；trueAuth/expiry/fullroles/flags/combinedUI-SQL/provider及完整動作BLOCKED或NOT_READY。native新0，baseline1/3／repair正式0/3。

runtime config/schema/migration/provider差異0，只有owned CI scripts/full85本地dry-run；沒有正式mutation/send/model費用。Rollback先停bulkcreate，按原batch/chunk/draft lineage讀回，保留unknown raw journals／deferred／latest人工edits、歷史links/receipts/outbound intents；舊app會失去chooser/lineage且可能丟journal，故未知結果未reconcile前不可恢復新批次。


## 初次051119d歷史讀回

# EP-16 批量連結草稿恢復及獨立讀回

產品／測試提交 `051119d33af62d11165443e04943aa525ba89869`，原讀回基線 `b91319503aa691b3480996eadf90e21db31c84ab`；最新main仍51cb0e9。產品只改兩個existing components：recover讀回原receipt後沿用terminal成功清理，保留未完成／失敗／deferred rows；開始新批次清除import/repair/preview/subset state並分配新draft UUID，避免舊成功50 rows復原或覆寫保留5；長CSV欄名換行，390px頁面不再撐到520px。原batch/chunk identity、read-before-retry、server來源/版本/CAS規則保留。沒有新DTO/schema/migration/runtime/provider ID／正式flag/config。

## RED及失敗歷史

有效產品RED兩個1280 cases：完成50後開始新批次/reload復原舊50；commit lost response且首次read unavailable，reload/read到已提交50後draft仍50而非空。layout在已有draft修復的working tree另得40PASS/4FAIL，均是390px長欄名同一overflow；獨立幾何量度390→520後換行修正。共三個缺陷，後者沒有虛構commit SHA，保留當時兩產品file hash及原screens。初次量度查不存在main未得元素，corrected根元素CODE證明width461.84375/right507.84375。

測試接駁失敗均保留hash而不當產品RED/PASS：flag false導致無textarea；fake lookup回重複alias；formula-like字串錯放CSV輸入的中止run；nested select label locator9PASS/2FAIL；SQL fixture錯假設generated code0/1、非法withdrawn enum4/2（按真schema改offline）、新增test block錯放fetch callback0/1。修正test後必要斷言保留。原campaign、wizard14、50-row minimal fixture40created/7reused/1blocked/2failed仍是歷史分層，沒有替換成新actual SQL數字。

## 分層驗證

- exact SHA四viewport1440/1280/768/390各11＝44PASS、0FAIL/SKIP。actual links route/wizard/import/parser/client/results/AdminShell/staff store/CSS，synthetic Auth/API，GET/HEAD owned loopback。50sale/rent/Chinese/front-zero精確staff aliases；preview後pending防doubleclick；unknown empty read無新commit／CSV／新批次；lost response原receipt恢復45保留literal最後5，新50 UUID不覆寫5（共55）；foreign actor無舊draft恢復；duplicate/invalid/denied import零preview；flagoff零lookup/commit。手改首行other/formula-like Chinese placement，browser成功CSV website24/28hse25/other1，逐IDs／source／quote／formula核對；atomic rejection失敗CSV50。沒有操作copy-all、known-failed repair及正常multichunk continue；links table API回空，不能宣稱完整列表讀回。
- independent owned PG17/full85實際SQL7PASS、0FAIL/SKIP（parent＋6subtests）。preview零writes；50sale25/rent25 commit50 links/versions/one operation，replay原receipt；新batch reused50；owner404、agent／forged role403；preview後一offer offline全chunk拒絕1blocked49failed／failureCSV50且原50 links歷史不變；duplicate placement拒絕、mapping revision409／eligibility false；manual other中文formula-like placement另存1筆／CSV安全。獨立raw SQL、batch original read、outbound intents0/conversations0/fetch0。trusted actor port不是真JWT；browser與SQL各自fixtures，不稱同一Auth+DB旅程。
- exact SHA properties Node29＋Bun27、enquiries Node103、typecheck/build exit0、lint exit0（3既有warnings）；shared115在precommit working tree另記，並非新44或exact committed-SHA。本次build與typecheck分開；CI增加两個named owned scripts；zero provider/production/send/model effects。44screens有overflow assertions，390修正圖已目視。

## 歷史、動作及限制

兩CSV保留原29PASS/9FAIL/22BLOCKED及22 planned NEW；execution40PASS/28PARTIAL/14BLOCKED、82 cases不改，NEW16仍PARTIAL；TEST39/40既有證據追加而不刪。ACT59/60/61/62及17重疊source controls LOCAL_PARTIAL；continue只有unknown guard，不宣稱normal multichunk Button PASS；copy-all0388及repair0434不升格，failureCSV未捏造original ID。1400原IDs與408歷史render observations保留。source controls不是新增business actions。

local50 import/subset/durable draft recovery/safe success+failure CSV READY。true Auth/expiry/deep-link/full roles/正式flags/combined UI-SQL/完整action、copy-all／repair／multichunk acceptance BLOCKED或NOT_READY。native baseline1/3、修復production0/3、新native0；Property.hk逐EPS/EPT/EPW+dt full detail/media仍待驗收，132歷史候選維持held。正式provider/canary/model預算仍gated。fresh-context whole-branch independent review另記，不以舊review代替本slice。

## Dry-run及rollback

runtime config／migration／provider差異0；full85只在fresh owned PG17 dry-run。未merge／正式部署/config/migration／真send／paid model。保留普通portal零EPWA、parser/receipts/CAS/drafts/批量links/Inbox picker/分段sync、來源/account/branch/ad/offer/canonical、protected edits、歷史receipt/outbound intents。

Rollback舊介面會重新保留成功rows；先暫停受影響bulk create並讀回原receipt，僅清除已confirmed成功draft refs，保留unknown／failed／deferred drafts、原batch/chunk/links/version及歷史outbound identities；未reconcile unknown前不開新batch。沒有migration rollback或刪歷史。詳見根release報告。
