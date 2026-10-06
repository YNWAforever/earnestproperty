# FX-05b: A staff alert for every new lead. Implementation plan

**Owner decisions (2026-10-06):**
- **Migration:** approved as drafted. Reuse `staff_notification_attempts` with a nullable `notification_id`, a new `lead_id`, a CHECK and a partial index. In this batch it is applied only to owned or PGlite test databases.
- **`EP_WA_STAFF_ALERT_TEMPLATE`:** approved as the one new server-only variable.
- **Job runner:** the owner does not know whether `OPS_EVENT_WAKE_ENABLED` is on. Build FX-05b anyway. The PR must state that alerts fire only once the job runner works (FX-07). Until the owner sets `EP_WA_STAFF_ALERT_TEMPLATE`, lead alerts send nothing; they end as 「模板未設定」. Pre-flight 2(a) covers the existing enquiry-notification path once the second switch is removed.
- **Sources:** this batch covers the contact form and property enquiry. Valuation and listing-alert are added in FX-02, live agent in FX-05c after PR #222, and WhatsApp inbound in FX-09.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every behaviour change gets a failing test first.

**Goal.** Every new lead from a source that exists on `main` produces exactly one staff WhatsApp alert, sent as the owner-approved template, to the assigned agent or else the duty manager(s). When nothing can be delivered, the reason is visible in the existing staff-notification health. It is never silent (C-02, R-20, D-11; root cause of L-01). The in-admin badges (D3 option C) shipped in FX-04 and are not touched.

**Approach.**
- **Enqueue in the insert statement.** The lead-insert CTE also inserts one `ops_jobs` row: `job_type='lead.staff.alert'`, `idempotency_key='lead-alert:'||lead.id`. A shared SQL fragment builds it. Backfill and import code never imports that fragment, and a contract test pins this.
- **One handler.** `lead.staff.alert@1` freezes its destinations on its first run. It reserves each send with the existing `staff_notification_attempts` queued → dispatching → accepted / unknown pattern, so a retry after a lease expiry can never send twice. The D-11 guard runs in SQL inside the claim.
- **Reuse the staff evidence.** Lead alerts write `staff_notification_attempts` rows keyed by a new `lead_id`. Health counts, receipts, `last_inbound_at` correlation and the staff-reply isolation in `staff-event-isolation.server.ts` then cover them without new code paths.
- **One switch, one template setting.** `EP_WA_STAFF_NOTIFICATIONS_ENABLED` remains the only switch. One new server-only variable, `EP_WA_STAFF_ALERT_TEMPLATE`, holds the template. Net change: −2 switches, +1 setting.

