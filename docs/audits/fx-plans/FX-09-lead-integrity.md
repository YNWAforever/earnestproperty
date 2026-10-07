# FX-09: Lead and contact edits stop overwriting each other. Implementation plan

**Owner decisions (2026-10-06, binding):**
1. **Base on `main` (4965d48).** This batch does not depend on any open PR.
2. **The inbound-lead trigger does NOT enqueue the FX-05b staff alert.** Its handler exists only in unmerged PR #225. Neither migration nor revert may contain that job type's string (see Global Constraints). The explicit follow-up is in "Out of scope / follow-ups":
   > after #225 merges, the trigger adds `INSERT INTO ops_jobs(...'lead.staff.alert'...) ON CONFLICT (idempotency_key) DO NOTHING` for a lead it just created, never in history reconcile, and the ingest caller wakes the general lane.
3. **Everything else follows the fix plan's FX-09 scope:**
   - optimistic concurrency on single-lead edits: 409 `LEAD_CHANGED`, with the copy 「此客戶查詢已被其他同事更新，請重新載入後再儲存。」, an audit row with before and after values of the changed fields, and the new version returned;
   - the server rejects a bulk assignment to inactive staff;
   - the assignment pickers hide inactive staff;
   - a new `crm_contacts.whatsapp_profile_name` column, so ingest never overwrites a staff-edited name;
   - the inbound-lead trigger creates a new lead when the contact has no **open** lead, and reopens a closed conversation on a new inbound message.
4. **Migrations and data (owner answers, 2026-10-06).**
   - Migration A (`whatsapp_profile_name`) and migration B (the inbound-lead trigger replacement) are both approved as drafted. That includes migration B auto-assigning only active staff, and acting only on messages newer than the last close.
   - They are applied only to test databases in this batch. The Neon branch and production applies are the owner's step.
   - **No backfills.** Neither the name copy into `whatsapp_profile_name` nor creating missed leads for returning customers will run.
   - The PR ships a read-only report listing returning customers whose closed leads absorbed new messages, so staff can follow up by hand.
   - Open questions on both backfills are resolved as **no**.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- A manager who reassigns a lead can no longer have it silently reverted by a colleague's stale save. The stale save gets a clear zh-HK conflict message instead, and the colleague keeps their typed edits until they choose to reload.
- A staff member's own back-to-back saves never conflict with each other.
- The audit shows exactly what changed.
- Nobody can assign leads to deactivated staff.
- A returning WhatsApp customer whose last lead is closed gets a new lead, and their closed conversation reopens.
- The customer's WhatsApp profile name no longer overwrites the name staff typed.

Findings: C-05, G-02, D-06, C-10 (= D-08).

**Approach.**
- **The version is an opaque microsecond string generated in SQL. It is never a JS `Date`.** One SQL expression, `to_char(<alias>.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, is used for three things:
  - it is read in `fetchAdminLead`;
  - it is compared, under a row lock, in the guarded UPDATE;
  - it is returned from the UPDATE.

  It lives in one helper, `leadVersionSql(alias)`, so the three uses cannot drift apart. The client stores it as a plain string on `AdminLeadDetail.version` and never parses it. This is the FX-05b lesson: milliseconds were lost through `Date`, and nearly every save returned 409.
- **One atomic statement per single-lead save.** The CTEs do four things:
  1. lock the row (`FOR UPDATE`) and read its current version;
  2. check that a newly chosen assignee is active;
  3. UPDATE, only when the version matches and at least one field actually differs;
  4. INSERT the audit row with `changed`, `before` and `after`, built from a jsonb diff.

  The final SELECT reports `current_version`, `assignee_ok` and `new_version`. TypeScript maps the result to 409 `LEAD_CHANGED`, 400 `ASSIGNEE_INACTIVE`, or `{ ok: true, version, changed }`.

  A repeat save at the current version with no edits writes nothing and returns that version. A save at a stale version always 409s, even when it would change nothing, so a stale draft can never pick up a fresh version (Review Focus 1).
- **The rule for who bumps `updated_at`** (decided here; the fix plan was silent):
  - Every writer that changes a `crm_leads` row bumps `updated_at` in the same statement.
  - Writers that do not touch `crm_leads` never bump it.
  - Only staff single-lead edits check the version.
  - Background writers (live agent, inbound trigger, staff handover) never check it. They are either genuine changes, which staff *should* be told about, or inserts.

  Facts 6–8 show that AI enrichment, notes and contact edits do not touch `crm_leads`, so they cause no spurious 409s. **Staff handover is the one gap:** it updates `crm_leads` without bumping (fact 8). Task 1 fixes it in code, and a contract test pins the rule for every current and future `UPDATE crm_leads`.
- **Inactive staff.**
  - The server refuses a *new* assignment to inactive staff, for single edits as well as bulk.
  - A lead already owned by a deactivated agent can still be re-staged.
  - Pickers show active staff only, plus the current owner, flagged, when that owner is inactive.
- **Profile name.** Ingest writes `name=COALESCE(c.name,$3)`, the same rule as every other writer, plus a new `whatsapp_profile_name`. A live webhook overwrites the profile name. A history import only fills it when it is empty, so old names are not replayed.
- **The trigger replacement** (`ensure_whatsapp_inbound_lead_fn`) keeps the advisory lock and the "first lead" rule unchanged. On INSERT only, it adds two behaviours, both limited to messages newer than what staff have already acted on:
  - a new lead when the contact has no open lead and the message is newer than the latest closed lead's `updated_at`;
  - `status='open'` on a closed conversation when the message is at least as new as the conversation's `last_inbound_at`.

  It never inserts into `ops_jobs`, and it runs no history reconcile.
- **Two migrations, as in the register.**
  - `20261009100000_contact_profile_name.sql` is additive.
  - `20261009110000_inbound_lead_reopen.sql` replaces the trigger function. Its revert is `neon/reverts/20261009110000_inbound_lead_reopen_revert.sql` (FX-06 pattern).

  Tasks 1–3 need no migration.
- **No new env var. No provider call.**

**Tech stack.**
- Owned full-schema Postgres: `withOwnedPostgres` + `mockOwnedServerDb` (`scripts/acceptance/owned-postgres-test.mjs:44-164`), with `--experimental-test-module-mocks`. **One container for the whole file**, `src/lib/neon/lead-integrity.owned.db.test.mjs`, used by Tasks 1, 2, 4 and 5.
- Pure and component tests: `bun test` with `renderToStaticMarkup`.
- Contract tests: `node --test`.
- Browser: Playwright `playwright.admin-owned.config.ts`, with the daily-work synthetic fixture.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md` (branch `fix/fx-01-public-form-feedback`):
  - C-05 (:190)
  - C-10 (:195)
  - D-06 (:223)
  - G-02 (:331)
- Fix plan `docs/audits/2026-10-fix-plan.md` (same branch):
  - FX-09 (:444-470)
  - Review focus 6 (:50)
  - the migration register (:787-799)
  - Global constraints (:17-39)

## Verified current behaviour (main 4965d48)

