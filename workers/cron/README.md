# Earnest Property job alarm

This Worker receives an authenticated post-commit signal for the service or general `ops_jobs` lane. Each lane has one Cloudflare Durable Object alarm. The alarm calls the existing authenticated app drain once, reads `nextDueAt`, and moves itself to the next queued `run_after` or running lease expiry. When the lane is empty it deletes the alarm. There is no Cloudflare Cron Trigger and no recurring Vercel job drain, so an idle queue makes no Neon request.

The app signal uses `OPS_WAKE_URL` (the Worker's HTTPS origin) and the existing server-only `CRON_SECRET`. The Worker exposes only `POST /wake/service` and `POST /wake/general`; both require `Authorization: Bearer <CRON_SECRET>`. The Worker does not receive a database credential or job payload. Each drain endpoint keeps its own bearer check and job leases.

## Release order

1. Deploy the app with the updated drain responses while the currently deployed cron still runs. Set `OPS_WAKE_URL` to the new Worker's expected HTTPS origin and enable `OPS_EVENT_WAKE_ENABLED=true` in the app. Until the new Worker is deployed, failed signals use the app's local post-commit runner; the old cron still provides recovery.
2. Deploy this Worker with `wrangler deploy --config workers/cron/wrangler.jsonc`. The explicit `triggers.crons: []` removes previously deployed Cron Triggers. The SQLite Durable Object namespace is created by migration `v1`. Keep its `CRON_SECRET` equal to the Vercel server secret.
3. Send one authenticated signal to each lane to inspect any jobs that were already queued before the change. This one-time wake may contact Neon. Confirm the response is 202, then inspect Worker alarm and app logs. Do not create synthetic customer jobs or provider sends.
4. Verify a real committed job signals the Worker and the app drain returns `nextDueAt`. After the last job finishes, confirm no further drain calls occur during an idle interval. Check Neon suspension through its control plane without issuing SQL.

No production flag, secret, schedule, or resource has been changed by this source commit.

## Failure and recovery

If signaling fails, the app runs the immediate job locally and logs `JOB_WAKE_SIGNAL_FAILED`. That fallback cannot arm a later retry or delayed job. After fixing the Worker or secret, send `POST /wake/service` and `POST /wake/general` with the server-side bearer token once; this re-arms any persisted work. A failed alarm drain backs off from one minute and stops after seven consecutive failures, deleting the alarm and logging `JOB_DRAIN_RETRY_EXHAUSTED`. A later committed job or manual wake signal resets the failure count and re-arms the lane. An empty response clears the alarm. The manual app drain routes remain available for operator recovery.

The former `/api/admin/jobs/send-queue` route remains callable manually for orphaned legacy campaign recipients. Newly queued campaigns enqueue a durable job and signal the general lane directly. The service permission and provider-send gates are unchanged.

## Other database schedules

The Vercel YouTube crons are removed. Staff can still invoke incremental or full sync manually. The GitHub migration drift check runs on migration-file pushes to main or manual dispatch; property collection is manual dispatch only. Videos and property listings will no longer refresh automatically from those workflows, and migration drift is no longer rechecked daily. This is the cost tradeoff for zero repository-managed idle Neon wakes. Independently configured external schedules must be checked during rollout.

## Local checks

- `node --test src/lib/control-plane/job-wake.test.mjs src/lib/control-plane/job-signal.test.mjs src/lib/control-plane/jobs-next-due.test.mjs workers/cron/src/job-alarm.test.mjs`
- `wrangler deploy --dry-run --config workers/cron/wrangler.jsonc`
- Run the relevant route and service tests with a local fixture. Neither check above needs Neon.

Cloudflare documents [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) and [SQLite-backed free tier limits](https://developers.cloudflare.com/durable-objects/platform/pricing/). This avoids idle Neon calls, though Cloudflare alarm requests and storage still have their own usage limits.