**Tech stack.** TanStack Start, raw SQL through `queryRows` / `transactionRows`, and `node --test --experimental-test-module-mocks`. DB tests run on full-schema owned Postgres: `withOwnedPostgres` applies every `MIGRATION_VERSIONS` entry (`scripts/acceptance/owned-postgres-test.mjs:44-131`), wired through `mockOwnedServerDb` (`:144-165`). UI tests use `bun test` with `renderToStaticMarkup`.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`, on branch `fix/fx-01-public-form-feedback`:
  - C-02 (:187)
  - R-20 (:503)
  - D-11 (:227)
  - L-01 (:147)
  - C-01 (:186), for context
- Fix plan `docs/audits/2026-10-fix-plan.md`, same branch:
  - FX-05b (:315-345)
  - D3 (:71)
  - Review focus 2 (:44)
  - Migration register (:792)

## Verified current behaviour (main 4965d48 + FX-05a 86024b3)

| # | Fact | Where |
|---|---|---|
| 1 | Only **one** public lead path writes `crm_leads`: `persistWebsiteInquiry`, with the `new_lead` CTE. Two callers use it: the contact form and the property enquiry, both through `createWebsiteInquiry`. | `src/lib/neon/website-inquiry.js:128-135`; `admin-data.server.ts:3675-3700`; `routes/contact.tsx:120`; `routes/property.$listingNo.tsx:440` |
| 2 | The valuation and listing-alert forms write only their own tables. **No lead is created** (C-01, still open; FX-02 is not on any branch). | `valuation-leads.js:45-66`; `listing-alerts.js:31-55`; `admin-data.server.ts:3741-3790` |
| 3 | The other lead writers are:<br>• the live agent (`inserted_lead`, stage `contacted`);<br>• the WhatsApp inbound trigger, plus its one-off history reconcile;<br>• the staff manual forward (`wa_…forward`, source `manual_forward`).<br>None enqueues anything. | `live-agent.server.ts:259-266`; `20260906100000_whatsapp_inbound_leads.sql:6-31`; `20260929107000_whatsapp_forwarded_enquiries.sql:70-72` |
| 4 | The SQL enqueue pattern is `INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) … ON CONFLICT (idempotency_key) DO NOTHING`. The wake is `wakeAfterCommit(laneForJob(type))`, called after commit. | `jobs.server.ts:53-91`; `staff-notifications.server.ts:246`; `job-wake.server.ts:6-47` |
| 5 | **The wake is off unless `OPS_EVENT_WAKE_ENABLED=true`, and no cron exists.** A queued job may never run (C-03, FX-07). | `job-wake.server.ts:8`; `workers/cron/wrangler.jsonc:10` |
| 6 | Staff destinations live in `staff_notification_endpoints`, written only by `saveStaffEndpoint`. The member id is **free-typed**. Saving needs an eligible, verified `whatsapp_staff_channels` mapping and admin or manager. Saving also nulls `template_*`; nothing ever sets them. | `staff-endpoints.server.ts:57-127` (`:87`, `:111`) |
| 7 | `staff_notification_attempts.notification_id` is `NOT NULL REFERENCES staff_notification_intents`. Intents require an inquiry, a conversation and an enquiry event, so a website lead **cannot** use them as they stand. | `20260912170000_staff_notifications.sql:29-70,104-134` |
| 8 | There are three switches:<br>• `enabled = NOTIFICATIONS_ENABLED && EP_WA_ENQUIRY_MODE==='active'`;<br>• `staffWhatsAppEnabled`, read by dispatch (`:128,215`), the transport (`staff-whatsapp-transport.server.ts:22`) and readiness (`whatsapp-readiness-policy.ts:128`; `whatsapp-readiness.server.ts:44,165`; `service-health.server.ts:43`);<br>• `ackEscalationEnabled`, which **is read nowhere**. `checkStaffAcknowledgement` is a stub, and no producer enqueues `…staff.ack.check`. | `staff-notifications.server.ts:17-27,326-334`; `job-handlers.server.ts:463-490` |
| 9 | Production already runs `EP_WA_STAFF_NOTIFICATIONS_ENABLED=true`, with WhatsApp alerts and ack escalation `false`. Live readiness shows 「同事手機通知就緒：0/4」. | `docs/implementation/whatsapp-enquiries/staff-handoff/SETTINGS_REPAIR_20260912.md:149`; audit :71 |
| 10 | **R-20, in three places.**<br>• The transport throws `STAFF_TEMPLATE_CONTRACT_UNVERIFIED` for any template (`:26`).<br>• Dispatch suppresses outside the window (`staff-notifications.server.ts:193-199`).<br>• Readiness always adds `outside_message_window`, with `templateContractVerified: false` hard-coded (`whatsapp-readiness-policy.ts:136-152`; `whatsapp-readiness.server.ts:48`). | as cited |
| 11 | **The 24 h window never opens by itself.** `last_inbound_at` changes only for an inbound event correlated to an earlier attempt (`staff-event-isolation.server.ts:130-141`). The staff **test** notification also requires the window (`whatsapp-test-notification.server.ts:182,421`). Without a template, no staff WhatsApp can ever be sent or tested. | as cited |
| 12 | A staff reply counts as staff, not customer, only when it is correlated to an attempt or comes from a member with a live attempt (`staff-event-isolation.server.ts:32-35,112-116`). | as cited |
| 13 | The existing D-11 guard compares the destination with the **same conversation's** member only (`staff-notifications.server.ts:185,219`). Customer member ids also live in `whatsapp_conversations(channel_id,woztell_member_id)` UNIQUE and in `crm_contacts.whatsapp_member_id` UNIQUE. | `20260623090000_neon_admin_crm_whatsapp.sql:135-143`; `20260626120200_woztell_member_identity.sql:12-14` |
| 14 | The customer template payload is `{type:"TEMPLATE",elementName,languageCode,components}`. Components follow the Meta shape `[{type:"body",parameters:[{type:"text",text}]}]`, read back by `describeTemplateParameters`. | `campaign-delivery.server.ts:294-304`; `outbound-intent.server.ts:313-321`; `woztell/template-preview.ts:46-80` |
| 15 | **No double send** is achieved by:<br>• attempt `queued → dispatching(claim_id, job_id)` in one transaction with a reconcile job;<br>• an expired lease → `unknown`, never resent;<br>• the outcome written `WHERE claim_id=… AND dispatching`. | `staff-notifications.server.ts:208-316,318-325`; same in `whatsapp-test-notification.server.ts:389-477` |
| 16 | Team admin:<br>• `canManage` is admin only (`admin.team.tsx:144`);<br>• the roles section is in `AdminTeamDetailPanel.tsx:126-159`;<br>• mutations go through `createAdminTeamServerBoundary().withRequest` → `requireStaffAccess(["admin"])` (`admin-team.ts:150-160`);<br>• roles change at `staff-lifecycle.server.ts:674-688`, with an audit that is best-effort, **not atomic**. | as cited |
| 17 | `staff_users` has no duty column (`20260623090000…sql:31-46`). No duty concept exists except an unused `dutyStaffIds` in `assignment-policy.ts:7,22`. | as cited |

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real customer number. Tests inject a fake `send` into `createStaffWhatsAppTransport(send)` (`staff-whatsapp-transport.server.ts:6-8`), or mock `provider-fetch.ts`. Nothing talks to WozTell, Neon or a model.
  - No migration, seed or delete runs against production Neon. Migrations run only in owned Postgres or PGlite.
  - No secrets in `VITE_*`, logs or commits. `EP_WA_STAFF_ALERT_TEMPLATE` is server-only and holds no secret.
  - Copy is zh-HK.
  - WhatsApp changes carry tests for idempotency, the wrong-recipient guard, provider-down fallback and approval gates.
- **Configuration.**
  - Remove `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED` and `EP_WA_STAFF_ACK_ESCALATION_ENABLED`.
  - Add exactly one variable, `EP_WA_STAFF_ALERT_TEMPLATE`: JSON `{"name":"…","language":"zh_HK","params":["name","source","link"]}`. **This is a new env var.** It is needed because nothing in the schema or env holds an approved staff template (fact 6). Net effect −1 variable. Unset or invalid means "template not configured", never "send text".
  - Lead alerts are gated by `EP_WA_STAFF_NOTIFICATIONS_ENABLED==='true'` only. They are not gated by `EP_WA_ENQUIRY_MODE` or `EP_WA_ACTIVATION_ID`, which belong to WhatsApp enquiry automation. See Open question 3.
- **Channel scope.** Sends go only when `EP_WA_COMPANY_CHANNEL_ID === WOZTELL_CHANNEL_ID`, matching the existing transport check (`staff-whatsapp-transport.server.ts:23`).
- **No lead-insert path outside the allowlist** may enqueue `lead.staff.alert`. Backfills, imports, migrations and staff manual-forward never do.
- **Avoid conflicts with open PRs.**

  | PR | Branch | Overlap with FX-05b | Rule |
  |---|---|---|---|
  | #221 | `fix/fx-01-public-form-feedback` | Forms move into components, but they still call `createWebsiteInquiry`. It does **not** touch `website-inquiry.js`. It edits `ci.yml:84` and `package.json` `test:contact` (:35) and `:122`. | Don't touch `src/routes/contact.tsx`, `property.$listingNo.tsx`, `listings.tsx` or `src/components/site/*`. In `ci.yml`, add only one line in the `no-link-local-postgres` job (after :157). |
  | #222 | `fix/fx-03-live-agent-handoff` | It rewrites `live-agent.server.ts:178-362` and `website-inquiry.test.mjs:222+`, adds to `admin-data.server.ts` after `:3811`, and changes `package.json` `test:live-agent` (:52). | **Do not touch `live-agent.server.ts`.** In `website-inquiry.test.mjs`, edit only the tests at `:90-128`. In `admin-data.server.ts`, edit only `createWebsiteInquiry` (`:3675-3700`). |
  | #223 | `fix/fx-04-admin-attention` | It changes `admin-data.server.ts:981-1083`, `AdminShell.tsx`, `admin.index.tsx`, `admin.whatsapp.tsx` and `package.json` `test:command-center` (:39). | Don't touch those files. |

  FX-05b's `package.json` edits are limited to `test:staff-notifications` (:94), `test:team` (:45) and one new script after `:124`.
- **Committing.**
  - Use `git add <paths>` only. Never commit `bun.lockb` or `routeTree.gen.ts` noise.
  - Commit messages are conventional with a scope and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its listed suites. The owned suites need Docker and `docker pull pgvector/pgvector@sha256:d2ef61f4…` (`ci.yml:143`).

## Review Focus

Each item is a failure mode no fix-plan test covers. Each has a named test in its owning task.

1. **A staff reply to an alert becomes a "customer" lead.** The template invites a reply. If that reply is not isolated, the staff member becomes a `crm_contacts` / `crm_leads` row through the inbound trigger. Once FX-09 enqueues alerts from that trigger, this becomes an alert loop. *Test (Task 3):* `staff reply to a lead alert is isolated and opens that endpoint's window`.
2. **WhatsApp rejects the template because of customer-typed text.** A name with a newline, a tab, more than 4 spaces or excess length makes the provider refuse it. The alert then ends `failed` while the lead looks fine. *Test (Task 2):* `template params are single-line, trimmed, capped and never empty`.
3. **The job is queued but never runs.** No wake is sent after the commit, or the wake is disabled (fact 5). *Test (Task 4):* `website enquiry wakes the general lane once, and a replay wakes nothing`. The owner pre-flight below covers the production flag.
4. **One phone receives two alerts.** This can happen when:
   - the assigned agent is also a duty manager;
   - two staff share one destination;
   - a duty manager is toggled between a retry and the first run.

   *Test (Task 3):* `destinations are frozen at first run and deduplicated by member id`.
5. **The owner can never verify a staff number.** The test notification requires an open window that only a reply to an earlier send can open (fact 11). *Test (Task 2):* `staff test notification outside 24h sends the configured template`.

## Out of scope / follow-ups

| Follow-up | When | What it must do |
|---|---|---|
| **FX-05c, live-agent source** (small batch) | after PR #222 merges | Add `${leadAlertEnqueueCte("inserted_lead")}` to the handoff CTE in `live-agent.server.ts` (the `inserted_lead` CTE, `:302-310` on #222). Add `live-agent.server.ts` to the allowlist in `lead-alert.contract.test.mjs`. Add the owned test `live-agent handoff enqueues exactly one alert job`. Source label: 「網站客服轉介」. |
| **FX-02, valuation and listing-alert sources** | in FX-02 (not yet started) | FX-02's new lead CTEs in `valuation-leads.js` / `listing-alerts.js` call `leadAlertEnqueueCte("new_lead")`. `scripts/neon/backfill-form-leads.mjs` must **not** import it; the allowlist test enforces this. Flip the two `todo` assertions in `lead-alert.owned.db.test.mjs` (Task 4). Labels: 「放盤估價」, 「新盤通知」. |
| **FX-09, WhatsApp inbound source** | in FX-09's `20261009110000_inbound_lead_reopen.sql` | The replacement trigger inserts `('lead.staff.alert',1,jsonb_build_object('leadId',new_lead),'queued',3,now(),'lead-alert:'||new_lead) ON CONFLICT (idempotency_key) DO NOTHING`, only for a lead it just created and never in the history reconcile. The ingest caller must `wakeAfterCommit("general")`, because the trigger runs in the service lane. Decide whether a WhatsApp enquiry that already raises an enquiry notification also gets a lead alert; the recommendation is to skip the lead alert when an enquiry notification intent exists. Without FX-09, FX-05b cannot alert on WhatsApp-only leads, because changing the trigger is FX-09's function replacement with its own revert. |
| Manual-forward leads | none | Staff created them and chose the owner (Open question 4). |
| Per-endpoint `template_*` columns | FX-19c | They become unused legacy. Leave them. |
| Ack escalation | — | There is no behaviour to keep (fact 8). The `woztell.enquiry.staff.ack.check` handler stays registered, because existing queued rows must still parse. |

---

### Task 1: Duty-manager column and lead-alert evidence columns (migration)

**Files:**
- **Create `neon/migrations/20261006110000_duty_manager.sql`.** It is additive and idempotent, and sends nothing:

  | Change | Why it is required | Reversal |
  |---|---|---|
  | `ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS is_duty_manager boolean NOT NULL DEFAULT false` | Fix plan :327. It is data, not config. | `ALTER TABLE staff_users DROP COLUMN is_duty_manager` (or leave it) |
  | `ALTER TABLE staff_notification_attempts ALTER COLUMN notification_id DROP NOT NULL` | A lead alert has no enquiry intent (fact 7). It reuses the existing evidence, isolation and health. | It can stay. Old code always supplies the column. Restoring it requires deleting the lead rows first, which is an owner decision. |
  | `ALTER TABLE staff_notification_attempts ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES crm_leads(id)` | The subject of a lead alert | It can stay (nullable, unused by old code) |
  | `DO $$ … ADD CONSTRAINT staff_attempt_one_subject CHECK ((notification_id IS NULL) <> (lead_id IS NULL)) … $$`, guarded by `pg_constraint` | Every attempt has exactly one subject | `DROP CONSTRAINT staff_attempt_one_subject` |
  | `CREATE INDEX IF NOT EXISTS staff_attempts_lead ON staff_notification_attempts(lead_id) WHERE lead_id IS NOT NULL` | The handler and reconcile look rows up by lead | `DROP INDEX staff_attempts_lead` |

  Nothing else: no function or trigger is replaced, so no `_revert.sql` is needed.
- **Modify `src/lib/control-plane/migration-versions.js:122`:** append `"20261006110000_duty_manager.sql"`.
- **Create `src/lib/whatsapp-enquiries/lead-alert.owned.db.test.mjs`.** It starts with the migration tests; later tasks add to it.
- **Modify `package.json`:** after `:124`, add `"test:lead-alert:owned:db": "node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/whatsapp-enquiries/lead-alert.owned.db.test.mjs"`.
- **Modify `.github/workflows/ci.yml`:** after `:157`, add `- run: npm run test:lead-alert:owned:db`.

**Interfaces:** none (schema only).

- [ ] **Step 1: write the failing tests** (`withOwnedPostgres`, timeout 120 000):
  - `duty manager column defaults false and the migration is re-runnable`: re-execute the file on the migrated DB; `is_duty_manager` is `false` for a new staff row.
  - `an attempt needs exactly one subject`: an insert with both `notification_id` and `lead_id` NULL throws, and so does one with both set. One with only `lead_id` succeeds, and the `wa_staff_attempt_snapshot` trigger still fills the snapshots from `endpoint_id`.
  - `existing enquiry attempts are unaffected`: an insert with `notification_id` only still passes.
- [ ] **Step 2:** write the migration and the registry entry, then run the tests until green.
- [ ] **Step 3:** run `npm run test:lead-alert:owned:db`, `npm run test:control-plane` (migration registry and `src/test-wiring.test.mjs`), `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.** `feat(db): add duty manager flag and lead subject for staff alert evidence`

---

### Task 2: One switch, the staff template setting, and the template transport (R-20)

**Files:**
- **Create `src/lib/woztell/staff-alert-template.ts`.** It is pure, with no `server-only` import.
- **Modify `src/lib/whatsapp-enquiries/staff-notifications.server.ts`:**
  - `:10-27`: in the runtime, remove `staffWhatsAppEnabled` and `ackEscalationEnabled`, and add `template`.
  - `:43-50`: the transport type gets `template` in place of `templateName` / `templateLanguage`.
  - `:126-129`: `staff_whatsapp` is attempted only when the recipient has an enabled, non-retired `staff_whatsapp` endpoint. Otherwise no attempt row is written, so health is not inflated.
  - `:193-199`: drop the `staff_template_contract_unverified` block. Outside the window, the configured template is used. If there is none, the reason is `template_not_configured`.
  - `:212-216`: drop the `staffWhatsAppEnabled` live check.
  - `:219`: the boundary SQL window clause becomes `(ep.last_inbound_at BETWEEN now()-interval '24 hours' AND now() OR $9::boolean)`, where `$9` means "a template is configured".
  - `:277-288`: pass `template`, built with `source=「WhatsApp 查詢」`, `name=「WhatsApp 客戶」` and `link=workLink`.
- **Modify `src/lib/woztell/staff-whatsapp-transport.server.ts:21-33`:**
  - gate on `EP_WA_STAFF_NOTIFICATIONS_ENABLED !== "true"`;
  - delete the `:26` refusal;
  - `response = scope.template ? [scope.template] : [{type:"TEXT",text:scope.message}]`.
- **Modify `src/lib/neon/whatsapp-readiness-policy.ts:128,136-152`:**
  - `runtime_disabled` comes from `notificationsEnabled` alone;
  - `outside_message_window` is pushed **only** when `!runtime.templateContractVerified`, together with `template_unverified`.
- **Modify `src/lib/neon/whatsapp-readiness.server.ts:44,48,165`, `whatsapp-readiness.types.ts:73,76` and `src/lib/whatsapp-enquiries/service-health.server.ts:43`:**
  - drop `staffWhatsAppEnabled`;
  - `templateContractVerified = staffNotificationRuntime().template !== null`.
- **Modify `src/lib/neon/whatsapp-test-notification.server.ts`:**
  - `:182` and `:421`: the window clause gains `OR $n::boolean` (template configured);
  - `:456-463`: pass `template` with `name=「測試」`, `source=「測試通知」` and `link=<origin>/admin/whatsapp-settings`.
- **Modify `.env.example:200-218`:**
  - delete the lines for the two removed switches;
  - add `EP_WA_STAFF_ALERT_TEMPLATE=` with the comment `# Server-only. Approved WozTell staff template as JSON {name,language,params}; empty = alerts blocked (模板未設定).`
- **Modify `scripts/test-public-synthetic-browser.mjs:137-139`:** remove the two variables.
- **Update test fixtures that name the removed keys or the old scope:**
  - `staff-notifications.db.test.mjs:237-238,478-479,913-914,1030-1031`
  - `staff-test-notification.db.test.mjs:27,185`
  - `readiness.test.mjs:60`, `readiness.db.test.mjs:17`, `mapping-review.test.mjs:29`
  - `whatsapp-setup-readback.db.test.mjs:93`
  - `staff-notifications.test.mjs:95`, `staff-whatsapp-transport.test.mjs:10`
- **Create `src/lib/woztell/staff-alert-template.test.mjs`** and add it to `test:staff-notifications` (`package.json:94`).

**Interfaces:**
```ts
// staff-alert-template.ts
export type StaffAlertTemplateParam = "name" | "source" | "link";
export type StaffAlertTemplate = { name: string; language: string; params: StaffAlertTemplateParam[] };
export type StaffTemplateResponse = {
  type: "TEMPLATE"; elementName: string; languageCode: string;
  components: [{ type: "body"; parameters: { type: "text"; text: string }[] }];
};
export function parseStaffAlertTemplate(raw: string | undefined): StaffAlertTemplate | null; // strict: name /^[a-z0-9_]{1,512}$/, language /^[a-z]{2,3}(_[A-Z]{2})?$/, params 1..3 unique from the allowlist
export function sanitizeTemplateParam(value: string | null | undefined, fallback: string, max?: number /*60*/): string;
export function buildStaffTemplateResponse(t: StaffAlertTemplate, values: Record<StaffAlertTemplateParam, string>): StaffTemplateResponse;
// staff-notifications.server.ts
export type StaffNotificationRuntime = { enabled: boolean; generationId: string | null; channelId: string | null; template: StaffAlertTemplate | null };
export type StaffNotificationTransport = { verificationRef: string; postPrivateNote?: …unchanged; sendStaffWhatsApp?: (scope: { channelId: string; memberId: string; message: string; template: StaffTemplateResponse | null; beforeSend: () => Promise<void> }) => Promise<Result> };
```

- [ ] **Step 1: write the failing tests.**
  - `staff-alert-template.test.mjs`:
    - `parses the approved template and rejects malformed or unknown params`: `undefined`, `"{}"`, unknown param `phone`, duplicate params and a bad language all return `null`.
    - `template params are single-line, trimmed, capped and never empty` (Review Focus 2):
      - `"陳\n先生\t  "` becomes `"陳 先生"`;
      - 200 characters become ≤ 60;
      - `""` becomes the fallback;
      - no run of 4 spaces survives.
    - `builds the Meta body components in configured order`: round-trip through `describeTemplateParameters`.
  - `staff-whatsapp-transport.test.mjs`:
    - `sends a TEMPLATE response when a template is given and never a TEXT`;
    - `refuses when EP_WA_STAFF_NOTIFICATIONS_ENABLED is not true`;
    - `channel mismatch is a preflight block, not a send`.
  - `staff-notifications.test.mjs`:
    - `only EP_WA_STAFF_NOTIFICATIONS_ENABLED gates staff notifications`: `.env.example`, `src/` and `scripts/` contain neither removed name.
    - `ack escalation has no reader`.
  - `readiness.test.mjs`:
    - `outside the window is ready when a template is configured`;
    - `outside the window is blocked with 訊息模板合約未核實 when none is`.
  - `staff-notifications.db.test.mjs`:
    - `switch on but no enabled staff WhatsApp endpoint sends nothing and writes no staff_whatsapp attempt` (production pre-flight guard).
    - `enquiry notification outside 24h sends the template payload`.
  - `staff-test-notification.db.test.mjs`:
    - `staff test notification outside 24h sends the configured template` (Review Focus 5);
    - `without a template it is still refused outside 24h`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:staff-notifications`, `npm run test:whatsapp-enquiries`, `npm run test:no-link`, `npm run test:staff-setup:ui`, `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] **Step 4: commit.** `fix(whatsapp): one staff notification switch and approved template outside 24h`

---

### Task 3: The `lead.staff.alert` handler (destination, D-11 guard, reservation)

**Files:**
- **Create `src/lib/whatsapp-enquiries/lead-alert.server.ts`.**
- **Modify `src/lib/control-plane/job-handlers.server.ts`:** after `:490`, register `lead.staff.alert@1` and `lead.staff.alert.reconcile@1` with `idPayload(input,"leadId")`. Both use the general lane (`laneForJob` is unchanged), and both require `context.workerId` (`JOB_LEASE_REQUIRED`).
- **Modify `staff-notifications.server.ts:349` (health):** add `lead_alerts_blocked`, the count of `lead_id IS NOT NULL AND dispatch_state IN ('failed','suppressed')`. The existing `unknown` count already includes lead rows.
- **Modify `src/components/admin/StaffEndpointEditor.tsx:85-94`:** add the label for `lead_alerts_blocked` (copy table).
- **Extend `lead-alert.owned.db.test.mjs`.**

**Interfaces:**
```ts
export const LEAD_ALERT_JOB = "lead.staff.alert";
export const LEAD_ALERT_RECONCILE_JOB = "lead.staff.alert.reconcile";
export type LeadAlertBlockReason =
  | "notifications_disabled" | "template_not_configured" | "channel_unverified"
  | "transport_capability_unverified" | "work_origin_unconfigured" | "lead_missing"
  | "no_destination" | "destination_is_customer" | "dispatch_eligibility_changed";