| # | Fact | Where |
|---|---|---|
| 1 | **`updateAdminLead` is last-write-wins.** It does one `UPDATE crm_leads SET stage,intent,budget_min,budget_max,preferred_estates,assigned_agent_id,note,updated_at=now() WHERE id=$8 [AND assigned_agent_id=$9]` with no version check. On no row, an agent gets 403 and an admin or manager gets `{ok:false,error:"Not found"}`. The audit is a **separate** `writeAudit` after the UPDATE, with metadata `{stage,intent}` only: no assignee, no before values. It returns `{ok:true}` with no version. | `src/lib/neon/admin-data.server.ts:2561-2599` (UPDATE `:2576-2588`, audit `:2594-2597`); `writeAudit` `:3792-3813` |
| 2 | **Callers.** There is one client wrapper and one UI caller. The wrapper is `updateAdminLeadServer` (POST, `requireStaff(["admin","manager","agent"])`, pass-through validator). The UI caller is `admin.leads.tsx:695` `saveLead`, which sends the **whole draft** (`draftToInput` `:1849-1860`). `markStage` (`:760-763`) goes through `saveLead`. Tests that pin the SQL shape: `admin-transactions.contract.test.mjs:492-536` (`/UPDATE crm_leads SET/`, `params[2]===0`, `params[3]===100`, `{ok:false,error:"Not found"}`), in `test:transactions`. | `src/lib/neon/admin-data.ts:1327-1337`; `src/routes/admin.leads.tsx:653-711` |
| 3 | **The detail read path has no version.** `fetchAdminLead` selects explicit columns and maps each one by hand (`rowDate` for `created_at`). `updated_at` is not selected. The UI stores the result in `detail` (`:268`) and derives `draft` with `leadToDraft` (`:1837-1847`). After a save it runs `refreshLeads()` and then `loadLeadDetail()` (`:699-704`), which resets `draft` and `detail`. `addNote` (`:713-758`) replaces `detail` without touching `draft`. `reloadLeadContact` (`:451-478`) merges contact fields only. The dirty guard compares `draft` with `leadToDraft(detail)` (`:635-639`). | `src/lib/neon/admin-data.server.ts:2382-2463`; `src/lib/neon/admin-data.types.ts:149-165,342-346,358-367` |
| 4 | **Bulk update** writes only the fields supplied (`CASE WHEN $2/$4`). It is agent-scoped, sets `updated_at=now()` and audits `lead.bulk_update`. **There is no active check on `assigned_agent_id`.** `admin.routes.test.mjs:519-534` pins `WHERE id = ANY($1::uuid[])`, `BULK_LEAD_UPDATE_LIMIT`, `agentScope`, `lead.bulk_update`, and no client-side loop. | `admin-data.server.ts:2617-2664` (UPDATE `:2646-2653`); `admin-data.ts:1013-1039` |
| 5 | **No `updated_at` trigger exists anywhere.** `crm_leads.updated_at timestamptz NOT NULL DEFAULT now()`. No migration creates a trigger `ON crm_leads`. Every bump is explicit in the writer's SQL. | `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:104-118` |
| 6 | **Every writer of `crm_leads` on main, and whether it bumps.** **UPDATE + bump:** `updateAdminLead`; bulk; live-agent handoff `updated_lead` (sets stage `contacted`, intent, budget, estates, source `live_agent`; `src/lib/ai/live-agent.server.ts:244-257`). **INSERT only:** website inquiry (`src/lib/neon/website-inquiry.js:128-135`); manual forward (`neon/migrations/20260929107000_whatsapp_forwarded_enquiries.sql:70-72`); the WhatsApp trigger (`20260906100000…:11-15`) and its one-time reconcile (`:26-31`). **Read or lock only:** AI analysis (`20261003030000_crm_analysis_runs.sql:54` `FOR UPDATE`, no write); command center (read and analyse only, `admin.leads_.command-center.tsx:17`). **Not on main:** valuation and listing-alert leads (FX-02). | as listed |
| 7 | **AI enrichment never writes `crm_leads`.** It writes `crm_ai_profiles`, `crm_ai_tags` and `crm_ai_analysis_runs` (`crm-enrichment.server.ts:446-455`). Approving or rejecting an AI tag (`admin-data.server.ts:2526-2559`) does not touch the lead row. **Notes** insert `crm_activities` only (`:2666-2693`). **Contact edits** (`wa_update_lead_contact`, `20260929107000…:82-111`) update `crm_contacts` only. None of them bump the lead version, so none can cause a spurious 409. | as listed |
| 8 | **Staff handover writes `crm_leads` WITHOUT bumping `updated_at`.** `staffReassignStatements` emits `UPDATE crm_leads SET assigned_agent_id = $2::uuid WHERE assigned_agent_id = $1::uuid`, which `setStaffActive` runs when a member is deactivated with a successor. A version guard alone would therefore miss this reassignment: a manager's open editor would still hold a matching version and would silently re-assign the lead to the departed agent. `staff-ownership.test.mjs:31-52` (in `test:property-experience`) pins `SET <column> = $2` and `WHERE <column> = $1`. | `src/lib/neon/staff-ownership.ts:26-44,98-115`; `admin-data.server.ts:485-600` (`:583`) |
| 9 | **Inactive staff.** `staff_users.active boolean NOT NULL DEFAULT true` (`20260623090000…:43`). It is set false by `setStaffActive` (`admin-data.server.ts:587`), optionally with reassignment. `fetchAdminAgents` returns **all** staff, ordered `active DESC`, with `active` (`:1485-1507`). The pickers: (a) the bulk 指派代理 picker lists every agent (`admin.leads.tsx:1060-1064`); (b) the detail 負責代理 picker lists every agent, suffixed （停用） (`:1466-1473`); (c) the forward dialog receives every agent **forced to `active: true`** (`:1220`), so the form's own `.filter((agent) => agent.active)` (`ForwardedEnquiryForm.tsx:268-269`) is defeated, although the SQL refuses an inactive owner (`20260929107000…:21-23`); (d) the 負責代理 **filter** (`:910-925`) is a filter, not an assignment. | as listed |
| 10 | **The inbound-lead trigger** `ensure_whatsapp_inbound_lead` fires `AFTER INSERT OR UPDATE OF contact_id,direction ON whatsapp_messages`. For an inbound message with a contact, it takes `pg_advisory_xact_lock('whatsapp-lead:'||contact_id)` and inserts a `new/unknown/whatsapp` lead **only when the contact has no lead at all** (`NOT EXISTS (… l.contact_id=c.id)`). It copies `c.assigned_agent_id` without checking that the agent is active. So a contact whose leads are all `closed_won`/`closed_lost` never gets a new lead (C-10). **It never touches `whatsapp_conversations`.** The migration also ran a one-time history reconcile (`:26-31`). No later migration redefines the function (`grep ensure_whatsapp_inbound_lead neon/migrations` → one file). | `neon/migrations/20260906100000_whatsapp_inbound_leads.sql:1-31` |
| 11 | **Closed conversations stay closed.** Ingest's `updated_conversation` sets `contact_id`, `channel_id`, `last_message_at = GREATEST(…)`, `last_inbound_at = GREATEST(…, $6)` and `updated_at`. It does **not** set `status` (C-10). Status values are `open`, `pending` and `closed` (`admin.whatsapp.tsx:72,91`). Staff set them through `updateAdminConversation` (`admin-data.server.ts:3112-3153`), and the live agent sets `pending` (`live-agent.server.ts:285`). | `src/lib/woztell/woztell-ingest.server.ts:197-202` |
| 12 | **The trigger cannot see the event origin.** `history_import` (`history-import.server.ts:69-73`) and `live_webhook` both insert `whatsapp_messages` through the same statement. The message carries its provider timestamp in `created_at` (`$8`). Within that statement, `last_inbound_at` is already `GREATEST(old,$6)` when the AFTER ROW trigger runs. So an imported **older** message sees `last_inbound_at > NEW.created_at`. No production code updates `whatsapp_messages.contact_id` today (grep). | `woztell-ingest.server.ts:174-235` |
| 13 | **Ingest overwrites the staff-edited name** with `name=COALESCE($3,c.name)`, where `$3 = event.memberName` (`woztell.server.ts:318`, `memberExtra.name`). That applies to live **and** history import. Every other writer keeps staff input: `COALESCE(c.name,$x)` in `website-inquiry.js:72,90` and `live-agent.server.ts:220,233`. New contacts get `name=$3` (`:193-194`). There is no profile-name column. | `woztell-ingest.server.ts:188,193-194,236-251` |
| 14 | **How errors reach the UI.** A thrown `Response` resolves on the client, and `callStaffServerFn` turns it into `ServerFnResponseError(message=body text, status)`. The UI shows `errorText(err)` (the body) in a toast (`admin.leads.tsx:705-707`, `:1973-1977`). The bulk path maps `result.error` codes through `bulkErrorLabels` (`:126-130`, `:565`). | `src/lib/neon/server-fn-response.ts:31-58`; `admin-data.ts:377-393` |
| 15 | **Browser fixture.** `/admin/leads` renders in the **daily-work** fixture (`scripts/browser-fixtures/daily-work/`, built by `build-admin-daily-work.mjs`, which aliases `@/lib/neon/admin-data` to `daily-work/synthetic-api.ts`). Its `fetchAdminLead` and `updateAdminLead` (`synthetic-api.ts:135-185`) are in-window stubs: `updateAdminLead` records `leadUpdates` and returns `{ok:true}`. Window state is **per tab**, so two tabs cannot see each other's saves today. `e2e/admin-daily-work.spec.ts:336-342` asserts `leadUpdates[0]` with `toMatchObject` (an extra field is harmless). Run by `test:admin-daily-work:ui` (`package.json:117`, CI `ci.yml:80`). | as listed |
| 16 | **Tests that pin today's behaviour.** `src/lib/neon/whatsapp-leads.db.test.mjs:43-139` applies **only** `20260906100000…` in a scratch schema and asserts "closed_won contact + inbound → still 1 lead". It runs only with `ASTRA_TEST_DATABASE_URL` (skipped in CI) and does not apply the new migration, so it stays green and documents the old file. `crm-note-save.test.ts:4-8` slices `admin.leads.tsx` between `  async function addNote()` and `  async function markStage(`, and runs that text with injected ports. | as listed |
| 17 | **Hand-made schemas that run ingest.** These break once ingest writes `whatsapp_profile_name`: `src/lib/whatsapp-enquiries/inbound-identity.db.test.mjs:146-170` (PGlite, CI via `test:no-link`) and `workflow.db.test.mjs:94` (Neon only). `staff-notifications.db.test.mjs:89` is Neon only and is rewritten by #225: **do not edit it.** | as listed |
| 18 | **Migration manifest.** It has 85 entries (`ls neon/migrations/*.sql \| wc -l` = 85), order enforced by `migration-versions.test.mjs`. Pinned counts: `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23` (`85`). The runner reads `neon/migrations` non-recursively (`scripts/neon/apply-migrations.mjs:27-28`), splits on `;` outside quotes and dollar tags, and wraps each file in one transaction (`:103-140`). `neon/reverts/` does not exist on main; #226 creates it. | `src/lib/control-plane/migration-versions.js` |

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real number.
  - Owned DB tests mock `globalThis.fetch` to throw and delete `OPS_EVENT_WAKE_ENABLED` (FX-06 test header). Nothing talks to WozTell, Neon production or a model.
  - Synthetic data only, on owned Postgres. Use ids `79000000-0000-4000-8000-…` and member ids `synthetic-fx09-…`.
  - **No production calls.** Production admin is read-only unless the owner names a record.
- **Concurrency token (FX-05b lesson).**
  - The version is generated **only** by `leadVersionSql(alias)`, and compared with the same expression under `FOR UPDATE`.
  - It is never passed through `new Date`, `rowDate`, `dateOrNull` or `toISOString`, on the server or the client.
  - A contract test (Task 1) fails if `admin-data.server.ts` maps `version` through any date helper, or if `admin.leads.tsx` calls `Date` on it.
  - Every concurrency test reads the version through `fetchAdminLead`. **None hand-builds a token.**
