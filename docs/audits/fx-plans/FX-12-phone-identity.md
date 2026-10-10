# FX-12: One phone format; no split or stuck customers. Implementation plan

**Base:** `origin/main` bfbfd618. This plan was written on `fix/fx-12-phone-identity`. It changes no code.

**Two PRs, run one after the other (not stacked).** This repo does not auto-delete merged branches, so a stacked PR would never retarget to `main`.

| PR | Branch | Tasks | Migration | Ships when |
|---|---|---|---|---|
| **A**: one normaliser, a WhatsApp identity conflict goes to review instead of failing (C-04), activity contact from the lead (B-10), and the review list | `fix/fx-12a-phone-identity` (this branch, or a new one cut from `main`) | 1–4 | `20261013100000_contact_identity_review.sql` | after the owner applies the migration to production |
| **B**: campaign retry stays correct across the rewrite, and the data script | `fix/fx-12b-phone-normalize`, cut from `main` **after PR A is merged and deployed** | 5–6 | none | before the owner runs the script |

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- Every phone number a customer types or WhatsApp sends is stored the same way: `852XXXXXXXX` for Hong Kong, international digits otherwise. One function does it, in `src/lib/phone.js`.
- A WhatsApp message is **never** stuck because its member id and phone point at different contacts. It is stored in a 「身分待核對」 conversation. Managers see it, and nothing auto-replies. No contact, lead or opt-in is written from it, apart from a STOP being honoured.
- A staff note or follow-up always belongs to the lead's own customer (B-10).
- Old 8-digit and `00852` rows are rewritten by an owner-run script, which takes a snapshot first and can restore it. Duplicates are never merged automatically. They go to a 「可能重複客戶」 list in `/admin/leads`, which managers and admins work through by hand.

Findings: D-12 (= H-06), C-04, B-10, plus the related consent gap found while verifying (Fact 14).

**Approach.**
- **One parser, one SQL match.** `normalizePhone(raw)` returns the canonical string or `null`. `phoneMatchSql(column, param)` and `phoneEquivalentsSql(expr)` are the only SQL builders that compare phones. Both accept every **legacy** stored spelling (`XXXXXXXX`, `852XXXXXXXX`, `00852XXXXXXXX`). This matters for two reasons:
  - Matching never gets narrower than today, so before, during and after the data rewrite every inbound message finds the same contact it finds today.
  - The match stays in place after the rewrite. Collision pairs are never rewritten, so both spellings stay in the table until staff deal with them.
- **The ingest statement decides between "normal" and "review" in SQL, under the existing advisory locks.**
  - Review covers four cases:
    - the phone and member point at different contacts;
    - a blank fill would collide with another contact's phone or member;
    - the member's conversation belongs to a different contact;
    - the conversation already has an open review.
  - In review, ingest writes **no contact field** (name, phone, member id, profile name, `last_inbound_at`). The one exception is a STOP, which is applied (Open question 2).
  - The message is stored with `contact_id = NULL` in the member's conversation. That conversation is the existing one if there is one, or a new one with no contact. One open `crm_contact_identity_reviews` row is upserted for the conversation.
  - Because `contact_id` is NULL, FX-09's inbound-lead trigger creates no lead, and FX-08's enquiry pipeline creates no enquiry event, so there is no job and no auto-reply.
  - The statement always returns a row. The JS throw stays only for an impossible state.
- **A manager resolves the review by linking the conversation to a contact.** The options are contact A, contact B, or a new contact.
  - Only explicit links are trusted later: a conversation with a `linked` review is authoritative for that member. Ingest then attaches to it **without filling identity fields**, so the same conflict does not reopen on every message.
  - A link sets `contact_id` on the stored messages. The FX-09 trigger's UPDATE path then creates a first lead only if that contact has none. It never reopens anything.
- **Duplicates are reviewed, never merged.** No merge exists in the codebase (Fact 18). A duplicate pair is marked 同一客戶（暫不合併）, 不同客戶 or 略過. Staff then handle the leads by hand through the links in the list.
- **The data script rewrites only spellings of the same Hong Kong number**: `XXXXXXXX` → `852XXXXXXXX` and `00852XXXXXXXX` → `852XXXXXXXX`.
  - Each row is rewritten under the same advisory lock key that ingest uses (`woztell-phone:<canonical>`).
  - A row is skipped when another contact already holds an equivalent spelling. That collision becomes a review row.
  - The script never touches `phone` (the raw text), member ids, consent, names or `updated_at` (see the campaign digest in Task 5).
- **One migration, additive.** It adds the review table. **No function or trigger is replaced**, so there is no revert file. The table can stay.

**Tech stack.**
- Owned full-schema Postgres: `withOwnedPostgres` + `mockOwnedServerDb` (`scripts/acceptance/owned-postgres-test.mjs:44-164`), with `--experimental-test-module-mocks`.
  - **One container per file.** PR A uses `src/lib/neon/contact-identity.owned.db.test.mjs` and `src/lib/woztell/woztell-ingest.owned.db.test.mjs` (the fix-plan file).
  - PR B uses `scripts/neon/normalize-contact-phones.owned.db.test.mjs` and extends `src/lib/neon/campaign-recovery-owned.db.test.mjs`.
