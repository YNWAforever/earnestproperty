# EP-17 線索核實的遺失回應復原

基線 `9d800d954639c4c4c841ff2d2b6be800bf4b6553`；修正 `4c1141a7d140ef095b24a08cece6489f181419b3`。沿用既有 leadId/qualifiedAt/evidence 和 immutable lead_qualified source identity；沒有新DTO、operation/provider/runtime ID或migration。相同原actor、原時間和trimmed依據可讀回既有eventKey，不建立第二筆qualification/event。原insert statement遇conflict後，用fresh snapshot重新驗當前active、authbinding、admin/manager grant、source owner及branch；不同actor/time/evidence仍409，撤銷權限403。已接受後stage改變只允許原紀錄的授權讀回，並不新建不合資格的核實。原source/projection完整arrays保持。

真owned PostgreSQL17 full85 migrations：RED24 PASS/4 FAIL含parent，3個direct缺陷為相同請求併發、已commit回應遺失、commit後stage改變；原different evidence/time/actor及revoked authority防線保持。GREEN28 PASS與initial committed3dd989f/final authorfix source各28 PASS，0FAIL/SKIP。受控transport loss在真SQL commit完成後注入，replay/denial後由獨立raw SQL核对原actor/time/evidence/source/event，併發兩個相同請求回傳同key、僅一source。

Actual React analytics route/Table/dashboard/shell/staffstore在owned loopback：1280原3新cases全部RED→3GREEN；四viewport390/768/1280/1440共128 PASS（final committed source再驗128）（每尺寸32，新增5），0FAIL/SKIP及page overflow0。原請求保存在actor-keyed workspace，跨filter/table remount和連續回應遺失仍沿用原時間/依據；已修改依據先local拒絕且保留新draft，無第二mutation。第一次128GREEN rawlog完整保留；共享afterAll summary被其後4focused run取代，未作immutablehash；final committed128再跑產生獨立exactSHA完整summary。保存的原依據於當前actor/lead editor可見，透過原核實輸入欄可明確還原，不需憑記憶重打；首次typed400/403/409明確拒絕釋放新journal，但有較早unknown outcome的retry拒絕仍保留原journal；成功ack才清除。既有shared editor serialization、新draft保留、actor isolation、quality report/CSV/未知分母回歸保持。UIport為synthetic Auth/API，不是combined trueAuth/SQL/provider；test-only adapter模擬真backend另測的嚴格replay語意。原button操作不等於所有source control已驗收；無新control promotion。硬reload/sessionrestart會丟失本機journal，unknown quality revision outcome未修復，local recovery仍NOT_READY、外部trueAuth/provider BLOCKED。

analytics65+Bun3/no-link99+Bun9 PASS；typecheck/lint/build各exit0，lint3baselinewarnings。配置/schema/package/workflow diff0；85migration僅owned dry-run。原60 baseline29PASS/9FAIL/22BLOCKED、22plannedNEW/82cases及execution40PASS/28PARTIAL/14BLOCKED保持；CSV只追加EP17和NEW17/TEST44/45/46 execution，NEW17仍PARTIAL、TEST46仍BLOCKED。所有prior JSON keys、old tracked reports/action mappings1400 IDs/408render observations與選定prior raw hashes保留。原AIprobes PASS=原缺陷仍在，非repair驗收。

Fresh-context Astra只一次read-only whole-branch review：Critical0/Important2/Minor0，兩個Important為hidden原依據與首次明確拒絕pinning。Reviewer全6focused files/累積199files抽樣；獨立2ownedbrowser probes+whitespace，沒有SQL rerun。單次authorfix4focusedRED→4GREEN，全128GREEN，原依據從visible DOM還原、首次明確拒絕可改依據/時間、較早unknown後的403仍保存原source/新draft。兩項已由author必要測試修正，沒有第二review；reviewedSHA3dd989f與finalfixSHA分開。全部15declined/costs在ledger及rawresult，非全站逐行/trueAuth驗收。Exact-head PR219 CI counts獨立publication-readback，不能把預計149SQL/444browser當既成結果。首頁/admin anonymous GET只證availability，非deployedSHA/schema/worker驗收。

28Hse120/20/45/10及04:17HKT保留：baseline1/3，repairproduction0/3，新collection0；manual/replay/watchdog/skip不算nativeDaily。Property.hk EPS/EPT/EPW+approveddt須page1→terminal+真detail/media；403/partial/index-only非撤盤證據，132held。普通portal零EPWA、parser/receipt/CAS/草稿隔離/batchlinks/Inboxpicker、source/account/branch/ad/offer/canonical、人工protected edits及immutable receipt/outbound/run/provenance保持。

Rollback先限制qualification入口，再compatible server/UI revert；核對並保留原actor/time/evidence/source/projection，勿delete qualification/history、restore wholeDB、把unknown標production或無原紀錄讀回便重送。無merge、productiondeploy/config/migration、真send/providerrequest/paidapplicationmodel。

owned exact qualification replay及當前actor工作區 **READY**；hardreload/sessionrestart、unknownquality **NOT_READY**；combinedtrueAuth/provider **BLOCKED**；全role/action及repaired三次native **NOT_READY**。

審閱declined範圍的逐項裁決（不是新PASS）：

- hardreload/sessionrestart NOT_READY：memory-only journal；錯判會丟失原請求。
- unknown committed quality revision NOT_READY：獨立未修行為；錯判會重複revision。
- realAuth/sessionexpiry/admission revocation BLOCKED：synthetic/trustedactors；錯判會錯授權。
- combinedUI/Auth/PG BLOCKED：分層未合併；錯判會虛構endtoend驗收。
- allrole/branch/route/flag/sourceoccurrence NOT_READY：抽樣；錯判會藏跨scope回歸。
- grant/sourcephantom interleavings NOT_READY：locks非完整concurrentinsert驗收；錯判會授權競態。
- eventoccurrence/sourcetime correction NOT_READY：未證serialization；錯判會HKday錯置。
- productionapp/worker/schema/config/migration/canary BLOCKED：無正式變更授權/部署讀回；錯判會真effects。
- Propertyhk terminal/detail/media/EPS/EPT/EPW/dt/132held BLOCKED：無absenceproof；錯判會錯撤盤。
- three repairednativeDaily NOT_READY：0/3 repair、1/3 baseline、新collection0；錯判會虛構排程。
- realprovider/templates/members/model/spend/transport BLOCKED：無realcalls/recipient/budget授權；錯判會錯發送/花費/重試。
- nativeclipboard/IME/platform BLOCKED：Chromium不足；錯判會藏nativeinput問題。
- productionscale NOT_READY：localfixtures/querysample不足；錯判會藏load失敗。
- exhaustiveartifact/inventory：author另驗117priorrawhashes、deeppriorJSON及trackedreports/actionIDs1400/render408；reviewer未independent全驗，不能當reviewPASS；錯判會誇大歷史完整性。
- earlier duplicate/Docker failure rootcause UNPROVEN：laterPASS非診斷；錯判會掩蓋間歇缺陷/環境失敗。