- **Review focus 6.** A staff member's own consecutive saves must both succeed. The save response returns the new version, and the UI stores it in `detail` immediately, before the list and detail refresh.
- **Migrations.**
  - Each is idempotent.
  - The first statement is `SET LOCAL lock_timeout = '5s';`.
  - plpgsql goes inside `$$`.
  - **No `;` and no `'` inside any comment**, because `apply-migrations.mjs` splits on `;`. The zh-HK note literal inside the function body uses the full-width `；`, which is not a separator.
  - The revert lives in `neon/reverts/` and is applied by hand inside `BEGIN … COMMIT`. A test proves the runner and the drift check ignore it.
  - **No existing row is rewritten.** Neither migration runs an UPDATE or INSERT on existing data. The profile-name backfill and the closed-contact lead backfill are Open questions, and both default to *no*.
  - **The string `lead.staff.alert` appears nowhere in FX-09**: not in migrations, reverts, source or comments. #225's `lead-alert.contract.test.mjs` scans `neon/migrations` for it.
- **Owned Postgres tests.**
  - One `withOwnedPostgres` container per file.
  - A test that sets `session_replication_role` does it on one dedicated `pool.connect()` client and resets it to `origin` in `finally`. FX-09 does not need it; the trigger tests use real ingest.
  - Every new test file is named in a `test:*` script that CI runs, so `src/test-wiring.test.mjs` stays green.
- **Configuration.** No new env var. No `VITE_*`.
- **Copy.** All new UI text is zh-HK (copy table in Task 3). Reuse the shadcn primitives: `Alert`/`AlertTitle`/`AlertDescription` (`src/components/ui/alert.tsx`), `Button`, `Select*`, `Badge`, and `sonner` `toast`. No brand or marketing copy changes.
- **Roles.** The behaviour stays as today: `requireStaff(["admin","manager","agent"])`. Agents remain scoped to their own leads (`agentScope`) inside the locked CTE.
- **Avoid conflicts with open PRs.** Diffs were taken with `git diff HEAD...origin/<branch> --stat` against `4965d48`. The local `main` ref is stale, so use `HEAD` or `origin/main`.

  | PR | Branch | Overlap with FX-09 | Rule |
  |---|---|---|---|
  | #221 | `fix/fx-01-public-form-feedback` | `playwright.admin-owned.config.ts:14-15` (appends); `package.json:35,121-122`; `ci.yml:83-84` | Insert the new spec **after `:11`** (`"admin-daily-work.spec.ts",`), not at the end. Put the new scripts after `package.json:113`. Put the CI UI line after `ci.yml:80`. |
  | #222 | `fix/fx-03-live-agent-handoff` | `admin.leads.tsx:28-29` (import), `:1622-1624` (transcript); end of `admin-data.server.ts` (`:3813+`), `admin-data.ts` (`:1820+`) and `admin-data.types.ts` (`:639+`); `no-link/synthetic-api.ts:535`; `live-agent.server.ts` (adds `UPDATE crm_leads … SET contact_id=r.id, updated_at=now()` at its `:507-508`) | **Never append at end of file** in the three `admin-data*` files. New `admin.leads.tsx` imports go after `:60`. Do not touch `:1600-1640`. The Task 1 contract test must accept #222's new `UPDATE crm_leads` (it bumps). Re-run that test after rebasing onto #222. |
  | #223 | `fix/fx-04-admin-attention` | `admin.leads.tsx:82-84` (import) and **`:903-904`** (stage filter); `admin-data.server.ts:983-1080`; `admin-data.ts:394-450,653-700`; `admin-data.types.ts:593-610`; `no-link/synthetic-api.ts:75-260,593+`; `package.json:39` (**`test:command-center`**) and `:117` (**`test:admin-daily-work:ui`**); `playwright.admin-owned.config.ts:14-15`; `e2e/admin-daily-work.spec.ts:115,536-672`; `admin.routes.test.mjs` | **Do not edit `package.json:39` or `:117`.** Do not edit `e2e/admin-daily-work.spec.ts` or `admin.routes.test.mjs`. Do not touch `admin.leads.tsx:880-930`. Edit `daily-work/synthetic-api.ts` only (#223 does not touch it), not `no-link/synthetic-api.ts`. |
  | #224 | `fix/fx-05a-ui-flags` | `package.json:15`; `build-admin-daily-work.mjs:23-26` | Do not edit the fixture build script. |
  | #225 | `fix/fx-05b-lead-alert` | `migration-versions.js:123`; the two pinned counts; `package.json:15,94,124-125`; `ci.yml:157-158`; `staff-notifications.db.test.mjs` (rewritten); `admin-data.server.ts:3692-3712`; `website-inquiry.js`; **`lead-alert.contract.test.mjs`** (forbids `lead.staff.alert` outside its allowlist) and **`lead-alert.owned.db.test.mjs:1365-1470`** (asserts the WhatsApp trigger creates a lead with **no** job: "FX-09 must flip this deliberately") | FX-09 must **not** flip it (owner decision 2). Append FX-09's manifest entries after the last entry. On rebase, keep the list sorted: `…20261006110000…`, `…20261007100000…`, `…20261008100000…`, `…20261008110000…`, `20261009100000…`, `20261009110000…`. Do not edit `staff-notifications.db.test.mjs`. The FX-09 CI DB line goes after `ci.yml:145`, not near `:157`. |
  | #226 | `fix/fx-06-manager-wa-access` | Creates `neon/reverts/`; `migration-versions.js:123`; counts; `package.json:124-125`; `ci.yml:157-158` | Create `neon/reverts/20261009110000_inbound_lead_reopen_revert.sql`. If #226 merged first, the folder already exists. Copy its runner and drift-ignore test pattern, not its file. |
  | #227 | `fix/fx-07-jobs-drain` | No overlap (ops, worker, `no-link-local-postgres.test.mjs:1` only) | None. |
  | #228 | `fix/fx-08-optout-unknown` | **`woztell-ingest.server.ts:186-198` (rewrites `updated_contact` and `new_contact`, inserting an `opt_out` CTE before `:187`) and `:240`**; `inbound-identity.db.test.mjs:151`; `workflow.db.test.mjs:94`; `migration-versions.js:123`; counts; `admin-data.server.ts:99-100,2953-3070`; `admin-data.ts:1469+`; `no-link/synthetic-api.ts:305`; `package.json:80-81`; `ci.yml:103-104,149-151` | **The overlap at ingest `:188`, `:193-194` cannot be avoided**: both batches edit the `updated_contact` SET list and the `new_contact` column list. Minimise it as follows. (1) Change **only** the `name=…` term on `:188` and **append** one term; touch nothing else on `:189-191`. (2) In `new_contact`, **append** `whatsapp_profile_name` as the **last** column and `$3` as the last value; do not reorder. (3) Add the new param as **`$16`, appended after `:250`**, never renumbering `$1–$15`. **Rebase recipe if #228 lands first:** take #228's block verbatim, then re-apply exactly those three edits on top. In #228's `new_contact` SELECT, the values come `FROM opt_out o`, so append `,$3` after its last `CASE … END`. In the two hand-made schemas, **do not edit #228's lines**: add a separate `ALTER TABLE crm_contacts ADD COLUMN whatsapp_profile_name text` statement (Task 4 anchors). |

  **Pinned migration counts.** FX-09 alone: 85 + 2 = **87**. After #225, #226 and #228: **91**. On every rebase, set both pins to `ls neon/migrations/*.sql | wc -l`. FX-09's own tests assert `MIGRATION_VERSIONS.includes(<file>)`, not a count.
- **Do not touch** `addNote` (`admin.leads.tsx:713-758`) or the text between `  async function addNote()` and `  async function markStage(`. `crm-note-save.test.ts` executes that slice with fixed ports (fact 16).
- **Committing.**
  - `git add <paths>` only. Never add `bun.lockb`, which is already dirty in this worktree.
  - Use conventional commits with a scope, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its listed suites.
  - Owned suites need Docker and `docker pull pgvector/pgvector@sha256:d2ef61f4…` (`ci.yml:143`).
  - The PR as a whole also passes:
    - `npm run build`;
    - every `playwright.admin-owned.config.ts` suite;
    - `npm run test:command-center`;
    - `npm run test:admin-daily-work:ui`;
    - before/after screenshots of the lead panel at 375 px and 1440 px (Task 3).

## Review Focus

These are the five likeliest failure modes that no fix-plan test covers. Each has a named test in its owning task.

1. **Self-409 from token precision or from a no-op save** (fix-plan Review focus 6, and the FX-05b lesson). Three ways it can happen: the version loses microseconds on the way through JS; or the UI keeps the pre-save version; or a second click with no edits bumps the version and the first click's response is applied late. *Test (Task 1):* `a version read through fetchAdminLead with non-zero microseconds saves twice in a row, and a no-op save keeps the version`. *E2E (Task 3):* `own consecutive saves both succeed and the version advances each time`.
2. **A background writer that does not bump the version silently undoes a reassignment.** Staff handover does exactly this today (fact 8). The opposite failure is a writer that bumps when it changed nothing, giving spurious 409s. *Test (Task 1):* `writers that change a lead bump its version, writers that do not leave it alone`. Staff handover bumps, so a stale editor gets 409. A note, a contact edit and a new inbound message on an open lead leave the version unchanged, and the save succeeds. A contract test covers every `UPDATE crm_leads`.
3. **History import or an identity merge creates leads for long-closed contacts, or reopens conversations that staff closed on purpose.** The trigger cannot see the event's origin (fact 12). *Test (Task 5):* `history import and identity merges never create a lead or reopen a conversation for old messages`.
4. **The inactive-staff rule blocks normal work.** A stage-only save on a lead still owned by a deactivated agent must not fail with `ASSIGNEE_INACTIVE`, and neither must "unassign". *Tests:* (Task 1) `a lead owned by a deactivated agent can still be re-staged, and only a new assignment to inactive staff is refused`; (Task 2) `bulk re-stage and bulk unassign still work when the owner is inactive`.
5. **A client without a version is treated as a blind overwrite.** This happens with a browser tab still running the pre-deploy bundle, or with a fixture or caller that omits the field. *Test (Task 1):* `a save without a valid version is refused with 400 and writes nothing` (missing, `""`, a millisecond ISO string, `null`).

