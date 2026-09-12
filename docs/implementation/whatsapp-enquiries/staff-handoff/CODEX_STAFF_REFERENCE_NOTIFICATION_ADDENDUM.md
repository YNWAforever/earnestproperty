# Earnest Property — Staff-reference matching and assignment notification

**Version:** 1.1 addendum · **Prepared:** 12 September 2026  
**Target:** `YNWAforever/earnestproperty`  
**Parent:** `CODEX_EARNESTPROPERTY_WHATSAPP_IMPLEMENTATION_PLAN.md`, v1.0  
**Status:** Proposed execution specification. No code, database, WOZTELL tenant or notification was changed. No implementation tests were executed for this addendum.

## 1. The requirement being added

A received property enquiry must identify the salesperson requested by its trusted incoming staff reference. When that salesperson is the confirmed handler, the action notification must reach that same person, not an arbitrary representative of the canonical property group.

The workflow must distinguish:

```text
Staff reference resolved
    -> Actual Inbox assignment verified
    -> Staff notification durably created
    -> Delivery evidence recorded where available
    -> Staff explicitly acknowledges the work
    -> Staff sends a relevant customer reply
```

Assignment confirmation is not notification delivery. Notification delivery is not acknowledgement. Acknowledgement is not a customer reply.

The parent plan's Phase 3 describes mapping and assignment confirmation, but does not define a complete salesperson notification implementation. Phase 4 explicitly separates manager task creation, notification and assignment. This addendum closes the salesperson handoff gap; it does not replace the existing source flow, SLA rules, permissions or production-release gates.

The supplied business flow specifies sales reply timing and manager assistance, not a staff-notification transport or acknowledgement deadline. Those are new requirements. Any reminder/escalation timings below remain proposals until approved.

## 2. Identity contract: resolve once, then carry the same identity

Do not use one ambiguous `staffId` string for several external systems.

| Identifier | Meaning |
|---|---|
| Incoming enquiry reference | Opaque identifier in the customer message; resolves to saved link-open context. |
| Incoming staff reference | Earnest staff code or approved source-specific alias; not necessarily a database UUID. |
| `requested_staff_id` | The resolved `staff_users.id` requested at intake; retained historically. |
| `property_responsible_staff_id_at_intake` | Selected offering's verified responsible staff snapshot; may differ from the request. |
| `confirmed_handler_staff_id` | Current handler whose actual Inbox assignment has been verified. |
| `woztell_inbox_user_id` | Staff account for Inbox assignment; not a WhatsApp customer/member ID. |
| `staff_notification_endpoint_id` | Verified notification destination owned by that staff member. |
| `customer_woztell_member_id` | Customer conversation identity; never the recipient of an external staff alert. |

### 2.1 Resolution hierarchy

1. Prefer a valid enquiry reference that resolves to a saved, versioned link/open record containing a requested staff identity.
2. For an approved legacy integration without such a reference, use an exact source-scoped staff alias mapping. Keep its origin and verification evidence.
3. An agent name, licence number or arbitrary `staff_ref` typed in the customer message is a request/hint, not authority. Resolve only through an approved mapping and existing routing/visibility checks. Conflicting references enter review.
4. Never invent a staff mapping from a scraped phone/name, a guessed branch, the first property-group member, or the customer's own provider member ID.

The reviewed `src/lib/mls/public-source-metadata.mjs` explicitly treats source-contact evidence as supplemental and does not impersonate verified staff profiles. Preserve this boundary.

A link reference is not authentication and may be forwarded. It cannot grant a staff user access, identify a customer before Send, or merge two customers.

### 2.2 External-reference mapping — only if no equivalent exists

Proposed `staff_external_references` fields:

```text
id
namespace                  e.g. earnest_staff_code or a specific source/account
external_reference
staff_id                   FK -> staff_users
valid_from / valid_until
verified_at / verified_by
mapping_version
```