- Pure tests: `node --test` (`.mjs` importing `.js`/`.ts` directly; Node 24 strips types).
- Components: `bun test` with `renderToStaticMarkup`.
- Browser: Playwright `playwright.admin-owned.config.ts`, daily-work fixture.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md` (main bfbfd618):
  - D-12 (:228)
  - C-04 (:189)
  - B-10 (:172)
  - A-02 (:126, the source-regex test on `WOZTELL_IDENTITY_CONFLICT`)
  - D-09 (:225, campaign sends phone as member id)
  - headline 7 (:59-63)
  - §8 (:536-540, "duplicate contacts by phone" needs a Neon branch)
- Fix plan `docs/audits/2026-10-fix-plan.md` (main):
  - FX-12 (:559-588)
  - Global constraints (:17-39)
  - Review focus (:41-50)
  - the migration register (:787-801)
  - Decisions D4 (:72, opt-out words)

## Verified current behaviour (main bfbfd618)

| # | Fact | Where |
|---|---|---|
| 1 | **The customer normaliser.** `normalizeAdminPhone(value)`: trim, strip every non-digit; if the text does not start with `+` and has exactly 8 digits → `852`+8, else the digits as they are. So `9123 4567` → `85291234567` and `+852 9123 4567` → `85291234567`, **but** `00852 9123 4567` → `0085291234567` (13 digits, never matched), `+9123 4567` → `91234567`, full-width `９１２３４５６７` → `null` (JS `\D` is ASCII), `9123456` → `9123456`, `9123 4567 ext 12` → `9123456712`. It is used by website enquiries (`admin-data.server.ts:4568`), WhatsApp ingest (`woztell-ingest.server.ts:148`), the live-agent lead builder (`live-agent.ts:36`), audience dedupe (`admin-data.server.ts:917-937` via `blast-review.ts:18-55`) and the command center (`command-center.ts:129`). | `src/lib/neon/admin-workflow.ts:1-7` |
| 2 | **It changed on 2026-09-25** (`2a12e7eb` "unify HK contact identity"). Before that it returned the bare digits, so every 8-digit number typed before that date is stored as `XXXXXXXX`. That is the source of the live `852 9xxx x493` / `9xxx x493` pair (audit :62). | `git log -L1,7:src/lib/neon/admin-workflow.ts` |
| 3 | **Live agent (FX-03, merged) is already canonical.** `validateHandoffPhone` accepts 8-digit HK mobiles starting 4–9, with an optional `+852`/`00852`/`852`, and returns `852`+8. It rejects HK landlines and wrong lengths. A `+` number of 8–15 digits returns the digits. Its output equals the new canonical form for every input it accepts. | `src/lib/ai/live-agent.ts:66-85`; call `live-agent.server.ts:214-221` |
| 4 | **Other parsers (not customer identity).** `normalizePhoneDigits` (public `tel:`/`wa.me` links for agents and branches): a `+` and ≥ 8 digits → the digits (so `+9123 4567` → `wa.me/91234567`, a wrong link). 8 digits → `852`+8. 9+ digits starting 852 → as is. ≥ 10 digits → as is. Otherwise `null` (`00852…` → 13 digits, kept, broken link). `normalisePhone` (staff namecard OCR): strip non-digits, drop a leading `852`, require `^[23569]\d{7}$`, return **8 digits** (stored in `staff_users.phone`, used by `seed-staff.mjs:69`). `normaliseWhatsapp` additionally requires `^[569]`. | `src/lib/contact-links.ts:17-39`; `src/lib/staff/licence.ts:10,15-19,38-43` |
| 5 | **Six SQL copies of the two-format match.** Each is `normalized_phone=$n OR (length($n::text)=11 AND left($n::text,3)='852' AND normalized_phone=right($n::text,8))`, in: ingest `matched` and `valid` (`woztell-ingest.server.ts:175-185`); website enquiry (`website-inquiry.js:77-82`); live-agent handoff `candidate_contact` (`live-agent.server.ts:268-273`), correction `target` (`:444-449`) and `existing_for_new` (`:476-481`). The marketing variant is `CASE WHEN length=11 AND left=852 THEN right(…,8) WHEN length=8 THEN '852'||… END` in `marketingIdentitySafeSql` and `campaignRecipientPrimarySql` (`phone-identity.ts:12-15,33-36`). **None of them knows `00852`.** | as listed |
| 6 | **SQL comparisons that stay as they are.** The staff-destination guard compares by digits, last 8, and `852`+last 8 on both sides. It deliberately refuses more than it needs to, so it already treats every legacy spelling as the same number (FX-05b/D-11). The CRM analysis revision and its lock use **exact** `normalized_phone` peers (migration functions). The enrichment "verified contact" regex is `^\+?[0-9]{8,15}$`. Rate-limit keys use `phone.replace(/\D/g,"")` (`admin-data.ts:784,875,950`). These are bucket keys, not identity. | `src/lib/whatsapp-enquiries/staff-recipient-guard.ts:15-35`; `neon/migrations/20261003030000_crm_analysis_runs.sql:28,57`; `src/lib/ai/crm-enrichment.server.ts:358,363` |
| 7 | **Constraints.** `crm_contacts.normalized_phone TEXT UNIQUE`. `idx_crm_contacts_whatsapp_member_id` is UNIQUE where not null. `whatsapp_conversations UNIQUE (channel_id, woztell_member_id)`. `whatsapp_messages.contact_id` is nullable (`ON DELETE SET NULL`). `crm_activities.contact_id` references `crm_contacts ON DELETE CASCADE`. | `20260623090000_neon_admin_crm_whatsapp.sql:91,123,132-144,146-149`; `20260626120200_woztell_member_identity.sql:12-14` |
| 8 | **Ingest today.** `$1` = `normalizeAdminPhone(fromPhone)` and `$2` = member id. It takes advisory locks on `woztell-phone:$1`, `woztell-member:$2` and `woztell-message:<id>` (`:157-172`). Then: `matched` = phone (two-format) **or** member. `valid` = matched rows whose phone is null or matches **and** whose member is null or equals `$2`, ordered `(member=$2) DESC NULLS LAST, (normalized_phone=$1) DESC NULLS LAST, id`, `LIMIT 1`. `updated_contact` fills `normalized_phone=COALESCE(c.normalized_phone,$1)` and `whatsapp_member_id=COALESCE(c.whatsapp_member_id,$2)` and writes the FX-08 opt-out and FX-09 profile name. `new_contact` inserts only when `matched` is empty. `updated_conversation` needs `wc.contact_id IS NULL OR wc.contact_id=c.id`. `new_conversation` needs no conversation for (member, channel). `message` needs a conversation when `$2` is set. The final `SELECT … FROM contact c` returns **zero rows** when there is no contact. | `src/lib/woztell/woztell-ingest.server.ts:147-275` |
| 9 | **C-04: where ingest fails.** (a) **Member/phone conflict.** Contact X has phone P and member M1, and the event is (P, M2). X is in `matched` but not in `valid`, and no other contact matches, so the final SELECT is empty: `throw WOZTELL_IDENTITY_CONFLICT` (`:284-287`). (b) **A blank fill collides.** `valid` picks a contact by member whose phone is null while another contact holds P, or by phone whose member is null while another holds M. `updated_contact` then hits the UNIQUE index: a Postgres `23505`, not the named error. (c) **The conversation belongs to another contact.** The contact resolves, but the member's conversation has a different `contact_id`. No conversation and no message are written, so `conversation_id` is null: `throw WOZTELL_IDENTITY_CONFLICT`. In (c), **`updated_contact` has already committed** (the throw comes after `transactionRows` commits): `last_inbound_at`, a blank phone or member fill, and the opt-out. Cases (b) and (c) are not in the audit. | `woztell-ingest.server.ts:178-186,199-231,276-287`; `src/lib/neon/db.server.ts:25-36` |
| 10 | **Lost or only rejected? Rejected and invisible, not lost.** The webhook first commits a receipt whose `normalized_event` keeps the member, `from`, `to`, the text and the timestamp (`inbound-receipts.server.ts:32-60,62-136`). A projection error marks it `failed`/`PROJECTION_FAILED` and still answers WozTell `200 {ok:true, projection:"failed"}` (`webhook.server.ts:171-197`). Recovery retries with backoff up to `RECEIPT_MAX_ATTEMPTS = 20` (`receipt-retry-policy.ts:7`), then the row shows as `retry_exhausted` in Operations (`inbound-receipts.server.ts:244-253`). A manager can retry one receipt and skip the cap (`:327-375`), which today fails again. **Staff never see the message in the inbox.** History import calls the same ingest and fails the same way (`history-import.server.ts:69-73`). | as listed |
| 11 | **No auto-reply on a failed projection, and none for a NULL-contact message.** The enquiry event is inserted `FROM whatsapp_messages m WHERE m.external_message_id=…`, so it needs the stored message, and the `woztell.enquiry.process` job needs that event (`requireEnquiryEvent: true`). The FX-09 inbound-lead trigger returns early when `NEW.contact_id IS NULL`. | `src/lib/whatsapp-enquiries/workflow.server.ts:37-58`; `neon/migrations/20261009110000_inbound_lead_reopen.sql` |
| 12 | **B-10.** `createAdminLeadActivity` checks only that the lead is in scope (`assertLeadInScope`), then `INSERT INTO crm_activities (lead_id, contact_id, …) VALUES ($1,$2,…)` with `$2 = input.contact_id`, as the client sent it. The UI sends `detail.contact_id` (`admin.leads.tsx:709-712,773-776`, inside the `addNote` slice that `crm-note-save.test.ts` runs). **No reader selects `crm_activities.contact_id`.** Every timeline, KPI and analysis reads by `lead_id` (`admin-data.server.ts:1037,1080,2547-2549,2978-2985`; `crm_analysis_runs.sql:29`). So a forged or stale id stores a wrong FK, which a contact delete would cascade into. It is not shown on another customer today. A stale tab can produce one legitimately, because live-agent phone correction relinks `crm_leads.contact_id` (`live-agent.server.ts:500-506`). | `src/lib/neon/admin-data.server.ts:2880-2907`; `admin-data.types.ts:494-501` |
| 13 | **FX-10b digest.** `attempted_identity = sha256('fx10b-identity-v1|' || member || '|' || normalized_phone)`, written at dispatch. A re-send is allowed only if the digest is NULL or equals the contact's digest **now** (`campaignAttemptedIdentityMatchesSql`), **and** `contact.updated_at <= r.queued_at` (`campaignRetryContactUnchangedSql`). Delivery uses it in `beginCampaignDispatch` and requeue in `admin-data.server.ts:4450-4456`. A row rewritten `91234567` → `85291234567` therefore changes the digest, and a rewrite that bumps `updated_at` also fails the time test. **Both would block the retry.** Delivery sends to `whatsapp_member_id ?? normalized_phone`. | `src/lib/neon/campaign-retry.ts:100-129`; `src/lib/woztell/campaign-delivery.server.ts:86-96,353` |
| 14 | **Consent gap today (priority 2).** `marketingIdentitySafeSql` and `campaignRecipientPrimarySql` link a contact to peers by `IN (phone, otherFormat)`, where `otherFormat` is NULL for a 13-digit `00852…` value. A website contact stored as `0085291234567` (opted in on the form) is therefore **not** linked to an opted-out WhatsApp contact `85291234567`. It passes `identity_safe` and can be queued in a campaign. Delivery would then send `memberId = "0085291234567"` (no member id on a website contact). What WozTell does with that is unverified (audit §8). A legacy `91234567` contact without a member id is likewise sent `memberId = "91234567"` (D-09). | `src/lib/neon/phone-identity.ts:6-53`; `campaign-delivery.server.ts:353` |
| 15 | **Staff access.** `wa_can_read_conversation`: admins and managers read every conversation; agents read only those assigned to them. A conversation with no contact and no assignee is therefore visible to managers and admins only, and counts in `unanswered_conversations` for them (`getAdminAttentionCounts`). The inbox lists use `LEFT JOIN crm_contacts`, so a NULL contact still lists. Outbound replies go through `enqueueOutboundIntent`'s `authorized` CTE. | `neon/migrations/20261007100000_wa_access_unassigned.sql:32-45`; `admin-data.server.ts:1017-1054,3127-3158`; `src/lib/neon/admin-pagination-query.ts:47-82`; `src/lib/woztell/outbound-intent.server.ts:137-147` |
| 16 | **Ownership contract.** `staff-ownership.test.mjs:301-336` requires every `REFERENCES staff_users` column found in `neon/migrations/*.sql` to be classified. `resolved_by` is already in `STAFF_HISTORICAL_COLUMNS` (FX-08). | `src/lib/neon/staff-ownership.ts:83-84` |
| 17 | **Migration manifest.** It has 92 entries, and the last is `20261010100000_campaign_attempted_identity.sql` (`migration-versions.js:129`). Pinned counts are `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23` (both `92`). `20261013100000` sorts last. `neon/reverts/` exists (three FX-06/08/09 files). FX-11a's `20261010100000_live_agent_call_log.sql` is **not** on main. | `src/lib/control-plane/migration-versions.js:121-130` |
| 18 | **No contact merge exists anywhere** (`grep -i merge` over `src/lib/neon`, `src/lib/whatsapp-enquiries`, `neon/migrations`: no contact merge). So merging stays out of scope. | — |
| 19 | **Staff server-function wrapper.** New staff modules use `callStaffServerFn` and must be listed in `MIGRATED` in the contract test (pattern: `src/lib/neon/enquiry-resolution.ts`). | `src/lib/neon/staff-server-fn.ts`; `staff-server-fn.contract.test.mjs:28-48` |
| 20 | **Pinned-by-text tests.** `woztell.test.mjs:332` is `assert.match(ingest, /WOZTELL_IDENTITY_CONFLICT/)` (A-02). It stays true, because the name stays for the impossible state. `admin-workflow.test.mjs:14-20` pins four `normalizeAdminPhone` cases, and all four keep their output. `test:live-agent:local-db` (`phone-identity.local-db.test.mjs`, `website-inquiry.local-db.test.mjs`) is **not** in CI. | as listed |
| 21 | **The expected duplicate count is not in the audit.** The fix plan says "the expected duplicate count is in the report". The report has one live example (:62, :191, :228) and lists "duplicate contacts by phone" under counts that need a Neon branch (§8 :536-540). The count comes from Owner action A2. | `docs/audits/2026-10-final-audit.md` |
| 22 | **Open PR.** #237 (`fix/fx-11-chatbot`, FX-11b) touches `live-agent.ts:11-20` (removes `shouldOfferHumanHandoff`), `live-agent.server.ts:4-15,141-175`, a new `live-agent-intent.ts` with its own `HK_PHONE_RE` detector (`:60-62`, which strips phone numbers before listing-number parsing; not a normaliser), `package.json:49-52,127-130` and `ci.yml:88-91,155-158`. | `git diff HEAD...origin/fix/fx-11-chatbot --stat` |

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real number. Tests mock at `src/lib/woztell/provider-fetch.ts`. Owned DB tests make `globalThis.fetch` throw and delete `OPS_EVENT_WAKE_ENABLED` (FX-06 header).
  - Synthetic data only. Use ids `7c000000-0000-4000-8000-…`, member ids `synthetic-fx12-…`, and phones from the HK fictional range `5555 0xxx` / `8525555 0xxx`.
  - **Claude never runs `scripts/neon/normalize-contact-phones.mjs` against any Neon database.** Claude runs it only on owned Postgres in tests. The owner runs it on a Neon branch first, then on production.
  - Production admin is read-only unless the owner names a record.
- **Migrations.**
  - One additive file. The first statement is `SET LOCAL lock_timeout = '5s';`. It is re-runnable (`IF NOT EXISTS`).
  - **No `;` and no `'` inside any comment.** `scripts/neon/apply-migrations.mjs` splits on them.
  - No function or trigger is replaced, so no revert (fix plan Global constraints).
  - Register it in `migration-versions.js` and set both pinned counts 92 → **93**. On every rebase, set them to `ls neon/migrations/*.sql | wc -l`.
- **The data script.**
  - `--dry-run` is the default and prints **counts only**: never a phone, name or id.
  - It writes the JSON snapshot **before** the first write.
  - `--restore <file>` exists, and is itself dry-run unless `--apply`.
  - It never merges. Collisions become review rows.
  - It is idempotent: a second run gives zero rewrites and the same review count.
- **Ownership.** The only new staff FK is `resolved_by` (already history). `src/lib/neon/staff-ownership.test.mjs` must stay green.
- **Existing helpers, reused as they are.**
  - FX-08 opt-out evidence columns and the `opt_out` CTE.
  - FX-09's `lead-version.contract.test.mjs` scanner. FX-12 adds **no** `UPDATE crm_leads`, and a link only UPDATEs `whatsapp_messages.contact_id`. The FX-09 trigger may INSERT a first lead.
  - FX-10b's digest (Task 5).
  - `callStaffServerFn` for every new admin caller.
  - The FX-05b staff-recipient guard is unchanged (Fact 6).
- **Copy.** zh-HK only. Every new string is **[owner copy]** (the copy table in Task 4). Reuse the shadcn `Alert`, `Badge`, `Button`, `Dialog`, `Table`, `Textarea` and `sonner` primitives. There is no brand or marketing copy change.
- **Roles.** Review list and resolution: `requireStaffAccess(["admin","manager"])`. Agents never see the list, the count or the button.
- **Privacy.** Review rows, `evidence`, audit metadata and script output never hold a raw phone or member id. The UI shows a masked phone (`•••• 4567`) only. Only the script's local snapshot holds phones. It goes under `.audit/fx12/` (git-ignored, `.gitignore:61`), and the owner keeps it private.
- **Avoid conflicts with the open PR.**

  | PR | Overlap with FX-12 | Rule |
  |---|---|---|
  | #237 `fix/fx-11-chatbot` | `live-agent.server.ts` (FX-12 edits only the three match fragments at `:268-273`, `:444-449`, `:476-481`; #237 edits `:4-15`, `:141-175`); `package.json` and `ci.yml` neighbouring lines; `live-agent-intent.ts` | **Do not edit `live-agent.ts` or `live-agent-intent.ts`.** `validateHandoffPhone` already returns the canonical form (Fact 3), and a contract test pins that. #237's `HK_PHONE_RE` is a detector. A later batch may move it onto `phone.js`. FX-12 does not touch it. Put new `package.json` scripts after `:118` (`test:lead-integrity:db`), and CI lines after `ci.yml:107` and `:161`, away from #237's hunks. **If #237 merges first, rebase PR A onto `main` and re-run `npm run test:live-agent`.** |
- **Do not touch** the text between `  async function addNote()` and `  async function markStage(` in `admin.leads.tsx` (`crm-note-save.test.ts`). B-10 is fixed on the server only.
- **Committing.** Use `git add <paths>` only. **Never add `bun.lockb`**, which is already dirty in this worktree. Use conventional commits with a scope, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its listed suites.
  - Each PR also passes `npm run build` and every `playwright.admin-owned.config.ts` suite.
  - For the UI (Task 4), take before/after screenshots at 375 px and 1440 px.
  - Owned suites need Docker and `docker pull pgvector/pgvector@sha256:d2ef61f4…` (`ci.yml:153`).

## Review Focus

These are the six likeliest failure modes that no fix-plan test covers. Each has a named test in its owning task.

1. **A message attaches to a different contact than today, or to the wrong person, because of the new format.**
   - When two contacts hold `91234567` and `85291234567`, ingest must keep today's pick: the member owner, else the exact canonical spelling, else the lowest id.
   - Rewriting one row must never make ingest pick the other.
   - *Tests:*
     - (Task 3) `two contacts holding the 8-digit and 852 forms: ingest picks the same contact as today`.
     - (Task 6) `ingest finds the same contact before, during and after the rewrite`.
2. **The review path drops a message or leaks it to a customer.**
   - A conflicted message must be stored, visible to managers, with no auto-reply, no enquiry event, no lead and no contact write.
   - A STOP inside it must still block business-initiated messages to every matched contact.
   - *Tests (Task 3):*
     - `member conflict → message stored in review conversation, not lost` (fix-plan name).
     - `review path writes no contact field, no lead and no enquiry event`.
     - `STOP in a conflicted message opts out every matched contact`.
3. **A review loops forever.** After a manager links the conversation, the next message from that member must land in it normally and must not reopen a review. *Test (Task 4):* `after a manager links the conversation, the next message lands there and opens no new review`.
4. **The rewrite wrongly blocks or wrongly allows a campaign re-send** (FX-10b).
   - A format-only rewrite must leave a failed recipient retryable to the same person.
   - A real change (another number, another member, the `00852` spelling) must still block.
   - *Test (Task 5):* `a format-only phone rewrite neither blocks nor widens a campaign retry`.
5. **The script corrupts data or cannot be undone.**
   - A collision must never be rewritten.
   - The snapshot must exist before the first write.
   - A restore must skip rows changed since.
   - A second run must be a no-op.
   - *Tests (Task 6):* `snapshot is written before any write`, `collision → review row`, `restore round-trip`, `restore skips rows changed since the snapshot`, `a second run rewrites nothing`.
6. **A wider `00852`/`+`8-digit match attaches a public form to an existing customer.** This is intended (same number), but it must not escalate consent or overwrite a name. *Test (Task 1):* `a website enquiry typed as 00852 joins the existing contact without changing consent or name`.

## Out of scope / follow-ups

| Follow-up | Owner | What it must do |
|---|---|---|
| Contact merge | FX-18 (data hygiene) | A real merge, covering leads, conversations, activities, consent, audit and an undo. FX-12 only records 同一客戶（暫不合併）. |
| WhatsApp staff alert for a 「身分待核對」 conversation | FX-05b follow-up (Open question 3) | FX-12 alerts in the admin: the unanswered count, the review count on the button, and the inbox badge. No WhatsApp inbound message alerts staff by WhatsApp today either (FX-09 owner decision 2). |
| FX-02 valuation and listing-alert leads | FX-02 | They must use `normalizePhone` and `phoneMatchSql`. The Task 1 contract test fails if they copy the SQL. |
| `live-agent-intent.ts` `HK_PHONE_RE` detector | FX-11b follow-up | It could use `phone.js`. It is not identity, so it is left alone. |
| Rate-limit keys `phone.replace(/\D/g,"")` | FX-14 | Could key on `normalizePhone`, so that `00852…` and `9…` share a bucket. |
| CRM analysis exact-peer match (`crm_analysis_runs.sql:28,57`) | none needed | It becomes correct once the data is canonical. A function replace would need a revert, for no behaviour gain after Task 6. |
| Campaign delivery requires a member id (D-09) | FX-18c | Fact 14 shows that sending a phone as the member id is the real wrong-recipient risk. FX-12 makes the phone canonical. D-09 should stop sending without a member id. |

---

## PR A — one normaliser, conflicts go to review, B-10, review list

### Task 1: One phone normaliser and one SQL match (no migration)

**Files:**
- **Create `src/lib/phone.js`** and **`src/lib/phone.d.ts`**: pure, no imports, so `.mjs` tests and the client can import them.
- **Modify `src/lib/neon/admin-workflow.ts:1-7`.** `normalizeAdminPhone` becomes `return normalizePhone(value)` (`import { normalizePhone } from "../phone.js"`). The name is kept for its seven importers.
- **Modify `src/lib/contact-links.ts:17-39`.** `normalizePhoneDigits` becomes `normalizePhone(phone)`. The comment notes the two fixed wrong links (`+9123 4567`, `00852…`).
- **Modify `src/lib/staff/licence.ts:15-19`.** `normalisePhone` parses with `normalizePhone`, then returns `hkLocalNumber(c)` only if it matches `HK_PHONE`. Its output **stays 8 digits**: staff phones are display data, not customer identity, and they are not rewritten.
- **Modify `src/lib/neon/phone-identity.ts:6-53`.** Both functions use `phoneEquivalentsSql(phone)`: `identity_peer.normalized_phone = ANY(<equivalents>)` and `earlier_contact.normalized_phone = ANY(<equivalents>)`. This closes the `00852` consent gap (Fact 14).
- **Modify `src/lib/neon/website-inquiry.js:77-82`**: `WHERE ${phoneMatchSql("normalized_phone", "$3")}`. Keep `ORDER BY (normalized_phone = $3) DESC, id`.
- **Modify `src/lib/woztell/woztell-ingest.server.ts:175-185`**: replace both inline copies with `phoneMatchSql("normalized_phone","$1")`. Ordering is unchanged. Task 3 rewrites the rest of this statement.
- **Modify `src/lib/ai/live-agent.server.ts`** at `:268-273`, `:444-449` and `:476-481` only: `phoneMatchSql("c.normalized_phone","$5")`. Ordering is unchanged.
- **Create `src/lib/phone.test.mjs`** (the fix-plan file) and **`src/lib/phone.contract.test.mjs`**.
- **Extend `src/lib/neon/contact-identity.owned.db.test.mjs`** (create it, one container; Tasks 2–4 add to it).
- **Modify `package.json`.** Insert after `:118`:
  ```
  "test:phone-identity": "node --test src/lib/phone.test.mjs src/lib/phone.contract.test.mjs",
  "test:contact-identity:db": "node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/neon/contact-identity.owned.db.test.mjs src/lib/woztell/woztell-ingest.owned.db.test.mjs",
  ```
- **Modify `.github/workflows/ci.yml`:** add `- run: npm run test:phone-identity` after `:107`, and `- run: npm run test:contact-identity:db` after `:161`.

**Interfaces:**
```js
// src/lib/phone.js
/**
 * Canonical customer phone. Digits only. Hong Kong → "852" + 8 digits; others → E.164 digits, no "+".
 * Steps: String(raw).normalize("NFKC").trim(); allowed characters are digits, space, - . ( ) and
 * one leading "+"; anything else (letters, "ext") → null.
 * International prefix: "+" or "00" (stripped). Then:
 *   intl and starts 852 → exactly 11 digits with 4th digit 2-9, else null
 *   intl, exactly 8 digits, first 2-9 → "852"+digits   (a "+" typed before an HK number; Open question 4)
 *   intl otherwise → 8..15 digits, first 1-9, else null
 *   bare 8 digits, first 2-9 → "852"+digits
 *   bare 11 digits "852" + [2-9] + 7 → as is
 *   bare 10..15 digits (WozTell sends e.g. "8613812345678") → as is
 *   anything else → null
 */