## Out of scope / follow-ups

| Follow-up | Owner | What it must do |
|---|---|---|
| **New WhatsApp lead alerts (owner decision 2)** | FX-05b follow-up, after #225 merges | After #225 merges, the trigger adds `INSERT INTO ops_jobs(...'lead.staff.alert'...) ON CONFLICT (idempotency_key) DO NOTHING` for a lead it just created, never in history reconcile, and the ingest caller wakes the general lane. In practice that means: a new trigger-replace migration plus a revert; widen #225's `lead-alert.contract.test.mjs` allowlist to that migration; flip #225's "FX-09 must flip this deliberately" assertion; **never** enqueue for leads created by the first-lead path during `history_import`. Since the trigger cannot see origin, gate it on the same "newer than `last_inbound_at`" rule as the reopen, or move the enqueue into ingest's statement keyed on `origin='live_webhook'`. Ingest calls `wakeAfterCommit("general")` when that statement reports a queued job. |
| Show `whatsapp_profile_name` next to the CRM name (「WhatsApp 名稱：…」) | FX-18c | Display only. FX-09 adds and fills the column. |
| Version guard on contact edits (`wa_update_lead_contact`) | FX-18 | Contact name and email edits are still last-write-wins between two staff members. FX-09 only stops ingest from overwriting them. |
| Bulk update shows which rows another colleague just changed | FX-17 | Bulk stays "explicit fields, applied to the current rows" (Open question 6). |
| Audit rows for trigger-created leads and trigger reopens | FX-18 (audit trail) | FX-09 keeps the current trigger style (no audit). `crm_leads.created_at` and `whatsapp_conversations.updated_at` are the evidence. |
| Reopening WhatsApp **enquiry episodes** (`inquiries.status`) | Not needed | Episodes have their own reopen logic. FX-09 touches only `whatsapp_conversations.status`. |
| Assignee role check (viewers listed in pickers) | FX-17 | FX-09 filters by `active` only. |

---

### Task 1: Lead version token, guarded single-lead save with before/after audit, and handover bump (no migration)

**Files:**
- **Create `src/lib/neon/lead-version.ts`.** It is pure, with no `server-only`, so the client and fixture can import it.
- **Modify `src/lib/neon/admin-data.server.ts`:**
  - `:2382-2463` (`fetchAdminLead`): add `${leadVersionSql("l")} AS version` to the SELECT list after `l.preferred_estates,`, and `version: stringOrEmpty(lead.version),` to the returned object after `contact_id`. **Never** `rowDate`.
  - `:2561-2599` (`updateAdminLead`): replace the body (interface below). Remove the trailing `writeAudit` call; the audit is inside the statement.
  - Add `console.warn("LEAD_CHANGED", { leadId: input.id })` before the 409 throw. It carries the id only, no PII, and gives the canary a conflict rate.
- **Modify `src/lib/neon/admin-data.types.ts`:**
  - `:342-346` (`AdminLeadDetail`): add `version: string`.
  - `:358-367` (`AdminLeadUpdateInput`): add `expected_version: string`.
  - Directly after `:367`, add `AdminLeadField` and `AdminLeadUpdateResult` (below).
- **Modify `src/lib/neon/admin-data.ts:1335-1337`:** set the return type to `Promise<AdminLeadUpdateResult>`. The validator stays pass-through, because the server validates.
- **Modify `src/lib/neon/staff-ownership.ts:98-115`.** Add a `crm_leads` branch: `UPDATE crm_leads SET assigned_agent_id = $2::uuid, updated_at = GREATEST(now(), updated_at + interval '1 microsecond') WHERE assigned_agent_id = $1::uuid`. The existing regex test at `staff-ownership.test.mjs:31-52` still matches.
- **Modify `src/lib/neon/admin-transactions.contract.test.mjs:492-536`.**
  - Add `expected_version: "2026-10-06T00:00:00.000001Z"` to both bases.
  - Change `/UPDATE crm_leads SET/` to `/UPDATE crm_leads l SET/`.
  - Change the param indexes to match the new param order (`params[2]`, `params[3]` stay budget).
  - The empty recorder still yields `{ ok: false, error: "Not found" }`.
- **Create `src/lib/neon/lead-version.test.ts`** (bun) and **`src/lib/neon/lead-version.contract.test.mjs`** (node).
- **Create `src/lib/neon/lead-integrity.owned.db.test.mjs`**, the fix-plan file. It is one container; Tasks 2, 4 and 5 add subtests to it.
- **Modify `package.json`.** Insert after `:113` (`test:operations:ui`), in this order:
  ```
  "test:lead-integrity": "node --test src/lib/neon/lead-version.contract.test.mjs && bun test --no-env-file src/lib/neon/lead-version.test.ts",
  "test:lead-integrity:db": "node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/neon/lead-integrity.owned.db.test.mjs",
  ```
  Tasks 2 and 3 extend `test:lead-integrity` and add `test:admin-lead-conflict:ui`.
- **Modify `.github/workflows/ci.yml`:**
  - insert `- run: npm run test:lead-integrity` after `:99` (`test:command-center`);
  - insert `- run: npm run test:lead-integrity:db` after `:145` (`test:admin-golden:db`).

