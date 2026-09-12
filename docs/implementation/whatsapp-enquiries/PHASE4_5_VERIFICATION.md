# Phase 4 implementation and Phase 5 preparation — 2026-09-12

Branch: `codex/whatsapp-enquiries-p1`. HEAD/base: `74d906d225d8d5ac3e20677521de870fa986843c`. Working tree remains uncommitted, including preserved Phase 0–3 work. No reset, commit, push, merge or deployment. Original plan remains unchanged. See CHANGED_FILES.txt for the full branch inventory.

## Delivered scope and schema mappings

| Task | Implementation | Status |
|---|---|---|
| P4-01 | service-policy.ts, service-copy.ts, policy-admin.server.ts, authenticated wrappers and WhatsappServicePolicyEditor in WhatsApp settings | Implemented; hypothetical calendars tested; real rules unapproved |
| P4-02 | service-workflow.server.ts, existing outbound-intent.server.ts, purpose-limited service actor, dispatch rechecks | Implemented with injected synthetic transport; live adapter deliberately fails closed |
| P4-03 | token-bound survey answer processing, one task/protected assignment, manager acknowledgement reconciliation | SQL/fixture tested; real Live Chat and notification access require tenant evidence |
| P4-04 | existing ops_jobs capability filtering, bounded service lease recovery, versioned reply v2, authenticated service-worker route, one-minute cron source map | Implemented and load-tested locally against isolated Neon schema; schedule not deployed |
| P4-05 | service-health.server.ts, admin operations panel | Role/actual SQL checked; no unknown-send retry control |
| P5-01 | release-readiness.ts, check-release.mjs, RELEASE_RECORD.json, release/rollback runbook | Implemented; current gate intentionally blocked |
| P5-02–04 | Authorized tenant journey, pilot and expansion | Not executed; approvals/provider evidence missing |
| Phase 6 | No such phase in the supplied plan | Undefined; clarification requested |

New migration `20260912150000_whatsapp_service_workflow.sql` is registered in MIGRATION_VERSIONS. It adds activation generations, service actions/worker heartbeat, survey correlation/state and guarded service outbox ownership. Existing inquiries, transcript, contacts, CRM activity/assignment evidence, outbound intents and ops_jobs remain authoritative. No replacement database, queue, ORM, runtime or CRM.

All four WhatsApp migrations were exercised only inside random synthetic schemas on explicitly approved disposable branch `br-quiet-hat-aoxbj2ue`. Each suite cleans its own schema. No production migrations or shared staging application migration ledger were advanced. Phase 4 migration replay was tested. A test migration execution is not a production release record.

## Actual commands and results

Commands run from the worktree. Logs are under ignored `.audit/`.

| Command | Result | Evidence |
|---|---|---|
| `npm.cmd run test:whatsapp-enquiries` | 69 passed, 0 failed, 0 skipped | phase4-enquiries-final.log |
| `node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/workflow.db.test.mjs src/lib/whatsapp-enquiries/episodes.db.test.mjs src/lib/whatsapp-enquiries/assignment.db.test.mjs src/lib/whatsapp-enquiries/service-workflow.db.test.mjs` | 45 passed including parent tests, 0 failed, 0 skipped | phase4-db-final.log |
| `npm.cmd run test:woztell` | 137 Node + 8 Bun passed | phase4-woztell.log |
| `npm.cmd run test:operations` | 19 Node + 8 Bun passed | phase4-operations.log |
| `npm.cmd run test:control-plane` | 95 passed | phase4-control-plane.log |
| `npm.cmd run test:team` | 82 Node + 24 Bun passed | phase4-team.log |
| `npm.cmd run test:command-center` | 77 Node + 8 Bun passed | phase4-command-center.log |
| `node --test src/lib/neon/staff-ownership.test.mjs src/test-wiring.test.mjs` | 15 passed | phase4-wiring.log |
| `npm.cmd run build` | Exit 0; existing chunk-size warnings | phase4-build-final.log |
| `npm.cmd run typecheck` | Exit 0 | phase4-typecheck-final.log |
| ESLint on all 53 changed src TypeScript files, excluding generated route tree | Exit 0; 0 errors, 0 warnings | phase4-eslint-final.json |
| `git diff --check` | Exit 0; LF/CRLF notices only | final command output |
| `node scripts/whatsapp-enquiries/check-release.mjs docs/implementation/whatsapp-enquiries/RELEASE_RECORD.json` | Exit 1, ready=false, expected missing release evidence | phase5-readiness.log |

Earlier policy regressions were reproduced before fixes: offset-free/impossible timestamps and a survey scheduled before intake. Reviewer crash findings led to atomic SLA scheduling, accepted-intent recovery without resend, repeatable manager acknowledgement reconciliation and preserving closed surveys during repeated finalization. Older observe-only test expectations were updated for Phase 4 while retaining ineligible history/observe semantics.

## Acceptance evidence and limits

- AT-38–42: policy approval/completeness, distinct deadlines, timezone/boundary/holiday/invalid input, server authorization tested.
- AT-43/44/52: outside-window/template-unverified, opt-out and disabled queued effects blocked in database dispatch tests. No approved live template claimed.
- AT-45–48: synthetic reply decoder validates actual persisted survey/member/channel/token and idempotent task/thanks behavior. Live Chat tenant behavior is **not verified**. Numeric 1/2 and unknown button shapes are not interpreted as answers.
- AT-49: concurrent sends, accepted-outbox recovery, final-attempt lease loss and unknown suppression tested. No provider exactly-once guarantee claimed.
- AT-50/51: service claims tested under 1,000 history rows with duplicate workers; stale worker capability blocked at SQL boundary. This measures local claim latency only, not end-to-end eligibility-to-delivery lag. Approved live lag and real mixed-load operation remain release blockers.
- AT-53–56: actual folder access, permitted source placements, real end-to-end reconciliation and live rollback drill remain **blocked**, not passed by mock evidence. Offline off/observe/unknown/legacy regressions are supporting evidence only.

No browser interaction/visual accessibility pass was performed for the new settings and health panels. Existing component regressions, server authorization tests, real SQL checks, typecheck and application build are separate evidence; browser verification remains a staging prerequisite. Broad legacy database scripts that mutate shared schemas were not run. No live WOZTELL call, number/tenant change, message, public link publication, production migration, deployed schedule or secret change was performed.

## Activation and rollback

Defaults remain off/false: EP_WA_ENQUIRY_MODE, EP_WA_ROUTING_ENABLED, EP_WA_SERVICE_AUTOMATION_ENABLED, EP_WA_TRACKED_LINKS_ENABLED; EP_WA_ACTIVATION_ID is empty. Existing WOZTELL_ENABLED remains independent. Runtime approval, verified channel and generation checks are additional requirements.

See RELEASE_RUNBOOK.md for staged migration/worker rollout, operator generation activation, one-branch/two-staff/one-manager pilot and rollback. Disable new effects first; end the activation generation before later reactivation; preserve transcript/CRM/outbox/event evidence and reconcile unknown results without blind retries. RELEASE_RECORD.json deliberately records no production migrations, no approved policy, and no tenant/placement/rollback evidence.
