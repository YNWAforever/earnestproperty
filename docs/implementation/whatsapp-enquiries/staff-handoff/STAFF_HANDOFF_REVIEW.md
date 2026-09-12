# Staff handoff final focused review

Reviewed local `codex/staff-reference-handoff` against base `b6d049e9e9d59b9aececf13b5e990f9a13647f23`. Final targeted source recheck completed after backend reported files stable. This supersedes the initial findings in this file.

## Result

No remaining confirmed P0/P1/P2 finding in the reviewed source after the fixes below. This is a focused code-review result, not end-to-end or production-readiness approval.

## Findings resolved in source

| Initial finding | Resolution inspected |
| --- | --- |
| P2 manager help/routing attention exposed only counts | `staff-endpoints.server.ts` now supplies authorized per-item `listStaffAttention`; `StaffEndpointEditor` shows reasons and relevant enquiry links. |
| P2 acknowledgement accepted ineligible/closed work | `staff-notifications.server.ts` mutation and `canAct` now check current inquiry status/review/response, live activation and eligible non-retired staff-channel mapping alongside recipient, role and assignment version. |
| P2 external alert had only an opaque UUID | Dispatcher builds canonical HTTPS work links containing conversation, enquiry and notification search fields. Unconfigured origin blocks transport. Unsupported template contract is explicitly rejected. |
| P1 cached endpoint could diverge from an attempt created by another invocation | Dispatcher compares cached endpoint id/version/destination/channel with immutable attempt target before claiming; its final boundary pins the staff mapping Inbox/folder. Stale target is suppressed. |
| P2 fresh routing permitted mapped accounts without an allowed role | Migration 170000 fresh requested-person branch, assignment execution/pre-send checks and assignment reconciliation now require agent/manager/admin role in addition to active mapping. |
| P2 adapter pre-send failures were persisted as possibly accepted unknown | Inbox readback/beforeSend failures have `WOZTELL_INBOX_PREFLIGHT_BLOCKED`; direct staff transport scope/template/beforeSend failures have `STAFF_NOTIFICATION_PREFLIGHT_BLOCKED`. Dispatcher persists either as suppressed/transport_preflight_blocked. Errors after the mutation call starts retain unknown handling. |
| P2 ambiguous employee/customer events lacked protected per-event visibility | Manager-only `listStaffEventReview` now returns normalized text, event identity and an existing conversation link without raw provider payload. Staff WhatsApp adapter requires a separately recorded association-review procedure. Classification/replay remains a stated operational gate. |

## Targeted integration observations

- Requested-person routing remains gated by fresh active capture, notification/routing eligibility, unlocked/unassigned state and eligible requested staff. It creates the assignment request and its job durably; handler-ready notifications still require authoritative confirmation.
- Intent recipient/request/version history and attempt target snapshots are immutable. Unknown or expired-lease attempts are not blindly resent.
- Signed staff-event isolation precedes generic customer intake. Correlated fresh inbound updates only the matching versioned endpoint window; explicit customer context is distinguished from ambiguous traffic.
- Acknowledgement and notification evidence remain separate from the customer human-response clock.

## Retained gates and evidence limits

- **B: authenticated browser/application verification** is a separate gate. This reviewer did not run browser journeys or claim that source inspection proves login/session, deep-link landing, draft preservation or real authenticated acknowledgement journeys.
- **L: tenant/device verification** is separately authorized and still required for exact provider path/auth/readback shape, intended-recipient delivery, private-note absence on customer devices and foreground/background behavior. Offline fixtures never establish L.
- **Staff templates** are deliberately unsupported/unverified, not implemented delivery. A closed staff window must block until an approved tested template contract exists. Initial own-window acquisition and destination verification require an approved operational procedure.
- **Ambiguous-event manual review** has protected read visibility; an approved classification/replay procedure remains necessary before optional staff WhatsApp activation. No automatic release/replay or complete dual-role live workflow is claimed.
- **Reminder/quiet-hours business policy**, deployment, live activation and publication remain separately gated. No proposed acknowledgement deadline was approved by this review.

## Reviewer execution

Read-only source/requirements inspection and local report writing only. No application edits, test execution, database/provider calls, external messages, commits, pushes or deployments by this reviewer. Parent independently owns the U/D/build/typecheck/browser evidence ledger; backend-reported pass counts are not claimed here as reviewer-executed results. Actual full NT coverage and final regression status must be read from that ledger.
