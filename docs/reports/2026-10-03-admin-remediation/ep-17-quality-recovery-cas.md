# EP-17/20 品質修正的未知結果恢復及來源快照 CAS

基線 `0a7fa46b3639a75e55e565ea2088c178c1910c25`；初始修復 `e5011fea657fd1cd385943df8395d5fb52845cf8`；最終修復 `174c83f1e77eea2ed99f1c02a3fd93a5ec15521c`。原品質修正POST遇response lost可重复追加immutable revision或蓋過其他admin的新決定。沿用既有revisionID/null作快照，kind/source/actor/base/quality/reason組成原請求身份，最早successor匹配才ACK；当前latest同author/payload/no-op；新的不同請求只在latestbase吻合追加。既有transactionRows先鎖來源再freshReadCommitted第二statement，等鎖後讀新快照。currentactive/Authbinding/admin grant反覆檢查并hold；異常snapshot400、不同來源或過時/不同請求409、missing404、currentrevoked403。

既有PerformanceRecord新增optionalqualityRevisionId，inquiry/event/deal/backlogquality與revision同一SELECT。兩個privatequalityPOST/client/writer requiredexpectedRevisionId:string|null；cachedclient須refresh，paired UI/serverrelease，不能fallbackblindwrite。沒有新API、DTOtype、schema、migration、provider/runtimeID。現有85migrations只在ownedPG17dryrun，最新version由現况config artifact讀得；沒有production套用。

Actor-keyed memoryjournal保留原snapshot/payload穿過unknownresponse及filterremount，原品質原因readonly提示；改payload時拒絕、newerdraft仍可見。真未提交intent/hardreloadjournal非durable。Qualification本人來源readback/其journal與其他author privacy不變；quality不autopromoteunknown；CSV explicitallowlist不輸出revision或private evidence。

獨立freshAstra Important發現：未接受的unknown original遇另一admin先勝出，409後journal死結。品質writer的409明確表示currentauthorized existing source沒有exactaccepted successor，故matchingjournal清除並freshrecordreadback，原manualdraft保留後讓人再次明確提交。403/400仍不能排除earliercommit，qualification409的不同語義不照搬。Review作者一輪修正：browserRED1；真SQL兩種source完整negative409->freshbaseexplicitdecision之rawhistory核對；無secondreview。

原RED74SQL55PASS19FAIL(18direct+parent)、4browserFAIL；pendingoriginalreason顯示另RED1。初GREEN74SQL/160browser及exacte50174/160皆0FAIL/SKIP。最終GREEN及exact `174c83f1e77eea2ed99f1c02a3fd93a5ec15521c` 76SQL/164browser0FAIL/SKIP，1440/1280/768/390每41；22新增SQLleaf及20新增viewportcases。actualPG17poolrowlockbarriers保證同base同payload一append兩ACK、不同payload一winner另一409。原acceptedreplay即使newerotheradminspam也不改history；changed/foreign/illegal/missing/otheractor/currentrevoked全驗。Browseractualroute/table/shell＋syntheticAuth/API/backendfacts與SQL分層，非trueAuth/UI+PG。

失敗歷史保留：SQL首GREEN72/2 assertion誤用responses inquiryrevision，改eventquality_test_events不改responses身份；browser首GREEN3/1 all值錯，正確emptystring；summarycopy路徑錯已改，原REDsummary只有lastfailedworker1，partialgreensummary只有lastworker1PASS，rawlog才完整。Analytics64/1是legacyPGlite partialreadschema缺existingeventrevisiontable，只補emptyprojectiontable。最終analytics65+Bun3/no-link99+Bun9，typecheck/lint/build各exit0，3baselinewarnings；首buildmanifestTSS_ROUTES_MANIFEST缺失FAIL，無source改動sequentialPASS，causeUNPROVEN。Own routeTree generatednewline/statdirty在normalizedbyteequalHEAD後restore，unrelatedbun未stage。

OnefreshAstrawholebranch review詳見JSON/result；reviewed初SHA、oneauthorfix後finalSHA分開，不冒稱最終SHA被二審。Actualinspected/rerun/probe及全部declined行為逐項author裁決如下。舊217 selectedrawhashes、63trackedreports、oldJSONdeepvalues及CSV originalhistory獨立核對；原29PASS9FAIL22BLOCKED、22plannedNEW/82cases、execution40PASS28PARTIAL14BLOCKED，NEW17仍PARTIAL/TEST46BLOCKED；1400IDs(68business1332source)與408renderhistory不當成validatedbuttons。Parser/receipt/CAS/drafts/batchlinks/Inbox/segmented sync、portalzeroEPWA、source/account/branch/ad/offer/canonical、人工protectededit、歷史receipt/outbound/run/provenance保留。

