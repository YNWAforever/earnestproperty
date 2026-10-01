# 每日盤源同步實作紀錄

## 起點 / T0

- Checked 2026-10-01 04:03 UTC. origin matches YNWAforever/earnestproperty.
- main e8997f290045fde37625be99863d803f4f72c7b5; PR207 OPEN / DRAFT, head 1e2a3459691fc06ba0deb8b09cf8dd5f57a2fcd0, unmerged.
- Isolated native worktree / codex/full-property-sync-20261001 starts at PR207 head. Root modifications preserved; native checkout has a pre-existing bun.lockb mode change, left unstaged.
- ZIP SHA256 5f05410bb34fd9d0d44877b31ea25eb8aea379c0f816dbb2308e3bf2787b8745 verified. Safe extraction preflights all names, links, counts, total bytes and per-file limits before extraction. 12 files / 141230566 expanded bytes, ignored private directory.
- Ruling: raw-evidence.json is 139837939 bytes, larger than initial 128 MiB ceiling; raised extraction per-file ceiling to 256 MiB, retaining 1 GiB total and ratio 1000 limits. Cost if wrong: bounded additional local disk use; no publishing.
- Exact request SHA256 b458d085b60aeb241006daf0f11919a54a5e9ef490528854b594d522cac3bd55, 414631 bytes. 286 adverts (226 sale,60 rent), 22 pages, no rejects/failures. 46 new source IDs are not new properties; 132 historical absence candidates remain NOT_APPROVED. No withdrawals applied.
- Offline sample mappings PASS: 4033913/A072390,4034357/B059410,4034591/A057717. Current live qualifications remain unverified.
- Read-only production host verified against managed Actions variable and local managed connection: ep-divine-frost-aokzrg7f.c-2.ap-southeast-1.aws.neon.tech / neondb.
- Accepted receipt 60895ce3-6a1d-4225-84f1-455d6e47f181: 2026-09-24T21:45:54.421920Z /279 ads; canonical payload hash 6c6db71ab58c1ec009559f4678087d88c24e5a80db4ee97d8b50b14306cc6a1e. Parser python-v2.2/policy no-hermes-v2, absence=false.
- Source links356 approved28hse; Property.hk0/no policy. Inventory532 active/16 draft/637 inactive; admin override rows0 (other existing ownership guards remain required).
- main schedule absent; PR207 restores04:17HK. Four most recent scheduled runs failed. DailyEnabled=true exists; private evidence repo/token missing.
- Baseline Node command: node --test src/lib/mls/ingestion-contract.test.mjs src/lib/mls/source-selection.test.mjs src/lib/mls/source-snapshot-gates.test.mjs src/lib/mls/daily-publication.test.mjs scripts/property-sync-daily.test.mjs src/lib/neon/featured-promotion.contract.test.mjs: exit0,58/58 PASS at base1e2a345.
- Baseline Python: .venv-sync/Scripts/python -m pytest scripts/property-sync/tests -q: exit0,68/68 PASS at base1e2a345. Isolated dependencies installed using existing locks/pinned requirements; no lock contents changed.

## Status

| Task | Code / offline | Live / production |
|---|---|---|
| T0 | PASS | read-only checks PASS; no mutation |
| T1-T5 | PASS code/offline/isolated | private evidence/baseline recovery/live publication gate |
| T6-T8 | PASS safe gated code/isolated | Property.hk access/identity/real fixtures BLOCKED_EXTERNAL |
| T9-T10 | PASS synthetic UI/real disposable integration | migrations/live login/managed dispatch/release gate |
| T11 | PASS local release/recovery/rollback preparation | 0/3 new scheduled cycles; MONITORING not stable |

## Shared interfaces / rulings

- T1→T2→T3: immutable manifest byte SHA differs from the ingestion canonical payload hash. Both must be recorded and checked; never compare raw SHA to a canonical hash.
- T3→T4: only the current accepted full receipt authorizes publication, retaining36h freshness and20 attempt cap.
- T7→T8: unverified Property.hk URL/ID/media contracts stay disabled; no synthetic selector promoted to live config.
- T2→T9: missing callbacks/never-started schedules need read-only health checks independently of stage success events.
- T9→T10: use existing server authorization/property mutation service; no client actor/UUID/version authority.
- Execution remains single agent as requested; local author review will be identified explicitly. Windows task evidence/checkboxes stored in these tracked reports; shell-specific skill bookkeeping replaced with equivalent entries.

## External gates

Private evidence repository/release + least-privilege credential and authoritative baseline recovery; reviewed merge/deploy/activation authority; Property.hk supported exact URLs/real fixtures/ID/media policy; production UI login; manual end-to-end and3 actual daily cycles.

## T1 implementation evidence

- RED: 5 missing manifest/privacy/authority/retention behaviors failed; existing11 passed. Additional interrupted archive/readback tests2 failed,16 passed.
- GREEN: `.venv-sync/Scripts/python -m pytest scripts/property-sync/tests/test_daily_artifacts.py -q` exit0,18/18 PASS at T1 working tree (base9775d8b); no source/network/DB writes.
- Implemented bounded hashes, atomic archive/final manifest, privacy+permissions, exact upload/download readback, canonical receipt authority checks and pinned release retention selection. Windows fsync requires a writable descriptor; verified fix with archive tests.
- T1 helpers READY; workflow wiring T2, read-only authority retrieval T3 pending. Private live permission/baseline migration BLOCKED_EXTERNAL. Retention deletion intentionally requires reviewed exact assets; no remote cleanup performed.

## T2 local implementation (and prerequisite T3 read guard)

- RED: missing durable checkpoint3 cases, run contract2 cases and staged workflow budget1 case reproduced. Hard-exit worker process test added; outcome unknown/terminal duplicate protection tested.
- GREEN before final commit: daily workflow+target+publication+run/authority/public verifier suites23 PASS; Python full suite79 PASS, including actual subprocess exit17 immediately after a saved response. Full ingestion baseline70 PASS. bash -n passes all25 actual job scripts.
- Initial budgets: preflight10/collect120/ingest20/publish45/verify10 minutes. Collector has no DB/Blob credential; only preflight reads DB, ingest applies, publish owns Blob. Private manifest is read back before downstream stages. Replay/publication-only never invokes collector or changes timestamps.
- Read-only08:15HK watchdog is independent of collection callbacks and sends no messages. Health uses durable ingestion accepted_at; source collected_at remains separate for36h publication freshness.
- New current authority helper executed against verified production host in BEGIN READ ONLY: current receipt60895ce3 and279 ads confirmed. No transaction writes/migrations.
- Ruling: automatic approval review rejected broadening code-repository token permissions to contents-write. Retain contents-read and require a separately managed evidence repository credential with minimal contents read/write. Missing write capability fails private preflight; the original default token fallback cannot upload under this restricted setup. Cost if wrong: private-code-repo installations must configure an explicit evidence credential; safer than widening every code job token. No rejected action was executed.
- Ruling: immutable terminal stage duplicate may not replace its receipt/timestamps; reconciled unknown results require an explicit reconciliation event. New attempt uses a new run stage.
- T2 readiness is local/reviewable. Live handoff permissions, hosted job duration, callback readback/UI and3 actual scheduled cycles remain unverified. No workflow dispatched or production configuration changed.
- Early T4 compatibility: publication report carries the existing public alias for verifier; never reconstructs a public alias from the company number.

