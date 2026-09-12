# Staff handoff implementation verification

Date: 2026-09-12. Review gate only; **not end-to-end or production verified**.

Branch: `codex/staff-reference-handoff`. Base and current committed HEAD: `b6d049e9e9d59b9aececf13b5e990f9a13647f23`. Changes are local and uncommitted. Pre-existing `bun.lockb` status is preserved. Original three supplied specification files in this directory compare byte-for-byte equal to Downloads originals.

## Implemented paths and schema mapping

| Requirement | Actual integrated implementation |
|---|---|
| P3-N1 identity | 160000 migration: exact namespace/alias/version validity, immutable inquiry context and selected-property owner snapshot; authenticated reference editor; tracking-link versions pin mapping identity; injected hints cannot pick recipients |
| P3-N2 readiness | 170000 migration: live capture eligibility, per-enquiry ready events, notification intent and ops job in one transaction; confirmed assignment and same-handler new enquiry paths; smallest fresh-request assignment dependency uses existing assignment jobs |
| P3-N3 acceptance | Real TanStack server functions and authenticated request handler; current staff/role/mapping/enquiry/generation/version guards; recipient-specific Inbox cards, independent help/ack and response deadline |
| P3-N4 privacy | Server-only configured Inbox adapter, private-note evidence, separate optional staff destination transport, versioned endpoints and historical attempt snapshots, unknown outcome reconciliation, signed event isolation before customer intake |
| P3-N5 management | Default-off flags, registered notification jobs and migration versions, recipient paging, endpoint/reference administration, manager help/routing queue and protected ambiguous-message read model; no approved reminder policy seeded |

Migration 160000 adds `staff_external_references`, tracking-version mapping key and immutable inquiry fields. Migration 170000 adds `staff_notification_ready_events`, `staff_notification_intents`, `staff_notification_endpoints`, `staff_notification_attempts`, `staff_notification_routing_exceptions`, `staff_notification_internal_events`, captured eligibility and atomic triggers. Existing CRM/transcript/property and ops_jobs remain canonical. Historical recipients/acknowledgers are excluded from bulk staff handover; endpoint/reference identity requires separate reconciliation.

Migrations were applied/replayed only in unique synthetic schemas on approved `br-quiet-hat-aoxbj2ue`, then those schemas were cleaned up. No shared or production migration applied. No live WOZTELL provider operations, device messages, secrets/schedules changes, activation, commit, push, merge or deployment performed.

## Commands and actual results

Evidence logs are local under `.audit/staff-handoff/`; they contain synthetic checks, not live tenant proof.

| Command | Actual result |
|---|---|
| `npm.cmd run test:staff-notifications` | 9 Node + 4 Bun passed, 0 skipped; exit 0 |
| `node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/staff-reference.db.test.mjs src/lib/whatsapp-enquiries/staff-notifications.db.test.mjs` | 24 passed, 0 failed, 0 skipped; exit 0; real isolated SQL, no mock DB |
| `node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/workflow.db.test.mjs src/lib/whatsapp-enquiries/episodes.db.test.mjs src/lib/whatsapp-enquiries/assignment.db.test.mjs src/lib/whatsapp-enquiries/service-workflow.db.test.mjs` | 45 passed, 0 failed, 0 skipped; exit 0 |
| `npm.cmd run test:whatsapp-enquiries` | 69 passed; exit 0 |
| `npm.cmd run test:woztell` | 137 Node + 8 Bun passed; exit 0 |
| `npm.cmd run test:team` | 82 Node + 24 Bun passed; exit 0 |
| `npm.cmd run test:command-center` | 77 Node + 8 Bun passed; exit 0 |
| `npm.cmd run test:control-plane` | 95 passed; exit 0 |
| `npm.cmd run test:operations` | 19 Node + 8 Bun passed; exit 0 |
| `npm.cmd run test:property-experience` | 145 Node + 195 Bun passed after fixing introduced ownership inventory expectations/DDL column formatting; exit 0 |
| `npm.cmd run test:contact` | 58 Node + 18 Bun passed; exit 0 |
| `npm.cmd run test:analytics` | 44 passed; exit 0 |
| `npm.cmd run typecheck` | Final exit 0, no TypeScript errors |
| `npm.cmd run build` | Final exit 0, actual client/server build |
| `npx.cmd eslint . --format json` | Exit 1: Windows CRLF plus existing repo lint baseline. Initial raw run 148155 findings included line-endings/draft formatting; not a clean lint claim |
| `npx.cmd eslint . --ignore-pattern '.audit/**' --rule 'prettier/prettier: [error, {endOfLine: auto}]' --format json` | 362 existing findings, exit 1, below CI ratchet 381; no findings in changed files at that run. Final rerun also 362, no changed-file findings; no lint baseline raised |
| `npm.cmd run test:staff-notifications:e2e` | Blocked, exit 1 before browser launch: missing `PLAYWRIGHT_BASE_URL` and approved storageState/fixture manifest |