Require an unambiguous active mapping within the namespace, retain historical mappings and prevent alias recycling from rewriting historical attribution. Do not assume a 28Hse identifier is globally unique across accounts. Public reference codes need not equal internal IDs.

Reuse the parent's `whatsapp_staff_channels` mapping for staff-to-Inbox identity. Add a separately verified endpoint/preferences record for any direct staff WhatsApp alert; the public profile's phone is not automatically an approved alert destination.

### 2.3 Matching rule

For a normal, newly routed, unlocked enquiry:

```text
resolved incoming staff reference
  = inquiry.requested_staff_id
  = assignment.desired_staff_id
  = mapped verified Inbox assignee
  = notification.recipient_staff_id
```

This is equality of the underlying person after mapping, not equality of the raw ID strings.

When these differ, save a reason such as:

```text
existing_coordinator | protected_manager_lock | requested_staff_unavailable
requested_staff_unmapped | reference_conflict | authorised_manual_handoff
```

Do not describe a fallback as successful delivery to the originally requested salesperson. Do not alter `properties.agent_id`, contact ownership or historical `sent_by` merely to force equality.

## 3. Recipient policy: action owner versus informational recipient

| Situation | Action-required alert | Other notification |
|---|---|---|
| Requested A is confirmed handler A | A | No duplicate alert to A in another role. |
| Requested A, general property default B, new eligible unlocked thread | A after verified assignment | B only as an approved collaborator, not automatically. |
| Requested A, existing protected coordinator B | B for the new enquiry | A receives an access-checked referral/collaboration notice, not permission to take over. |
| Requested A unavailable; approved fallback B confirmed | B | A receives an optional approved FYI if active/eligible; otherwise manager records the exception. |
| Staff reference unknown/conflicting | Attended triage/reception | Manager sees the unresolved-reference reason; no guessing. |
| Same handler A, new distinct enquiry | A receives a NEW enquiry alert | No new remote reassignment is required. |
| Manager C takes over | C for the manager action | Original request stays A historically; previous handler can receive an approved handoff FYI. |

Only the current action owner receives an acknowledgement-required assignment alert. A requested-agent FYI must say who is actually handling the conversation and must not contain an `Accept assignment` button.

Being named in an incoming reference is not permission to read the customer's transcript. An informational notice must expose only approved referral metadata until the appropriate access is granted. Never bypass the parent's agent/manager/viewer permissions to make a notification link work.

## 4. Notification architecture

### 4.1 Required baseline: durable Earnest notification and work acknowledgement

Reuse an existing suitable internal notification facility if present in current HEAD. Otherwise add a focused staff-notification module backed by Neon and the existing `ops_jobs` worker.

Every new actionable enquiry receives a notification record targeted by internal staff ID. Display it in the staff's own pending-work view and the enquiry card. This is the authoritative record of what work the application offered, not proof that an external device displayed an alert.

Proposed authenticated actions:

```text
listMyStaffNotifications(...)
acknowledgeStaffAssignment({ notificationId, expectedAssignmentVersion })
requestStaffAssignmentHelp({ notificationId, expectedAssignmentVersion, reason })
```

Use the existing `createServerFn`, Zod, lazy server-only import and staff-auth patterns. Obtain the actor from the authenticated session; never accept `acknowledgedBy` as client authority.

### 4.2 WOZTELL Inbox notification surface

Official documentation establishes Inbox assignment, thread readback, internal-message operations, and UI mentions. A UI `@email` mention notifies the tagged agent; users need Inbox activation and folder access. The internal-message API does not document a typed mention target. Do not assume a string containing `@email` triggers the same notification as the UI. Verify this in the actual tenant. [W1][W2]

Implementation boundary:

- Use the approved assignment adapter, then verify the actual assignee and scope.
- Create a private assignment/enquiry note through a verified Inbox integration adapter, not the customer-message sender.
- Enable automated targeted mentions only after a test proves the supported mechanism, correct recipient, privacy and actual notification behaviour.
- Enable native Inbox/device notifications and test the staff's real supported device in the intended foreground/background conditions. A blue bell alone is not delivery evidence. [W3]
- If targeted alert behaviour cannot be proven, retain the internal note as context only and mark that alert channel unverified. Do not return mock notification success.

The Inbox Public API's documented methods include `list-users`, `update-thread-agent`, `list-threads` and `internal-message`; its authentication uses `X-Woztell-Payload` and `X-Woztell-SignedContext`. Use verified deployment paths and credentials. The documentation's examples vary in `/api/` prefix; resolve this in testing, not with a production blind-probing loop. [W1]

This provides a documented direct-assignment/readback alternative to a per-staff bot node. Select ONE assignment adapter per conversation/activation; do not execute both. Existing verified node-based routing need not be replaced solely for this addendum.

### 4.3 Optional direct WhatsApp staff alert

For staff who need an additional mobile alert, support an explicitly approved, opted-in staff WhatsApp endpoint. This is a notification to the salesperson's own number, not transfer of the customer's conversation.

The sender's recipient is the staff endpoint. The customer's `memberId` must never be used with customer-facing `sendResponses` to send internal assignment details. The reviewed `sendWoztellResponse` accepts a member ID and therefore cannot by itself infer the intended staff recipient.

The staff alert has its own recipient-level permission and messaging window. The customer opening a service window does not open one with a different staff recipient. Outside the staff recipient's eligible window, use an approved template; template/category and recipient consent must be verified. [W4]

Suggested minimal copy, NOT an approved template:

```text
【晉誠地產｜新查詢待跟進】
指定同事：{staff_display_name}（{approved_staff_reference}）
樓盤：{approved_public_property_reference}
來源：{verified_placement_label}
查詢編號：{enquiry_reference}
人工回覆限時：{approved_deadline_or_pending_policy_label}
請登入工作台確認接手，並於公司 WhatsApp 對話回覆。
```

Do not forward full chat history, customer phone numbers or sensitive details into lock-screen previews. Use an authenticated application link for further details. An employee replying `OK` to the alert is not a reply to the customer and must not be forwarded to them.

A direct staff WhatsApp endpoint requires an explicit participant/notification-context boundary before generic customer ingestion and its CRM lead trigger. Staff-alert receipts/replies must not create property leads, start sales surveys, satisfy customer SLAs or recursively notify staff. Do not infer this exclusion merely from an unverified phone match. Test collisions and employees who also have legitimate customer roles; require context resolution rather than a silent global phone blacklist.

Do not add automatic WhatsApp-group forwarding or provision a new company number as a shortcut. Disable the optional transport until its real account and policy requirements are satisfied.

## 5. Events: notify each enquiry, not only changes of assignee

A notification triggered only by `assignment.confirmed` is incomplete: a new property enquiry can arrive on an already-assigned thread without changing the assignee.

Introduce the proposed domain event `enquiry.handler.ready`:

```text
A new enquiry exists
AND its current actionable handler is verified/eligible
AND the enquiry belongs to the active notification scope
```

Produce it after a new remote assignment is confirmed OR after checking that the existing coordinator remains the correct handler for this new enquiry. Retain the verification evidence and assignment version. Do not invent an assignment transition when no remote change occurred.

In the same database transaction as the eligible ready-event transition, write:

```text
Enquiry handler-ready event
+ staff_notification_intent
+ idempotent dispatch job
```

For incoming-reference/coordinator conflicts, create the coordinator's actionable notification and any permitted requested-agent referral notice as distinct purposes.

Unresolved routing must generate a separate attended exception. Do not wait indefinitely for a handler-ready event while the customer receives no staff attention.

## 6. Persistence, states and idempotency

### 6.1 Proposed records

Reuse equivalent existing facilities; do not introduce a second customer CRM or another queue.

