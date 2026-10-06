# FX-10b: Failed campaigns can be retried without double-sending. Implementation plan

**Status:** draft for owner review. Nothing in this plan has been applied anywhere. The open questions at the end have defaults, and I will use those defaults unless the owner says otherwise.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- An expired or wrong WozTell token, missing configuration, or the WhatsApp kill switch no longer burns through a blast. The run stops at the first sign of it. Every recipient not yet sent stays `queued`. The campaign drops back to 待審核 with a 「已暫停」 marker, and nothing more is sent until a manager approves it again through the existing 「發送…」 confirmation.
- A provider outage (timeouts, bare 5xx) stops the run after **3** consecutive unconfirmed results, instead of stamping every remaining recipient as 結果未明 forever.
- A manager can press 「重新發送失敗收件人（N）」 on the **same** campaign. This re-queues only recipients whose send was *definitely refused* and who were never handed to WhatsApp. It never re-queues 結果未明, sent, in-flight or opted-out recipients, or a second number for the same phone. It moves the campaign to 待審核, so the re-send needs the same approval as the original.
- 結果未明 recipients are listed in the confirmation by name only, never by phone number, so staff can check them by hand.
- No recipient can get two accepted sends from one campaign, including through concurrent clicks, a leftover delivery job, or a re-materialised audience.

Finding: D-04.

**Architecture.**
- **No migration.** "Paused" is expressed with existing states: campaign `review` plus recipient rows `status='queued', error='WOZTELL_CAMPAIGN_PAUSED'`. `review` is already outside the delivery set (`queued`/`sending`), so the claim, the dispatch reservation and the send-queue cron all ignore it, and the only way back to sending is `queueAdminCampaign`, the existing manager-only approval. Fact 19 explains why a new `paused` enum value could not even carry the migration rules.
- **One pure classifier** (`src/lib/woztell/campaign-send-outcome.ts`) decides, per provider result, among `sent`, `failed` (retry-safe), `unknown` (terminal) and `stop` (systemic: pause the campaign). It reads only fields that `sendWoztellResponse` already returns on main and on FX-08, so it does not touch `woztell.server.ts` or `provider-result.ts` (Fact 21).
- **One pure SQL-predicate module** (`src/lib/neon/campaign-retry.ts`) defines "retry-safe failed" exactly once. The campaign list count, the retry preview and the re-queue all use it.
- **The pause is one statement under the campaign lock and the job lease.** The re-queue is one statement after a campaign row lock, which makes it idempotent and safe under concurrency without a new lock table.
- **Materialisation is hardened.** It never resurrects a `failed` or dispatched row, and for a campaign that already has delivery history it never adds new contacts. That makes the re-queue the only path back to `queued` for a failed recipient.

