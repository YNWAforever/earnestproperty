# Codex — implement and test the staff-reference notification handoff

**Target repository:** `YNWAforever/earnestproperty`  
**Task:** P3-N1–P3-N5, staff-reference resolution, verified handler notification and acknowledgement  
**Instruction version:** 1.2 · 12 September 2026  
**Status:** Execution instruction, not implemented application code or executed test evidence.

## 1. Execute this task

Implement the missing staff handoff in the actual application and test it. Do not return another plan-only answer, a detached sample module, or a UI showing an invented success state.

Read this instruction and `CODEX_STAFF_HANDOFF_TEST_PLAN.md` completely. The parent WhatsApp plan and notification addendum are included under `references/`. This instruction selects their staff-notification work package; do not restart the previous Phase-1-only task when those prerequisites already exist. Preserve all parent safety, identity, messaging and release constraints. This task does not authorise the rest of the CRM roadmap or production activation.

Read applicable repository `AGENTS.md` / override instructions and explicitly read `CLAUDE.md`. Keep existing guidance intact. Inspect current HEAD, branch, dirty files, package scripts, affected source and migration history. The preceding review baseline was `74d906d225d8d5ac3e20677521de870fa986843c`; it is not a reset instruction and does not establish today's implementation status.

Work incrementally on a task-specific local branch. Preserve newer and uncommitted work. No dependency upgrades, replacement database, ORM, parallel CRM, new message broker or unrelated redesign. Retain TanStack Start, Neon raw SQL, existing authentication, outbound safety and `ops_jobs`.

If parent prerequisites are missing, identify exactly which are absent: enquiry identity, source-reference persistence, live/history discrimination, verified assignment, transaction-participating jobs or human-response evidence. Implement the smallest coherent prerequisite required by this feature where safe. Do not manufacture an `assignment.confirmed` event or bypass a missing authorisation boundary. Continue independent code/offline work and report any integrated path still blocked.

**Authority:** write application code, migrations and tests in the working checkout. Execute only tests whose environment and mutation contract are safe. A present connection string is not permission to write to it. Use an explicitly designated disposable/local or staging database with synthetic data. Do not send messages, change a live tenant/number, publish links, push, merge, deploy or activate production without separate approval. Check CI/preview effects before publishing a branch.

## 2. Required outcome

For a normal new, eligible, unlocked enquiry, the person requested by the trusted incoming staff reference must remain the person assigned and notified:

```text
trusted incoming reference
  -> saved reference/mapping version
  -> requested_staff_id
  -> verified WOZTELL staff identity and actual handler
  -> staff notification addressed to that same internal staff ID
  -> explicit authenticated acknowledgement
  -> relevant human reply in the CUSTOMER conversation
```

This is identity equality after mapping, not equality of external ID strings. Do not replace requested Agent A with property-default Agent B during notification construction.

Keep these facts separate: reference resolved; assignment verified; application notification created; external transport accepted; delivered where evidenced; rendered to an authenticated staff session; explicitly acknowledged; customer replied to. No single `notified=true` or `assigned=true` flag represents the entire handoff.

**Do not alter the source service flow.** The supplied sales process has a three-hour customer-response requirement, service question, outside-hours acknowledgement, overnight 10:00 question and manager assistance. It does not approve a staff-acknowledgement deadline. Do not activate the addendum's illustrative five-/ten-minute reminder thresholds. Acknowledgement, private notes and staff-alert replies never satisfy or restart the customer's response clock. Existing unresolved calendar and reception rules stay unresolved.

## 3. Inspect and preserve integration points

Read full current implementations before changing them. Paths below are anchors from the earlier review, not proof that every proposed module already exists:

| Area | Inspect |
|---|---|
| Intake and identity | `src/routes/api.woztell.webhook.ts`, `src/lib/woztell/woztell-ingest.server.ts`, history import, existing enquiry/reference modules |
| Assignment | Current routing adapter, `updateAdminConversation`, confirmed-assignee fields, request versions and manager/manual locks |
| Staff | `staff_users`, staff roles, channel mappings, branch mapping, `src/lib/neon/staff-ownership.ts`, lifecycle services |
| Transport | `src/lib/woztell/woztell.server.ts`, outbound intents, provider-result parsing, any existing Inbox API adapter |
| Persistence/jobs | `src/lib/neon/db.server.ts`, `src/lib/control-plane/jobs.server.ts`, handler registration, migration registry |
| UI/security | `src/routes/admin.whatsapp.tsx`, AdminShell, settings, command centre, operations, pagination/attention queries and auth wrappers |
| Intake trigger | `ensure_whatsapp_inbound_lead_fn` and its regression tests; internal staff traffic must not enter it incorrectly |