CI includes the deterministic named notification script. DB/browser scripts are explicitly registered as environment-dependent; missing environments are not reported as passed. Existing shared-schema DB suites (CRM/control-plane/etc.) and live/device tests were not executed: this task's DB permission is isolated synthetic schemas only.

## NT-01–NT-26 evidence matrix

`U` means actual pure/transport-contract or rendered production component tests; `D` real SQL/transactions/triggers; `H` actual application request handler and production staff resolver with only external session/transport doubled. `B` requires actual authenticated app and prepared synthetic fixtures; `L` requires separately approved tenant/device operations. Offline success never proves L. Commands above run the named test files; full subtest titles are retained in the logs.

| ID | Implemented test evidence | Remaining requirement |
|---|---|---|
| NT-01 | U/D: requested A/property B immutable reference; actual requested assignment/reconcile/ready recipient; forced confirmation rollback | B source-intake chain and L pilot blocked |
| NT-02 | U/D: exact source/account namespaces, significant zeros, validity and overlapping mapping rejection | No live alias verification claimed |
| NT-03 | U/D: conflicting saved identity and injected hints; strict H request data rejects posted actor | Full customer-injection browser journey blocked |
| NT-04 | D + transport: distinct internal/customer/Inbox/staff endpoint identities; recipient guards | L exact tenant identity readback |
| NT-05 | U/D: private adapter only, work link lacks PII; staff traffic isolation; no customer send spy | L absence on customer device |
| NT-06 | U: unverified capability fails; private-note-posted never device-delivered | L targeted mention semantics unavailable |
| NT-07 | D: second enquiry/same assignment, replay creates one new intent/job | B prepared-state test authored, full intake B/L blocked |
| NT-08 | D: repeated concurrent readiness and dispatch claim | No remote exactly-once promise |
| NT-09 | D/U: protected B retains requested A, explicit reason; FYI action hidden | Collaboration FYI suppressed, no approved policy; B blocked |
| NT-10 | D: approved fallback preserves requested identity; absent fallback is attended exception | Actual fallback staff availability/tenant access verification |
| NT-11 | D: ready/intent/job atomic; injected job failure rolls actual confirmed assignment back; retry durable | Additional process-kill/live-worker drill not run |
| NT-12 | D: endpoint/version changes, forced cached-endpoint/attempt-conflict interleaving prevents old destination; stale ack denied | B interactive manager takeover + L callbacks |
| NT-13 | H: real resolver, unsigned session denied; GET/HEAD cannot mutate; rendered U has no side effects | B anonymous/viewer journeys authored but blocked |
| NT-14 | D/H: wrong recipient/viewer/disabled/stale/FYI denied; valid duplicate idempotent; closed/retired/ended generation denied | B takeover race blocked |
| NT-15 | D/U: ack/help/transport do not set human reply or move original deadline | Full B/L customer reply chain blocked |
| NT-16 | D: actual signed-flag ingress isolates correlated receipts/replies before customer writes | L signed tenant callback/reply fixtures unavailable |
| NT-17 | D: staff closed window blocks regardless of customer context; fresh correlated own reply evidence isolated | Initial live own-window onboarding and approved template path blocked |
| NT-18 | D/H: role/version/permission endpoint administration, current dispatch eligibility, secret-safe DTOs | Outside-window template contract unavailable; no guessed fallback |
| NT-19 | D: unknown possible acceptance and expired lease do not blindly resend | Actual provider timeout evidence unavailable |
| NT-20 | L only: **blocked**, not passed | Approved tenant, allowlisted intended staff device and observed notification/ack required |
| NT-21 | U/H: FYI has no acknowledgement; list/action recipient-only and existing transcript auth retained | No FYI emitted without approved access policy; B forwarded-link check blocked |
| NT-22 | D: alias recycling retains old identity; immutable recipient/destination snapshots; endpoint change invalidates window | Operational live handover/destination-reuse drill |
| NT-23 | D: captured flag-off/history/observe do not activate later; additive migration rerun preserves populated synthetic data | Staging rollout/rollback drill blocked |
| NT-24 | D/U: relevant response resolution trigger resolves work without acknowledgement; original reply regressions pass | Full B authenticated customer-send chain blocked |
| NT-25 | D: pending check creates zero unapproved reminders; manager help/health visible, original service tests pass | No approved acknowledgement reminder policy/automatic reassignment; proposed 5/10 minutes not activated |
| NT-26 | D: customer-context reply/trusted property reference stays customer; correlated internal traffic isolated; ambiguous payload retained for protected manager review | Manual disposition/replay procedure and live dual-role pilot must be approved before optional transport activation |