export type LeadAlertDeps = {
  query?: typeof queryRows; transaction?: typeof transactionRows;
  runtime?: () => StaffNotificationRuntime; transport?: () => StaffNotificationTransport;
};
export async function handleLeadStaffAlert(
  payload: { leadId: string },
  context: { jobId: string; workerId: string; checkpoint: () => Promise<void> },
  deps?: LeadAlertDeps,
): Promise<{ summary: { accepted: number; unknown: number; blocked: number } }>;
export async function reconcileLeadStaffAlert(leadId: string, query?: typeof queryRows): Promise<{ unknown: number }>;
```
The fix plan wrote `handleLeadStaffAlert(job): Promise<void>`. This plan returns `{summary}` so it matches `JobHandler.run` (`job-handlers.server.ts:1-9`).

**Behaviour, in order:**

1. **Reconcile.** Any `dispatching` row for this lead whose job is not running with a live lease becomes `unknown`, with `safe_error='lease_expired_after_dispatch'`. It is never resent (same SQL as `staff-notifications.server.ts:321`).
2. **Plan.** This runs only if the lead has no attempt rows yet, in one transaction:
   - Lock the lead with `SELECT … FROM crm_leads WHERE id=$1 FOR UPDATE`. If it is missing, write `lead_missing`.
   - If the runtime is disabled, the template is missing, or the channel scope fails, insert **one** row with `endpoint_id NULL, dispatch_state='suppressed', safe_error=<reason>` and `attempt_key = sha256([leadId,'blocked'])`.
   - Otherwise resolve the destinations in SQL:
     - (a) the assigned agent's endpoint, if eligible; else
     - (b) every eligible endpoint whose staff has `is_duty_manager`; else
     - (c) one `no_destination` row.

     **Eligible** means all of:
     - `ep.transport='staff_whatsapp'`, `ep.channel_id=$channel`;
     - `ep.enabled`, `ep.verified_at`, `ep.permission_granted`;
     - `ep.retired_at IS NULL`;
     - `quiet_hours_policy @> {"approved":true,"allowAllHours":true}`;
     - mapping `m.eligible`, `m.verified_at`, `m.retired_at IS NULL`;
     - `(ep.mapping_version IS NULL OR ep.mapping_version=m.version)`;
     - `s.active` and role in admin / manager / agent.

     Apply `DISTINCT ON (ep.destination_reference)`, then insert one `queued` row per destination with `attempt_key=sha256([leadId, ep.id])`. Endpoints whose member id is a customer (rule below) get a `suppressed` / `destination_is_customer` row instead.
   - Rows are never re-planned, so destinations are frozen.
3. **Claim each `queued` row.** One transaction:
   - lock the lead and the attempt;
   - `UPDATE … SET dispatch_state='dispatching', claim_id, job_id, dispatch_started_at WHERE queued AND <D-11 guard> AND <endpoint still eligible at the snapshot version> AND job running with a live lease AND lease owner = me`;
   - enqueue `lead.staff.alert.reconcile` with key `'lead-alert.reconcile:'||attempt.id` at `lease_expires_at + 1 min`.

   If no row is updated, mark it `suppressed` / `dispatch_eligibility_changed`.
4. **The D-11 guard**, as SQL inside the claim and again in `beforeSend`:
   ```sql
   NOT EXISTS (SELECT 1 FROM whatsapp_conversations w WHERE w.channel_id = ep.channel_id AND w.woztell_member_id = ep.destination_reference)
   AND NOT EXISTS (SELECT 1 FROM crm_contacts c WHERE c.whatsapp_member_id = ep.destination_reference OR c.normalized_phone = ep.destination_reference)
   ```
5. **Send.** Call `transport.sendStaffWhatsApp`:
   - `template = buildStaffTemplateResponse(runtime.template, values)` with `name` = the contact name, `source` = the source label and `link` = `<origin>/admin/leads?lead=<id>`;
   - `message` is used only for evidence;
   - the template is **always** used, even inside the window (see Template decision below).
6. **Finish.** `UPDATE … WHERE claim_id AND dispatching`, exactly as at `staff-notifications.server.ts:302`. An exception after `beforeSend` passes leaves the row `unknown`. A preflight block (`STAFF_NOTIFICATION_PREFLIGHT_BLOCKED`) becomes `suppressed`.
7. **Return.** The handler returns normally in every terminal case, so the job `succeeded` and there is no retry storm. It throws `retryableJobError` **only** before any claim (a database error during plan), when the rows are still `queued`.

**Template decision (inside the window).** Lead alerts never send free TEXT. Always use the template, because:
- the window opens only through a correlated reply (fact 11), so a "within window" state is rare and unreliable;
- the existing TEXT is English (`staff-notifications.server.ts:266`), which breaks the zh-HK rule;
- one payload shape is one tested path;
- utility templates inside an open window are normally not charged. The owner should confirm this on the WozTell bill.

- [ ] **Step 1: write the failing tests** in `lead-alert.owned.db.test.mjs`. Provider: the fake `send` passed to `createStaffWhatsAppTransport`. Env: the synthetic refs from `staff-test-notification.db.test.mjs:24-41`.
  - `unassigned lead → duty manager destination`. Setup:
    - two duty managers with eligible endpoints;
    - one duty manager without an endpoint;
    - one non-duty manager with an endpoint.

    Exactly 2 provider calls, to the two duty managers' member ids. Each attempt row has `lead_id`, `endpoint_id` and the snapshot.
  - `assigned agent with a verified mapping is the only destination`: 1 call, and no duty manager is contacted.
  - `assigned agent without a mapping falls back to duty managers`.
  - `no duty manager → visible outcome`: 0 calls; one row `suppressed/no_destination`; health `lead_alerts_blocked=1`.
  - `destination equal to a customer member id is refused`. Two cases:
    - (a) at plan time, the endpoint member id equals an existing `whatsapp_conversations.woztell_member_id` → `destination_is_customer`, 0 calls;
    - (b) at send time, the fake transport inserts such a conversation before calling `scope.beforeSend()` → `suppressed`, and `send` is never reached.
  - `outside 24h → template payload`: `last_inbound_at` is NULL. The captured `response` deep-equals one `{type:"TEMPLATE",elementName,languageCode:"zh_HK",components:[{type:"body",parameters:[3 texts]}]}`. No `TEXT` appears.
  - `inside 24h still sends the template, never text`.
  - `template not configured → visible state, no send`: `EP_WA_STAFF_ALERT_TEMPLATE` is unset. The job completes, one row is `suppressed/template_not_configured`, there are 0 calls, and running the job a second time adds no row and makes no call.
  - `switch off → notifications_disabled, no send`.
  - `retry after lease expiry does not send twice`:
    - the first run's fake `send` throws after `beforeSend`, so the row stays `dispatching`;
    - expire the job lease and requeue it;
    - the second run marks the row `unknown`;
    - total provider calls stay 1. A third run after `accepted` makes 0 calls.
  - `provider refusal is recorded as failed and not retried`: `send` returns `definitive_refusal` → `failed`, 1 call, and the job succeeds.
  - `destinations are frozen at first run and deduplicated by member id` (Review Focus 4):
    - two staff share one `destination_reference` → 1 call;
    - toggling a new duty manager before the retry adds no row.
  - `staff reply to a lead alert is isolated and opens that endpoint's window` (Review Focus 1): after an `accepted` alert with `provider_operation_id='op-1'`, `isolateSignedStaffEvent` for an inbound event with reply context `op-1`:
    - returns `true`;
    - writes a `correlated` internal event;
    - sets `last_inbound_at`;
    - creates no `crm_contacts` row.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:lead-alert:owned:db`, `npm run test:staff-notifications`, `npm run test:control-plane`, `npm run test:job-wake`, `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.** `feat(leads): send one staff WhatsApp alert per lead with a customer-recipient guard`