Re-use newer equivalent facilities. Keep query code in server-only modules, client-safe DTOs separate, and authenticated `createServerFn` wrappers with Zod and lazy server imports. Do not hand-edit `src/routeTree.gen.ts`.

## 4. P3-N1 — Resolve and preserve the requested salesperson

### Identity model

Use explicit field names and typed boundaries for:

```text
incoming_enquiry_reference
incoming_staff_reference + reference_namespace
reference_mapping_id + reference_mapping_version
requested_staff_id
property_responsible_staff_id_at_intake
confirmed_handler_staff_id
woztell_inbox_user_id
customer_woztell_member_id + company_channel_id
staff_notification_endpoint_id + endpoint_version
```

The customer member ID identifies the thread being handled. The Inbox user ID identifies its staff assignee. A direct staff alert has a separate recipient identity. Never convert between these by string casting or by reusing an ambiguous `id` argument. Use validated constructors/types and runtime scope checks; TypeScript types alone are not authorisation.

Prefer the saved, versioned context behind a valid enquiry reference. For legacy entry points, use an exact verified alias scoped to its real source/account namespace. Record the mapping used. A name, licence number, public slug or scraped phone is a hint until matched through an approved mapping and current eligibility checks.

A customer-edited `staff_ref`, destination or node parameter must not override a trusted record silently. Record conflicts and send the enquiry to attended review. A forwarded reference does not authenticate a customer, merge two contacts or grant transcript access.

If no suitable alias facility exists, add `staff_external_references`: namespace, external reference, staff FK, validity interval, verifier, verification time and immutable mapping version. Prevent overlapping active mappings within a namespace. Preserve historical mappings; recycled aliases cannot rewrite an earlier enquiry. Do not guess namespace normalization or strip meaningful zeros/punctuation.

Keep requested identity and the selected-offering responsibility snapshot immutable under ordinary handover. Do not resolve `properties.agent_id` again as the notification recipient.

### Recipient decision

| Case | Action notification | Other notice |
|---|---|---|
| Requested A, confirmed A | A | Deduplicate A's overlapping roles |
| Requested A, property default B, fresh eligible unlocked thread | A after verified assignment | B only under approved collaboration policy |
| Requested A, protected coordinator B | B | Access-checked FYI to A only where permitted |
| Requested A unavailable, approved fallback B | B with fallback reason | A optional eligible FYI, not a false assignment |
| Unknown/conflicting reference | Configured attended triage | Visible unresolved-reference exception |
| New enquiry, same confirmed coordinator A | A gets a new enquiry alert | No unnecessary reassignment |
| Manager C takes over | C | Prior request remains historical; optional handoff FYI |

Persist a mismatch reason such as `existing_coordinator`, `protected_manager_lock`, `requested_staff_unavailable`, `requested_staff_unmapped`, `reference_conflict` or `authorised_manual_handoff`.

An FYI is not an assignment: no acknowledgement-required acceptance control, no automatic access grant, no full customer details for an unauthorised recipient. A missing triage mapping is an operational exception, not permission to select the first employee.

## 5. P3-N2 — Generate reliable per-enquiry notifications

Implement an `enquiry.handler.ready` domain transition for a fresh actionable enquiry with an eligible verified handler. Trigger it after either a new assignment is verified or the existing coordinator is verified as the correct handler for this new enquiry. A mere assignee-change listener is insufficient.

Use the selected verified assignment adapter. Do not invoke both node-based routing and direct Inbox assignment for the same decision. Remote calls occur outside database transactions. Serialize per-conversation assignment execution and preserve uncertain remote outcomes; a stale callback cannot undo a delayed remote action.

When recording the valid ready transition, lock/re-check enquiry, conversation, assignment version, activation generation and current eligibility. Commit the ready event, notification intent and validated job together. Integrate that capture with the local assignment-confirmation/new-enquiry transition; do not add an independent best-effort enqueue after success. A crash must not leave confirmed actionable work with no durable handoff.

Ready-event uniqueness is per enquiry and handling generation. A new enquiry on the same conversation/assignment version must create another notification; repeated evidence for the same enquiry must not. History imports and observe-mode events must never become actionable alert backlogs on activation.

Unresolved reference/assignment gets a separate attended routing exception. Do not wait silently for a ready event that cannot happen.

