# Task 4 delivery cancellation implementation

Local changes establish a persisted dispatch_started_at reservation, revalidate campaign/contact/template/job lease after transaction locks, and consume refreshed contact/template values. Campaign cancellation updates queued and claimed-undispatched recipients plus audit in one transaction. Reserved requests are never requeued after ambiguous outcomes; proven provider rejection can clear the reservation. Legacy sending rows are conservatively marked reserved by the prepared migration.

Cancellation guarantees only cover work before reservation commits. Provider requests already crossing that boundary cannot be retracted. No provider was contacted.

Tests:
- Before fix node --test src/lib/woztell/campaign-dispatch.test.mjs: 4 failed (all20 sent after cancellation/optout/template change and stale template used).
- After fix node --test src/lib/woztell/campaign-dispatch.test.mjs src/lib/woztell/woztell.test.mjs: 40 passed.
- node --test src/lib/control-plane/control-plane.test.mjs src/lib/neon/admin-workflow.test.mjs: 36 passed.
- Database migration is prepared, not applied. Actual Postgres cancellation/consent/job-lease races require disposable DB validation.
- Independent review, scoped lint/typecheck and full-suite final pass pending.

## Terminal lease recovery review fix (2026-09-05)

Confirmed the reviewer blocker: when `recoverExpiredLeases` exhausted a campaign job, no future handler ran to classify its recipient claims. Reserved and undispatched rows could remain `sending` indefinitely.

`jobs.server.ts` now discovers terminal campaign candidates without locking jobs, then runs a real Neon transaction per candidate: lock the campaign first; take/recheck the job lock against the exact job ID, worker ID, attempt and current expiry; atomically fail the job, reconcile only that attempt's recipient claims, record recipient audits and the job attempt; then refresh campaign terminal state from a fresh statement. This preserves dispatch/cancellation's campaign-before-job lock order. Generic bulk lease recovery excludes terminal campaign jobs, so it cannot bypass their cleanup.

Reserved claims retain the irreversible dispatch timestamp and become `failed / WOZTELL_DELIVERY_UNKNOWN`. Undispatched exact claims become `failed / WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED`, or `cancelled` when campaign cancellation already committed. New owner/attempt claims remain untouched. No handler or provider call occurs. A campaign becomes failed only when it is still active, has no other queued/live delivery job, and has no remaining sending owner. Queued unsent recipients remain available for an explicitly authorized retry rather than being dispatched by cleanup.

Previously failed `LEASE_EXPIRED` jobs with stranded claims are also reconciled, using their persisted attempt worker record to recover the original ownership fence. A concurrent renewal, retry or reassignment fails the fresh ownership predicate and prevents stale cleanup.

Red evidence: three new production-function injection regressions failed before the fix (exhausted reserved/undispatched cleanup, previously-failed reconciliation, and audit-failure propagation). After the fix, all four behavioral cases passed; the fourth covers a lease renewed after discovery. Tests additionally pin campaign-before-job locking, all claim/dispatch ownership fields, preserved reservation timestamps, coupled audit writes, generic retry exclusion and no provider dispatch. These are deterministic SQL-boundary injection/source contracts, not proof of PostgreSQL isolation or database rollback. No database, migration or provider operation was run; real concurrent cancellation/renewal/dispatch and rollback acceptance remain gated on an approved disposable database.


Final local verification for this terminal recovery follow-up: `node --test src/lib/control-plane/control-plane.test.mjs src/lib/neon/admin-workflow.test.mjs` passed 41/41; focused ESLint for `jobs.server.ts` passed; `npm.cmd run typecheck` passed with exit 0; scoped `git diff --check` passed. No campaign module, provider, migration or database operation was modified/executed by this follow-up.

Root recovery follow-up: claimed recipients now persist job/worker/attempt ownership, recover abandoned reservations as unknown and undispatched claims safely, and defer empty-but-pending work without consuming retry budget. Default UI pending counts exclude reserved dispatches. Independent final review resolved the original recovery/count findings and terminal-retry follow-up. See integrated ledger for verification and DB gates.