**Tech stack.**
- Owned full-schema Postgres: `withOwnedPostgres` + `mockOwnedServerDb` (`scripts/acceptance/owned-postgres-test.mjs:144-164`) with `--experimental-test-module-mocks`. The provider is mocked at `src/lib/woztell/provider-fetch.ts` (`boundedProviderFetch`) with `mock.module`, and `globalThis.fetch` still throws.
- Pure tests: `node --test`, in files already wired to `test:woztell` and `test:control-plane`.
- Browser: Playwright `playwright.admin-owned.config.ts`, `e2e/admin-campaign-review.spec.ts`, campaign-review fixture.
- **No new `test:*` script and no `package.json` or `ci.yml` edit.** Every new test lives in a file that an existing CI-run script already names (Global Constraints).

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`, D-04 (register row `:222`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-10b (`:491-507`), Global constraints (`:17-40`).

## Facts verified in the code (main 4965d48)

| # | Fact | Where |
|---|---|---|
| 1 | **Recipient statuses are `queued`, `sending`, `sent`, `failed`, `blocked`, `cancelled`.** The column is `TEXT` with no CHECK. There is **no `accepted` and no `unknown` status**: "unknown" is `status='failed', error='WOZTELL_DELIVERY_UNKNOWN'` (or `sending` reconciled into that), and "accepted" is `sent`. `UNIQUE (campaign_id, contact_id)`. `external_message_id` exists but campaign delivery never writes it. | `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:199-209`; `src/lib/woztell/campaign-delivery.server.ts:170-196` |
| 2 | **Claim.** One transaction locks the campaign, then (a) turns `sending` rows **with** `dispatch_started_at` whose dispatch job is no longer live into `failed / WOZTELL_DELIVERY_UNKNOWN`, (b) returns `sending` rows **without** `dispatch_started_at` whose claim job is not live to `queued / UNDISPATCHED_LEASE_EXPIRED`, (c) claims up to 20 `queued` rows with `dispatch_started_at IS NULL` while the campaign is `queued`/`sending`, `FOR UPDATE SKIP LOCKED`, stamping `claim_job_id/worker/attempt` from a live lease. | `campaign-delivery.server.ts:103-157` |
| 3 | **Dispatch reservation.** Before each provider call, `beginCampaignDispatch` locks campaign → contact → template → job, re-checks consent (`opt_in_whatsapp`, `opted_out_whatsapp`), `marketingIdentitySafeSql`, `campaignRecipientPrimarySql`, active template, campaign `queued`/`sending` and the exact live lease, then stamps `dispatch_started_at` and writes a `campaign.dispatch` audit. A row that fails the check becomes `blocked / WOZTELL_DISPATCH_INELIGIBLE` (or `cancelled`). | `campaign-delivery.server.ts:39-101` |
| 4 | **Result mapping today.** `result.ok` → `sent`. Thrown send (timeout, network) → `failed / WOZTELL_DELIVERY_UNKNOWN`. Otherwise `providerFailureCode`: no `status` → `WOZTELL_CONFIGURATION_UNAVAILABLE`; `refused === true` → `WOZTELL_PROVIDER_REJECTED`; status in `[400,401,403,404,422,429]` → `WOZTELL_PROVIDER_REJECTED`; anything else → `WOZTELL_DELIVERY_UNKNOWN`. `updateCampaignRecipient` clears `dispatch_started_at` only for `WOZTELL_PROVIDER_REJECTED` and `WOZTELL_CONFIGURATION_UNAVAILABLE`. | `campaign-delivery.server.ts:253-269,271-323,178-186` |
| 5 | **A 401 or 403 does not stop the run.** It maps to `failed / WOZTELL_PROVIDER_REJECTED` and the loop moves on to the next recipient, for up to 100 batches × 20. There is no "definite refusal" branch for auth: the same code covers "this one number cannot receive" and "the whole account is locked out". | `campaign-delivery.server.ts:264,321-322,356-406` |
| 6 | **WozTell's real auth failure is not a 401.** WOZTELL answers a refused send with HTTP **500** and `{ "ok": 0, "err": "User is not authorized." }`, and an unknown channel with `{ ok:0, err_code:112, err:"Channel ID not found" }`. `sendWoztellResponse` reports these as `refused: true`, so today they are `WOZTELL_PROVIDER_REJECTED`. A fix keyed only on 401/403 would miss the realistic case. | `src/lib/woztell/woztell.server.ts:412-468` (comment `:435-436`); `src/lib/woztell/woztell.test.mjs:595-608,675-678,687-696` |
| 7 | **Configuration errors strand the campaign in `sending` forever.** No `status` (WozTell disabled, missing token or channel) re-queues the recipient and throws `WOZTELL_CONFIGURATION_UNAVAILABLE`. The handler treats that as retryable, so the job backs off for 5 attempts, then fails. The campaign stays `sending` with `queued` rows. The send-queue cron finds it but enqueues with the same `reviewed_at`-scoped idempotency key, and `enqueueJob` returns the existing failed row, so no worker ever runs it again. `isEnabled()===false` at the start of a run does the same. | `campaign-delivery.server.ts:316-320,344-346`; `src/lib/control-plane/job-handlers.server.ts:207-218,261-268`; `src/lib/control-plane/jobs.server.ts:79-92,223-271`; `src/routes/api.admin.jobs.send-queue.ts:18-28,50-82`; `src/lib/control-plane/jobs.ts:70-75` |
| 8 | **All-failed means campaign `failed`, and `failed`/`completed` are dead ends.** `classifyCampaignDeliveryStatus` returns `failed` when `failed + blocked >= total`, else `sending` while anything is queued or sending, else `completed`. The handler then throws non-retryable `WOZTELL_CAMPAIGN_REJECTED` whenever `failed > 0`. `saveAdminCampaign` only updates rows in `draft`/`review`/`scheduled`, and `canPrepareAdminCampaignQueue` only allows `review`/`scheduled`. So there is no way back from `failed` or `completed`, which is why staff build a new campaign, and that one re-sends to everybody already reached (D-04). | `src/lib/neon/admin-workflow.ts:111-140`; `job-handlers.server.ts:255-259`; `src/lib/neon/admin-data.server.ts:3377-3409` |
| 9 | **There is no transition table and no `paused` status.** `admin-workflow.ts:120-137` is `canPrepareAdminCampaignQueue` plus `classifyCampaignDeliveryStatus`, not a state machine. The DB enum is `whatsapp_campaign_status ('draft','review','scheduled','queued','sending','completed','failed','cancelled')`, created in one `DO` block. No later migration touches it, and there is no CHECK on campaign status. | `admin-workflow.ts:111-140`; `20260623090000_neon_admin_crm_whatsapp.sql:24-28,190`; `grep whatsapp_campaign neon/migrations` (2 files) |
| 10 | **A partial retry path already exists and is unsafe once campaigns can return to `review`.** `materializeCampaignRecipients` upserts the current audience with `ON CONFLICT (campaign_id, contact_id) DO UPDATE` and keeps a row only when it is `sent`/`sending` or `error='WOZTELL_DELIVERY_UNKNOWN'`. Every other `failed`, `blocked` or `cancelled` row is reset to `queued`, **including `failed` rows whose `dispatch_started_at` is still set** (for example `WOZTELL_RECIPIENT_MISSING`, or `blocked / WOZTELL_RECIPIENT_NOT_OPTED_IN` after reservation). The claim skips those, so they would sit in `queued` forever and pin the campaign in `sending`. It also **inserts any contact who newly matches the audience**. Today this is unreachable for failed campaigns (Fact 8). It becomes reachable as soon as anything moves a campaign with history back to `review`. Pinned by `control-plane.test.mjs:686-703` (regex on the UNKNOWN clause). | `admin-data.server.ts:3411-3480` (upsert `:3437-3465`) |
| 11 | **The approval gate is the queue step.** `queueAdminCampaign` flips `review`/`scheduled` → `queued` only if the template is active, the audience exists and at least one queued recipient passes consent, identity and primary checks. It stamps `reviewed_by` and a fresh `reviewed_at`, enqueues one `woztell.campaign.deliver` job keyed on `reviewed_at`, and audits `campaign.queue`, all in one statement. Callers: `/api/admin/campaigns/$id/queue` (`requireStaffPermission(…, "campaign.queue")`, which managers and admins hold, agents and viewers do not) via `sendAdminCampaignQueue` (materialise, then queue), and `queueAdminCampaignServer` (`requireStaff(["admin","manager"])`). There is no separate second reviewer. | `admin-data.server.ts:3507-3642`; `src/routes/api.admin.campaigns.$id.queue.ts:11-14`; `src/lib/control-plane/permissions.ts:20-37`; `src/lib/neon/admin-data.ts:1739-1778` |
| 12 | **Phone dedupe is per campaign only.** `campaignRecipientPrimarySql` lets a row send only if no other row in the same campaign for the same phone (8-digit or 852 form) or member id is `sent`, carries `WOZTELL_DELIVERY_UNKNOWN`, or has a lower id and is not `cancelled`/`blocked`. It is checked at queue time and again in the dispatch reservation. Nothing deduplicates across campaigns, which is why "make a new campaign" double-sends. | `src/lib/neon/phone-identity.ts:26-53`; used at `campaign-delivery.server.ts:70`, `admin-data.server.ts:3531,3586` |
| 13 | **Window rules do not block a re-send, and none need changing.** Campaigns send approved templates, so the 24-hour customer-service window (`canReplyToConversation`) does not apply. `scheduled_at` is stored and displayed but never enforced. The template must be active at queue time and again at dispatch. FX-08 (#228) keeps `opted_out_whatsapp` as the authoritative flag and keeps templates blocked for opted-out contacts even after a "reopen". | `admin-workflow.ts:9-28`; `admin-data.server.ts:3388-3394,3574`; `campaign-delivery.server.ts:71`; `origin/fix/fx-08-optout-unknown:src/lib/neon/admin-workflow.ts` (`optOutReplyState`) |
| 14 | **No late provider receipt can touch a campaign recipient.** Nothing outside campaign delivery, materialise/queue/cancel and lease recovery writes `whatsapp_campaign_recipients` (grep of `src`, `scripts`), and the webhook writes `whatsapp_messages` only. A "refused" row therefore cannot later flip to `sent`. The real race is a *misclassified* refusal (Fact 15). | `rg whatsapp_campaign_recipients src scripts` |
| 15 | **A 4xx carrying acceptance evidence is filed as retry-safe.** `providerFailureCode` checks the status list before the evidence, so a 400/401/403/404/422/429 whose body has a `messageId` or `ok:1` (`providerResult.possibleAccepted === true`) becomes `WOZTELL_PROVIDER_REJECTED`. Harmless today, because nothing retries it, but a double-send once re-queue exists. FX-08's `classifyOutboundSendResult` orders "any acceptance signal → unknown" before the status list for staff replies. Campaigns do not use it. | `campaign-delivery.server.ts:253-269`; `src/lib/woztell/provider-result.ts:90-101`; `woztell.server.ts:408-433,468`; FX-08 `provider-result.ts:+120-147` |
| 16 | **A provider outage marks every remaining recipient terminal.** There is no circuit breaker. Each timeout (15 s, `provider-fetch.ts:8`) or bare 5xx becomes `WOZTELL_DELIVERY_UNKNOWN`, which materialise and dedupe treat as permanently "maybe delivered". So one outage can make most of a blast unretryable. | `campaign-delivery.server.ts:306-309,316-322`; `src/lib/woztell/provider-fetch.ts:8,50-56` |
| 17 | **A recipient can stay `sending` forever.** Both recoveries run only when *another* delivery job for that campaign runs: the claim reconciliation (Fact 2) and the attempts-exhausted lease recovery (which handles expired leases only). A job that fails non-retryably after a reservation (for example, a DB error in `updateRecipient` after the provider accepted) leaves that row `sending` with `dispatch_started_at` set. The campaign stays `sending`, and Fact 7's enqueue collapse means no job comes back. Mid-run ownership loss and a thrown dispatch already re-queue the **undispatched** remainder of the batch. | `campaign-delivery.server.ts:370-402`; `jobs.server.ts:354-437` |
| 18 | **What the list and UI show today.** `listAdminCampaigns` returns `sent`, `failed` (failed and **not** UNKNOWN), `unknown` (`error='WOZTELL_DELIVERY_UNKNOWN'`), `cancelled`, `dispatching`, `blocked` and `pending`. `CampaignDeliveryCell` shows 「結果未明（請先核實，勿重發）N」 and 「失敗 N」. Status labels (`:104-113`) are 草稿/待審核/已排期/已排隊/發送中/已完成/失敗/已取消. Row actions are 預覽收件人 / 發送… / 取消 Campaign. Confirmations use `AdminConfirmDialog` (shadcn `AlertDialog`) with `ConfirmRow` `<dl>` rows. Server error codes surface raw through `assertNoServerError`. | `admin-data.server.ts:3191-3224`; `src/routes/admin.blasts.tsx:95-113,974-1087,1228-1340,1854-1882,1955-1981,2079-2090`; `src/components/admin/AdminConfirmDialog.tsx` |
| 19 | **An enum-value migration could not follow the migration rules.** `apply-migrations.mjs` refuses a file that mixes `ALTER TYPE … ADD VALUE` with any other statement (`:113-121`) and runs that one statement outside a transaction (`:123-129`). So a `paused` value could not carry `SET LOCAL lock_timeout` (outside a transaction it is a no-op), nor any CHECK or backfill. Precedent: `20260831090000_staff_viewer_role.sql`. Note for accuracy: Postgres ≥ 12 does allow `ADD VALUE` inside a transaction block, but the new value cannot be *used* until commit, so the repo's one-statement rule still stands. | `scripts/neon/apply-migrations.mjs:113-140`; `neon/migrations/20260831090000_staff_viewer_role.sql:11-15` |
| 20 | **Tests and CI.** `src/lib/neon/campaign-recovery-owned.db.test.mjs` exists (251 lines): one top-level test, one `withOwnedPostgres` container, `fetch` mocked to throw, `job-wake.server.ts` mocked, subtests for queue idempotency, consent gate and cancel. It runs via `test:admin-campaign:db` (`package.json:119`, CI `ci.yml:154`). The browser spec `e2e/admin-campaign-review.spec.ts` runs at widths 1440/1280/768/390 against `scripts/browser-fixtures/campaign-review` (which re-exports `no-link/synthetic-api.ts`, whose campaign ports live in `no-link/synthetic-blasts.ts`) via `test:admin-campaign-review:ui` (`package.json:118`, `ci.yml:81`). The pure campaign tests are in `src/lib/woztell/campaign-dispatch.test.mjs` and `woztell.test.mjs` (`test:woztell`, `ci.yml:103`). The handler tests are in `control-plane.test.mjs:570-608` (`test:control-plane`, `ci.yml:106`). **19 `test:*` scripts on main are not in `ci.yml`**, all `:db`/`e2e` scripts that need Neon or an external DB (`test:admin-properties:db`, `test:mls:db`, `test:control-plane:db`, `test:staff-bootstrap:db`, `test:live-agent:local-db`, `test:youtube-sync:db`, `test:cms:db`, `test:woztell:db`, `test:crm:db`, `test:admin:paging:db`, `test:public-performance:db`, `test:property-sync:db`, `test:property-sync:publication:db`, `test:whatsapp-enquiries:db`, `test:staff-notifications:db`, `test:staff-notifications:e2e`, `test:property-sync:admin:db`, `test:property-sync:withdrawal:db`, `test:property-sync:private-replay:db`). FX-10b adds no script. | as listed; `src/test-wiring.test.mjs` |
| 21 | **FX-08 (#228) overlap is small and avoidable.** FX-08 adds `classifyOutboundSendResult` and `DEFINITE_REJECTION_STATUSES` to `provider-result.ts`, adds `stage:"preflight"` to the two pre-call returns of `sendWoztellResponse` (with the comment "Campaign delivery ignores it and still keys on the missing `status`"), rewrites opt-out detection, and edits `woztell.test.mjs` hunks up to old line ~482. It does **not** touch `campaign-delivery.server.ts`, `admin-data.server.ts:3191-3680`, `admin.blasts.tsx` or the campaign fixtures. | `git diff --stat origin/main...origin/fix/fx-08-optout-unknown` |
| 22 | **Two campaign values look alike but differ.** `WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED` (lease recovery) is set only when `dispatch_started_at IS NULL`, so it is never-sent and retry-safe. A reserved row in the same recovery becomes UNKNOWN. | `jobs.server.ts:393-404` |

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real number. All automated tests mock `boundedProviderFetch` (`src/lib/woztell/provider-fetch.ts`), keep `globalThis.fetch` throwing, and assert at the end that `fetch` was called 0 times.
  - Synthetic data only, on owned Postgres. Contacts get `whatsapp_member_id = 'synthetic-fx10b-<n>'` and names 「FX10b 合成客戶<n>」. Phones use the existing file's pattern (`8526111222<n>`), and are never sent anywhere because the provider is mocked.
  - Test env: `WOZTELL_ENABLED=true`, `WOZTELL_BOT_ACCESS_TOKEN=synthetic-fx10b-token`, `WOZTELL_CHANNEL_ID=synthetic-fx10b-channel`, set inside the test and restored in `finally`. `OPS_EVENT_WAKE_ENABLED` is deleted, as in the FX-06 header.
  - **No production calls.** Production admin is read-only unless the owner names a record.
- **Never send twice (the invariants this batch enforces, each with a test).**
  1. A row leaves `failed` for `queued` only through `requeueFailedCampaignRecipients`, and only when `dispatch_started_at IS NULL` and `error` is in `CAMPAIGN_RETRYABLE_FAILURE_CODES`.
  2. A row with `dispatch_started_at` set, `status IN ('sent','sending')` or `error='WOZTELL_DELIVERY_UNKNOWN'` is never re-queued by anything, including materialise.
  3. Any provider answer with acceptance evidence (`providerResult.possibleAccepted`) is `unknown`, whatever the HTTP status.
  4. A paused or re-queued campaign is in `review`, so no delivery job can claim from it until a manager queues it again.
- **No migration.** `src/lib/control-plane/migration-versions.js`, the pinned counts and `neon/` are not touched.
- **Configuration.** No new env var. No `VITE_*`.
- **Copy.** All new UI text is zh-HK and reuses existing strings where they exist (「結果未明（請先核實，勿重發）」, 「待審核」, 「發送…」, 「重新整理」, 「無法收回」). The copy table is in Task 4. No brand or marketing copy changes.
- **UI primitives.** `AdminConfirmDialog` (shadcn `AlertDialog`), `Button`, `Badge`, `Alert`/`AlertDescription` (`src/components/ui/alert.tsx`), and `sonner` `toast`, all from `src/components/ui` or existing admin components.
- **Roles.** Re-queue and retry preview are `requireStaff(["admin","manager"])` in `admin-data.ts`, and the server function re-checks `actor.roles` (defence in depth). Queueing stays `campaign.queue` (manager/admin).
- **Do not touch.**
  - `woztell.server.ts` and `provider-result.ts`. FX-08 rewrites them (Fact 21).
  - `package.json`, `.github/workflows/ci.yml`, `playwright.admin-owned.config.ts` and `scripts/browser-fixtures/build-admin-campaign-review.mjs`. FX-05a/05b edit the build script.
  - `admin.routes.test.mjs` and `admin-data.contract.test.mjs`, which FX-03, FX-04 and FX-05b all edit.
- **Placement (to avoid conflicts with open PRs).** These diffs were taken with `git diff origin/main...origin/fix/<b>`.

  | PR | Branch | Overlap with FX-10b | Rule |
  |---|---|---|---|
  | #221 | `fix/fx-01-public-form-feedback` | none (`package.json:35,121`, `ci.yml:84`, playwright config) | None. FX-10b edits none of those files. |
  | #222 | `fix/fx-03-live-agent-handoff` | appends at the end of `admin-data.server.ts` (`:3813+`), `admin-data.ts` (`:1820+`) and `admin-data.types.ts` (`:639+`) | **Never append at end of file.** The new server function goes between `queueAdminCampaign` and `cancelAdminCampaign` (`admin-data.server.ts:3643`). The wrappers go directly after `cancelAdminCampaign` (`admin-data.ts:1799`). Type fields go inside `AdminCampaignRow` (`admin-data.types.ts:190-212`). |
  | #223 | `fix/fx-04-admin-attention` | `no-link/synthetic-api.ts:75-260` and an insert after `:593`; `admin-data.server.ts:983-1080`; `admin-data.ts:394-450,653-700` | In `no-link/synthetic-api.ts` touch only the `export { … } from "./synthetic-blasts"` block (`:607-616`), appending two names before `} from`. |
  | #224 / #225 | `fix/fx-05a-ui-flags`, `fix/fx-05b-lead-alert` | both edit `build-admin-campaign-review.mjs:23-26`. #225 also edits `job-handlers.server.ts` at the top and at `:491+`, and `admin-data.server.ts:3692,3702` (`createWebsiteInquiry`) | Do not edit the build script. In `job-handlers.server.ts` edit only `:207-270`. In `admin-data.server.ts` do not edit below `:3674`. |
  | #226 | `fix/fx-06-manager-wa-access` | none | None. |
  | #227 | `fix/fx-07-jobs-drain` | `control-plane.test.mjs:11,184-186`; `scripts/no-link-local-postgres.test.mjs:1` | Edit `control-plane.test.mjs` only at `:570-608` and `:686-703`. Do not touch `no-link-local-postgres.test.mjs`. |
  | #228 | `fix/fx-08-optout-unknown` | `woztell.test.mjs` hunks at old `:259-482`; `woztell.server.ts`; `provider-result.ts`; `admin-data.server.ts:99-100,2953-3070` | FX-10b edits `woztell.test.mjs` **only** at `:687-696`, which is outside every FX-08 hunk, so it rebases with an offset only. The classifier keys on `status === undefined` (Fact 21), so FX-08's `stage` field changes nothing. **Rebase recipe if #228 lands first:** `git rebase origin/main`. Expected result: no conflicts. Then run `npm run test:woztell`. If FX-08 renamed the refusal test at `:687`, re-apply Task 1 Step 1(c) to the renamed test. Do **not** switch campaigns to `classifyOutboundSendResult`: it files a refusal as `WOZTELL_REFUSED`, a code that materialise, dedupe and the list do not know. |
  | #229 | `fix/fx-09-lead-integrity` | `admin-data.server.ts:2383-2757`; `admin-data.types.ts:343-373`; `ci.yml`/`package.json` | None in practice. Campaign code sits far from those lines. |
- **Committing.**
  - `git add <paths>` only. Never add `bun.lockb`, which is already dirty in this worktree.
  - Use conventional commits with a scope, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its listed suites. Owned suites need Docker and `docker pull pgvector/pgvector@sha256:d2ef61f4…` (`ci.yml:143`). The PR as a whole also passes:
  - `npm run build`;
  - every `playwright.admin-owned.config.ts` suite;
  - before/after screenshots of `/admin/blasts` at 375 px and 1440 px.

## Review Focus

These are the likeliest failure modes that no fix-plan test covers. Each has a named test.

1. **The realistic auth failure is a 500, not a 401** (Fact 6). A breaker keyed on status alone would let a wrong token mark the whole blast `failed` again. *Tests:* (Task 1) `an ok:0 "User is not authorized." refusal is a systemic stop, but a per-number refusal is not`; (Task 2) `an HTTP 500 ok:0 not-authorized refusal pauses exactly like a 401`.
2. **Re-queue becomes a second path to a double send.** Three ways: materialise resurrects a dispatched row (Fact 10), a 4xx with acceptance evidence is filed as retry-safe (Fact 15), or two clicks race each other. *Tests (Task 3):* `materialize never resurrects a failed or dispatched recipient and adds no new contacts to a campaign with history`; `no recipient gets two accepted sends`. *Test (Task 1):* `a 4xx whose body carries a message id is unknown, never retry-safe`.
3. **A pause leaves work behind.** A row stays `sending`, the campaign stays `sending` (Fact 17), or the cron resumes it without approval (Fact 7). *Test (Task 2):* `401 mid-run pauses and leaves remainder queued` asserts zero `sending` rows, campaign `review`, and that the cron's eligibility predicate does not match it.
4. **The retry skips the approval gate.** A leftover delivery job, an ops-page job retry, or the re-queue itself must send nothing. *Test (Task 3):* `a requeued campaign sends nothing until a manager queues it again`.
5. **Retrying changes what was approved.** A `review` campaign with history must not have its template or audience swapped, and a resume must not add people who were never in the original send. *Tests (Task 3):* `a campaign with delivery history keeps its template and audience`; the materialise test above.

## Out of scope / follow-ups

| Follow-up | Owner | What it must do |
|---|---|---|
| Cross-campaign "skip contacts who got this template in the last X days" (D-04's optional item) | FX-17 | A queue-time exclusion keyed on `template_id` + phone identity across campaigns, with the count shown in the send confirmation. Not needed once retry stays on the same campaign. |
| Resolving 結果未明 campaign recipients (confirm delivered / not delivered) | FX-18 | Mirror FX-08's `outbound-resolution` for campaign rows. Until then they are listed and never retried. |
| Rows stuck `sending` after a non-retryable job failure (Fact 17) | FX-07 follow-up | A terminal-job reconciliation for `woztell.campaign.deliver` (any `failed` job, not only `LEASE_EXPIRED`) that applies the Fact 2 rules. FX-10b only guarantees that its own pause leaves nothing in `sending`. |
| Store the provider `messageId` on `sent` campaign rows | FX-18 | Write `external_message_id` from `providerResult.primaryMessageId`, for support lookups. |
| Use FX-08's `stage:"preflight"` instead of `status === undefined` | after #228 merges | A one-line change in `classifyCampaignSendResult` plus its test. |

---

### Task 1: One campaign send-outcome classifier with a systemic-stop verdict and a provider-outage breaker (pure, no DB)

**Files:**
- **Create `src/lib/woztell/campaign-send-outcome.ts`.** It is pure, with no `server-only` import.
- **Create `src/lib/neon/campaign-retry.ts`.** It is pure, with no `server-only` import, and holds the shared codes and SQL predicates (interfaces below). Task 3 uses the SQL helpers. The codes are needed here.
- **Modify `src/lib/woztell/campaign-delivery.server.ts:253-269`.** Delete `providerFailureCode`. `deliverCampaignRecipient` (`:271-323`) calls `classifyCampaignSendResult` instead, as described in Task 2. In this task, only the mapping changes:
  - `stop` with `WOZTELL_CONFIGURATION_UNAVAILABLE` behaves exactly as today (re-queue, then throw).
  - `failed` and `unknown` behave as today.
  - A new `unknown` case covers possible acceptance.
- **Modify `src/lib/woztell/campaign-dispatch.test.mjs`** (in `test:woztell`). Append the tests below.
- **Modify `src/lib/woztell/woztell.test.mjs:687-696`** only. The fixture `"WOZTELL_112: Channel ID not found"` becomes a per-number refusal `"WOZTELL_131026: Receiver is incapable of receiving this message"`, so the test keeps asserting `[id, "failed", "WOZTELL_PROVIDER_REJECTED"]`. The channel case moves to the new systemic-stop test.

**Interfaces:**
```ts
// src/lib/neon/campaign-retry.ts
/** Failed rows that provably never reached WhatsApp. Order is irrelevant. */
export const CAMPAIGN_RETRYABLE_FAILURE_CODES: readonly ["WOZTELL_PROVIDER_REJECTED", "WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED"];
export const CAMPAIGN_PAUSED_ERROR = "WOZTELL_CAMPAIGN_PAUSED";
export const CAMPAIGN_DELIVERY_UNKNOWN = "WOZTELL_DELIVERY_UNKNOWN";
/** `<r>.status='failed' AND <r>.dispatch_started_at IS NULL AND <r>.error IN (<codes>)`. Alias must match /^[A-Za-z_][A-Za-z0-9_]*$/ or it throws. */
export function retryableFailedRecipientSql(recipientAlias: string): string;
/** EXISTS(any row of <c>.id with dispatch_started_at set, status IN ('sent','sending','failed'), or error UNKNOWN). */
export function campaignHasDeliveryHistorySql(campaignAlias: string): string;