---

### Task 4: Enqueue at intake, wake, and pin "backfill never alerts"

**Files:**
- **Create `src/lib/neon/lead-alert-enqueue.js` and `lead-alert-enqueue.d.ts`.**
- **Modify `src/lib/neon/website-inquiry.js`:**
  - `:128-135`: add `${leadAlertEnqueueCte("new_lead")}` after `new_lead`;
  - `:145`: `RETURNING id, (SELECT count(*) FROM lead_alert) > 0 AS lead_alert_queued`;
  - `:181-183`: return `leadAlertQueued`, which is `false` on the replay path.
- **Modify `src/lib/neon/website-inquiry.d.ts:39`:** set the return type.
- **Modify `src/lib/neon/admin-data.server.ts:3692-3702` (`createWebsiteInquiry` only):** when `leadAlertQueued`, call `(await import("../control-plane/job-wake.server.ts")).wakeAfterCommit("general")`.
- **Modify `src/lib/neon/website-inquiry.test.mjs:90-128`:** keep "one atomic query", and add the CTE assertion.
- **Create `src/lib/whatsapp-enquiries/lead-alert.contract.test.mjs`** and add it to `test:staff-notifications`.
- **Extend `lead-alert.owned.db.test.mjs`.**

**Interfaces:**
```js
export const LEAD_ALERT_JOB_TYPE = "lead.staff.alert";
/** Returns `lead_alert AS (INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
 *  SELECT 'lead.staff.alert',1,jsonb_build_object('leadId',id::text),'queued',3,now(),'lead-alert:'||id FROM <leadCte>
 *  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id)`. leadCte must match /^[a-z_]+$/. */
export function leadAlertEnqueueCte(leadCte: string): string;
// website-inquiry.d.ts
export function persistWebsiteInquiry(query, input): Promise<{ id: string; leadAlertQueued: boolean }>;
```

