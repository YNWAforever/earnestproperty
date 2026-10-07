# FX-07: Background jobs always drain; health tells the truth. Implementation plan

**Owner decisions (2026-10-06, binding):**
1. **Backlog drain: approved, but the owner sees the queue first.** The PR and runbook ship the read-only pre-flight SQL under "Owner actions" below. It lists queued, running and failed `ops_jobs` by `job_type`, status and age, plus pending or failed `whatsapp_inbound_receipts`. The owner runs it and cancels anything unwanted in /admin/operations → 背景工作. Only then is the app merged and the worker deployed. `wrangler deploy` is an owner action; Claude never deploys.
2. **Inbound receipts.**
   - List them on /admin/operations. This includes the C-09 receipts that were captured while `active` and replayed as `observe`; those are labelled 「需要分派」.
   - 重試 does an observe-only retry, the same as `recoverPendingInboundReceipts`. It is admin or manager only, and audited.
   - **No live re-route.** That stays an owner follow-up (see Out of scope).
3. **One switch fewer.** `OPS_EVENT_WAKE_ENABLED` goes. The wake is on whenever `OPS_WAKE_URL` is set.
4. **Cadence (overrides every "10-minute" / `*/10 * * * *` mention below).** The sweep runs every 10 minutes from 08:00 to 22:00 HKT and hourly overnight, so Neon can sleep most of the night.
   - Cron triggers are in UTC, and HKT is UTC+8: `"triggers": { "crons": ["*/10 0-13 * * *", "0 14-23 * * *"] }`. That gives 08:00–21:50 HKT every 10 minutes and 22:00–07:00 HKT hourly.
   - The worker's `scheduled()` handles both cron strings identically, by sweeping both lanes.
   - Health thresholds follow the HKT clock, computed from `now()` in `Asia/Hong_Kong`:

     | | Day (08:30–21:59 for health thresholds; cadence day is still 08:00–21:50) | Night |
     |---|---|---|
     | Stale heartbeat | > 30 min | > 90 min |
     | Overdue job | `run_after` < now − 15 min | `run_after` < now − 75 min |

     Put the threshold choice in one pure helper with unit tests at the 07:59/08:00 and 21:59/22:00 boundaries. Also test the first night tick, so a heartbeat from 21:50 HKT is not stale at 22:30 HKT.

     *Clarification (Task 4 fix round 1, controller ruling):* the **health** day thresholds start at **08:30** HKT (minute-of-day in [510, 1320)), not 08:00. The cron cadence is unchanged (every 10 minutes from 08:00). This shifts the day window by one day stale window after the first 10-minute tick, so the 07:00 hourly heartbeat is not judged by the 30-minute day threshold at 08:00 (a daily false 降級 on a page that does not poll). The boundary tests are 07:59/08:00/08:29 → night, 08:30 → day, 21:59 → day, 22:00 → night. A 07:00 heartbeat is not stale at 08:00:45 or 08:29, and a missed morning sweep is caught at 08:30.
   - Tests and docs use these two cron strings. Open question 1 (cadence) is resolved by this decision.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.** Nothing queued is stranded. A 10-minute Cloudflare cron sweeps both job lanes, and it re-arms a lane whose alarm gave up. Failed WhatsApp receipts retry on a bounded backoff and are visible to managers. /admin/operations reports 降級 when work is overdue or the worker has gone quiet, and only then (C-03 = D-03 = H-03, L-03, C-09).

**Approach.**
- **Sweep, don't signal.** The cron calls a new `sweep()` on each lane's Durable Object. It arms an idle or exhausted lane and pulls a healthy lane's far alarm forward. It keeps an active failure backoff and does not reset the failure count, unlike `signal()`.
- **One retry rule for receipts.** Receipt recovery and `nextDueAt` share a single SQL predicate with an exponential backoff (2 min → 1 h). The alarm can then never point at a receipt that recovery will not claim.
- **The heartbeat means "the scheduled worker reached us".** Only the two authenticated drain routes write it, one row per lane. The local post-commit fallback does not.
- **No migration, and no new env var.** Net configuration change: −1 (`OPS_EVENT_WAKE_ENABLED`).