export function normalizePhone(raw: unknown): string | null;
/** "852XXXXXXXX" → "XXXXXXXX"; anything else → null. */
export function hkLocalNumber(canonical: string | null): string | null;
/** SQL: `column` holds the same number as canonical `param`, in any legacy spelling.
 *  (col = p::text OR (p::text ~ '^852[0-9]{8}$' AND col IN (right(p::text,8), '00' || p::text)))
 *  A superset of today's two-format match. column and param must match
 *  /^[A-Za-z_][A-Za-z0-9_.]*$/ or /^\$\d+$/, else it throws. */
export function phoneMatchSql(column: string, param: string): string;
/** SQL text[] of the stored spellings equivalent to expr:
 *  8 digits → {e,'852'||e,'00852'||e}; 852+8 → {e,right(e,8),'00'||e}; 00852+8 → {e,right(e,8),substr(e,3)}; else {e}.
 *  Uses [0-9]{8} (not [2-9]) so it never matches less than today. */
export function phoneEquivalentsSql(expr: string): string;
/** The advisory lock key ingest already uses; the Task 6 script uses the same. */
export const PHONE_LOCK_PREFIX: "woztell-phone:";
```

**Behaviour changes** (all other inputs keep today's output):

| Input | Today `normalizeAdminPhone` | New |
|---|---|---|
| `00852 9123 4567` | `0085291234567` | `85291234567` |
| `+9123 4567` | `91234567` | `85291234567` |
| `９１２３ ４５６７` (full-width) | `null` | `85291234567` |
| `0044 20 7946 0958` | `00442079460958` | `442079460958` |
| `9123456`, `123456789`, `01234567` | digits | `null` |
| `9123 4567 ext 12` | `9123456712` | `null` |

A `null` never loses an enquiry: the website path then inserts the contact with no phone identity (`website-inquiry.js:97-103`), and the raw text stays in `phone`.

- [ ] **Step 1: write the failing tests.**
  - `phone.test.mjs`:
    - `normalizePhone handles HK formats` (fix-plan table): `9123 4567`, `+852 9123-4567`, `0085291234567`, `00852 9123 4567`, `85291234567`, `(852) 9123 4567`, full-width `９１２３４５６７` → `85291234567`.
    - `a landline is accepted`: `2688 2988` → `85226882988`.
    - `UK and CN keep their country code`: `+44 20 7946 0958` and `0044 20 7946 0958` → `442079460958`; `+86 138 1234 5678` and bare `8613812345678` → `8613812345678`.
    - `garbage is null`: `""`, `null`, `undefined`, `"+"`, `abc`, `9123456`, `123456789`, `00000000`, `+852 9123 456`, `+85212345678`, `9123 4567 ext 12`, a 16-digit `+` number.
    - `a + before an 8-digit HK number is HK`: `+9123 4567` → `85291234567` (Open question 4).
    - `hkLocalNumber only unwraps 852`.
    - `phoneMatchSql rejects unsafe identifiers`: `phoneMatchSql("c.normalized_phone; drop","$1")` throws; `phoneMatchSql("x","$1 OR 1=1")` throws.
  - `phone.contract.test.mjs` (reads sources):
    - `every customer-phone parser agrees with normalizePhone`. Over the table above: `normalizeAdminPhone(x) === normalizePhone(x)`, `normalizePhoneDigits(x) === normalizePhone(x)`, `normalisePhone(x)` is `hkLocalNumber(normalizePhone(x))` or `null`, and for every `x` that `validateHandoffPhone` accepts, `.normalized === normalizePhone(x)`.
    - `no SQL copy of the phone match outside phone.js`. No non-test file in `src/` or `neon/migrations/` (except files dated before `20261013`) contains `left($` together with `,3)='852'`, or `'852' ||` together with `normalized_phone`. The failure message names D-12. Allowlist, with reasons: `staff-recipient-guard.ts` (Fact 6), `live-agent-intent.ts` (#237 detector), `config/whatsapp-phone.js` (company env).
  - `contact-identity.owned.db.test.mjs` (header: mock `fetch` to throw, seed one admin, one manager, one agent):
    - `phoneMatchSql matches every pair today's match matched, plus 00852`. For stored values {`91234567`, `85291234567`, `0085291234567`, `442079460958`} and params {`85291234567`, `442079460958`}, it returns a superset of the old expression's matches, and the only additions are the `00852` rows.
    - `marketing identity sees an opted-out peer stored as 00852` (Fact 14). Contact W is `85291234567` and opted out. Contact X is `0085291234567`, opted in, with no member. Then `SELECT <marketingIdentitySafeSql('c')> FROM crm_contacts c WHERE id=X` is `false`, and `campaignRecipientPrimarySql` treats X and W as one phone.
    - `a website enquiry typed as 00852 joins the existing contact without changing consent or name` (Review Focus 6). An existing contact is `85291234567`, named 「陳太」, with `opt_in_whatsapp=false`. `createWebsiteInquiry({phone:"00852 9123 4567", name:"Chan", consentWhatsapp:true})` → one contact, name 「陳太」, `opt_in_whatsapp=false`, and a new lead on that contact.
  - Run `npm run test:phone-identity` and `npm run test:contact-identity:db`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:phone-identity`
  - `npm run test:contact-identity:db`
  - `npm run test:woztell` (`admin-workflow.test.mjs`, `woztell.test.mjs`)
  - `npm run test:contact` (`contact-links.test.mjs`)
  - `npm run test:property-experience` (`licence.test.ts`, website-inquiry tests, staff-ownership)
  - `npm run test:live-agent`
  - `npm run test:no-link`
  - `npm run test:admin-campaign:db`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(crm): one canonical phone normaliser and one SQL phone match for every customer path

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: A lead activity always belongs to the lead's own customer (B-10, no migration)

**Files:**
- **Modify `src/lib/neon/admin-data.server.ts:2880-2907`** (`createAdminLeadActivity`). The INSERT becomes:
  ```sql
  INSERT INTO crm_activities (lead_id, contact_id, staff_user_id, activity_type, body, due_at, completed_at)
  SELECT l.id, l.contact_id, $2, $3, $4, $5, $6 FROM crm_leads l WHERE l.id = $1::uuid
  RETURNING id
  ```
  `input.contact_id` is no longer read. Keep `assertLeadInScope` and the `writeAudit` (C-16 is FX-18). No row → `throw new Response("Not found", { status: 404 })`.
- **Modify `src/lib/neon/admin-data.types.ts:494-501`:** `contact_id?: string | null; /** Ignored by the server since FX-12 (B-10); the lead decides. */`. `admin.leads.tsx` keeps sending it, untouched (the `addNote` slice).
- **Extend `contact-identity.owned.db.test.mjs`.**

- [ ] **Step 1: write the failing tests:**
  - `activity contact comes from the lead, never from the client` (B-10). Lead L belongs to contact K, and another contact is Z. An agent who owns L calls `createAdminLeadActivity({lead_id:L, contact_id:Z, activity_type:"note", body:"x", due_at:null, completed_at:null})`. The row has `contact_id=K`. The same call with `contact_id` omitted also gives `K`.
  - `a stale tab after a phone correction still files the note on the lead's current contact`. Relink L's `contact_id` to K2 (the live-agent correction path, `UPDATE crm_leads SET contact_id=…, updated_at=now()`), then call with the old K → `contact_id=K2`.
  - `agent scope is unchanged`. An agent on another agent's lead → 403, and no row.
  - Run `npm run test:contact-identity:db`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:contact-identity:db`
  - `npm run test:command-center` (`crm-note-save.test.ts`, `command-center.test.mjs`)
  - `npm run test:lead-integrity:db` (the FX-09 note test still leaves the version unchanged)
  - `npm run test:admin-daily-work:ui`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(crm): derive a lead activity's contact from the lead instead of the client

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: The review table (migration), and ingest stores a conflicted message in a 「身分待核對」 conversation (C-04)

**Files:**
- **Create `neon/migrations/20261013100000_contact_identity_review.sql`:**
  ```sql
  -- FX-12 / C-04 and D-12. One list of contact identity problems for managers.
  -- A WhatsApp message whose member id and phone point at different contacts is
  -- stored in a review conversation and listed here instead of failing ingest.
  -- Phone format duplicates found by scripts/neon/normalize-contact-phones.mjs
  -- are listed here too. Nothing is merged automatically.
  -- Additive and re-runnable. No existing row is written. No function or
  -- trigger is replaced, so there is no revert file. The table can stay.
  -- Comments avoid semicolons and quotes because apply-migrations.mjs splits
  -- the file on them.
  SET LOCAL lock_timeout = '5s';

  CREATE TABLE IF NOT EXISTS crm_contact_identity_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reason text NOT NULL CHECK (reason IN ('whatsapp_identity_conflict','phone_format_duplicate')),
    contact_a uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
    contact_b uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'open'
      CHECK (status IN ('open','linked','same_person','different_people','dismissed')),
    linked_contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
    resolution_note text,
    CONSTRAINT crm_contact_identity_reviews_distinct CHECK (contact_a IS DISTINCT FROM contact_b),
    CONSTRAINT crm_contact_identity_reviews_resolved CHECK ((status = 'open') = (resolved_at IS NULL)),
    CONSTRAINT crm_contact_identity_reviews_shape CHECK (
      (reason = 'whatsapp_identity_conflict' AND conversation_id IS NOT NULL)
      OR (reason = 'phone_format_duplicate' AND contact_a IS NOT NULL AND contact_b IS NOT NULL
          AND contact_a < contact_b AND conversation_id IS NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_review_open_conversation
    ON crm_contact_identity_reviews (conversation_id)
    WHERE reason = 'whatsapp_identity_conflict' AND status = 'open';
  CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_review_duplicate_pair
    ON crm_contact_identity_reviews (contact_a, contact_b)
    WHERE reason = 'phone_format_duplicate';
  CREATE INDEX IF NOT EXISTS idx_identity_review_open
    ON crm_contact_identity_reviews (created_at DESC) WHERE status = 'open';
  CREATE INDEX IF NOT EXISTS idx_identity_review_conversation_linked
    ON crm_contact_identity_reviews (conversation_id) WHERE status = 'linked';
  ```
  The duplicate-pair index is unique **across every status**. A pair staff already marked 不同客戶 is never re-listed by a second script run.
- **Modify `src/lib/control-plane/migration-versions.js`:** append after `:129`. Set the pinned counts (`performance-readback-owned.db.test.mjs:16`, `link-bulk-owned.db.test.mjs:23`) 92 → **93**.
- **Modify `src/lib/woztell/woztell-ingest.server.ts:173-287`.** The statement gains these CTEs. The existing ones keep their text except where noted. `phoneMatchSql` comes from Task 1.
  ```sql
  WITH matched AS (…unchanged…),
  conv AS (SELECT id, contact_id FROM whatsapp_conversations
           WHERE $2::text IS NOT NULL AND woztell_member_id=$2 AND (channel_id=$7 OR channel_id IS NULL)
           ORDER BY (channel_id=$7) DESC NULLS LAST LIMIT 1),
  staff_linked AS (SELECT conv.contact_id AS id FROM conv
           WHERE conv.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contact_identity_reviews r
             WHERE r.conversation_id=conv.id AND r.status='linked')),
  valid AS (SELECT * FROM crm_contacts WHERE id=(SELECT id FROM staff_linked)
            UNION ALL (…today's valid… AND NOT EXISTS(SELECT 1 FROM staff_linked) … LIMIT 1)),
  fill_collision AS (SELECT 1 FROM valid v WHERE NOT EXISTS(SELECT 1 FROM staff_linked) AND (
      (v.normalized_phone IS NULL AND $1::text IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contacts o
         WHERE o.id<>v.id AND <phoneMatchSql('o.normalized_phone','$1')>))
   OR (v.whatsapp_member_id IS NULL AND $2::text IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contacts o
         WHERE o.id<>v.id AND o.whatsapp_member_id=$2)))),
  conv_conflict AS (SELECT 1 FROM conv, valid v WHERE conv.contact_id IS NOT NULL AND conv.contact_id<>v.id),
  review AS (SELECT ($2::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff_linked) AND (
      EXISTS(SELECT 1 FROM crm_contact_identity_reviews r JOIN conv ON r.conversation_id=conv.id WHERE r.status='open')
      OR (EXISTS(SELECT 1 FROM matched) AND NOT EXISTS(SELECT 1 FROM valid))
      OR EXISTS(SELECT 1 FROM fill_collision) OR EXISTS(SELECT 1 FROM conv_conflict))) AS yes),
  opt_out AS (…unchanged…),
  updated_contact AS (… today, plus: normalized_phone and whatsapp_member_id keep c.* when staff_linked …
      FROM valid v, opt_out o, review rv WHERE c.id=v.id AND NOT rv.yes RETURNING c.id),
  review_opt_out AS (UPDATE crm_contacts c SET <the same seven FX-08 opt-out assignments as updated_contact>, updated_at=now()
      FROM matched m, opt_out o, review rv WHERE c.id=m.id AND rv.yes AND o.new_opt_out RETURNING c.id),
  new_contact AS (… AND NOT (SELECT yes FROM review) …),
  contact AS (…unchanged…),
  updated_conversation AS (… unchanged …),
  new_conversation AS (… unchanged …),
  review_conversation AS (
      UPDATE whatsapp_conversations wc SET channel_id=COALESCE(wc.channel_id,$7),
        last_message_at=GREATEST(wc.last_message_at,$8::timestamptz),
        last_inbound_at=GREATEST(wc.last_inbound_at,$6::timestamptz), updated_at=now()
      FROM conv, review rv WHERE rv.yes AND wc.id=conv.id RETURNING wc.id),
  review_new_conversation AS (
      INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
      SELECT NULL,$2,$7,$8::timestamptz,$6::timestamptz FROM review rv
      WHERE rv.yes AND NOT EXISTS(SELECT 1 FROM conv) ON CONFLICT DO NOTHING RETURNING id),
  conversation AS (SELECT id FROM updated_conversation UNION ALL SELECT id FROM new_conversation
      UNION ALL SELECT id FROM review_conversation UNION ALL SELECT id FROM review_new_conversation),
  message AS (… the same INSERT, but SELECT … FROM (SELECT id FROM contact UNION ALL
      SELECT NULL::uuid FROM review rv WHERE rv.yes) c … so contact_id is NULL in review …),
  review_row AS (
      INSERT INTO crm_contact_identity_reviews(reason,contact_a,contact_b,conversation_id,evidence)
      SELECT 'whatsapp_identity_conflict',
        (SELECT id FROM matched WHERE whatsapp_member_id=$2 LIMIT 1),
        (SELECT id FROM matched WHERE <phoneMatchSql('normalized_phone','$1')>
           AND id IS DISTINCT FROM (SELECT id FROM matched WHERE whatsapp_member_id=$2 LIMIT 1)
           ORDER BY (normalized_phone=$1) DESC, id LIMIT 1),
        (SELECT id FROM conversation LIMIT 1),
        jsonb_build_object('kind', CASE WHEN EXISTS(SELECT 1 FROM conv_conflict) THEN 'conversation_owner'
                                        WHEN EXISTS(SELECT 1 FROM fill_collision) THEN 'fill_collision'
                                        ELSE 'member_phone_mismatch' END,
                           'messageCount',1,'lastMessageAt',$8::timestamptz,
                           'optOutApplied',EXISTS(SELECT 1 FROM review_opt_out))
      FROM review rv WHERE rv.yes
      ON CONFLICT (conversation_id) WHERE reason='whatsapp_identity_conflict' AND status='open'
      DO UPDATE SET updated_at=now(), evidence=crm_contact_identity_reviews.evidence
        || jsonb_build_object('messageCount',COALESCE((crm_contact_identity_reviews.evidence->>'messageCount')::int,0)+1,
                              'lastMessageAt',$8::timestamptz)
      RETURNING id),
  …verified_evidence / accepted_intent / accepted_transcript unchanged…
  SELECT (SELECT id FROM contact LIMIT 1) AS contact_id,(SELECT id FROM conversation LIMIT 1) AS conversation_id,
         EXISTS(SELECT 1 FROM message) AS inserted,(SELECT yes FROM review) AS identity_review
  ```
  - `contact_a` is the member owner and `contact_b` the phone owner. For `conversation_owner`, use `conv.contact_id` and the `valid` contact.
  - `evidence` never holds a phone or a member id.
  - Params are unchanged (`$1`–`$16`). FX-08's `opt_out` and FX-09's profile-name terms are untouched.
- **Modify the JS tail (`:276-298`).**
  - `IngestOutcome` gains `identityReview: boolean`.
  - Throw `WOZTELL_IDENTITY_CONFLICT` only when `!row || (memberId && !row.conversation_id)`. That is now an impossible state, so the text that `woztell.test.mjs:332` matches stays.
  - When `row.identity_review`, log `console.warn("WA_IDENTITY_REVIEW", { conversationId })`: an id only, no PII.
- **Modify `src/lib/whatsapp-enquiries/workflow.server.ts:55`.** Append `AND m.contact_id IS NOT NULL` to the enquiry-event `WHERE`, so that a review message never gets an enquiry event, a job, routing or an auto-reply. A normal-path message always has a contact (Fact 8). No hand-made schema needs the new table.
- **Create `src/lib/woztell/woztell-ingest.owned.db.test.mjs`** (the fix-plan file; one container; real migrations; events built as in `woztell.test.mjs` with `normalizeWoztellEvent`). Call `ingestWoztellEvent(event, origin, undefined, { mode: "observe", signedEvent: true, schemaAvailable: async () => true, wake: () => {} })`.

- [ ] **Step 1: write the failing tests** in `woztell-ingest.owned.db.test.mjs`:
  - `migration is additive and re-runnable`:
    - Re-running the file text raises no error.
    - Every other table's `md5(string_agg(t::text,…))` is unchanged.
    - `MIGRATION_VERSIONS.includes("20261013100000_contact_identity_review.sql")`.
    - The file has no `;` or `'` inside a `--` comment.
  - `member conflict → message stored in review conversation, not lost` (fix-plan name; C-04 case a):
    1. Contact X has `85255550101` and member `synthetic-fx12-m1`. An inbound arrives as (`85255550101`, `synthetic-fx12-m2`).
    2. It resolves with no throw.
    3. Exactly one `whatsapp_messages` row with that text exists, with `contact_id IS NULL` and `conversation_id` = a conversation of member m2 with `contact_id IS NULL`.
    4. One open review exists with `reason='whatsapp_identity_conflict'`, `contact_a IS NULL`, `contact_b=X`, `evidence.kind='member_phone_mismatch'`.
    5. A second message from m2 is appended to the same conversation, there is still one open review, and `evidence.messageCount=2`.
  - `review path writes no contact field, no lead and no enquiry event`. After the case above, X's whole row is unchanged (`md5(row)`), the `crm_leads` count is unchanged, there are 0 new `whatsapp_enquiry_events`, and there are 0 new `ops_jobs`.
  - `a blank fill that would collide goes to review instead of a 23505` (case b). Two variants:
    - Contact W has member m3 and phone NULL, and contact Y has `85255550102` and member NULL. The event (`85255550102`, m3) → review, `evidence.kind='fill_collision'`, and neither row changes.
    - Contact Y has `55550103` (8-digit legacy) and member NULL, and contact W has member m4 and phone NULL. The event (`85255550103`, m4) → review, with no error and no rows changed.
  - `a conversation owned by another contact goes to review and commits no contact write` (case c). Conversation (channel, m5) has `contact_id=Z`. The event matches contact V by phone (member NULL) → review, message in Z's conversation with `contact_id NULL`, and **V unchanged** (today V's `last_inbound_at` and member fill would commit).
  - `STOP in a conflicted message opts out every matched contact` (FX-08 / D4, Open question 2). A case-a conflict whose text is `STOP`:
    - X now has `opted_out_whatsapp=true`, `opted_out_source='customer_message'` and `opted_out_message_id` = the external id.
    - The review has `evidence.optOutApplied=true`.
    - A redelivery of the same message changes nothing.
    - A `history_import` STOP opts out nobody.
  - `two contacts holding the 8-digit and 852 forms: ingest picks the same contact as today` (Review Focus 1), for three seeds:
    - (i) A=`55550104`, B=`85255550104`, neither with a member: inbound (`85255550104`, m6) attaches to B and fills B's member.
    - (ii) A=`55550105` with member m7, B=`85255550105`: inbound (`85255550105`, m7) attaches to A.
    - (iii) after (i), a second inbound attaches to B again.
    - In all three, no review row is created and nothing errors. The expected pick is also computed with the **old** SQL text (kept verbatim in the test as `LEGACY_MATCH`) and asserted equal.
  - `a normal message is unchanged by FX-12`. No contact matches: a new contact, conversation, message, enquiry event and one lead, as today (golden counts).
  - `history import of a conflicted message also lands in review`. With `origin='history_import'`: stored in review, no opt-out, no lead.
  - `exhausted receipts from a conflict now project when a manager retries`. Store a receipt through `storeInboundReceipt`, then `markInboundReceipt(id,'failed','PROJECTION_FAILED')` with `attempt_count=20`. `retryInboundReceipt(id, manager, …)` → `projectionState:'projected'`, and the message is in the review conversation.
  - Run `npm run test:contact-identity:db`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:contact-identity:db`
  - `npm run test:woztell` and `npm run test:woztell:owned:db` (FX-08 opt-out)
  - `npm run test:no-link` (PGlite ingest)
  - `npm run test:no-link:local-postgres` (golden; the counts must be unchanged)
  - `npm run test:lead-integrity:db` (FX-09 trigger and profile name)
  - `npm run test:whatsapp-enquiries`
  - `npm run test:control-plane` (manifest order, test-wiring)
  - `npm run test:property-experience` (staff-ownership: `resolved_by` is classified)
  - `npm run test:admin-performance:db` and `npm run test:admin-link-bulk:db` (pins = 93)
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): store identity-conflicted messages in a review conversation instead of failing ingest

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: The 「可能重複客戶」 / 「身分待核對」 list in `/admin/leads`, resolution, inbox badge and reply gate

**Files:**
- **Create `src/lib/neon/contact-identity-review.server.ts`** (`import "@tanstack/react-start/server-only"`). Every function takes `actor` and refuses non-manager roles with a 403 `Response`.
- **Create `src/lib/neon/contact-identity-review.ts`.** Server functions with Zod `.strict()` validators and `requireStaffAccess(getRequest(), ["admin","manager"])`, called **only** through `callStaffServerFn` (pattern `enquiry-resolution.ts`). Add the file to `MIGRATED` in `src/lib/neon/staff-server-fn.contract.test.mjs:28-48`.
- **Create `src/components/admin/leads/ContactIdentityReviewList.tsx`** (+ `.test.tsx`), using `Table`, `Badge`, `Button`, `Dialog`, `Textarea`, `Alert` and `toast`.
- **Modify `src/routes/admin.leads.tsx`:**
  - In `LeadFilters` and `parseLeadFilters` (`:104-176`), add `review?: "identity"`.
  - In the quick-filter bar (`:1004-1019`), add a third `Button` 「可能重複客戶（N）」, rendered only for admin/manager roles from `useStaffSession`.
  - When `filters.review === "identity"`, render `<ContactIdentityReviewList />` in place of the lead table.
  - New imports go after the existing `@/lib/admin` imports (`:99-101`). Do not touch the `addNote`→`markStage` slice.
- **Modify `src/lib/neon/admin-data.server.ts:1017-1054` and `admin-data.types.ts:738-745`.** Add `identityReviewsOpen` (`count(*) FROM crm_contact_identity_reviews WHERE status='open'` when the actor is admin/manager, else `0`).
- **Modify `src/lib/neon/admin-pagination-query.ts:61-67`.** Add `EXISTS(SELECT 1 FROM crm_contact_identity_reviews ir WHERE ir.conversation_id=w.id AND ir.status='open') AS identity_review`. `next_action` is `'review'` when it is true.
- **Modify `src/routes/admin.whatsapp.tsx`.** When `identity_review`, show a `Badge` 「身分待核對」 on the row and an `Alert` above the thread with a link 「前往核對」 to `/admin/leads?review=identity&item=<reviewId>`. Hide the composer, and add `IDENTITY_REVIEW_REQUIRED` to the reason maps at `:128-131` and `:2217-2220`.
- **Modify `src/lib/woztell/outbound-intent.server.ts:137-147`.**
  - The `authorized` CTE adds `AND NOT EXISTS(SELECT 1 FROM crm_contact_identity_reviews ir WHERE ir.conversation_id=wc.id AND ir.status='open')`.
  - Before the statement, a read-only `SELECT EXISTS(...)` maps the case to `invalid("IDENTITY_REVIEW_REQUIRED")`. The CTE stays the race-safe guard.
- **Modify `scripts/browser-fixtures/build-admin-daily-work.mjs`** (alias list `:18+`): alias `@/lib/neon/contact-identity-review` to a new `scripts/browser-fixtures/daily-work/identity-review-api.ts` stub (two reviews, one of each reason; resolve returns ok, or a 409 on the second call for the same id).
- **Create `e2e/admin-identity-review.spec.ts`.** Copy the loopback `beforeAll`/`afterAll` from `admin-daily-work.spec.ts`. Insert `"admin-identity-review.spec.ts",` into `playwright.admin-owned.config.ts` after `"admin-daily-work.spec.ts",`. Add `"test:admin-identity-review:ui"` to `package.json` after the Task 1 lines, and a CI line after `ci.yml:88` (`test:admin-performance:ui`), clear of #237's insert after `:90`.
- **Extend `package.json` `test:phone-identity`** with `&& bun test --no-env-file src/components/admin/leads/ContactIdentityReviewList.test.tsx`.

**Interfaces:**
```ts
// contact-identity-review.server.ts
export type IdentityReviewReason = "whatsapp_identity_conflict" | "phone_format_duplicate";
export type IdentityReviewAction =
  | "link_a" | "link_b" | "link_new"                        // conflict only
  | "same_person" | "different_people" | "dismiss";         // duplicate only