- [ ] **Step 1: write the failing tests.**
  - In `lead-alert.owned.db.test.mjs`, through the real `persistWebsiteInquiry` against owned Postgres:
    - `each source path enqueues exactly one alert job`:
      - contact form (no listing): 1 job;
      - property enquiry (an active listing with an active agent): 1 job, and the lead is assigned to that agent;
      - the same `submissionId` replayed: still 1 job and 1 lead;
      - the legacy path without a `submissionId`: one job per lead.

      Every job has key `'lead-alert:'||lead.id`, payload `{leadId}`, `max_attempts=3` and the general lane.
    - `sources not yet creating leads enqueue none (FX-02 / FX-05c / FX-09 hooks)`. Each case is a `t.todo` sub-assertion that names the follow-up batch:
      - `persistValuationLead` and `persistListingAlert` create 0 `crm_leads` and 0 jobs;
      - a WhatsApp inbound message creates a lead through the trigger, but 0 jobs.
    - `backfilled lead enqueues none`:
      - a direct `INSERT INTO crm_leads` (the shape the FX-02 backfill and migration reconciles use), then re-running the history `INSERT … SELECT` from `20260906100000_whatsapp_inbound_leads.sql:26-31` → 0 `lead.staff.alert` jobs;
      - `pg_trigger` on `crm_leads` has no trigger whose function body mentions `ops_jobs`.
    - `website enquiry wakes the general lane once, and a replay wakes nothing` (Review Focus 3): `mock.module` on `job-wake.server.ts` counts `wakeAfterCommit("general")` = 1, then 0 for the replay.
  - `lead-alert.contract.test.mjs`:
    - `only allowlisted intake modules import the enqueue fragment`. Scanning `src/` and `scripts/`, the importers of `lead-alert-enqueue` are exactly `{src/lib/neon/website-inquiry.js}`. Nothing under `scripts/` or `neon/migrations/` contains `'lead.staff.alert'`, except the handler and registry files. The failure message names FX-02 / FX-05c / FX-09 as the batches that extend the allowlist.
  - `website-inquiry.test.mjs`: `website inquiry enqueues its lead alert in the same statement`. The single statement contains `lead_alert AS (INSERT INTO ops_jobs`, and `'lead-alert:'||id` appears after `new_lead`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:lead-alert:owned:db`, `npm run test:staff-notifications`, `npm run test:contact`, `npm run test:live-agent:local-db` (if run locally; it is not in CI), `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] **Step 4: commit.** `feat(leads): queue the staff alert in the same statement as each website lead`