// src/lib/woztell/campaign-send-outcome.ts
export type CampaignStopReason =
  | "WOZTELL_CONFIGURATION_UNAVAILABLE"   // no HTTP status: disabled / missing token or channel / scope mismatch
  | "WOZTELL_AUTH_REJECTED"               // 401, 403, or an ok:0 refusal naming auth or the channel
  | "WOZTELL_PROVIDER_UNSTABLE";          // breaker: N consecutive unknown outcomes
export type CampaignSendOutcome =
  | { kind: "sent" }
  | { kind: "failed"; code: "WOZTELL_PROVIDER_REJECTED" }             // retry-safe
  | { kind: "unknown"; code: "WOZTELL_DELIVERY_UNKNOWN" }              // terminal
  | { kind: "stop"; reason: Exclude<CampaignStopReason, "WOZTELL_PROVIDER_UNSTABLE">; providerStatus: number | null };
export const CAMPAIGN_UNKNOWN_STREAK_LIMIT = 3;
/** Matches the reason text of a systemic refusal. Case-insensitive. */
export const SYSTEMIC_REFUSAL_PATTERN: RegExp; // /not authori[sz]ed|access ?token|channel id not found|WOZTELL_112\b/i
export function classifyCampaignSendResult(result: {
  ok: boolean;
  status?: number;
  refused?: boolean;
  error?: string;
  providerResult?: { possibleAccepted?: boolean };
}): CampaignSendOutcome;
// First match wins:
// 1. result.ok                                         -> sent
// 2. status === undefined                              -> stop CONFIGURATION_UNAVAILABLE (providerStatus null)
// 3. providerResult?.possibleAccepted === true         -> unknown            (Fact 15)
// 4. status 401 or 403                                 -> stop AUTH_REJECTED
// 5. refused === true && SYSTEMIC_REFUSAL_PATTERN.test(error ?? "") -> stop AUTH_REJECTED
// 6. refused === true || status in [400,404,422,429]   -> failed PROVIDER_REJECTED
// 7. otherwise                                         -> unknown
/** Thrown sends (timeout, network) are not classified: the caller treats them as `unknown`. */
export function nextUnknownStreak(previous: number, outcome: CampaignSendOutcome["kind"] | "thrown"): number;
// unknown/thrown -> previous + 1; sent/failed -> 0; stop -> previous.
```

- [ ] **Step 1: write the failing tests.**
  - (a) `campaign-dispatch.test.mjs`, new tests:
    - `classifyCampaignSendResult maps every provider answer to exactly one outcome`. A table:
      - `{ok:true,status:200}` → `sent`;
      - `{ok:false}` (no status) → `stop/WOZTELL_CONFIGURATION_UNAVAILABLE/null`;
      - `{ok:false,refused:true,error:"WOZTELL_CHANNEL_SCOPE_MISMATCH"}` (no status) → `stop/WOZTELL_CONFIGURATION_UNAVAILABLE`;
      - `{ok:false,status:401}` and `{ok:false,status:403}` → `stop/WOZTELL_AUTH_REJECTED`, with `providerStatus` 401 or 403;
      - `{ok:false,status:400}`, `404`, `422` and `429` → `failed/WOZTELL_PROVIDER_REJECTED`;
      - `{ok:false,status:200}`, `408`, `500` and `503` → `unknown`.
    - `an ok:0 "User is not authorized." refusal is a systemic stop, but a per-number refusal is not` (Review Focus 1):
      - `{ok:false,status:500,refused:true,error:"User is not authorized."}` → `stop/WOZTELL_AUTH_REJECTED/500`;
      - `error:"WOZTELL_112: Channel ID not found"` → `stop`;
      - `error:"WOZTELL_131026: Receiver is incapable of receiving this message"` → `failed/WOZTELL_PROVIDER_REJECTED`.
    - `a 4xx whose body carries a message id is unknown, never retry-safe` (Review Focus 2). For each status in `[400,401,403,404,422,429]`: `{ok:false,status,providerResult:{possibleAccepted:true}}` → `unknown`.
    - `the unknown streak counts consecutive unconfirmed results only`. The sequence `unknown, thrown, sent, unknown, unknown, thrown` gives streaks `1,2,0,1,2,3`. `failed` resets to 0. `stop` keeps the value.
    - `retry predicates name only never-dispatched definite refusals`:
      - `retryableFailedRecipientSql("r")` contains `r.status = 'failed'`, `r.dispatch_started_at IS NULL`, `'WOZTELL_PROVIDER_REJECTED'` and `'WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED'`, and does **not** contain `WOZTELL_DELIVERY_UNKNOWN`;
      - `retryableFailedRecipientSql("r; drop")` throws;
      - `campaignHasDeliveryHistorySql("c")` contains `dispatch_started_at IS NOT NULL` and `WOZTELL_DELIVERY_UNKNOWN`.
  - (b) A run-level test in `campaign-dispatch.test.mjs`: `a 4xx with acceptance evidence is recorded as unknown`. Run `deliverWoztellCampaign` with injected ports, as in the file's existing tests. `sendResponse` returns `{ok:false,status:400,refused:false,providerResult:{possibleAccepted:true}}`. The recorded update is `[id,"failed","WOZTELL_DELIVERY_UNKNOWN"]`.
  - (c) The `woztell.test.mjs:687-696` fixture change described above. The assertion is unchanged.
  - Run `npm run test:woztell`. The new tests fail, because the module and the possible-acceptance branch do not exist yet.
- [ ] **Step 2:** implement until green. `deliverCampaignRecipient` maps `failed` → `updateRecipient(id,"failed",code)`, `unknown` → `updateRecipient(id,"failed","WOZTELL_DELIVERY_UNKNOWN")`, and `stop` with `WOZTELL_CONFIGURATION_UNAVAILABLE` → today's re-queue and throw. `stop/WOZTELL_AUTH_REJECTED` temporarily throws `deliveryError("WOZTELL_AUTH_REJECTED", …)` after `updateRecipient(id,"queued","WOZTELL_AUTH_REJECTED")`. Task 2 replaces that with the pause.
- [ ] **Step 3:** run `npm run test:woztell`, `npm run test:control-plane`, `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(campaigns): classify campaign send results once, and treat any acceptance evidence as unknown

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: Stop the run on auth, configuration or provider outage, and pause the campaign to 待審核 with the remainder queued (owned DB)

