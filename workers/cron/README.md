# earnestproperty-cron

Recovery sweep for durable `ops_jobs`. One `*/15 * * * *` trigger invokes the service, general control-plane, and legacy campaign drains concurrently. Each endpoint fails independently and authenticates using the existing CRON_SECRET. The worker serves no HTTP traffic.

New live enquiry captures, manual assignment/reply requests, standalone job enqueue/retry and history-import requests wake their existing leased runner after commit when `OPS_EVENT_WAKE_ENABLED=true` in the app. Vercel `waitUntil` retains the request lifetime; the webhook returns without waiting for provider work. Each wake uses the existing bounded runner (up to 20 jobs, 45-second between-job budget). Job chains beyond this budget, delayed jobs, interrupted/failed wakes and expired leases are recovered by the sweep. Delay can be 15 minutes plus provider/scheduler runtime; this is not a precise deadline scheduler.

All delivery permissions, approved policies and capability checks remain in the existing handlers. The wake flag grants no sending permission. Future timed customer-service features need a separate latency review before activation. The current routing-only policy has customer autoreplies and escalation disabled.

## Release order

1. Deploy the app with the wake implementation. Enable OPS_EVENT_WAKE_ENABLED=true for production and redeploy. Preserve all WhatsApp permission flags.
2. Verify post-commit wake logs and normal enquiry processing. Do not create synthetic production customer records or send test messages without authorization.
3. Deploy the recovery worker: `npx wrangler deploy --config workers/cron/wrangler.jsonc`.
4. Verify `npx wrangler tail earnestproperty-cron`: one trigger runs all three endpoints, authenticated, with count-only app responses.

Existing CRON_SECRET is retained. No migration or secret rotation is needed. `vercel.ts` daily fallback schedules remain in place. Live secrets must never be printed or committed.

## Rollback

Restore the previous worker source/config from commit f03b223d5087b1517080a1887c07ee7701fc9d55 and deploy it first (old 1/5/10-minute recovery). Then set OPS_EVENT_WAKE_ENABLED=false and redeploy the app if immediate wakes are faulty. Keep durable jobs and existing idempotency keys; never replay unknown provider outcomes by resetting state. No schema rollback.

## Verification

`npm run test:job-wake`, `npm run test:whatsapp-enquiries`, `npm run test:control-plane`, `npm run test:woztell`, `npm run test:staff-notifications`, `npm run test:cron`, `npm run typecheck`, `npm run lint`.

For local worker scheduling: `npx wrangler dev --config workers/cron/wrangler.jsonc --test-scheduled`, then request `http://localhost:8787/__scheduled?cron=*/15+*+*+*+*` using synthetic local credentials and a local app only.

Empty scheduled endpoint requests decrease from 1,872/day to 288/day, grouped into 96 wake periods. This does not guarantee a CU-hour saving: public traffic, admin polling, connection behavior and other jobs may still keep Neon awake. Observe endpoint suspension via the Neon control plane; querying SQL to check idleness itself wakes the database.

Platform reference: https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