```text
staff_notification_intents
  id, cause_event_id, inquiry_id, conversation_id
  assignment_version, activation_generation
  requested_staff_id_snapshot, recipient_staff_id
  purpose: action_required | requested_agent_fyi | handoff_fyi | routing_exception
  state: pending | acknowledged | resolved | superseded | cancelled
  acknowledgement_required, acknowledge_due_at
  created_at, seen_at, acknowledged_at, acknowledged_by
  dedupe_key

staff_notification_attempts
  id, notification_id, transport, endpoint_id, endpoint_version
  state: queued | dispatching | accepted | delivered | unknown | failed | suppressed
  provider_operation_id, attempted_at, delivered_at, evidence_kind
  safe_error_code

staff_notification_endpoints
  id, staff_id, transport, destination_secret_or_protected_reference
  enabled, verified_at, verification_version
  permission_evidence / relevant staff-channel opt-in
  notification preferences and approved quiet-hours policy
```

Do not create an endpoint database record containing provider tokens; credentials remain in server deployment secrets. Restrict the administrative ability to modify destinations and record all changes.

Suggested logical key:

```text
<enquiry_id>:<assignment_version>:<recipient_staff_id>:<purpose>:<generation>
```

Use separate attempt keys for transport/reminder generation. Duplicate confirmations and webhook redelivery do not produce duplicate initial alerts; a genuinely new enquiry does produce a new alert even when recipient and assignment version are unchanged.

Before dispatch, re-check active status, recipient role, assignment generation, target endpoint version, permission, policy and feature flags. Supersede stale unsent alerts. A late provider result is historical evidence, not authority to reactivate old work.

### 6.2 Evidence rules

- Internal-note creation means posted, not staff device notified.
- Provider acceptance means accepted, not delivered or read.
- Persisted Earnest notification means available in the application, not observed by staff.
- `seen_at` requires authenticated rendering/observation evidence; a preview crawler opening a link is not staff viewing.
- `acknowledged_at` requires an explicit authenticated action from the current action owner.
- Only a verified relevant customer reply satisfies the human-response obligation.

Never collapse these into a boolean `notified=true`.

### 6.3 Safe acknowledgement

An alert opens a GET page; opening it never changes assignment or acknowledgement. After login and a current permission/version check, the staff member explicitly presses `確認接手` through POST/server action.

A forwarded link does not authorise its holder. A stale link cannot accept an earlier assignment after a manager takeover. Acknowledgement records receipt of the existing work; it does not silently overwrite remote assignment.

A verified customer reply may resolve an outstanding acknowledgement reminder as `resolved_by_customer_reply`, with preserved evidence, without fabricating an earlier explicit acknowledgement timestamp.

## 7. Reminders and escalation — proposed controls

Track notification-processing lag from intake and acknowledgement time from the handler-ready/notification-created event. Do not let a delivery outage postpone responsibility indefinitely.

For review only, a possible opening-hours policy is a reminder after 5 minutes without acknowledgement, followed by a branch-manager alert after 10 minutes. Do NOT seed these thresholds as approved. Define quiet hours, shift handling and manager coverage first.

A manager alert is not automatic reassignment unless a separate handoff policy authorises it. A notification failure must not reset the original customer's three-hour response clock. Neither acknowledgement nor mobile-alert delivery counts as a customer reply.

If the external channel is unknown/failed, show an attended exception. The default response to a possibly accepted notification is reconciliation, not unbounded resend. Explicitly reviewed alternate-channel escalation must be labelled as such and deduplicated.

## 8. Codex implementation tasks

Add these tasks to Phase 3 of the parent plan. Staff WhatsApp transport activation remains separately approved; it must not reuse the parent's customer-service actor branch without a distinct staff-notification purpose and recipient contract.

### P3-N1 — Reference resolution