export type IdentityReviewContact = {
  id: string; name: string | null; maskedPhone: string | null; // "•••• 4567"; never the full number
  hasWhatsapp: boolean; optedOut: boolean; openLeadIds: string[]; leadCount: number;
};
export type IdentityReviewRow = {
  id: string; reason: IdentityReviewReason; status: "open" | "linked" | "same_person" | "different_people" | "dismissed";
  a: IdentityReviewContact | null; b: IdentityReviewContact | null;
  conversationId: string | null; messageCount: number; lastMessageAt: string | null;
  createdAt: string; resolvedAt: string | null; resolvedByName: string | null; note: string | null;
};
export async function listContactIdentityReviews(
  input: { status: "open" | "resolved"; cursor?: string | null }, actor: StaffAccess,
): Promise<{ rows: IdentityReviewRow[]; nextCursor: string | null; openCount: number }>;
/** One statement: lock the review FOR UPDATE WHERE status='open', apply, audit_logs row
 *  ('contact.identity_review.resolve', metadata {reviewId, reason, action}; no phone) in the same CTE.
 *  link_*: UPDATE whatsapp_conversations SET contact_id=<chosen>; UPDATE whatsapp_messages SET contact_id=<chosen>
 *  WHERE conversation_id=<conv> AND contact_id IS NULL (fires the FX-09 trigger UPDATE path: first lead only
 *  if the contact has none); fill <chosen>.whatsapp_member_id only if NULL and no other contact holds it;
 *  link_new inserts crm_contacts(name=<WhatsApp profile name or NULL>, whatsapp_member_id=<member>,
 *  source='whatsapp', opt_in_whatsapp=false). Never writes a phone, consent or name on an existing contact.
 *  Errors: 409 REVIEW_ALREADY_RESOLVED (not open), 400 REVIEW_ACTION_NOT_ALLOWED (action/reason mismatch,
 *  or link_a/link_b when that side is null), 404 Not found. */
