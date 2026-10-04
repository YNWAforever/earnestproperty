# EP-17/20 已接受核實來源的讀回恢復

基線 `1a998f5ca4d6550a91a534d1144092cd33e929c5`；修復 `2d1c3a390703b4ac267a09df8f534897c1d1bbf7`。既有 GET listPerformanceRecords 在選出本頁(最多50)後，從本人 immutable crm_lead_qualifications/base performance_events 核對 canonical key/type/lead/source/qualified timestamp，加入既有 PerformanceRecord 可選 qualification。當前 active/Auth binding/admin-manager grant、inquiry+lead owner分行再次核對；作者與 assigned colleague各有身份。Global admin有效未指派來源可讀，cachedadmin降manager只本分行。inquiry→lead drift不誤接來源，final actor scope403在cursor400catch外。無新API/DTOtype/schema/migration/provider/runtimeID，只引用現有欄位及身份。

真reload/freshbrowsercontext顯示已接受原evidence/原香港核實時間；read-only/disabled提交，handler也guard；fresh matching source才清原pendingjournal，newer人工draft保持原樣。沒有新write或unknown→production自動分類。CSV不輸出qualification evidence。尚未落庫intent/unknownquality revision outcome/真Auth整合仍待驗。

必要RED53SQL48PASS5FAIL(4direct+parent)；unassigned擴至54SQL48PASS6FAIL(5direct+parent)，都是absentmetadata。Browser3RED實際reload/freshcontext/newerdraft，failedworkersummary只保留最後1case，rawlog才完整3。GREEN及exact committed54PASS0FAIL/SKIP，ownedPG17 full85 migrations/network0；raw SQL完整 qualifications/baseevents/occurrencerevisions/inquiryquality/eventquality history arrays前後相同。11新leaf含author≠owner、adminunassigned降權、同分行他作者、當前lead外分行、inq→lead drift、malformedprojection、受控inflightowner/actor撤權。Statement-time checks非全面concurrency/phantom/ABA/transport保證。

完整及exact committed browser144PASS0FAIL/SKIP；1440/1280/768/390每個36，新增16cases。真route/table/shell＋syntheticAuth/API/backendfacts與SQL獨立。12新名screens及exact144summary有hash，舊summary/screens保留。Precommit summary codeSha只當時HEAD，dirtysource以exactcommit重新證明。Analytics65+Bun3/no-link99+Bun9/typecheck/lint/build各PASS/exit0；3baseline lintwarnings。錯用不存在no-link script保留error後改既有test:no-link；cp950/marker writer失敗都在寫入前，final命名repeat53RED保留；首個evidence writer nestedquotes SyntaxError寫入前失敗。Build產生routeTree stat/newline dirt，normalized bytes equality後只restore生成輸出，unrelatedbun.lockb未stage。

Config/package/workflow/schema diff0；85現有migrations僅owneddryrun，無production套用。Formalanonymous首頁/admin200只availability，無deployedSHA/Auth/worker/schema/function證明。新native37160712576/main51 workflow success/public_verified已讀metadata/rawlog，未讀privatefullreceipt，不提升acceptedbaseline1/3，repair0/3；agentcollectiontrigger0。保留28Hse120/20/45/10及04:17HKT；manual/replay/watchdog/skip非nativeDaily。Propertyhk逐EPS/EPT/EPW+approveddt/page1terminal+真detailmedia，403/partial/index-only非absence，132held。

原29PASS9FAIL22BLOCKED、22plannedNEW/82cases、execution40PASS28PARTIAL14BLOCKED保持。CSV只追加EP17、NEW17/TEST44/45/46execution SHA/environment/evidence，NEW17仍PARTIAL/TEST46BLOCKED。1400IDs(68business1332source)、408renderhistory、portalzeroEPWA/parser/receipt/CAS/drafts/batchlinks/Inbox/segmented sync、source/account/branch/ad/offer/canonical身份、protected人工edit、receipt/outbound/run/provenance保留。178 priorselectedrawhashes/62oldtrackedreports另以independentverifier核對。原AIprobePASS=缺陷存在。

一次fresh-context Astrawholebranch review，actualcoverage與declinedauthorrulings見下面及JSON，非202檔exhaustive。Critical/Important如需一authorfixpass另RED→GREEN，無第二review。No merge/deploy/productionconfig/migration/real send/provider/paidapplicationmodel。

Rollback先限制report/records/qualification入口，再compatible source revert；保留immutable qualification/event/quality/receipt/outbound/run/provenance及protectededits，勿restorewholeDB/改unknownproduction/盲目換ID重送。舊consumer可忽略optional欄位。

Owned已提交來源reload/newcontext讀回 **READY**；durableuncommittedintent/unknownquality/allroles/fullconcurrency/修復3次native **NOT_READY**；真Auth/UI+PG/provider/productionmigration部署restore **BLOCKED**。

## 本批裁決與錯判成本