**Tech stack.** Tests use `node --test` (with `--experimental-test-module-mocks` for owned DB tests) and `bun test` with `renderToStaticMarkup`. Owned DB tests run on full-schema owned Postgres: `withOwnedPostgres` + `mockOwnedServerDb` (`scripts/acceptance/owned-postgres-test.mjs:144-165`). The worker is plain JS behind `job-alarm.js`; node tests cannot import `cloudflare:workers`, so `index.ts` stays a thin shell checked by a source contract.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`, on branch `fix/fx-01-public-form-feedback`:
  - C-03 (:188)
  - L-03 (:149)
  - C-09 (:194)
  - F-06 (:291), for the redirect coupling
  - S2 (:422)
- Fix plan `docs/audits/2026-10-fix-plan.md`, same branch:
  - FX-07 (:371-401)
  - FX-13 preconditions (:590-596)
  - Review focus 1 (:43)

## Verified current behaviour (main 4965d48)

| # | Fact | Where |
|---|---|---|
| 1 | **The worker has no cron.** It has `"triggers": { "crons": [] }`, one DO binding `JOB_WAKE` → `JobWakeAlarm` (SQLite, migration `v1`), and `SITE_ORIGIN` = `https://earnestproperty.vercel.app`. `CRON_SECRET` is a Worker secret. `workers_dev: true`. | `workers/cron/wrangler.jsonc:9-18` |
| 2 | **How a lane is signalled.** The Worker `fetch` accepts only `POST /wake/service` or `/wake/general` with `Bearer CRON_SECRET`, then calls `JOB_WAKE.getByName(lane).signal()`. The alarm `POST`s `new URL(ENDPOINT[lane], SITE_ORIGIN)` with the same bearer (service → `/api/admin/whatsapp/service-worker`, general → `/api/admin/control-plane/worker`). `fetch` follows redirects by default, and the code requires a JSON `nextDueAt`. | `workers/cron/src/index.ts:11-14,26-43,46-61` |
| 3 | **Alarm rules.** `signal()` bumps `generation`, **resets `failures` to 0** and arms `now+1 s` if no earlier alarm exists. `fire()` drains once; a signal that arrives mid-drain re-arms at `+1 s`. A failure backs off 1, 2, 4 … 60 min. After **7 consecutive failures it deletes the alarm** and reports `JOB_DRAIN_RETRY_EXHAUSTED`. A `null` `nextDueAt` deletes the alarm; otherwise the alarm moves to `max(now+1 s, nextDueAt)`. | `workers/cron/src/job-alarm.js:1-3,7-16,36-59` |
| 4 | **Worker tests.** There are six `createJobAlarm` tests on a fake storage. `job-wake.test.mjs:68-78` currently **asserts that crons are empty**, so this batch must invert it. The worker is not covered by the root `tsc` (`tsconfig.json` includes only `src/`, `e2e/` and config). | `workers/cron/src/job-alarm.test.mjs:23-132`; `src/lib/control-plane/job-wake.test.mjs:68-78` |
| 5 | **The wake is gated by the flag.** `enabled: process.env.OPS_EVENT_WAKE_ENABLED === "true"`. When it is enabled but `OPS_WAKE_URL` or `CRON_SECRET` is missing, or the signal fails, the job runs locally inside `waitUntil` (service: `runServiceJobs`; general: `runClaimedJobs` with limit 20). `createJobWake` returns early when disabled. | `src/lib/control-plane/job-wake.server.ts:6-41`; `job-wake.js:2-14` |
| 6 | **`nextDueAt`** is `min(run_after for queued, lease_expires_at for running)` in the lane. It **ignores receipts**. The service lane matches `SERVICE_CAPABILITIES`; general excludes `woztell.enquiry.*` (except `process@1`) and `reply.deliver@2`. | `src/lib/control-plane/jobs-next-due.ts:11-18` |
| 7 | **Drain endpoints.** `POST`/`GET /api/admin/control-plane/worker` checks the bearer, then runs `runClaimedJobs(general, limit 10, lease 60 s)` and returns counts plus `nextDueAt`. `POST /api/admin/whatsapp/service-worker` checks the bearer, then `runServiceJobs()`, which **first recovers receipts** and then writes the heartbeat. A missing heartbeat table → 503. | `src/routes/api.admin.control-plane.worker.ts:7-31`; `api.admin.whatsapp.service-worker.ts:7-24`; `src/lib/control-plane/service-worker.server.ts:5-23` |
| 8 | **The heartbeat is only the service lane, and it can lie.** `whatsapp_service_worker_heartbeats(worker_id PK, seen_at, capabilities)` gets row `service-v2`, written inside `runServiceJobs`. The **local fallback writes it too**, and the general lane writes nothing. 「工作程序最後回報」 shows `max(seen_at)`. | `service-worker.server.ts:13-16`; `20260912150000_whatsapp_service_workflow.sql:135`; `service-health.server.ts:122-124`; `WhatsappServiceHealth.tsx:112-115` |
| 9 | **Why health says 正常 (L-03).** The top badge comes from `runControlPlaneHealthChecks`, which has **no job or heartbeat check at all**. The WhatsApp card counts only `job_type LIKE 'woztell.%'`, so it misses the queued `ai.knowledge.repair` jobs. It flags a missing heartbeat only when woztell work is overdue, and never flags a stale one. The badge copy is 正常 / **降級** / 故障; there is no 「異常」 label. | `health.server.ts:129-209`; `service-health.server.ts:107-112`; `service-health-model.ts:37-55`; `admin.operations.tsx:76-80`; `AdminOperationsOverview.tsx:35-39` |
| 10 | **Receipts.** `recoverPendingInboundReceipts` claims up to 20 receipts in `pending/blocked_schema/failed` with `attempt_count < 20` (cap at `:157`), not `REVIEW_REQUIRED`, and with an expired lease. **It has no backoff.** It replays with mode `off` or `observe`, **never `active`** (C-09, `:174,187`). Non-`live_webhook` or non-`customer_message` rows become `failed/REVIEW_REQUIRED`. `markInboundReceipt` clears the lease and stamps `updated_at`. | `src/lib/whatsapp-enquiries/inbound-receipts.server.ts:125-204` |
| 11 | **The webhook commits the receipt first.** It projects inline. On failure it marks `failed`/`blocked_schema`, calls `wakeAfterCommit("service")` and **still returns 200** `{projection:"failed"}`. An inline projection holds no lease. | `webhook.server.ts:150-201` (failure branch `:184-200`) |
| 12 | **No receipt UI exists.** /admin/operations has the tabs 總覽 / 背景工作 / 審計記錄 / 資料庫遷移, plus the `WhatsappServiceHealth` card. Jobs use API routes under `/api/admin/control-plane/*` with `requireStaffPermission`. `system.jobs.read`, `system.jobs.retry` and `system.jobs.cancel` belong to **admin and manager only**. Retry writes its audit row in the same statement (`jobs.server.ts:275-304`). | `admin.operations.tsx:53-58,249-319`; `permissions.ts:20-37`; `api.admin.control-plane.jobs.$id.retry.ts` |
| 13 | **The operations owned harness** is `operations-recovery-owned.db.test.mjs`, run by `test:operations:owned:db` (`package.json:124`), which CI already runs (`ci.yml:157`). UI tests live in `operations-components.test.tsx` (`test:operations`, `package.json:41`, whose exact string is asserted by `admin.operations.test.mjs:11-17`). The e2e is `e2e/admin-operations-recovery.spec.ts` on the property-maintenance fixture with `synthetic-operations.ts`. | as cited |
| 14 | **Flag users outside the app:** `scripts/no-link-local-postgres.test.mjs:223`, `scripts/test-public-synthetic-browser.mjs:140`, `scripts/no-link-safe-checks.mjs:23` and `src/lib/whatsapp-enquiries/assignment.test.mjs:183-212`. All of them **set the flag to `false` to stop wakes**. Once the flag is gone, only a blank `OPS_WAKE_URL` does that. | as cited |
| 15 | **Redirects (SITE_ORIGIN → www).** `vercel.ts` has **no rule that matches `/api/*` on www**:<br>• the only host rule is `/:path*` with `has host = earnestproperty.vercel.app`, and it is off unless `CANONICAL_HOST_REDIRECT_ENABLED=true` (`vercel.ts:31-43`);<br>• `src/generated/old-site-redirects.json` is `[]`;<br>• the other rules are exact public paths (`:52-105`).<br>There is no app middleware (no `src/start.ts`). The audit records www as canonical and the apex → www 308 as Vercel domain config (audit :314). **Conclusion:** from code and config, calling `https://www.earnestproperty.com/api/admin/...` follows no redirect. | as cited |
| 16 | **Production context.** `CRON_SECRET` has no line in `.env.example`, only a comment (`:142`). Whether `OPS_WAKE_URL` and `OPS_EVENT_WAKE_ENABLED` are set in production is **unknown** (FX-05b owner note). | `.env.example:142,230-233` |

### What each registered job does when drained (feeds the pre-flight)

`job-handlers.server.ts` registers the following. Lanes come from `claimJobs` (`jobs.server.ts:109-118`).

| `job_type@v` | Lane | Effect when drained |
|---|---|---|
| `ai.knowledge.rebuild@1` | general | **AI call**: embeddings through the AI Gateway (`knowledge.server.ts:119-122`) |
| `ai.knowledge.repair@1` | general | **None external**: DB re-index with `allowEmbeddings:false` (`knowledge.server.ts:551`). The 3 live queued jobs are these. |
| `woztell.campaign.deliver@1` | general | **Customer message**: billable campaign template sends |
| `woztell.reply.deliver@1` | general + service | **Customer message**: a staff-composed reply (`deliverOutboundIntent`). If old, it lands late. |
| `woztell.reply.deliver@2` | service | **Customer message**: an automated service reply or survey (`deliverServiceAction`) |
| `woztell.history.import@1` | general | **Provider call**: a WozTell history read. No message. |
| `woztell.enquiry.process@1/@2` | service (`@1` also general) | DB projection. In `active` mode it may **schedule** automated replies (`workflow.server.ts:135-146`). |
| `woztell.enquiry.service@1` | service | Prepares a service action, which may queue `reply.deliver@2` (a customer message later) |
| `woztell.enquiry.assign@1` | service | **Provider call**: WozTell Inbox assignment |
| `woztell.enquiry.sla.check@1` | service | None (DB state only) |
| `woztell.enquiry.staff.notify@1` | service | **Staff message**: staff WhatsApp or an Inbox private note |
| `woztell.enquiry.staff.notify.reconcile@1`, `…staff.ack.check@1` | service | None (DB only; ack check is a stub) |
| `woztell.enquiry.staff.test@1` | service | **Staff message**: a test notification |
| `lead.staff.alert@1`, `lead.staff.alert.reconcile@1` | general | *Only if #225 merges first.* **Staff message**: a template alert; reconcile is DB only. |

Receipts replay in `observe`/`off` only. That writes the transcript, conversation, enquiry evidence and the inbound-lead trigger rows. **No customer or staff message is sent.**

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real number. Tests use fake `project` ports and fake fetchers. Nothing talks to WozTell, Neon production, Cloudflare or a model.
  - Never touch production Neon. Use synthetic data in owned Postgres or PGlite only.
  - Claude makes no network call to production and never runs `wrangler deploy`, `wrangler rollback` or `wrangler secret`. Local `wrangler deploy --dry-run` and `wrangler dev --test-scheduled` against a local app are allowed.
  - All new UI copy is zh-HK (copy table in Task 5). Reuse the shadcn primitives already used on the page (`Table`, `Badge`, `Button`, `Tooltip`, `AdminConfirmDialog`, `sonner`).
  - No secret in logs or the UI. The receipt list never returns `normalized_event`, `member_id`, a phone number or message text.
- **Configuration.**
  - Remove `OPS_EVENT_WAKE_ENABLED`. **No new env var.**
  - `OPS_WAKE_URL` set and non-blank means the wake is on; unset or blank means no wake **and no local fallback**.
  - The worker keeps `SITE_ORIGIN` as a `vars` entry, now `https://www.earnestproperty.com`.