Formalanonymous首頁/adminHTTP200只是availability，不是deployedSHA/Auth/worker/schema/function證明。28Hse120/20/45/10+04:17HKT保持；acceptedbaseline1/3、repair0/3、agenttrigger0。Natural37160712576/main51 successworkflowonly未讀privatefullreceipt，不提升cycle。Manual/replay/watchdog/skip非nativeDaily。Propertyhk逐EPS/EPT/EPW/approveddt需page1terminal+真detail/media，403/partial/index-only非absence，132held與其他offers/manualoverride一併核實。

Rollback先限制correction/report入口，paired UI/server一起compatible revert；保留immutable quality/qualification/canonicalevent/receipt/outbound/run/provenance、protectededits，勿wholeDBrestore或重送變ID／duplicatecorrectivehistory。沒有merge/deploy/liveconfig/migration/real send/provider/paidapplicationmodel。

Owned品質未知結果replay及CAS **READY**；durableuncommittedintent/fullroles/fullconcurrency/occurrence/3次修復native **NOT_READY**；trueAuth/UI+PG/provider/productionmigrationdeploy/restore **BLOCKED**。

## 本批裁決及錯判成本

- 既有 immutable revision ID/null 作base，原請求kind/source/actor/base/quality/reason核對immediate successor；相同currentlatest決定no-op，舊ACK不覆蓋newer其他admin。錯判成本：重複history或覆蓋protected human decision。
- 既有transactionRows先來源rowlock後freshReadCommitted第二statement；單CTE鎖不提供等待後新快照。錯判成本：並發錯誤勝出或duplicate revisions。
- 既有PerformanceRecord optionalqualityRevisionId與quality同SELECT；privatequalityPOST requiredexpectedRevisionId:string|null，cachedclients須refresh及pairedUI/serverrelease，無blindwritefallback。錯判成本：舊client不相容或silent staleoverwrite。
- actor-keyed in-memory journal保留原payload/filterremount，原品質原因readonly提示，新draft保持；hardreload未提交intent不宣稱durable。錯判成本：丟失pendingintent或錯誤重送。
- 品質writer在currentauthorized existing lockedsource找不到exactimmutable successor才409，此拒絕證明原請求未接受；matchingjournal清除並freshreadback，再由人明確決定。403/400不能排除earlieruncertaincommit，仍保留；qualification409語義不同，保持原gate。錯判成本：false-negative reconciliation或永遠無法修正。
- 只在ownedPG17/loopback寫fixture；test-onlysessionStorage為backendfacts，syntheticAuth/API與SQL獨立，非combinedrealAuthjourney。錯判成本：mock冒充正式驗收。
- 初SQLpositive assertion選錯responses inquiry而非eventrow，改quality_test_events；alloption實值emptystring；legacyPGlite缺已有revisiontable只補partialreadfixture。所有failedlog保留。錯判成本：測試弱化/身份混淆。
- 首build缺TSS_ROUTES_MANIFEST失敗，無source改動sequentialPASS；rootcauseUNPROVEN不冒称race已修。錯判成本：隱藏intermittentbuildfailure。
- 自然37160712576/main51 successworkflowonly，privatefullreceipt未獨立讀回，baseline1/3repair0/3agenttrigger0不提升。錯判成本：捏造nativeacceptance。

## 審阅declined行為的author裁決

