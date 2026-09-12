# Codex test plan — correct staff identity, notification and acknowledgement

**Target:** `YNWAforever/earnestproperty`  
**Companion:** `CODEX_IMPLEMENT_AND_TEST_STAFF_HANDOFF.md`  
**Source IDs preserved:** NT-01–NT-26 from the staff-notification addendum  
**Status:** Tests to implement and execute. No application, database, provider or device test has been run in preparing this document.

## 1. Test architecture

Use production functions, migrations, transaction boundaries, authorisation and route handlers. Transport doubles are permitted only at the external boundary; do not mock the identity decision or database transition under test. Block unexpected real provider requests in ordinary tests. Label documentation-derived provider fixtures separately from redacted tenant-observed fixtures.

Use separate levels: **U** pure logic/types; **D** real disposable-database integration; **H** actual authenticated handler; **B** real browser/application integration; **L** separately authorised live tenant/device verification. A U/D/H/B pass does not establish L.

Re-read current package scripts and use existing runners. Add notification-specific suites and wire them into CI. Run related CRM, staff lifecycle, WhatsApp, operations, property and permission regressions. Do not treat source-string assertions as proof of transaction or access-control behaviour.

### Synthetic fixture contract

Create isolated test data for two agents A/B, manager M, a viewer and two unrelated customers C1/C2. Each staff internal UUID, Inbox user ID, customer member ID and optional staff-alert member/destination must be different. Use approved-looking test mappings created explicitly inside test setup, never deployment seeds.

Create a public property group with separate sale/rent offerings, one offering whose responsible staff is B, a saved link/open whose requested person is A, and a conversation with independently configurable confirmed handler and protected/manual lock. Include an unrelated CRM lead to detect accidental overwrites.

Provide deterministic test clocks, endpoint/reference versions, active and disabled mappings, hypothetical approved policies, history/observe/active intake contexts and activation generations. Fixture approval means approved **for that test**, not actual management or template approval.

Record external operations through separate spies/adapters for assignment, thread readback, private Inbox note and direct staff WhatsApp. Every test must be able to assert zero customer-visible internal-alert sends.

### Evidence to inspect

Inspect database counts/identities, job payloads/keys, request/response status, committed audit fields, provider operation recipients and rendered UI. For negative paths, assert absence of leaked payloads and unauthorised mutations, not just presence of an error toast. After simulated faults, replay the actual event/job to verify recovery.

## 2. Required cases

### NT-01 — Incoming A must not become property-default B

**Given:** a saved incoming reference resolves to A; the selected property's responsible/default staff is B; no active coordinator lock; A is eligible.  
**When:** actual intake/routing reaches verified assignment and handler-ready capture.  
**Assert:** requested=A, desired=A, verified Inbox user maps to A, actionable recipient=A. No automatic B alert, property-owner rewrite, contact-owner rewrite or historical sender rewrite. Build notifications from retained identities, not a late property-default lookup.  
**Levels:** U + D + H; repeat in the live pilot.

### NT-02 — Source/account namespaces isolate aliases

**Given:** the same alias text occurs in two source accounts and legitimately maps to different staff.  
**When:** resolve each exact namespace and a missing/ambiguous namespace.  
**Assert:** correct unique identity per account; missing/ambiguous input becomes review. Test mapping validity boundaries, overlapping-active-map rejection and preservation of significant leading zeros. Never global-first-match.  
**Levels:** U + D.

### NT-03 — Conflicting or injected staff hints

**Given:** saved context requests A; incoming text/query/body tries B, another endpoint, arbitrary phone or node.  
**When:** resolve reference and handle the request through real handlers.  
**Assert:** trusted-context conflict is visible; arbitrary override cannot drive assignment/dispatch. Multiple valid but conflicting references are reviewed rather than first-matched. No customer identity or permissions inferred from the reference.  
**Levels:** U + D + H.

### NT-04 — Customer, Inbox staff and alert recipient IDs differ

**Given:** distinct synthetic IDs for customer member, A's internal account, Inbox user and staff-alert destination.  
**When:** construct assignment, private-note and optional staff-alert operations.  
**Assert:** assignment selects customer thread + staff Inbox identity; the private note targets that thread only through the private API; the external staff alert targets A's verified destination. Include a runtime tampering case and compile/type-boundary coverage where supported. Customer member ID cannot be the accidental staff-alert recipient.  
**Levels:** U + H + transport contract.

### NT-05 — Private context never reaches the customer

