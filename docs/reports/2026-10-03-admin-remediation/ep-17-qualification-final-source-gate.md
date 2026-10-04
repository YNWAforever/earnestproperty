# EP-17/20 Qualification 輸出前再驗來源

基線 `7d1e201c9f7779ffee806e4250d4c4469d00cd14`；修復 `0afb56dcefb00baad7755794a151f3b71ff8f291`。原查詢在讀出本人 qualification 證據後只重驗 actor；source owner／查詢 owner 跨分行、owner branch 改變、查詢解除／改換 lead、lead unassigned，以及有 branch filter 的 admin 可收到舊證據。最後 scope statement 同時驗 current active/Auth binding/grants、current inquiry→lead、本人不可變 qualification 原時間及 evidence、canonical event 和 current owners 範圍。來源變更409、actor／scope403，舊頁不輸出；新查詢獨立讀回 current source，不改人工來源或歷史。

同分行轉派、未選分行的 global admin 轉派及 stage-only 更改繼續合法。Qualification author 與歷史 event credited staff 分開。只有實際附加到本頁的本人 source 入 gate；既有 DTO、quality correction CAS、qualification retry/journal、CSV、分母和其他 author privacy 不變。沒有新 API／DTO type／schema／migration／config／runtime/provider ID，production UI 未改；e2e只有artifact prefix更新，以保留先前證據。

先 RED 真 PostgreSQL 87tests79PASS8FAIL（7direct + parent）、0SKIP；修正後87PASS。額外歷史timestamp probe RED88/86/2：PGmicroseconds被JSDate/ISO截斷，合法原資料假409。私有 qualified_at::text 作exactwitness，公開DTO仍milliseconds、不輸出私有欄；原PG123456microseconds獨立讀回保留。最終 GREEN及exactcommit 88SQL0FAIL/SKIP；12新增leaf，85migrations只套ownedloopbackPG17。Barrier完成真qualification SELECT後，於最後actorstatement前commit真source/owner/link更改，非mockSQL。拒絕後fresh read核對新source或省略原evidence，全immutable history arrays無變。

Actualroute/table/dashboard/shell四viewport1440/1280/768/390，每41，164PASS0FAIL/SKIP；無新增browsercase，syntheticAuth/API/backend與SQL分層，非trueAuth/UI+PG/provider。Analytics65+Bun3/no-link99+Bun9；typecheck、lint、build分開exit0；3baselinewarnings。Build只恢復preclean/normalizedbyteequalHEAD的own generatedrouteTree，unrelatedbun.lockb未stage。先前manifest/Docker/duplicate原因仍UNPROVEN。證據產生器首次nestedquote SyntaxError於writes前失敗，改nativePowerShell literal writer後py_compile通過，沒有覆蓋歷史。

FreshAstra wholebranch review actual inspected/rerun/probes與declines見下方。原290 selectedrawhashes、64trackedreports、oldJSON deep values／CSV歷史／原29PASS9FAIL22BLOCKED／22plannedNEW／82cases／execution40PASS28PARTIAL14BLOCKED保留；NEW17PARTIAL、TEST46BLOCKED。1400 IDs（68business/1332source）和408歷史render不當所有已驗按鈕。

Formal匿名首頁/admin200只證available，沒有deployedSHA/Auth/worker/schema驗收。28Hse120/20/45/10＋04:17HKT不改；baseline1/3、repair0/3、agenttrigger0，naturalworkflowprivatefullreceipt未讀不提升。Propertyhk逐EPS/EPT/EPW/approveddt需要page1terminal＋真detail/media，403/partial/index-only不是absence；132held與其他offers/manualoverride保留。

Rollback先限制本人qualification證據readback，才compatible revert本read gate，避免重新暴露跨scope來源。保留quality／qualification／event／receipt／outbound／run／provenance及人工protected edits，維持AIcanonical read gate；不wholeDB restore或換ID重送。沒有merge、部署、productionmigration/config、真發送或paidapplicationmodel。

Owned本人qualification末道source gate **READY**；poststatement/transport、ABA、完整report/cohort快照、durablependingjournal/fullroles/native3次 **NOT_READY**；trueAuth/UI+PG/provider/production/canary/restore **BLOCKED**。

## 本批裁決及錯判成本