- D1 NOT_READY: Durable recovery of an uncommitted quality or qualification intent after hard reload/new session — production journals are memory-only; accepted qualification source recovery does not make pending intent durable. Cost if wrong: lost uncertain request.
- D2 BLOCKED: Real Auth login, expiry, session admission, and revocation delivery to the UI — current evidence uses fixture actors and synthetic browser identity, not real sessions. Cost if wrong: false session authorization.
- D3 BLOCKED: A combined real-Auth/browser/PostgreSQL/provider journey — SQL and browser layers were independently tested, not connected end to end. Cost if wrong: invented end-to-end proof.
- D4 NOT_READY: Exhaustive grant promotion, grant insertion/deletion, phantom, ABA, account-rebinding, and lock-order interleavings — selected controlled cases and source inspection do not cover the entire concurrency state space. Cost if wrong: hidden concurrent overwrite.
- D5 NOT_READY: Authorization revocation after the final statement or during response transport — point-in-time transaction/read gates do not establish continuous transport authorization. Cost if wrong: false continuous authorization.
- D6 NOT_READY: Continuous qualification source/owner consistency after metadata selection and before delivery — final read revalidation is actor/scope oriented; no single end-to-end business snapshot was demonstrated. Cost if wrong: stale source evidence.
- D7 NOT_READY: Every cohort, branch/staff/source/deal filter, pagination/backlog combination and concurrent occurrence-time/Hong Kong day correction — scoped queries were read, but the cross-product and time-correction races were not exhausted. Cost if wrong: wrong metric/source scope.
- D8 NOT_READY: Production query latency, index suitability under real distribution, throughput, deadlock frequency, and contention — no load test, EXPLAIN workload, or production measurements. Cost if wrong: operational regression.
- D9 BLOCKED: Production app, worker, schema, migration, and flag alignment — no deployment or authenticated production verification authorized for this review. Cost if wrong: wrong formal environment.
- D10 BLOCKED: Production migrations, canary, cutover, and rollback execution — local additive SQL/source inspection is not actual release/rollback proof. Cost if wrong: unsafe release/restore.
- D11 BLOCKED: Real provider acceptance/delivery/read/staff-ack/human-reply receipts, templates, members, destinations, and sends — no provider exercise; synthetic states cannot prove external delivery. Cost if wrong: wrong real send or duplicate retry.
- D12 BLOCKED: Paid model behavior, semantic answer quality, resolved usage/cost completeness, and budget — no application-model calls; only contract/fallback/provenance source sampled. Cost if wrong: wrong cost or answer.
- D13 BLOCKED: Property.hk EPS/EPT/EPW and dt completeness, terminal paging, detail/media access, and the 132 held candidates — no live complete-scope absence evidence was obtained. Cost if wrong: false withdrawal.
- D14 NOT_READY: Three accepted repaired native 28Hse daily runs — the package retains baseline 1/3, repaired 0/3, agent-triggered 0; the natural workflow success lacks independently read private full receipt. Cost if wrong: fabricated scheduled acceptance.
- D15 BLOCKED: Native clipboard, IME, accessibility across real devices/platforms, and non-Chromium behavior — no native/platform acceptance executed; four viewport results are synthetic Chromium. Cost if wrong: device input failure.
- D16 NOT_READY: Every role, route, feature flag, dialog, and action in the cumulative branch — 45/207 changed files were risk-sampled; all-role/control acceptance is not exhaustive. Cost if wrong: cross-scope action leak.
- D17 NOT_READY: Exhaustive cumulative parser/receipt/CAS/outbound/Inbox/portal-zero-EPWA acceptance — selected UI/server boundaries were reviewed, but unchanged underlying parser/receipt/send implementations and every historical suite were not re-executed. Cost if wrong: untested cumulative regression.
- D18 AUTHOR_INDEPENDENT_VERIFICATION: Exhaustive preservation of historical raw hashes, old JSON identity, original 29/9/22 results, 22 planned NEW cases, 82-case denominator, 40/28/14 execution tally, 1400 IDs and 408 rendered mapping history — ledger/package read only; author must perform the archive/hash reconciliation. Cost if wrong: false preservation attribution.
- D19 UNPROVEN: Root causes of earlier duplicate/Docker failures and the transient build manifest failure — later passes are evidence of passing repeats, not a causal diagnosis. Cost if wrong: hidden intermittent failure.
- D20 AUTHOR_REMOTE_READBACK_PENDING: Latest remote PR content/head synchronization and CI/publication state — this is a local committed-source review; no remote CI or PR readback performed. Cost if wrong: forecast treated as PASS.
- D21 BLOCKED: Formal readiness inferred from anonymous HTTP 200 — anonymous availability does not establish deployed SHA, authenticated functionality, or release readiness. Cost if wrong: false production readiness.
- D22 NOT_READY: Exhaustive handling of manual/district knowledge edits, canonical-source concurrency, CRM dependency insertion phantoms, and source transitions beyond the sampled guards — migrations and key paths were inspected but cumulative database suites were not independently rerun. Cost if wrong: canonical or dependency race.
- D23 NOT_READY: Support resolution for permanently missing source/receipt records or corrupted local campaign/link recovery journals — the sampled UI preserves/blockades uncertainty, but no operational support procedure or terminal recovery was exercised. Cost if wrong: unrecoverable operator workflow.