T2 final verification at working tree based94c25bd: npm run test:property-sync:daily exit0,24/24 PASS; Python pytest scripts/property-sync/tests exit0,79/79 PASS; git diff --check exit0. Provider/canonical writer/DB policy unmodified. T1 private live capability and reviewed retention execution remain unchecked.

## T3 verification / durable ingestion

- RED: wrong daily DB host was not rejected by the CLI bridge; fixed before service/client invocation. Dry-run still reads no credentials.
- GREEN on working tree based b420876: npm run test:property-sync exit0 71/71; npm run test:property-sync:python exit0 79/79. The named Python runner now uses its documented isolated venv with pinned requirements.
- Verified disposable staging branch br-young-breeze-ao85rtx1, endpoint ep-square-leaf-aobruyvf, dedicated empty earnest_audit_acceptance_20260927 database using the unchanged shared server identity guard. Eight suites now use this guard instead of a deleted hard-coded branch. Production/neondb is not a fixture target.
- Actual Node direct env-file test command (six ingestion suites plus two publication suites, --test-concurrency=1) exit0: 41 PASS,0 FAIL,0 SKIPPED,488.3s. Tests cover same-request replay, lost COMMIT acknowledgement/reconciliation, previous-full baseline, wrong identity/scope, primary/secondary priority, retained aliases, manual overrides, actual write counters and real two-client global lock contention.
- Initial two concurrent runner processes failed ingestion_busy (37/39 ingestion tests and1/2 publication tests); serial rerun confirmed the cause was expected shared advisory-lock contention between runners. No production lock rule weakened. Initial node --env-file --run invocation propagated no env to its child and skipped6; not counted as DB evidence. The direct --test run above had no skips.
- DB migration status: existing immutable migration fixtures only in unique disposable schemas; no production migration/config/data writes. Private evidence/baseline readback remains BLOCKED_EXTERNAL; accepted DB receipt alone is never a successful upload.
- T3 local READY. Production apply and a fresh accepted full receipt remain VERIFICATION_BLOCKED pending the private destination and rollout gates.

## T4 publication / backlog

- RED: report lacked attempted/backlog/oldest wait; new regression failed. New queue contract initially absent. GREEN: daily suites29/29 before T5 redirect test, then30/30 including it, exit0 at working tree based515aa23.
- Retained20 attempts (including media failures) and36h freshness. Stable selection prefers never attempted, then oldest recorded media attempt, original creation time and source/offer identity. Existing immutable media records supply durable attempt history; no new publisher/writer or hidden quota increase. Backlog excludes confirmed successful publications and includes media-held and budget-held eligible drafts.
- Real verified disposable DB: publication and next-ingestion suites2/2 PASS,0 SKIP,46.0s. Additional lost COMMIT acknowledgement drill1/1 PASS,35.9s: committed property is active; report records unknown; exact replay sees alreadyPublic and reuses verified owned media. No blind repeated publication effect. These test-case totals include multiple assertions/scenarios, not a claim of extra independently counted cases.
- SQL fixture verifies21 drafts,20 failed attempts, and the untouched21st is first on retry. Publication audit failure rolls back; accepted-current receipt changes reject before media; failed immutable media observation remains historical and child retry keeps successful assets. Next ingestion preserves reviewed description.
- No Blob/provider writes, production publication or ZIP date changes. T4 local READY; actual uploads/public samples remain VERIFICATION_BLOCKED pending release.

## T5 homepage/public consistency

- Preserve PR207 newest SQL and separate promotion mode. Added real query/PGlite fixture assertions for proposed/rejected links, actual last_seen/updated_at refresh and6 distinct canonical cards despite duplicate offers. Public inactive/latest-withdrawn group remains absent. No public feed row cache to invalidate; existing estate-option/promotion-capability caches unchanged.
- npm run test:listing-priority exit0 36/36 PASS at working tree basedf095848; actual SQL executes in PGlite, not a production database claim. Public verifier tests2/2 PASS. Exact private ZIP request hash and three sale sample mappings verified again (3/3, actual writes0); original timestamp retained.
- Read-only live HTTP at2026-10-01T05:02Z: base domain308 to https://www.earnestproperty.com/. RED reproduced verifier rejection, then restricted redirect handling to this exact first-party HTTPS origin and unchanged path/query with one hop. External/authenticated/different-path redirects rejected.
- Current homepage HTTP200/HTML/brand verification PASS at05:04:04Z. detailsVerified=0: no newly published production aliases available, so no claim of sample publication/photo/price/detail acceptance.
- In-app browser twice failed before opening a tab (Windows sandbox deny-read ACL/kernel initialization). Desktop/mobile rendered live screenshots BLOCKED_EXTERNAL; HTTP checks cannot replace them. No production mutation or blind crawler.
- T5 code and offline regression READY; sample live qualification and rendered UI VERIFICATION_BLOCKED. These unchecked plan steps remain in the denominator.

## T6 access decision

- Detailed access evidence and branch matrix: propertyhk-access-verification.md. Actual single normal detail request403/challenge; no bypass. Exact branch URLs/SID/dt scope, real selectors, ID grammar and media rights remain BLOCKED_EXTERNAL.
- RED example had no explicit Property.hk publication disable; GREEN source configuration test PASS and full Python80/80 exit0 at working tree based98f843c. Operator sample config remains non-live; no production change.
- Existing transport and managed server policy retained. No new provider/API invented. T6 local configuration/access report complete; external contract and authentic fixtures remain unchecked.

## T7 full branch contracts / isolated recovery

