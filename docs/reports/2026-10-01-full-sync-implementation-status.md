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
| T1-T5 | PENDING | evidence destination/baseline recovery gate |
| T6-T8 | PENDING | Property.hk access/identity/fixtures BLOCKED_EXTERNAL |
| T9-T10 | PENDING | authenticated UI + disposable integration pending |
| T11 | PENDING | 0/3 new scheduled cycles; MONITORING not stable |

## Shared interfaces / rulings

- T1→T2→T3: immutable manifest byte SHA differs from the ingestion canonical payload hash. Both must be recorded and checked; never compare raw SHA to a canonical hash.
- T3→T4: only the current accepted full receipt authorizes publication, retaining36h freshness and20 attempt cap.
- T7→T8: unverified Property.hk URL/ID/media contracts stay disabled; no synthetic selector promoted to live config.
- T2→T9: missing callbacks/never-started schedules need read-only health checks independently of stage success events.
- T9→T10: use existing server authorization/property mutation service; no client actor/UUID/version authority.
- Execution remains single agent as requested; local author review will be identified explicitly. Windows task evidence/checkboxes stored in these tracked reports; shell-specific skill bookkeeping replaced with equivalent entries.

## External gates

Private evidence repository/release + least-privilege credential and authoritative baseline recovery; reviewed merge/deploy/activation authority; verified disposable DB; Property.hk supported exact URLs/real fixtures/ID/media policy; production UI login; manual end-to-end and3 actual daily cycles.

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