### Data records

Reuse an equivalent existing notification facility or add focused records:

| Record | Required information |
|---|---|
| `staff_notification_intents` | Cause event, enquiry/conversation, assignment version, activation generation, requested-person snapshot, recipient staff FK, purpose, work state, acknowledgement fields, logical dedupe key |
| `staff_notification_attempts` | Notification, transport, endpoint/version, attempt generation, dispatch state, provider evidence/operation identity where available, safe error and timestamps |
| `staff_notification_endpoints` | Staff owner, transport, protected destination reference, verification version/time, enabled state, permission/preferences and quiet-hours policy |

Keep work state (`pending`, `acknowledged`, `resolved`, `superseded`, `cancelled`) separate from transport state (`queued`, `dispatching`, `accepted`, `delivered`, `unknown`, `failed`, `suppressed`). A private note can use evidence kind `private_note_posted`; it must not imply mobile delivery. Store resolution reasons separately, including `resolved_by_customer_reply`.

Require one logical intent for the tuple:

```text
(enquiry_id, assignment_version, recipient_staff_id, purpose, activation_generation)
```

Use canonical tuple encoding or a stable digest rather than unsafe delimiter concatenation. Each transport/reminder generation gets its own stable attempt key. Retries are recorded honestly without creating another initial alert. Job keys must respect existing size limits.

Add FK/check/index constraints for these invariants, recipient/state pagination and due work. Keep PII out of job payloads. Credentials never belong in endpoint rows. Register additive timestamped migrations and test empty plus populated synthetic legacy schemas. Do not rewrite previously applied migrations.

Notification recipients are historical facts: supersede old work and create a new notification for a new handler. Do not bulk-rewrite old `recipient_staff_id` or `acknowledged_by` during staff handover.

## 6. P3-N3 — Pending-work UI and secure acknowledgement

Implement these authenticated application contracts, adapting names to established conventions:

```ts
listMyStaffNotifications({ cursor, status, limit })
acknowledgeStaffAssignment({ notificationId, expectedAssignmentVersion })
requestStaffAssignmentHelp({ notificationId, expectedAssignmentVersion, reason })
```

Derive the actor from the session. Validate active status, allowed role, recipient ownership, acknowledgement-required purpose, current assignment version and enquiry scope in the mutation transaction. Do not accept client-supplied recipient or `acknowledgedBy`. Use existing request-origin/CSRF protections where applicable.

A repeated valid acknowledgement is idempotent. Wrong-recipient, FYI, disabled-account and stale-assignment attempts must fail or return an explicit conflict without changing ownership. A manager must not impersonate an agent's acknowledgement; any authorised oversight action has a distinct audit meaning.

A GET/HEAD/deep-link preview changes no assignment, seen state or acknowledgement. After login, the correct recipient explicitly presses **確認接手** through POST/server action. A forwarded URL grants nothing. Use same-origin allowlisted internal links; do not encode credentials or customer bodies. Update the route's validated search schema before adding enquiry/notification parameters.

`seen_at` means authenticated visible rendering recorded through a controlled action, not human comprehension or a crawler opening a link. No rendering callback should accidentally acknowledge work.

Extend the existing inbox with a paginated pending-work panel and enquiry detail. Show requested person, confirmed handler, mismatch reason, public property/deal, source evidence, work state, transport evidence, acknowledgement and the separate customer-response deadline. Provide **查看查詢**, **確認接手**, and **需要協助** as appropriate to permissions. FYIs have no acceptance button.

Preserve inbox drafts, URL-selected conversation, message pagination, templates and permission boundaries. Refresh pending work using the existing bounded update mechanism; do not build a disconnected static list. Update server-side attention filters as well as UI labels so service messages cannot hide an unanswered enquiry.

A verified relevant customer reply may resolve pending acknowledgement reminders without setting an explicit acknowledgement timestamp. Delivery/acknowledgement must not alter `first_human_response_at`, `response_due_at` or sales stage.

## 7. P3-N4 — Private Inbox context and optional direct staff alerts

### Verified provider contract

Use a server-only Inbox adapter. Provider documentation lists `list-users`, `update-thread-agent`, `list-threads` and `internal-message`, with Inbox-specific authentication. Its examples vary in path prefix; pin a test-verified configuration rather than probing alternative production URLs. Preserve token/header redaction. [W1]

Use scope-checked thread readback for assignment evidence. For documented assignment parameters, `memberId` is the customer thread member and `userId` is the staff Inbox identity. API examples are documentation fixtures, not proof of the tenant's current behaviour. [W1]