- **Health must not cry wolf.**
  - "Overdue" means `status='queued' AND run_after < now() - 15 min`. That is the 10-minute cadence plus 5 minutes, so future-scheduled jobs and retry backoffs are excluded by construction.
  - An expired lease counts only when it is older than 15 minutes.
  - "Stale" means a lane heartbeat older than **30 min**: three ticks, which tolerates one late cron run plus a 1–2 min backoff.
  - The new check is `required:false`, so it can make the badge 降級 but never 故障.
  - Failed (terminal) jobs and receipts that need a person are shown in lists, **not** in the badge.
- **Avoid conflicts with open PRs** (diffs taken against `4965d48`).

  | PR | Branch | Overlap with FX-07 | Rule |
  |---|---|---|---|
  | #221 | `fix/fx-01-public-form-feedback` | `ci.yml:84`, `package.json:35,122`; public form files only | No overlap. Do not touch `ci.yml` or `package.json:35,122`. |
  | #222 | `fix/fx-03-live-agent-handoff` | `package.json:52`; `live-agent.server.ts`; `admin-data*` | No overlap. |
  | #223 | `fix/fx-04-admin-attention` | `src/lib/admin/operations/operations.test.mjs:238-276`, which asserts that **`admin.operations.tsx` has no `setInterval` / `useVisibleInterval`**; `property-maintenance/synthetic-api.ts:152+`; `AdminShell.tsx`; `admin.whatsapp.tsx`; `package.json:39,117` | The receipts panel must **not poll**. It refreshes on `pulse` or a click only. Do not edit `operations.test.mjs`, `synthetic-api.ts`, `AdminShell.tsx` or `admin.whatsapp.tsx`; the 「開啟對話」 link uses the existing `?conversation=` param (`admin.whatsapp.tsx:131-145`). The e2e fixture goes in `synthetic-operations.ts`, which #223 does not touch. |
  | #224 | `fix/fx-05a-ui-flags` | `.env.example:47-56`; `package.json:15` | Edit only `.env.example:228-233`. |
  | #225 | `fix/fx-05b-lead-alert` | `job-handlers.server.ts:1-2,491-515` (adds `lead.staff.alert*`); `service-health.server.ts:40-44`; `.env.example:199-218`; `package.json:94,124+`; `ci.yml:157+`; `migration-versions.js`; `scripts/test-public-synthetic-browser.mjs:137-139` | **Do not touch `job-handlers.server.ts` or `migration-versions.js`.** In `service-health.server.ts`, edit only `:107-124` and `:143-156`. Add **no** `package.json` script and **no** `ci.yml` line: the owned tests go into the existing `operations-recovery-owned.db.test.mjs`. `scripts/test-public-synthetic-browser.mjs:140` sits next to #225's deletion; whichever merges second rebases one line. |
  | #226 | `fix/fx-06-manager-wa-access` | `package.json:124+`; `ci.yml:157+`; `migration-versions.js`; enquiry-access tests | Same as #225: no `package.json` or `ci.yml` edits. |

  `src/routeTree.gen.ts` changes only for the two new API routes (Task 5). Commit only those entries.
- **Committing.** Use `git add <paths>` only; never `bun.lockb` (already dirty in this worktree). Conventional commits with a scope, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its listed suites. The owned suites need Docker and `docker pull pgvector/pgvector@sha256:d2ef61f4…` (`ci.yml:143`).

## Review Focus

Each item is a failure mode no fix-plan test covers. Each has a named test in its owning task.

1. **The alarm hot-loops at 1 s on a receipt that recovery refuses.** If `nextDueAt` says "due" for a receipt at the cap, `REVIEW_REQUIRED`, leased or in backoff, the alarm fires every second forever. Each firing is a Vercel invocation plus Neon queries, so the owner pays. *Test (Task 3):* `nextDueAt never points at a receipt recovery will not claim`.
2. **A test or script signals the real worker, or runs real jobs, after the flag is removed.** Today the harnesses set the flag to `false` (fact 14). Afterwards, a developer shell or `.env` that has `OPS_WAKE_URL` would make tests `POST` to the production worker. *Test (Task 2):* `test harnesses blank OPS_WAKE_URL so no test can signal a real worker`.
3. **A redirect on the drain origin silently drops `Authorization`** (FX-13 coupling, F-06). The worker then gets 401s, or a 200 HTML page, and the lane stalls. *Test (Task 1):* `drain refuses redirects so Authorization is never replayed elsewhere`. With `redirect:"manual"`, any 3xx becomes a loud `JOB_DRAIN_REDIRECTED` and a stale heartbeat.
4. **The heartbeat says 正常 while the cron worker is dead.** Today the local fallback writes the heartbeat, and the general lane has none (fact 8). *Test (Task 4):* `only the authenticated drain routes write lane heartbeats; runServiceJobs and the local fallback do not`.
5. **A receipt is projected twice**, by 重試 racing a cron recovery, a double click, or a still-running webhook inline projection. The result is a duplicate transcript row or duplicate lead evidence. *Tests (Task 5):* `concurrent retry, double click and recovery project a receipt once`. *(Task 3):* `a receipt younger than the in-flight grace is not replayed`.

## Out of scope / follow-ups

| Follow-up | Owner | What it must do |
|---|---|---|
| **Live re-route of C-09 receipts** | owner decision (later batch) | Re-run routing under the current activation for 「需要分派」 receipts. It needs an activation-safety design and a WhatsApp sandbox test. Today staff route by hand through 「開啟對話」. |
| 「標記已分派」 dismiss for C-09 rows | same batch | Needs a column (migration). Until then the list is bounded to 30 days (Open question 2). |
| Host redirect, WozTell webhook, `PROPERTYHK_SYNC_URL` → www | FX-13 | FX-07 moves only the worker `SITE_ORIGIN` (precondition 3 at fix plan :596). |
| Zh labels for the other WhatsApp health reason codes | FX-17a | FX-07 labels only the code it adds. |
| A daily "alarm exhausted" notification | none | Health 降級 plus the Worker logs cover it. Adding mail or WhatsApp would need a provider. |

---

### Task 1: Worker: a 10-minute sweep that self-heals, a redirect-safe drain, `SITE_ORIGIN` → www

**Decision on the 7-failure delete.** **Keep the delete, and let the cron make it self-healing.**
- The delete bounds cost *between* ticks, so a dead Vercel or Neon gets about 7 calls over about 2 h, not one a minute.
- Today nothing re-arms the lane except a new committed job or a manual wake (README :18). That is the C-03 stranding path.
- `sweep()` re-arms an exhausted lane **without resetting `failures`**. During an outage the lane therefore makes **one** call per 10 min, and each failed call re-deletes the alarm and logs `JOB_DRAIN_RETRY_EXHAUSTED`. The first success zeroes `failures`.
- The cron must **not** call `signal()`. That would reset the backoff every 10 minutes and add 3–4 extra calls per tick during an outage.

**Files:**
- **Modify `workers/cron/wrangler.jsonc`:**
  - `:7-8`: update the comment;
  - `:10`: `"triggers": { "crons": ["*/10 * * * *"] }`;
  - `:17`: `"SITE_ORIGIN": "https://www.earnestproperty.com"`.
- **Modify `workers/cron/src/job-alarm.js`:**
  - add `sweep()` to `createJobAlarm` (`:6-62`);
  - add `export const JOB_LANES`, `LANE_ENDPOINTS`, `createLaneDrain` and `sweepLanes`;
  - `fire()` (`:31-34`) reports `JOB_DRAIN_FAILED:<code>` when the error message starts with `JOB_DRAIN_`.
- **Modify `workers/cron/src/job-alarm.d.ts`:** add the types below.
- **Modify `workers/cron/src/index.ts`:**
  - `:10-14`: import the lanes and endpoints from `job-alarm.js`;
  - `:17-24`: add `async sweep() { await this.controller().sweep(); }`;
  - `:31-40`: `drain: createLaneDrain({ origin: this.env.SITE_ORIGIN, path: LANE_ENDPOINTS[lane], secret: this.env.CRON_SECRET })`;
  - `:46-62`: add `async scheduled(_controller, env, ctx) { ctx.waitUntil(sweepLanes((lane) => env.JOB_WAKE.getByName(lane), (code) => console.error(`[job-alarm] ${code}`))); }`.