- RED3/11 after correcting a mutable fixture alias: full non-absence Property.hk manifest rejected; omitted EPS page1 accepted; baseline helpers28Hse-only. Additional dual-offer RED and server-side rejected-detail/branch-collapse RED reproduced real missing guards. GREEN Python92/92, Node ingestion73/73, daily30/30, exit0 (base7f7189b).
- Added structural page1-to-terminal accounting for each branch, detail rejection blocks entire Property.hk business apply, stable merged inventory cannot conceal a branch drop>30%. Server baseline branch counts come from immutable observations of the accepted full receipt (including merged memberships/occurrences), never changing current source rows.
- Existing atomic Neon suite26/26 PASS after strengthening its Property.hk URL-mismatch case from partial_success to a rejected transaction plus unchanged receipt count. Its old partial acceptance no longer meets the new explicit3/3/zero-partial-business-write requirement; retained original title/baseline preservation assertions. New focused real SQL branch-collapse/replay/rejected-detail test1/1 PASS,0 SKIP,16.7s, using dedicated disposable DB and isolated schema. First focused fixture used a future date and hit invalid_timestamp; moved synthetic fixture dates into the past to reach the intended gate. No ZIP timestamp changed.
- Source-specific baseline paths/latest archive selection separate Property.hk from28Hse. Manifest records derived branch page/count summaries and accepts full Property.hk with absence=false. Global equal-content branch sightings merge provenance; verified configured dual-offer values split sale/rent identities, amount parsing remains separate. No live offer labels/selectors invented.
- Automatic review rejected an earlier command because it believed it could truncate an existing test; no action executed. Safer separate explicit fixture file added, original suite preserved apart from the bounded stronger rejection assertion described above.
- Existing HTTP/robots/origin/size/max3 retry guards retained. All added fixture HTML is explicitly synthetic. Authentic three-branch parsing/fresh dry-run remains BLOCKED_EXTERNAL; no new baseline in production and no Property.hk absence activation.

## T8 source-aware publication / canonical consistency

- RED parser publication contract, missing verified ID scope, explicit bridge source selection and equivalent-secondary decisions reproduced. GREEN Python93/93; ingestion75/75; daily34/34; media/legacy source/selection/source-policy94/94, all exit0 at base6b3b58a plus T8 working changes.
- Protected server policy required before Property.hk media: fixed merged scope, owner/parser/id_scope, verified URL grammar, rights and exact host allowlist. Only literal description/photo selectors with explicit rights flags return content; unverified defaults empty/held. Legacy source codec and writer were not activated or generalized.
- Exact identical Property.hk-only advertisements can share one canonical under versioned equivalent_propertyhk_v1 consistency across all projected fields and lifecycle. Different fields, missing exact identity or an existing primary relationship retain review. Preserved primary priorities and lifecycle; no cross-offer merge. Original atomic DB test assertions preserved.
- Real SQL + synthetic DNS/HTTP/Blob: first import two equivalent ads -> one canonical -> exact replay -> one owned-photo upload/publication -> replay no uploads -> next full ingestion retains UUID/public alias/content. PASS1/1,0skip15.5s. Existing audited28Hse publication PASS1/1,35.2s; next-ingestion preservation PASS1/1,10.9s. Source-aware query initially referenced a non-existent state field; corrected to immutable observation payloads. Duplicate canonical candidates initially retried same row; now deduplicated before media.
- Original full atomic Neon suite26/26 PASS,0skip319.1s after retaining same-source twin review when primary exists. First run24pass3fail included parent/dependent failures from overly broad equivalence; fixed protection and reran original unmodified assertions.
- Environment: dedicated disposable branch br-young-breeze-ao85rtx1 / earnest_audit_acceptance_20260927, isolated schemas only. Synthetic provider/media evidence is not live Property.hk evidence. No production policy, migration, apply, schedule or message. Live first baseline/config and independent schedule remain BLOCKED_EXTERNAL until T11-B gate.

## T9 admin sync visibility / controlled operations

- RED missing repository4/4 reproduced; GREEN portable role/health/dispatch contracts7/7 plus callback/workflow boundary7/7. Dedicated Neon migration/reader/metadata/direct DB role denials/reservation dedupe/terminal protection/stale/keyset PASS1/1,0skip15.2s. Managed workflow capability defaults disabled; no provider call or production DDL.
- Added metadata sidecar property_sync_runs referencing existing ingestion receipts, bounded25/max100 keyset history and indexes. Original receipts remain read-model fallback, so missing callbacks do not erase accepted ingestion. Unknown dispatch and never-started reservations do not claim collection success. Reporter is isolated, disabled by PROPERTY_SYNC_OBSERVABILITY_ENABLED until migration, exact main/DB-host checked; no source fetch in reporting/retry.
- Admin/manager global read; agent global access rejected before DB/provider. Existing per-property source detail remains scoped. Only admin can dispatch one allowlisted existing28Hse workflow/main; frozen replay asset selected by server row. One active source request + per-actor rate limit + idempotency + audit. HTTP204 means accepted only; timeout/5xx remains unknown and requires reconciliation.
- Added Hong Kong Traditional Chinese route /admin/property-sync, four cards, independent timestamps/stages/counts, held/errors, diagnostics expansion, pagination and disabled capability explanation; navigation/listing entry preserved existing routes. Generated route tree using TanStack generator with existing Start Register footer. Initial generator invocation omitted plugin footer and produced cascading type errors; corrected generator configuration, full tsc exit0 (no source suppression).
- Synthetic actual React/CSS Chromium journeys14/14 PASS at1440/390px, first/loading/empty/read failure/denied/admin/manager/retry/doubleclick/unknown/long history; provider requests0/DB writes0. Separate from live auth proof. Mobile screenshot reviewed for overflow and labels.
- Measurement:1001 synthetic metadata rows,7 iterations, HTTP Neon full workspace p50=366.7ms/p95=713.4ms in first sample, bounded indexed history EXPLAIN saved privately. Later repetition recorded separately; these are environment-specific measurements, not a production latency guarantee.
- New migration20261001120000_property_sync_operations.sql registered in migration-versions.js; applied only inside disposable random schema. Live auth/workflow-only managed token/evidence destination/migration/deploy remain external release gates.


## T10 withdrawal review verification