export async function resolveContactIdentityReview(
  input: { id: string; action: IdentityReviewAction; note?: string | null }, actor: StaffAccess,
): Promise<{ ok: true; status: IdentityReviewRow["status"]; linkedContactId: string | null }>;
```

**Copy table (zh-HK, all [owner copy]):**

| Key / place | Text |
|---|---|
| Quick filter button | 可能重複客戶（{N}） |
| List title / description | 可能重複客戶 / 系統發現以下客戶記錄可能屬於同一人，請逐一核對。系統不會自動合併。 |
| Reason badge: conflict / duplicate | 身分待核對 / 電話格式重複 |
| Conflict explanation | 此 WhatsApp 訊息的帳戶與電話分屬不同客戶記錄。訊息已保存，請選擇正確客戶。 |
| Conflict actions | 連結到「{A 名稱}」 / 連結到「{B 名稱}」 / 建立新客戶 |
| Duplicate actions | 同一客戶（暫不合併） / 不同客戶 / 略過 |
| Note field label | 備註（可選） |
| Confirm dialog title / button | 確認處理？ / 確認 |
| Success toast | 已處理。 |
| 409 `REVIEW_ALREADY_RESOLVED` | 此項目已由其他同事處理，請重新載入。 |
| 400 `REVIEW_ACTION_NOT_ALLOWED` | 此操作不適用於這個項目。 |
| Empty state | 暫時沒有需要核對的客戶記錄。 |
| Inbox badge / alert / link | 身分待核對 / 此對話身分待核對：訊息已保存，但未連結客戶，暫時不能回覆。 / 前往核對 |
| Reply refusal `IDENTITY_REVIEW_REQUIRED` | 此對話身分待核對，請先確認客戶身分再回覆。 |

- [ ] **Step 1: write the failing tests.**
  - `ContactIdentityReviewList.test.tsx`:
    - `renders masked phones only`. The markup contains `•••• 0101` and no 8-digit run (`/\d{8}/` does not match).
    - `a conflict row offers the three link actions and no duplicate actions`.
    - `a duplicate row offers 同一客戶（暫不合併）, 不同客戶 and 略過 and no link action`.
    - `the empty state shows the empty copy`.
  - `contact-identity.owned.db.test.mjs`:
    - `only managers and admins can list or resolve` (fix-plan access rule). An agent gets 403 from `listContactIdentityReviews` and from `resolveContactIdentityReview`, and `getAdminAttentionCounts(agent).identityReviewsOpen === 0`.
    - `link_b attaches the stored messages to B and opens B's first lead`. Seed a Task 3 case-a review. Resolve `link_b` as the manager:
      - the conversation has `contact_id=X`, and every NULL message has `contact_id=X`;
      - X's `whatsapp_member_id` is unchanged (it is m1, so it is not overwritten);
      - X gets a lead only if it had none (FX-09 UPDATE path);
      - the review has `status='linked'`, `resolved_by=manager` and `linked_contact_id=X`;
      - there is one `audit_logs` row with no phone in its metadata.
    - `after a manager links the conversation, the next message lands there and opens no new review` (Review Focus 3). After `link_b`, a new inbound from m2:
      - lands in the same conversation with `contact_id=X`;
      - creates 0 new review rows;
      - leaves X's `whatsapp_member_id` and `normalized_phone` unchanged (`staff_linked` path: no fills).
    - `link_new creates a contact with the member and no phone or consent`.
    - `a second resolve of the same review → 409 REVIEW_ALREADY_RESOLVED`, and an action/reason mismatch → 400. Neither writes anything.
    - `duplicate decisions never merge or edit contacts`. `same_person`, `different_people` and `dismiss` each change only the review row. Both contacts, their leads and their conversations are byte-identical (`md5`).
    - `a reply to a conversation under review is refused`. `enqueueOutboundIntent` on the review conversation as the manager → `IDENTITY_REVIEW_REQUIRED`, and 0 intents. After `link_b`, it succeeds (the mocked provider is never called in this test).
    - `the inbox marks the review conversation and counts it for managers`. The paginated conversations page shows `identity_review=true` and `next_action='review'`. `unansweredConversations` includes it for the manager and excludes it for the agent.
  - `e2e/admin-identity-review.spec.ts`:
    - `a manager filters 可能重複客戶, resolves a conflict and sees it leave the open list`.
    - `a second tab's resolve shows 此項目已由其他同事處理，請重新載入。`.
    - `an agent sees no 可能重複客戶 button`.
    - Capture screenshots at 375 px and 1440 px into `.audit/remediation-20261003/`.
  - Run `npm run test:phone-identity`, `npm run test:contact-identity:db` and `npm run test:admin-identity-review:ui`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - the three suites above
  - `npm run test:staff-server-fn`
  - `npm run test:command-center`
  - `npm run test:admin-daily-work:ui`
  - `npm run test:whatsapp-safety:ui`
  - `npm run test:woztell:owned:db` (outbound intents)
  - `npm run test:lead-integrity` (the `UPDATE crm_leads` scanner stays green: FX-12 adds none)
  - every `playwright.admin-owned.config.ts` suite
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- [ ] **Step 4: commit.**
  ```
  feat(admin): review list for possible duplicate customers and identity conflicts, manager+ only

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

**PR A rollback:** revert the PR. Conflicted messages already stored in review conversations stay stored and readable. With the old code, the next message from that member fails again, and its receipt keeps it. The table can stay.

---

## PR B — campaign retry across the rewrite, and the data script (cut from `main` after PR A is deployed)

### Task 5: A format-only phone rewrite neither blocks nor widens a campaign retry (FX-10b digest)

**Why.** The script turns `91234567` into `85291234567`, which changes `sha256('fx10b-identity-v1|member|phone')` (Fact 13). Without this task, every failed recipient on a legacy 8-digit contact would be refused as `CONTACT_CHANGED_SINCE_ATTEMPT`, a wrong block. Treating *any* change as harmless would be wrong the other way.

**Design.**
- The match accepts exactly one extra digest: the legacy 8-digit spelling of the **same** canonical HK number with the **same** member id.
  - It does not accept the `00852` spelling, which still blocks: that send went to a different member id string.
  - It does not accept any other number or member.
- The script does **not** bump `crm_contacts.updated_at` (Task 6), so the time test (`updated_at <= queued_at`) still blocks every real edit and every inbound message. It never blocks the rewrite.
- The send target for a contact with no member id moves from the invalid `91234567` to `85291234567`, the same subscriber.

**Files:**
- **Modify `src/lib/neon/campaign-retry.ts:121-129`** (`campaignAttemptedIdentityMatchesSql`):
  ```sql
  (r.attempted_identity IS NULL
   OR r.attempted_identity = <digest(k.member, k.normalized_phone)>
   OR (k.normalized_phone ~ '^852[0-9]{8}$'
       AND r.attempted_identity = <digest(k.member, right(k.normalized_phone, 8))>))
  ```
  Factor the digest into `campaignIdentityDigestOfSql(memberExpr, phoneExpr)` so the two uses cannot drift. The version string stays `fx10b-identity-v1`.
- **Extend `src/lib/neon/campaign-recovery-owned.db.test.mjs`** (in `test:admin-campaign:db`, CI `:166`).

- [ ] **Step 1: write the failing tests:**
  - `a format-only phone rewrite neither blocks nor widens a campaign retry` (Review Focus 4):
    1. Contact K is `55550201`, with no member, opted in.
    2. The campaign attempt fails with a retryable error, so `attempted_identity = digest('', '55550201')`.
    3. `UPDATE crm_contacts SET normalized_phone='85255550201' WHERE id=K`, **without** touching `updated_at` (the script's write).
    4. `requeueFailedCampaignRecipients` re-queues K, and `beginCampaignDispatch` allows it. The mocked provider receives `memberId: "85255550201"`.
  - `a real change still blocks after the rewrite`. Same setup, then each of these gives `CONTACT_CHANGED_SINCE_ATTEMPT` and no provider call:
    - (a) the phone changed to `85255550299`;
    - (b) a member id was set (the digest member part changes);
    - (c) the stored value was `0085255550201` at the attempt (the 00852 spelling is not accepted);
    - (d) the phone was rewritten **and** `updated_at` was bumped (time test).
  - Run `npm run test:admin-campaign:db`. It must fail on the first test.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:admin-campaign:db`
  - `npm run test:admin-campaign-review:ui`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(campaigns): treat the legacy 8-digit spelling of the same HK number as the same retry identity

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 6: `scripts/neon/normalize-contact-phones.mjs`: dry-run, snapshot, rewrite, collisions to review, restore

