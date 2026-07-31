# earnestproperty-cron

A Cloudflare Worker that does one thing: fire the job-queue drain endpoints on a
schedule. It serves no traffic and has no routes.

## Why this exists

`ops_jobs` needs draining every few minutes. Without it, queued WhatsApp campaigns
and AI knowledge rebuilds return `202` and then sit forever.

Vercel **Hobby allows one cron run per day**, and a deploy carrying `*/5 * * * *`
fails outright:

> Hobby accounts are limited to daily cron jobs. This cron expression
> (`*/5 * * * *`) would run more than once per day.

The options were: upgrade to Vercel Pro, accept once-a-day draining, or schedule
from somewhere else. **Cloudflare Cron Triggers are included on the Workers free
plan**, so scheduling moved here and the app stays on Vercel unchanged.

`vercel.ts` still declares the same three endpoints on a daily schedule. That is
deliberate — if this Worker is unconfigured or down, jobs still drain within 24
hours instead of never. Both endpoints claim jobs under a lease, so two
schedulers hitting them is safe.

## Setup

From the repo root:

```bash
npx wrangler deploy --config workers/cron/wrangler.jsonc
```

Then set the shared secret. It must match `CRON_SECRET` in the Vercel project
exactly, or every call returns 401 and the queue silently stops draining:

```bash
npx wrangler secret put CRON_SECRET --config workers/cron/wrangler.jsonc
```

To read the current value from Vercel (run from the repo root so the CLI resolves
the right project):

```bash
vercel env pull .env.vercel --environment=production
```

## Verifying it works

Trigger a run without waiting for the schedule:

```bash
npx wrangler dev --config workers/cron/wrangler.jsonc --test-scheduled
```

then in another terminal:

```bash
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Live logs:

```bash
npx wrangler tail earnestproperty-cron
```

A healthy run logs the endpoint and a `200` with the claimed/succeeded counts. A
`401` means the secret has drifted from Vercel's.

## Changing the schedule

Cron expressions live in `wrangler.jsonc` under `triggers.crons`, and each one is
mapped to an endpoint in `src/index.ts`. **The keys in `SCHEDULE` must match the
expressions exactly** — Cloudflare passes the expression back verbatim, so a
mismatch does nothing rather than erroring.

## If you upgrade Vercel to Pro

This Worker becomes redundant. Move the sub-daily schedules back into
`vercel.ts`'s `crons` array and delete this directory.
