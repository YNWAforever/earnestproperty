# Independent review: staff bootstrap and campaign dispatch

Reviewed 2026-09-05 in `.worktrees/audit-20260905` against baseline `897f01ac372063113b5a42de9593fe33252d8dc0`. Scope: Task 1, Task 4 and their shared job/UI boundaries. Current source was authoritative; the baseline graph was known stale. No application source was changed, tests rerun, credentials loaded, or database/provider operations performed.

## Findings

### [P1] Keep a reconciliation job alive while claimed recipients are still in flight

`src/lib/woztell/campaign-delivery.server.ts:97-111, 324-328` (recovery thresholds and empty-claim success path), with `src/lib/control-plane/jobs.server.ts:326-358, 567, 596`.

A worker can crash after claiming a batch, either before any reservation or after reserving/sending one recipient. Its default job lease expires after 60 seconds. `recoverExpiredLeases` immediately requeues the job, but recipient recovery only considers claims older than 15 minutes. A recovered invocation before that threshold sees no queued recipients, returns a zero-failure success, and `runClaimedJobs` marks the sole job complete. The still-sending rows then have no scheduled worker to reclaim undispatched recipients or classify reserved requests as unknown. The UI can indefinitely report dispatching/pending even after a response-loss/crash. This gap existed for legacy sending recovery and remains unresolved in the new reserved/undispatched split; it prevents Task 4 recovery acceptance.

Return an explicit retry/reconciliation outcome while sending rows remain, and arrange a durable wakeup without exhausting normal attempts before the recovery deadline. Prefer recorded claim ownership/lease evidence to an unrelated fixed age. Add a regression with a crash, recovery at 61 seconds, and subsequent reconciliation: undispatched work resumes once; reserved work becomes unknown without a second provider call.

### [P2] Exclude reserved rows from the pending count

`src/lib/neon/admin-data.server.ts:3037-3039`, rendered at `src/routes/admin.blasts.tsx:1385, 1394`.

`dispatching` counts sending rows with a committed dispatch boundary, while `pending` counts all sending rows as well as queued rows. A cancelled campaign with one reserved recipient therefore displays both one already-started request and one pending request for the same recipient. These are distinct operational states, and the duplicate pending count implies work still awaiting dispatch after cancellation. Count pending as queued plus sending with a null dispatch boundary; verify the displayed outcome buckets partition the recipient total.

## Reviewed invariants

- Task 1 checks literal boolean verification, provider ID and normalized email against the authenticated identity, failing closed on absent/mismatched/unavailable data. Existing bound staff retain the existing role boundary.
- Bootstrap uses a separate table-lock statement followed by a fresh Read Committed snapshot. Both tables are locked against ordinary writers; eligibility, disabled matching profiles and provider verification are rechecked inside the transaction. Staff binding/creation and the role grant commit together. A concurrent loser obtains no fabricated admin access. No concrete new Task 1 authorization defect was found.
- Task 4 reserves dispatch only after locking campaign, contact, template and job, then reading current eligibility in the next statement. Campaign cancellation uses the campaign row as the same serialization boundary and cancels both queued and claimed-undispatched rows. A committed STOP/contact update or template deactivation is visible before a later reservation. The guarantee ends at reservation commit, before the actual HTTP request; cancellation cannot retract reserved work.
- Cancellation writes and its audit insert are transactional. Reservation and dispatch audit insertion are one transaction. Audit metadata contains identifiers and the boundary label, not customer payloads.
- Reserved ambiguous sends remain protected from ordinary queued updates and materialization; explicit provider rejection/configuration refusal can clear the reservation. Legacy sending rows receive a conservative reservation in the prepared migration. No duplicate-send defect was established in these inspected paths.

## Evidence and remaining gates

Task 1 report supplies 40 focused passing tests, broader team/property/auth checks, typecheck/lint and one skipped database suite. Task 4 report supplies 40 campaign/provider and 36 operations/workflow tests. These results were supplied implementation evidence, not rerun by this reviewer. The four new campaign tests inject `beginDispatch`; they prove orchestration uses fresh results, not that production SQL locks or predicates work.

Actual PostgreSQL bootstrap concurrency/rollback, cancellation-versus-reservation, STOP/template-versus-reservation, expired job lease, stale claim and audit-failure rollback remain unexecuted. Task 1 has a gated disposable-database suite; Task 4 needs equivalent executable database races. Validate the real schema, runtime grants and the dispatch migration on an explicitly named disposable target before release. Staging identity/provider behavior and exact-head integrated CI remain separate gates. Neither task has production acceptance from this review.

## Follow-up independent review: delivery recovery and task 6

Reviewed current source after ownership-based recovery and pending deferral fixes. No tests rerun, DB/provider operations or application source edits by this reviewer.

### Original delivery findings: resolved by source inspection, database execution pending

