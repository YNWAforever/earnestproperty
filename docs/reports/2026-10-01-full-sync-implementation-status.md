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