**Files:**
- **Modify `src/lib/woztell/campaign-delivery.server.ts`:**
  - `:23-33` (`CampaignDeliveryDependencies`): add `pauseCampaign?: typeof pauseCampaignDelivery`.
  - `:170-196` (`updateCampaignRecipient`): add `'WOZTELL_AUTH_REJECTED'` to both code lists in the SQL (the `dispatch_started_at` reset at `:181` and the `queued` guard at `:186`), so the refused recipient returns to `queued` with no reservation.
  - Add `pauseCampaignDelivery` (below) after `refreshCampaignDeliveryStatus` (`:236`).
  - `:325-417` (`deliverWoztellCampaign`):
    - (1) If `isEnabled()` is false, call `pauseCampaign(campaignId, "WOZTELL_CONFIGURATION_UNAVAILABLE", null)` when a job is present. If it paused, throw `WOZTELL_CAMPAIGN_PAUSED`. Otherwise keep today's throw.
    - (2) Keep `let unknownStreak = 0`, updated with `nextUnknownStreak` after each recipient, counting a thrown send as `"thrown"`.
    - (3) On a `stop` outcome, or when the streak reaches `CAMPAIGN_UNKNOWN_STREAK_LIMIT`: first re-queue `recipients.slice(index + 1)` with `JOB_DELIVERY_INTERRUPTED` (the existing catch path), then `pauseCampaign(campaignId, reason, providerStatus)`, then throw `deliveryError("WOZTELL_CAMPAIGN_PAUSED", …)` with `reason` attached.
    - The `finally` `refreshStatus` stays. It no-ops on a `review` campaign (`:233`).