**Files:**
- **Create `scripts/neon/normalize-contact-phones.mjs`** (+ `.d.mts` for the exported planner).
- **Create `scripts/neon/normalize-contact-phones.test.mjs`** (the fix-plan file; pure) and **`scripts/neon/normalize-contact-phones.owned.db.test.mjs`**.
- **Modify `package.json`** (after the PR A lines):
  ```
  "test:phone-normalize": "node --test scripts/neon/normalize-contact-phones.test.mjs",
  "test:phone-normalize:db": "node --experimental-test-module-mocks --test --test-concurrency=1 scripts/neon/normalize-contact-phones.owned.db.test.mjs",
  ```
  Add CI lines after `test:phone-identity` and after `test:contact-identity:db`.

**CLI:**
```
node scripts/neon/normalize-contact-phones.mjs                          # dry run (default): counts only
node scripts/neon/normalize-contact-phones.mjs --apply --confirm-count=<N>  # N must equal the dry run's rewrite count
node scripts/neon/normalize-contact-phones.mjs --restore <snapshot.json>          # dry run of the restore
node scripts/neon/normalize-contact-phones.mjs --restore <snapshot.json> --apply
```
- The database URL comes from `DATABASE_URL_UNPOOLED || DATABASE_URL`, read the way `apply-migrations.mjs:5-25` reads it.
- It refuses to start if `crm_contact_identity_reviews` is missing (PR A not applied). The message is `FX12_REVIEW_TABLE_REQUIRED`.
- It prints the database host name only: no password, no path.