**Given:** an actionable notification configured to post a private Inbox note.  
**When:** dispatch it and process any resulting event.  
**Assert:** only the private adapter is called, never customer `sendResponses`, including prefixed `###` text. No human-response credit or new enquiry. In live verification, inspect both agent Inbox and synthetic customer device; note is absent from customer messages.  
**Levels:** U + D + L.

### NT-06 — Accepted @email text is not proven mention delivery

**Given:** private-message API accepts text containing `@agent-a@example.invalid`; targeted-mention capability is unverified.  
**When:** persist the result.  
**Assert:** private-note-posted/accepted evidence only; no fabricated targeted/device delivery. The application still has pending work. An unverified capability must not fall back to a fake successful notifier. A genuine mention test requires actual tenant/device evidence.  
**Levels:** U + D + L.

### NT-07 — New enquiry on the same assigned conversation

**Given:** E1 already notified A at assignment version V; a distinct E2 arrives on that same conversation with A remaining an eligible verified handler.  
**When:** process E2 and then replay it.  
**Assert:** E2 creates one new handler-ready notification/job with its own enquiry identity. No redundant remote reassignment; E1 is unchanged; replay does not create E3 or another alert. Do not dedupe solely by conversation, staff or assignment version.  
**Levels:** D + H + B; required live-pilot repeat.

### NT-08 — Duplicate and concurrent readiness evidence

**Given:** multiple workers/event deliveries attempting the same logical E1/V/A/purpose/generation transition.  
**When:** release concurrent transactions at controlled barriers and execute duplicate worker ticks.  
**Assert:** one logical ready event, one initial notification and one permitted initial dispatch per selected transport. Check actual unique constraints and lease claims. Acknowledge that remote exactly-once delivery is not guaranteed; unknown-boundary rules must prevent unsafe resends.  
**Levels:** D + worker integration.

### NT-09 — Protected B coordinator with requested A

**Given:** incoming request A; conversation has a protected B coordinator.  
**When:** accept the new enquiry.  
**Assert:** B receives the action-required notification; requested A remains historical; reason is visible. A receives an FYI only under configured collaboration permission, without acceptance action or expanded transcript access. No automatic thread theft.  
**Levels:** U + D + H + B.

### NT-10 — A unavailable and approved fallback B

**Given:** A is disabled, lacks a verified Inbox mapping, lacks access, or is unavailable under the selected policy; B is a configured eligible fallback.  
**When:** confirm B and create notifications.  
**Assert:** actionable recipient=B with explicit reason; UI does not claim A accepted or was the assigned recipient. Test each unavailability variant and no-configured-fallback: the latter must be a visible attended-routing exception, not guessed assignment.  
**Levels:** U + D + H.

### NT-11 — Atomic confirmation/readiness, notification and job

**Given:** a transition capable of recording readiness for E1.  
**When:** inject database failures after the transition write, after notification insert, and before job insert/commit; separately test crash after commit before worker execution.  
**Assert:** pre-commit failures roll back the complete local transition; committed work remains durable for worker recovery. Replay results in one logical notification. Test already-assigned-new-enquiry and newly-confirmed assignment paths. Do not mock the transaction implementation.  
**Levels:** D + fault injection.

### NT-12 — Reassignment or endpoint change before dispatch

**Given:** A's queued alert at version V/endpoint v1; manager or staff eligibility/endpoint changes before dispatch.  
**When:** run the old worker and later deliver an old provider callback.  
**Assert:** unsent stale work is suppressed/superseded; approved new work uses its own version. A late result is historical evidence only. Add a barrier after dispatch starts: possibly accepted work stays uncertain/reconcilable, not falsely recalled or blindly resent.  
**Levels:** D + worker/transport integration.

### NT-13 — Forwarded links and preview scanners

**Given:** a notification deep link addressed to A.  
**When:** GET/HEAD it anonymously, through a preview fetcher, or as B/viewer; later open as A.  
**Assert:** GET/HEAD never acknowledges, reassigns or marks seen. Unauthorised sessions cannot fetch restricted detail. A may explicitly acknowledge only after session/scope validation. Any seen event is an authenticated rendering action, not a GET side effect or proof of reading.  
**Levels:** H + B.

### NT-14 — Wrong recipient or stale acknowledgement

**Given:** an action for A/V, an FYI for B, and a later manager takeover V+1.  
**When:** B, viewer, disabled A, or stale A submits acknowledgement; also submit the valid current action twice.  
**Assert:** unauthorised/stale/FYI requests do not mutate acknowledgement or assignment; valid duplicate is idempotent. Obtain actor from auth, not posted `acknowledgedBy`. Race acknowledgement and takeover in real transactions.  
**Levels:** D + H + B.