- Versioned review-withdrawal-v1: historical absence remains NOT_APPROVED without two accepted full observations at least24h apart, fresh collection, native collection/ingestion coverage and no failed/unknown interval. Explicit sold/rented evidence remains separate. Property.hk absence stays disabled. No automatic withdrawals.
- Bounded25/max100 explicit selection,15min preview, actual DB roles, source fingerprints, current group versions, per-item savepoints, idempotent batches and read-only unknown-outcome reconciliation. Existing admin_property_manage performs inactive mutation and persistent override; no inventory/link status replacement writer. Restore requires a new reviewed property-management operation.
- RED: expired preview incorrectly used the Node clock; now authoritative DB clock_timestamp rejects expiry. Pagination filtered before its lookahead boundary could repeat a candidate; new positive regression reproduced then corrected.
- GREEN: node --test src/lib/mls/withdrawal-review.test.mjs exit0,5/5 PASS. Disposable Neon withdrawal-review.db.test.mjs exit0,1/1 PASS/0skip,117.4s, synthetic fixtures in random schema. Includes direct agent role forgery denial, expiry, manager conflict/partial result, exact duplicate, real two-client competition, lost COMMIT acknowledgement, actual public-query disappearance, source reactivation conflict and next-ingestion override retention. Canonical UUIDs/public aliases remain stable.
- Actual local React/CSS Chromium desktop1440/mobile390:26/26 PASS, including cancellation0writes, invalid reason, partial results, doubleclick once, expired preview, agent denial and read-only timeout reconciliation. All provider traffic blocked; synthetic browser evidence is separate from live authenticated UI.
- Full tsc --noEmit exit0; git diff --check exit0. New20261001130000_property_withdrawal_review.sql registered; only disposable random-schema DDL applied. Old applied migrations unchanged. PROPERTY_SYNC_WITHDRAWAL_REVIEW_ENABLED defaults false pending reviewed production migration/deploy/activation.
- No production withdrawal, config change, messages, migration or deployment.132 ZIP candidates remain unapproved; actual original-ZIP replay and production live acceptance are recorded separately in T11.


## T1 retention completion follow-up

- RED4 missing retention preview/apply behaviors; GREEN4/4 pytest PASS, full Python suite97/97 PASS exit0 basedcd320a0. Private destination/capability, complete pagination, immutable metadata identity,1h review expiry, exact selected IDs, changed pins, duplicate assets and unknown DELETE acknowledgement covered.
- Added evidence_retention.py: preview default, reviewed explicit apply gate, immediate per-asset readback/revalidation, durable UNKNOWN before request, stop-on-failure and read-only reconciliation. All accepted histories, handoffs/unresolved run objects and explicit pins protected.7/90-day minimum ages apply to unpinned objects; conservative accepted history retention may exceed these ages.
- No remote release mutation; synthetic delete port only. Private repository/token live gate remains BLOCKED_EXTERNAL. Existing production baseline unchanged.


## T11 final rehearsal and release preparation

- Exact privateZIP request SHA checked before disposable DB fixture; original scraped_at2026-10-01T02:50:22.963602Z unchanged. Original10min test runner cancelled at600s despite completing data assertions/cleanup; corrected this first286-ad import regression timeout to20min, not production job limits. Finalnode --env-file=.task-logs/.env.test-target --test --test-concurrency=1 src/lib/mls/original-28hse-evidence.db.test.mjs:exit0,1/1PASS/0skip,611.8s.197syntheticfixturecanonical/286observations/284links/1receipt/inactive0; secondexactbytes replay identical, UUID/publicaliases/counters unchanged. Three specified mappings correct. Productionwrites0; fixtures are not authoritative production mappings.
- Historical-withdrawal.db.test.mjs:exit0,1/1PASS/0skip,7.0s. Actual132syntheticactivehistorical rows/source links,100+32keysetpagination,allNOT_APPROVED,forcedapplyblocked,actualinactive0,UUID/aliases/linkstatus preserved. Fixtures use one full receipt with no secondcompletecoverage; production132candidates untouched.
- Newmigration tool RED2missingbehaviors→GREEN2/2unitPASS; exacthashes/dryrun0DB,actualserverbranch/prerequisiteguard,transactionlock,alreadyappliedduplicate,DDLrollback/COMMITunknown. ActualtwoDDLfiles were previouslyvalidatedrandomschemas inT9/T10. Production --apply notrun.
- Finalportable npm suites exit0:ingestion75/daily35/admin9/withdrawal5/release2/listingpriority36/listingsearch91Node+12Bun/media5; Python97; fulltscexit0. CIwiresnewportable/UI/Pythongates anddedicatedmanualguardeddisposableDBworkflow, no productioncredential/fakeSKIPPEDPASS.
- Newacceptance report retains19case denominator:13isolatedPASS/6requiredliveBLOCKED_EXTERNAL. A/B/Csafeimplementation READY;livejourneys VERIFICATION_BLOCKED;3scheduled0/3MONITORING. Recovery/SMEfivesteps/config/migration/sourceactivation/rollbackrunbookprepared.
- Freshremote read stillmain e8997f2 andPR207OPEN/DRAFT/unmerged,head1e2a345; preserveancestry/rootedits. No merge/deploy/productionmigration/dispatch/config/messages/remoteevidencedelete.

- Browser final rerun initially timed out at firstlocalhost navigation30s afterVite dependency reoptimization. Added bounded request-failure diagnostics, then warmcache26/26PASS andforcedcold dependency reoptimization26/26PASS, exit0. Failure could not be reproduced in either controlled rerun; no productroute/timeoutclaim orremoteproviderproof inferred. Diagnosticprobe retainedforCI; firstfailurelog remainsprivate.
- Finalactualproductionread-only migration --check PASS: expecteddirecthost/neondb/serverbranch br-polished-sea-aom4i1ct andfivecoreprerequisitesverified; twoaddedmigrationspending,applied[]. Refreshedauthority unchangedreceipt60895ce3/279ads/hash6c6db71a. No productionDDL/DML. Finaldisposable readback properties0/customschemas[] afterallfixtures; actualguardbeforequery.

- Build npm run build exit0 (serverbundle50.7s; normalthirdpartyuse-clientwarnings). Initialwhole-repolint27errorscameonlyfromignoredlocaltask/syntheticentry/venvgeneratedfiles; preciseartifact-directoryignoresadded without weakeningapplicationrules. NewUIhooklifecyclesuse stableloadrefs/callbacks andinvalidateoldgeneration oncleanup. PostfixscopedESLint0errors/warnings, fulltsc exit0 andsyntheticbrowser26/26PASS; existingunrelatedWhatsApprefreshwarningsunchanged.


## PR208 cross-platform CI checksum correction