- **Modify `src/lib/control-plane/job-handlers.server.ts:207-218` only.** `WOZTELL_CAMPAIGN_PAUSED` is **not** retryable: the job fails with that `last_error_code`, visible in 系統運作. `WOZTELL_CONFIGURATION_UNAVAILABLE` stays retryable for the rare case where the pause could not apply (campaign already cancelled).
- **Modify `src/lib/control-plane/control-plane.test.mjs:570-608`.** Add a case to the existing handler test.
- **Modify `src/lib/neon/campaign-recovery-owned.db.test.mjs`.**
  - Directly after `mockOwnedServerDb` (`:16`), add the provider mock (below) and the env setup. Both must come before the first `import("./admin-data.server.ts")` (`:21`), because `admin-data.server.ts:99` imports `woztell.server.ts`, which imports `provider-fetch.ts`.
  - Add helpers `seedCampaign(n, opts)`, `leaseCampaignJob(campaignId)` and `deliver(campaignId, job)`.
  - Add the subtests below, after the existing four.

**Interfaces:**
```ts
// campaign-delivery.server.ts
export async function pauseCampaignDelivery(
  campaignId: string,
  reason: CampaignStopReason,
  providerStatus: number | null,
  job: { jobId: string; workerId: string; attempt: number },
): Promise<{ paused: boolean; remaining: number }>;
// transactionRows([
//   SELECT id FROM whatsapp_campaigns WHERE id=$1::uuid FOR UPDATE,
//   SELECT id FROM ops_jobs WHERE id=$2::uuid FOR UPDATE,
//   WITH owner AS (SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND j.status='running'
//                    AND j.lease_owner=$3 AND j.attempt_count=$4 AND j.lease_expires_at>clock_timestamp()),
//        paused AS (UPDATE whatsapp_campaigns c SET status='review', updated_at=now()
//                   WHERE c.id=$1::uuid AND c.status IN ('queued','sending') AND EXISTS (SELECT 1 FROM owner)
//                   RETURNING c.id),
//        remaining AS (UPDATE whatsapp_campaign_recipients r SET status='queued', error='WOZTELL_CAMPAIGN_PAUSED'
//                      WHERE r.campaign_id IN (SELECT id FROM paused)
//                        AND (r.status='queued'
//                             OR (r.status='sending' AND r.dispatch_started_at IS NULL AND r.claim_job_id=$2::uuid))
//                      RETURNING r.id),
//        audited AS (INSERT INTO audit_logs(action,subject_type,subject_id,metadata)
//                    SELECT 'campaign.paused','campaign',p.id, jsonb_build_object('reason',$5::text,
//                      'providerStatus',$6::int,'jobId',$2::text,'attempt',$4::int,'remaining',(SELECT count(*) FROM remaining))
//                    FROM paused p RETURNING id)
//   SELECT (SELECT count(*) FROM paused)::int AS paused, (SELECT count(*) FROM remaining)::int AS remaining
// ])
// No provider text and no phone are stored in the audit.
```

Provider mock (test header):
```js
const providerCalls = []; // { memberId, outcome }
let provider = () => ({ status: 200, body: { ok: 1, messageId: `wamid.synthetic-fx10b-${providerCalls.length}` } });
mock.module(new URL("../woztell/provider-fetch.ts", import.meta.url).href, {
  exports: {
    boundedProviderFetch: async (_url, init) => {
      const { memberId } = JSON.parse(init.body);
      const out = await provider(memberId);
      providerCalls.push({ memberId, outcome: out instanceof Error ? "thrown" : out.status });
      if (out instanceof Error) throw out;
      return { response: new Response(null, { status: out.status }), text: JSON.stringify(out.body) };
    },
  },
});
// leaseCampaignJob: UPDATE ops_jobs SET status='running', attempt_count=attempt_count+1, lease_owner=$2,
//   lease_expires_at=now()+interval '5 minutes', updated_at=now()
//   WHERE id=(SELECT id FROM ops_jobs WHERE status='queued' AND job_type='woztell.campaign.deliver'
//             AND payload->>'campaignId'=$1 ORDER BY created_at LIMIT 1) RETURNING *
// This is the claimJobs SET list scoped to one campaign, because earlier subtests leave other campaigns' jobs queued.
// deliver: import("../woztell/campaign-delivery.server.ts").deliverWoztellCampaign(id, { job: { jobId, workerId, attempt } }),
//   then failJob/completeJob exactly as runClaimedJobs does (jobs.server.ts:700-741), with the
//   real woztellCampaignDeliveryHandler, so the job row ends in its true state.
```

- [ ] **Step 1: write the failing tests.**
  - `control-plane.test.mjs:570-608`: in `WozTell campaign handler maps timeout to retry and permanent rejection to failure`, add: a `deliverCampaign` that throws `{code:"WOZTELL_CAMPAIGN_PAUSED"}` rejects with `error.code === "WOZTELL_CAMPAIGN_PAUSED" && !isRetryableJobError(error)`.
  - `campaign-recovery-owned.db.test.mjs`, new subtests:
    - **`401 mid-run pauses and leaves remainder queued`** (fix-plan name). Seed 5 opted-in recipients, queue as the manager, lease the job, and set the provider to answer `200 {ok:1,messageId}` for the first two member ids and `401 {ok:0,err:"Unauthorized"}` for the third.
      1. Exactly 3 provider calls.
      2. Recipients: 2 `sent`, 3 `queued` with `error='WOZTELL_CAMPAIGN_PAUSED'` and `dispatch_started_at IS NULL`, and 0 `sending`.
      3. The campaign is `review`.
      4. Exactly one `campaign.paused` audit, with `metadata.reason='WOZTELL_AUTH_REJECTED'`, `providerStatus=401` and `remaining=3`. Its metadata JSON contains none of the seeded phones or member ids.
      5. The job is `failed` with `last_error_code='WOZTELL_CAMPAIGN_PAUSED'`.
      6. The cron eligibility predicate (`api.admin.jobs.send-queue.ts:66-80`, copied verbatim into the test as a SQL string) returns no row for this campaign.
      7. Running `deliver` again on the same (now failed) job's campaign makes 0 provider calls.
    - **`an HTTP 500 ok:0 not-authorized refusal pauses exactly like a 401`** (Review Focus 1). As above, but the third answer is `500 {ok:0,err:"User is not authorized."}`. Same assertions, with `providerStatus=500`.
    - **`missing configuration pauses before any provider call`.** Delete `WOZTELL_BOT_ACCESS_TOKEN` for this subtest. Result: 0 provider calls, campaign `review`, all rows `queued / WOZTELL_CAMPAIGN_PAUSED`, audit reason `WOZTELL_CONFIGURATION_UNAVAILABLE` with `providerStatus` null. Also: with `WOZTELL_ENABLED` unset, the same outcome comes from the `isEnabled` path.
    - **`provider down pauses after three unconfirmed results and keeps the rest queued`** (owner-required provider-down fallback). Seed 6 recipients. The provider throws `Error("WOZTELL_PROVIDER_TIMEOUT")` every time.
      1. Exactly 3 provider calls.
      2. 3 rows `failed / WOZTELL_DELIVERY_UNKNOWN` with `dispatch_started_at` set.
      3. 3 rows `queued / WOZTELL_CAMPAIGN_PAUSED`.
      4. Campaign `review`; audit reason `WOZTELL_PROVIDER_UNSTABLE`.
      5. A second variant interleaves `503`, a throw, `200 accepted`, `503`, `503`, `503`. It pauses only after the last three (provider calls = 6), and the accepted row is `sent`.
    - **`a stale worker cannot pause a campaign it no longer owns`.** Lease the job, expire the lease (`UPDATE ops_jobs SET lease_expires_at=now()-interval '1 second'`), and call `pauseCampaignDelivery` directly. It returns `{paused:false}`, the campaign stays `queued`, and no audit is written.
  - Run `npm run test:admin-campaign:db` and `npm run test:control-plane`. They must fail: there is no pause, and today a 401 marks rows `failed`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:admin-campaign:db`
  - `npm run test:woztell`
  - `npm run test:control-plane`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(campaigns): pause the campaign on auth, configuration or provider outage and keep unsent recipients queued

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: `requeueFailedCampaignRecipients`, retry preview, hardened materialise, and frozen template and audience after delivery (owned DB)

**Files:**
- **Modify `src/lib/neon/admin-data.server.ts`.** All edits sit between `:3191` and `:3674` (placement rules):
  - `:3191-3224` (`listAdminCampaigns`): add `count(r.id) FILTER (WHERE ${retryableFailedRecipientSql("r")})::int AS retryable_failed`, `count(r.id) FILTER (WHERE r.status='queued' AND r.error='WOZTELL_CAMPAIGN_PAUSED')::int AS paused`, and `${campaignHasDeliveryHistorySql("c")} AS delivery_started`. The latter is a scalar subquery, so it needs no GROUP BY change.
  - `:3377-3409` (`saveAdminCampaign`): when `input.id` is set, the UPDATE's WHERE adds `AND (NOT ${campaignHasDeliveryHistorySql("whatsapp_campaigns")} OR (template_id IS NOT DISTINCT FROM $2 AND audience_id IS NOT DISTINCT FROM $3))`. When no row comes back, a follow-up `SELECT` distinguishes history and returns `{ id: "", error: "CAMPAIGN_HAS_DELIVERY_HISTORY" }`. Otherwise the result is the existing `Not found`.
  - `:3411-3480` (`materializeCampaignRecipients`):
    - (a) Read `${campaignHasDeliveryHistorySql("c")} AS has_history` in the existing campaign SELECT (`:3415-3424`).
    - (b) The INSERT adds `WHERE NOT $3::boolean OR EXISTS (SELECT 1 FROM whatsapp_campaign_recipients x WHERE x.campaign_id=$1::uuid AND x.contact_id=contact_ids.contact_id)`, with `$3 = has_history`.
    - (c) Both `ON CONFLICT` CASEs keep the existing row when `status IN ('sent', 'sending', 'failed') OR dispatch_started_at IS NOT NULL OR error = 'WOZTELL_DELIVERY_UNKNOWN'`. Keep `error = 'WOZTELL_DELIVERY_UNKNOWN'` as the **last** condition before `THEN`, so `control-plane.test.mjs:686-703` still matches without edits.
    - (d) The "no longer eligible" UPDATE (`:3466-3475`) adds `AND r.dispatch_started_at IS NULL`.
  - **Insert after `queueAdminCampaign` (`:3642`), before `cancelAdminCampaign` (`:3644`):** `fetchCampaignRetryPreview` and `requeueFailedCampaignRecipients` (below). Import `retryableFailedRecipientSql` and `campaignHasDeliveryHistorySql` next to the existing `phone-identity.ts` import (`:87`).
- **Modify `src/lib/neon/admin-data.ts`:** directly after `cancelAdminCampaign` (`:1799`), add `fetchCampaignRetryPreviewServer` (GET) and `requeueFailedCampaignRecipientsServer` (POST), both `requireStaff(["admin","manager"])`, plus their wrappers using `callStaffServerFn` + `dispatchWorkspaceRequest`, as `cancelAdminCampaign` does.
- **Modify `src/lib/neon/admin-data.types.ts:190-212`** (`AdminCampaignRow`): add `retryable_failed?: number; paused?: number; delivery_started?: boolean;`. Directly after `:212`, add `AdminCampaignRetryPreview` and `AdminCampaignRequeueResult`.
- **Modify `src/lib/neon/campaign-recovery-owned.db.test.mjs`:** add the subtests below.

**Interfaces:**
```ts
export type AdminCampaignRetryPreview = {
  campaignId: string;
  status: string;
  retryable: number;             // exactly what requeue would move now
  excludedOptedOut: number;      // retry-safe failure, but consent or identity now fails
  excludedDuplicatePhone: number;// retry-safe failure, but not the primary row for its phone
  unknownTotal: number;
  unknown: { recipientId: string; name: string | null; dispatchedAt: string | null }[]; // max 100, oldest first
};
export type AdminCampaignRequeueResult =
  | { ok: true; requeued: number; excludedUnknown: number; excludedOther: number }
  | { ok: false; error: "Campaign not found" | "CAMPAIGN_STILL_SENDING" | "CAMPAIGN_NOT_RETRYABLE" | "NOTHING_TO_RETRY" };

