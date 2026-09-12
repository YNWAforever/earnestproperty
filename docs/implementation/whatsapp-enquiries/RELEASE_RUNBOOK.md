# Release runbook — Phase 3 review gate

## Current release status

Local implementation only. No deployment or production schema apply authorized/performed in this task. New migration: `20260912120000_whatsapp_enquiry_events.sql`, registered in the migration inventory. Test application is limited to generated schemas on designated disposable branch `br-quiet-hat-aoxbj2ue`, dropped after tests.

## Controls (server-only)

```text
EP_WA_ENQUIRY_MODE=off
EP_WA_TRACKED_LINKS_ENABLED=false
EP_WA_ROUTING_ENABLED=false
EP_WA_SERVICE_AUTOMATION_ENABLED=false
```

Enquiry observation and tracked links are implemented. Routing execution is capability-blocked and service automation remains absent. Preserve existing WOZTELL_ENABLED and existing staff messaging configuration. Never expose credentials or controls as public VITE variables.

Observe additionally requires verified WOZTELL_CHANNEL_ID and WOZTELL_APP_ID, existing signature secret and applied event schema. Do not activate observe against old workers: first deploy registered handler capability everywhere, then enable capture. Schema-off requests remain compatible with established webhook/history behaviour. Observe missing schema gives WA_ENQUIRY_SCHEMA_REQUIRED / HTTP 503.

## Commands (from the task checkout)

```powershell
npm.cmd run test:whatsapp-enquiries
npm.cmd run test:woztell
npm.cmd run test:control-plane
npm.cmd run test:command-center
npm.cmd run test:operations
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/workflow.db.test.mjs
```

The database suite requires ASTRA_TEST_DATABASE_URL and exact ASTRA_TEST_BRANCH_ID=br-quiet-hat-aoxbj2ue. It uses only synthetic rows and randomly named schemas. Do not substitute DATABASE_URL. A different designated target requires an explicit test-guard update/review, not removing confirmation.

Before any future production release: record approved target and release SHA; inspect migration drift; obtain explicit migration/deploy permission; apply additive migration through the existing migration process; deploy compatible readers and workers while mode remains off; verify signed synthetic traffic and queue processing on an authorized tenant; obtain operator approval for observation. Do not run `neon:migrate` here merely to inspect readiness: it applies all pending migrations.

## Replay and rollback

- Repeated signed live deliveries deduplicate the event/job independently of transcript insertion. History can safely precede/follow live ingestion.
- Observation retries are internal only; existing job lease/checkpoint/idempotency rules apply.
- Set enquiry mode off to stop new capture. Pending observe jobs become suppressed when processed; no outbound effect exists in this handler. Retain ledger/transcript/job evidence.
- Existing manual replies, receipt ingestion, history and campaigns remain separate. Never replay unknown provider sends as if they were refused.
- Do not drop ledger, messages, contacts or the WhatsApp account to roll back. Retain schema for compatible future diagnosis. Old workers must not claim unsupported queued jobs; drain or cancel only identified enquiry jobs before reverting worker capability.

## Historical Phase 1 gate prerequisites

Phase 1 review acceptance; approved live tenant/app/channel and synthetic recipients; verified/redacted tenant event and send-result samples; mapping authority; links/enquiry episode migration and permissions design; activation generation/cutover and retention/export/delete policy. Business D01-D09 remain unapproved and block the relevant later phases. No automatic continuation into Phase 2.

## Phase 2/3 release and rollback additions

New ordered additive files after the Phase 1 event migration:

1. `20260912130000_whatsapp_enquiry_episodes.sql`
2. `20260912140000_whatsapp_assignment_evidence.sql`

Both are registered in `migration-versions.js` and were applied/replayed only in isolated synthetic schemas. Production application is NOT performed. The existing all-pending migration runner must not be invoked until every pending file/target has been reviewed and explicitly approved. Do not substitute production DATABASE_URL into test commands.

Server variables added to `.env.example`:

| Variable | Source / release requirement |
| --- | --- |
| EP_WA_COMPANY_CHANNEL_ID | Operator-verified company WOZTELL channel; must agree with ingestion channel |
| EP_WA_COMPANY_PHONE | Verified company WhatsApp number; never individual staff phone |
| EP_WA_TRACKED_LINKS_ENABLED | false until deployment, company target and placements approved |
| EP_WA_ENQUIRY_MODE | off or observe only; no active mode implemented |
| EP_WA_ROUTING_ENABLED | false; live provider factory additionally refuses an unverified contract |
| EP_WA_SERVICE_AUTOMATION_ENABLED | false; Phase 4 not implemented |

Deployment order, for a separately authorized release: review current pending inventory and backup/restore evidence; apply the ordered additive migrations with controls off; deploy compatible app and ops_jobs worker; verify authenticated synthetic capture and staff permissions; verify company channel/number and immutable placements; then obtain operator approval to enable observe/links. Do not use guessed credentials or declare a mock run live verification.

Before any actual remote assignment: provide authorized tenant fixtures and verified redirect/readback contract, reconcile direct WOZTELL manual changes or approve a single-control-surface pilot policy, prove folder/node accessibility and staff roles, and review reconciliation of unknown/stale requests. No endpoint/callback authority is currently implemented as a substitute. Approved duty/branch/reception rules must be configured, not inferred.

