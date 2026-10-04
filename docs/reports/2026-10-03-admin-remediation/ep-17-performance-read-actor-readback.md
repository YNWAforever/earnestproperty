# EP-17/20 績效讀取的當前權限

基線 `e80a30f93c7fbf217c751c9e090d3733383f8665`；修正 `2f74b31b43d81f32305cea68836ece5c9ae067e5`。報表、明細及篩選項目於讀取前核對目前 active 帳戶、Auth binding、admin/manager grant 和分行，輸出前以 fresh SQL snapshot 再驗同一範圍。降為manager的cached admin只讀本分行，canCorrect=false；current admin不能擴大cached manager，升權須重新取得可信actor。前後scope或canCorrect變更回403，最終權限檢查在cursor400 catch之外。只改既有server helper及ownedSQL tests；無新增DTO/schema/migration/UI/provider/runtime ID，品質與qualification writers不變。兩個point-in-time checks不是全面交易/phantom/ABA序列化保證。

真owned PostgreSQL17完整85 migrations：原27測試PASS；新15個直接缺陷RED，共43 tests 27PASS16FAIL(含parent)，0SKIP。9個停用/撤權/Auth重綁的3種讀取、3個cached admin降權讀回、3個admission後DB變動(role撤銷/report、Auth重綁/records、分行移動/options)。真GREEN43及exact committed43 PASS0FAIL0SKIP；provider/network guard0。以獨立raw SQL比對當前本分行inquiry IDs/counts，排除外分行sentinel；完整 inquiry quality revisions/event quality revisions/performance events/crm lead qualifications arrays前後相同。新增synthetic actor staff IDs只在owned DB，不是provider/runtime IDs。原3個positive trusted manager fixtures補真manager grants，沒有放寬production guard。

第一次修正腳本於列印RED符號時遇cp950 encoding error，在source修改前失敗；其後誤名green.log其實再次27PASS16FAIL，保留並明確非GREEN。修正輸出encoding後green-retry.log才43PASS；不是覆蓋失敗證據。Build只造成routeTree stat/newline dirt，前置status乾淨、diff/numstat皆空，已還原這次生成輸出，未stage或語意修改generated路由；原bun.lockb保留。

analytics65+Bun3/no-link99+Bun9 PASS；typecheck/lint/build各exit0，lint3baselinewarnings。這批無UI變更、新local browser run或按鈕promotion；前批128四viewport為歷史分層證據，latest exacthead remote browser須另讀回。真Auth/session/UI+SQL/provider/production未驗。原60 baseline29PASS9FAIL22BLOCKED、22plannedNEW/82cases及execution40PASS28PARTIAL14BLOCKED保持；CSV execution只追加EP17和NEW17/TEST44/45/46，NEW17 PARTIAL、TEST46 BLOCKED。原1400action IDs(68business+1332source)、408歷史render observations保持，source occurrence不是已驗button，skip仍blocked；原AIprobePASS代表缺陷存在。

Fresh-context Astra一次whole-branch review：詳 execution-evidence review 及rawresult；全2focused files、累積分支抽樣，非所有檔案逐行。每個declined behavior由author另裁決，下面逐項保留理由及錯判成本。reviewed/final SHA分開；無第二review。配置/package/workflow/schema diff0，85 migrations僅owned dry-run；正式anonymous首頁/admin200只證availability，非deployedSHA/worker/Auth/schema驗收。

28Hse120/20/45/10及04:17HKT保留；baseline1/3，repairproduction0/3，新collection0，manual/replay/watchdog/skip不是nativeDaily。Property.hk EPS/EPT/EPW+approveddt须page1→terminal+真detail/media；403/漏頁/partial/index-only不可判absence，132候選held。普通portal零EPWA、parser/receipt/CAS/drafts/batchlinks/Inboxpicker、source/account/branch/ad/offer/canonical身份、protected人工edit、immutable receipt/outbound/run/provenance保留。

Rollback先限制performance報表/明細/options入口，再compatible server revert。保留全部immutable history與source，勿restore wholeDB、刪receipt或將unknown標production；本批沒有新migration或不確定write重試。无merge、productiondeploy/config/migration、真send/provider/付費applicationmodel。

Owned當前績效讀取權限 **READY**；hardreload/sessionrestart、unknownquality、全roles/actions及修正版本3次native **NOT_READY**；trueAuth/combinedUI+PG/provider/正式環境 **BLOCKED**。

## 審閱未裁決行為的author裁決

- RealAuth/sessionexpiry/revocation BLOCKED — boundary read and trustedactors/stubs notactualsessions — costifwrong: access falsely authorized.
- CombinedUI/Auth/PG/provider BLOCKED — separateacceptance layers — costifwrong: invented end-to-end proof.
- Allroles/branches/routes/flags/sourcecontrols NOT_READY — sampled cumulative200files — costifwrong: untested crossscope/control regressions.
- Revocation after finalstatement/delivery NOT_READY — accepted point-in-time contract only, no continuous transport guarantee — costifwrong: overstated revocation timing.
- Grantlocks/phantom/ABA NOT_READY —3controlled DBchanges andstubbedprobes notexhaustive — costifwrong: hidden concurrencywindow.
- Concurrentowner/source snapshot NOT_READY — separatequeries andactor-only finalgate — costifwrong: mixed businesssnapshot or changed source ownership.
- Concurrenteventoccurrence/sourcetime NOT_READY — noHKday serializationacceptance — costifwrong: misstated cohortdate.
- Hardreload/sessionrestart NOT_READY — qualificationjournal memory-only — costifwrong: originaluncertainrequest lost.
- Unknownqualityrevision NOT_READY — independent unresolved retryreconciliation — costifwrong: duplicate immutable revision.
- Realprovider/templates/members/transport/model BLOCKED — noauthorization/calls — costifwrong: wrongsend/spend/retry.
- Productionapp/worker/schema/config/migration/canary/rollback BLOCKED — source rollback documented, noformalexecution/deployreadback — costifwrong: production mutation or unsafe recovery.
- Three repairednativeDaily NOT_READY —baseline1/3 repair0/3 newcollection0;manual/replay/watchdog/skip excluded — costifwrong: fabricated scheduleacceptance.
- Propertyhk/132held BLOCKED —terminal/detail/media/EPS/EPT/EPW/dt absenceproof unavailable — costifwrong: falsewithdrawal.
- Nativeclipboard/IME/platform BLOCKED — no nativeacceptance — costifwrong: hidden deviceinputfailure.
- Productionlatency/lockcontention/throughput NOT_READY — fixtures andsource notloadacceptance — costifwrong: operational regression.
- Exhaustivehistory/inventory —author independentlyverifies163priorrawhashes/oldJSONdeepidentity/61oldtrackedreports/1400IDs/408renderhistory, reviewer did not — costifwrong: falsely attributing fullpreservationPASS to reviewer.
- Earlierduplicate/Docker rootcauses UNPROVEN —retained failure andlaterPASS notdiagnosis — costifwrong: hidden intermittentfailure.
- LatestremoteCI pending independentauthorreadback; no newlocalbrowser inthisslice —prior128 and149/444 historical only — costifwrong: treating forecast as currentPASS.
- FormalHTTP200 availabilityonly;Auth/function/releasereadiness BLOCKED —anonymousGET no deploymentproof — costifwrong: falseproductionreadiness.