// admin-data.server.ts
export async function fetchCampaignRetryPreview(campaignId: string, actor: StaffAccess): Promise<AdminCampaignRetryPreview>;
//   `name` is CASE WHEN contact.name ~ '\d{6,}' THEN NULL ELSE contact.name END.
//   No phone, member id or normalized_phone column is selected.
export async function requeueFailedCampaignRecipients(
  input: { campaignId: string },
  actor: StaffAccess,
): Promise<AdminCampaignRequeueResult>;
// 0. actor.roles must include admin or manager, else throw new Response("Forbidden", { status: 403 }).
// 1. transactionRows([
//    { SELECT id, status FROM whatsapp_campaigns WHERE id=$1::uuid FOR UPDATE },   // the lock; a fresh snapshot follows
//    { WITH c AS (SELECT c.id, c.status FROM whatsapp_campaigns c WHERE c.id=$1::uuid),
//           busy AS (SELECT EXISTS (SELECT 1 FROM whatsapp_campaign_recipients s WHERE s.campaign_id=$1::uuid AND s.status='sending')
//                       OR EXISTS (SELECT 1 FROM ops_jobs j WHERE j.job_type='woztell.campaign.deliver'
//                                  AND j.payload->>'campaignId'=$1::text AND j.status='running'
//                                  AND j.lease_expires_at>clock_timestamp()) AS busy),
//           pick AS (SELECT r.id FROM whatsapp_campaign_recipients r JOIN c ON c.id=r.campaign_id
//                    JOIN crm_contacts contact ON contact.id=r.contact_id, busy
//                    WHERE c.status IN ('failed','completed','review') AND NOT busy.busy
//                      AND ${retryableFailedRecipientSql("r")}
//                      AND contact.opt_in_whatsapp = true AND contact.opted_out_whatsapp = false
//                      AND NULLIF(contact.normalized_phone,'') IS NOT NULL
//                      AND ${marketingIdentitySafeSql("contact")} AND ${campaignRecipientPrimarySql("r","contact")}
//                    FOR UPDATE OF r),
//           requeued AS (UPDATE whatsapp_campaign_recipients r
//                        SET status='queued', error=NULL, queued_at=NULL, claim_job_id=NULL, claim_worker_id=NULL,
//                            claim_attempt=NULL, dispatch_job_id=NULL, dispatch_worker_id=NULL, dispatch_attempt=NULL
//                        FROM pick WHERE r.id=pick.id AND ${retryableFailedRecipientSql("r")} RETURNING r.id),
//           flipped AS (UPDATE whatsapp_campaigns w SET status='review', updated_at=now()
//                       FROM c WHERE w.id=c.id AND EXISTS (SELECT 1 FROM requeued) RETURNING w.id, c.status AS previous_status),
//           excluded AS (SELECT count(*) FILTER (WHERE x.error='WOZTELL_DELIVERY_UNKNOWN')::int AS unknown,
//                               count(*) FILTER (WHERE x.status='failed' AND x.error IS DISTINCT FROM 'WOZTELL_DELIVERY_UNKNOWN')::int AS other
//                        FROM whatsapp_campaign_recipients x WHERE x.campaign_id=$1::uuid AND x.id NOT IN (SELECT id FROM requeued)),
//           audited AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
//                       SELECT $2::uuid,'campaign.requeue_failed','campaign',f.id, jsonb_build_object(
//                         'requeued',(SELECT count(*) FROM requeued),'previousStatus',f.previous_status,
//                         'excludedUnknown',e.unknown,'excludedOther',e.other)
//                       FROM flipped f CROSS JOIN excluded e RETURNING id)
//      SELECT c.status, busy.busy, (SELECT count(*) FROM requeued)::int AS requeued, e.unknown, e.other
//      FROM c, busy, excluded e }
//   ])
// Mapping: no campaign row -> "Campaign not found"; busy -> CAMPAIGN_STILL_SENDING;
//          status not in (failed, completed, review) -> CAMPAIGN_NOT_RETRYABLE; requeued = 0 -> NOTHING_TO_RETRY
//          (no write, no audit); else { ok: true, … }.
// It never enqueues a job and never calls wakeAfterCommit. Sending is the existing 「發送…」 → queueAdminCampaign.
```

- [ ] **Step 1: write the failing tests** (`campaign-recovery-owned.db.test.mjs`, with Task 2's helpers).
  - **`requeue sends only failed`** (fix-plan name). Seed one campaign with recipients A–F, queue it, lease the job and deliver. The provider answers:
    - A: `200 accepted`;
    - B: `500 {ok:0,err:"WOZTELL_131026: Receiver is incapable of receiving this message"}`, which becomes `failed / WOZTELL_PROVIDER_REJECTED`;
    - C: `503`, which becomes UNKNOWN;
    - D: `400 {ok:0}`, after which the test sets D's contact `opted_out_whatsapp=true`;
    - E: `200 accepted`.

    Then seed F directly as `failed / WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED`, `dispatch_started_at NULL`, and G as `failed / WOZTELL_RECIPIENT_MISSING` with `dispatch_started_at` set. The campaign ends `completed`.
    1. `fetchCampaignRetryPreview` gives `retryable=2` (B, F), `excludedOptedOut=1` (D), `unknownTotal=1`, and `unknown[0].name='FX10b 合成客戶C'`.
    2. `requeueFailedCampaignRecipients` returns `{ok:true, requeued:2, excludedUnknown:1, excludedOther:2}` (D and G).
    3. B and F are `queued` with `error NULL`. A and E stay `sent`, C stays UNKNOWN, D and G stay `failed`.
    4. The campaign is `review`. One `campaign.requeue_failed` audit row, with `actor_id=manager`.
    5. `queueAdminCampaign(manager)` → ok. Lease the new job and deliver with an all-accept provider. The provider calls in this second run are exactly the member ids of B and F.
  - **`no recipient gets two accepted sends`** (fix-plan name; Review Focus 2). Continuing from the end state above, or with a fresh seed:
    - `Promise.all([requeue, requeue])` on a fresh failed campaign: exactly one result is `{ok:true}`, the other is `{ok:false,error:"NOTHING_TO_RETRY"}`, and there is exactly one audit row.
    - `Promise.all([queueAdminCampaign, queueAdminCampaign])`: exactly one job.
    - Deliver; then run the **old** first-run job again through `retryJob` + lease + deliver: 0 provider calls.
    - Calling requeue again on the completed campaign → `NOTHING_TO_RETRY`.
    - **Dedupe:** contacts X (`85261112220`) and X′ (`61112220`, the 8-digit form of the same phone) are both recipients. X is `sent` and X′ is `failed / WOZTELL_PROVIDER_REJECTED`. Requeue excludes X′ (`excludedDuplicatePhone=1` in the preview), and no provider call is made for X′.
    - **Global assertion over every provider call in the file:** per member id, the number of calls whose answer was an acceptance is ≤ 1.
  - **`unknown recipients are excluded and listed`** (fix-plan name):
    - The preview's `unknown` contains C with `name` and `dispatchedAt`.
    - `JSON.stringify(preview)` matches none of the seeded phones, `/\d{8,}/` or `synthetic-fx10b-`.
    - A contact whose name is `85261112229` gets `name: null`.
    - Requeue never changes C's row (deep-equal before and after).
  - **`a requeued campaign sends nothing until a manager queues it again`** (approval gate; Review Focus 4):
    - After requeue: `SELECT count(*) FROM ops_jobs WHERE payload->>'campaignId'=$1` is unchanged, `reviewed_at` is unchanged, and no `wakes` were added.
    - Re-queue the pre-existing failed job with `retryJob(jobId)` (the ops-page retry, which managers hold via `system.jobs.retry`), lease it and deliver: 0 provider calls, and B and F are still `queued`.
    - `requeueFailedCampaignRecipients({campaignId}, agentActor)` rejects with a `Response` of status 403.
    - Then `queueAdminCampaign(manager)` creates a job whose `idempotency_key` differs from the first run's, and the `campaign.queue` audit count is 2.
    - Also: with the template set `inactive`, `queueAdminCampaign` → `TEMPLATE_NOT_ACTIVE`, and no job is created.
  - **`materialize never resurrects a failed or dispatched recipient and adds no new contacts to a campaign with history`** (Review Focus 2 and 5):
    - On the paused campaign from Task 2's 401 test, add a new contact H that matches the audience filters, and call `sendAdminCampaignQueue(id, manager)`.
    - H gets no recipient row. The 2 `sent` rows are unchanged. G-style rows (failed with dispatch set) stay `failed`. The 3 paused rows become `queued` with `error NULL`.
    - The materialise path has no `blocked` UPDATE on any row with `dispatch_started_at` set.
    - **Contrast:** on a brand-new campaign with no history, H *is* added. Today's behaviour is kept.
  - **`a campaign with delivery history keeps its template and audience`** (Review Focus 5):
    - `saveAdminCampaign({id, …, template_id: other})` on the paused campaign → `{id:"", error:"CAMPAIGN_HAS_DELIVERY_HISTORY"}`, and the row is unchanged.
    - The same save changing only `name` succeeds.
    - On a never-sent `review` campaign, a template change still succeeds.
  - **`requeue refuses while a delivery is in flight`.** With a row in `sending` → `CAMPAIGN_STILL_SENDING`. With a running job holding a live lease → `CAMPAIGN_STILL_SENDING`. On a `queued` campaign → `CAMPAIGN_NOT_RETRYABLE`. Nothing is written in any case.
  - Run `npm run test:admin-campaign:db`. It must fail: the functions do not exist, and materialise resurrects rows.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:admin-campaign:db`
  - `npm run test:control-plane` (the materialise regex is unchanged)
  - `npm run test:woztell` (`admin.routes.test.mjs` pins `materializeCampaignRecipients…validateAdminCampaignQueueability…fetchAudienceRecipientRows`, which is kept)
  - `npm run test:no-link:local-postgres` (`scripts/no-link-local-postgres.test.mjs:1824-1910` materialises)
  - `npm run test:command-center` (`admin-data.contract.test.mjs`)
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(campaigns): re-queue only definitely refused recipients on the same campaign, behind the existing approval

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: `/admin/blasts`: 已暫停 marker, 「重新發送失敗收件人（N）」 with an exact-count confirmation, and the excluded 結果未明 list (UI + e2e)