- 末道statement對實際輸出的本人qualification，再驗current inquiry→lead、ownimmutablequalification、exacttimestamp/evidence/canonicalevent、actor/grants及owner scope。來源已變409不輸出舊頁；actor/scope仍403。錯判成本：轉派後洩露舊證據。
- 同分行轉派、未限定branch的globaladmin跨分行讀取及stageonly仍獲准；作者與歷史creditstaff分開。錯判成本：無故阻斷合法讀回或扭曲credit。
- PGexacttimestamp私有witness使用qualified_at::text；公開DTO仍milliseconds。錯判成本：歷史microsecond資料假409或洩露私有欄位。
- 這是最後statement的pointintime資格；statement後/transport、ABA、整體report/record/filter跨statement一致快照仍NOT_READY。錯判成本：把race cases當continuousauthorization。
- ProductionUI不改；四viewport164為actualroute+syntheticAuth/API回歸，非combinedtrueAuth/Postgres/provider。錯判成本：誤報正式全journey。
- 先前290 rawhashes/64trackedreports/oldJSONdeepvalues及CSV原29/9/22與22plannedNEW/82execution40/28/14保留；NEW17PARTIAL/TEST46BLOCKED及1400IDs408render不提升。錯判成本：覆蓋缺陷或誤認已驗按鈕。
- 沒有新API/DTOtype/config/schema/migration/runtime/providerID；85existing只在ownedPG17dryrun，正式DB/部署/真發送/paidapplicationmodel effects0。錯判成本：越權或捏造環境。
- 28Hse120/20/45/10及04:17HKT保持；baseline1/3repair0/3agenttrigger0，naturalworkflow未讀privatefullreceipt不增加nativeDaily；Propertyhk未full132held。錯判成本：假排程驗收或假撤盤。

## 審閱實際範圍及裁決