- FirstCIrun36833069630 failed atnewmigrationrelease2tests (MIGRATION_BYTES_CHANGED onLinux). LocalSQLhad54/115CRLF;Gitblobhad0. AddedGitblobbytecomparisonregression: RED1/3 locally,prior2green. Fixonlynewnot-yet-appliedmigrationpathswith.gitattributes eol=lf; hashesnow349af4a3d84122be226d19028b54451b7d5b8f4e822b7f3d42eaea7160f66c64 /ba68aaea2975c6c22e41997236c0fe7d3e96d2b3bcf1490223018bfbbd7c4e19. Appliedoldmigrationsandraw/requestevidencebytesunchanged. NewDDLsemanticsunchanged;isolatedDDLtestsremainapplicable.
- GREENnode --test scripts/mls/migrate-sync-operations.test.mjs3/3PASSexit0; dry-runchecksGit-compatiblebytes. Whole-repolint0errors/3existingunrelatedwarnings,tsc/UI26PASS afterhooklifecyclecleanup. RemoteCIrerunwillverifyLinuxactualcheckout; no productionmutation.


## PR208 navigation regression follow-up

- SecondLinuxCI36833689156 passed lint/build/typecheck andALLnewsourceportable/UI/Pythongates; threeothernonstagingjobsPASS. Latercommand-centerfailedatfixedsidebarcount16vsnew17. Reproducedlocally; updatedapprovednavigationexpectationto17andpositivelyassertsource-synclabel/EDITORSroles. Originalno-duplicatedestinationsandallgroup/legacybugchecksremainintact; noCRM/providerproductioncodechanged.
- GREENnpm run test:command-center exit0,82Node+8BunPASS/0skip. Source-sync route staysadmin/manager; mutationpermissionboundariesunchanged. Focusedtest-onlyfollowupcommit;newCIrerunrequired.


## PR208 CI environment-dependent test wiring

- ThirdCI36834351380 passedpreviousfixes/newsourcegates/CommandCenter/nolink,thenexistingtest-wiringmisclassifiedthreeNEW:dbsuitesasportable. Explicitenvironment-dependentregistrationadded; ordinaryCIstillrequiresALLdeterministic scripts. Admin/withdrawaltestsremainwiredtoguardedmanualdisposableworkflow.
- Addedpositiveprivate-regressionCIentrypointtest: REDmissingprivatejob; GREENnpm run test:control-plane105/105PASSexit0,0skip; daily+wiring16/16PASS. Optionalprivate_regressionrequiresfourdisposablegroupsfirst,private-onlyreadtoken,approvedprivateexactassetname,size414631/SHAcheck BEFOREfixturewrites andactualdisposableguard. Ituploadsnoartifactandusesnoproduction/Blob/providercredential.
- No privateassetupload/tokenconfig/manualCI dispatch performed. OptionalprivateCIgate isUNRUN/BLOCKED_EXTERNAL untiloperatorprovidesmanagedreadcapability/exactasset; originallocalZIPDB1/1PASS remainsseparate. Runbooklistsgate andproperSKIPPED/failclosedsemantics.


## PR208 daily cron serialization compatibility

- Fourth Linux CI run 36836152284 passed all added source-sync gates and three non-staging browser/DB jobs, then failed the original job-wake schedule assertion. Local RED: npm run test:job-wake exit1,16/17 PASS,0skip. YAML serialization omitted quotes around the unchanged cron string. Restored its original quoted form; no schedule, gate, permission or unrelated cron changed.
- GREEN: npm run test:job-wake exit0,17/17 PASS/0skip; npm run test:property-sync:daily exit0,35/35 PASS/0skip. Original test assertions preserved. New hosted rerun required.


## PR208 staff FK guard parser follow-up

- Proactively ran the 16 later ordinary CI suites before another hosted attempt: 15 exited0; property-experience exited1 (145/146) because the migration scanner assigned the first UUID on a compact multi-column line to a later staff FK. New compact fixture RED reproduces both false row-identity attribution and missed second FK. Corrected scanner to resolve each comma-delimited UUID declaration and reject any unresolved reference, with two positive regression cases. Original ownership/history classification and seven-column handover lists unchanged; new withdrawal actor_id remains immutable historical attribution. No migration bytes or application writer changed.
- GREEN: node --test src/lib/neon/staff-ownership.test.mjs exit0,8/8 PASS/0skip; npm run test:property-experience exit0,148/148 PASS/0skip; scoped ESLint exit0 and git diff --check exit0. Other later ratelimit/team/content-copilot/live-agent/admin-properties/cms/youtube-sync/migration/mls:cloudflare/transactions/estate-reviews/valuation/admin-estates/legal/analytics suites exit0. Logs retained privately; repeated suites are not new unique coverage.


## T9 / T11 follow-up: public verification outcome must have execution proof

- HEAD reviewed: 0cfb784; PR207/208 remain OPEN/DRAFT, latest prior hosted CI all four non-staging jobs PASS. Read-only GitHub refresh confirms private evidence repository/token and optional disposable/private CI configuration still missing. No production actions.
- Finding: the always-run verify job can succeed after producing only its safe summary when publication failed or was skipped (including shadow). executionSummary previously promoted that native job success to public verification success despite no HTTP check. RED: four new positive regressions failed; combined targeted run8PASS/4FAIL/0skip, exit1.
- Fix: the real HTTP-check step emits public_verified=true only after verify-sync-publication succeeds inside the publication-success branch. The native job exports that exact output. Summary-only success leaves verification pending/no completion timestamp; successful publication without proof is unknown; failed checks and publication unknown cannot be promoted. This proof records HTTP verification only, not live browser/photo/full-production acceptance. Failure health is not masked by an artificial blocked verification stage.
- GREEN: actual Git Bash execution of the workflow step with synthetic gh/node ports exercises skipped publication, failed publication, checker exit1, and success; only success emits proof. Daily37/37, admin12/12, job-wake17/17 PASS/0skip, scoped ESLint exit0. No DB/Blob/provider operations in this fix; existing live acceptance denominator and0/3cycles unchanged. New hosted CI rerun required.


## T9 follow-up: timeout dispatch 唯讀核對及重新載入恢復