## Review and blockers

Independent read-only review found and prompted fixes for current-eligibility acknowledgement, manager attention details, protected external work links, fresh-routing role checks and cached-endpoint dispatch races. Final review status is recorded below.

Browser files exercise actual application prepared states, not a demo or fake success page. They do not yet prove provisioning/intake, provider-confirmation, interactive takeover or relevant customer send in a browser. Those checks require the approved A/B/M/viewer login fixture, staging provider double and matching synthetic DB/app. No authenticated fixture has been supplied. No actual device delivery or acceptance by the intended staff member has been observed.

Other activation blockers: verified tenant path/auth, staff/folder access, configured attendance manager/policy, independent endpoint consent/quiet hours, initial own-window evidence, optional template locator contract, approved ambiguous-message handling procedure and explicit release authority. `EP_WA_STAFF_NOTIFICATIONS_ENABLED`, `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED`, `EP_WA_STAFF_ACK_ESCALATION_ENABLED` remain false. The five/ten-minute reminder proposal remains unapproved.

Use STAFF_HANDOFF_RELEASE_RUNBOOK.md for staged commands, replay and rollback. Keep schema/history on rollback; switch flags off rather than resetting unknown attempts or deleting CRM/transcript/inventory.

## Changed files

Final inventory: `bun.lockb` is pre-existing status, not an implementation edit.