```json
{
  "reviewedAt": "2026-10-04T05:15:17.868115+00:00",
  "model": "gpt-6-astra",
  "freshContext": true,
  "wholeBranchBase": "51cb0e9c08269ebabeb0b593d4dea611b9246c32",
  "focusedBase": "7d1e201c9f7779ffee806e4250d4c4469d00cd14",
  "reviewedCodeSha": "0afb56dcefb00baad7755794a151f3b71ff8f291",
  "finalCodeSha": "0afb56dcefb00baad7755794a151f3b71ff8f291",
  "critical": 0,
  "important": 0,
  "minor": 0,
  "remainingCritical": 0,
  "remainingImportant": 0,
  "authorFixPasses": 0,
  "secondReview": false,
  "allFocusedFiles": 3,
  "cumulativeFiles": 208,
  "sampledFilesReported": [
    "e2e/admin-performance-readback.spec.ts",
    "neon/migrations/20261003010000_ai_knowledge_durable_repair.sql",
    "neon/migrations/20261003030000_crm_analysis_runs.sql",
    "neon/migrations/20261003040000_content_proposal_source_guard.sql",
    "package.json",
    "scripts/acceptance/admin-golden-journeys.test.mjs",
    "scripts/acceptance/owned-postgres-test.mjs",
    "src/components/admin/WhatsappAiSuggestions.tsx",
    "src/components/admin/analytics/PerformanceTable.tsx",
    "src/components/admin/operations/AdminOperationsJobs.tsx",
    "src/components/admin/whatsapp/StaffTestNotificationDialog.tsx",
    "src/components/admin/whatsapp/WhatsappBatchImport.tsx",
    "src/lib/admin/whatsapp-link-batch-client.ts",
    "src/lib/ai/content-copilot-context.server.ts",
    "src/lib/ai/content-copilot-repository.server.ts",
    "src/lib/ai/crm-analysis-contract.ts",
    "src/lib/ai/crm-analysis-eligibility.ts",
    "src/lib/ai/crm-analysis-runs.server.ts",
    "src/lib/ai/crm-enrichment.server.ts",
    "src/lib/ai/knowledge-freshness.server.ts",
    "src/lib/ai/knowledge.server.ts",
    "src/lib/ai/live-agent.server.ts",
    "src/lib/ai/live-agent.ts",
    "src/lib/ai/provider.server.ts",
    "src/lib/analytics/performance-events.server.ts",
    "src/lib/analytics/performance-readback-owned.db.test.mjs",
    "src/lib/analytics/sales-performance-client.ts",
    "src/lib/analytics/sales-performance-drilldown.mjs",
    "src/lib/analytics/sales-performance.queries.mjs",
    "src/lib/analytics/sales-performance.server.ts",
    "src/lib/analytics/sales-performance.types.ts",
    "src/lib/mls/withdrawal-review.mjs",
    "src/routes/admin.analytics.tsx",
    "src/routes/admin.blasts.tsx",
    "src/routes/admin.whatsapp.tsx"
  ],
  "coverage": "all3focused plus risk sample;reviewreport details full/substantial/excerpt/diff depths;not exhaustive208",
  "reviewerExecuted": {
    "command": "node --test src/lib/analytics/sales-performance.test.mjs src/lib/analytics/performance-events.test.mjs src/lib/analytics/performance-route-search.test.mjs",
    "pass": 12,
    "fail": 0,
    "skipped": 0,
    "rawOutputSaved": false,
    "attribution": "freshreviewer report actualexecution;no reconstructedstdout",
    "cumulativeDiffCheck": "exit0",
    "customSQLProbe": false,
    "SQLRerun": false,
    "browserRerun": false
  },
  "reviewerReadAuthorEvidence": {
    "SQL": 88,
    "browser": 164,
    "SQLSHAAttribution": "filename/authorprocess;SQLlogdoesnotembedSHA",
    "browserCodeShaVerified": "0afb56dcefb00baad7755794a151f3b71ff8f291",
    "viewportsEach": 41,
    "realAuth": false,
    "realDatabase": false,
    "realProvider": false
  },
  "declinedRulings": [
    "D1 Durable pending quality/qualification intent across hard reload/new session: NOT_READY; production journals are memory-only. Accepted-source recovery cannot prove preservation of an uncommitted request. Cost if wrong: lost uncertain request.",
    "D2 Real Auth login, expiry, admission and revocation delivery to the UI: BLOCKED; synthetic browser identity and trusted SQL actors do not exercise sessions. Cost if wrong: false session authorization.",
    "D3 Combined real-Auth/browser/PostgreSQL/provider journey: BLOCKED; browser and SQL layers are separate. Cost if wrong: invented end-to-end proof.",
    "D4 Exhaustive grant promotion/insertion/deletion, account rebinding, phantom, ABA and lock-order concurrency: NOT_READY; sampled controls do not exhaust these interleavings. Cost if wrong: hidden concurrent overwrite.",
    "D5 Actor or grant revocation after the final statement snapshot/during transport: NOT_READY; final gates are point-in-time checks, not continuous authorization. Cost if wrong: false continuous authorization.",
    "D6 Source/link/owner changes after the final statement snapshot/during transport: NOT_READY. This slice addresses committed changes between completed metadata selection and the final gate, but cannot establish continuous source consistency afterward. Cost if wrong: stale evidence after final snapshot.",
    "D7 General report, cohort and unqualified-record snapshot consistency: NOT_READY; the proof deliberately covers only attached qualification evidence, not all previously selected business rows. Cost if wrong: mixed denominator or unqualified source scope.",
    "D8 Every branch/staff/source/deal/cohort/pagination/backlog combination and occurrence-time/Hong Kong day correction race: NOT_READY; source inspection and selected fixtures do not prove the cross-product. Cost if wrong: wrong filter or HK day.",
    "D9 Production latency, index suitability, contention, deadlocks and throughput: NOT_READY; no load/EXPLAIN workload or production measurements. The attached witness is bounded by page selection, while earlier cohort reads are broader. Cost if wrong: operational query regression.",
    "D10 Production app/worker/schema/migration/flags alignment: BLOCKED; no authenticated production verification or deployment. Cost if wrong: wrong formal environment.",
    "D11 Production migrations, canary/cutover/rollback: BLOCKED; additive SQL inspection and owned tests are not operational rollout/rollback proof. Cost if wrong: unsafe cutover or restore.",
    "D12 Real provider acceptance/delivery/read/staff acknowledgment/human reply, templates, destinations and sends: BLOCKED; no provider exercise. Cost if wrong: duplicate send or wrong recipient.",
    "D13 Paid-model semantic quality, provider usage/cost completeness and budget: BLOCKED; provenance contracts were sampled, no application-model calls made. Cost if wrong: wrong spend or semantic answer.",
    "D14 Property.hk EPS/EPT/EPW, dt, terminal paging/detail/media completeness and132 held candidates: BLOCKED; no complete live-scope evidence. Partial/403 evidence cannot authorize absence withdrawal. Cost if wrong: false withdrawal of132held.",
    "D15 Three accepted repaired native28Hse daily runs: NOT_READY; retain baseline1/3, repaired0/3, agent-triggered0. Natural workflow37160712576 without independently read private full receipt cannot be promoted. Cost if wrong: fabricated schedule acceptance.",
    "D16 Native clipboard, IME, real-device accessibility and non-Chromium behavior: BLOCKED; four viewport fixture results do not supply native/platform acceptance. Cost if wrong: hidden device input failure.",
    "D17 Every role/route/flag/dialog/action across208 changed files: NOT_READY; this review is explicitly sampled. Cost if wrong: cross-scope action leak.",
    "D18 Exhaustive parser/receipt/outbound/Inbox/portal-zero-EPWA and source-identity acceptance: NOT_READY; retained boundaries and harness entry were sampled, unchanged internals and all historical suites were not independently rerun. Cost if wrong: cumulative identity or portalzeroEPWA regression.",
    "D19 Exhaustive manual/district knowledge changes, canonical-source concurrency, CRM insertion phantoms and proposal source transitions: NOT_READY; specific locks/guards were read, cumulative SQL suites not independently rerun. Cost if wrong: stale AI or proposal source.",
    "D20 Terminal support recovery for permanently missing source/receipt records or corrupt campaign/link journals: NOT_READY; sampled code blocks uncertainty but operational support resolution was not exercised. Cost if wrong: unresolved permanent unknown outcome.",
    "D21 AUTHOR_VERIFIED: root checked290priorrawhashes/64oldreports/oldJSONdeepvalues/original29/9/22/22NEW82execution40/28/14/1400IDs/unchanged408history beforedelivery;reviewer didnotclaimthat verification. Cost if wrong: false historical preservation attribution.",
    "D22 Root causes of earlier duplicate/Docker/build failures: UNPROVEN; later passing evidence does not diagnose historical failures. Cost if wrong: misdiagnosed intermittent failure.",
    "D23 AUTHOR_REMOTE_READBACK_PENDING: root willindependentlyverify exactremotehead/joblogs/status/body/trees beforedelivery;reviewer localonly;do notforecastPASS. Cost if wrong: forecast treated as actual CI.",
    "D24 Formal readiness from anonymous HTTP200: BLOCKED; availability cannot establish deployed SHA or authenticated functionality. Cost if wrong: false production readiness.",
    "D25 Arbitrary PostgreSQL DateStyle/timezone configuration, unusual historical infinite/out-of-JS-range timestamps and corrupted direct-DB source data: NOT_READY; the actual historical microsecond case is covered, but the configuration/data space is not exhausted. The final proof is server-derived, not an untrusted new public parameter. Cost if wrong: legitimate historical time rejected."
  ],
  "minorDeferred": [],
  "report": "review-final-source-result.md",
  "verdict": "no actionable defect in inspectedsample;local gate READY;formal release BLOCKED/NOT_READY;no permissionmerge"
}
```