Implement the exact, source-scoped resolver and mapping editor/read contract. Carry reference, mapping version, requested staff and selected-offering context from intake. Record mismatch reasons. Preserve historical request fields in staff-lifecycle handover tests.

### P3-N2 — Handler-ready and durable notification capture

Add the necessary additive migrations and register them. Extend current routing confirmation and new-enquiry handling with the handler-ready transaction. Test already-assigned conversations and concurrent confirmations.

### P3-N3 — Staff notification and acknowledgement UI

Add a compact notification/pending-work list and acknowledgement action using current auth/role conventions. Include requested agent, actual handler, mismatch reason, source and property. Keep customer response deadline separate. Add version-checked links into the existing inbox and a private enquiry view for permitted collaboration. No GET mutation.

### P3-N4 — WOZTELL adapter and optional staff transport

Implement a server-only Inbox API adapter for the documented internal operation/readback route selected in test configuration. Do not reuse customer message transport for private notes. Verify mention/push behaviour rather than assuming it. Implement optional direct staff WhatsApp transport behind independent controls with permission, own-window/template and event-isolation checks.

### P3-N5 — Monitoring and failure handling

Extend manager/operations views with unresolved staff references, handler mismatch, notification pending/unknown/failed and unacknowledged work. Add approved reminder handling and cancel/supersede stale jobs. Re-check current target at send and acknowledgement time.

### Proposed files

```text
src/lib/whatsapp-enquiries/staff-reference.ts
src/lib/whatsapp-enquiries/staff-notification-policy.ts
src/lib/whatsapp-enquiries/staff-notifications.server.ts
src/lib/neon/staff-notifications.ts
src/lib/neon/staff-notifications.server.ts
src/lib/neon/staff-notifications.types.ts
src/lib/woztell/inbox-api.server.ts
src/components/admin/StaffNotificationPanel.tsx
neon/migrations/<new>_staff_reference_notifications.sql
```

Integrate with the parent plan's enquiry workflow, routing adapter, job-handler registration, `admin.whatsapp.tsx`, mapping/settings screen, migration registry, permissions, staff lifecycle and CI. Reuse newer equivalents instead of duplicating them.

Suggested jobs:

```text
woztell.enquiry.staff.notify
woztell.enquiry.staff.notify.reconcile
woztell.enquiry.staff.ack.check
```

Use the existing queue and explicit transport idempotency/evidence. Suggested independent default-off controls:

```text
EP_WA_STAFF_NOTIFICATIONS_ENABLED=false
EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED=false
EP_WA_STAFF_ACK_ESCALATION_ENABLED=false
```

Keep existing customer ingestion/manual replies intact when these are off. Observe/history records must not become active staff-alert backlogs after a flag change.

## 9. Added acceptance scenarios