**Files:**
- **Modify `src/routes/admin.blasts.tsx`:**
  - imports (`:53-62`): add `fetchCampaignRetryPreview` and `requeueFailedCampaignRecipients`; add `RotateCcw` to the `lucide-react` import (`:12`); and import `Alert`/`AlertDescription` from `@/components/ui/alert`.
  - Directly after `campaignStatusLabels` (`:113`), add `campaignRetryErrorLabels` (copy table).
  - State (`:177-179`): add `pendingRetry: AdminCampaignRow | null`, `retryPreview: AdminCampaignRetryPreview | null` and `retryPreviewError: string | null`.
  - Directly after `handleConfirmCancel` (`:778`), add `openRetry(campaign)` (it reads the preview, re-reading each time it opens) and `handleConfirmRetry()`. The latter calls `requeueFailedCampaignRecipients`, then `refreshAdminData({ clearRowPreviews: true })`, and toasts. **There is no session journal:** re-queue sends nothing and is idempotent, so a lost response is resolved by re-reading the list. That difference is deliberate and noted in a code comment.
  - Row actions (`:1040-1083`): after 取消 Campaign, render 「重新發送失敗收件人（{retryable_failed}）」 (outline, `RotateCcw`) **only** when `retryable_failed > 0` and the status is `failed`, `completed` or `review`. Disable it while `mutatingAction`, `queueNeedsReadback` or `cancelNeedsReadback` is set.
  - `CampaignStatusBadge` (`:1970-1981`): take `paused?: number`. When the status is `review` and `paused > 0`, render the `destructive` badge 「已暫停」.
  - `CampaignDeliveryCell` (`:1857-1882`): when `paused > 0`, add the line 「已暫停，未發送 {paused}」.
  - New `AdminConfirmDialog` after the cancel dialog (`:1340`), using `ConfirmRow`. It lists the 結果未明 recipients by name only (copy table). `confirmLabel` is `重新排入 {retryable} 人`. It is disabled while the preview is loading, has failed, or `retryable === 0`.
  - Send confirmation (`:1228-1274`): when `campaign.delivery_started`, add a `ConfirmRow` 「已發送（不會重發）」 = `sent`, and an `Alert` 「此 Campaign 曾經發送。這次只會發送給尚待發送的收件人，不會加入新符合條件的客戶。」 (Open question 4).
- **Modify `scripts/browser-fixtures/no-link/synthetic-blasts.ts`:**
  - state (`:7-16`): add `retryMode: "ok" as "ok" | "refused" | "previewFailure"`.
  - `records()` (`:27-54`): add `retryable_failed: 0, paused: 0, delivery_started: false, requeueWrites: 0`.
  - At the end of the file, add `fetchCampaignRetryPreview` and `requeueFailedCampaignRecipients`. They log `call("syntheticCampaignRetryPreview"|"syntheticCampaignRequeue")`, require a manager, return the unknown list `[{recipientId:"…", name:"合成未明客戶", dispatchedAt:…}]`, and on requeue move `retryable_failed` into `pending`, set the status to `review` and increment `requeueWrites`.
- **Modify `scripts/browser-fixtures/no-link/synthetic-api.ts:607-616`:** append the two names to the `synthetic-blasts` re-export.
- **Modify `e2e/admin-campaign-review.spec.ts`:** add the tests below inside the existing per-width `describe` (`:155+`), seeding rows through `page.addInitScript(() => sessionStorage.setItem("no-link-fixture-campaigns", …))` before `open(page)`.

**Copy (zh-HK):**

| Where | Text |
|---|---|
| Row button | 重新發送失敗收件人（{n}） |
| Dialog title | 重新發送失敗收件人？ |
| Dialog description | 只會重新排入確定未送出的收件人。Campaign 會回到「待審核」，要再按「發送…」確認後才會發出。 |
| ConfirmRow | 將重新排入：{retryable} 人 / 已拒收或身份未核實（不會重發）：{excludedOptedOut} 人 / 同一電話已有記錄（不會重發）：{excludedDuplicatePhone} 人 / 結果未明（請先核實，勿重發）：{unknownTotal} 人 |
| Unknown list heading | 以下收件人結果未明，不會重新發送： |
| Unknown list item | {name ?? "（未有名稱）"}・開始傳送 {formatDate(dispatchedAt)} |
| More than 100 | 另有 {unknownTotal − 100} 人未列出 |
| Confirm button | 重新排入 {retryable} 人 |
| Success toast | 已重新排入 {requeued} 人。請預覽收件人後按「發送…」確認發送。 |
| Badge | 已暫停 |
| Delivery cell | 已暫停，未發送 {paused} |
| Send-dialog alert | 此 Campaign 曾經發送。這次只會發送給尚待發送的收件人，不會加入新符合條件的客戶。 |
| `NOTHING_TO_RETRY` | 沒有可重新發送的失敗收件人，請重新整理。 |
| `CAMPAIGN_STILL_SENDING` | Campaign 仍在發送中，請待發送完成或暫停後再試。 |
| `CAMPAIGN_NOT_RETRYABLE` | 此 Campaign 目前的狀態不可重新發送。 |
| `CAMPAIGN_HAS_DELIVERY_HISTORY` | 此 Campaign 已開始發送，不可更改範本或收件群組；如需不同內容，請建立新 Campaign。 |
| Preview failure | 未能讀取重新發送資料，請稍後再試。 |

- [ ] **Step 1: write the failing tests** (`e2e/admin-campaign-review.spec.ts`, all four widths).
  - `retry shows the exact count, lists unknown recipients by name only, and re-queues once`:
    1. Seed a `failed` row with `sent:3, failed:2, retryable_failed:2, unknown:1`.
    2. The row button text is `重新發送失敗收件人（2）`. Click it.
    3. The dialog `重新發送失敗收件人？` shows `將重新排入：2 人`, `結果未明（請先核實，勿重發）：1 人` and `合成未明客戶`. `dialog.textContent()` matches no `/\d{8,}/`.
    4. Confirm. Then `syntheticCampaignRequeue` calls = 1, `requeueWrites` = 1, the badge reads `待審核`, and the toast contains `請預覽收件人後按「發送…」確認發送`.
    5. **No `syntheticCampaignQueue` call was made** (approval gate in the UI).
    6. Clicking confirm twice quickly still produces 1 call.
  - `paused campaign shows 已暫停 and needs 發送… again`: seed `status:"review", paused:3, sent:2, delivery_started:true`.
    - The badge is `已暫停` and the cell has `已暫停，未發送 3`.
    - The `confirm(page)` helper opens the send dialog. It shows `已發送（不會重發）` and the alert text.
    - No row button `重新發送失敗收件人` is shown when `retryable_failed` is 0.
  - `retry preview failure blocks confirmation and sends no requeue`: with `retryMode:"previewFailure"`, the dialog shows 「未能讀取重新發送資料，請稍後再試。」, the confirm button is disabled, and there are 0 requeue calls.
  - The existing `afterEach` overflow check covers 390 px and 768 px.
  - Run `npm run test:admin-campaign-review:ui`. It must fail.
