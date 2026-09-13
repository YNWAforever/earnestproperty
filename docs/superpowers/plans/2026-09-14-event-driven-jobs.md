# Event-driven durable job processing

Approved scope: wake after new work commits, with a 15-minute recovery sweep. Preserve ops_jobs leases, idempotency, provider permission checks and all current notification flags.

- [x] Add tested best-effort post-commit wake using Vercel request lifetime support. No browser, external queue or new database.
- [x] Connect live capture, manual assignment/replies, job enqueue/retry and history requests. History itself must never create live enquiry effects.
- [x] Reuse service/general runners; bound each wake by existing job/time limits. Failed wake and delayed jobs remain durable for the sweep.
- [x] Align all three Cloudflare drains on one 15-minute trigger, maintaining independent failure handling.
- [ ] Run unit/regression/type/lint checks, deploy app with event wake before reducing cron, verify and document rollback.

No schema migration. Fallback jobs may wait up to 15 minutes plus scheduler/runtime delay. Immediate wake is an acceleration, never the source of truth. No changes to customer reply permissions. Idle cost savings depend on other database traffic.

Local tests, typecheck, targeted lint and build passed. Release is blocked by automatic approval review pending explicit push/merge/deployment authorization. See EVENT_WAKE_VERIFICATION_20260914.md.
