# Earnest Property job alarm

This Worker receives an authenticated post-commit signal for the service or general `ops_jobs` lane. Each lane has one Cloudflare Durable Object alarm. The alarm calls the existing authenticated app drain once, reads `nextDueAt`, and moves itself to the next queued `run_after` or running lease expiry. When the lane is empty it deletes the alarm. A Cloudflare Cron Trigger also sweeps both lanes: every 10 minutes from 08:00 to 21:50 Hong Kong time and hourly overnight (`"*/10 0-13 * * *"` and `"0 14-23 * * *"`, UTC). Each idle sweep makes one drain call per lane, so no queued job is stranded. There is still no recurring Vercel job drain.

The app signal uses `OPS_WAKE_URL` (the Worker's HTTPS origin) and the existing server-only `CRON_SECRET`. The Worker exposes only `POST /wake/service` and `POST /wake/general`; both require `Authorization: Bearer <CRON_SECRET>`. The Worker does not receive a database credential or job payload. Each drain endpoint keeps its own bearer check and job leases. The drain calls `SITE_ORIGIN` (`https://www.earnestproperty.com`) with `redirect: "manual"`: any 3xx is logged as `JOB_DRAIN_FAILED:JOB_DRAIN_REDIRECTED` instead of being followed, so the bearer token is never replayed to another host.

## Release order

1. **Pre-flight first.** Before the app merge and before this deploy, the owner runs the read-only pre-flight SQL in `docs/audits/fx-plans/FX-07-jobs-drain.md` ("Owner actions before production") and cancels anything unwanted in /admin/operations → 背景工作. The first sweep drains every due job in both lanes. Then deploy the app with `OPS_WAKE_URL` set to this Worker's HTTPS origin.
2. Deploy this Worker with `wrangler deploy --config workers/cron/wrangler.jsonc`. This registers the two Cron Triggers above. The SQLite Durable Object namespace is created by migration `v1`. Keep its `CRON_SECRET` equal to the Vercel server secret.
3. Watch the first sweep in the Worker logs. Both lanes should drain without `JOB_DRAIN_FAILED`, `JOB_SWEEP_FAILED` or `JOB_DRAIN_REDIRECTED`. Do not create synthetic customer jobs or provider sends.
4. Verify a real committed job signals the Worker and the app drain returns `nextDueAt`. After the last job finishes, confirm an idle lane makes only one drain call per sweep. Check Neon suspension overnight through its control plane without issuing SQL.

No production flag, secret, schedule, or resource has been changed by this source commit.

## Failure and recovery

If signaling fails, the app runs the immediate job locally and logs `JOB_WAKE_SIGNAL_FAILED`. That fallback cannot arm a later retry or delayed job; the next cron sweep does. A failed alarm drain backs off from one minute and stops after seven consecutive failures, deleting the alarm and logging `JOB_DRAIN_RETRY_EXHAUSTED`. The cron sweep then re-arms the exhausted lane without resetting its failure count, so during an outage each lane makes one drain call per tick until a drain succeeds and clears the count. The sweep never shortens an active failure backoff. A committed job or a manual `POST /wake/<lane>` still resets the failure count and re-arms the lane at once. An empty response clears the alarm. The manual app drain routes remain available for operator recovery.

The former `/api/admin/jobs/send-queue` route remains callable manually for orphaned legacy campaign recipients. Newly queued campaigns enqueue a durable job and signal the general lane directly. The service permission and provider-send gates are unchanged.

## Other database schedules

The Vercel YouTube crons are removed. Staff can still invoke incremental or full sync manually. The GitHub migration drift check runs on migration-file pushes to main or manual dispatch; property collection has a separately gated daily GitHub workflow at 04:17 Hong Kong time. Property collection requires `PROPERTY_SYNC_DAILY_ENABLED=true`, the approved parser/branch/database target, and a private evidence repository (see `scripts/property-sync/README.md`). Video collection remains manual and migration drift is not rechecked daily. The property workflow deliberately pays for one daily inventory refresh; it does not restore periodic CRM, WhatsApp or video polling. Independently configured external schedules must be checked during rollout.

## Local checks

- `node --test src/lib/control-plane/job-wake.test.mjs src/lib/control-plane/job-signal.test.mjs src/lib/control-plane/jobs-next-due.test.mjs workers/cron/src/job-alarm.test.mjs`
- `wrangler deploy --dry-run --config workers/cron/wrangler.jsonc --outdir ../../.audit/cron-dry-run` (`--outdir` is relative to `workers/cron/`; this writes to the root `.audit/`, which git and ESLint ignore)
- Run the relevant route and service tests with a local fixture. Neither check above needs Neon.

Cloudflare documents [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) and [SQLite-backed free tier limits](https://developers.cloudflare.com/durable-objects/platform/pricing/). This avoids idle Neon calls, though Cloudflare alarm requests and storage still have their own usage limits.