- **Modify `workers/cron/README.md`:**
  - `:3`: "a 10-minute Cron Trigger sweeps both lanes; each idle sweep makes one drain call per lane";
  - `:9-11`: drop the flag and the "`crons: []` removes triggers" release step;
  - `:18`: the cron re-arms an exhausted lane;
  - add the pre-flight pointer to this plan.
- **Modify `workers/cron/src/job-alarm.test.mjs`** (new tests after `:132`) and **`src/lib/control-plane/job-wake.test.mjs:68-78`** (invert it).

**Interfaces:**
```ts
// job-alarm.d.ts
export type JobLane = "service" | "general";
export const JOB_LANES: readonly JobLane[];                        // ["service","general"]
export const LANE_ENDPOINTS: Readonly<Record<JobLane, string>>;    // unchanged paths
export function createJobAlarm(input: {…unchanged}): { signal(): Promise<void>; fire(): Promise<void>; sweep(): Promise<void> };
/** POST origin+path with Bearer, redirect:"manual"; 3xx → JOB_DRAIN_REDIRECTED; !ok → JOB_DRAIN_HTTP_<n>;
 *  origin must be https (or http://localhost) with no path → else JOB_DRAIN_ORIGIN_INVALID. */
export function createLaneDrain(input: { origin: string; path: string; secret: string; fetcher?: typeof fetch }): () => Promise<string | null>;
/** Sweeps every lane with allSettled; a failing lane reports JOB_SWEEP_FAILED:<lane> and never blocks the other. */
export function sweepLanes(getLane: (lane: JobLane) => { sweep(): Promise<void> }, report?: (code: string) => void): Promise<void>;
```
`sweep()` semantics, all inside one `storage.transaction`:
- if there is no alarm → `setAlarm(now+1 s)`;
- else if `failures === 0` and the alarm is later than `now+1 s` → `setAlarm(now+1 s)`;
- else leave it, so a backoff in progress is kept.

It never touches `generation` or `failures`.

- [ ] **Step 1: write the failing tests.**
  - `job-alarm.test.mjs`:
    - `scheduled() signals both lanes` (fix-plan name). `sweepLanes` with two fake lanes records `["service","general"]`, one `sweep()` each. When `service` rejects, `general` is still swept and the report is `["JOB_SWEEP_FAILED:service"]`.
    - `a sweep arms an idle lane in one second without touching failures or generation`: the alarm goes from `null` to `2_000`; `failures` and `generation` are unchanged.
    - `a sweep pulls a far healthy alarm forward` (missed-wake case): after a `fire()` with `nextDueAt` = 30 s, `sweep()` sets the alarm to `2_000`.
    - `a sweep keeps a failure backoff`: after one failed `fire()` (alarm `61_000`, failures 1), `sweep()` leaves `61_000`.
    - `a sweep re-arms an exhausted lane once per tick, and a success clears the failures`:
      - after the 7-failure sequence the alarm is `null`;
      - `sweep()` arms it; a failing `fire()` makes `calls === 8`, the alarm `null` again, and 2 `JOB_DRAIN_RETRY_EXHAUSTED` reports;
      - then `sweep()` plus a successful `fire()` returning `null` gives `failures === 0` and alarm `null`.
    - `drain refuses redirects so Authorization is never replayed elsewhere` (Review Focus 3). The fake fetcher sees `init.redirect === "manual"` and `authorization === "Bearer s"`. Responses:
      - 308 → rejects `/JOB_DRAIN_REDIRECTED/`;
      - 200 `{nextDueAt:null}` → `null`;
      - 200 `{}` → rejects `/JOB_DRAIN_NEXT_DUE_MISSING/`;
      - origin `http://example.com` or `https://www.earnestproperty.com/x` → rejects `/JOB_DRAIN_ORIGIN_INVALID/`.
  - `job-wake.test.mjs:68-78`, renamed `job drains have one 10-minute Cloudflare sweep and no Vercel schedule`:
    - the parsed `wrangler.jsonc` (strip `//` comments) has `triggers.crons` deep-equal `["*/10 * * * *"]`;
    - `vars.SITE_ORIGIN === "https://www.earnestproperty.com"`;
    - `index.ts` matches `/async scheduled\(/`, `/sweepLanes\(/` and `/createLaneDrain\(/`;
    - `vercel.ts` still matches `/crons:\s*\[\s*\]/`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:job-wake`
  - `npx tsc --noEmit -p workers/cron/tsconfig.json`
  - `npx wrangler deploy --dry-run --config workers/cron/wrangler.jsonc --outdir ../../.audit/cron-dry-run` (builds locally, deploys nothing; `--outdir` resolves relative to `workers/cron/`, so this lands in the root `.audit/`, which ESLint ignores)
  - `npm run lint`
- [ ] **Step 4: commit.**
  ```
  fix(jobs): sweep both job lanes every 10 minutes and refuse redirected drains

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: Wake whenever `OPS_WAKE_URL` is set; remove the flag and the stale docs

**Files:**
- **Modify `src/lib/control-plane/job-wake.js`:** add `wakeEnabledFromEnv`. `createJobWake` is unchanged.
- **Modify `src/lib/control-plane/job-wake.d.ts`:** add its type.
- **Modify `src/lib/control-plane/job-wake.server.ts:8`:** `enabled: wakeEnabledFromEnv(process.env)`. Lines `:20-22` (`CONFIG_MISSING` → local fallback) now happen only when the URL is set but `CRON_SECRET` is not.
- **Modify the test harnesses** (Review Focus 2):
  - `scripts/no-link-local-postgres.test.mjs:223` → `OPS_WAKE_URL: ""`;
  - `scripts/test-public-synthetic-browser.mjs:140` → `OPS_WAKE_URL: ""`;
  - `scripts/no-link-safe-checks.mjs:23` → `safeEnv.OPS_WAKE_URL = "";`;
  - `src/lib/whatsapp-enquiries/assignment.test.mjs:183-212` → save, blank and restore `OPS_WAKE_URL`.
- **Modify `.env.example:230-233`:**
  - delete the two flag lines;
  - the comment becomes `# Origin of the job alarm Worker (https://…workers.dev). Set = post-commit wakes on; empty = no wake (the Worker's 10-minute cron still drains). No database URL here.`;
  - add `CRON_SECRET=` with `# Server-only bearer shared with the job alarm Worker secret of the same name.` This documents an existing variable; it is not a new one.
- **Modify `CLAUDE.md`:**
  - `:11-12`: "Cloudflare Worker that holds the job-lane Durable Object alarms and a 10-minute cron sweep";
  - `:53`: "Vercel config-as-TS: redirects (no crons)";
  - `:84-86`: "Vercel crons are unused (`crons: []`). Jobs drain through post-commit wakes (when `OPS_WAKE_URL` is set) plus a 10-minute sweep from `workers/cron/`; both drain `ops_jobs` under a lease, so overlap is safe."
- **Modify `README.md:90`:** add "…and a 10-minute Cloudflare cron sweeps both lanes."

**Stale claims fixed in this task:**

| Where | Stale claim | Truth on 4965d48 |
|---|---|---|
| `CLAUDE.md:11-12` | Worker used "only for cron cadence" | It has no cron. It holds the DO alarms. |
| `CLAUDE.md:53` | `vercel.ts`: "crons + redirects" | `crons: []` (`vercel.ts:48`) |
| `CLAUDE.md:84-86` | "daily entries in vercel.ts are a safety floor … 15-minute recovery sweep" | No daily entries. The sweep was removed in efd0c91 (2026-09-25). |
| `.env.example:230-231` | "Enable [the flag] after … deployed" | The flag is removed. |
| `.env.example` | (missing) `CRON_SECRET` | It is required by the wake and both drains. |
| `README.md:90` | Only post-commit wakes | Plus the 10-minute sweep (after this batch). |
| `workers/cron/README.md:3,9-11,18` | "No Cron Trigger … idle queue makes no Neon request"; enable the flag; 7 failures stop until a new signal | Fixed in Task 1. |

`docs/implementation/whatsapp-enquiries/EVENT_WAKE_VERIFICATION_20260914.md` and `docs/reports/2026-09-29-no-link-environment.md` are dated evidence and stay unchanged.

**Interfaces:**
```ts
/** True only when OPS_WAKE_URL is a non-blank string; OPS_EVENT_WAKE_ENABLED is ignored. */
export function wakeEnabledFromEnv(env: Record<string, string | undefined>): boolean;
```