**Interfaces:**
```js
/** Pure. rows: { id, normalized_phone }[]. Returns the plan with no I/O.
 *  rewrite: stored value is ^[0-9]{8}$ or ^00852[0-9]{8}$ and canonical = normalizePhone(stored) starts 852
 *  collision: some OTHER row holds any phoneEquivalentsSql spelling of canonical → no rewrite; one pair per
 *             (min id, max id), reason phone_format_duplicate (also pairs that are both already canonical
 *             spellings of one number, e.g. 55550301 + 0085255550301 + 85255550301 → 3 pairs, 0 rewrites)
 *  untouched: already canonical, international, or unparseable (counted, never written) */
export function planPhoneNormalization(rows): {
  rewrites: { id: string; before: string; after: string; format: "hk_8_digit" | "hk_00852" }[];
  collisionPairs: { contactA: string; contactB: string }[];
  counts: { total: number; canonical: number; hk8: number; hk00852: number; international: number;
            unparseable: number; rewrites: number; collisionPairs: number; contactsInCollisions: number };
};
/** Injected I/O so tests use owned Postgres. Never called by Claude against Neon. */
export async function runNormalizeContactPhones(opts: {
  mode: "dry-run" | "apply" | "restore-dry-run" | "restore-apply";
  confirmCount?: number; snapshotPath?: string; snapshotDir?: string; // default ".audit/fx12"
  query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  transaction: (statements: { statement: string; params?: unknown[] }[]) => Promise<unknown[]>;
  writeFile: (path: string, text: string) => Promise<void>; log: (line: string) => void; now?: Date;
}): Promise<{ counts: Record<string, number>; snapshotPath: string | null }>;
```

**Apply algorithm:**
1. Read `id, normalized_phone` in id order and plan.
2. If `confirmCount !== counts.rewrites`, refuse and write nothing. A refusal message makes the owner re-run the dry run.
3. **Write the snapshot** before anything else: `{ fx: "FX-12", version: 1, createdAt, host, rewrites: [{id,before,after}], collisionPairs }`. It is written to `<snapshotDir>/normalize-contact-phones-<UTC>.json` with mode `0600`, and the script reads it back to verify it.
4. Insert the collision pairs:
   ```sql
   INSERT INTO crm_contact_identity_reviews(reason,contact_a,contact_b,evidence)
   VALUES ('phone_format_duplicate',$1,$2,'{"source":"normalize-contact-phones"}')
   ON CONFLICT (contact_a, contact_b) WHERE reason='phone_format_duplicate' DO NOTHING
   ```
5. Rewrite each row in its own transaction:
   ```sql
   SELECT pg_advisory_xact_lock(hashtextextended('woztell-phone:' || $after, 0));
   UPDATE crm_contacts c SET normalized_phone=$after
     WHERE c.id=$id AND c.normalized_phone=$before
       AND NOT EXISTS(SELECT 1 FROM crm_contacts o WHERE o.id<>c.id AND o.normalized_phone = ANY(<phoneEquivalentsSql($after)>))
     RETURNING c.id;
   INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
     SELECT NULL,'contact.phone_normalized','contact',$id,
            jsonb_build_object('format',$format,'script','normalize-contact-phones','snapshot',$snapshotName)
     WHERE <the UPDATE returned a row>;
   ```
   - `updated_at` is **not** written (Task 5).
   - A row that no longer matches `$before`, or that now collides, is counted as `skippedChanged` / `skippedNewCollision`. A new collision is inserted as a review pair.
6. Print the final counts only.

The ingest advisory lock is the same key (Fact 8), so an inbound message for that number waits for the row, or the row waits for it.

**Restore:**
- For each snapshot rewrite: `UPDATE crm_contacts SET normalized_phone=$before WHERE id=$id AND normalized_phone=$after` under the same lock, plus the audit action `contact.phone_normalize_restored`.
- A row changed since is skipped and counted.
- Review rows the run created stay. Staff dismiss them (Open question 7).