### NT-15 — Notification and acknowledgement are not customer replies

**Given:** an enquiry whose human reply is outstanding.  
**When:** create, accept, deliver, render and acknowledge the staff alert, including a private note event.  
**Assert:** `first_human_response_at` stays null; original response deadline and pipeline stage stay unchanged. Both server awaiting filters and UI remain correct until a relevant verified customer reply occurs.  
**Levels:** D + H + B.

### NT-16 — Staff-alert event isolation and recursion prevention

**Given:** a verified optional staff-alert context with outbound ID and staff endpoint.  
**When:** process signed alert receipts and correlated staff replies such as OK; repeat/reorder them.  
**Assert:** no customer property lead, enquiry, service survey, customer-response credit, forwarding or recursive alert is created. Apply context classification before the real generic lead trigger. Record internal events safely. Tampered correlation is not trusted.  
**Levels:** D + real ingress handler + L before enabling this transport.

### NT-17 — Customer window open, staff window closed

**Given:** C1 recently messaged the company; staff A has no currently eligible service window.  
**When:** attempt A's direct alert.  
**Assert:** only A's own verified recipient-window/template permission is used; eligible approved staff template or explicit block. C1's timestamp cannot authorise the send. Do not fake template approval.  
**Levels:** U + D + transport contract; L for the approved template path.

### NT-18 — Destination or template not eligible

**Given:** A's endpoint is unverified, retired, opted out, disabled, changed without verification, or lacks the required approved template.  
**When:** dispatch the staff WhatsApp attempt.  
**Assert:** no unsafe provider call, visible reason, durable work retained and only an approved fallback path. Destination must not default to profile phone or customer member. Test endpoint-edit permission and secret redaction.  
**Levels:** U + D + H.

### NT-19 — Notification timeout after possible acceptance

**Given:** transport records that a request crossed its irreversible boundary and then times out, or the worker dies before result persistence.  
**When:** recover and retry the queued job.  
**Assert:** attempt is unknown/reconciled, not blindly redelivered. Safe pre-dispatch failures remain distinguishable. Apply to both private-note posting and direct alert sending. A generic retry-all control cannot resend unknown operations.  
**Levels:** D + worker/transport fault injection.

### NT-20 — Actual staff device delivery

**Given:** an approved test tenant, staff test user, verified folder access, allowed recipient and known device/browser configuration.  
**When:** send an approved targeted alert with the staff surface in the supported foreground/background states.  
**Assert:** intended recipient actually observes the alert and can navigate securely. Record failures and supported conditions. A bell setting, API success or screenshot of the sender is not recipient delivery evidence. Do not mark unrelated per-message deliveries proven by this capability test.  
**Levels:** L only; offline contracts can exist but cannot pass this live gate.

### NT-21 — FYI cannot reveal a restricted transcript

**Given:** A is named in a reference but lacks the B-coordinated enquiry's transcript permission.  
**When:** construct any permitted referral FYI and follow its links as A.  
**Assert:** expose only explicitly permitted metadata or suppress the FYI; no transcript, customer phone, protected notes or acceptance control. Enforce on server endpoints and exports, not merely by hiding UI.  
**Levels:** U + H + B.

### NT-22 — Staff exit, alias recycling and destination reuse

**Given:** old enquiry requested A; A exits; the alias or alert destination is later allocated elsewhere.  
**When:** replay old events, run queued sends and process the approved handover.  
**Assert:** historical requested/recipient/acknowledger identity is not rewritten; stale sends cannot reach a different person. New handler work uses a new intent and verified mapping/endpoint versions. Existing authorised property handover remains separate from notification bookkeeping.  
**Levels:** D + lifecycle integration.

### NT-23 — History/observe activation does not flood alerts

**Given:** historical imported messages, observe-only enquiries, old generations and a new active cutover.  
**When:** enable flags, replay old evidence, restart workers and also process a genuinely fresh active enquiry.  
**Assert:** no retroactive notification/reminder backlog; fresh qualifying work is handled once. Include feature-off/new-schema-absent compatibility and a new flag disabled while an attempt is queued. Preserve established customer intake/manual replies.  
**Levels:** D + worker integration + deployment-compatibility tests.

### NT-24 — Customer reply before explicit acknowledgement

