# FX-18a: Data hygiene and audit trail. Implementation plan (18a-1 and 18a-2), with outlines for 18b, 18c and 18d

**Owner decisions (pending, fill in after review):**
- The admin copy in "Copy for approval": approved as drafted / amended, item by item.
- The split: 18a-1 (CMS versions, FAQ soft delete, dead writers, transaction verify) cut from `main` after 17a-1 merges; 18a-2 (enquiry listing number, remaining audit folds) cut from `main` after #238 and #241 merge / changed.
- Open questions 1 to 8 below: defaults accepted / changed.
- 18c: the Neon-branch duplicate-email query result (B-11) before its unique index is written.

Fixed by the brief (owner priorities, in order):
1. **Never lose an enquiry or lead.** 18a-2 makes the public enquiry path accept any listing number and property id text; a value it cannot use is dropped from routing, never from the enquiry. A withdrawn listing keeps its link to the enquiry. No lead, contact or enquiry is deleted.
2. **Never send WhatsApp to the wrong person.** 18a sends nothing and touches no WhatsApp path. 18b (outline) carries the WhatsApp test rules.
3. **No unauthorised access.** Only admin and manager verify or publish a transaction, enforced in the server function and the SQL (B-04). FAQ restore is admin/manager on the server and in `cms_mutate`. The unused browser-callable `deleteAdminProperty`, `saveAdminEstate` and `saveAdminArticle` are removed.
4. **No corrupted or silently overwritten records.** FAQ and video saves carry a version and refuse a stale save with 409. FAQ delete becomes a soft delete that can be restored to the answer it had at deletion. Every 18a write inserts its audit row in the same statement or transaction, with before/after values.
5. **No migration.** Soft delete uses the existing `faqs.published` column and the `cms_content_revisions` table; the version token is a row hash; the raw listing number goes into the existing `inquiries.public_listing_no`. No new env var. No `vercel.ts` edit.
6. **Cut each PR from `main`. Never stack** on #238 to #243 or on 17a-1. Shared files and hunk rules are in fact 30.
7. **Copy.** Admin zh-HK only; every new or changed staff string is listed verbatim in "Copy for approval". No public copy changes.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- A FAQ or video edit cannot silently overwrite a colleague's newer save, and the audit log shows what changed (before/after) (C-12).
- Deleting a FAQ hides it from every public reader at once, and a manager can restore it with the answer it had when it was deleted (C-12).
- No 18a write can commit without its audit row (C-16).
- The unused hard-delete and unversioned CMS writers are gone; listings retire through 下架, as today (C-17, C-12 estate part).
- An agent cannot mark a transaction verified or published, and cannot edit one a manager has verified (B-04).
- A website enquiry about a withdrawn or unknown listing keeps the listing it was about, and is never rejected because of the listing fields (C-15).

Findings: C-12 (+ R-23), C-15, C-16, C-17, B-04.

**Split.** Seven tasks, but they fall on two sets of other people's hunks, so two PRs:

| PR | Branch | Tasks | Cut from `main` after | Theme |
|---|---|---|---|---|
| **18a-1** | `fix/fx-18a-data-hygiene` | 1 to 5 | **17a-1 merges** (and #240, see Task 2) | CMS versions and audit, FAQ soft delete, dead writers, transaction verify |
| **18a-2** | `fix/fx-18a2-enquiry-audit` | 6 and 7 | **#238 and #241 merge** | Enquiry listing number, audit folds on lead activity and enquiry status |

The current worktree branch `fix/fx-18a-data-hygiene` holds only this plan. Before Task 1, reset it to the `main` that contains 17a-1 (`git fetch && git reset --hard origin/main`, then cherry-pick this plan commit), or cut a fresh branch with the same name.

**Approach.**
- **Task 1 (C-12, C-16).** A pure `cms-row-version.ts` gives one token per FAQ and per video: an md5 of the staff-editable fields, rendered by Postgres, compared as a string. FAQ and video saves become one statement each: lock the old row, update only when the token matches, insert the audit row with before/after of changed fields. The FX-09 `updateAdminLead` CTE (`admin-data.server.ts:2730-2775`) is the template.
- **Task 2 (C-12).** FAQ delete becomes `cms_mutate('archive','faq',…)`, preceded in the same transaction by a snapshot of the live row into `cms_content_revisions` (FAQ edits bypass the revision engine, so the newest revision can be months old). Restore runs `cms_mutate('restore')` then `cms_mutate('publish')` in one transaction. The admin FAQ list shows archived rows behind a toggle with 還原. Imports skip archived questions.
- **Task 3 (C-17, C-12 estate part).** Delete `deleteAdminProperty`, `saveAdminEstate` and `saveAdminArticle` (no UI caller; estates and articles already save through `cms_mutate`). `saveAdminProperty` becomes create-only (Open question 3).
- **Task 4 (B-04).** `saveAdminTransaction` refuses `verified`/`published` from a non-manager and refuses an agent's edit of a verified or published row, in TS and in the `WHERE`. The form disables both switches for agents and says why.
- **Task 5 (C-16).** Transaction save, property create and property status insert their audit row in the same statement.
- **Task 6 (C-15).** The listing page sends its public listing number. The schema stops rejecting listing fields. `persistWebsiteInquiry` links the requested listing even if it is no longer active (routing to its agent still needs `active`) and stores the raw number in `inquiries.public_listing_no`. Lead screens fall back to it.
- **Task 7 (C-16).** `createAdminLeadActivity`, `completeAdminLeadActivity` and `updateInquiryStatus` insert their audit row in the same statement. A source test pins every audited create in `admin-data.server.ts`.

**Tech stack.** `node --test`, `bun test` (`react-dom/server` static render, as `CmsEditorFields.test.tsx`), owned Postgres (`withOwnedPostgres` + `mockOwnedServerDb`, as `lead-integrity.owned.db.test.mjs`), the SQL recorder in `admin-transactions.contract.test.mjs`. One new script, `test:data-hygiene:db`, joins the CI owned-DB job. No new dependency.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: C-12 (`:197`), C-15 (`:200`), C-16 (`:201`), C-17 (`:202`), B-04 (`:167`), R-23 (`:506`). Outline findings: C-14 (`:199`), B-11 (`:173`), B-12 (`:174`), D-07 (`:224`), D-09 to D-11 (`:225-227`), D-15 (`:230`), R-NEW-02 (`:407`), R-NEW-04 (`:409`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-18 (`:719-742`), Global constraints (`:17-39`), FX-09 version pattern (`:444-470`), migration register (`:787-801`).
- Format: FX-17a plan (`docs/audits/fx-plans/FX-17a-admin-safer-actions.md` on the **local** branch `fix/fx-17a-admin-safer-actions`; it is not on `origin` yet) and `FX-11a-ai-staff-guardrails.md` on `main`.

## Verified current behaviour (main `1216ab8d`, 2026-10-10)

No live admin or database was opened. Facts are from code on `main`.

| # | Fact | Where |
|---|---|---|
| 1 | **FAQ and video saves are last-write-wins with empty audit metadata.** `saveAdminFaq` updates by `id` only (`:2321-2326`); `saveAdminCmsVideo` likewise (`:2176-2190`). Both then call `writeAudit(...)` with `metadata = {}` after the write has committed (`:2353`, `:2208-2213`; `writeAudit` `:4684-4704`). | `src/lib/neon/admin-data.server.ts` |
| 2 | **FAQ delete is a hard `DELETE`** (`:2357-2362`), called from the CMS FAQ tab (`admin.cms.tsx:701-716`, dialog `:1820-1830` 「此操作無法復原」) and the estate editor (`AdminEstateEditorForm.tsx:402-410`, dialog `:879-881` 「刪除後無法還原」). Server permission: `cms.publish` (admin, manager) (`admin-data.ts:1035-1046`; `permissions.ts:20-37`). | as listed |
| 3 | **The CMS revision engine can already soft-delete a FAQ.** `cms_mutate` accepts `faq` (`20260905110000_cms_atomic_mutations.sql:23-37`). `archive` writes an `archived` revision, runs `UPDATE faqs SET published=false` (`:136-150`), supersedes the publication and inserts the audit row **in the same function** (`:151-152`). `restore` (admin/manager, `:39`, `:58-65`) creates a draft from a non-draft revision; `publish` (`:66-135`, FAQ branch `:116-120`) upserts `faqs … published=true`. `faqs.published boolean NOT NULL DEFAULT true` exists (`20260711090000_cms_content_revisions.sql:12-21`). | migrations |
| 4 | **But FAQ revisions are stale.** Every FAQ got a v1 `published` revision once, in July (`20260711090000…sql:84-93`). FAQ edits since then go through `saveAdminFaq`, which writes no revision (`admin-cms.ts:7-13` says so). `archive` copies the newest **published revision** payload (`:140`), so restoring after an archive would revive the July answer, not the current one. FAQs created after July have **no** revision, and `archive` raises `CMS_RESOURCE_NOT_FOUND` for them (`:141`). | as listed |
| 5 | **Estates and articles are already versioned and audited atomically.** `admin.cms.tsx` and `AdminEstateEditorForm.tsx` save, publish, restore and archive through `admin-cms.ts` → `cms_mutate` (draft edit version + base published version checks, `:44-57`, `:66-71`; audit `:151`). The revision payloads are the before/after record. `admin.cms-revision-wiring.contract.test.mjs:8-16` asserts the CMS no longer calls `saveAdminEstate` or `saveAdminArticle`. | as listed |
| 6 | **The unversioned estate and article writers are dead but callable.** `saveAdminEstate` (`admin-data.server.ts:2217-2272`) and `saveAdminArticle` (`:2274-2314`) have browser-callable wrappers (`admin-data.ts:1000-1022`, `cms.publish`) and no UI caller (grep). Pinned as exports in `admin-data.contract.test.mjs:18-19`; `saveAdminEstate` is a regex end-anchor in `cms-videos-schema.test.mjs:42`, `:56`. | as listed |
| 7 | **No version column for FAQs; the video `updated_at` moves on every sync.** `faqs` has no `updated_at` (comment at `:2415`). The YouTube sync rewrites `title`, `video_url` and `updated_at` of every managed video on each run (`youtube-repository.server.ts:62-108`), so an `updated_at` token would 409 staff after every sync. A row-hash precedent exists: `ep_content_source_revision` (`20261003040000_content_proposal_source_guard.sql:5-29`) and `md5(to_jsonb(f)::text)` in the knowledge index. | as listed |
| 8 | **Who reads FAQs.** Public: `fetchFaqs` filters `published` (`public-data.server.ts:1337-1350`), used by the homepage, `district.sham-tseng.tsx` and `estate.$slug.tsx` (incl. FAQPage JSON-LD). Public chatbot (FX-11b, on main): `published = true` (`live-agent-reply.server.ts:57`). Knowledge index (content copilot evidence): **no filter** on main (`knowledge.server.ts:248`, `knowledge-freshness.server.ts:31`); **#240 adds it**. Staff only: copilot context by id (`content-copilot-context.server.ts:118-125`), admin list (`admin-data.server.ts:2063-2071`, no filter, no `published` column returned). Sitemap: lists no FAQ URL (`sitemap[.]xml.ts`; #243's `sitemap-lastmod.js` reads no FAQ). | as listed |
| 9 | **Import overwrites in place.** The CMS import upserts each row with `ON CONFLICT (scope, question) DO UPDATE SET answer` (`:2329-2336`); the owner CLI does the same (`scripts/neon/import-faqs.mjs:34-58`). An archived question would get the new answer and **stay hidden**, while the import reports success. The preview reads `checkAdminFaqConflicts` (`:2372-2395`), which ignores `published`. | as listed |
| 10 | **Estate editor FAQ bugs.** Its save always sends `sort_order: 0` (`AdminEstateEditorForm.tsx:385-392`), resetting the order on every edit, and it ignores a returned `{ error }`, so 「FAQ 已儲存」 shows even when nothing saved (`:393-396`). | as listed |
| 11 | **C-17 confirmed.** `deleteAdminProperty` (`admin-data.server.ts:1359-1364`) hard-deletes; wrapper `admin-data.ts:515-528` (admin, manager); no UI caller (grep); pinned in `admin.routes.test.mjs:238`. Listings retire with `status='offline'` (下架) through `updateAdminPropertyStatus` (`:1339-1357`) and the workspace. | as listed |
| 12 | **`saveAdminProperty` still has an unversioned update branch.** `PropertyForm` is rendered only by the new-listing page (`admin.listings_.new.tsx:55`), so every UI save is an `INSERT`; edits go through the versioned workspace (`admin-properties.server.ts:30-31`, `ADMIN_PROPERTY_VERSION_SQL`). The `UPDATE` branch (`admin-data.server.ts:1288-1318`) is reachable only by a direct server-fn call by admin, manager or agent (own rows). | as listed |
| 13 | **B-04 confirmed, and wider.** The wrapper admits agents (`admin-data.ts:1193-1199`). The server has no role check before `const published = input.published ?? input.verified` (`admin-data.server.ts:1517`). An agent may also **edit** their own row that a manager verified: the `UPDATE` (`:1542-1572`) writes `verification_state` and `published` from input, so it can unverify or unpublish it. The form shows both switches to everyone (`TransactionForm.tsx:299-321`). Routes already compute `canSeeFinance` (admin or manager) (`admin.transactions_.$id.tsx:27-29`, `admin.transactions.tsx:77`). Contract tests use `AGENT_ACTOR` with a SQL recorder (`admin-transactions.contract.test.mjs:243-278`). | as listed |
| 14 | **C-16 confirmed.** About 30 `await writeAudit(` calls run after a committed write (`admin-data.server.ts`, grep). Ones where a retry duplicates a record: lead note/call `createAdminLeadActivity` (`:2880-2908`), transaction create (`:1596`), property create (`:1335`), FAQ/video create (`:2353`, `:2208`), campaign/audience create (`:3712`, `:3612`). Already atomic: `updateAdminLead` (`:2763-2773`), `cancelAdminCampaign` (`:4541-4547`), `cms_mutate`. | as listed |
| 15 | **C-15 confirmed, and the enquiry can be lost.** `persistWebsiteInquiry` links a listing only if `p.status = 'active'` (`website-inquiry.js:112-125`); otherwise `property_id` is NULL on the lead and the enquiry. The listing page form sends only `property_id` (`property-decision.js:20-29`, `PropertyInquiryForm.tsx:63-75`), never the number it shows (`property.$listingNo.tsx:1007-1010`). The public schema **rejects the whole enquiry** (Zod 400) when `listingNo` fails the pattern or `property_id` is not a UUID (`admin-data.ts:747-748`). | as listed |
| 16 | **A column for the raw number already exists.** `inquiries.public_listing_no text` (no constraint) (`20260912130000_whatsapp_enquiry_episodes.sql:46`), today filled only by WhatsApp episodes and shown in the inbox (`admin-pagination-query.ts:50`). `inquiries.crm_lead_id` links the enquiry to its lead (`20260905150000…sql:7-8`). The lead screens show `properties.listing_no` through `crm_leads.property_id` (`admin-pagination-query.ts:41`, `admin-data.server.ts:2569`, `admin.leads.tsx:1377-1380`, `:1586-1587`). | as listed |
| 17 | **Who may restore a CMS row.** `restoreAdminCmsRevision` and `publishAdminCmsRevision` require admin or manager (`admin-cms.server.ts:330-365`), and `cms_mutate` checks the role again (`:39`). The CMS FAQ tab is admin/manager only (`fetchAdminCms`, `admin-data.ts:529-537`). | as listed |
| 18 | **Transactions inside the DB helper.** `transactionRows(statements)` runs a fixed batch in one Neon transaction (`db.server.ts:25-36`); the owned harness supports it (`owned-postgres-test.mjs:152-153`). `pg_advisory_xact_lock` is re-entrant inside a transaction, so taking `cms:faq:<id>` before `cms_mutate` (which takes it again, `:37`) is safe. | as listed |
| 19 | **Copy pinned by tests.** `admin.cms.usability.test.mjs` and `admin.cms-revision-wiring.contract.test.mjs` read `admin.cms.tsx` source; `admin.routes.test.mjs:230-260` pins the protected wrapper list; `src/test-wiring.test.mjs` requires every test in a `test:*` script and every DB script in `ci.yml`. | as listed |
| 20 | **Migration count.** `MIGRATION_VERSIONS` has 92 entries; `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23` pin 92 (#238 makes it 93). 18a adds none, so neither pin moves. | as listed |

**Fact 30: open PR overlap** (`git diff origin/main...origin/<branch> --stat`; 17a-1 against the local branch):

| PR | Files it shares with 18a | Its hunks (main lines) | 18a rule |
|---|---|---|---|
| **17a-1** `fix/fx-17a-admin-safer-actions` (local only, not a PR yet) | `admin-data.server.ts` | `:3669-3712` (campaign save), `:4622-4625` (removes `queueCampaign`, right after `updateInquiryStatus`) | 18a-1 edits `:1226-1364`, `:1498-1602`, `:2046-2122`, `:2123-2432`. 18a-2 edits `updateInquiryStatus` `:4600-4620` **after** 17a-1 is on `main`. |
| | `admin-data.ts` | removes `:1888-1900` | 18a-1 removes `:515-528`, `:1000-1022`; adds `restoreAdminFaq` after `:1046`. |
| | `admin.cms.tsx` | `:520-545`, `:640-670`, `:1926-1935` (video dialog guard), `:2040-2060`, `:2081`, `:2203-2212`, `:2273-2295`, `:2316`, `:2408-2417`, `:2453-2470` (FAQ dialog guard), `:2725-2765`, `:3149-3161` (`errorText`, `CMS_ERROR_MESSAGES`) | 18a-1 edits `:682-716` (handlers), `:1416-1470` (FAQ table), `:1820-1830` (delete dialog), `:1850-1890` (import confirm), `faqToInput`. **No edit inside `CmsVideoDialog` or `FaqDialog`**: the version rides on the editing object. |
| | `AdminEstateEditorForm.tsx` | `:145`, `:354`, `:371`, `:408` (toasts → `adminErrorMessage`), `:862-876` (restore confirm) | 18a-1 rewrites `:377-410` (FAQ handlers, incl. `:408`) and `:688-720`, `:879-881`. **Conflict at `:408`: wait for 17a-1.** |
| | `TransactionForm.tsx`, `admin.transactions_.$id.tsx`, `admin.transactions_.new.tsx`, `admin.transactions.routes.test.mjs` | leave guard, dirty state, `transaction-form-state.ts` | 18a-1 edits only the two switches (`:299-321`) and adds a `canVerify` prop. **Wait for 17a-1.** |
| | `admin-error-text.ts` | creates `ADMIN_ERROR_CODES` and `adminErrorMessage` | 18a-1 adds its codes to that registry. **Needs 17a-1.** |
| | `admin.routes.test.mjs`, `admin-data.contract.test.mjs` | `:498`, `:1186+`; `:37`, `:258+`, `:429+` | 18a removes list entries (`:238`; `:18-19`) and appends its tests at the **end** of each file. |
| **#238** FX-12 phone identity | `admin-data.server.ts` | `:811-1076`, **`:2883-2901` (`createAdminLeadActivity`)**, `:3196-3313` | 18a-1 none. 18a-2 Task 7 rewrites `createAdminLeadActivity` on top of #238's `INSERT … SELECT FROM crm_leads`. **18a-2 waits for #238.** |
| | `website-inquiry.js` | `:1-2` import, `:76-84` contact match | 18a-2 edits `resolved_listing`/`routing` (`:110-125`) and the `INSERT INTO inquiries` column list. **Wait.** |
| | `admin-pagination-query.ts`, `admin-data.types.ts`, `admin.leads.tsx` | `:8`, `:64-71`; types; `:911-1216` | 18a-2 edits pagination `:41` (leads source) and `admin.leads.tsx:1377-1380`, `:1586-1587` only. 18a-1 adds fields to `AdminFaqCmsRow`/`AdminCmsVideoRow`/`AdminCmsVideoInput` (`:121-140`). |
| | `migration-versions.js`, the two pinned counts | +1 entry, 92 → 93 | 18a: none. |
| **#239** FX-13 redirects | `package.json` | other script lines | Insert `test:data-hygiene:db` next to `test:lead-integrity:db`. |
| **#240** FX-11a AI staff guardrails | `admin.cms.tsx` | `:808-921` (FAQ import → rebuild), `:1344`, `:1634-1715`, `:2552-2570` | 18a-1 does not touch `:784-921`; the import change is the preview list (`:1850-1890`) and the server. |
| | `knowledge.server.ts`, `knowledge-freshness.server.ts` | adds `published = true` to FAQ and estate sources | **18a-1 relies on it** (fact 8). Cut 18a-1 after #240 merges, or ship the same two-line filter in Task 2 if #240 is still open (Open question 6). |
| | `admin-data.server.ts` | `:66`, `:1927-1947` | Not shared with 18a hunks. |
| **#241** FX-14 security headers | `website-inquiry.js` | adds `SUSPECTED_BOT_NOTE`, `bot_note`/`bot_audit` CTEs, and **appends two params after `$10`** | 18a-2 adds its params **after** #241's two. **Wait.** |
| | `admin-data.ts` | `:14`, `:747-968` (schemas: `website` honeypot) | 18a-2 edits `:747-748` (`listingNo`, `property_id`). **Wait.** |
| | `admin-data.server.ts` | `:4563-4683` (`suspectedBot` pass-through) | 18a-2 edits `createWebsiteInquiry` `:4557-4590`. **Wait.** |
| | `PropertyInquiryForm.tsx` | `:13`, `:56`, `:65-81`, `:95`, `:132` | 18a-2 adds `listingNo` to the payload builder call (`:66-75`). **Wait.** |
| **#242** FX-15 public speed | — | — | Nothing shared. |
| **#243** FX-16 public polish | `PropertyInquiryForm.tsx`, `property-decision.test.mjs` | `:136` class; payload tests | 18a-2 edits `property-decision.js:20-29` and appends to its test. |

## Global Constraints

- **Owner safety rules (binding).** No production, Neon, WozTell or live-admin access. No migration, seed, delete or backfill anywhere. DB tests run on owned Postgres only. Synthetic ids start `79180000-0000-4000-8000-`.
- **Behaviour that must not change.**
  - `cms_mutate`, `cms_content_revisions` rules and the estate/article CMS flow are untouched (no function replace).
  - `fetchFaqs`, the chatbot FAQ reader and the public pages keep their queries; archived FAQs drop out through the existing `published` filter.
  - Website enquiry: the inquiry, the CRM lead, the lead-alert job, consent handling and the replay hash are unchanged. Assignment to a listing agent still needs an **active** listing and an **active** agent.
  - `updateAdminLead` and its FX-09 tests are untouched.
- **Migrations.** None in 18a. If review decides on a `faqs.updated_at` column or a `deleted_at` column instead (Open question 1), that becomes a separate migration PR with the owner sequence: Neon branch apply, production apply, `app_migrations` readback, then merge; `SET LOCAL lock_timeout='5s'` first; no `;` or `'` in comments; a revert in `neon/reverts/`; an entry in `migration-versions.js`; the two pinned counts updated.
- **Configuration.** No env var added or removed. No permission added: FAQ restore reuses `cms.publish`; transaction verify reuses the admin/manager role check.
- **Copy.** Admin zh-HK only, exactly as approved. Conflicts reuse the existing 409 text 「資料版本已變更，請重新載入並核對後再儲存。」 (`admin-error-text.ts:38`).
- **Design.** Reuse `AdminConfirmDialog`, `Badge`, `Switch`, `Table`. No new token or primitive.
- **Keep hunks small in shared files** (fact 30). Never touch `bun.lockb` (the worktree shows a stray modification; leave it unstaged; `git add <paths>` only), `package-lock.json` or dependencies.
- **Committing.** Conventional commits with a scope, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its suites. **Each PR passes** `npm run build`, `test:control-plane` (test wiring), every suite named in its tasks, and every `playwright.admin-owned.config.ts` suite. UI tasks attach before/after screenshots at 375 and 1440 px (CMS has no browser fixture, so take them on the Vercel preview, as 17a-1 did).

## Review Focus

1. **A deleted FAQ still shows somewhere public, or restore brings back the wrong answer.** *Test (Task 2, `data-hygiene.owned.db.test.mjs`):* `an archived FAQ is hidden from fetchFaqs, the chatbot reader and the knowledge sources, and restore brings back the answer it had when archived`.
2. **A version check loops on the user's own save, or the YouTube sync makes every video save conflict.** *Tests (Task 1):* `own consecutive FAQ and video saves succeed; a second tab's stale save gets 409 and writes nothing`; `a YouTube sync run that leaves staff fields unchanged does not change the video version`.
3. **A write commits without its audit row.** *Tests (Tasks 1, 2, 5, 7):* `when the audit insert fails, the FAQ, video, transaction, property and lead-activity writes roll back` (an owned-DB trigger on `audit_logs` raises for one marked action).
4. **An agent verifies or publishes a transaction, or a manager loses the ability to.** *Tests (Task 4):* `agent cannot set verified or published, and cannot edit a verified or published transaction; manager and admin can` (owned DB, per role) and `an agent's verified:true never reaches SQL` (contract).
5. **An enquiry is lost or unlinked because of its listing fields.** *Tests (Task 6):* `an enquiry with an unparseable listing number or property id still saves the inquiry, lead and alert job`; `an enquiry about a withdrawn listing links that listing and keeps its public number, without assigning its agent`.

## Out of scope / follow-ups

| Follow-up | Owner | Note |
|---|---|---|
| Staff title or URL edits on a YouTube-managed video are overwritten by the next sync (`youtube-repository.server.ts:62-108`) | 18d or FX-19 | Not a staff-vs-staff overwrite, so the 18a version check does not cover it. Lock those two fields in the video dialog when `youtube_managed`, or stop the sync from writing a staff-edited title. |
| Audit folds for campaign and audience create, staff roles and the AI tag actions (fact 14) | FX-19d | Campaign save is 17a-1's hunk; staff actions belong with H-20. |
| FAQ revision history in the CMS hub (view old answers, not just restore) | 17b | The archive now leaves accurate snapshots; a viewer can come with the CMS screen merge. |
| A `faqs.updated_at` column | not needed | The row-hash token covers it (Open question 1). |

---

# PR 18a-1: CMS versions, FAQ soft delete, dead writers, transaction verify (Tasks 1 to 5)

### Task 1: FAQ and video saves check a version and audit before/after in the same statement (C-12, C-16)

**Files:**
- **Create `src/lib/neon/cms-row-version.ts`** (pure, no server-only import, like `lead-version.ts`) and `cms-row-version.test.ts` (into `test:cms`'s `bun test` list).
- **Modify `src/lib/neon/admin-data.server.ts`:**
  - `listAdminCms` FAQ query (`:2063-2071`): add `published` and `${cmsRowVersionSql("faq","faqs")} AS version`; `faqGroups` counts published rows only, plus `archived` per scope.
  - `fetchAdminCmsVideos` (`:2123-2149`): add `version`.
  - `saveAdminFaq` (`:2316-2355`): three statements, each a single CTE:
    - **update** (`input.id`): `old AS (SELECT f.*, <ver(f)> AS version FROM faqs f WHERE id=$id FOR UPDATE)`, `upd AS (UPDATE faqs … FROM old o WHERE f.id=o.id AND o.version=$expected AND o.published AND (fields) IS DISTINCT FROM (new fields) RETURNING f.*, <ver> AS version)`, `audit AS (INSERT INTO audit_logs … 'faq.update' … jsonb_build_object('changed',…,'before',…,'after',…,'expectedVersion',$expected,'version',u.version) FROM upd u)`; select `current_version`, `published`, `new_version`. No row → `{ id:"", error:"Not found" }` (as today); `published=false` → throw `Response("FAQ_ARCHIVED", 409)`; version mismatch → `Response("CMS_ROW_CHANGED", 409)`; missing or malformed `expected_version` → `Response("CMS_ROW_VERSION_REQUIRED", 400)`; an unchanged save returns the same version and writes no audit row (no 409 on a double click).
    - **create** (single form): `ins AS (INSERT … ON CONFLICT (scope, question) DO NOTHING RETURNING *)`, `audit AS (INSERT … 'faq.create', jsonb_build_object('after', …) FROM ins)`. A conflict with an **archived** row returns 「此範圍已有已封存的相同問題，請到「顯示已封存」還原。」 (code `FAQ_ARCHIVED_DUPLICATE`), a live one keeps today's text.
    - **upsert** (import): `prior AS (SELECT * FROM faqs WHERE scope=$1 AND question=$2)`, `ins AS (INSERT … ON CONFLICT (scope, question) DO UPDATE SET answer=EXCLUDED.answer WHERE faqs.published RETURNING *, (xmax=0) AS inserted)`, `audit` with `before` from `prior`. An archived match returns no row → `{ id:"", error:"FAQ_ARCHIVED" }`. Return `{ id, inserted, version }`.
  - `saveAdminCmsVideo` (`:2151-2215`): the same update and create shapes with `cmsRowVersionSql("video", …)`, actions `cms_video.update` / `cms_video.create`. Keep `isMissingCmsVideosTableError` handling and the YouTube URL check.
- **Modify `src/lib/neon/admin-data.types.ts`:** `AdminFaqCmsRow` + `published: boolean; version: string`; `AdminFaqInput` + `expected_version?: string`; `AdminCmsVideoRow` + `version: string`; `AdminCmsVideoInput` + `expected_version?: string`; `AdminCmsData` + per-group `archived` count.
- **Modify `src/routes/admin.cms.tsx`:** `faqToInput` and the video edit start copy `version` into `expected_version`; `handleSaveFaq` / `handleSaveCmsVideo` (`:682-740`) are otherwise unchanged (the 409 maps through the shared error map).
- **Modify `src/components/admin/estates/AdminEstateEditorForm.tsx:377-400`:** send `sort_order: editingFaq.sort_order` and `expected_version`; check the returned `error` like `assertNoServerError` (fact 10).
- **Modify `src/components/admin/admin-error-text.ts`** (17a-1's registry): `CMS_ROW_CHANGED` → the existing 409 text; `CMS_ROW_VERSION_REQUIRED` → 「此頁面版本較舊，請重新載入後再儲存。」; `FAQ_ARCHIVED` → 「此 FAQ 已封存，請先還原。」; `FAQ_ARCHIVED_DUPLICATE` → as above.
- **Create `src/lib/neon/data-hygiene.owned.db.test.mjs`** and the script `test:data-hygiene:db` (`node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/neon/data-hygiene.owned.db.test.mjs`) in `package.json` (after `test:lead-integrity:db`) and `ci.yml` (after `run: npm run test:lead-integrity:db`).

**Interfaces:**
```ts
// src/lib/neon/cms-row-version.ts
export type CmsRowResource = "faq" | "video";
/** Staff-editable fields only. faq: scope, question, answer, sort_order, published.
 *  video: title, video_url, description, sort_order, published, category. */
export const CMS_ROW_VERSION_FIELDS: Readonly<Record<CmsRowResource, readonly string[]>>;
/** md5(jsonb_build_object(<field>, <alias>.<field>, …)::text). alias must match /^[a-z_]+$/ or it throws. */
export function cmsRowVersionSql(resource: CmsRowResource, alias: string): string;
export const CMS_ROW_VERSION_PATTERN: RegExp; // /^[0-9a-f]{32}$/
export function isCmsRowVersion(value: unknown): value is string;
export const CMS_ROW_CHANGED = "CMS_ROW_CHANGED";
export const CMS_ROW_VERSION_REQUIRED = "CMS_ROW_VERSION_REQUIRED";
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `cms-row-version.test.ts`: `emits the exact md5 expression over the staff fields and rejects unsafe aliases`; `video fields exclude youtube_* and updated_at`.
  - `data-hygiene.owned.db.test.mjs` (admin and manager actors, synthetic FAQs and videos): `own consecutive FAQ and video saves succeed; a second tab's stale save gets 409 and writes nothing`; `a FAQ save without a version is refused with 400 and writes nothing`; `the audit row has before and after of the changed fields only`; `a YouTube sync run that leaves staff fields unchanged does not change the video version` (calls the real `youtube-repository.server.ts` upsert with the same title and URL); `import of a question that is archived changes nothing and reports FAQ_ARCHIVED`; `when the audit insert fails, the FAQ and video writes roll back` (test-only trigger `BEFORE INSERT ON audit_logs` raising for `faq.update` and `cms_video.update`).
  - `admin-data.contract.test.mjs` (append): `FAQ and video saves write their audit row in the same statement` (source: no `await writeAudit(` left in either function).
- [ ] **Step 2: red.** `npm run test:data-hygiene:db`, `npm run test:cms`, `npm run test:command-center`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** The three suites above plus `npm run test:admin-estates`, `npm run test:youtube-sync`, `npm run test:control-plane`.
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.**
  ```
  fix(cms): FAQ and video saves refuse a stale version and audit before and after

  C-12, C-16. FAQ and video edits were last-write-wins and audited after the
  write committed, with empty metadata. Each save is now one statement that
  checks a row-hash version, writes, and inserts its audit row with the
  changed fields. The estate editor stops resetting FAQ order to 0.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 2: FAQ delete is a soft delete that a manager can restore (C-12)

**Files:**
- **Modify `admin-data.server.ts`:**
  - `deleteAdminFaq` (`:2357-2362`) → one `transactionRows` batch:
    1. `SELECT pg_advisory_xact_lock(hashtextextended('cms:faq:' || $1::text, 0))`
    2. `UPDATE cms_content_revisions SET state='superseded' WHERE resource_type='faq' AND resource_id=$1 AND state='published' AND payload IS DISTINCT FROM (SELECT to_jsonb(f) - 'created_at' - 'updated_at' FROM faqs f WHERE f.id=$1 AND f.published)`
    3. `INSERT INTO cms_content_revisions (resource_type, resource_id, version_number, state, payload, created_by, published_at) SELECT 'faq', f.id, (SELECT COALESCE(MAX(version_number),0)+1 FROM cms_content_revisions WHERE resource_type='faq' AND resource_id=$1), 'published', to_jsonb(f) - 'created_at' - 'updated_at', $2, now() FROM faqs f WHERE f.id=$1 AND f.published AND NOT EXISTS (SELECT 1 FROM cms_content_revisions WHERE resource_type='faq' AND resource_id=$1 AND state='published')`
    4. `SELECT cms_mutate('archive', 'faq', f.id, $2::uuid) AS revision FROM faqs f WHERE f.id=$1 AND f.published`

    Statement 4 returning no row → `{ ok:false, error:"Not found" }` (already archived or gone). `cms_mutate` writes the `archived` revision, `published=false` and the `cms_archived` audit row in the same transaction (fact 3). The knowledge-repair trigger on `faqs` queues as today.
  - **Add `restoreAdminFaq(id, actor)`** → one `transactionRows` batch: the same lock; `SELECT cms_mutate('restore','faq',f.id,$2,NULL,NULL,NULL,(SELECT id FROM cms_content_revisions WHERE resource_type='faq' AND resource_id=$1 AND state='archived' ORDER BY version_number DESC LIMIT 1)) FROM faqs f WHERE f.id=$1 AND NOT f.published`; then `SELECT cms_mutate('publish','faq',$1,$2,NULL,NULL,1,d.id) FROM cms_content_revisions d WHERE d.resource_type='faq' AND d.resource_id=$1 AND d.state='draft' AND d.draft_retired_at IS NULL AND d.created_by=$2 AND d.restored_from_revision_id IS NOT NULL AND d.created_at = now()` (only the draft made in this transaction). A `unique_violation` on `(scope, question)` → `Response("FAQ_RESTORE_CONFLICT", 409)`. No archived row → `{ ok:false, error:"Not found" }`.
  - `checkAdminFaqConflicts` (`:2372-2395`): also return `archived: Array<{ scope; question }>`.
- **Modify `admin-data.ts`:** add `restoreAdminFaq` (server fn, `requireStaffPermission(getRequest(), "cms.publish")`), after `deleteAdminFaq` (`:1043-1046`); add it to the protected list in `admin.routes.test.mjs`.
- **Modify `admin.cms.tsx`:**
  - FAQ table (`:1416-1470`): archived rows are hidden by default; a 「顯示已封存（{n}）」 `Switch` shows them with a 「已封存」 `Badge`, no 編輯, and a 還原 button that opens `AdminConfirmDialog`.
  - Delete button and dialog (`:1460-1463`, `:1820-1830`), handler `:701-716`: copy per "Copy for approval"; success toast 「已封存」.
  - Import confirm (`:1850-1890`): archived matches are listed with 「已封存（不會匯入）」 and removed from the rows the loop sends (the preview derivation, not the `:784-840` loop that #240 edits).
- **Modify `AdminEstateEditorForm.tsx`:** delete handler and dialog (`:402-410`, `:879-881`) as above; its FAQ list (`:688-720`) shows published rows only, with one line 「另有 {n} 條已封存，可在內容中心 › FAQ 還原。」 when there are any.
- **Modify `scripts/neon/import-faqs.mjs`:** `ON CONFLICT … DO UPDATE … WHERE faqs.published`, and print the skipped archived questions.
- **If #240 is not on `main` yet:** add `WHERE f.published = true` to `knowledge.server.ts:248` and `knowledge-freshness.server.ts:31` exactly as #240 does (Open question 6).

**Interfaces:**
```ts
export async function deleteAdminFaq(id: string, actor: StaffAccess): Promise<{ ok: true } | { ok: false; error: "Not found" }>;
export async function restoreAdminFaq(id: string, actor: StaffAccess): Promise<{ ok: true; version: string } | { ok: false; error: "Not found" }>;
export async function checkAdminFaqConflicts(keys, actor): Promise<{ existing: Key[]; archived: Key[] }>;
```

**TDD steps:**
- [ ] **Step 1: failing tests** (`data-hygiene.owned.db.test.mjs`):
  - `an archived FAQ is hidden from fetchFaqs, the chatbot reader and the knowledge sources, and restore brings back the answer it had when archived` (edit the answer after the July-style v1 revision, archive, restore; assert the edited answer; call the real `fetchFaqs`, the `live-agent-reply.server.ts` FAQ query and `current_public_sources`).
  - `archive of a FAQ that has no revision row works` (created through `saveAdminFaq` with no revision).
  - `delete writes one archived revision and one cms_archived audit row, and deletes no row`.
  - `restore by an agent is refused; by a manager it succeeds; a restore that collides with a live same question returns FAQ_RESTORE_CONFLICT and changes nothing`.
  - `deleting an already archived FAQ returns Not found and adds no revision`.
  - `admin.cms.usability.test.mjs` (append): `FAQ delete says it can be restored and archived rows offer 還原` (source).
- [ ] **Step 2: red.** `npm run test:data-hygiene:db`, `npm run test:cms`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** Plus `npm run test:command-center`, `npm run test:admin-estates`, `npm run test:ai-knowledge:db`, `npm run test:live-agent`.
- [ ] **Step 5: lint, typecheck; screenshots** of the FAQ tab (archived shown and hidden), the delete and restore dialogs, and the import confirm with an archived row, at 375 and 1440 on the preview.
- [ ] **Step 6: commit.** `fix(cms): FAQ delete archives with a fresh snapshot and managers can restore it` + body naming C-12, R-23 + trailer.

### Task 3: Remove the unused hard-delete and unversioned writers (C-17, C-12 estate part)

**Files:**
- **Modify `admin-data.server.ts`:** delete `deleteAdminProperty` (`:1359-1364`), `saveAdminEstate` (`:2217-2272`), `saveAdminArticle` (`:2274-2314`). `saveAdminProperty` (`:1226-1337`): an `input.id` now throws `Response("PROPERTY_EDIT_USE_WORKSPACE", 400)` before SQL, and the `UPDATE` branch goes (Open question 3).
- **Modify `admin-data.ts`:** delete the three wrappers (`:515-528`, `:1000-1022`).
- **Modify tests:** `admin.routes.test.mjs:238` (remove `deleteAdminProperty`), `admin-data.contract.test.mjs:18-19` (remove the two names), `cms-videos-schema.test.mjs:42`, `:56` (end anchor becomes the next function after `saveAdminCmsVideo`).
- **Do not touch** `updateAdminPropertyStatus` (the 下架 path) or the workspace.

**TDD steps:**
- [ ] **Step 1: failing tests.** `admin-data.contract.test.mjs` (append): `no browser-callable hard delete or unversioned CMS writer remains` (`admin-data.ts` exports none of `deleteAdminProperty`, `saveAdminEstate`, `saveAdminArticle`; `admin-data.server.ts` has no `DELETE FROM properties`); `admin-transactions.contract.test.mjs` (append): `saveAdminProperty with an id is refused before SQL`.
- [ ] **Step 2: red.** `npm run test:command-center`, `npm run test:transactions`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** Plus `npm run test:cms`, `npm run test:videos`, `npm run test:admin-properties`, `npm run test:property-maintenance:ui`, `npm run test:content-copilot` (`ai-contract.test.mjs:320-332` mentions `saveAdminArticle` in a negative assertion only).
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.** `fix(admin): remove the unused property hard delete and the unversioned estate and article writers` + body naming C-17, C-12 + trailer.

### Task 4: Only managers and admins verify or publish transactions (B-04)

**Files:**
- **Create `src/lib/neon/transaction-verify-policy.ts`** (pure): `canVerifyTransactions(roles)` → admin or manager.
- **Modify `admin-data.server.ts` `saveAdminTransaction` (`:1498-1602`):**
  - After the input checks: when `!canVerifyTransactions(actor.roles)` and (`input.verified === true` or `input.published === true`) → `throw new Response("TRANSACTION_VERIFY_FORBIDDEN", { status: 403 })` before SQL.
  - The agent `UPDATE` adds `AND verification_state <> 'verified' AND published = false`. Zero rows for an agent → 403 (today's branch).
  - Insert for an agent writes `unverified` / `false` (already true after the check).
- **Modify `TransactionForm.tsx:299-321`:** a new prop `canVerify: boolean`. When false, both `Switch`es are disabled and a line below reads the B-04 hint; when the loaded row is verified or published, the submit button is disabled with the second hint.
- **Modify `admin.transactions_.new.tsx`, `admin.transactions_.$id.tsx`:** pass `canVerify={canSeeFinance}` (the existing admin/manager boolean).
- **Modify `admin-error-text.ts`:** `TRANSACTION_VERIFY_FORBIDDEN` → the B-04 hint text.

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `admin-transactions.contract.test.mjs` (append): `an agent's verified:true or published:true never reaches SQL`; `an agent's update SQL cannot match a verified or published row`; `manager and admin may verify and publish`.
  - `data-hygiene.owned.db.test.mjs`: `agent cannot set verified or published, and cannot edit a verified or published transaction; manager and admin can` (one row per role; assert the row unchanged after each refused call).
  - `admin.transactions.routes.test.mjs` (append): `both routes pass canVerify from the admin-or-manager check`.
- [ ] **Step 2: red.** `npm run test:transactions`, `npm run test:data-hygiene:db`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** Plus `npm run test:admin-performance:db`, `npm run test:admin-performance:ui`.
- [ ] **Step 5: lint, typecheck; screenshots** of the form as agent and manager.
- [ ] **Step 6: commit.** `fix(transactions): only managers and admins verify or publish, and agents cannot edit a verified deal` + body naming B-04 + trailer.

### Task 5: Transaction and property writes audit in the same statement (C-16)

**Files:**
- **Modify `admin-data.server.ts`:**
  - `saveAdminTransaction`: wrap insert and update as `w AS (…RETURNING …)` with `old` (update) and `audit AS (INSERT INTO audit_logs … FROM w)`; metadata `before`/`after` of `verification_state`, `published`, `price`, `deal_date`, `deal_type`. Drop the trailing `writeAudit` (`:1596-1601`).
  - `saveAdminProperty` create (`:1320-1331`): `audit` CTE with `after: { listing_no, status }`; drop `:1335`.
  - `updateAdminPropertyStatus` (`:1339-1357`): `old`/`upd`/`audit` with `before`/`after` status; drop `:1355`.

**TDD steps:**
- [ ] **Step 1: failing tests** (`data-hygiene.owned.db.test.mjs`): `when the audit insert fails, the transaction save, property create and property status writes roll back`; `transaction audit has before and after verification_state and published`.
- [ ] **Step 2: red.** `npm run test:data-hygiene:db`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** Plus `npm run test:transactions`, `npm run test:admin-properties`, `npm run test:property-maintenance:owned:db`.
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.** `fix(admin): transaction and property writes insert their audit row in the same statement` + body naming C-16 + trailer.

---

# PR 18a-2: Enquiry listing number and remaining audit folds (Tasks 6 and 7)

Cut from `main` after #238 and #241 merge (fact 30). Re-read `website-inquiry.js` and `createAdminLeadActivity` on that `main` first; the hunks below are described against `1216ab8d`.

### Task 6: A website enquiry keeps the listing it was about (C-15)

**Files:**
- **Modify `src/components/property/property-decision.js:20-29`** (+ `.d.ts`): `buildPropertyInquiryPayload({ form, propertyId, listingNo, consentWhatsapp })` adds `listingNo` only when it matches `WEBSITE_LISTING_NO_PATTERN`.
- **Modify `PropertyInquiryForm.tsx`:** pass `listingNo` into the builder (one line in the `createWebsiteInquiry` call).
- **Modify `admin-data.ts:747-748`:** `listingNo: z.string().max(80).optional().catch(undefined)`, `property_id: z.string().max(80).optional().catch(undefined)`. A bad value can no longer fail the enquiry; the server validates.
- **Modify `admin-data.server.ts` `createWebsiteInquiry` (`:4557-4590`):** `requestedListingNo` kept only if `isValidWebsiteListingNo`, `requestedPropertyId` only if a UUID; a dropped value logs `console.warn("INQUIRY_LISTING_REF_DROPPED", { field })` (no value, no PII).
- **Modify `website-inquiry.js`:**
  - `requested_listing AS (SELECT p.id, p.listing_no FROM properties p WHERE ($7::uuid IS NOT NULL AND p.id=$7::uuid) OR ($8::text IS NOT NULL AND p.listing_no=$8::text) ORDER BY (p.status='active') DESC, (p.id=$7::uuid) DESC LIMIT 1)` — any status.
  - `routing` keeps `resolved_listing` (active only) for `assigned_agent_id` and `intent`, and takes `property_id` from `COALESCE(resolved.property_id, requested.id)`.
  - `INSERT INTO inquiries`: add `public_listing_no` = `$8` (the raw, validated number) else the matched row's `listing_no`.
  - New params go **after** #241's two.
- **Modify the lead read paths to fall back to the enquiry's number:** `admin-pagination-query.ts:41` (`COALESCE(p.listing_no, (SELECT i.public_listing_no FROM inquiries i WHERE i.crm_lead_id=l.id AND i.public_listing_no IS NOT NULL ORDER BY i.created_at DESC LIMIT 1)) AS listing_no`) and the lead detail query (`fetchAdminLead`, `admin-data.server.ts:2502-2570`). `admin.leads.tsx:1377-1380`, `:1586-1587`: when there is a number but no property title, show the C-15 line.

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `data-hygiene.owned.db.test.mjs`: `an enquiry with an unparseable listing number or property id still saves the inquiry, lead and alert job`; `an enquiry about a withdrawn listing links that listing and keeps its public number, without assigning its agent`; `an enquiry about an active listing is unchanged` (property, agent, intent, alert).
  - `admin-data.contract.test.mjs` (append): `the public enquiry schema never rejects listing fields` (parse `listingNo: "樓盤 A 12"`, `property_id: "abc"`).
  - `property-decision.test.mjs` (append): `the payload carries a valid listing number and drops an invalid one`.
- [ ] **Step 2: red.** `npm run test:data-hygiene:db`, `npm run test:command-center`, `npm run test:contact`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** Plus `npm run test:public-forms:ui`, `npm run test:live-agent:local-db` (when `LOCAL_POSTGRES_URL` is set), `npm run test:admin-daily-work:ui`, `npm run test:lead-integrity:db`.
- [ ] **Step 5: lint, typecheck; screenshots** of a lead whose listing was withdrawn, at 375 and 1440.
- [ ] **Step 6: commit.** `fix(enquiries): an enquiry keeps the listing it was about, even when it was withdrawn` + body naming C-15 + trailer.

### Task 7: Lead activity and enquiry status audit in the same statement (C-16)

**Files:**
- **Modify `admin-data.server.ts`:** `createAdminLeadActivity` (on top of #238's `INSERT … SELECT FROM crm_leads`) becomes `ins AS (…RETURNING id, lead_id)`, `audit AS (INSERT … 'lead.activity' … FROM ins)`; `completeAdminLeadActivity` and `updateInquiryStatus` (`before`/`after` status) likewise. Remove their trailing `writeAudit`.
- **Modify `admin-data.contract.test.mjs`** (append): `audited creates in admin-data.server.ts insert their audit row in the same statement`, with an explicit allowlist of the functions still on `writeAudit` (fact 14 follow-ups), so a new create cannot quietly join them.

**TDD steps:**
- [ ] **Step 1: failing tests** (`data-hygiene.owned.db.test.mjs`): `when the audit insert fails, the note is not saved, so a retry cannot duplicate it`; `inquiry status change writes before and after`. Plus the contract test above.
- [ ] **Step 2: red.** `npm run test:data-hygiene:db`, `npm run test:command-center`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** Plus `npm run test:lead-integrity:db`, `npm run test:admin-daily-work:ui`, `npm run test:lead-alert:owned:db`.
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.** `fix(leads): notes and enquiry status changes insert their audit row in the same statement` + body naming C-16 + trailer.

---

## Copy for approval (admin zh-HK, verbatim)

`{…}` is a value filled in at run time. No public copy changes.

### 18a-1, Task 1: versions
| Place | Current | Proposed |
|---|---|---|
| Stale FAQ or video save (409) | (silently overwrote) | 資料版本已變更，請重新載入並核對後再儲存。 (existing string) |
| Save from an old page with no version (400) | — | 此頁面版本較舊，請重新載入後再儲存。 |
| Edit of an archived FAQ | — | 此 FAQ 已封存，請先還原。 |
| New FAQ that matches an archived question | 此範圍已有相同問題，請改用編輯。 (live match, unchanged) | 此範圍已有已封存的相同問題，請到「顯示已封存」還原。 |

### 18a-1, Task 2: FAQ soft delete and restore
| Place | Current | Proposed |
|---|---|---|
| FAQ row button (CMS and estate editor) | 刪除 | 封存 |
| CMS dialog title | 刪除 FAQ | 封存 FAQ？ |
| CMS dialog description | 確定要刪除「{問題}」？此操作無法復原，公開頁面及 AI Agent 知識庫會即時移除此問答。 | 確定要封存「{問題}」？公開頁面會即時移除此問答。經理或管理員之後可在「顯示已封存」還原。 |
| Estate editor dialog title | 刪除 FAQ？ | 封存 FAQ？ |
| Estate editor dialog description | 刪除後無法還原，公開屋苑頁面會即時移除此問答。 | 公開屋苑頁面會即時移除此問答。之後可在內容中心 › FAQ 還原。 |
| Dialog confirm button | 刪除 | 封存 |
| Success toast | 已刪除 ／ FAQ 已刪除 | 已封存 |
| Failure toast (estate editor) | 刪除失敗 | 未能封存，請重試。 |
| Already gone | 此 FAQ 已被刪除，請重新載入頁面。 | 此 FAQ 已被封存或刪除，請重新載入頁面。 |
| Toggle above the table | — | 顯示已封存（{n}） |
| Archived row badge | — | 已封存 |
| Restore button | — | 還原 |
| Restore dialog title | — | 還原此 FAQ？ |
| Restore dialog description | — | 還原後「{問題}」會以封存時的答案重新在公開頁面顯示。 |
| Restore success toast | — | 已還原 |
| Restore conflict | — | 此範圍已有相同問題，未能還原。請先修改或封存現有的問題。 |
| Estate editor note | — | 另有 {n} 條已封存，可在內容中心 › FAQ 還原。 |
| Import confirm, archived row status | — | 已封存（不會匯入） |
| Import confirm description, extra sentence when any are archived | — | 其中 {n} 條已封存，不會匯入；如需更新，請先還原。 |

### 18a-1, Task 3: dead writers
| Place | Current | Proposed |
|---|---|---|
| (none visible) | — | No staff copy. `PROPERTY_EDIT_USE_WORKSPACE` reaches no screen (only the new-listing page calls the function, without an id). |

### 18a-1, Task 4: transaction verify (B-04)
| Place | Current | Proposed |
|---|---|---|
| Hint under the two switches, agent | — | 只有經理或管理員可以核實及公開發布成交。 |
| Hint when an agent opens a verified or published deal | — | 此成交已由經理核實或公開，如需修改請聯絡經理。 |
| Server refusal (403) | 你沒有權限進行此操作。 (generic) | 只有經理或管理員可以核實及公開發布成交。 |

### 18a-2, Task 6: enquiry listing number (C-15)
| Place | Current | Proposed |
|---|---|---|
| Lead list and detail, number known but no listing row | — | #{編號}（未能配對現有樓盤） |

### 18a-2, Task 7
No new copy.

## Owner actions before production

**Order (each PR):** owner approves this plan and its copy → CI green → Vercel preview on a Neon branch → preview check → merge → canary. No migration, so there is no `app_migrations` readback.

1. **Before 18a-1 starts:** 17a-1 merged (and #240, Open question 6). Confirm the copy table.
2. **18a-1 preview check** (staff test login, Neon branch, synthetic FAQs only):
   - 內容中心 › FAQ: edit a FAQ in two tabs; the second save shows 「資料版本已變更…」 and nothing changes.
   - 封存 a FAQ; it disappears from the matching public page (homepage or 深井 district page) on the preview; 顯示已封存 shows it; 還原 brings back the same answer; the public page shows it again.
   - Import a file that repeats an archived question: the confirm lists 已封存（不會匯入）.
   - 成交管理 as an agent: the two switches are disabled with the hint; as a manager they work.
3. **18a-2 preview check:** submit the listing-page form for a synthetic listing, then set that listing to 下架 and submit again from the open tab; both enquiries appear in 客戶查詢 with the listing shown. Use your own test number only.
4. **Canary (48 h after each merge):** no rise in `[admin]` errors; `CMS_ROW_CHANGED` 409s are rare (one per real collision); no `INQUIRY_LISTING_REF_DROPPED` spike; 客戶查詢 count per day unchanged. Then update the audit Status column and `CHANGELOG.md`.

**Rollback:** revert the PR. Archived FAQs stay `published=false` with their `archived` revision; to bring one back after a revert, use the CMS revision restore (admin/manager) or ask for a one-row fix, which goes through the owner's own Neon change process.

## Open questions

Each has a recommended default; I will use it unless the owner says otherwise.

1. **Soft delete storage.** **Default: no migration** — `faqs.published=false` plus an `archived` revision (facts 3, 4). Alternative: a `faqs.deleted_at` column (a migration with the full owner sequence) to tell "archived" from a future "unpublished draft"; not needed while FAQs have no draft state.
2. **Who restores a FAQ?** **Default: admin and manager** (`cms.publish`; `cms_mutate` already enforces it). Agents cannot open the FAQ tab today.
3. **Make `saveAdminProperty` create-only?** **Default: yes.** No screen edits through it (fact 12); edits stay on the versioned workspace.
4. **Verb for FAQ delete.** **Default: 封存**, matching estates and articles. Keeping 刪除 with 「可還原」 wording is the alternative.
5. **Agent edit of a verified transaction.** **Default: refused** (they ask a manager). The alternative lets agents edit non-verification fields of a verified row, which needs a field-level rule.
6. **#240 timing.** **Default: cut 18a-1 after #240 merges**, so the knowledge index already filters `published`. If #240 is held, Task 2 carries the same two-line filter.
7. **Withdrawn listing on an enquiry.** **Default: link it, do not assign its agent** (routing unchanged). Assigning the withdrawn listing's agent is the alternative.
8. **Archived questions in an import.** **Default: skip and list them.** The alternative is to restore and update them in the same import.

## Findings that differ from the approved fix plan

1. **FAQ soft delete needs no migration, but needs a fresh snapshot.** `faqs.published` and `cms_mutate('archive')` already exist (fact 3). FAQ edits bypass the revision engine, so archiving from the newest revision would restore an answer months old, or fail for FAQs created since July (fact 4). Task 2 snapshots the live row first, in the same transaction.
2. **Estates already have version checks and atomic audit** through `cms_mutate` (fact 5). The real C-12 estate gap is the dead `saveAdminEstate` (and `saveAdminArticle`) wrapper, which Task 3 removes, not a new version column.
3. **C-15 is a lost-lead risk, not only a lost link.** The public schema rejects the whole enquiry when `listingNo` or `property_id` is malformed, and the listing page never sends its number (fact 15). The fix needs no migration: `inquiries.public_listing_no` exists (fact 16).
4. **B-04 is wider:** an agent can also unverify or unpublish a deal a manager verified, by editing it (fact 13).
5. **Version tokens are row hashes,** not `updated_at`: FAQs have no `updated_at`, and the YouTube sync bumps video `updated_at` on every run (fact 7).
6. **Two estate-editor FAQ bugs** (order reset to 0, false 「FAQ 已儲存」) are fixed with Task 1 (fact 10).
7. **FX-18c drops `crm_leads ADD suspected_bot`.** FX-14 (#241) records a suspected bot as a `crm_activities` row of type `suspected_bot` plus a `public_form.suspected_bot` audit row; no column is needed.
8. **18a is split in two** because its files sit under 17a-1 and under #238/#241 (fact 30), not because of size alone.
9. **No migration in 18a at all,** so the FX-18 "Migration?" column applies to 18c only.

---

## Outline: 18b, WhatsApp data quality (D-07, D-09, D-10, D-11, D-15)

**Goal.** No duplicate or vanished inbound message, no campaign burst into a 429 wall or to a non-WhatsApp contact, and no staff alert destination that could be a customer.

- **D-07 (dedupe).** An unknown-id delivery is keyed `wa-ambiguous:<receiptId>` today (`inbound-identity.ts:76-82`), so each redelivery is a new message. Key ambiguous ids on channel + member + provider timestamp + content digest; history import checks the live `wa:` key first (`inbound-receipts.server.ts:88-90`). Test: `ambiguous inbound twice → one message`; `history import after a live receipt → one message`.
- **D-09 (campaign pacing).** Require a WozTell member id per recipient (website-only contacts are excluded and counted); store the provider message id per recipient; pace sends (owner-set rate) and back off on 429 with a capped retry. `campaign-delivery.server.ts:285`, `:370-405`.
- **D-10 (unsupported types).** A non-listed inbound type (`event-classification.ts:61-66`) inserts a 「[未支援訊息]」 placeholder instead of being marked projected and dropped.
- **D-11 (staff destination binding).** A staff destination is bound only by a one-time code sent from the staff phone; a member id with customer conversations can never be isolated as staff (`staff-endpoints.server.ts:85-91`, `staff-event-isolation.server.ts:112-116`).
- **D-15 (drafts and media).** Keep the reply draft until `accepted`, not on 202 `queued`; recovered receipts keep media fields, not only `data.text`.

**WhatsApp test rules (binding for 18b):**
- **Idempotency.** Every send path has a test that replays the same job, webhook and click twice and asserts one provider call and one stored message.
- **Wrong-recipient guards.** Tests assert the provider `to`/member id equals the conversation's contact for replies, the recipient row for campaigns, and the bound staff endpoint for alerts; a mismatch refuses before the provider call.
- **Provider-down fallbacks.** With `provider-fetch.ts` mocked to time out, 5xx and 429: no duplicate on retry, the job ends retryable or `WOZTELL_DELIVERY_UNKNOWN` (never re-sent blind), and the UI says 「發送結果不明，請先核對再重試。」 (17a-1 copy).
- **Approval gates.** Campaign send, template send and staff-destination binding each need an explicit confirmation naming the customer or staff (17a-1 pattern) and a server-side role check; tests cover agent refusal.
- **Never real numbers.** Automated tests mock `src/lib/woztell/provider-fetch.ts`; manual checks use the WozTell sandbox and the owner's test number only.

**Dependencies.** **#238 merged first:** it rewrites `woztell-ingest.server.ts` (175 lines), `campaign-delivery.server.ts` (20 lines), `outbound-intent.server.ts` and `admin.whatsapp.tsx` (172 lines), and adds `woztell-ingest.owned.db.test.mjs`, which 18b extends. 17a-1 merged (the composer and `admin.whatsapp.tsx` hunks; the `WOZTELL_*` failure copy). FX-10b's campaign retry contract (`expectedCount`, attempted identity) unchanged. D-09 per-recipient message id and D-11 binding codes likely need additive columns: a migration with the full owner sequence (Neon branch, production, `app_migrations` readback, then merge), registered in `migration-versions.js`, the two pinned counts bumped, a revert in `neon/reverts/`. Owner: the WozTell sandbox channel and test number; the campaign send rate.

## Outline: 18c, migrations and staff data (C-14, B-11, B-12)

| File (timestamp set when the PR starts) | Change | Reversal |
|---|---|---|
| `2026MMDD100000_crm_indexes.sql` | `SET LOCAL lock_timeout='5s'`; `CREATE INDEX IF NOT EXISTS` on `crm_leads(contact_id)`, `crm_leads(assigned_agent_id)`, `crm_activities(lead_id)`, `whatsapp_conversations(contact_id)` (C-14). **No `suspected_bot` column**: FX-14 used `crm_activities` (finding 7). | `neon/reverts/…_crm_indexes_revert.sql`: `DROP INDEX IF EXISTS` ×4 |
| `2026MMDD110000_staff_email_ci_unique.sql` | `SET LOCAL lock_timeout='5s'`; `CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_ci_unique ON staff_users (lower(btrim(email))) WHERE email IS NOT NULL` (B-11) | `DROP INDEX IF EXISTS staff_users_email_ci_unique` |

- **B-11 precondition, first.** On a Neon branch (never production), run `SELECT lower(btrim(email)), count(*), array_agg(id) FROM staff_users WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1`. Zero rows → write the migration. Any row → the owner decides which account stays (suspend the other in 團隊成員); no SQL delete.
- **Index sizing.** On the same branch, `EXPLAIN` the inbound-lead trigger query and the leads list before and after, and the table sizes, so the plain (non-`CONCURRENTLY`) build time under `lock_timeout` is known. If a table is large, ask whether to use `CREATE INDEX CONCURRENTLY` outside the migration transaction instead.
- **Plan rules.** No `;` or `'` in comments; register both in `migration-versions.js`; update the pinned counts in `performance-readback-owned.db.test.mjs` and `link-bulk-owned.db.test.mjs` (92 on `main`, 93 after #238: bump from whatever `main` holds then); owned-Postgres test `indexes exist and the email index refuses a case duplicate`.
- **B-12.** `fetchAdminAgents` returns name and id only to agents (`admin-data.server.ts:1605-1630`; the wrapper admits agents, `admin-data.ts:977-981`); admins and managers keep email, branch and roles. Update 17a-1's `agent-staff-ids.contract.test.mjs` review list. Test: `an agent's agent list has no email, branch or roles`.
- **Order per owner rule:** Neon branch apply → production apply (owner approval) → `app_migrations` readback → merge.

**Dependencies.** #238 merged (it adds a migration and bumps the pinned counts; 18c's timestamps must sort after it). 17a-1 merged (B-12 edits its contract test). The Neon branch with a read-write role (Wave 0). The 17a follow-up index on `audit_logs(actor_id, action)` can join this file only if the L-02 sizing query shows it is needed.

## Outline: 18d, sync operations (R-NEW-02, R-NEW-04)

- **R-NEW-02.** `scripts/mls/sync-watchdog.mjs:4-14` prints `stale` and exits 0, so `.github/workflows/property-sync-watchdog.yml:25` never fails. Exit 1 unless `deriveSyncHealth` (`sync-run-contract.mjs:68-74`) is `healthy` or `running`; keep the JSON summary in `$GITHUB_STEP_SUMMARY`; a read failure stays exit 1 (`SYNC_HEALTH_UNKNOWN`). Test: `watchdog stale → exit 1`, `healthy → exit 0`, with `readSyncAuthority` injected.
- **R-NEW-04.** `safeBridgeError` (`apply-source-snapshot.mjs:67-80`) turns every unknown error into `INGESTION_UNAVAILABLE`. Add a redacted `errorClass` (constructor name) and `sqlState` (`error.code` when it matches `/^[0-9A-Z]{5}$/`) to the stderr JSON; never the message, connection string or payload. Test: `a pg error yields its SQLSTATE and class and no message text`.
- **Owner action (R-22):** name who receives the GitHub failure emails for the watchdog workflow.

**Dependencies.** None on the open PRs (no shared file in #238 to #243 or 17a-1). No migration, no env var. Can run in parallel with 18a-1 once its owner names the alert recipient. The YouTube-managed-video overwrite follow-up (Out of scope) may join 18d.