**Interfaces:**
```ts
// src/lib/neon/lead-version.ts
/** Exact UTC microsecond token, e.g. "2026-10-06T03:04:05.123456Z". Opaque: compare as a string only. */
export const LEAD_VERSION_PATTERN: RegExp; // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
/** `to_char(<alias>.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. alias must match /^[a-z_]+$/ or it throws. */
export function leadVersionSql(alias: string): string;
export function isLeadVersion(value: unknown): value is string;
export const LEAD_CHANGED = "LEAD_CHANGED";
export const LEAD_VERSION_REQUIRED = "LEAD_VERSION_REQUIRED";
export const ASSIGNEE_INACTIVE = "ASSIGNEE_INACTIVE";

// admin-data.types.ts
export type AdminLeadField =
  | "stage" | "intent" | "budget_min" | "budget_max" | "preferred_estates" | "assigned_agent_id" | "note";
export type AdminLeadUpdateResult =
  | { ok: true; version: string; changed: AdminLeadField[] }
  | { ok: false; error: "Not found" };

// admin-data.server.ts
export async function updateAdminLead(
  input: AdminLeadUpdateInput, // now includes expected_version
  actor: StaffAccess,
): Promise<AdminLeadUpdateResult>;
// Order of checks:
// 1. leadBudgetError → 400 (unchanged).
// 2. !isLeadVersion(input.expected_version) → throw new Response(LEAD_VERSION_REQUIRED, { status: 400 }); no SQL.
// 3. One statement ($1 stage … $7 note, $8 id, $9 expected_version, $10 actor, [$11 agent scope]):
//    WITH old AS (SELECT l.*, <leadVersionSql('l')> AS version FROM crm_leads l
//                 WHERE l.id=$8::uuid [AND l.assigned_agent_id=$11::uuid] FOR UPDATE),
//    assignee AS (SELECT ($6::uuid IS NULL OR $6::uuid IS NOT DISTINCT FROM o.assigned_agent_id
//                   OR EXISTS(SELECT 1 FROM staff_users s WHERE s.id=$6::uuid AND s.active)) AS ok FROM old o),
//    upd AS (UPDATE crm_leads l SET stage=$1::crm_lead_stage, intent=$2, budget_min=$3, budget_max=$4,
//              preferred_estates=$5::text[], assigned_agent_id=$6::uuid, note=$7,
//              updated_at=GREATEST(now(), o.updated_at + interval '1 microsecond')
//            FROM old o, assignee a
//            WHERE l.id=o.id AND o.version=$9 AND a.ok
//              AND (o.stage,o.intent,o.budget_min,o.budget_max,o.preferred_estates,o.assigned_agent_id,o.note)
//                  IS DISTINCT FROM ($1::crm_lead_stage,$2,$3::numeric,$4::numeric,$5::text[],$6::uuid,$7)
//            RETURNING l.*, <leadVersionSql('l')> AS version),
//    diff AS (SELECT b.k, b.v AS before, a.v AS after
//             FROM upd u, old o,
//               LATERAL jsonb_each(jsonb_build_object('stage',o.stage,'intent',o.intent,'budget_min',o.budget_min,
//                 'budget_max',o.budget_max,'preferred_estates',o.preferred_estates,
//                 'assigned_agent_id',o.assigned_agent_id,'note',o.note)) b(k,v)
//               JOIN LATERAL jsonb_each(jsonb_build_object(<same keys from u>)) a(k,v) ON a.k=b.k
//             WHERE a.v IS DISTINCT FROM b.v),
//    audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
//              SELECT $10::uuid,'lead.update','lead',u.id,jsonb_build_object(
//                'changed',(SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM diff),
//                'before',(SELECT COALESCE(jsonb_object_agg(k,before),'{}'::jsonb) FROM diff),
//                'after',(SELECT COALESCE(jsonb_object_agg(k,after),'{}'::jsonb) FROM diff),
//                'expectedVersion',$9::text,'version',u.version) FROM upd u RETURNING id)
//    SELECT o.version AS current_version, a.ok AS assignee_ok,
//           (SELECT version FROM upd) AS new_version,
//           (SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM diff) AS changed
//    FROM old o CROSS JOIN assignee a
// Mapping: no row → agent scope ? 403 : { ok:false, error:"Not found" } (unchanged);
//          current_version !== $9 → console.warn + throw new Response(LEAD_CHANGED, { status: 409 });
//          !assignee_ok → throw new Response(ASSIGNEE_INACTIVE, { status: 400 });
//          else → { ok:true, version: new_version ?? current_version, changed }.
```

- [ ] **Step 1: write the failing tests.**
  - `lead-version.test.ts` (bun):
    - `leadVersionSql emits the exact to_char expression and rejects unsafe aliases`. `leadVersionSql("l")` equals the expected string; `leadVersionSql("l; drop")` throws.
    - `isLeadVersion accepts only the microsecond UTC form`. True: `2026-10-06T03:04:05.123456Z`. False: `2026-10-06T03:04:05.123Z`, `2026-10-06T03:04:05Z`, `""`, `null`, `undefined`, `1696561445123`.
  - `lead-version.contract.test.mjs` (node, reads sources):
    - `every UPDATE of crm_leads bumps updated_at`. It scans non-test `src/**/*.{ts,tsx,js,mjs}` and `neon/migrations/*.sql` for each `UPDATE crm_leads` and slices up to the next `RETURNING`, `WHERE` or `;`. Every slice contains `updated_at`. The `crm_leads` statement from `staffReassignStatements("a","b")` contains `updated_at`. The failure message names fact 8 and Review Focus 2.
    - `no non-lead writer touches crm_leads`. `src/lib/ai/crm-enrichment.server.ts` and `src/lib/neon/whatsapp-consent.server.ts` contain no `UPDATE crm_leads`.
    - `the version is never parsed as a date`. In `admin-data.server.ts`, the `version:` mapping in `fetchAdminLead` uses `stringOrEmpty`, and no `rowDate(`, `dateOrNull(` or `new Date(` appears on a line containing `version`. `src/routes/admin.leads.tsx` has no `new Date(` or `Date.parse(` on a line containing `version`.
  - `lead-integrity.owned.db.test.mjs`:
    - **Header.** Mock `fetch` to throw. Seed one admin, one manager, agents A and B (active), agent C (`active=false`), a viewer, one contact and lead L1 (`assigned_agent_id=A`, stage `contacted`). Then `UPDATE crm_leads SET updated_at='2026-10-06 01:02:03.123456+00' WHERE id=L1`, so that every test starts with non-zero microseconds. That UPDATE is test setup, not a hand-built token: the token is always read back through `fetchAdminLead`.
    - `stale expected_updated_at → 409` (fix-plan name):
      1. The manager reads v1 through `fetchAdminLead`. The admin reads the same v1.
      2. The admin saves `assigned_agent_id=B` with v1. It succeeds and returns v2 ≠ v1.
      3. The manager saves stage `viewing` with v1. It rejects with a `Response` of status 409 and body `LEAD_CHANGED`.
      4. The row still has `assigned_agent_id=B` and stage `contacted`. There is exactly 1 `lead.update` audit row.
    - `own consecutive saves succeed` (fix-plan name; fix-plan Review focus 6):
      1. Read v1 through `fetchAdminLead`.
      2. Save note "一" with v1. It returns v2.
      3. Save note "二" with **v2 from the response**. It returns v3.
      4. Then `fetchAdminLead().version === v3`, and v1 < v2 < v3 as strings.
    - `a version read through fetchAdminLead with non-zero microseconds saves twice in a row, and a no-op save keeps the version` (Review Focus 1):
      - `fetchAdminLead(L1).version` ends `.123456Z`.
      - Saving with it succeeds.
      - Saving the identical draft again with the returned version gives `{ok:true, version: <same>, changed: []}`, and adds no audit row.
      - Saving the identical draft a third time with the **original** v1 → 409. The lead did change since v1, so this is correct.
    - `audit has before/after assigned_agent_id` (fix-plan name):
      - A→B as the manager.
      - The audit row has `actor_id=manager`, `subject_id=L1` and `metadata.changed` deep-equal to `["assigned_agent_id"]`.
      - `before.assigned_agent_id=A`, `after.assigned_agent_id=B`, `expectedVersion=v1`, `version=v2`.
      - `before` has no `stage` key.
      - A second save changing stage and note gives `changed` = `["note","stage"]`.
    - `writers that change a lead bump its version, writers that do not leave it alone` (Review Focus 2):
      1. Read v.
      2. `createAdminLeadActivity` (a note): the version is unchanged.
      3. `wa_update_lead_contact(manager, L1, '陳太', null)`: unchanged.
      4. Ingest a live inbound message for L1's contact through `ingestWoztellEvent` (the contact has an **open** lead): unchanged, and the lead count is unchanged.
      5. Saving with v succeeds and returns v′.
      6. Then run `transaction(staffReassignStatements(B, A))` (handover): the version changes, and saving with v′ → 409.
    - `a lead owned by a deactivated agent can still be re-staged, and only a new assignment to inactive staff is refused` (Review Focus 4):
      - Lead L2 is owned by A. Set `A.active=false`.
      - Stage-only save (assignee A unchanged): ok.
      - Assign L2 → C (inactive): 400 `ASSIGNEE_INACTIVE`, no write, no audit.
      - Assign → `null`: ok.
      - Assign → B: ok.
    - `a save without a valid version is refused with 400 and writes nothing` (Review Focus 5). For `expected_version` set to `undefined`, `""`, `null`, `"2026-10-06T01:02:03.123Z"` and `1696561445123`: each rejects with status 400 and body `LEAD_VERSION_REQUIRED`. Row, version and audit count are unchanged.
    - `agent scope is unchanged`. Agent B saving A's lead with the right version → 403. An admin saving a random uuid → `{ok:false,error:"Not found"}`.
  - Run `npm run test:lead-integrity` and `npm run test:lead-integrity:db`. They must fail (no `version`, no 409).
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:lead-integrity`
  - `npm run test:lead-integrity:db`
  - `npm run test:transactions`
  - `npm run test:property-experience` (staff-ownership)
  - `npm run test:command-center`
  - `npm run test:control-plane` (test-wiring)
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(leads): reject stale lead saves with 409 LEAD_CHANGED and audit before/after of changed fields

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: Inactive staff: bulk assignment is refused on the server; pickers show active staff only

**Files:**
- **Modify `src/lib/neon/admin-data.server.ts:2636-2664`** (`bulkUpdateAdminLeads`, after the guard returns at `:2627-2634`). The statement becomes:
  ```sql
  WITH assignee AS (
    SELECT (NOT $4::boolean OR $5::uuid IS NULL
            OR EXISTS(SELECT 1 FROM staff_users s WHERE s.id=$5::uuid AND s.active)) AS ok
  ), updated AS (
    UPDATE crm_leads SET
      stage = CASE WHEN $2::boolean THEN $3::crm_lead_stage ELSE stage END,
      assigned_agent_id = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_agent_id END,
      updated_at = GREATEST(now(), updated_at + interval '1 microsecond')
    WHERE id = ANY($1::uuid[])${scope ? " AND assigned_agent_id = $6" : ""} AND (SELECT ok FROM assignee)
    RETURNING id::text AS id
  )
  SELECT (SELECT ok FROM assignee) AS assignee_ok, COALESCE(array_agg(id), '{}') AS ids FROM updated
  ```
  When `assignee_ok` is false, throw `new Response(ASSIGNEE_INACTIVE, { status: 400 })` **before** `writeAudit`. Otherwise keep the `lead.bulk_update` audit and the return value. Keep the literal `WHERE id = ANY($1::uuid[])` (`admin.routes.test.mjs:524`).
- **Create `src/lib/admin/lead-assignment.ts`** and **`src/lib/admin/lead-assignment.test.ts`** (bun).
- **Modify `src/routes/admin.leads.tsx`:**
  - After `:60`: `import { assignableAgents, bulkAssignableAgents } from "@/lib/admin/lead-assignment";`.
  - `:126-130` (`bulkErrorLabels`): add `ASSIGNEE_INACTIVE` (copy table).
  - `:583-584`: `toast.error(bulkErrorLabels[errorText(err)] ?? errorText(err))`.
  - `:1060-1064`: iterate `bulkAssignableAgents(agents)`.
  - `:1466-1473`: iterate `assignableAgents(agents, lead.assigned_agent_id)`, and render the suffix 「（已停用，請改派）」 when `inactiveCurrent`.
  - `:1220`: pass `active: agent.active` instead of `active: true`. The form's existing filter then works (fact 9c).
- **Modify `package.json` `test:lead-integrity`:** append `src/lib/admin/lead-assignment.test.ts` to its `bun test` list.

**Interfaces:**
```ts
// src/lib/admin/lead-assignment.ts
import type { AdminAgentRow } from "@/lib/neon/admin-data.types";
/** Active agents, plus the current assignee when inactive (flagged) so the Select still shows the value. Order preserved. */
export function assignableAgents(
  agents: readonly AdminAgentRow[],
  currentAssigneeId: string | null,
): { agent: AdminAgentRow; inactiveCurrent: boolean }[];
/** Bulk targets: active agents only. */
export function bulkAssignableAgents(agents: readonly AdminAgentRow[]): AdminAgentRow[];
```

- [ ] **Step 1: write the failing tests.**
  - `lead-assignment.test.ts`:
    - `detail picker lists active staff plus the inactive current owner, flagged`. Input [A active, C inactive, D inactive] with current C gives [A, C(flag)]. With current A it gives [A]. With current `null` it gives [A].
    - `bulk picker lists active staff only`.
  - `lead-integrity.owned.db.test.mjs`:
    - `bulk assign to inactive staff → 400` (fix-plan name). `bulkUpdateAdminLeads({ids:[L3,L4], assignAgent:true, assigned_agent_id:C})` rejects with status 400 and body `ASSIGNEE_INACTIVE`. Both leads are unchanged (owner and version), and there are 0 new `lead.bulk_update` audit rows.
    - `bulk re-stage and bulk unassign still work when the owner is inactive` (Review Focus 4). With the owner A deactivated: a stage-only bulk → `updated:2`; `assignAgent:true, assigned_agent_id:null` → `updated:2`; assigning to B → `updated:2`. Each changes the version.
    - `bulk update bumps the version so an open editor gets 409`. Read v through `fetchAdminLead(L3)`, bulk re-stage, then save with v → 409.
  - Run `npm run test:lead-integrity` and `npm run test:lead-integrity:db`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:lead-integrity`
  - `npm run test:lead-integrity:db`
  - `npm run test:command-center` (`admin.routes.test.mjs` bulk assertions)
  - `npm run test:admin-daily-work:ui`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(leads): refuse assigning leads to deactivated staff and hide them from assignment pickers

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: The lead editor sends the version, stores the new one, and shows the conflict (UI + two-tab e2e)

**Files:**
- **Create `src/lib/admin/lead-save-errors.ts`** and **`lead-save-errors.test.ts`** (bun).
- **Create `src/components/admin/leads/LeadConflictNotice.tsx`** and **`LeadConflictNotice.test.tsx`** (bun, `renderToStaticMarkup`).
- **Modify `src/routes/admin.leads.tsx`** at these anchors only:
  - After `:60`: imports for `LeadConflictNotice`, `isLeadChangedError` and `leadSaveErrorMessage`.
  - After `:271`: `const [conflictLeadId, setConflictLeadId] = useState<string | null>(null);`.
  - `loadLeadDetail` (`:405-447`): on success, `setConflictLeadId(null)`.
  - `handlePanelOpenChange(false)` (`:603-618`): also `setConflictLeadId(null)`.
  - `saveLead` (`:653-711`):
    - `:695`: `updateAdminLead({ data: draftToInput(targetLeadId, nextDraft, detail.version) })`.
    - After `assertNoMutationError(result)` (`:697`), and **before** `refreshLeads()`: `setDetail((current) => current?.id === targetLeadId ? { ...current, version: result.version } : current)`.
    - In `catch` (`:705-707`): if `isLeadChangedError(err)`, run `setConflictLeadId(targetLeadId)` and `toast.error(LEAD_CHANGED_MESSAGE)`, and **do not** touch `draft`. Otherwise `toast.error(leadSaveErrorMessage(err))`.
  - `:1175`: after `AdminError`, render `{conflictLeadId === detail?.id ? <LeadConflictNotice reloading={detailLoading} onReload={() => void loadLeadDetail(detail.id, { closeOnError: false })} /> : null}`.
  - `:1849-1860` (`draftToInput`): add a third parameter `expectedVersion: string` and the field `expected_version: expectedVersion`.
- **Modify `scripts/browser-fixtures/daily-work/synthetic-api.ts:135-185`** (no open PR touches this file):
  - Keep a shared version store in `localStorage` under key `fx09-lead-version:<id>`. Initial value `"2026-10-03T00:00:00.000001Z"`. Each save increments the microseconds.
  - Keep the last saved fields under key `fx09-lead-update:<id>`, so a reload in tab B sees tab A's save.
  - `fetchAdminLead` returns `version`.
  - `updateAdminLead` compares `data.expected_version`. On a mismatch it throws `new ServerFnResponseError("LEAD_CHANGED", 409)`, imported from `@/lib/neon/server-fn-response` (not aliased; not a server module). On a match it bumps, pushes to `leadUpdates`, and returns `{ ok: true, version, changed: [] }`.
  - **Do not** touch `no-link/synthetic-api.ts` (#223) or `build-admin-daily-work.mjs` (#224/#225).
- **Create `e2e/admin-lead-conflict.spec.ts`.** It copies the `beforeAll`/`afterAll` loopback server from `admin-daily-work.spec.ts:33-80`, and needs no edits to that file.
- **Modify `playwright.admin-owned.config.ts`:** insert `"admin-lead-conflict.spec.ts",` **after `:11`** (`"admin-daily-work.spec.ts",`).
- **Modify `package.json`:**
  - After the Task 1 lines (still after `:113`): `"test:admin-lead-conflict:ui": "playwright test --config playwright.admin-owned.config.ts e2e/admin-lead-conflict.spec.ts"`.
  - Append `src/lib/admin/lead-save-errors.test.ts src/components/admin/leads/LeadConflictNotice.test.tsx` to the `bun test` list of `test:lead-integrity`.
- **Modify `.github/workflows/ci.yml`:** insert `- run: npm run test:admin-lead-conflict:ui` after `:80`.

**Interfaces:**
```ts
// src/lib/admin/lead-save-errors.ts
export const LEAD_CHANGED_MESSAGE = "此客戶查詢已被其他同事更新，請重新載入後再儲存。";
/** status 409 and message LEAD_CHANGED. Duck-typed on { status, message } so the fixture's error counts too. */
export function isLeadChangedError(error: unknown): boolean;
/** LEAD_CHANGED, LEAD_VERSION_REQUIRED, ASSIGNEE_INACTIVE → zh-HK copy; otherwise the error's message. */
export function leadSaveErrorMessage(error: unknown): string;

// src/components/admin/leads/LeadConflictNotice.tsx
export function LeadConflictNotice(props: { reloading: boolean; onReload: () => void }): JSX.Element;
// <Alert variant="destructive" role="alert"> AlertTitle = LEAD_CHANGED_MESSAGE, AlertDescription = reload hint,
// <Button variant="outline" size="sm" disabled={reloading}>重新載入最新資料</Button>
```

**Copy table (zh-HK):**

| Key / place | Text |
|---|---|
| 409 `LEAD_CHANGED` (toast and notice title; fix-plan copy) | 此客戶查詢已被其他同事更新，請重新載入後再儲存。 |
| Notice description | 重新載入會以最新資料取代你未儲存的修改；已新增的跟進備註不會受影響。 |
| Notice button / while loading | 重新載入最新資料 / 載入中… |
| 400 `LEAD_VERSION_REQUIRED` | 頁面版本已過舊，請重新整理頁面後再儲存。 |
| 400 `ASSIGNEE_INACTIVE` (single and bulk) | 所選同事已停用，不能指派客戶查詢。請選擇其他同事。 |
| Detail picker suffix, inactive current owner | （已停用，請改派） |

- [ ] **Step 1: write the failing tests.**
  - `lead-save-errors.test.ts`:
    - `maps the three codes to zh-HK copy and passes other messages through`. Status 409 with `LEAD_CHANGED` → the fix-plan copy. A 409 with any other body is **not** a lead conflict. `new Error("x")` → `x`.
  - `LeadConflictNotice.test.tsx`:
    - `renders the fix-plan copy, the reload hint and an enabled reload button`.
    - `disables the button while reloading`.
  - `e2e/admin-lead-conflict.spec.ts`. One browser context and two pages, both on `/admin/leads?lead=40000000-0000-4000-8000-000000000001` as `actor-a` manager.
    - `two tabs: the second tab's stale save shows the zh-HK conflict message and keeps its draft` (fix-plan e2e):
      1. Tab A changes 負責代理 and clicks 儲存. The success toast appears.
      2. Tab B types 備註 「B 的修改」 and clicks 儲存.
      3. Tab B shows `role=alert` containing 此客戶查詢已被其他同事更新，請重新載入後再儲存。
      4. Tab B's 備註 field still reads 「B 的修改」, and the footer says 有未儲存的修改.
      5. `leadUpdates` in tab B has length 0.
    - `own consecutive saves both succeed and the version advances each time` (Review Focus 1). In tab A: edit, 儲存, then edit again and 儲存 again. Two success toasts and no alert. The `localStorage` version advanced twice. `lead-update` calls carry the two consecutive versions.
    - `after 重新載入最新資料 the second tab saves successfully`. Tab B clicks 重新載入最新資料. The alert disappears and the draft shows tab A's assignee. Tab B edits and saves: a success toast.
    - Capture screenshots of tab B's conflict state at 375 px and 1440 px into `.audit/remediation-20261003/`.
  - Run `npm run test:lead-integrity` and `npm run test:admin-lead-conflict:ui`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:lead-integrity`
  - `npm run test:admin-lead-conflict:ui`
  - `npm run test:admin-daily-work:ui` (the existing note and save journeys)
  - `npm run test:command-center` (`crm-note-save.test.ts`)
  - every `playwright.admin-owned.config.ts` suite
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`

  Then check that `git diff --stat src/routes/admin.leads.tsx` is **≤ 45 lines**, and that every hunk sits at an anchor listed above.
- [ ] **Step 4: commit.**
  ```
  feat(admin): send the lead version on save, keep the new one, and explain conflicts in zh-HK

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: `whatsapp_profile_name` (migration A), and ingest keeps the staff-edited name

**Files:**
- **Create `neon/migrations/20261009100000_contact_profile_name.sql`:**
  ```sql
  -- FX-09 / D-06. The WhatsApp profile name is stored apart from the CRM name
  -- that staff edit. Ingest keeps an existing CRM name and writes the profile
  -- name here instead. Additive and re-runnable. No existing row is written
  -- here, see the FX-09 plan Open question 1 about a backfill.
  -- Comments avoid semicolons and quotes because apply-migrations.mjs splits
  -- the file on them.
  SET LOCAL lock_timeout = '5s';
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS whatsapp_profile_name text;
  ```
  It needs no revert: the column stays (register).
- **Modify `src/lib/control-plane/migration-versions.js`:** append the file after the last entry (`:122`).
- **Modify the pinned counts** at `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23`: 85 → 86.
- **Modify `src/lib/woztell/woztell-ingest.server.ts`** (see the #228 rule in Global Constraints):
  - `:188`: replace `name=COALESCE($3,c.name),` with `name=COALESCE(c.name,$3),whatsapp_profile_name=CASE WHEN $16::boolean THEN COALESCE($3,c.whatsapp_profile_name) ELSE COALESCE(c.whatsapp_profile_name,$3) END,`.
  - `:193`: append `,whatsapp_profile_name` as the last column.
  - `:194`: append `,$3` as the last value.
  - After `:250`: append the param `origin === "live_webhook",` (`$16`).
- **Modify the hand-made schemas without touching #228's lines:**
  - `src/lib/whatsapp-enquiries/inbound-identity.db.test.mjs`: inside the `db.exec` template, after the `whatsapp_outbound_intents` table (`:166-170`), add `ALTER TABLE crm_contacts ADD COLUMN whatsapp_profile_name text;`.
  - `src/lib/whatsapp-enquiries/workflow.db.test.mjs`: add a new array element after `:97` (`CREATE TABLE whatsapp_messages…`): `` `ALTER TABLE crm_contacts ADD COLUMN whatsapp_profile_name text` ``.
- **Extend `lead-integrity.owned.db.test.mjs`.**

**Interfaces.** None new in TS. `ingestWoztellEvent`'s signature is unchanged. The SQL contract is above.

- [ ] **Step 1: write the failing tests** in `lead-integrity.owned.db.test.mjs`. Build events as in `src/lib/woztell/woztell.test.mjs`, with `normalizeWoztellEvent` and `memberExtra.name`. Call `ingestWoztellEvent(event, origin, undefined, { mode: "off", signedEvent: true })`.
  - `migration A is additive and re-runnable`:
    - The column exists, as `text`, nullable.
    - Running the file text again raises no error and leaves every row unchanged: compare `md5(string_agg(c::text, …))` before and after.
    - `MIGRATION_VERSIONS.includes("20261009100000_contact_profile_name.sql")`.
  - `inbound message keeps staff-edited name, stores profile name` (fix-plan name):
    1. Contact K with name `null`. A live inbound from 「Chan T」 sets `name='Chan T'` and `whatsapp_profile_name='Chan T'`.
    2. Staff run `wa_update_lead_contact(manager, lead, '陳太', null)`.
    3. A live inbound from 「Chan Tai」 leaves `name='陳太'` and sets `whatsapp_profile_name='Chan Tai'`.
  - `history import never replays an old profile name or overwrites the CRM name`:
    - `history_import` with 「Old Name」 on K leaves `name='陳太'` and `whatsapp_profile_name='Chan Tai'`.
    - On a new contact created by history, both columns are 「Old Name」.
    - When `memberName` is null, both columns are unchanged.
  - `a staff-cleared name is refilled from the profile name on the next message`. Clear K's name through `wa_update_lead_contact(…, '', null)`. The next live inbound sets `name='Chan Tai'`. This is documented behaviour (Open question 7).
  - `wrong recipient: a profile name never lands on another contact`. Two members, two contacts: an inbound from member 1 leaves contact 2 unchanged.
  - Run `npm run test:lead-integrity:db` and `npm run test:no-link`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:lead-integrity:db`
  - `npm run test:no-link` (PGlite ingest)
  - `npm run test:woztell`
  - `npm run test:control-plane` (manifest order)
  - `npm run test:no-link:local-postgres` (golden, unchanged)
  - `npm run test:admin-performance:db` and `npm run test:admin-link-bulk:db` (pins)
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): keep staff-edited contact names and store the WhatsApp profile name separately

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 5: The inbound-lead trigger creates a new lead after closure and reopens a closed conversation (migration B + revert)

**Files:**
- **Create `neon/migrations/20261009110000_inbound_lead_reopen.sql`:**
  ```sql
  -- FX-09 / C-10. Replaces ensure_whatsapp_inbound_lead_fn from
  -- 20260906100000_whatsapp_inbound_leads.sql. The trigger itself is unchanged.
  -- A contact with no lead still gets one, as before. On a new inbound message
  -- only, a contact whose leads are all closed_won or closed_lost gets a new lead
  -- when the message is newer than the latest closed lead update, and a closed
  -- conversation reopens when the message is at least as new as its last inbound.
  -- Older messages from history import or identity moves never do either.
  -- A new lead keeps the contact owner only while that staff member is active.
  -- No job is queued and no history reconcile runs here. No existing row is written.
  -- Rollback: neon/reverts/20261009110000_inbound_lead_reopen_revert.sql
  -- Comments avoid semicolons and quotes because apply-migrations.mjs splits
  -- the file on them.
  SET LOCAL lock_timeout = '5s';

  CREATE OR REPLACE FUNCTION ensure_whatsapp_inbound_lead_fn()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
  DECLARE has_any boolean; has_open boolean; latest_closed timestamptz; msg_at timestamptz;
  BEGIN
    IF NEW.direction::text <> 'inbound' OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-lead:' || NEW.contact_id::text, 0));
    msg_at := COALESCE(NEW.created_at, now());
    SELECT count(*) > 0,
           COALESCE(bool_or(l.stage NOT IN ('closed_won','closed_lost')), false),
           max(l.updated_at) FILTER (WHERE l.stage IN ('closed_won','closed_lost'))
      INTO has_any, has_open, latest_closed
      FROM crm_leads l WHERE l.contact_id = NEW.contact_id;
    IF NOT has_any OR (TG_OP = 'INSERT' AND NOT has_open AND msg_at > latest_closed) THEN
      INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)
      SELECT c.id, CASE WHEN s.active THEN c.assigned_agent_id END, 'new','unknown','whatsapp',
        'WhatsApp 入站查詢；詳情見對話紀錄。', msg_at, msg_at
      FROM crm_contacts c LEFT JOIN staff_users s ON s.id = c.assigned_agent_id
      WHERE c.id = NEW.contact_id;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.conversation_id IS NOT NULL THEN
      UPDATE whatsapp_conversations w SET status = 'open', updated_at = now()
       WHERE w.id = NEW.conversation_id AND w.status = 'closed'
         AND (w.last_inbound_at IS NULL OR msg_at >= w.last_inbound_at);
    END IF;
    RETURN NEW;
  END;
  $$;
  ```
  It contains **no** `ops_jobs`, **no** reconcile `INSERT … SELECT`, and no `DROP`/`CREATE TRIGGER`.
- **Create `neon/reverts/20261009110000_inbound_lead_reopen_revert.sql`.** It restores the function body from `20260906100000_whatsapp_inbound_leads.sql:7-19` **verbatim**, with no reconcile and no `LOCK TABLE`. The header follows FX-06's revert, with no `;` or `'` in comments: "lives outside neon/migrations on purpose, apply by hand inside BEGIN and COMMIT with owner approval, leaves the app_migrations row, re-apply the forward file by hand".
- **Modify `migration-versions.js`** (append) and the two pinned counts (86 → 87).
- **Extend `lead-integrity.owned.db.test.mjs`.**

**Interfaces.** The SQL above. No TS change.

- [ ] **Step 1: write the failing tests** in `lead-integrity.owned.db.test.mjs`. Seed the setup through real ingest (`ingestWoztellEvent`), then close the lead and the conversation through the real staff paths: `updateAdminLead` with the read version, and `updateAdminConversation({status:'closed'})`.
  - `closed lead + new inbound → new lead and reopened conversation` (fix-plan name):
    1. Member M sends at T1 → lead L (new).
    2. A manager closes L as `closed_won` and the conversation as `closed`.
    3. M sends at T2 > close time (live).
    4. The contact now has 2 leads: L stays `closed_won` with its version unchanged, and a new lead is `new` / `unknown` / `whatsapp`, with `created_at=T2`.
    5. The conversation `status='open'`.
    6. `ops_jobs` count is unchanged (owner decision 2).
    7. A second live message at T3 creates no third lead, because an open lead exists.
  - `closed_lost behaves the same, and an open lead blocks a new one`. Lead stages `contacted` + `closed_lost`: a new inbound creates no lead, and the conversation (if closed) still reopens.
  - `history import and identity merges never create a lead or reopen a conversation for old messages` (Review Focus 3):
    - After step 2 above, run `history_import` of a message with `created_at` T0 < close: no new lead, `status` stays `closed`.
    - A `history_import` of a message at T2′ newer than the close but older than the conversation's `last_inbound_at`: no reopen.
    - `UPDATE whatsapp_messages SET contact_id=<contact with only closed leads>` on an old inbound row (the trigger's UPDATE path): no new lead, no reopen.
    - A contact with **no** lead still gets its first lead from a history-imported message, as today.
  - `a new lead keeps the contact owner only while active`. Set the contact's `assigned_agent_id=A`, active: the new lead gets A. Set `A.active=false`, close, send again: the next new lead has `assigned_agent_id IS NULL`.
  - `pending conversations are not touched`. A `pending` conversation stays `pending` on a new inbound.
  - `concurrent inbound messages after closure create exactly one new lead`. Two `ingestWoztellEvent` calls in `Promise.all` with different external ids: one new lead (advisory lock).
  - `migration B is idempotent, contains no job enqueue, and the revert restores the old rule`:
    - Re-running the forward text raises no error.
    - `pg_get_functiondef('ensure_whatsapp_inbound_lead_fn'::regproc)` contains `closed_won` and does not contain `ops_jobs`.
    - The forward file text contains no `ops_jobs` and no `INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)\nSELECT` reconcile.
    - Apply the revert text on one `pool.connect()` client with `BEGIN`, the revert text, then `COMMIT`. A closed contact plus a new inbound then gives **no** new lead (old rule).
    - Re-apply the forward file the same way: the new rule is back.
    - `MIGRATION_VERSIONS.includes("20261009110000_inbound_lead_reopen.sql")`.
  - `revert file is ignored by the migration runner and drift check` (copy of FX-06's test, `enquiry-access.owned.db.test.mjs:313-341` on #226):
    - `apply-migrations.mjs` reads `neon/migrations` non-recursively.
    - `check-migration-drift.mjs` reads `MIGRATION_VERSIONS` and never `neon/reverts`.
    - No `MIGRATION_VERSIONS` entry and no applied `app_migrations` row contains `revert`.
    - `formatDriftReport(pendingMigrations(applied)).ok === true`.
  - `the migration and revert never mention the alert job type`. Neither file text contains `lead.staff.alert` (owner decision 2, and #225's contract test).
  - Run `npm run test:lead-integrity:db`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:lead-integrity:db`
  - `npm run test:no-link:local-postgres` (golden; the inbound-lead counts must be unchanged for contacts without closed leads)
  - `npm run test:admin-golden:db`
  - `npm run test:control-plane`
  - `npm run test:admin-performance:db` and `npm run test:admin-link-bulk:db` (pins)
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): open a new lead and reopen the conversation when a closed customer messages again

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Owner actions before production