- [ ] **Step 1: write the failing tests.**
  - `normalize-contact-phones.test.mjs` (pure):
    - `plans 8-digit and 00852 rewrites and leaves international and garbage alone`.
    - `three spellings of one number give three pairs and no rewrite`.
    - `counts never include a phone or an id`. `JSON.stringify(counts)` has no 8-digit run.
    - `argument parsing refuses --apply without --confirm-count, and --confirm-count without --apply`.
  - `normalize-contact-phones.owned.db.test.mjs` (real migrations, synthetic contacts):
    - `dry-run no writes` (fix-plan name): `md5` of `crm_contacts`, `crm_contact_identity_reviews` and `audit_logs` is unchanged, no snapshot file is written, and the log lines contain no 8-digit run.
    - `snapshot is written before any write` (Review Focus 5). `writeFile` is injected to throw: the run rejects and every table is unchanged.
    - `collision → review row` (fix-plan name). `55550401` and `85255550401` → one `phone_format_duplicate` row with `contact_a < contact_b`, neither contact changed, and the count `collisionPairs=1`.
    - `apply rewrites only same-number spellings and never touches updated_at, phone, member, consent or name`.
    - `a second run rewrites nothing` (idempotent). It reports rewrites 0 and the same review count, and inserts 0 new rows.
    - `restore round-trip` (fix-plan name). Apply, then `restore-apply` from the snapshot: every rewritten row has its old value again, and the restore audit rows exist.
    - `restore skips rows changed since the snapshot`. One row is edited after apply. Restore leaves it alone and counts `skippedChanged=1`.
    - `--confirm-count mismatch writes nothing`.
    - `ingest finds the same contact before, during and after the rewrite` (Review Focus 1):
      - Contact `55550501` has member m8.
      - An inbound (`85255550501`, m8) attaches to it before the rewrite.
      - Run apply with the transaction paused after the advisory lock, and fire `ingestWoztellEvent` concurrently: it waits, then attaches to the same contact.
      - After the rewrite, the same contact again. No review row in any of the three.
    - `a dismissed pair is not re-listed`. Set a review to `different_people`, re-run apply: 0 new rows.
  - Run `npm run test:phone-normalize` and `npm run test:phone-normalize:db`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:phone-normalize`
  - `npm run test:phone-normalize:db`
  - `npm run test:contact-identity:db`
  - `npm run test:admin-campaign:db`
  - `npm run test:control-plane` (test-wiring)
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  feat(scripts): owner-run phone normalisation with dry run, snapshot, restore and duplicate review rows

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

**PR B rollback:** revert the PR. If the script was applied, run `--restore <snapshot> --apply` (the owner runs it). The review rows stay, and staff dismiss them.

## Owner actions before production

**Order:** approve this plan → PR A: Neon-branch migration → stuck-receipt count → sandbox check → production migration (explicit approval) → merge → canary → PR B: merge → **dry-run counts on a branch** → owner applies on the branch → staging spot-check → production dry-run → owner applies → canary. Nothing is applied anywhere without approval. Claude runs migrations and the script on owned test databases only.

**PR A**

1. **A1. Neon branch migration (owner's step).**
   - Run `npm run neon:migrate` against the **branch** URL. It applies `20261013100000_contact_identity_review.sql`.
   - Verify that `\d crm_contact_identity_reviews` has the three CHECKs and four indexes, `SELECT count(*) FROM crm_contact_identity_reviews` = 0, and `SELECT count(*) FROM app_migrations` = 93.
2. **A2. Read-only counts.** Run them on production before the migration, and on the branch. They print no phone.
   ```sql
   BEGIN READ ONLY;
   SELECT count(*) FILTER (WHERE normalized_phone ~ '^[0-9]{8}$') AS hk_8_digit,
          count(*) FILTER (WHERE normalized_phone ~ '^00852[0-9]{8}$') AS hk_00852,
          count(*) FILTER (WHERE normalized_phone ~ '^852[0-9]{8}$') AS hk_canonical,
          count(*) FILTER (WHERE normalized_phone IS NOT NULL
                           AND normalized_phone !~ '^(00852|852)?[0-9]{8}$') AS other_or_international
   FROM crm_contacts;
   SELECT count(*) AS duplicate_pairs
   FROM crm_contacts a JOIN crm_contacts b
     ON a.id < b.id AND right(a.normalized_phone,8) = right(b.normalized_phone,8)
    AND a.normalized_phone ~ '^(00852|852)?[0-9]{8}$' AND b.normalized_phone ~ '^(00852|852)?[0-9]{8}$';
   SELECT count(*) AS stuck_inbound_receipts
   FROM whatsapp_inbound_receipts
   WHERE projection_state = 'failed' AND block_reason = 'PROJECTION_FAILED';
   ROLLBACK;
   ```
   - `duplicate_pairs` is **the expected duplicate count**. The audit has no number (Fact 21). Audit headline 7 has at least one live pair.
   - `stuck_inbound_receipts` is the C-04 backlog (some may be other failures).
3. **A3. Sandbox (the WozTell sandbox channel and the owner's test number only, on the Neon branch).**
   1. As the owner, create a synthetic contact whose phone is the test number and whose `whatsapp_member_id` is `synthetic-fx12-old`.
   2. Message from the test phone. In 對話, a 「身分待核對」 conversation appears for a manager, with the message. There is no auto-reply and no new lead.
   3. The composer is hidden. 可能重複客戶 shows the item.
   4. 連結到「<synthetic contact>」. Send another message: it lands in the same conversation, no new review opens, and a manager can reply.
   5. Send `STOP` in step 2 instead: the contact shows 已退訂.
4. **A4. Production:** apply the migration with explicit approval, **then** merge PR A (FX-00 order).
5. **A5. Recover the C-04 backlog** (managers, Operations → inbound receipts). For each `retry_exhausted` receipt, press retry. It now lands in a 「身分待核對」 conversation. Then resolve each in 可能重複客戶. Retries never send anything (`retryInboundReceipt` is observe-only).
6. **A6. Canary (read-only, 48 h):**
   - In Vercel logs, `WA_IDENTITY_REVIEW` warnings are rare.
   - There are no `WOZTELL_IDENTITY_CONFLICT` errors.
   - `SELECT count(*) FROM whatsapp_inbound_receipts WHERE projection_state='failed' AND received_at > '<deploy>'` = 0.
   - `SELECT count(*) FROM whatsapp_messages WHERE contact_id IS NULL AND direction='inbound' AND created_at > '<deploy>'` equals the sum of the review rows' `messageCount`.

**PR B**

1. **B1. Merge PR B** (code only; it has no migration). The campaign retry digest (Task 5) must be live **before** any rewrite.
2. **B2. Branch dry run (owner):** `DATABASE_URL_UNPOOLED=<branch> node scripts/neon/normalize-contact-phones.mjs`. Compare the counts with A2: `hk8 + hk00852` minus the rows in collisions = `rewrites`, and `collisionPairs` ≈ `duplicate_pairs`. Share the counts (not the rows) for a go/no-go.
3. **B3. Branch apply (owner):** `--apply --confirm-count=<rewrites>`. Keep the snapshot private (it contains phones).
   - Re-run A2: `hk_8_digit` and `hk_00852` equal the rows in collisions only.
   - A second dry run shows `rewrites: 0`.
   - On a second throwaway branch, run `--restore <snapshot> --apply` and confirm that A2's counts return to the pre-apply values.
4. **B4. Staging spot-check** (Vercel preview on the branch, synthetic leads only):
   - 可能重複客戶 lists the collision pairs.
   - A form submission with `00852 5555 0601` joins the synthetic `85255550601` contact.
   - A campaign retry preview count is unchanged from before the apply.
5. **B5. Production:** the owner runs the dry run, compares it with B2, then runs `--apply --confirm-count=<N>`. Archive the snapshot privately for at least 90 days (Open question 6).
6. **B6. Canary:**
   - The campaign retry preview count on recent campaigns is unchanged.
   - Inbound messages per day are unchanged.
   - The 可能重複客戶 count goes down as staff work through it.
   - Then update the Status column in the audit doc (D-12, C-04, B-10) and `CHANGELOG.md`.

**Rollback:**
- PR A: revert the PR. The table and the stored messages stay. Messages from members already in review stay readable.
- PR B: revert the PR, then `--restore <snapshot> --apply` (owner).

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **May staff reply in a 「身分待核對」 conversation before it is linked?** **Default: no.** The reply would reach the right WhatsApp account, but the conversation has no contact, so the opt-out and 24-hour checks cannot see the customer's state. Linking takes one click (Task 4).
2. **A STOP or 退訂 inside a conflicted message.** **Default: opt out every contact it matched** (the member owner and the phone owner). This uses FX-08 evidence and is never auto-cleared. The cost is that a contact who did not send it stops getting campaigns until a manager clears it.
3. **Should a 「身分待核對」 conversation also send a WhatsApp alert to the duty manager?** **Default: not in FX-12.** It shows in the manager's unanswered count, as a 「身分待核對」 inbox badge, and in the 可能重複客戶 count. A WhatsApp alert needs a template variant and is an FX-05b follow-up. No WhatsApp inbound message alerts staff by WhatsApp today.
4. **A `+` followed by exactly 8 digits (`+9123 4567`).** **Default: treat it as Hong Kong** (`85291234567`). Today it is stored as `91234567`, and the public agent link becomes `wa.me/91234567` (wrong). Almost no other country fits 8 digits after `+`.
5. **Should the script bump `crm_contacts.updated_at`?** **Default: no.** It is a format-only rewrite of the same number. Bumping it would block every pending campaign retry for those contacts (Task 5). The evidence is the snapshot plus one `audit_logs` row per contact.
6. **Where is the snapshot kept, and for how long?** **Default: `.audit/fx12/` on the owner's machine (git-ignored, mode 0600), archived privately for 90 days, then deleted.** It holds old and new phones per contact id.
7. **After a `--restore`, should the duplicate review rows the run created be deleted?** **Default: no.** They describe real duplicates either way, so staff dismiss them in the list.
8. **Unparseable stored phones** (7 digits, letters, 9 digits). **Default: leave them untouched and only count them.** Staff fix them by hand from the contact page. Nothing guesses.
9. **International numbers stored without a country code** (e.g. a mainland number typed as 11 bare digits, `13812345678`). **Default: untouched.** They stay as typed digits, because guessing `86` could message a stranger.
10. **Duplicate pairs that staff mark 同一客戶（暫不合併）: who cleans them up?** **Default: the agent who owns the newer lead closes it as 已結束（未成交） with a note pointing at the other lead. The real merge is FX-18.**

## Findings that differ from the approved fix plan

1. **C-04 is wider than one throw.** Besides the named `WOZTELL_IDENTITY_CONFLICT` (member/phone mismatch), two more paths leave a customer stuck:
   - a blank member or phone fill that hits a UNIQUE index (a Postgres `23505`);
   - a member conversation owned by another contact. This one also **commits contact writes before throwing** (Fact 9).

   Task 3 routes all three to review.
2. **The message is not lost today; it is invisible.** The receipt keeps the text. The webhook answers 200, then 20 retries run, then `retry_exhausted` in Operations (Fact 10). The fix plan said "never drop the message", and the real gap is that staff never see it. Owner action A5 recovers the backlog through the existing manager retry.
3. **No SQL normaliser lives in a migration, so FX-12 replaces no function or trigger and needs no revert.** The "SQL copies" are TS/JS strings (Fact 5). The only migration-level comparisons (`crm_analysis_runs.sql:28,57`) are exact matches and become correct after the rewrite.
4. **No generated column.** A STORED generated column rewrites `crm_contacts` under an exclusive lock and duplicates the UNIQUE semantics. Canonical writes, the owner-run rewrite and a match that accepts every legacy spelling do the same job additively.
5. **The expected duplicate count is not in the audit report** (Fact 21). It comes from Owner action A2 and the script's dry run.
6. **The live agent is already canonical** (FX-03 merged, Fact 3). `live-agent.ts` is not edited, which avoids #237. Only the three SQL match fragments in `live-agent.server.ts` change.
7. **`licence.ts` is a staff namecard validator, not customer identity.** It keeps returning 8 digits, and staff phones are not rewritten. It only reuses the parser.
8. **`normalizeAdminPhone` has produced `852`+8 since 2026-09-25** (Fact 2). The live split comes from legacy rows, `00852`, `+`8 digits and full-width digits, not from five live normalisers disagreeing on the common case.
9. **There is a consent gap the fix plan does not list** (Fact 14). The marketing identity check does not recognise `00852` spellings, so an opted-out customer's `00852` website duplicate can be queued in a campaign. Task 1 closes it in PR A, before any data changes.
10. **B-10 stores a wrong foreign key but shows nothing on another customer today.** No reader uses `crm_activities.contact_id` (Fact 12). It is still fixed, server-side only, because the UI's `addNote` slice is pinned by `crm-note-save.test.ts`.
11. **The review table has more columns than the register lists.** It adds `conversation_id`, `evidence`, `status`, `linked_contact_id`, `updated_at` and `resolution_note`, so one table serves both C-04 conflicts and D-12 duplicates, and a staff link is durable (it is what stops the review loop, Review Focus 3).
12. **The campaign retry digest (FX-10b) must learn the legacy spelling** (Task 5) and **the script must not bump `updated_at`**. Otherwise the rewrite would block every pending retry for legacy contacts. The fix plan did not cover this interaction.
13. **The data-script test is split** into a pure `normalize-contact-phones.test.mjs` (fix-plan name) and an owned-Postgres `.owned.db.test.mjs`, so CI's DB job runs the database cases. The fix-plan test names are kept verbatim.
14. **Two PRs, sequential.** PR A must be deployed before the script runs, because ingest must already route fill collisions to review (Fact 9b) and the review table must exist.
