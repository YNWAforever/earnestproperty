# Independent review: Task 5 outbound / Task 3B uploads

Reviewed 2026-09-05 in `.worktrees/audit-20260905`; source was still being coordinated by the root task. Scope: durable replies, provider boundary, ingestion/history, and upload intent/recovery. No source edits, database calls, migrations, credentials or real provider requests were performed.

## Findings requiring fixes

1. **[P1] Treat unrecognized successful HTTP envelopes as ambiguous** — `src/lib/woztell/woztell.server.ts:371`.
   `res.ok && !refused` promotes any 2xx body other than numeric `ok:0` to accepted. Empty body, `{}`, JSON `null`, and `{"ok":false}` all return `ok:true`, so `deliverOutboundIntent` permanently records accepted without provider acceptance evidence. In-process fake fetch reproduced all four with HTTP 200; no network was used. Require the supported explicit successful provider verdict and classify missing/invalid verdict as unknown. Add these four cases alongside numeric `ok:1` and `ok:0` tests.

2. **[P1] Reconcile later outbound evidence into known-ID unknown intents** — `src/lib/woztell/woztell-ingest.server.ts:45-51`.
   After the provider accepts, an initial completion database error can cause the catch path to save `state='unknown'` with a valid external message ID. A subsequent matching webhook/history event only attempts `INSERT ... ON CONFLICT (external_message_id) DO NOTHING`; it never updates that transcript status or its outbound intent. The same message therefore remains unknown indefinitely even when authoritative outbound evidence has arrived. Under the existing external-identity lock, reconcile validated matching outbound evidence to the actor-bound intent and its transcript, preserving conversation/direction checks and monotonic state. Test accepted response + first completion failure + successful unknown persistence + later callback/history. This finding follows directly from SQL/control flow; real database behavior was not exercised.

3. **[P2] Namespace upload recovery storage by authenticated actor** — `src/lib/admin/media-upload.ts:14-18`.
   The session key contains file/owner/MIME but no staff identity, while the durable intent and receipt correctly belong to one staff member. Staff A can upload a file, sign out, and staff B can sign in in the same tab; selecting that same file makes B reuse A's ID, which the server rejects with `UPLOAD_ID_CONFLICT`. Successful uploads retain this key too, so ordinary reselection cannot recover. Bind the client storage key to the authenticated identity before dispatch; preserve A's pending receipt under A's namespace and retain server actor checks. Add a same-tab account-switch test and same-actor reload retry test. No authorization bypass was found; this is an availability/recovery defect.

## Other review observations

- Intent enqueue, initial transcript and job are one SQL statement; dispatch reservation rechecks active staff roles, assignment, consent, reply window/template and job lease before the irreversible boundary. Recovered dispatching rows do not blindly resend.
- The external-identity advisory lock and early-event adoption logic cover callback-before-completion structurally. Actual SQL/concurrent execution remains an explicit disposable-database gate.
- Provider fetch bounds the fetch and streamed body together. History cursor advancement and follow-up job creation commit together, removing browser-page limits. Completed imports intentionally require a separately approved fresh sweep.
- Upload claim uniqueness permits one provider PUT; actor/content/path-bound signed receipts permit metadata completion without a second PUT. Unknown PUTs are intentionally operator-reconciled. Metadata and asset completion use one SQL statement. Both callers use the shared authenticated helper.
- The suggested `SELECT ... FROM table ON CONFLICT` parser ambiguity was not established as a PostgreSQL defect. PostgreSQL's [INSERT grammar](https://www.postgresql.org/docs/16/sql-insert.html) permits a SELECT query followed by the conflict clause; the frequently cited `WHERE true` workaround concerns SQLite. Do not claim a parser failure without PostgreSQL reproduction.

## Verification limits

The implementers reported 105/105 affected outbound tests and 52/52 upload/route tests. This review independently ran only the four fake-fetch acceptance reproductions above, all showing the bug. No disposable database was available, so migration validity, SQL races, early-event adoption and transaction behavior are not proven by this review. Authenticated staging and real provider envelope verification remain release gates. Root consent-dialog changes were outside scope.

## Final bounded remediation review — upload namespace and Task 5 P1 findings

Source re-reviewed: withStaffUploadIdentity reads actor ID and bearer token from the same session result, with cookie-session support and fail-closed missing identity. The upload recovery key now includes the authenticated actor, owner type, MIME and file digest; the same actor retains the identity across token rotation/reload while a different actor gets a separate recovery identity. Repository insertion, returned internal staff_id mapping, completion ownership predicate and the prepared migration consistently use created_by. The internal staff_id transport property does not reference a nonexistent database column.

Provider acceptance now requires HTTP success and numeric ok:1. Empty, missing, null, boolean and otherwise unsupported success verdicts stay ambiguous; numeric ok:0 remains explicit refusal. Later real-ID outbound evidence reconciles a known-ID dispatching/unknown intent and its transcript atomically, checking conversation, contact, member, channel, type and supported payload evidence under the external-identity advisory lock. finishOutboundIntent preserves accepted state/error clearing against a late unknown outcome. No additional concrete blocker was found within these requested fixes by source inspection.

Independent focused verification ran `node --test src/lib/media/media-upload-boundary.test.mjs src/lib/woztell/outbound-intent.test.mjs src/lib/woztell/woztell.test.mjs`: **52 passed, 0 failed, 0 skipped**. These tests use local injected/fake providers; no real provider or database was contacted. They include account switching/token rotation, cookie/bearer identity extraction, malformed successful provider envelopes and callback evidence wiring. The three original findings are resolved at this source/fake-provider verification level. SQL reconciliation and accepted-state concurrency are covered by a prepared disposable suite but were not executed here; actual migration/runtime database and authenticated staging acceptance remain required.