- `.env.example`
- `.github/workflows/ci.yml`
- `docs/implementation/whatsapp-enquiries/DECISIONS.md`
- `docs/implementation/whatsapp-enquiries/PROGRESS.md`
- `docs/implementation/whatsapp-enquiries/staff-handoff/CODEX_IMPLEMENT_AND_TEST_STAFF_HANDOFF.md`
- `docs/implementation/whatsapp-enquiries/staff-handoff/CODEX_STAFF_HANDOFF_TEST_PLAN.md`
- `docs/implementation/whatsapp-enquiries/staff-handoff/CODEX_STAFF_REFERENCE_NOTIFICATION_ADDENDUM.md`
- `docs/implementation/whatsapp-enquiries/staff-handoff/PROVIDER_CAPABILITIES.md`
- `docs/implementation/whatsapp-enquiries/staff-handoff/STAFF_HANDOFF_RELEASE_RUNBOOK.md`
- `docs/implementation/whatsapp-enquiries/staff-handoff/STAFF_HANDOFF_VERIFICATION.md`
- `e2e/staff-handoff.spec.ts`
- `neon/migrations/20260912160000_staff_reference_snapshots.sql`
- `neon/migrations/20260912170000_staff_notifications.sql`
- `package.json`
- `scripts/test-staff-handoff-browser.mjs`
- `src/components/admin/StaffEndpointEditor.tsx`
- `src/components/admin/StaffNotificationCard.test.tsx`
- `src/components/admin/StaffNotificationCard.tsx`
- `src/components/admin/StaffNotificationPanel.tsx`
- `src/components/admin/StaffReferenceEditor.tsx`
- `src/lib/control-plane/job-handlers.server.ts`
- `src/lib/control-plane/migration-versions.js`
- `src/lib/neon/staff-endpoints.server.ts`
- `src/lib/neon/staff-endpoints.ts`
- `src/lib/neon/staff-notification-handlers.server.ts`
- `src/lib/neon/staff-notifications.server.ts`
- `src/lib/neon/staff-notifications.ts`
- `src/lib/neon/staff-notifications.types.ts`
- `src/lib/neon/staff-ownership.test.mjs`
- `src/lib/neon/staff-ownership.ts`
- `src/lib/neon/staff-reference-admin.server.ts`
- `src/lib/neon/staff-reference-admin.ts`
- `src/lib/neon/whatsapp-enquiries.server.ts`
- `src/lib/neon/whatsapp-enquiries.ts`
- `src/lib/neon/whatsapp-enquiries.types.ts`
- `src/lib/whatsapp-enquiries/assignment.server.ts`
- `src/lib/whatsapp-enquiries/episodes.db.test.mjs`
- `src/lib/whatsapp-enquiries/episodes.server.ts`
- `src/lib/whatsapp-enquiries/staff-event-isolation.server.ts`
- `src/lib/whatsapp-enquiries/staff-notifications.db.test.mjs`
- `src/lib/whatsapp-enquiries/staff-notifications.server.ts`
- `src/lib/whatsapp-enquiries/staff-notifications.test.mjs`
- `src/lib/whatsapp-enquiries/staff-reference.db.test.mjs`
- `src/lib/whatsapp-enquiries/staff-reference.test.mjs`
- `src/lib/whatsapp-enquiries/staff-reference.ts`
- `src/lib/whatsapp-enquiries/webhook.server.ts`
- `src/lib/whatsapp-enquiries/workflow.server.ts`
- `src/lib/woztell/inbox-api.server.ts`
- `src/lib/woztell/staff-whatsapp-transport.server.ts`
- `src/lib/woztell/woztell-ingest.server.ts`
- `src/routes/admin.whatsapp-links.tsx`
- `src/routes/admin.whatsapp-settings.tsx`
- `src/routes/admin.whatsapp.tsx`
- `src/test-wiring.test.mjs`

- `docs/implementation/whatsapp-enquiries/staff-handoff/STAFF_HANDOFF_REVIEW.md`

## Final review and check record

- Independent root run: `test-staff-notifications-final.log` 9 Node + 4 Bun passed; `staff-db-final.log` 24 passed / zero skips, exit 0.
- Existing enquiry isolated-DB regression: 45 passed / zero skips. Named offline regression matrix completed with all nine exits 0 in `regression-final-results.txt`.
- Final typecheck and actual application build both exit 0. Final Windows-aware lint has 362 pre-existing findings and zero changed-file findings; raw lint is not called clean.
- Independent read-only source review: all raised findings resolved; no remaining confirmed P0/P1/P2 in reviewed scope. See STAFF_HANDOFF_REVIEW.md. Review does not substitute for unrun B/L verification.
- No new rollout, policy, recipient permission or tenant/device capability was approved by the implementation tests. Stop at review gate.