- Reviewed parent HEAD: af5d33760c4a66389b771ce01c0d7a2eb9086072. Finding: timeout 把頁面鎖在 uncertain；重新讀取同步紀錄不會清除鎖，整頁 refresh 也會遺失原 idempotency key。Focused commit 為本節所在 commit（git log -- docs/reports/2026-10-01-full-sync-implementation-status.md）；精確 SHA 與 hosted CI 在 PR208 記錄。
- RED：新增三個正向 unit cases 因 readSyncOperationResult 未實作失敗；actual React/CSS browser 因缺「核對工作流程結果」按鈕失敗。自審再加 incomplete stages 回歸，6PASS/1FAIL/0skip，證明僅有 collection 與 finished_at 不足以解鎖。錯誤紀錄保留在 private task logs。
- Implementation：GET server function 由 verified session 取 actor；raw SQL 重新核對 active staff/admin role，查同一 requested_by/idempotency_key，不接受 client actor。原 key 在 POST 前保存至按已核實 user 分隔的 browser-tab sessionStorage；refresh 保持鎖。只有確定 provider rejection，或完整四階段 native 終結紀錄（成功 ingestion 必須匹配 actual full receipt/source/scope/hash）才解除 uncertain。accepted、缺 callback、缺 stage、unknown/running phase、缺 receipt、查詢失敗均不升級。
- GREEN（working tree based af5d337，Windows Node24，2026-10-01）：npm.cmd run test:property-sync:admin exit0，15/15 PASS/0skip；npm.cmd run test:property-sync:daily exit0，37/37 PASS/0skip；npm.cmd run test:property-sync:ui exit0，30/30 synthetic PASS，1440/390，providerRequests0/databaseWrites0。Browser covers timeout、未知結果不解鎖、同 key、整頁 refresh、double click 只查一次、confirmed 結果解鎖及清除 tab key；refresh 後 POST 次數0。
- Real SQL：node --env-file=.task-logs/.env.test-target --test --test-concurrency=1 src/lib/mls/sync-run-repository.db.test.mjs exit0，1/1 PASS/0skip，13.9s；helper 在 fixture 前驗 project dawn-meadow-79190048／disposable br-young-breeze-ao85rtx1／endpoint ep-square-leaf-aobruyvf／dedicated earnest_audit_acceptance_20260927。BEGIN READ ONLY 內確認結果及 duplicate readback；other admin 不可讀原 actor 的 key；偽造 admin 的 manager/agent 被實際 DB role 拒絕。Partial metadata 先確認不解鎖，四階段 callback 後完成；publication unknown 又保持鎖。Provider dispatch 計數始終1，fixture 最後清理。
- Full typecheck exit0；scoped ESLint exit0/0warnings；git diff --check exit0；npm.cmd run build exit0（client 2m26s、server 1m23s，現有第三方版本／chunk warnings）。第一次 DB readback PASS 後加嚴四階段 proof，舊三階段 fixture 的 completion assertion 失敗；保留該 log，補成先驗 partial 拒絕再驗完整 callback，未放寬 production guard。
- Migration/config：無新增或改動 migration／hash；off-default flags 不變。Readback GET 本身不 reserve、UPDATE、dispatch 或 reconcile-write。沒有 production DML/DDL/config/deploy/merge/provider request/message。無 native callback 的歷史 unknown reservation 仍需 operator 提供 native evidence；不假裝自動核实。Live auth/managed token/private baseline/Property.hk/3scheduled cycles gate 仍 BLOCKED_EXTERNAL；19case 分母、13isolated PASS/6live blocked、0/3 MONITORING 不變。


## T9 follow-up: 最後成功上架與最新故障分開顯示

- Reviewed parent HEAD: dfaa0c184e49d1eb2ae440de90c64ffab2ff61aa；fresh main仍e8997f2，PR207/208仍OPEN/DRAFT、207未合併。Commit為本節所在focused commit；exact SHA與hosted CI在PR208記錄。Root修改與原bun.lockb mode差異未動。
- Finding 1（T9/C06）：來源卡只從最新run取lastPublishedAt；新failed/cancelled/unknown/pending run會清空之前已成功的時間。Unit RED7PASS/1FAIL、actual disposable SQL RED1FAIL、actual React/CSS browser RED「未有紀錄」取代已知日期，全部保留private logs。
- Finding 2（T9/C02/C05）：requestSyncOperation把definite rejection存為dispatch_status=failed及finished_at，但讀模型忽略此狀態；刷新變healthy，history也未顯示failure。Unit RED8PASS/1FAIL、real SQL REDhealthy≠failed；先修read model後browser RED card1條failure、durable history缺第2條。
- Fix：同一讀取query用source-scoped lateral LIMIT1查最近有成功publication狀態/完成時間的run，沿既有indexes，沒有增加web→DB round trips或掃raw evidence。最近run仍控制failed/unknown/stale狀態，歷史成功不洗成healthy。Definite rejection有finished_at才顯示failed，未完整保存維持unknown；history同樣顯示失敗/待核實。沒有frozen request的已拒絕提交明示請管理員核對接駁後重新提交；額外browser RED0≠1先重現，未提示重播不存在的本輪證據。空紀錄copy改為完整匯入及上架分開核實，不把receipt當公開證據。無新writer、migration、config或framework。
- GREEN（Windows Node24、working tree based dfaa0c1）：npm.cmd run test:property-sync:admin exit0，17/17PASS/0skip；npm.cmd run test:property-sync:daily exit0，37/37PASS/0skip；npm.cmd run test:property-sync:ui exit0，32/32syntheticPASS，1440/390，providerRequests0/databaseWrites0；npm.cmd run typecheck與scopedESLint exit0/0warnings；git diff --check exit0。Browser由actual readSyncWorkspace生成fixture回傳，刷新後保留日期與rejection，來源卡及history都有failure、無overflow、沒有提交request。手機截圖已自審。
- Real SQL：node --env-file=.task-logs/.env.test-target --test --test-concurrency=1 src/lib/mls/sync-run-repository.db.test.mjs exit0，1/1PASS/0skip、18.2s。Shared guard先驗disposable br-young-breeze-ao85rtx1／endpoint ep-square-leaf-aobruyvf／dedicated earnest_audit_acceptance_20260927；synthetic native metadata fixtures及fake dispatch port，不是provider proof。BEGIN READ ONLY核對manager refresh、三種新故障不清空舊pub日期、Property.hk無來源洩漏、definite rejected operation的DB保存/readback；accepted_at改成31h後仍stale，日期不洗白。既有RBAC/duplicate/receipt/unknown tests全部保留。
- EXPLAIN ANALYZE/BUFFERS及1003rows/7次whole-workspace讀取：p50=316.4ms、p95=397.3ms（本機→disposable Neon），lateral讀取使用既有history index並只回1row/source。不是production latency保證，沒有加index migration或改pagination上限。
- 保留一次首個localhost navigation30s timeout；diagnostics顯示CSS/dev compilation仍未完成。未宣稱根因已修或放寬timeout/斷言；無改動重跑32PASS，後續文案/拒絕history修正後亦32PASS。首次加入lateral LIMIT1時舊test helper假設所有LIMIT都有params，曾1FAIL；僅令它容許無params的固定LIMIT1，原parameterized history limit26/assertions保留。遠端Linux CI需確認，不把rerun重疊case加為新UC。
- Read-only GitHub config refresh：private evidence repo/token仍未配置，observability及manual disposable CI旗標未啟用。Production DML/DDL/config/dispatch/deploy/merge/messages0；兩個既有新增migration仍pending，原ZIP/request/raw hashes及scraped_at不變。Private baseline、Property.hk real contract、live auth/release/E2E及3cycles外部gate保留；13/19isolatedPASS、6/19liveBLOCKED_EXTERNAL、0/3MONITORING不變。