Before Inbox human-response capability activation: verify exact persisted metadata/source/app/channel/agentUserId and timestamps against the real tenant. `whatsapp_inbox_evidence_capabilities` is empty by default. Admin mapping review does not populate or prove that capability. No live activation was performed.

Rollback: set tracked links false and enquiry mode off; retain this compatible reader/worker release with effects disabled. Do not drop episodes, snapshots, requests, evidence or transcripts. Existing assignment triggers still route local owner changes to pending requests, so an older UI which calls those changes confirmed is NOT a safe rollback target. Leave unknown/executing requests excluded; never reset them to pending/replay remotely without verified reconciliation. Retire links with a new disabled version; forwarded old references retain historical evidence. No migration down script deletes inventory or customer records.

Exact test commands from `.worktrees/whatsapp-enquiries-p1`:

```powershell
npm.cmd run test:whatsapp-enquiries
npm.cmd run test:woztell
npm.cmd run test:command-center
npm.cmd run test:property-experience
npm.cmd run test:team
npm.cmd run test:control-plane
node --test src/lib/neon/staff-ownership.test.mjs src/test-wiring.test.mjs
node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/workflow.db.test.mjs src/lib/whatsapp-enquiries/episodes.db.test.mjs src/lib/whatsapp-enquiries/assignment.db.test.mjs
npm.cmd run typecheck
npm.cmd run build
```

`test:whatsapp-enquiries:db` is an explicit environment-dependent script. Export ASTRA_TEST_DATABASE_URL and ASTRA_TEST_BRANCH_ID before npm invocation, or use the direct Node command above. In this environment `node --env-file=... --run ...` did not propagate those variables into the child and skipped tests; that invocation is not verification evidence. The direct command ran all 30 checks with zero skips.

Phase 4 dependencies: approved D01-D09/business service policy, calendar/copy versions, escalation/absence handover, verified tenant delivery/readback, service actor and bounded scheduling, retention/export/deletion operations. Stop here for review.

## Phase 4 service automation / Phase 5 pilot gate

No deployment, production migration, live schedule/secret change, message, commit or push was performed. This section is an operator runbook, not authorization.

1. Freeze/review the current changes into a commit only when authorized; replace the baseline SHA and dirty flag in RELEASE_RECORD.json with that exact release commit.
2. On an explicitly designated staging target, apply the four additive WhatsApp migrations in timestamp order (120000 events, 130000 episodes, 140000 assignment evidence, 150000 service workflow); record actual app_migrations versions. Never point isolated test commands at production. Keep EP_WA_ENQUIRY_MODE=off, EP_WA_ROUTING_ENABLED=false, EP_WA_SERVICE_AUTOMATION_ENABLED=false and EP_WA_ACTIVATION_ID empty during rollout.
3. Verify the existing company channel/number, staff-folder-node mappings, assignment readback, live Inbox evidence, service response/button fixture, opted-out behavior, and any approved outside-window template. Implement/verify the live adapter before activation; createLiveServiceTransport currently throws WOZTELL_SERVICE_TRANSPORT_UNVERIFIED. No mock adapter belongs in production.
4. Save and explicitly approve complete policy/copy with a decision evidence reference in /admin/whatsapp-settings. Policy approval alone does not enable service. A separately authorized server operator can call activateServiceGeneration(policyId, actorStaffId) and configure its returned generation as EP_WA_ACTIVATION_ID; also configure the verified company channel.
5. Only after release approval, enable active mode and intended flags, and publish the reviewed existing cron worker change. Source map must retain exact expressions: * * * * * -> /api/admin/whatsapp/service-worker; */5 * * * * -> existing control-plane worker; */10 * * * * -> existing send queue. CRON_SECRET is server-side and must match; never paste it into evidence. No schedule was deployed here.
6. Run the authorized synthetic tenant journey: tracked open -> customer message -> persisted episode -> confirmed provider handler -> staff reply and human-response evidence -> service survey -> assistance in Live Chat -> one manager task/confirmed assignment/eligible acknowledgement. Capture redacted event, enquiry, assignment, intent and job IDs with timestamps and measured total eligibility-to-outcome lag. A local claim benchmark is not this end-to-end measure.
7. Obtain one-branch/two-staff/one-manager pilot approval, plus one website offer and separately authorized verified 28Hse/YouTube placements. Record fallback and reconcile each journey; do not label opens as people or survey closure as a sale. Expand only after accepted pilot and rollback evidence.

Read-only gate command:

```powershell
node scripts/whatsapp-enquiries/check-release.mjs docs/implementation/whatsapp-enquiries/RELEASE_RECORD.json
```

Expected current exit is 1 (not ready). Evidence references contain no secrets or customer bodies.

Rollback: disable routing/service flags and active intake first. End the current activation generation under operator authorization before later reactivation, which must create a fresh generation. Preserve transcript, CRM records, outbox outcomes, event eligibility and all additive tables. Do not delete evidence, reset old events, or retry unknown provider sends/assignments. Inspect /admin/operations unknown counts and reconcile authoritative provider identities; review old pending work rather than upgrading it. Restore prior cron configuration only under deployment approval, keeping existing campaign/history workers. Test rollback against synthetic staging cases and record evidence before pilot approval. A source rollback must not run destructive down migrations.
