# Task 5: durable replies and event reconciliation

Scope: audited worktree `codex/audit-20260905`, baseline `897f01a`. No commits, provider sends, credentials, or migrations were executed by this slice.

## Delivered locally

- Text/template routes validate UUID request and conversation IDs plus bounded, kind-specific payloads. They enforce staff access and delegate scoped persistence to one CTE statement. The database binds a unique request ID to its actor and canonical SHA-256 payload hash; mismatched reuse conflicts.
- Intent, initial transcript and durable `woztell.reply.deliver` job enqueue atomically. Duplicate POST returns the existing intent. UI request IDs are written to per-user session storage before POST, retained when its response is lost, and cleared after confirmed enqueue. Persistence failure prevents dispatch; the success wording says queued, not delivered.
- Reservation serializes conversation/contact/template/job checks, rechecks current consent, text reply window, active template, active staff role and conversation ownership, and records `dispatching` before calling the provider. Recovery of an existing reservation becomes `unknown`, never another provider call.
- Provider fetch and streamed body have a shared 15-second deadline and size bounds (256 KiB send, 2 MiB history). Exceptions/ambiguous responses remain unknown; explicit rejection becomes failed. Accepted response plus database failure retains the external identity when possible and never blindly resends.
- A provider `messageId` at the supported top-level or `data.messageId` position is persisted. Finalization shares an external-identity advisory lock with ingestion. If the callback/history row arrived first, the intent adopts that row and removes its temporary transcript duplicate. Events without a reliable provider ID retain the existing deterministic normalization; text/timestamp guesses are not used to merge ambiguous sends.
- Event persistence is one transaction with sorted identity locks, uniqueness-backed conflict-aware inserts and monotonic recency. Conflicting contact identities fail closed. Inbound service messages no longer set marketing opt-in; STOP remains monotonic.
- History imports use durable `woztell.history.import` jobs, one bounded provider page each. Cursor advancement and the next job commit together. Failed/expired work can replay a page safely. The inbox starts/resumes the job; the browser's previous 20-call ceiling is removed. Empty initial forward pages retain the backward fallback. Repeated cursors fail visibly.

## Verification

- Red test reproduced before implementation: outbound module absent, test process failed.
- New deterministic injected tests: 12/12 pass (duplicate dispatch, response loss, persistence failure after acceptance, refusal versus ambiguity, fetch/body deadline and limit, history resume past 20,000 records, partial-page failure, stale jobs, cursor stall, empty-forward fallback).
- Combined affected suites: 105/105 pass across outbound-intent, provider-fetch, history-import, woztell, woztell-history, and admin.routes.
- Focused ESLint passed for the new production modules and API routes.
- Typecheck passed twice during this slice. A subsequent shared-worktree run reached only the root agent's in-progress `submissionId`/`WebsiteInquiryPersistenceInput` mismatch in admin-data.server.ts; final exact-tree typecheck belongs to the coordinating task.
- `outbound-intent.db.test.mjs`: two explicit gated skips. It covers concurrent duplicate intent/job/transcript creation, same-ID payload conflicts, callback-before-response transcript adoption, simultaneous webhook/backfill contact and conversation identity, older recency, and STOP without marketing opt-in.

## Remaining release gates and practical limits

- Apply `20260905130000_outbound_intents.sql` only to an explicitly approved disposable/staging target first. Existing duplicate member IDs or null-channel thread identities intentionally prevent unique-index creation; inspect and reconcile those records rather than deleting customer data.
- Run `test:woztell:db` with only the identified `TEST_DATABASE_URL` and `WOZTELL_TEST_DATABASE_CONFIRMED=true`. Owner applies reviewed migrations separately; the test does not migrate and never falls back to DATABASE_URL.
- Database SQL/concurrency assertions are authored but unexecuted here. Independent review and exact-head CI remain required before release.
- Verify the actual staging WozTell accepted-response ID shape against named synthetic recipients before claiming automatic reconciliation for that provider envelope. Unknown attempts without a returned provider identity require operational reconciliation; no exactly-once provider-delivery guarantee is claimed.
- If all post-dispatch database writes fail, a reservation stays visibly dispatching until job recovery converts it to unknown. It is never automatically returned to queued.
- A completed channel/mode history checkpoint is retained and reported completed. A separately approved fresh historical sweep/reset is not added by this slice; live events continue through webhook ingestion.
- Browser reload/send acceptance and operational worker scheduling require the approved authenticated staging environment. No real outbound message or paid-provider evidence was generated.

## Independent review follow-up: both P1 delivery findings

- Reproduced both regressions before changing production code: the focused run had 41 passes and 2 failures (ambiguous HTTP acceptance; missing later-evidence reconciliation).
- Provider acceptance now requires HTTP success plus the supported numeric `ok:1` verdict. Empty response, `{}`, `null`, `ok:false`, `ok:true`, and string `ok:"1"` remain ambiguous. Numeric `ok:0` preserves definitive refusal behavior. Existing injected delivery classification records ambiguous results as unknown and never blindly retries them.
- Under the existing shared external-message lock, ingestion now atomically promotes a known-ID unknown/dispatching intent and its existing transcript to accepted. It requires a real external ID, outbound direction, matching conversation/contact, channel/member, message kind and content. Text must equal the intent payload and local transcript. Template evidence must match the exact response snapshot recorded at dispatch, including element, language and components. Unsupported/missing evidence stays unknown.
- Completion writes now preserve an already accepted state and cleared error when a stale failure arrives later. Transcript identity remains unchanged; ingestion retains external-ID conflict deduplication.
- Deterministic verification after fixes: **108/108 passed** across outbound-intent, provider-fetch, history-import, woztell, woztell-history and admin.routes. **Typecheck passed (exit 0)**. Focused ESLint for provider, ingestion and outbound-intent modules **passed (exit 0)**. Focused `git diff --check` passed; only Git's existing LF/CRLF warnings appeared.
- Added an unexecuted disposable-database recovery regression: fake provider acceptance, first completion failure, successful unknown persistence, mismatched inbound/member/channel/content evidence rejected, concurrent valid webhook/history acceptance, one transcript identity, and stale failure unable to downgrade acceptance. This extends the database suite to three gated cases. No database, migration, credential, or real provider calls were made for this follow-up; actual SQL/concurrency and staging provider-shape verification remain the documented external gates.
- Root consent UI, campaign changes, and upload actor namespacing were not edited in this follow-up.
