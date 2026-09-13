# Event wake verification — 2026-09-14

Branch: codex/event-driven-job-wake. Source base f03b223d5087b1517080a1887c07ee7701fc9d55; same source tree as main merge e0018b9791e12496747d50995f30ba560d4e242c. Existing bun.lockb changes and prior audit document preserved.

## Behavior and policy mapping

- Live event/transcript/job capture still commits atomically. Only after successful commit is the service worker woken. Transcript insertion is not a precondition: history/live races can still create a live job.
- Manual assignment, manual outbound intents, standalone enqueue/retry and history-import requests wake their respective existing runner after successful persistence. The legacy campaign sweep suppresses a redundant enqueue wake because it immediately drains itself.
- Vercel waitUntil holds the request lifetime. Provider results do not delay webhook acknowledgement. Wake failures emit a fixed diagnostic without customer payloads, and do not reject a committed request.
- Both event wakes and the recovery sweep retain existing run_after, leases, ownership, idempotency and handler capability restrictions. Each run remains bounded (20 jobs, existing 45-second between-job budget); remaining work waits for a new wake or recovery sweep.
- One 15-minute trigger invokes all three prior endpoints together, with independent failure handling. Daily Vercel fallbacks remain.
- No migration, new queue, new provider permission, customer reply activation, or changed policy. OPS_EVENT_WAKE_ENABLED defaults false; production rollout enables it before lowering the cron cadence.

## Executed local checks

Initial red: five expected failures (wake registration, failure reporting, low cadence, post-commit live wake). Green after implementation.

- test:job-wake: 7/7.
- test:whatsapp-enquiries: 74/74.
- test:control-plane: 95/95, including CI wiring.
- test:woztell: 137 Node + 8 Bun passed.
- test:staff-notifications: 10 Node + 4 Bun passed.
- test:cron: 5/5.
- npm run typecheck: passed.
- Targeted ESLint on changed production TS/JS: passed.
- Full npm run lint: failed on pre-existing CRLF/format noise and ignored local scratch files (146820 errors, 1 warning). No mass reformat performed; remote Linux CI is the release gate.
- npm run build: passed (TanStack Start/Nitro client and server output).

Database integration tests were not executed: previously designated disposable branch br-quiet-hat-aoxbj2ue has expired. No synthetic production inserts or test messages were sent. Offline ports test commit ordering, rollback and history/live races, but do not replace live delivery verification.

## Release verification

Pending app deployment, OPS_EVENT_WAKE_ENABLED activation, then recovery worker deployment. Verify real next incoming enquiry via count-only [job-wake] logs and its normal workflow records. Observe suspension through Neon control-plane metadata rather than repeated SQL polling. Do not claim measured CU savings until observed over an idle interval.

Exact release/rollback commands and prerequisites: workers/cron/README.md. Restore old worker first, then disable wake and redeploy app if needed. Never reset unknown send outcomes or delete queued inventory.

## Release gate status

Automatic approval review rejected the combined git commit/push command before execution, stating that this implementation/test authorization does not authorize the new push/merge. No commit, push, production flag, deployment or schedule change was performed in this turn. Operator approval is required to push, merge, activate OPS_EVENT_WAKE_ENABLED and deploy the 15-minute worker in the documented order. Remote Linux CI remains pending that approval.