---

### Task 5: 「值班經理」 toggle on 團隊成員 (admin-only, audited)

**Files:**
- **Modify `src/lib/neon/admin-team.types.ts:8-20`:** add `isDutyManager: boolean`, and add `ChangeStaffDutyManagerInput`.
- **Modify `src/lib/neon/admin-team.server.ts:257-263,375-380`** (list and detail `SELECT … FROM staff_users s`), plus the mapper at `:175-200`: read `s.is_duty_manager`.
- **Modify `src/lib/neon/admin-team.ts`:**
  - add the schema next to `:52-54`;
  - add a boundary method next to `:158-160`, through `withRequest`, so the server requires the admin role;
  - add a server fn next to `:133-135`;
  - add an export next to `:164-165`.
- **Modify `src/lib/neon/staff-lifecycle.server.ts`:**
  - add `"staff.duty_manager_changed"` to the `AuditInput.action` union (`:39-55`);
  - add a `changeStaffDutyManager` method next to `:674-688`.

  It is one atomic statement, unlike roles:
  ```sql
  WITH changed AS (UPDATE staff_users SET is_duty_manager=$2, updated_at=now()
    WHERE id=$1 AND active AND updated_at=$3::timestamptz RETURNING id, is_duty_manager),
  audit AS (INSERT INTO ops_audit_logs(actor_staff_id,permission,action,resource_type,resource_id,outcome,request_id,metadata)
    SELECT $4,'staff.manage','staff.duty_manager_changed','staff_user',id::text,'success',$5,
      jsonb_build_object('before',NOT $2,'after',$2) FROM changed RETURNING id)
  SELECT * FROM changed
  ```
  If no row comes back, respond 409 `STAFF_CHANGED`.