- [ ] **Step 1: write the failing tests** in `job-wake.test.mjs`:
  - `wakes when OPS_WAKE_URL set without flag` (fix-plan name):
    - `{OPS_WAKE_URL:"https://alarm.example"}` → `true`;
    - `{OPS_EVENT_WAKE_ENABLED:"true"}` → `false`;
    - `{OPS_WAKE_URL:"  ", OPS_EVENT_WAKE_ENABLED:"true"}` → `false`;
    - `job-wake.server.ts` matches `/enabled:\s*wakeEnabledFromEnv\(process\.env\)/`.
  - `the wake flag is gone from code, scripts and env docs`: a recursive scan of `src/`, `scripts/`, `workers/`, `.env.example`, `CLAUDE.md` and `README.md` finds no `OPS_EVENT_WAKE_ENABLED`.
  - `test harnesses blank OPS_WAKE_URL so no test can signal a real worker` (Review Focus 2):
    - each of the three scripts contains `OPS_WAKE_URL: ""` or `safeEnv.OPS_WAKE_URL = ""`;
    - `assignment.test.mjs` restores `OPS_WAKE_URL` in `finally`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:job-wake`, `npm run test:whatsapp-enquiries` (includes `assignment.test.mjs`), `npm run test:no-link`, `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(jobs): wake job lanes whenever OPS_WAKE_URL is set and drop OPS_EVENT_WAKE_ENABLED

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: One receipt retry rule, shared by recovery and `nextDueAt`

**Why a backoff is needed.** Without it, adding receipts to `nextDueAt` makes a failing receipt due "now" after every attempt. The alarm then burns all 20 attempts in about 20 s at 1 s spacing; a transient Neon or schema blip kills the receipt for good (Review Focus 1). With the backoff, 20 attempts span about 15 h.

**Files:**
- **Create `src/lib/whatsapp-enquiries/receipt-retry-policy.ts`.** It is pure: string constants and no imports.
- **Modify `src/lib/whatsapp-enquiries/inbound-receipts.server.ts:152-164`:** the claim uses `WHERE ${RECEIPT_RETRYABLE_SQL("whatsapp_inbound_receipts")}`. Extract the per-row body of `:173-201` into `projectClaimedReceipt(row, { query, project })` so Task 5 reuses it unchanged.
- **Modify `src/lib/control-plane/jobs-next-due.ts:6-19`:** for `lane === "service"` only, the statement becomes `SELECT least((<jobs min>), (SELECT min(${RECEIPT_DUE_AT_SQL("r")}) FROM whatsapp_inbound_receipts r WHERE ${RECEIPT_ELIGIBLE_SQL("r")}))`. The general SQL is unchanged.
- **Modify `src/lib/whatsapp-enquiries/inbound-receipts.db.test.mjs:88-113`:** age both receipts first (`UPDATE … SET updated_at=now()-interval '10 minutes'`). The backoff is new behaviour.
- **Extend `src/lib/control-plane/jobs-next-due.test.mjs`, `src/lib/whatsapp-enquiries/inbound-receipts.test.mjs` and `src/lib/control-plane/operations-recovery-owned.db.test.mjs`.**

**Interfaces:**
```ts
export const RECEIPT_MAX_ATTEMPTS = 20;
/** Rows recovery may ever retry: state in (pending,blocked_schema,failed), attempt_count < 20, block_reason ≠ REVIEW_REQUIRED. */
export function RECEIPT_ELIGIBLE_SQL(alias: string): string;
/** greatest(coalesce(lease_until,'-infinity'), updated_at + least(interval '2 minutes' * power(2, greatest(attempt_count-1,0)), interval '1 hour')) */
export function RECEIPT_DUE_AT_SQL(alias: string): string;
/** ELIGIBLE AND DUE_AT <= now() — the exact claim predicate. */
export function RECEIPT_RETRYABLE_SQL(alias: string): string;
export async function projectClaimedReceipt(row: ReceiptRow, ports: { query: ReceiptQuery; project: (e, mode: "off" | "observe") => Promise<unknown> }): Promise<"projected" | "failed" | "blocked_schema" | "review">;
```
A pending receipt has attempt 1, so it becomes due 2 min after `updated_at`. That is also the grace for an inline webhook projection that is still running (fact 11).

- [ ] **Step 1: write the failing tests.**
  - `jobs-next-due.test.mjs`:
    - `pending receipt yields nextDueAt` (fix-plan name): the service-lane SQL contains `whatsapp_inbound_receipts` and the `RECEIPT_DUE_AT_SQL("r")` text, and a fake row returns its ISO string.
    - `the general lane never reads receipts`.
  - `inbound-receipts.test.mjs`:
    - `recovery and nextDueAt share one retry predicate`: the source of both files imports `receipt-retry-policy.ts`, and neither contains a literal `attempt_count < 20` or `attempt_count<20`.
  - `operations-recovery-owned.db.test.mjs` (synthetic receipts through `storeInboundReceipt`; fake `project`):
    - `a receipt younger than the in-flight grace is not replayed` (Review Focus 5): a fresh `pending` receipt → `recoverPendingInboundReceipts` projects 0, and `getNextJobDueAt({lane:"service"})` ≈ `updated_at + 2 min` (±1 s).
    - `a due receipt is replayed in observe mode and then clears nextDueAt`: age it 3 min → 1 projection with mode `"observe"` (`capture_mode='active'`) → state `projected`, `nextDueAt` `null`.
    - `nextDueAt never points at a receipt recovery will not claim` (Review Focus 1). Seed four receipts:
      - (a) `attempt_count=20`;
      - (b) `block_reason='REVIEW_REQUIRED'`;
      - (c) `projected`;
      - (d) leased until `now()+5 min`.

      `nextDueAt` equals (d)'s `lease_until`, never ≤ now. Then make a receipt fail with a throwing `project` and call recovery 3 times with no time travel: `project` runs **once**, attempt 2 is due at `updated_at+4 min`, and `nextDueAt > now()`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:job-wake`, `npm run test:no-link`, `npm run test:operations:owned:db`, `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): retry failed inbound receipts on a backoff and include them in nextDueAt

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: Health tells the truth (per-lane heartbeats, an overdue-job check, stale worker)

**Files:**
- **Create `src/lib/control-plane/worker-heartbeat.server.ts`.** It writes the existing `whatsapp_service_worker_heartbeats` table, guarded by `to_regclass`. No migration.
- **Create `src/lib/control-plane/job-queue-health.ts`.** It is pure.
- **Modify `src/lib/control-plane/service-worker.server.ts:9-16`:** remove the heartbeat write (keep the schema check). This stops the local fallback from writing it (Review Focus 4).
- **Modify `src/routes/api.admin.whatsapp.service-worker.ts:10-12`:** after the bearer check, `recordWorkerHeartbeat("service-v2", SERVICE_CAPABILITIES)`.
- **Modify `src/routes/api.admin.control-plane.worker.ts:12-13`:** after the bearer check, `recordWorkerHeartbeat("general-v1", [])`.
- **Modify `src/lib/control-plane/health.server.ts`:**
  - `:7-12`: `HealthCheck` gets an optional `facts`;
  - `:129-207`: inside the existing `try`, one query reads the overdue count, the expired-lease count and both heartbeats, then pushes `assessJobQueueHealth(…)`.
- **Modify `src/lib/admin/operations/operations-types.ts:8-13`:** add `facts?` to the check type.
- **Modify `src/components/admin/operations/AdminOperationsOverview.tsx`:**
  - `:13-25`: add the label `"jobs.queue": "背景工作排程"`;
  - `:62-82`: when `check.facts` is present, render the facts line from the copy table instead of `configuredSummary`.
- **Modify `src/lib/whatsapp-enquiries/service-health.server.ts:122-124`:** add `WHERE worker_id='service-v2'`. At `:147-156`, pass `heartbeatStaleAfterMinutes: 30`.
- **Modify `src/lib/whatsapp-enquiries/service-health-model.ts:37-55`:** a stale or missing heartbeat pushes `SERVICE_WORKER_STALE` **even when idle**. Now that a cron exists, "no heartbeat" means a dead worker.
- **Modify `src/components/admin/operations/WhatsappServiceHealth.tsx:132-138`:** add a label map `{ SERVICE_WORKER_STALE: "工作程序超過 30 分鐘未回報" }` and fall back to the code.
- **Modify `src/lib/whatsapp-enquiries/service-health-readiness.test.mjs:27-38`:** the idle test now passes a fresh `heartbeatAt`.