| ID | Scenario | Expected result |
|---|---|---|
| NT-01 | Valid incoming reference A; property default B | Eligible fresh assignment and action alert use A; B is not substituted silently. |
| NT-02 | Source aliases have the same text in different accounts | Namespace selects the approved identity, never a global first match. |
| NT-03 | Request contains conflicting/tampered staff hints | Safe review; no arbitrary reassignment/endpoint injection. |
| NT-04 | Incoming customer member ID differs from staff Inbox ID | Each field used only for its intended operation. |
| NT-05 | Native private note sent | Customer receives no staff-only message. |
| NT-06 | Internal-message API accepts an @email string | Not counted as targeted delivery unless actual mention behaviour was verified. |
| NT-07 | New enquiry, same existing confirmed handler | New enquiry gets one actionable alert without unnecessary remote reassignment. |
| NT-08 | Duplicate/concurrent confirmation or ready event | One logical initial alert and one initial transport attempt per policy. |
| NT-09 | Protected coordinator B; incoming requested A | B gets action; A gets only permitted FYI; lock and access remain intact. |
| NT-10 | A disabled/unmapped; B approved fallback | B is clearly the actual handler; no false “A notified” state. |
| NT-11 | Crash during confirmation/notification/job capture | Atomic rollback/retry; no lost staff handoff. |
| NT-12 | Reassignment/endpoint change before queued dispatch | Stale alert suppressed/superseded; new correct version checked. |
| NT-13 | Forwarded or scanner-opened action link | No access grant, seen claim, acknowledgement or reassignment. |
| NT-14 | Wrong staff or stale version posts acknowledgement | Denied/conflict, not reassigned or accepted. |
| NT-15 | Staff receives or acknowledges alert | Customer human-response clock remains outstanding. |
| NT-16 | Staff alert reply/receipt loops back through webhook | Internal context, no customer lead/survey/response credit or alert recursion. |
| NT-17 | Customer window open, staff recipient window closed | Staff alert uses its own eligible approved template or blocks. |
| NT-18 | Staff destination unverified/opted out/template unavailable | No unsafe staff WhatsApp send; visible fallback/exception. |
| NT-19 | Provider timeout after possible notification acceptance | Unknown/reconcile, no blind duplicate alert. |
| NT-20 | Staff foreground/background device test | Retained evidence of intended recipient and actual notification behaviour; failures explicit. |
| NT-21 | Requested agent FYI without transcript permission | No customer data leakage and no action-owner acceptance control. |
| NT-22 | Reference or endpoint reused after staff exit | Historical request preserved; no stale dispatch to a different person. |
| NT-23 | History/observe-to-active transition | No retroactive alert flood. |
| NT-24 | Relevant customer reply arrives before acknowledgement | Response recorded; reminder can resolve honestly without invented explicit ack. |
| NT-25 | Notification channel outage and no acknowledgement | Approved internal exception/reminder handling; original customer deadline not reset. |
| NT-26 | Employee also has a customer role | Purpose/context checked; no global phone-based suppression or identity merge. |

These are tests to implement, not completed test results. Run behavioural transaction/auth tests and separately authorised tenant/device tests. Redact recipients and tokens in evidence.

## 10. Release gate and remaining decisions

Do not mark the staff handoff production-ready until one received enquiry demonstrates the same requested person across the resolved reference, verified Inbox assignment, targeted notification and authenticated acknowledgement. Prove the already-assigned-new-enquiry case as well.

Management/tenant inputs still needed: meaning/namespace of the actual incoming staff reference; verified staff-Inbox mappings; permitted alert transport; staff opt-in/destination where applicable; device test; acknowledgement/quiet-hour policy; collaboration access; exact supported API path/auth; explicit test and release permission.

No new live tenant connection or notification test was performed here. Relevant repository files were read; the whole current application was not cloned or tested.

## Sources and evidence boundaries

Parent plan: `CODEX_EARNESTPROPERTY_WHATSAPP_IMPLEMENTATION_PLAN.md`, read in full, especially Phase 3 and P4-03. Business source: supplied `Whatapps 回覆.docx` / `WHATAPPS 回覆.pdf`; neither establishes staff-alert delivery.

Repository files re-read for this addendum: `src/lib/neon/admin-team.types.ts`; `src/lib/neon/staff-ownership.ts`; `src/lib/mls/public-source-metadata.mjs`; relevant sender range in `src/lib/woztell/woztell.server.ts`. These are source observations, not deployment evidence.

Official provider sources consulted on 12 September 2026 (some individual documents are older; tenant verification remains required):

```text
W1 https://doc.woztell.com/docs/integrations/inbox/inbox-integration-public-api/
W2 https://doc.woztell.com/docs/integrations/inbox/inbox-thread-control/
W3 https://support.woztell.com/portal/en/kb/articles/inbox-notifications
W4 https://business.whatsapp.com/policy
W5 https://doc.woztell.com/docs/reference/bot-api-reference/
```

All schema names, handler-ready event, notification states, reminder thresholds, code paths and tasks introduced here are proposed engineering requirements, not claims about existing deployed functionality.