Recipient recovery now compares claim/dispatch job ID, worker ID, attempt and current lease instead of waiting 15 minutes. Stale undispatched work can be reclaimed on the next live job; reserved work becomes unknown without another dispatch. Empty-but-pending delivery returns JOB_DEFERRED and the runner reschedules without consuming a retry. The pending count now excludes reserved sending rows, and failed excludes unknown. These address the original 61-second replay and overlapping-count findings. Actual PostgreSQL recovery, lock and scheduler races remain unexecuted.

### [P2] Final-attempt crashes still strand claimed recipient outcomes

`src/lib/control-plane/jobs.server.ts:336` and `src/lib/woztell/campaign-delivery.server.ts:98`: recovery marks an expired job failed when attempt_count reaches max_attempts. Recipient cleanup runs only inside claimCampaignRecipients, called by a new handler invocation. A crash on the last attempt therefore gets no cleanup invocation: reserved recipients remain sending instead of unknown; undispatched claims remain sending even though their owner can never resume. JOB_DEFERRED does not help because the failed job is never claimed again. Add terminal job cleanup or a separately scheduled reconciliation path that classifies reserved work without sending and gives undispatched work an explicit terminal/recoverable outcome. Test max_attempts=1 with a crash before reservation and after reservation, and assert no indefinite sending rows or duplicate provider calls.

### [P1] Retained clear-opt-out operation bypasses the new consent evidence boundary

`src/lib/neon/admin-data.server.ts:2964`, `src/lib/neon/admin-data.ts:1276`, and `src/routes/admin.whatsapp.tsx:924`: the old clearContactWhatsappOptOut endpoint and confirmation dialog remain callable alongside the new evidence workflow. A contact with opt_in_whatsapp=true who later sends STOP retains that flag and has opted_out_whatsapp=true; this older operation clears opted_out_whatsapp from an arbitrary free-text reason and makes the contact marketing-eligible without any crm_consent_events entry or copy/source evidence. Its UPDATE and audit are separate commits, so audit failure can report failure after marketing eligibility already changed; raw free text is also copied into audit metadata. This is a retained boundary gap in task 6, not a newly introduced role escalation (the external endpoint already requires admin/manager). Retire the old mutation/control or route an explicitly defined correction through the same atomic consent/evidence service. Keep any false-positive STOP correction policy explicit rather than implicitly manufacturing affirmative consent. Test the retained endpoint directly, consent-event/audit rollback, and existing opted-in plus later STOP records.

### Task 6 assessed behavior and limits

The new public submission claim gates contact/lead/inquiry creation together; duplicate identities resolve through a fresh read after conflict wait and compare payload hash before returning the original inquiry. The 72-hour replay bound retains the identity tombstone. New server calls require the submission UUID. The browser helper stores only an opaque identity and digest, reusing that identity after response loss; successful persistence clears it. Existing-contact public upserts preserve present identity fields and marketing flags. These are appropriate by inspection; SQL concurrency and real-schema migrations remain unexecuted.

The new marketing-consent service validates a strict bounded schema, rejects opt-in with an opt-out evidence source, checks admin/manager and active database role, and commits flags/evidence/audit in one SQL statement. The dialog is keyed by contact identity, disables edits during saving and is role-gated at the server. No additional concrete defect was found in that new service during this pass. The retained old endpoint above prevents claiming that all consent mutations use it.

The task 6 report correctly leaves WhatsApp-to-lead triggering, inquiry-stage/lead-stage transitions and public affirmative-consent policy unresolved. Existing new-contact checkbox behavior was not treated as approval for a new policy. No task 6 completion or staging acceptance is asserted here.

## Final source re-review — remaining delivery and consent findings

Both follow-up findings are addressed in the inspected stable source. Terminal campaign lease recovery now discovers exhausted jobs separately, acquires the campaign lock before rechecking job ownership in a fresh statement, and atomically records the terminal job attempt, matching claimed recipient outcomes and bounded audit. Reserved recipients become unknown; undispatched recipients become attempts-exhausted or cancelled as appropriate. It also revisits already-failed LEASE_EXPIRED jobs using persisted attempt ownership. Generic recovery excludes exhausted campaign jobs so they cannot bypass this cleanup. Campaign status updates run after recipient changes and preserve cancellation/other queued or live jobs. No provider dispatch is performed by cleanup.

The retained clearContactWhatsappOptOut server function now delegates only to a fail-closed compatibility rejection: denied roles receive 403 and authorized legacy callers receive CONSENT_EVIDENCE_REQUIRED/409 without mutation. The inbox no longer offers the old reset action; its contact-keyed evidence dialog uses the atomic consent service. The former free-text audit/flag mutation bypass is therefore removed.

No additional concrete blocker was found in these two requested fixes by source inspection. This final pass did not rerun tests or access a database/provider; root owns the affected-suite/build rerun. Actual PostgreSQL cleanup, concurrent lease renewal/cancellation, and audit rollback remain disposable-database acceptance gates.