**Interfaces:**
```ts
// worker-heartbeat.server.ts
export type WorkerHeartbeatId = "service-v2" | "general-v1";
export async function recordWorkerHeartbeat(id: WorkerHeartbeatId, capabilities: readonly string[], query?: typeof queryRows): Promise<boolean>; // false = table missing, never throws for that
// job-queue-health.ts
export const OVERDUE_GRACE_MINUTES = 15;
export const HEARTBEAT_STALE_MINUTES = 30;
export type JobQueueFacts = { overdueQueued: number; expiredLeases: number; serviceHeartbeatAt: string | null; generalHeartbeatAt: string | null; wakeConfigured: boolean };
export function assessJobQueueHealth(facts: JobQueueFacts, now: Date): HealthCheck; // key "jobs.queue", required:false, details booleans, facts {overdueQueued, expiredLeases, oldestHeartbeatMinutes|null}
// health.server.ts
export type HealthCheck = { key: string; required: boolean; status: HealthStatus; details?: Record<string, boolean>; facts?: Record<string, number | null> };
// service-health-model.ts
export function dueWorkHealth(input: { …existing; heartbeatStaleAfterMinutes?: number }): string[];
```
The overdue SQL counts **all** job types, not just `woztell.%`, so `ai.knowledge.repair` is included (L-03):
- `count(*) FILTER (WHERE status='queued' AND run_after < now() - interval '15 minutes')`
- `count(*) FILTER (WHERE status='running' AND lease_expires_at < now() - interval '15 minutes')`

- [ ] **Step 1: write the failing tests.**
  - `control-plane.test.mjs` (pure `assessJobQueueHealth`):
    - `fresh heartbeats and nothing overdue is healthy`;
    - `heartbeat older than 30 min → degraded` (fix-plan name): 31 min → degraded; 29 min → healthy; either lane counts;
    - `a missing heartbeat or wake URL is degraded, never failed` (`required === false`).
  - `operations-recovery-owned.db.test.mjs` → `runControlPlaneHealthChecks()`, with env `CONTROL_PLANE_APPROVAL_SECRET` and `OPS_WAKE_URL` set to synthetic values:
    - `queued job past run_after → degraded` (fix-plan name): one `ai.knowledge.repair` queued with `run_after=now()-20 min` and fresh heartbeats → `jobs.queue` degraded, `facts.overdueQueued === 1`, top status `degraded`.
    - `future-scheduled, just-due and backing-off jobs are not overdue`: `run_after` = `+1 h`, `-1 min`, and a retry with `attempt_count=1, run_after=+2 min` → healthy.
    - `heartbeat older than 30 min → degraded` (owned): `seen_at` = `now()-31 min` for `general-v1` → degraded.
  - `control-plane.routes.test.mjs`:
    - `only the authenticated drain routes write lane heartbeats; runServiceJobs and the local fallback do not` (Review Focus 4):
      - `service-worker.server.ts` and `job-wake.server.ts` do not match `/heartbeat/i`;
      - each drain route calls `recordWorkerHeartbeat("service-v2"|"general-v1"` at an index after its `UNAUTHORIZED` return.
  - `service-health-readiness.test.mjs`:
    - `stale heartbeat raises SERVICE_WORKER_STALE even when idle`;
    - `a fresh heartbeat with no work raises nothing`.
  - `operations-components.test.tsx`:
    - `jobs.queue row shows 背景工作排程 with overdue count and heartbeat age`: the markup contains 「背景工作排程」, 「逾時未執行的工作：1」, 「工作程序最後回報：31 分鐘前」 and 「降級」.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:control-plane`
  - `npm run test:whatsapp-enquiries`
  - `npm run test:operations`
  - `npm run test:operations:owned:db`
  - `npm run lint`, `npm run typecheck`, `npm run build`
- [ ] **Step 4: commit.**
  ```
  fix(ops): report overdue jobs and a silent job worker as degraded health

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 5: Receipts on /admin/operations: list, 「需要分派」, observe-only 重試 (admin/manager, audited)