An internal note is private context, not automatically a targeted alert. UI mentions are documented; the internal-message contract does not establish equivalent API mention behaviour. Keep automated mention capability disabled until a real tenant test confirms recipient and privacy. Device notification behaviour requires separate verification. [W2][W3]

These are provider verification constraints, not permission to change live settings. Do not pass an internal staff note to the customer-facing `sendResponses` operation, even with a `###` prefix. Preserve a transport boundary that tests can assert.

### Required baseline and mobile reach

The durable Earnest notification and acknowledgement flow are required. A private Inbox note can provide context. Do not call the feature end-to-end verified merely because either record exists: demonstrate one approved targeted alert path on the intended staff device, or report that delivery gate blocked.

Return meaningful unsupported/unverified results from an unconfigured adapter. A test double belongs only in test injection, never as runtime fallback success. Avoid new push, SMS or email infrastructure outside this task merely to bypass missing provider capability.

### Optional staff WhatsApp transport

Implement this only behind its independent flag and strict recipient contract. It targets an actively verified, permissioned STAFF endpoint, not the customer's member ID and not automatically the public staff-profile phone. Reuse proven dispatch/lease/unknown-outcome safeguards with a dedicated staff-notification purpose and context. If the existing outbox is customer-conversation-bound, do not forge a customer-bound intent; keep a correctly scoped staff dispatch record and reuse safe transport primitives within the existing job infrastructure.

At dispatch, validate endpoint ownership/version, permission, current staff eligibility, current handling generation and the staff recipient's own messaging-window/template eligibility. The customer's active window does not authorise a message to another recipient. [W4]

Before enabling, implement signed-event correlation for staff-alert messages, receipts and replies BEFORE generic customer intake/lead triggers. Correlated internal replies such as `OK` are not customer enquiries, acknowledgements through the application, or customer-response evidence. They must not recursively generate alerts. For an employee who is also a legitimate customer, use verified purpose/context; never use a blanket phone blacklist. Ambiguous messages enter protected association review without fabricated property leads or silent data loss.

Persist only minimal approved notification copy with a permission-checked work link. No full customer transcript/phone in device previews. No automatic WhatsApp-group forwarding, new company number, default template approval or opt-in assumption.

## 8. P3-N5 — Retry, reminders, monitoring and rollback

Register and test the addendum's jobs with strict ID/version payloads:

```text
woztell.enquiry.staff.notify
woztell.enquiry.staff.notify.reconcile
woztell.enquiry.staff.ack.check
```

Use existing transactional job participation, leases, supported payload versions and bounded execution. Re-check current flags, activation generation, confirmed handler, active recipient, role/access, notification state, endpoint version, transport capability and policy immediately before the irreversible boundary. Supersede stale queued work; notification delivery must never reassign a thread.

Distinguish a retryable failure before dispatch from a timeout/crash after possible acceptance. The latter stays `unknown` for reconciliation. Preserve late evidence, but never reactivate superseded work. An alert already sent cannot be described as recalled. Apply the same principle to private-note posting; duplicate internal notes are also side effects.

Reminder deadlines start from an approved readiness/notification-created rule, not a delivery delay that silently extends responsibility. Leave reminder/escalation thresholds and quiet hours unapproved until configured. A manager alert is not automatic handover unless separately authorised. Existing three-hour customer obligations remain unchanged.

Expose reference conflicts, requested/handler mismatch, unverified destinations, notification-processing lag, unknown/failed attempts and unacknowledged work in the existing operations/manager views. A routing exception without an attended recipient is a blocker, not a successful notification.

Use independent server flags, default off:

```text
EP_WA_STAFF_NOTIFICATIONS_ENABLED=false
EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED=false
EP_WA_STAFF_ACK_ESCALATION_ENABLED=false
```

Keep established customer intake/manual replies and campaign safeguards intact with flags off, including compatibility before new tables exist. A flag is necessary but not sufficient: approval, configuration, active scope and recipient checks still apply.

Rollback stops new dispatch/reminder work, supersedes stale unsent attempts and retains actionable records, signed intake, replies and history. Reconcile already executing actions. Do not replay history/observe events when re-enabled. Publish no branch with live effects merely to test rollback.

## 9. File map and implementation sequence

All new paths are proposals. Prefer a current equivalent where present:

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