**Given:** A has pending work and no explicit acknowledgement.  
**When:** a verified relevant human reply from A reaches C1 and is correctly associated to E1.  
**Assert:** correct customer-response evidence is recorded; any approved acknowledgement reminder resolves as `resolved_by_customer_reply`; explicit acknowledgement timestamp remains absent. Unrelated enquiry replies and API/bot messages do not resolve it.  
**Levels:** U + D + H.

### NT-25 — Outage, overdue acknowledgement and original deadline

**Given:** staff notification transport fails and work remains unacknowledged.  
**When:** execute reminder/check jobs under first an unapproved policy, then an explicitly hypothetical approved test policy.  
**Assert:** no unapproved reminder or reassignment; approved exceptions/reminders follow policy and dedupe. Original customer-response due time is unchanged. Escalation notification and actual manager takeover remain distinct. Include stale-worker payload protection and bounded service-lane backlog checks.  
**Levels:** U + D + worker integration.

### NT-26 — Employee can also be a legitimate customer

**Given:** an employee has a verified staff-alert endpoint and independently makes a property enquiry.  
**When:** process explicitly correlated internal alert traffic, a legitimate customer request and an ambiguous message.  
**Assert:** correct purpose/context classification; legitimate enquiry is not dropped by a phone blacklist; internal alert does not become a lead; ambiguous context enters review with preserved evidence. No customer/staff identity merge and no customer-response credit from an internal reply.  
**Levels:** D + ingress handler; L when verifying optional staff alerts.

## 3. Required browser journeys

Run the actual application with synthetic accounts and an authorised test database. Provider network remains doubled except in explicitly approved live testing.

**Journey A — requested A / property B:** start from the source-reference intake, reach verified-handler evidence through the test adapter, see A's new pending notification, confirm that B sees no unauthorised action, acknowledge as A, observe the still-running human-response obligation, then produce a relevant authenticated customer reply and verify the independent response state.

**Journey B — same thread, second enquiry:** create E2 without changing A's assignment. Verify a new action for E2 and no duplicate for E1. Refresh and paginate the inbox; preserve per-user drafts and selection. Acknowledge only E2 and verify the other record's state is unchanged.

**Journey C — manager takeover:** queue an A alert, transfer responsibility through the authorised assignment flow to M, execute old worker/ack requests, and verify stale suppression/conflict. M receives the correct current task. Requested A stays historical; any FYI follows permissions.

**Journey D — security:** try anonymous GET/HEAD, stale URL, another staff session, viewer, invalid CSRF/request origin where applicable, tampered IDs and endpoint editing. Assert server denial and absence of leaked data/mutations.

Retain redacted screenshots and browser test traces only where supported. UI evidence alone does not replace DB and provider-recipient assertions.

## 4. Separately approved live verification

Before L tests, record test-environment identity, company channel/app/integration, exact API path/auth capability, synthetic customer and staff allowlists, permitted operations, credentials owner, intended device surface and approval reference. No secrets in reports. Verify that the target is not production by assumption alone.

Capture a redacted sequence: trusted incoming staff reference -> internal staff mapping -> actual thread assignee readback -> private context absent from customer device -> intended staff alert observed -> authenticated acknowledgement -> relevant customer reply. Repeat new enquiry/same handler. Test Live Chat mode where relevant.

If API mention semantics or device push cannot be proven, label that capability unverified. Keep a private note as context only. Optional direct staff WhatsApp must separately pass its endpoint, own-window, template, event-isolation and dual-role tests before enabling.

Do not enable optional reminders merely to complete a demo. Fast-forward only injected test clocks, not production timestamps or live service policy.

## 5. Verification ledger and stopping rules

For every NT ID, report subtest names, level, exact command, actual result/exit code, evidence location and any blocked assertion. Status values: `not_run`, `passed`, `failed`, `blocked`. A case with offline passes and an unrun live assertion is `offline_passed; live_blocked`, not wholly passed.

Record pre-existing regressions separately from introduced defects. Fix and rerun introduced failures. Do not delete tests, add broad skips, fake provider successes or change the expected identity to make the suite green.

Completion requires all implementable scoped production paths and tests, all available safe executions, an accurate blocked-input list and a reviewed diff. Production readiness additionally requires approved tenant/device evidence, migration/worker capability, policy/transport approval and a rollback drill. Stop before unapproved external sends, push, merge, deployment or activation.

**Source:** `references/CODEX_STAFF_REFERENCE_NOTIFICATION_ADDENDUM.md`, sections 1–10 and NT-01–NT-26. The given/when/assert details are engineering test elaborations of those requirements; they do not constitute business-policy approval or evidence that tests have passed.