- 沿用 GET records 及既有 PerformanceRecord 可選欄位，只讀當前可見 inquiry 的本人 immutable qualification/canonical event；不新增 API/DTO type/migration/provider ID。錯判成本：洩露他人核實依據。
- 核實作者與 assigned event colleague 分別核對，不要求兩者相等；global admin 有效未指派來源可讀，降權manager需雙owner本分行。錯判成本：拒絕有效來源或錯誤擴權。
- 已提交來源在真reload/newcontext讀回；未落庫/未提交intent仍不宣稱durable，production無browser storage journal。錯判成本：丟失未確認請求或誤報完成。
- 已接受來源read-only/阻止再次提交；fresh matching source才清原journal；manual newer draft不替換且仍可見。錯判成本：草稿流失或重複/錯誤寫入。
- Fixture sessionStorage只模擬synthetic backend facts，SQL/browser/syntheticAuth獨立分層。錯判成本：合成驗證冒充真Auth/UI+PG。
- Statement-time source/current pre-output actor gate沒有完整business snapshot/phantom/ABA/transport持續撤權保證。錯判成本：漏掉未驗競態。
- 新natural schedule37160712576/main51 success/public_verified只workflow層，未讀private完整receipt，不提升baseline1/3或repair0/3；agenttrigger0。錯判成本：虛報排程資料驗收。

## 審閱未裁決項目的author裁決

- Durable uncommitted qualification intent NOT_READY — memory-only journal;accepted-source read cannot prove pending intent survived reload — costifwrong: lost uncertain request.
- Unknown-outcome quality revision recovery NOT_READY — separate retry/reconciliation outside this continuation — costifwrong: duplicate immutable quality revision.
- Other-author qualification audit browsing NOT_READY — own-author recovery intentionally withholds others evidence — costifwrong: overstated audit browsing or privacy leak.
- All cohort/filter/backlog/pagination combinations NOT_READY — bounded page logic inspected;combinations not exhausted — costifwrong: hidden missing readback.
- Real Auth/session admission/expiry/revocation BLOCKED — trustedSQLactors/synthetic identity not real sessions — costifwrong: false authorization.
- Combined realAuth/UI/PG/provider journey BLOCKED — independent acceptance layers only — costifwrong: invented end-to-end proof.
- Every role/branch/route/flag/action NOT_READY — 202cumulative files sampled,notexhaustive — costifwrong: crossscope or untestedcontrol regression.
- Revocation after finalstatement/transport NOT_READY — point-in-time gate only — costifwrong: overstated continuous authorization.
- Grant-lock/phantom/ABA interleavings NOT_READY — controlledcases/sourceinspection not exhaustive — costifwrong: hidden concurrencywindow.
- Owner/source after metadata statement NOT_READY — finalgate actor-only,notcontinuous source/singlebusinesssnapshot — costifwrong: evidence from changed source ownership.
- Occurrence corrections/HKday serialization NOT_READY — outside demonstrated concurrency acceptance — costifwrong: misstated cohort/time.
- Production latency/lockcontention/throughput NOT_READY — no load or productionquerymeasurement — costifwrong: operational regression.
- Production app/worker/schema/flag alignment BLOCKED — no deploy/liveauthenticated verification — costifwrong: wrong formal environment.
- Production migration/canary/rollback execution BLOCKED — unauthorized external mutation;source rollback only — costifwrong: unsafe release or restore.
- Real provider receipts/templates/members/transport/sends BLOCKED — no providerexercise — costifwrong: wrong send or retry.
- Paid model behavior/usage/budget BLOCKED — no paidapplicationmodelcalls — costifwrong: wrong spend or unvalidated result.
- Propertyhk completeness/132held BLOCKED — noEPS/EPT/EPW/dt terminal/detailmedia absenceproof — costifwrong: false withdrawal.
- Three repaired nativeDaily NOT_READY — acceptedbaseline1/3repair0/3agenttrigger0;newnaturalworkflow receipt unread — costifwrong: fabricated schedule acceptance.
- Native clipboard/IME/platform inputs BLOCKED — syntheticChromium not nativeplatform — costifwrong: hidden deviceinputfailure.
- Exhaustive history/1400IDs/408render mappings author independent verification — reviewer did not hash archive;root verifies prior178hashes/62oldreports/deepoldJSON/mappings beforedelivery — costifwrong: misattributed preservation proof.
- Earlier duplicate/Docker root causes UNPROVEN — laterPASS does notdiagnose retainedhistory — costifwrong: hidden intermittentfailure.
- CurrentremoteCI/publication sync author independent readback pending — local review only;root willread exactremotehead/allCIoutputs — costifwrong: forecast treated asPASS.
- Formal readiness fromanonymousHTTP200 BLOCKED — availabilityonly,nodeployedSHA/Auth/functionproof — costifwrong: falseproduction readiness.
- Unsampled cumulative CAS/parser/receipt/portalzeroEPWA/Inbox/outbound NOT_READY — risk-based sample;no freshfullacceptance rerun — costifwrong: untested cumulative regression.