**Files:**
- **Modify `src/lib/whatsapp-enquiries/inbound-receipts.server.ts`:** add `listInboundReceiptProblems` and `retryInboundReceipt`.
- **Create `src/routes/api.admin.control-plane.receipts.ts`:** `GET`, guarded by `requireStaffPermission(request,"system.jobs.read")`.
- **Create `src/routes/api.admin.control-plane.receipts.$id.retry.ts`:** `POST`, guarded by `system.jobs.retry`. It validates a uuid and a strict `{}` body, gives 409 on `null`, and writes a failure audit on an exception (same shape as `api.admin.control-plane.jobs.$id.retry.ts:39-55`).
- **Modify `src/routeTree.gen.ts`:** the 2 generated entries only.
- **Modify `src/lib/admin/operations/operations-client.ts`** (next to `:138-150`): add `fetchOperationsReceipts` and `retryOperationsReceipt`.
- **Modify `src/lib/admin/operations/operations-types.ts`:** add the receipt types.
- **Create `src/components/admin/operations/AdminOperationsReceipts.tsx`** and **`operations-receipts-utils.ts`.** The pure helpers stay out of the component file because of the react-refresh rule.
- **Modify `src/routes/admin.operations.tsx:287-294`:** inside the 背景工作 tab, render `<AdminOperationsReceipts … pulse={pulse} onMutationComplete={handleMutationComplete} />` under `AdminOperationsJobs`. Add no timer (#223's test).
- **Modify `scripts/browser-fixtures/property-maintenance/synthetic-operations.ts`** (receipt fakes) and **`e2e/admin-operations-recovery.spec.ts`.**
- **Extend `operations-recovery-owned.db.test.mjs`, `control-plane.routes.test.mjs` and `operations-components.test.tsx`.**

**Interfaces:**
```ts
type Actor = Pick<StaffAccess, "staffId" | "roles">;
export type InboundReceiptProblemKind = "retry_scheduled" | "retry_exhausted" | "review_required" | "needs_routing";
export type InboundReceiptProblem = {
  id: string; kind: InboundReceiptProblemKind; projectionState: "pending" | "failed" | "blocked_schema" | "projected";
  captureMode: "off" | "observe" | "active"; attemptCount: number; blockReason: string | null;
  receivedAt: string; nextRetryAt: string | null; conversationId: string | null; canRetry: boolean;
}; // never member_id, phone, text or normalized_event
export async function listInboundReceiptProblems(actor: Actor, options?: { limit?: number /*≤100*/; sinceDays?: number /*30, applies to needs_routing*/; query?: ReceiptQuery }):
  Promise<{ rows: InboundReceiptProblem[]; counts: Record<InboundReceiptProblemKind, number> }>;
/** admin|manager only (403 Response otherwise). One UPDATE claims the lease (no backoff or cap check; the lease and
 *  state still apply) and INSERTs ops_audit_logs('system.jobs.retry','whatsapp.receipt.retry','whatsapp_inbound_receipt')
 *  in the same statement; then projectClaimedReceipt in off|observe only. null = not retryable or already leased. */
export async function retryInboundReceipt(receiptId: string, actor: Actor, context: { requestId: string },
  ports?: ReceiptPorts & { project?: (e, mode: "off" | "observe") => Promise<unknown> }):
  Promise<{ receiptId: string; projectionState: "projected" | "failed" | "blocked_schema" } | null>;
// operations-client.ts
export function fetchOperationsReceipts(isWorkspaceCurrent?: () => boolean): Promise<{ data: { rows: InboundReceiptProblem[]; counts: Record<InboundReceiptProblemKind, number> } }>;
export function retryOperationsReceipt(id: string, isWorkspaceCurrent?: () => boolean): Promise<{ data: { receiptId: string; projectionState: string } }>;
```

**How rows are classified:**

| Kind | Rule |
|---|---|
| `needs_routing` (「需要分派」) | `capture_mode='active' AND projection_state='projected' AND attempt_count>1 AND received_at > now()-30 days`. This is C-09: projected by recovery, so as observe. |
| `review_required` | `block_reason='REVIEW_REQUIRED'` |
| `retry_exhausted` | eligible state with `attempt_count>=20` |
| `retry_scheduled` | `RECEIPT_ELIGIBLE_SQL`, with `nextRetryAt = RECEIPT_DUE_AT_SQL` |

`canRetry` is true for `retry_scheduled` and `retry_exhausted` when `origin='live_webhook' AND event_kind='customer_message'`. `conversationId` comes from a `LEFT JOIN whatsapp_conversations w ON w.channel_id=r.channel_id AND w.woztell_member_id=r.member_id`.

**New copy (zh-HK):**

| Where | Copy |
|---|---|
| Section title | WhatsApp 來訊收件 |
| Section help | 未能寫入收件匣的客戶來訊。系統會自動重試；重試只會補錄訊息，不會回覆客戶，亦不會通知或分派同事。 |
| Kind badges | 等候重試 · 已停止自動重試 · 需人工檢查 · 需要分派 |
| 需要分派 help | 此訊息在自動分派開啟時收到，但補錄時只作記錄，未有分派或通知同事。請開啟對話並手動分派。 |
| Columns | 收到時間 · 狀態 · 嘗試次數 · 下次重試 · 原因 · 對話 · 操作 |
| Reasons | PROJECTION_FAILED 寫入收件匣失敗 · WA_ENQUIRY_SCHEMA_REQUIRED 資料庫結構未就緒 · REVIEW_REQUIRED 非即時來訊，需人工檢查 · none — |
| Link / no link | 開啟對話 · 未有對話 |
| Button / aria | 重試 · 重試收件 {前 8 字元} |
| Confirm title / body | 重試這則來訊？ · 系統會再嘗試把這則訊息寫入收件匣（只作記錄）。不會回覆客戶，亦不會通知或分派同事。 |
| Confirm / cancel | 重試 · 取消 |
| Toast: projected / failed | 已補錄這則來訊。 · 重試未成功，系統會稍後再自動重試。 |
| Toast: 409 | 此收件的狀態已改變，未有重試。已重新載入最新狀態。 |
| Error (with ref) | 未能重試，請稍後再試。（支援參考編號：{requestId}） |
| Empty / load error | 沒有需要處理的來訊收件。 · 未能載入來訊收件。 |
| Health (Task 4) | 背景工作排程 · 逾時未執行的工作：{n} · 過期租約：{n} · 工作程序最後回報：{n} 分鐘前 / 未有證據 · 自動喚醒未設定 · 工作程序超過 30 分鐘未回報 |

- [ ] **Step 1: write the failing tests.**
  - `operations-recovery-owned.db.test.mjs`. Use synthetic staff (admin, manager, agent) and receipts; the fake `project` records its calls.
    - `retry re-projects a failed receipt once; audited; agent forbidden` (fix-plan name):
      - a `failed` receipt with `capture_mode='active'` and `attempt_count=20`, retried by the admin, gives `{projectionState:"projected"}`;
      - `project` is called exactly once, with mode `"observe"`;
      - exactly 1 `ops_audit_logs` row: `action='whatsapp.receipt.retry'`, `permission='system.jobs.retry'`, `resource_id=<id>`, the actor and the request id;
      - a **manager** may also retry;
      - an **agent** gets a rejected `Response` with status 403, the row is unchanged, there is 0 audit and 0 `project` calls;
      - retrying a `projected`, `REVIEW_REQUIRED` or `needs_routing` row returns `null` with 0 audit.
    - `concurrent retry, double click and recovery project a receipt once` (Review Focus 5):
      - `Promise.all` of 2 retries plus `recoverPendingInboundReceipts` on an aged failed receipt → `project` calls === 1;
      - exactly one retry is non-null, or 0 when recovery won the lease;
      - the audit count equals the number of non-null retries.
    - `list shows retry, exhausted, review and 需要分派 receipts without message content`:
      - one row of each kind gets the right `kind` and `canRetry`;
      - a 40-day-old C-09 row is excluded;
      - `JSON.stringify(result)` contains neither the synthetic phone `85255550101` nor the text, and no row has `memberId` or `text` keys;
      - `conversationId` is filled when a matching conversation exists.
  - `control-plane.routes.test.mjs`:
    - `receipt routes enforce jobs.read and jobs.retry, validate ids and bodies, and audit failures`: the source matches `requireStaffPermission(request, "system.jobs.read")` and `"system.jobs.retry"`, `z.string().uuid()`, `z.object({}).strict()`, `status: 409` and `writeAudit(` in the catch.
  - `operations-components.test.tsx`:
    - `receipts panel labels C-09 rows 需要分派 with an open-conversation link and no retry button`: the markup has 「需要分派」, `href="/admin/whatsapp?conversation=…"` and no 「重試」 in that row.
    - `retry appears only for retryable rows and only with jobsRetry`: rendered with `agentCapabilities` there is no 重試 at all.
    - `the receipts panel never polls`: the source does not match `/setInterval|useVisibleInterval/`.
  - `e2e/admin-operations-recovery.spec.ts`:
    - `receipt retry confirms, reads back and shows 已補錄這則來訊`: synthetic receipts, the confirm dialog copy, 375 px and 1440 px screenshots, and a restricted actor sees no button.
- [ ] **Step 2:** implement until green. Capture 375 px and 1440 px screenshots of the 背景工作 tab, before and after.
- [ ] **Step 3:** run:
  - `npm run test:operations:owned:db`
  - `npm run test:control-plane`
  - `npm run test:operations`
  - `npm run test:operations:ui` and the rest of the `playwright.admin-owned.config.ts` suites
  - `npm run lint`, `npm run typecheck`, `npm run build`
- [ ] **Step 4: commit.**
  ```
  feat(ops): list failed WhatsApp receipts and retry them observe-only from operations

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## Owner actions before production

These are gated, in this order. Claude does none of them.

**Why the order matters.** The backlog drains as soon as **any** lane drains, not only when the cron starts. If production already has `OPS_WAKE_URL` set and the old Worker deployed, merging the app turns the wake on (if the flag was off). The next committed job then drains every due job in its lane. **So the pre-flight must happen before the merge, not just before `wrangler deploy`.**

1. **Pre-flight (read-only).** Run this in the Neon SQL editor on production. It reads names and counts only, no payload or message content:
   ```sql
   BEGIN TRANSACTION READ ONLY;

   -- A. Jobs by type, status and age, with what draining them does.
   SELECT job_type, payload_version, status,
          count(*)                                                          AS jobs,
          count(*) FILTER (WHERE status='queued'  AND run_after <= now())   AS due_now,
          count(*) FILTER (WHERE status='queued'  AND run_after >  now())   AS scheduled_later,
          count(*) FILTER (WHERE status='running' AND lease_expires_at < now()) AS expired_leases,
          date_trunc('minute', now() - min(created_at))                     AS oldest_age,
          max(attempt_count)                                                AS max_attempts_used,
          string_agg(DISTINCT last_error_code, ', ')                        AS error_codes,
          CASE
            WHEN job_type = 'woztell.campaign.deliver'                         THEN 'SENDS customer WhatsApp (campaign)'
            WHEN job_type = 'woztell.reply.deliver' AND payload_version = 1    THEN 'SENDS customer WhatsApp (staff reply)'
            WHEN job_type = 'woztell.reply.deliver' AND payload_version = 2    THEN 'SENDS customer WhatsApp (automated)'
            WHEN job_type IN ('woztell.enquiry.staff.notify','woztell.enquiry.staff.test','lead.staff.alert')
                                                                               THEN 'SENDS staff WhatsApp / Inbox note'
            WHEN job_type = 'woztell.enquiry.service'                          THEN 'prepares an automated customer reply'
            WHEN job_type = 'woztell.enquiry.process'                          THEN 'database; in active mode may schedule replies'
            WHEN job_type = 'woztell.enquiry.assign'                           THEN 'WozTell Inbox assignment (provider call)'
            WHEN job_type = 'woztell.history.import'                           THEN 'WozTell history read (provider call)'
            WHEN job_type = 'ai.knowledge.rebuild'                             THEN 'AI embedding calls (cost)'
            ELSE 'database only'
          END                                                               AS effect_when_drained
   FROM ops_jobs
   WHERE status IN ('queued','running','failed')
   GROUP BY job_type, payload_version, status
   ORDER BY status, job_type, payload_version;

   -- B. The individual queued/running jobs (ids to cancel in /admin/operations → 背景工作).
   SELECT id, job_type, payload_version, status, attempt_count, max_attempts,
          run_after, lease_expires_at, date_trunc('minute', now() - created_at) AS age
   FROM ops_jobs
   WHERE status IN ('queued','running')
   ORDER BY created_at
   LIMIT 200;

   -- C. Inbound WhatsApp receipts: what recovery will replay (observe only) and what needs a person.
   SELECT projection_state, capture_mode, origin, event_kind,
          coalesce(block_reason, '-')                                         AS block_reason,
          count(*)                                                            AS receipts,
          count(*) FILTER (WHERE projection_state IN ('pending','blocked_schema','failed')
                             AND attempt_count < 20
                             AND block_reason IS DISTINCT FROM 'REVIEW_REQUIRED') AS will_auto_retry,
          count(*) FILTER (WHERE capture_mode='active' AND projection_state='projected'
                             AND attempt_count > 1)                           AS needs_routing_c09,
          date_trunc('minute', now() - min(received_at))                      AS oldest_age,
          max(attempt_count)                                                  AS max_attempt
   FROM whatsapp_inbound_receipts
   WHERE projection_state IN ('pending','blocked_schema','failed')
      OR (capture_mode='active' AND projection_state='projected' AND attempt_count > 1)
   GROUP BY 1,2,3,4,5
   ORDER BY 1,2,3,4,5;

   ROLLBACK;
   ```
   **Read the output like this:**
   - Cancel any queued `woztell.campaign.deliver` or `woztell.reply.deliver` you no longer want sent; a stale reply would reach a customer late.
   - `failed` jobs never re-run automatically.
   - Receipts replay as **observe only** and cannot be cancelled from the UI (Open question 5).
2. **Check settings** in Vercel (names only; never paste values into chat):
   - **HARD GATE.** `OPS_WAKE_URL` = the Worker origin (`https://earnestproperty-cron.<subdomain>.workers.dev`). Before or immediately at merge, either set it or deploy the Worker right after merge: with `OPS_WAKE_URL` unset nothing drains until the Worker is deployed;
   - `CRON_SECRET` is set, and equals the Worker secret of the same name.
3. **Merge and deploy the app.** Then delete `OPS_EVENT_WAKE_ENABLED` from Vercel; the deploy no longer reads it.
4. **Check the www drain routes before deploying the Worker** (Review Focus 3; from the owner's machine):
   ```
   curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST https://www.earnestproperty.com/api/admin/control-plane/worker
   curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST https://www.earnestproperty.com/api/admin/whatsapp/service-worker
   ```
   Expect `401` with an empty redirect URL. A `3xx` means: **do not deploy**. Keep `SITE_ORIGIN` on vercel.app and defer that change to FX-13.
5. **Staging verification.**
   - Claude runs `wrangler dev --test-scheduled --config workers/cron/wrangler.jsonc --var SITE_ORIGIN:http://localhost:3000` against a local app on owned Postgres. Claude then hits `/__scheduled?cron=*/10+0-13+*+*+*` and shows that a synthetic `ai.knowledge.repair` job (no AI call) drains and both heartbeats update.
   - The owner may repeat this on a Neon branch with a preview, with the alarm stopped: queue one synthetic job and confirm it drains within 10 min.
6. **Deploy the Worker (owner).**
   ```
   npx wrangler deploy --config workers/cron/wrangler.jsonc
   ```
   In the Cloudflare dashboard, confirm the Triggers show BOTH `*/10 0-13 * * *` and `0 14-23 * * *` (do not replace them with a flat `*/10`) and `SITE_ORIGIN` is www.
7. **Canary** (within 20 min, then again at 24 h):
   - /admin/operations shows 背景工作排程 正常, and 工作程序最後回報 < 15 min during 08:30–22:00 HKT, < 90 min overnight;
   - the 3 `ai.knowledge.repair` jobs (and anything you kept) are `succeeded`;
   - the Worker logs have no `JOB_DRAIN_FAILED`, `JOB_DRAIN_REDIRECTED` or `JOB_SWEEP_FAILED`;
   - Vercel logs show 200s on both drain routes about every 10 min;
   - the receipt panel matches query C;
   - at 24 h, check Neon compute usage (Open question 1).
8. **Rollback.**
   - `npx wrangler rollback` to the previous Worker version. That version has no cron and restores the vercel.app `SITE_ORIGIN`.
   - Revert the PR.
   - If you want the old behaviour exactly, re-add `OPS_EVENT_WAKE_ENABLED` with its previous value.
   - No data change needs undoing.

## Open questions

Each has a recommended default.

1. **Cadence.** Each tick makes 2 Vercel calls and a few Neon queries, even when idle. That keeps Neon compute awake for much of the day, which reverses the "idle makes no Neon request" design (`workers/cron/README.md:3`). **Resolved by decision 4** (10 min 08:00–22:00 HKT, hourly overnight). Move to `*/15` if the 24 h canary shows unwelcome Neon usage; the heartbeat threshold would then become 45 min.
2. **C-09 detection and retention.** "Active, projected, `attempt_count>1`" also catches a receipt whose inline projection succeeded but whose status write failed (rare). There is no dismiss without a migration. **Default:** list 30 days, link to the conversation, and add a dismiss with the live re-route follow-up.
3. **Does manual 重試 bypass the 20-attempt cap and the backoff?** **Default: yes.** It still respects the lease and the eligible states, and it is audited.
4. **Do terminal failures degrade the badge?** **Default: no.** They show in 需要跟進 and the receipt panel, so the badge does not stay 降級 forever.
5. **Unwanted receipts in the backlog.** The UI cannot cancel a receipt. **Default:** replay all of them; it is observe-only, with no customer or staff message. If the owner wants some skipped, Claude drafts a reviewed one-off `UPDATE … SET block_reason='REVIEW_REQUIRED'` for the owner to run.
6. **The general-lane heartbeat reuses `whatsapp_service_worker_heartbeats`** (row `general-v1`) instead of adding a migration. **Default: reuse.** A rename belongs to FX-19.
7. **`SITE_ORIGIN` → www now or in FX-13?** **Default: now**, because code and config show no redirect on www `/api/*` (fact 15). It is guarded by `redirect:"manual"` and owner step 4. Defer only if step 4 returns a 3xx.

## Findings that differ from the approved fix plan

- **The backlog starts draining at the app merge** if `OPS_WAKE_URL` is already set, not only at `wrangler deploy`. Hence the pre-flight comes before the merge.
- **The cron uses `sweep()`, not `signal()`.** `signal()` resets the failure backoff. The 7-failure delete stays, and the cron makes it self-healing.
- **Receipts need a retry backoff** (new behaviour). Otherwise `nextDueAt` drives a 1-second alarm loop. The existing test `recovery_never_upgrades_old_effects` changes accordingly.
- **The existing test `job drains have no recurring Cloudflare or Vercel schedule`** (`job-wake.test.mjs:68`) has to be inverted.
- **"Overdue" has a 15-minute grace**, not just "past `run_after`". Otherwise every just-queued job flickers 降級.
- **The badge says 降級**, not 「異常」. The existing labels are kept.
- **The heartbeat was misleading**: written by the local fallback, service lane only. It moves to the drain routes, and the general lane gets one.
- **Without `OPS_WAKE_URL` there is now no wake and no local fallback.** Before, the flag on with no URL ran jobs locally.
- **No 「一鍵重新分派」** for C-09 (owner decision 2). Staff route by hand through 「開啟對話」.
- **Test files differ.** Owned tests go into the existing `operations-recovery-owned.db.test.mjs` rather than new `health.owned.db.test.mjs` / `inbound-receipts.owned.db.test.mjs`, so that `package.json` and `ci.yml` (contended by #225 and #226) stay untouched.
- **The live backlog's 3 `ai.knowledge.repair` jobs make no AI call** (`allowEmbeddings:false`). The riskier drains are any queued `woztell.campaign.deliver` or `woztell.reply.deliver`.
- **`.env.example` has no `CRON_SECRET` line.** One is added as documentation of an existing variable.