- **Modify `src/components/admin/team/AdminTeamDetailPanel.tsx:126-159`:**
  - add a 「值班經理」 row using `@/components/ui/switch` and `Label` inside the 角色與存取 section;
  - `disabled={!canManage || !active || pending}`;
  - new prop `onDutyManagerChange(next: boolean): void`.
- **Modify `src/components/admin/team/AdminTeamTable.tsx`** (row name cell): add a `Badge variant="secondary"` 「值班經理」 when `isDutyManager`.
- **Modify `src/routes/admin.team.tsx:346-440,643-648`:** add a handler that calls `changeStaffDutyManager({ staffId, isDutyManager, expectedVersion: detail.version })`, shows a toast, and calls `loadDetail` + `loadTeam`. No confirm dialog; the change is reversible.
- **Tests:**
  - `src/components/admin/team/AdminTeam.test.tsx`
  - `src/lib/neon/admin-team.contract.test.mjs`
  - `src/lib/neon/staff-lifecycle.test.mjs`
  - `lead-alert.owned.db.test.mjs`

**Interfaces:**
```ts
export type ChangeStaffDutyManagerInput = { staffId: string; isDutyManager: boolean; expectedVersion: string };
export const changeStaffDutyManagerSchema: z.ZodType<ChangeStaffDutyManagerInput>; // strict, uuid, boolean, ISO string
export const changeStaffDutyManager: (o: { data: ChangeStaffDutyManagerInput }) => Promise<{ isDutyManager: boolean; requestId: string }>;
// AdminTeamDetailPanel props += onDutyManagerChange?: (next: boolean) => void
```

**New copy (zh-HK):**