Integrate with enquiry intake, routing confirmation, new-enquiry-on-existing-thread handling, handler registration, mapping/settings UI, admin inbox/attention, staff lifecycle, operations, migration registry and actual CI. Do not put the entire feature in `admin-data.server.ts`.

Implement in this order, with reviewable local changes: prerequisite checks and tests; reference/recipient policy; schema/atomic ready capture; real application acknowledgement/UI; private transport; optional staff transport/isolation; reminders/monitoring; integration/concurrency/browser verification. Continue through the scoped work rather than stopping after creating planning files. Mark unfinished dependencies precisely instead of pretending independent unit tests prove the integration.

## 10. Test execution contract

Implement all NT-01–NT-26 scenarios in `CODEX_STAFF_HANDOFF_TEST_PLAN.md`. Preserve those IDs. Add lower-level assertions for migration compatibility, auth, feature cutover and dispatch races under the relevant ID. Do not mark device/tenant assertions passed from mocks.

First inventory package scripts and inspect lifecycle/environment side effects. Use existing runners: Node `.mjs` where established, Bun for TypeScript tests, and existing browser-test infrastructure. Avoid source-string tests as the sole evidence for transactions or authorisation.

Add and wire clearly scoped scripts such as:

```text
test:staff-notifications
test:staff-notifications:db
test:staff-notifications:e2e
```

These names are proposed, not pre-existing commands. Fast tests must block unexpected provider network calls. DB tests must assert the actual production migration/query/trigger path in an explicitly safe test database. Browser tests must run the actual UI and authenticated handlers, not a static mock page. Use injected clocks, deterministic fake transport outcomes and controlled concurrency barriers.

Run relevant existing regressions after checking current definitions:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:woztell
npm run test:team
npm run test:command-center
npm run test:control-plane
npm run test:operations
npm run test:property-experience
npm run test:contact
npm run test:analytics
```

Only on a verified approved test database, run relevant `test:woztell:db`, `test:crm:db`, `test:control-plane:db` plus the implemented notification DB suite. Missing Bun, database access, browser runtime or provider credentials is a named blocker, never an invented pass. Fix introduced failures and rerun; keep pre-existing failures separate without hiding them.

Live tests require separate approved environment, synthetic customer, staff-recipient allowlist and explicit send/assignment permission. Provider/device verification does not run automatically in general CI. A configured secret or environment flag alone is not approval. Do not ask for tokens in chat or commit them in fixtures.

## 11. Deliverables and review gate

Update the parent's progress and decision records. Add a focused `STAFF_HANDOFF_VERIFICATION.md`, provider-capability evidence record and test-tenant/rollback runbook under `docs/implementation/whatsapp-enquiries/`. Report a requirement-to-test mapping for every NT ID.

Return: actual base SHA and branch; dependencies found; files changed; schema/migration status and verified environment; executed commands and exit/results; NT case statuses and evidence paths; regressions; live/provider actions actually performed (including zero); unapproved rules and exact blockers; flags; rollback; next release gates.

Use distinct labels: implemented; verified offline; verified with test database/browser; verified in tenant/device; blocked; production enabled only when explicitly approved. No repository test execution or provider delivery is implied by this instruction package.

**Stop before push, merge, deployment or live activation.** The code review gate requires integrated code and honest test evidence. The end-to-end gate additionally requires proof that the intended staff person receives the targeted notification and can acknowledge it, including a second enquiry on an already-assigned thread. A green assignment label alone is not completion.

## Source and decision record

The requirements in sections 2–8 preserve `CODEX_STAFF_REFERENCE_NOTIFICATION_ADDENDUM.md` v1.1 and its P3-N1–P3-N5 / NT-01–NT-26 structure. Detailed transaction, race, command and assertion instructions operationalise that source; they do not approve new business timings, collaboration access or transport settings.

The parent plan is included as context for existing CRM, source flow and release constraints. Its earlier initial-task stopping point does not prevent this explicitly selected scoped task; its safety gates remain. Repository `CLAUDE.md` and the relevant package-script range were re-read when preparing this instruction. No fresh whole-repository audit, build or live tenant test is claimed.

Provider sources were consulted on 12 September 2026. They remain documentation evidence, not authenticated tenant observations:

```text
W1 https://doc.woztell.com/docs/integrations/inbox/inbox-integration-public-api/
W2 https://doc.woztell.com/docs/integrations/inbox/inbox-thread-control/
W3 https://support.woztell.com/portal/en/kb/articles/inbox-notifications
W4 https://business.whatsapp.com/policy
O1 https://developers.openai.com/codex/guides/agents-md/
```