- [ ] **Step 2:** implement until green. Take before and after screenshots of `/admin/blasts` at 375 px and 1440 px with a paused row and the retry dialog open (`.audit/fx-10b/`).
- [ ] **Step 3:** run:
  - `npm run test:admin-campaign-review:ui`
  - every `playwright.admin-owned.config.ts` suite
  - `npm run test:woztell` (`admin.routes.test.mjs` blast assertions)
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- [ ] **Step 4: commit.**
  ```
  feat(blasts): show paused campaigns and re-send definitely failed recipients after a counted confirmation

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Owner actions before production

**Order:** owner approves this plan → staging (Vercel preview) sandbox check → merge → canary. **No migration, so there is no Neon branch or production SQL step.** Nothing is sent to any real customer number at any point.

1. **Read-only production snapshot, before deploy.** It changes nothing. It shows how many campaigns this unblocks and whether anything is stuck today (Facts 7 and 17):
   ```sql
   BEGIN READ ONLY;
   SELECT c.id, c.name, c.status, c.updated_at,
          count(*) FILTER (WHERE r.status='sent') AS sent,
          count(*) FILTER (WHERE r.status='failed' AND r.dispatch_started_at IS NULL
                           AND r.error IN ('WOZTELL_PROVIDER_REJECTED','WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED')) AS retry_safe,
          count(*) FILTER (WHERE r.error='WOZTELL_DELIVERY_UNKNOWN') AS unknown,
          count(*) FILTER (WHERE r.status='sending') AS stuck_sending,
          count(*) FILTER (WHERE r.status='queued') AS queued
   FROM whatsapp_campaigns c JOIN whatsapp_campaign_recipients r ON r.campaign_id=c.id
   GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 50;
   ROLLBACK;
   ```
   Any campaign with status `sending` and `stuck_sending > 0` or `queued > 0` but no live job is a Fact 7/17 case. The owner decides on those (Open question 8). FX-10b does not auto-repair them.
2. **Staging sandbox check** (Vercel preview, WozTell **sandbox channel**, an audience containing **only the owner's two test numbers**):
   1. Set a deliberately wrong `WOZTELL_BOT_ACCESS_TOKEN` on the preview. Queue the 2-recipient campaign. Expect 1 provider attempt, the campaign 已暫停, 2 待發送 (0 sent), and a `campaign.paused` audit with reason `WOZTELL_AUTH_REJECTED`. Note what status WozTell actually returned (401 or 500 ok:0); this confirms Open question 2.
   2. Restore the token. Press 預覽收件人 → 發送… → confirm. Both test phones receive **exactly one** message.
   3. Make one test number refuse (for example, a number without WhatsApp in the sandbox audience), so that it ends `failed`. Press 重新發送失敗收件人（1）: the dialog says 1. Confirm, then 發送…. The phone that already received the message gets **nothing new**.
   4. Press 重新發送失敗收件人 again: the button is gone, or the dialog says 「沒有可重新發送…」.
3. **Merge**, then deploy.
4. **Canary (read-only, first 48 h):**
   - `/admin/blasts` loads for a manager. Agents still see no campaign rows.
   - In Vercel logs and 系統運作, `woztell.campaign.deliver` jobs failing with `WOZTELL_CAMPAIGN_PAUSED` appear only when there is a real auth, configuration or outage event.
   - **Double-send check.** This must return 0 rows:
     ```sql
     SELECT r.campaign_id, coalesce(nullif(k.whatsapp_member_id,''), k.normalized_phone) AS identity, count(*)
     FROM whatsapp_campaign_recipients r JOIN crm_contacts k ON k.id=r.contact_id
     WHERE r.status='sent' AND r.sent_at > '<deploy>'::timestamptz
     GROUP BY 1,2 HAVING count(*) > 1;
     ```
   - `audit_logs` has `campaign.requeue_failed` rows only with an `actor_id` of a manager or admin.
   - Then update the Status column in the audit doc and `CHANGELOG.md`.

**Rollback:** revert the PR. There is no data migration. Campaigns paused to `review` stay in `review` with their remainder `queued` and remain sendable through the old 發送… flow. Re-queued rows are plain `queued` rows.

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **Pause as 待審核 + 「已暫停」 marker (no migration), or a new `paused` campaign status (enum migration)?** **Default: no migration.** The existing `review` state already blocks every send path and forces re-approval through the existing queue step. A `paused` enum value would have to ship as a lone `ALTER TYPE … ADD VALUE` outside a transaction (Fact 19), and would touch every status switch, the cron and the list. If the owner prefers the enum, the migration is `neon/migrations/20261010100000_campaign_paused_status.sql` containing exactly `ALTER TYPE whatsapp_campaign_status ADD VALUE IF NOT EXISTS 'paused' AFTER 'sending';` (one statement, re-runnable, no `SET LOCAL`, which the runner forbids alongside it). It must be applied before the code that uses it.
2. **What counts as "stop the whole campaign"?** **Default:**
   - HTTP 401 or 403;
   - an `ok:0` refusal whose reason matches `not authorized`, `access token`, `channel id not found` or `err_code 112`;
   - missing configuration or WhatsApp switched off;
   - 3 unconfirmed results in a row.

   Everything else is per recipient. The staging step (Owner action 2.1) confirms WozTell's real answer for a bad token.
3. **Breaker threshold for unconfirmed results (timeouts, bare 5xx).** **Default: 3 in a row.** Lower pauses on a single blip. Higher makes more customers permanently 結果未明.
4. **When a paused or retried campaign is sent again, include contacts who newly match the audience?** **Default: no.** Only the original recipients are sent to. A re-send should not reach people the manager never approved. Contacts who no longer match, or who opted out, are still blocked.
5. **HTTP 429 (rate limited): per-recipient failure or stop?** **Default: per recipient, as today** (`failed`, retry-safe, so the new button can re-send it). Making 429 a stop would also pause on a short burst limit.
6. **Who may re-send failed recipients?** **Default: managers and admins**, the same people who can queue a campaign. Agents and viewers never.
7. **Age limit on re-sending.** **Default: none.** The confirmation shows the original send date and the template must still be active. A stale campaign is the manager's call.
8. **Campaigns already stranded in `sending` in production** (Facts 7 and 17; Owner action 1). **Default: no automatic repair in FX-10b.** For each one, the owner either cancels it (the remainder becomes 已取消) or names it for a one-off, audited reconciliation in the FX-07 follow-up.
9. **結果未明 campaign recipients.** **Default: list them by name only and never re-send them in this batch.** Marking them confirmed or not delivered is FX-18.

## Findings that differ from the approved fix plan

1. **No `paused` status exists, and FX-10b does not add one.** The fix plan says to leave "the campaign `paused`". The enum has no `paused` value (Fact 9), and an enum value cannot ship under the migration rules (Fact 19). FX-10b pauses to `review` with a `WOZTELL_CAMPAIGN_PAUSED` marker on the remaining rows and shows 「已暫停」.
2. **`admin-workflow.ts:120-137` has no transitions to add.** It is a queue precondition plus a delivery-status classifier (Fact 9). "`paused` → `review`" is the pause itself, and "`failed` → `review`" happens only inside `requeueFailedCampaignRecipients`, when something was actually re-queued. It is not a general transition anyone can call.
3. **WozTell reports a bad token as HTTP 500 `ok:0` "User is not authorized.", not 401/403** (Fact 6). The stop rule therefore also matches the refusal reason, and the per-number refusal test fixture at `woztell.test.mjs:687-696` changes from "Channel ID not found" (systemic) to a per-number reason.
4. **Configuration errors do not fail the campaign today. They strand it in `sending` forever** (Fact 7). The same happens to rows left `sending` by a non-retryable job failure (Fact 17). FX-10b fixes the configuration path. The stray-`sending` reconciliation is a named FX-07 follow-up.
5. **The recipient states are not `accepted`/`unknown`.** They are `sent` and `failed` with error `WOZTELL_DELIVERY_UNKNOWN` (Fact 1). "Failed" for retry purposes is defined narrowly: `status='failed'`, `dispatch_started_at IS NULL`, and `error IN ('WOZTELL_PROVIDER_REJECTED','WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED')`.
6. **A hidden retry path already exists and must be hardened first.** `materializeCampaignRecipients` re-queues `failed` rows, including ones with a dispatch reservation, and adds new audience members (Fact 10). Without the Task 3 change, the existing 「發送…」 on a re-opened campaign would bypass the narrow definition and could strand or widen the send.
7. **A 4xx carrying acceptance evidence is filed as retry-safe** (Fact 15). FX-10b reclassifies it as unknown before any retry path exists.
8. **A provider outage needs a breaker,** which the fix plan does not mention (Fact 16). Without one, a single outage makes most of a blast permanently 結果未明 and unretryable.
9. **A `review` campaign with delivery history must not change template or audience** (Review Focus 5). The fix plan reopens campaigns to `review` without saying so.
10. **No new test scripts.** The fix-plan tests extend the named owned-DB file. The pure tests go into files that `test:woztell` and `test:control-plane` already run, so `package.json` and `ci.yml` stay untouched. Separately, 19 existing `test:*` scripts on main are not in `ci.yml` (Fact 20), which contradicts the "every `test:*` script runs in CI" premise. FX-10b neither adds to nor fixes that.
11. **The fix plan's verify step "a 2-recipient sandbox campaign to your test numbers only"** becomes Owner action 2, which adds a deliberate bad-token run, a single-refusal retry, and a check that the already-reached phone gets nothing new.