| Where | Copy |
|---|---|
| Switch label / table badge | 值班經理 |
| Help under the switch | 未指派的新客戶查詢會以 WhatsApp 通知值班經理。此成員需要已核實的同事手機通知設定。 |
| Toast, on | 已設為值班經理。 |
| Toast, off | 已取消值班經理。 |
| 409 | 此成員資料已被其他同事更新，請重新載入後再試。 |
| Other error | 未能更新值班經理設定，請稍後再試。 |
| Health label (Task 3, `StaffEndpointEditor`) | 新查詢通知未送出 |
| Template source labels (Tasks 2–3) | 網站查詢 · 樓盤查詢 {listing_no} · WhatsApp 查詢 · 測試通知 (later: 網站客服轉介 · 放盤估價 · 新盤通知) |
| Template name fallbacks | 未提供姓名 · WhatsApp 客戶 · 測試 |

- [ ] **Step 1: write the failing tests.**
  - `AdminTeam.test.tsx`:
    - `duty manager switch renders checked for a duty manager`;
    - `it is disabled for non-admins and suspended members`;
    - `the table shows the 值班經理 badge`.
  - `admin-team.contract.test.mjs`:
    - `changeStaffDutyManager requires admin and a strict payload`: a manager gets 403, and extra keys are rejected.
  - `staff-lifecycle.test.mjs`:
    - `duty manager change writes the flag and its audit row in one statement`;
    - `a stale version returns 409 and writes nothing`.
  - `lead-alert.owned.db.test.mjs`:
    - `toggling duty manager is audited and immediately changes the alert destination for the next lead`.
- [ ] **Step 2:** implement until green. Capture 375 px and 1440 px screenshots of the member drawer.
- [ ] **Step 3:** run `npm run test:team`, `npm run test:lead-alert:owned:db`, `npm run test:staff-setup:ui`, the `playwright.admin-owned.config.ts` suites, `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] **Step 4: commit.** `feat(admin): let admins mark a duty manager for unassigned lead alerts`

---

## Owner actions required before production

These are gated. Claude does none of them.

1. **Template.**
   - Get the staff template approved in WozTell / Meta under the **utility** category. Suggested body: 「新客戶查詢：{{1}}（{{2}}）。請到後台跟進：{{3}}」.
   - Send back its exact **element name** and language (`zh_HK`), and confirm the parameter order `name, source, link`.
2. **Pre-flight read-only checks** on production. The owner runs them or names the record:
   - (a) `SELECT count(*) FROM staff_notification_endpoints WHERE transport='staff_whatsapp' AND enabled AND retired_at IS NULL` should be 0. The single switch is already `true` (fact 9), so any enabled endpoint starts receiving staff WhatsApp after deploy.
   - (b) Confirm `OPS_EVENT_WAKE_ENABLED=true` and `OPS_WAKE_URL` are set, or ship FX-07 first. Otherwise alert jobs may sit queued (fact 5).
3. **Migration.**
   - Apply `20261006110000_duty_manager.sql` on a Neon branch and verify the columns, the constraint and the index.
   - Then apply it to production with explicit approval **before** merging.
4. **Map staff.** For each agent and each duty manager:
   - complete the reviewed mapping;
   - save a `staff_whatsapp` endpoint with the staff member's own WhatsApp member id, which must **not** be a number that has ever messaged the company as a customer (D-11 refuses it);
   - grant permission and enable it.
5. **Mark at least one 「值班經理」** on 團隊成員.
6. **Settings.**
   - Set `EP_WA_STAFF_ALERT_TEMPLATE` (server-only) in Vercel.
   - Leave `EP_WA_STAFF_NOTIFICATIONS_ENABLED=true`.
   - Delete `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED` and `EP_WA_STAFF_ACK_ESCALATION_ENABLED`.
7. **Sandbox test** with the owner's test number on the WozTell sandbox channel:
   - (a) staff test notification → the template arrives;
   - (b) submit a test website enquiry with no listing → exactly one template reaches the test duty manager, and the health card shows 0 for 新查詢通知未送出;
   - (c) reply to the template → no new CRM lead appears.

   Then canary-check production with a staff-owned test enquiry and close that lead.
8. **Rollback.** Set `EP_WA_STAFF_NOTIFICATIONS_ENABLED=false`. Alerts stop at once and leads are still saved. Revert the PR. The columns can stay.

## Open questions

Each has a recommended default.

1. **Reuse `staff_notification_attempts`**, relaxing `notification_id` to nullable and adding `lead_id`, or create a new `lead_staff_alert_attempts` table?
   - **Default: reuse.** Isolation (Review Focus 1), receipts, `last_inbound_at` and health then work unchanged.
   - A new table is purely additive but needs four more SQL paths to stay in sync.
2. **Template parameters.** **Default:** `name, source, link`. Never the phone number. The name is sanitised and capped at 60.
3. **Gate lead alerts on `EP_WA_ENQUIRY_MODE=active` / the activation id too?** **Default: no.** Only the single switch applies, because website leads are not WhatsApp enquiries.
4. **Alert on staff manual-forward leads?** **Default: no.**
5. **Who may be a duty manager?** **Default:** any active member with the admin, manager or agent role. Only an admin can toggle it.
6. **Ship order.** The fix plan puts FX-02 before FX-05b. **Default:** ship FX-05b as soon as the template is approved. FX-02 then adds one CTE call and flips the two `todo` assertions.

## Findings that differ from the approved fix plan

- **The migration is not "additive column only".** It also needs `staff_notification_attempts.notification_id DROP NOT NULL`, plus `lead_id`, a CHECK and a partial index (fact 7, Task 1). All are backward compatible.
- **A new env var is required.** `EP_WA_STAFF_ALERT_TEMPLATE` is one setting; the plan said "adds 0". The net change is still −1.
- **FX-05b effectively depends on FX-07** (or on `OPS_EVENT_WAKE_ENABLED=true` in production). Otherwise a queued alert may never run.
- **Valuation and listing-alert forms create no lead on `main`.** FX-05b alone covers the website and property sources. Valuation, alert, live agent and WhatsApp inbound are hooks for FX-02, FX-05c and FX-09.
- **Removing `_WHATSAPP_ALERTS_ENABLED` turns staff WhatsApp on in production at deploy.** `NOTIFICATIONS_ENABLED` is already `true` there. This is safe only while no `staff_whatsapp` endpoint is enabled; see pre-flight 2(a). Ack escalation is dead code, so removing its switch changes nothing.
- **R-20 also blocks the staff test notification** (fact 11), so it is fixed here too.
- The fix plan's `handleLeadStaffAlert(job): Promise<void>` becomes `{summary}`, to fit `JobHandler`.