- D1 Durable pending quality/qualification intent across hard reload/new session: NOT_READY; production journals are memory-only. Accepted-source recovery cannot prove preservation of an uncommitted request. Cost if wrong: lost uncertain request.
- D2 Real Auth login, expiry, admission and revocation delivery to the UI: BLOCKED; synthetic browser identity and trusted SQL actors do not exercise sessions. Cost if wrong: false session authorization.
- D3 Combined real-Auth/browser/PostgreSQL/provider journey: BLOCKED; browser and SQL layers are separate. Cost if wrong: invented end-to-end proof.
- D4 Exhaustive grant promotion/insertion/deletion, account rebinding, phantom, ABA and lock-order concurrency: NOT_READY; sampled controls do not exhaust these interleavings. Cost if wrong: hidden concurrent overwrite.
- D5 Actor or grant revocation after the final statement snapshot/during transport: NOT_READY; final gates are point-in-time checks, not continuous authorization. Cost if wrong: false continuous authorization.
- D6 Source/link/owner changes after the final statement snapshot/during transport: NOT_READY. This slice addresses committed changes between completed metadata selection and the final gate, but cannot establish continuous source consistency afterward. Cost if wrong: stale evidence after final snapshot.
- D7 General report, cohort and unqualified-record snapshot consistency: NOT_READY; the proof deliberately covers only attached qualification evidence, not all previously selected business rows. Cost if wrong: mixed denominator or unqualified source scope.
- D8 Every branch/staff/source/deal/cohort/pagination/backlog combination and occurrence-time/Hong Kong day correction race: NOT_READY; source inspection and selected fixtures do not prove the cross-product. Cost if wrong: wrong filter or HK day.
- D9 Production latency, index suitability, contention, deadlocks and throughput: NOT_READY; no load/EXPLAIN workload or production measurements. The attached witness is bounded by page selection, while earlier cohort reads are broader. Cost if wrong: operational query regression.
- D10 Production app/worker/schema/migration/flags alignment: BLOCKED; no authenticated production verification or deployment. Cost if wrong: wrong formal environment.
- D11 Production migrations, canary/cutover/rollback: BLOCKED; additive SQL inspection and owned tests are not operational rollout/rollback proof. Cost if wrong: unsafe cutover or restore.
- D12 Real provider acceptance/delivery/read/staff acknowledgment/human reply, templates, destinations and sends: BLOCKED; no provider exercise. Cost if wrong: duplicate send or wrong recipient.
- D13 Paid-model semantic quality, provider usage/cost completeness and budget: BLOCKED; provenance contracts were sampled, no application-model calls made. Cost if wrong: wrong spend or semantic answer.
- D14 Property.hk EPS/EPT/EPW, dt, terminal paging/detail/media completeness and132 held candidates: BLOCKED; no complete live-scope evidence. Partial/403 evidence cannot authorize absence withdrawal. Cost if wrong: false withdrawal of132held.
- D15 Three accepted repaired native28Hse daily runs: NOT_READY; retain baseline1/3, repaired0/3, agent-triggered0. Natural workflow37160712576 without independently read private full receipt cannot be promoted. Cost if wrong: fabricated schedule acceptance.
- D16 Native clipboard, IME, real-device accessibility and non-Chromium behavior: BLOCKED; four viewport fixture results do not supply native/platform acceptance. Cost if wrong: hidden device input failure.
- D17 Every role/route/flag/dialog/action across208 changed files: NOT_READY; this review is explicitly sampled. Cost if wrong: cross-scope action leak.
- D18 Exhaustive parser/receipt/outbound/Inbox/portal-zero-EPWA and source-identity acceptance: NOT_READY; retained boundaries and harness entry were sampled, unchanged internals and all historical suites were not independently rerun. Cost if wrong: cumulative identity or portalzeroEPWA regression.
- D19 Exhaustive manual/district knowledge changes, canonical-source concurrency, CRM insertion phantoms and proposal source transitions: NOT_READY; specific locks/guards were read, cumulative SQL suites not independently rerun. Cost if wrong: stale AI or proposal source.
- D20 Terminal support recovery for permanently missing source/receipt records or corrupt campaign/link journals: NOT_READY; sampled code blocks uncertainty but operational support resolution was not exercised. Cost if wrong: unresolved permanent unknown outcome.
- D21 AUTHOR_VERIFIED: root checked290priorrawhashes/64oldreports/oldJSONdeepvalues/original29/9/22/22NEW82execution40/28/14/1400IDs/unchanged408history beforedelivery;reviewer didnotclaimthat verification. Cost if wrong: false historical preservation attribution.
- D22 Root causes of earlier duplicate/Docker/build failures: UNPROVEN; later passing evidence does not diagnose historical failures. Cost if wrong: misdiagnosed intermittent failure.
- D23 AUTHOR_REMOTE_READBACK_PENDING: root willindependentlyverify exactremotehead/joblogs/status/body/trees beforedelivery;reviewer localonly;do notforecastPASS. Cost if wrong: forecast treated as actual CI.
- D24 Formal readiness from anonymous HTTP200: BLOCKED; availability cannot establish deployed SHA or authenticated functionality. Cost if wrong: false production readiness.
- D25 Arbitrary PostgreSQL DateStyle/timezone configuration, unusual historical infinite/out-of-JS-range timestamps and corrupted direct-DB source data: NOT_READY; the actual historical microsecond case is covered, but the configuration/data space is not exhausted. The final proof is server-derived, not an untrusted new public parameter. Cost if wrong: legitimate historical time rejected.
