# Staff handoff release and rollback gate

No release is authorized by this report. Keep all three `EP_WA_STAFF_*_ENABLED` flags false. No production migration, environment/schedule change, commit, push, deployment or message has been performed in this task.

## Prerequisites and order

1. Review the diff against `b6d049e9e9d59b9aececf13b5e990f9a13647f23` on `codex/staff-reference-handoff`. Preserve unrelated `bun.lockb` status. Original supplied specifications in this directory are unchanged.
2. Obtain explicit staging migration authorization and confirm the database/app/auth/provider target. For tests, only `br-quiet-hat-aoxbj2ue` with per-run random schemas and synthetic data is designated. Existing DB suites that need shared schema migration are not authorized by these tests.
3. Apply additive `20260912160000_staff_reference_snapshots.sql`, then `20260912170000_staff_notifications.sql`, after existing enquiry migrations through 150000. Use the existing migration runner with an explicitly reviewed staging target; do not point it at production. Both new versions are registered in the control-plane inventory.
4. Deploy compatible code/workers with notifications, direct staff WhatsApp and acknowledgement escalation disabled. Obtain separate deployment permission first. Do not activate old events: eligibility is captured at live intake and immutable across flags/generations.
5. Obtain approved test staff A/B/M/viewer login states and prepare synthetic active generation, property B / requested A references, E1/E2 and takeover fixtures through production functions and a test-bound external adapter. Run DB/H tests, then browser journeys. Browser state must match the same staging DB, not production. Never add an auth bypass to the deployed app.
6. Supply verified server-only Inbox path/auth evidence; verify assignment readback, private note isolation, actual staff-device arrival and authenticated acknowledgement. Repeat second-enquiry/same-handler. Record NT-20 separately; API success is insufficient.
7. Optional direct staff transport needs separate permissioned endpoints, own-window evidence, template/correlation fixtures, dual-role employee checks and explicit enablement approval. No default five/ten-minute reminders. Activate only a fresh approved generation and operator-approved pilot.

## Exact local checks (PowerShell, from this worktree)

```powershell
npm.cmd run test:staff-notifications
node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/staff-reference.db.test.mjs src/lib/whatsapp-enquiries/staff-notifications.db.test.mjs
node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/whatsapp-enquiries/workflow.db.test.mjs src/lib/whatsapp-enquiries/episodes.db.test.mjs src/lib/whatsapp-enquiries/assignment.db.test.mjs src/lib/whatsapp-enquiries/service-workflow.db.test.mjs
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:staff-notifications:e2e
```

The env file supplies only the previously approved test target; never print its contents. Database suites create unique schemas and clean up only those schemas. Browser command deliberately fails before launching when prerequisites are missing. `PLAYWRIGHT_BASE_URL` must be the approved staging app. `STAFF_HANDOFF_BROWSER_FIXTURE` must point to a private JSON manifest with `agentAState`, `agentBState`, `viewerState` (Playwright storageState file paths), `url`, `staleUrl`, `firstNotificationId`, `secondNotificationId`, `staleNotificationId`, `requestedName`. The URLs must point at the prepared synthetic conversation/enquiry. Do not commit authenticated storageState. Browser tests cover prepared UI states; full intake/provider-confirmation/customer-reply and interactive takeover execution remain a separately configured integration gate, not proven by those prepared states.

## Replay and outage recovery

Read-only work opens never acknowledge. Use the original enquiry/event identity for retries. `wa_capture_staff_ready` is keyed by enquiry/version/recipient/generation; its trigger commits readiness, intent and job together. Existing ops worker job IDs and leases remain authoritative. A definitive pre-send block stays visibly suppressed. Possibly accepted/expired-lease work becomes unknown and is not automatically sent again. Inspect attempt/provider evidence before any operator recovery; never reset unknown to queued to make a retry succeed. Reassignment creates new work, preserving old recipient/acknowledger history. Late receipts update historical transport evidence only.

## Rollback

Obtain explicit environment-change permission; turn off staff notifications, direct staff WhatsApp and acknowledgement escalation first. Pause the affected service lane only if separately authorized and needed; preserve normal customer intake/manual reply. Retain new tables, events, attempts, reference snapshots and audit history. Do not reverse migrations or delete inventory/CRM/transcript. Existing code with flags off does not create new alert backlog; failed/unknown attempts remain inspectable. If reverting application source, retain a compatible worker for new job types or keep those jobs unclaimed until capability is restored. A DB rollback drill must use synthetic isolated data. Existing customer-response deadlines and relevant human-response evidence must remain unchanged.