**Order:** the owner approves this plan → the owner applies both migrations on a Neon branch → read-only report → staging two-tab check and sandbox check → production migrations (explicit approval) → merge → canary. Nothing is applied anywhere without approval (fix plan Global constraints, FX-00 order). Claude runs migrations on owned and test databases only.

1. **Neon branch migration (owner's step).**
   - Run `npm run neon:migrate` against the **branch** URL. It applies `20261009100000_contact_profile_name.sql`, then `20261009110000_inbound_lead_reopen.sql`.
   - Verify:
     - `\d crm_contacts` shows `whatsapp_profile_name text`;
     - `SELECT count(*) FROM crm_contacts WHERE whatsapp_profile_name IS NOT NULL` = 0 (nothing was backfilled);
     - `SELECT pg_get_functiondef('ensure_whatsapp_inbound_lead_fn'::regproc)` contains `closed_won` and no `ops_jobs`;
     - `SELECT count(*) FROM crm_leads` is unchanged from before the migration (no reconcile).
   - On a second throwaway branch: apply the revert by hand inside `BEGIN … COMMIT`, confirm that the function body equals the old one, then re-apply the forward file.
2. **Read-only report: returning customers that C-10 missed.** Run it on the branch, and on production before the migration. It changes nothing:
   ```sql
   BEGIN READ ONLY;
   SELECT c.id AS contact_id, right(coalesce(c.normalized_phone,''),4) AS phone_last4,
          max(l.updated_at) AS last_closed_at, c.last_inbound_at
   FROM crm_contacts c JOIN crm_leads l ON l.contact_id = c.id
   GROUP BY c.id
   HAVING bool_and(l.stage IN ('closed_won','closed_lost')) AND c.last_inbound_at > max(l.updated_at)
   ORDER BY c.last_inbound_at DESC;
   SELECT count(*) AS closed_conversations_with_newer_inbound
   FROM whatsapp_conversations w
   WHERE w.status = 'closed' AND w.last_inbound_at > w.updated_at;
   ROLLBACK;
   ```
   The owner decides per row (Open question 3). The default is that staff open a lead by hand from the list. Nothing is auto-created.
3. **Staging two-tab check** (Vercel preview on the Neon branch, staff test login, a **synthetic** lead only):
   1. Open the same lead in two tabs.
   2. In tab A, reassign and save. Tab B saves a note edit and must show 「此客戶查詢已被其他同事更新，請重新載入後再儲存。」, keeping the typed text.
   3. Tab A saves twice in a row: both succeed.
   4. Tab B clicks 重新載入最新資料 and saves: success.
   5. The audit row shows `before`/`after` for `assigned_agent_id`.
   6. Bulk-assign to a suspended test staff member: 「所選同事已停用…」 appears and nothing changes.
4. **Sandbox (owner's test number only, WozTell sandbox channel):**
   1. Message from the test phone. A lead appears.
   2. Rename the contact in the CRM to 「測試客戶甲」.
   3. Message again. The name stays 「測試客戶甲」.
   4. Mark the lead 已成交 and close the conversation. Message again. A new 新查詢 lead appears and the conversation is 開啟.
   5. Confirm that no staff alert was sent (owner decision 2).
5. **Production:** apply both migrations with explicit approval, **then** merge (FX-00 order).
6. **Canary (read-only, first 48 h):**
   - `/admin/leads` loads and saves for an agent and a manager.
   - In Vercel logs, `LEAD_CHANGED` warnings are rare. **The same staff member getting two in a row on the same lead within a minute is a 409-loop signal: roll back the PR.**
   - `SELECT count(*) FROM crm_leads WHERE source='whatsapp' AND created_at > <deploy>` is in line with inbound volume.
   - **Duplicate-lead check.** A contact with more than one open lead is not by itself a regression. A manager can legitimately move an old closed lead back to an open stage after the trigger has already opened a new one for the customer's latest message (final review M4). The bug signal is narrower: two trigger-created leads, both still `source='whatsapp'` and stage `new`, for one contact, at least one of them created after the deploy. This must return 0 rows:

     ```sql
     SELECT contact_id, count(*) AS new_whatsapp_leads, max(created_at) AS latest
     FROM crm_leads
     WHERE source = 'whatsapp' AND stage = 'new'
     GROUP BY contact_id
     HAVING count(*) > 1 AND max(created_at) > '<deploy>'::timestamptz;
     ```

     Any row here means the trigger opened a second lead while one was still open: roll back. Contacts with several open leads in other stages are expected after a staff reopen. Review them by hand, do not roll back for them.
   - `audit_logs` `lead.update` rows carry `changed`/`before`/`after`.
   - Then update the Status column in the audit doc and `CHANGELOG.md`.

**Rollback:** revert the PR. Apply `neon/reverts/20261009110000_inbound_lead_reopen_revert.sql` by hand inside `BEGIN … COMMIT`. The column stays.

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **Backfill `whatsapp_profile_name` from today's `crm_contacts.name` for WhatsApp-sourced contacts?** **Default: no.** Today's name may already be a staff edit or a stale profile name. The column fills on each contact's next live message. No existing row is rewritten.
2. **Who bumps the version: a code rule or a `BEFORE UPDATE` trigger on `crm_leads`?** **Default: code rule.** The staff-handover fix plus a contract test that scans every `UPDATE crm_leads` (Task 1). A trigger is more robust against future writers, but it adds a third migration, a revert, and a trigger on `crm_leads` that #225's "no trigger enqueues" test would also have to inspect. Revisit in FX-18.
3. **Create leads for the returning customers C-10 already missed** (Owner action 2 report)? **Default: no automatic write.** Staff open them from the report. If the owner wants a backfill, it becomes a separate `--dry-run` script that prints counts first, never a migration.
4. **Reopen scope.** **Default: only `closed` → `open`.** `pending` is untouched, and the assignee is unchanged, so the same owner sees it in their list.
5. **Owner of the new lead after closure.** **Default: the contact's assignee if active, otherwise unassigned** (it shows in 未指派). The alternative is the previous closed lead's owner.
6. **Should bulk updates also check versions?** **Default: no.** Bulk writes only the explicitly chosen fields to whatever the rows are now. Its bump still makes any open single-lead editor 409.
7. **A staff member clears a contact name to blank.** **Default: the next WhatsApp message refills it from the profile name.** This is the same `COALESCE(c.name, …)` rule as every other writer. To keep blanks, FX-18c would add an explicit "name locked" flag.
8. **Should an agent's own lead edits also refuse a stale version?** **Default: yes.** The guard applies to every role. Agents are the most likely to keep a lead open in a tab for hours.

## Findings that differ from the approved fix plan

1. **The trigger does not enqueue the alert job.** The fix plan says "enqueue the FX-05b alert job". Owner decision 2 overrides this: the handler exists only in #225. That work is a named follow-up, and FX-09 must not even contain the job-type string, because #225's contract test scans migrations for it.
2. **The token is an opaque `version` / `expected_version` string, not `expected_updated_at`.** The value is the same SQL microsecond string. The rename stops anyone treating it as a timestamp, through `rowDate`/`new Date`, which is how FX-05b lost milliseconds. The fix-plan test names are kept verbatim.
3. **Staff handover silently rewrites `crm_leads.assigned_agent_id` without bumping `updated_at`** (fact 8). A `WHERE … AND updated_at = $n` guard alone would let a stale editor re-assign a lead back to a departed agent with no 409. Task 1 adds the bump and a contract test over every `UPDATE crm_leads`.
4. **Inactive-staff checks also cover single-lead edits and the forward dialog,** not just bulk. `admin.leads.tsx:1220` forces `active: true` on every agent, which defeats the forward form's own filter. A lead already owned by a deactivated agent stays editable (Review Focus 4).
5. **The trigger cannot tell live messages from history import, or from identity moves** (fact 12). A literal "create a lead when no open lead exists" would open leads, and reopen conversations, for months-old imported messages. Migration B limits both new behaviours to `INSERT` and to messages newer than the last close (`crm_leads.updated_at`) or the last inbound (`last_inbound_at`).
6. **The old trigger copied the contact's owner even when that staff member is inactive** (fact 10), creating new G-02 cases by itself. The replacement assigns only active owners.
7. **The name overwrite also comes from history import** (D-06 notes "backfill replays old names"). The profile column is therefore "live overwrites, history only fills a blank", not a plain `whatsapp_profile_name=$3`.
8. **The audit is written inside the update statement**, not in a separate `writeAudit` call afterwards. A save and its audit row can no longer diverge. A no-op save writes neither.
9. **The audit anchor for C-10 (`woztell-ingest.server.ts:197-201`) is the conversation upsert,** which never touches `status`. The reopen therefore lives in the trigger (migration B), not in ingest. This keeps FX-09's diff out of #228's ingest hunk except at `:188` and `:193-194`.
10. **The two-tab e2e needs a shared store in the fixture.** The daily-work fixture's state is per window, so two tabs never saw each other's saves (fact 15). Task 3 keeps the shared version in `localStorage` and throws the real `ServerFnResponseError` type.
11. **Existing tests pin the old SQL shape and need small, explicit updates:** `admin-transactions.contract.test.mjs:492-536` (the regex and the missing version). `whatsapp-leads.db.test.mjs` (Neon only, skipped in CI) keeps testing the old file in isolation and is left unchanged.