## PR208 T9 timezone regression follow-up

- Linux CI36871635624/9671e9b：三個nonstaging sibling jobs及Vercel SUCCESS，main ci在新增UI日期assertion失敗，product09:00／test01:00。Root cause：product既有date formatter明確Asia/Hong_Kong；新test expectation漏timezone，Windows HK暫掩蓋此錯，Linux UTC重現。不是product應改為runner時間。
- 在Windows test browser固定timezoneId=UTC，未改expectation先跑：RED同樣09:00≠01:00，exit1；保留fixture日期/refresh/status/nextstep/assertions。只修reference formatter為明確香港時間，UTC browser context繼續保留作正向跨時區回歸。
- GREEN：npm.cmd run test:property-sync:ui exit0、32/32syntheticPASS/0skip（1440/390、UTC context，顯示Hong Kong agency time）、providerRequests0/databaseWrites0；scoped ESLint/git diff check exit0。Product code、migration、private原bytes/metadata及所有限時不變，不再跑無關DB/ZIP。Exactfollow-upcommit及新hosted CI在PR208；失敗run仍保留。


## T10 follow-up: 撤盤未知提交在整頁刷新後可唯讀恢復

- Parent HEAD `3d4f70d5f3315d25585ca80baaed162a4502a6e7`；remote main仍e8997f2，PR207未合併，PR208原exact-head CI全綠。Finding（C03/C04/C05/C06）：撤盤submit timeout只在React memory保存key；整頁reload後核對按鈕消失，原unknown鎖定丟失。RED：actual React/CSS browser count0≠1，exit1，未改原assertions。
- Fix：送出apply前將原UUID key與source保存到按已核實user分隔的browser-tab sessionStorage；route按user remount，reload恢復來源與待核實鎖。核對只用原key走既有authenticated readback；confirmed才清除key及解除鎖，unknown不清除。保存失敗、缺已核實actor或非法pending紀錄阻擋新mutation；不保存樓盤payload、reason、secret。Candidate／preview／apply／source操作全部保留權限與unknown鎖。
- GREEN（Windows Node24，working tree based3d4f70d）：npm.cmd run test:property-sync:ui exit0，42/42synthetic PASS／0skip，1440/390、UTC browser；providerRequests0/databaseWrites0。新增reload後POST0／samekey GET／doubleclick核對1次／confirmed清除／unknown保留來源及key／另一actor不繼承／儲存失敗0apply／壞紀錄鎖定；其餘32 journeys保留。Mobile截圖自審無overflow。首次34case已PASS；擴展fixture曾碰腳本變數同名syntax error，改測試local名稱後42PASS，未放寬產品或assertions。
- Real SQL：node --env-file=.task-logs/.env.test-target --test --test-concurrency=1 src/lib/mls/withdrawal-review.db.test.mjs exit0，1/1PASS、0skip，112.9s。Shared guard核實disposable br-young-breeze-ao85rtx1／dedicated earnest_audit_acceptance_20260927。在lost COMMIT acknowledgement後，BEGIN READ ONLY內直接核對同keyconfirmed及duplicate、另一manager只能unknown/results[]、不存在keyunknown、agent forged manager由actual DB role拒絕；batch數不變。原TTL／partial／source/staff race／two-session競爭／idempotency／public readback/next-ingestion保護全部保留，無server writer改動。
- npm.cmd run test:property-sync:withdrawal exit0、5/5PASS/0skip；npm.cmd run typecheck exit0；scopedESLint exit0/0warnings；git diff --check exit0。Read-only final cleanup確認actualdatabase/branch、public.properties0、sync_ops schemas[]。
- 無migration/config改動，無production DML/DDL／dispatch／deploy／merge／messages；132正式候選未apply、Property.hk absence off。19case=13isolatedPASS/6requiredliveBLOCKED_EXTERNAL，scheduled0/3MONITORING維持。Focus commit為本節所在commit，exact SHA/hosted CI另記PR208。Local author self-review；按使用者單一agent指令不委派。


## T9 follow-up: browser 保存失敗不能送出無法恢復的同步

- Parent `ba203859e4865404d6ead016de0e5384a48600ab`。Finding（C02/C05/C06）：既有preservePending吞掉sessionStorage exception，仍送出request；reload失去key而不能唯讀恢復。非法舊key也被忽略，UI允許新operation。RED：actualbrowser禁用此key的Storage.setItem後synthetic request仍1≠0，exit1；不改dispatch成功或未知狀態assertion。
- Fix：admin恢復pending紀錄完成前鎖mutation；缺已核實actor、保存/讀取失敗或非法key鎖新dispatch/replay並明確說明。先確認sessionStorage保存成功才request；known結果清除key失敗時保留原key及unknown，讓同keyreadback核對，不猜測或新reserve。Manager正常唯讀不要求mutation storage。既有server active-role/dedupe/rate/audit/四階段proof完全不改。
- GREEN（Windows Node24，working tree basedba20385）：npm.cmd run test:property-sync:ui exit0，46/46synthetic PASS、0skip，1440/390 UTC context，realReact/CSS；新增storage failure0request及invalid prior key鎖定，其餘42 journeys保留。npm.cmd run test:property-sync:admin exit0，17/17PASS/0skip；npm.cmd run typecheck exit0；scopedESLint exit0/0warnings；git diff --check exit0。T9無DB/provider寫入，未重跑無改動的12分鐘ZIP；本turn T10 actualSQL1/1PASS/0skip及清理證據獨立記上一節。
- Focused commit為本節所在commit；exact SHA/new hosted CI另記PR208。無新migration/config，未production DML/DDL/dispatch/deploy/merge/messages；原兩migration仍pending、PR207未合併。13/19isolatedPASS＋6/19requiredliveBLOCKED_EXTERNAL；scheduled0/3MONITORING。Recovery runbook已補browser storage gate及operator唯讀恢復。


## T10 follow-up: 失敗與未解決 run 不能充當有效缺席區間

- Parent `a1abaf031e1d702ba52e903ee82d3df5c35c240b`。Finding（C03/C04/C05）：context只看stages失敗及started_at≥較早receipt.accepted_at，漏掉definite rejected dispatch（failed/finished_at但stages={}）、跨首輪觀察的失敗、較早開始仍未解決run、以及採集後/延遲receipt之前的失敗。
- RED actual disposable SQL：新增definite rejection後preview仍allowed=true，true≠false、exit1，87.1s。PGlite實際執行service傳出的failure query（其他staff/receipt/property reads用明示synthetic ports），12nodes=7PASS/5FAIL，其中4種不安全區間子案例失敗、parent失敗；兩個control仍PASS。不是只對SQL字串做assertion，也不是full Neon integration。
- Fix：以較早原scraped_at界定缺席區間，查failed/unknown dispatch、stage failure及所有未終結run；started或finished落在區間、或未終結的重疊run均阻擋。完整終結且在兩次observations之前的舊failure、其他sourcefailure不阻擋。Apply沿既有preview evidence fingerprint及current recheck，definite rejection出現後舊preview blocked/actual property仍active。
- Ruling：這是review-withdrawal-v1承諾「原採集觀察且無失敗/未知區間」的實作修復，維持ruleversion及既有writer，不是調整24h/36h/Property.hk absence policy。較早開始但未解決的run不能因時間窗移動而被洗成成功；成本是保守hold，operator先核對/補native終結證據，沒有自動清reservation或改baseline。
- GREEN（Windows Node24、working tree baseda1abaf0）：npm.cmd run test:property-sync:withdrawal exit0、12/12PASS/0skip（6top-level+6subtests，不能當12獨立UC）；node --env-file=.task-logs/.env.test-target --test --test-concurrency=1 src/lib/mls/withdrawal-review.db.test.mjs exit0、1/1PASS/0skip、122.0s。Actual SQL驗definite rejection、舊preview重新阻擋、cross-boundary、oldunresolved、collect→accepted delay及區間外control；canonical/public aliases、inactive override、role denial、TTL、partial、two-session競爭、duplicate、lost COMMIT readonly recovery、next-ingestion保護全部保留。
- Full typecheck/scopedESLint/git diff check exit0。沒有新migration/config或writer；132正式歷史候選未apply，source lifecycle/links不變。UI繁中label回歸獨立IN_PROGRESS；兩次loopback first-page30s startup timeout保留，未放寬timeout/assertions。Neon connector finalreadback曾522；使用已核實dedicated連線先SELECT核對actualdb/branch再唯讀readback：earnest_audit_acceptance_20260927/br-young-breeze-ao85rtx1、properties0/sync_ops schemas[]。無新增fixtures來掩蓋清理失敗。
- Focus commit為本節所在commit；exact SHA/new hosted CI記PR208。13/19isolated PASS、6/19required liveBLOCKED_EXTERNAL、0/3scheduledMONITORING維持；productionDML/DDL/config/dispatch/deploy/merge/messages0。

## T10 follow-up: 繁中核實狀態與可重現 UI fixture

- [x] C01/C03/C05 日常撤盤候選顯示香港繁中「待逐盤核實／未獲批准，暫不下架」；原 REVIEW_REQUIRED／NOT_APPROVED 留在預設折疊的「來源及版本」diagnostics。未知 approval 文字保守顯示待核實；只改 copy，不改 decision.allowed、DTO、角色或 apply gates。
- Parent `86c9a2602d7f001113e129c86525fbe60f9d6b32`。RED actual React/CSS browser：中文 blocked label count0≠1，exit1。GREEN 前兩次 Vite dev-server fixture 都在 first-page.goto30s timeout；diagnostics 顯示 HTML/JS/CSS transform 延遲。保留兩份失敗 log，不視為產品互動 PASS，也未證明正式站 startup 根因。
- [x] Harness 改為先 fresh Vite build 真實 TSX/CSS，再由 loopback preview 提供本次 compiled HTML/assets；installed Vite7.3.6 API 的 build/preview/PreviewServer.close 已核實。configFile/envFile=false、output 在 ignored .task-logs/sync-ui/dist、emptyOutDir=false，不讀 app env、不遞迴刪除、不調 provider。無依賴 dev optimizer cache；原 30s page timeout、UTC browser context、46 cases 與 storage/role/unknown/refresh/雙擊/取消/invalid/stale assertions 完全保留。此調整隔離 fixture bootstrap，不能替代 live auth/NFR 驗收。
- GREEN（Windows Node24、working tree based86c9a26）：`npm.cmd run test:property-sync:ui` exit0，46/46 PASS、0skip，fixtureMode=built/freshBuild=true，fresh compile38modules/5.46s、1440/390；providerRequests0/databaseWrites0。新增中文 label count 與 raw diagnostics 隱藏→展開 assertion，原46 journeys分母不增加。最新390px timeout-reload截圖已自審，labels/unknown鎖無overflow。`npx.cmd eslint scripts/test-property-sync-workspace.mjs src/components/admin/property-sync/WithdrawalReviewWorkspace.tsx` exit0/0warnings；`git diff --check` exit0；本turn full typecheck 已exit0。Logs：withdrawal-approval-copy-red.log、withdrawal-approval-copy-ui-green.log／-retry.log（兩次FAIL）、withdrawal-ui-fixture-build-green.log、withdrawal-ui-fixture-build-lint.log，均private ignored。提交前格式檢查曾因手動span換行觸發Prettier，另有docs末尾多餘空行；按formatter要求修正後重跑，原FAIL log另保存withdrawal-ui-fixture-format-failure.log。
- 前節 UI IN_PROGRESS 現在完成；故障區間修復已在86c9a26提交。此 focused UI/test/docs commit 的 exact SHA 與 Linux hosted CI 後續記 PR208。無新migration/config、無production DML/DDL/dispatch/deploy/merge/messages；19case=13isolatedPASS/6requiredliveBLOCKED_EXTERNAL、0/3scheduledMONITORING不變。Local self-review，按使用者 single-agent要求沒有委派。
