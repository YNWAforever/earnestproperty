# FX-17a: Admin safer actions and clearer copy. Implementation plan (17a-1 and 17a-2), with outlines for 17b and 17c

**Owner decisions (pending, fill in after review):**
- The admin copy in the "Copy for approval" section, including the glossary: approved as drafted / amended, item by item.
- The split: 17a-1 (safer actions) first, then 17a-2 (clearer copy), each cut from `main` / changed.
- Open questions 1 to 9 below: defaults accepted / changed.
- L-02: the test records you name from the dry run (none are touched until you name them).

Fixed by the brief:
1. **Never lose an enquiry or lead.** No change to a public form, `/api/*`, `/w/*`, the webhook or a lead write path. Disabling a source link keeps its customers flowing to the company line (fact 16), and the confirmation says so. No lead or contact is deleted or edited by code; L-02 is owner-run and read-only on our side.
2. **Never send WhatsApp to the wrong person.** Every sending confirmation names the customer and a masked phone (G-24). The one browser-callable queue path that skips recipient re-materialisation is removed (D-13, fact 22). Job retry for delivery jobs warns that a retry may send again.
3. **No unauthorised access.** Hiding by role is never the only guard: every hidden entry has a server check (fact 25), and the diagnostics move behind a new admin-only permission enforced on the **server** (facts 12 to 14).
4. **No corrupted or silently overwritten records.** CMS 還原 asks first and lists what it replaces (G-08). Leave guards cover the transaction form, the CMS editors and campaign compose (G-20). The campaign save keeps an existing `scheduled_at` value untouched.
5. **No migration. No new env var. No `vercel.ts` or `ci.yml` edit.** G-18 uses the existing `audit_logs` table (fact 19). One permission name is added in code (`system.diagnostics.read`, admin only).
6. **Cut each PR from `main`. Never stack on #238 to #243.** 17a-2 is cut from `main` only after 17a-1 merges (no pre-chaining). Shared files and hunk rules are in fact 30 and Global Constraints.
7. **Copy.** Admin zh-HK only; no brand or marketing copy. Every new or changed staff-facing string is in the "Copy for approval" section, verbatim.
8. **UI refines the design system.** Reuse `AdminConfirmDialog` (shadcn `AlertDialog`), `Collapsible`, `Select`, `Badge`, `Table`. No token, `badge.tsx` or `styles.css` edit (#243 owns `--destructive` and the badge hover).

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- Every destructive or sending admin action asks first, and the question names the record or customer it affects (G-08, G-24, G-26, plus the inventory in fact 20).
- A failed staff action shows plain zh-HK from one error map, with a generic fallback; raw English, SQL and codes never reach a toast (G-19).
- Unsaved work in the transaction form, the CMS editors and campaign compose survives a mis-click, Back or tab close (G-20).
- Failed background jobs say why, in plain zh-HK, open on 失敗, and filter by a type select (G-09).
- Diagnostics (IDs, provider evidence, raw codes) sit behind an admin-only 「技術資料」 disclosure, and non-admins never receive them from the server (G-11).
- The "compare with published" view is a field-by-field table, not raw JSON (G-10).
- One glossary module is the single source of admin terms and status labels (G-12); the remaining jargon becomes plain copy (G-11).
- Small fixes: a new listing opens after save (G-07), screens and cards an agent cannot use are hidden with a real 「沒有權限」 (G-05), the first-login checklist is remembered per account (G-18), command-center KPI tiles open the matching list (G-21), unique React keys (G-22), the dead schedule field and unsafe queue function go (D-13/G-25).
- L-02: a read-only dry run lists candidate test records for the owner.

Findings: G-05, G-07, G-08, G-09, G-10, G-11, G-12, G-18, G-19, G-20, G-21, G-22, G-24, G-26, D-13 (= G-25), L-02.

**Split.** 15 change items do not fit one reviewable PR (more than about 8 tasks). Two PRs, **17a-1 first** because it carries the owner's priorities 1 to 4:

| PR | Branch | Tasks | Theme |
|---|---|---|---|
| **17a-1** | `fix/fx-17a-admin-safer-actions` | 1 to 7 | Safety: errors, confirmations, leave guards, unsafe queue removal, server-side diagnostics, failed jobs |
| **17a-2** | `fix/fx-17a2-admin-clear-copy` (cut from `main` after 17a-1 merges) | 8 to 14 | Clarity: glossary, plain copy, hide by role, KPI tiles, listing after save, keys, checklist, L-02 dry run |

**Approach.**
- **Task 1 (G-19).** `admin-error-text.ts` becomes the single error map: one code registry, one status map, one generic fallback, and one rule (zh-HK passes, known codes map, everything else falls back). The seven local `errorText` helpers delegate to it.
- **Task 2 (G-08, G-10).** A pure `cms-field-diff.ts` drives both the restore confirmation ("what will be overwritten") and the compare table. `CmsRevisionHistory` asks first, hides 還原 on draft rows and for agents.
- **Task 3 (G-26, G-24, inventory).** Link 停用 confirms and names the placement. Template send, consent change and 「不是退訂」 name the customer. A contract test pins the destructive-action inventory.
- **Task 4 (G-20).** The existing `useRouteLeaveGuard` is added to the transaction form, the four CMS editor dialogs and the campaign and audience dialogs. No new guard code.
- **Task 5 (D-13).** Remove the schedule field, the 「已排期」 choice and the browser-callable `queueAdminCampaign`.
- **Task 6 (G-11 server).** A new `system.diagnostics.read` permission (admin only). Pure view functions strip diagnostics from the assignment context and the staff-notification list for anyone without it. A shared `AdminTechnicalDetails` disclosure renders only for admins.
- **Task 7 (G-09).** A job-failure reason table, a type `Select`, 失敗 as the default status, and 技術資料 per row for admins.
- **Tasks 8 to 14 (17a-2).** Glossary, plain copy, hide by role, KPI tiles with shared predicates, listing after save plus keys, the checklist on `audit_logs`, and the L-02 dry-run SQL.

**Tech stack.** `node --test`, `bun test` (with `react-dom/server` + `cheerio`, as `CmsEditorFields.test.tsx`), owned Postgres (`withOwnedPostgres`), Playwright 1.62 on `playwright.admin-owned.config.ts` fixtures. No new dependency. New tests join existing `test:*` scripts that are already in `ci.yml` (fact 29).

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: L-02 (`:148`), D-13 (`:229`, = G-25 `:356`), G-04 to G-24 and G-26 (`:333-354`), S4 (`:424`), observed flows (`:137-139`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-17 (`:692-717`), Global constraints (`:17-39`), batch table (`:105`), FX-18a (`:720-725`), FX-19a (`:745-750`), FX-20 (`:772-773`).

## Verified current behaviour (main `1216ab8d`, 2026-10-09)

No live admin was opened for this plan. Facts are from code on `main`; "live" notes quote the audit.

| # | Fact | Where |
|---|---|---|
| 1 | **G-08 confirmed, and wider.** 還原 in the CMS history is a one-click `onClick={() => onRestoreRevision(revision.id)}` (`admin.cms.tsx:2750-2758`). The handler (`:531-543` estate, `:654-666` article) calls `restoreAdminCmsRevision` then `loadEstateRevisions`, which **replaces the open form** with the restored draft (`:427-447`). The SQL `restore` op also **retires the staff member's own saved draft** (`20260905110000_cms_atomic_mutations.sql:58-64`). The history lists the actor's own `draft` row with a 還原 button (`admin-cms.server.ts:217-221` includes `created_by = actor`), but `restore` refuses drafts (`state<>'draft'`, `:59-60` of the migration), so that button always fails with `CMS_REVISION_NOT_FOUND`. Restore is admin/manager only on the server (`admin-cms.server.ts:347`) yet the button shows to agents. The standalone estate editor already confirms (`AdminEstateEditorForm.tsx:862-876`). | as listed |
| 2 | **G-10 confirmed.** `CmsPublicationCompare` renders `JSON.stringify(localPayload)` and `JSON.stringify(published)` into two textareas (`CmsPublicationCompare.tsx:28-61`). The local JSON is also the recovery copy the conflict message points to (`admin.cms.tsx:3156`, 「本機修改已保留，請使用比較目前發布版本」). Used at `admin.cms.tsx:2081`, `:2316` and `AdminEstateEditorForm.tsx:421`. Payload keys are `AdminEstateInput` / `AdminArticleInput` (`admin-data.types.ts:382-414`); the form labels exist at `admin.cms.tsx:2093-2178` and `:2328-2383`. | as listed |
| 3 | **G-26 confirmed.** 停用 is `onClick={() => void run(() => save(link, !link.enabled))}` with no confirmation (`WhatsappLinksTable.tsx:357-365`). The save sends `expectedVersion` (`:122`). | as listed |
| 4 | **What a disabled link does.** `/w/$code` looks up `v.enabled`; a disabled or unknown link falls back to a 302 to the company WhatsApp (`whatsapp-enquiries.server.ts:422-450`). The customer still reaches the company; only attribution and staff routing are lost. | as listed |
| 5 | **G-24 confirmed.** The template confirmation says 「將向客戶傳送已審批範本「{name}」…」 with no name or phone (`admin.whatsapp.tsx:2040-2058`). `TemplateSendPanel` (`:1950`) is rendered at `:1820-1828` and receives no customer data. The conversation header already has `customer_display_name` / `phone` (`:1101-1104`, `:1560-1563`, `:1744`). `WhatsappConsentDialog` (`:1736-1741`) and 「不是退訂」 (`OptOutEvidenceNotice.tsx:195-215`) do not name the customer either. A masking helper exists: `maskStaffDestination` returns `••••1234` (`whatsapp-readiness-policy.ts:55-59`). The team dialogs already show a name + masked email block (`AdminTeamDialogs.tsx:125-136`). | as listed |
| 6 | **G-20: what is and is not guarded.** `useRouteLeaveGuard` (route change + `beforeunload`, pathname-only) and `useDirtyCloseGuard` exist (`use-unsaved-changes-guard.tsx:32-90`, `RouteLeaveBlocker.tsx`). The listing form and property workspace already use the route guard (`PropertyForm.tsx:166`, `AdminPropertyWorkspace.tsx:138`), and `e2e/admin-property-maintenance.spec.ts:657` tests it. **Not guarded against route change or tab close:** `TransactionForm.tsx` (no dirty tracking at all, 370 lines), the CMS video/estate/article/FAQ dialogs (close guard only, `admin.cms.tsx:1926`, `:2048`, `:2281`, `:2468`), and campaign/audience compose (close guard only, `admin.blasts.tsx:1170-1190`). | as listed |
| 7 | **G-19: seven local `errorText` helpers return raw text.** `admin.agents.tsx:157`, `admin.blasts.tsx:2713`, `admin.cms.tsx:3149`, `admin.leads.tsx:2031`, `admin.leads_.command-center.tsx:529`, `admin.segments.tsx:711`, `admin.whatsapp.tsx:2411`. 106 `toast.error(` calls in admin code. Per-screen code maps: `CMS_ERROR_MESSAGES` (`admin.cms.tsx:3155-3161`, duplicated at `AdminEstateEditorForm.tsx:145`), `bulkErrorLabels` (`admin.leads.tsx:136-141`), `campaignErrorLabels` (`admin.blasts.tsx:143`), `replyErrorLabels` (`admin.whatsapp.tsx:126-140`). FX-10a's `staffActionErrorText` and `callStaffServerFn` are on main (`admin-error-text.ts:62-75`, `staff-server-fn.ts:20-39`); a plain `Error` with unknown English text still passes through verbatim (`adminErrorText`, `:21-28`). | as listed |
| 8 | **The whatsapp reply map consumes raw codes.** `formatReplyError(errorText(err))` maps codes through `replyErrorLabels` (`admin.whatsapp.tsx:2392-2399`), and `TemplateSendPanel` tests `/403|forbidden|權限/` on the message (`:1980-1984`). So the shared map must run **after** the screen's own map, never before. | as listed |
| 9 | **G-09 confirmed.** The jobs API already returns `errorCode` (`jobs.server.ts:554`, `:607`; type `operations-types.ts:26`), never rendered (`AdminOperationsJobs.tsx:331-337` shows `jobType` and the UUID). Status defaults to 「所有狀態」 (`:92`). Type is a free-text input + 套用篩選 (`:274-289`). The server filter is an exact `jobType` match. `last_error_summary` is always a fixed English sentence and is **not** sent to the browser (`jobs.server.ts:735`). Live (audit): `ai.knowledge.rebuild` 失敗 5/5 since 2026-08-17. | as listed |
| 10 | **Job types and codes.** Registered types: `ai.knowledge.rebuild`, `ai.knowledge.repair`, `woztell.campaign.deliver`, `woztell.reply.deliver`, `woztell.history.import`, `woztell.enquiry.process`, `.service`, `.assign`, `.sla.check`, `.staff.notify`, `.staff.notify.reconcile`, `.staff.ack.check`, `.staff.test`, `lead.staff.alert`, `lead.staff.alert.reconcile` (`job-handlers.server.ts`; `lead-alert-enqueue.js:8-10`). Stored codes come from `safeJobErrorCode` (an `[A-Z_]` code or `JOB_HANDLER_FAILED`, `jobs.server.ts:626-629`) plus `LEASE_EXPIRED` and `JOB_DEFERRED` (`:391`, `:722`). Retryable codes include `WOZTELL_PROVIDER_TIMEOUT`, `_UNAVAILABLE`, `WOZTELL_CONFIGURATION_UNAVAILABLE`, `WOZTELL_DELIVERY_INCOMPLETE`; `WOZTELL_CAMPAIGN_PAUSED` is terminal (`job-handlers.server.ts:209-226`). | as listed |
| 11 | **Who reads jobs.** `system.jobs.read/retry/cancel` = manager and admin; agent has `system.health.read` only; viewer `system.health.read` + `audit.read` (`permissions.ts:20-35`). Capabilities are derived from that (`capabilities.ts:13-24`). | as listed |
| 12 | **G-11: the assignment context sends diagnostics to every role.** `readAssignmentContext` returns `proposalReason`, `proposedStaffId`, `confirmed_staff_id`, `desired_staff_id`, `assigned_agent_id`, `request_id`, `assignment_lock`, the provider `evidence` JSON and per-enquiry `requestedStaffId` to admin, manager **and agent** (`assignment.server.ts:105-138`, type `:431-457`). The only consumer is `WhatsappEnquiryContext.tsx` (`getWhatsappAssignment`, `whatsapp-assignment.ts:5-51`), which renders them in 「支援診斷」 (`:221-232`) and shows raw ISO dates and raw `source` in the main view (`:200`, `:212-214`). The no-link browser fixture mirrors the shape (`scripts/browser-fixtures/no-link/synthetic-api.ts`). | as listed |
| 13 | **G-11: staff-notification attempts send provider evidence to every role.** `listMyStaffNotifications` builds `attempts[]` with `evidenceKind`, `error` (safe code), `acceptedSource`, `deliveredSource`, `readSource` (`staff-notifications.server.ts:66`). `StaffNotificationCard` prints them inline in the main view (`StaffNotificationCard.tsx:52-74`, the live 「…· private_note_posted · 接納 2026-09-28T08:12:46…(woztell_send_responses)」) and IDs in 「接手支援診斷」 (`:76-82`). The handler takes injectable deps (`staff-notification-handlers.server.ts:10-33`). `item.id`, `inquiryId` and `assignmentVersion` are needed by the ack/help/open actions (`StaffNotificationPanel.tsx:70`). | as listed |
| 14 | **Other G-11 jargon.** Link cards: 「開啟 {opens ?? "unknown"} · 歸因查詢 {enquiries ?? "unknown"}」, raw `placementSource`, raw ISO `placementVerifiedAt`, raw `recentTest.state` (`WhatsappLinksTable.tsx:316-340`). Operations: disabled-tab tooltip and no-permission text print permission names such as `system.jobs.read` (`admin.operations.tsx:68-73`, `:266`, `:322-323`); health 「降級」 (`:77-81`, `AdminOperationsOverview.tsx:36-40`, `admin.index.tsx:353`). Enquiry queue rows print raw `assignment_state` and ISO `response_due_at` (`WhatsappEnquiryContext.tsx:236-240`). `formatHkDateTime` exists (`src/lib/format.ts:65`). Placement sources are `website`, `28hse`, `youtube`, `unknown`, `other` (DB CHECK). | as listed |
| 15 | **G-12 variants (visible copy, admin only).** See the glossary table in "Copy for approval". Counts: 物業管理 7 vs 樓盤管理 1 (nav); 追蹤連結 5 vs 來源連結 2; WhatsApp 群發 3 vs 推廣活動 7, plus about 52 zh lines in `admin.blasts.tsx` that say "Campaign"; 銷售線索 6 (analytics, where 客戶查詢 means an `inquiries` row, `admin.analytics.tsx:393-436`) vs 客戶查詢 39 (a CRM lead); 未分配 / 未分派 / 未指派 / 未指派代理 / 未指定代理; 發布 48 vs 發佈 10; 線上客服 / 問樓助手 / live agent; 降級; English role names in nav tooltips (`AdminShell.tsx:200-205`); property status 在售/在租, 已售出, 已租出, 下架 (`PropertyForm.tsx:347-351`) vs 公開, 已售, 已租, 已下架 (`property-management-ui.ts:6-13`). Duplicate maps with the same text: CMS revision states (`admin.cms.tsx:2717`, `AdminEstateEditorForm.tsx:177`), job status (`AdminOperationsJobs.tsx:45`, `AdminOperationsOverview.tsx:28`), health (`admin.operations.tsx:77`, `AdminOperationsOverview.tsx:36`), conversation status (`admin.whatsapp.tsx:86-96`). A doubled word: `RECENT_HANDOFF: "新線上客服轉介 轉介"` (`admin.leads_.command-center.tsx:69`). | grep |
| 16 | **G-07 confirmed, partly already fixed.** `NewAdminListingPage` navigates to `/admin/listings` after save (`admin.listings_.new.tsx:55-58`), whose default filter is 目前公開 (`admin.listings.tsx:239`), and the form defaults to 草稿 (`PropertyForm.tsx:112`), so the new listing vanishes. `onSaved(result.id)` passes the new `properties.id` (`PropertyForm.tsx:300`), and `/admin/listings/$id` accepts an offer id (`admin-properties.server.ts:100`, `alias.id::text=$2`). **The region already defaults from the estate** (`PropertyForm.tsx:382-384`); only the labels remain: 「地區 slug *」, 「English title」, 「Features (one per line)」 (`:400`, `:507`, `:516`) and the messages 「請輸入地區 slug」「地區 slug 最多 60 個字」 (`:67`). | as listed |
| 17 | **G-22 confirmed.** Two siblings share `key={user?.id}` (`admin.property-sync.tsx:36`, `:44`). The same bug in `admin.whatsapp.tsx` (`WhatsappEnquiryContext` and `MessageTimeline` both `key={detail.id}`) is fixed by #238. | as listed |
| 18 | **G-05: dead ends and their server guards.** (a) The nav renders locked rows for roles that cannot open them, with English role names in the tooltip (`AdminShell.tsx:264-279`); an agent sees 11. (b) Dashboard: `listAdminTeam` (team cards) is admin/manager only (`admin-team.ts:154`) and the audit read needs `audit.read`, so an agent's 啟用團隊 / 待處理邀請 / activity cards show 「暫時無法載入此營運資料，請稍後再試。」 (`admin.index.tsx:72-83`, `:118-121`, `:166-185`). (c) `/admin/whatsapp-links` and `/admin/whatsapp-settings` return `null` identity for an agent and spin on 「正在核實管理員權限…」 forever (`admin.whatsapp-links.tsx:21-28`; `use-staff-workspace.ts:15-21`). (d) The listings page shows two 「下一步：預覽 WhatsApp 連結」 buttons whose snapshot read is admin/manager only (`admin.listings.tsx:360-386`; `whatsapp-link-selection.ts:9-10`). (e) 前往跟進工作台 on the leads page (`admin.leads.tsx:990`; command center is admin/manager, `admin-data.ts:688`). | as listed |
| 19 | **G-18 confirmed; no column exists.** The checklist reads and writes `sessionStorage` (`AdminShell.tsx:441-451`, `:601-630`), so it returns in every new tab. `staff_users` has no preference or onboarding column (`20260623090000_neon_admin_crm_whatsapp.sql:31-45` plus later `ALTER`s: slug, title, website flags, specialties, languages, branch, duty manager). `audit_logs (actor_id, action, subject_type, subject_id, metadata, created_at)` exists (`:211-219`) and is written by `writeAudit` (`admin-data.server.ts:4684-4700`); it has **no index** on `actor_id` or `action`. No test references the checklist. | as listed |
| 20 | **Destructive and sending actions today** (the inventory Task 3 pins): see the table in Task 3. Already confirmed: CMS 封存 / FAQ 刪除 / 發布 (`admin.cms.tsx:1801-1830`, `:2228-2240`), estate editor 封存 / 發布 / 還原 / FAQ 刪除, listing 全部下架 and bulk edit, lead bulk update, campaign send / cancel / retry / finish / audience delete (`admin.blasts.tsx:1654-1815`), segments create, team suspend / roles / reset (named with masked email), jobs retry / cancel, receipts retry, migrations apply, 「不是退訂」. **Not confirmed:** CMS 還原 (fact 1), link 停用 (fact 3), conversation reassignment (immediate on `Select`, `admin.whatsapp.tsx:1764-1782`), lead 標記為已結束（未成交） when the form is clean (`admin.leads.tsx:818-824`, `:1188`), and the AI suggestion overwrite uses `window.confirm` (`admin.whatsapp.tsx:1901`). | as listed |
| 21 | **D-13 schedule field is dead for delivery.** `scheduled_at` is written by the campaign save (`admin-data.server.ts:3676-3693`) and shown in a 「預定時間」 column (`admin.blasts.tsx:1349`, `:1426`), but **no delivery path, cron or worker reads it** (grep of `src` and `workers`; the comment at `admin.blasts.tsx:1950-1955` says the same). The 「已排期」 status option (`:1947`) is queueable exactly like 待審核 (`:120`; `admin-workflow.ts:159`). The DB enum keeps `scheduled` (`20260623090000…sql:26`). | as listed |
| 22 | **D-13 direct queue is a send-safety issue, not just dead code.** `admin-data.ts:1888-1900` exports a browser-callable `queueAdminCampaign` server function (admin/manager) that calls the server `queueAdminCampaign` **without** `materializeCampaignRecipients`. The UI never calls it (grep); the real path is `/api/admin/campaigns/$id/queue` → `sendAdminCampaignQueue`, which re-materialises first (`admin-data.server.ts:3865-3877`). `queueCampaign` (`:4622-4624`) has no caller. `admin-data.contract.test.mjs:37` pins `queueAdminCampaign` as a **client** export. The server function stays: owned DB tests call it (`campaign-recovery-owned.db.test.mjs:71-821`). | as listed |
| 23 | **G-21 KPI counts do not match the lists they would open.** Server KPIs: `hot` = priority bucket ≤ 2, `overdue`, `unassigned`, `handoffs` = recent handoff within a window, `whatsapp_blocked` (`admin-data.server.ts:3108-3116`). Client queues: `today` = overdue or bucket ≤ 2, `high_score` = score ≥ 60, `unassigned`, `live_agent` = any `handoff_status`, `whatsapp` = linked (`admin.leads_.command-center.tsx:36-43`, `:127-143`). So the tile 「AI 高分查詢」 counts something different from the queue with the same name, and three tiles have no queue at all. Tiles are plain `Card`s (`:474-494`). | as listed |
| 24 | **No browser fixture renders `/admin/cms` or the command center.** Fixtures: property-maintenance (listings, new listing, detail, operations, whatsapp-settings), daily-work (overview, leads), no-link (whatsapp, leads, blasts, overview, analytics), link-bulk-owned (`/admin/whatsapp-links`), property-sync. CMS is covered by source and component tests (`test:cms`). | `scripts/browser-fixtures/*` |
| 25 | **Server guards exist for everything 17a hides.** Team: admin/manager (`admin-team.ts:154`). Command center: admin/manager (`admin-data.ts:688`). Link pages and snapshot: admin/manager (`whatsapp-assignment.ts`, `whatsapp-link-selection.ts:10`, `whatsapp-enquiries.ts:34`). CMS restore / publish / archive: admin/manager in TS **and** in SQL (`cms_mutate` role check, migration `:38-41`). Jobs: permission-checked API (`api.admin.control-plane.jobs.ts:24`). | as listed |
| 26 | **Already fixed on main:** G-16 (`activeExact` on 客戶查詢, `AdminShell.tsx:66-78`). G-17 is FX-04's. | as listed |
| 27 | **L-02 tables.** Staff names live in `staff_users.name_zh/name_en`; WhatsApp routing in `whatsapp_staff_channels (staff_id, eligible, retired_at)`; leads in `crm_leads (source, note, stage, assigned_agent_id)` with the name on `crm_contacts.name`; link routing in `whatsapp_tracking_link_versions.requested_staff_id`; conversations in `whatsapp_conversations (assigned_agent_id, confirmed_staff_id)`. The 團隊成員 suspend flow already requires a handover target (`admin.team.tsx:352`). | migrations |
| 28 | **Copy pinned by tests.** 「支援診斷」 (`scripts/test-whatsapp-no-link-synthetic-browser.mjs:211`; property-sync `scripts/test-property-sync-workspace.mjs:262-265`, `e2e/admin-property-sync-recovery.spec.ts:279`), 「接手支援診斷」 (`…no-link…:1782`), 「計劃發送時間（需人手確認）」 (`…no-link…:1445`), 「降級」 (`operations-components.test.tsx:268`), staffActionErrorText cases (`admin-error-text.test.ts:7-70`). | as listed |
| 29 | **Test wiring.** `src/test-wiring.test.mjs` requires every `src/**/*.test.*` in a `test:*` script and every deterministic script in `ci.yml`. Scripts used here, all already in CI: `test:staff-server-fn` (`ci.yml:111`), `test:cms` (`:126`), `test:operations` (`:115`), `test:operations:ui` (`:81`), `test:control-plane` (`:117`), `test:command-center` (`:107`), `test:staff-notifications` (`:109`), `test:whatsapp-access:db` (`:172`), `test:admin-overview:db` (`:167`), `test:admin-daily-work:ui` (`:85`), `test:property-maintenance:ui` (`:80`), `test:admin-link-bulk:ui` (`:89`), `test:admin-campaign-review:ui` (`:87`), `test:admin-properties` (`:125`). `acceptance:whatsapp-no-link:synthetic` runs in the staging job (`ci.yml:206`). | as listed |
| 30 | **Open PR overlap** (`git diff origin/main...origin/<branch>`). See the table below. | git |

**Fact 30, open PR overlap with 17a:**

| PR | Files it shares with 17a | Its hunks (main lines) | 17a rule |
|---|---|---|---|
| **#238** FX-12 phone identity (base `bfbfd618`) | `admin.whatsapp.tsx` | imports `:18-38`, `:137-140` (`replyErrorLabels`), `:1608`, `:1718-1725`, `:1787-1807` (adds `IdentityReviewNotice`, re-keys siblings), `:1853-1917` (re-indents the composer), `:2212`, `:2304-2359` | 17a-1 touches only `:1736-1741` (consent call site), `:1820-1828` (`TemplateSendPanel` props), `:1950-2058` (panel) and `:2411-2415` (`errorText` body). **Do not** move `replyErrorLabels` or touch `:2347`, `:2500` (deferred, Task 9). |
| | `admin.leads.tsx` | `:6`, `:99-120`, `:171-180`, `:205-238`, `:499-505`, `:911-985`, `:994-1002`, `:1016-1177` | 17a-1 touches only `errorText` `:2031-2035`. **Deferred until #238 merges:** the 前往跟進工作台 button (`:990`), the 未指定代理 / 未指派代理 labels (`:963`, `:1017`) and the 標記為已結束 confirmation (`:1188`). |
| | `admin-data.server.ts` | `:811-1076`, `:2883-2930`, `:3196-3313` | 17a-2 touches only the KPI block `:3108-3116`. |
| | `playwright.admin-owned.config.ts`, `package.json`, `ci.yml` | config insert after `:9`; package insert after `:116`; three CI lines | 17a inserts the new spec after `"admin-attention.spec.ts",` (`:16`); edits only the `package.json` lines named per task; no `ci.yml` edit. |
| | `AdminEmptyState.tsx`, `admin-data.types.ts`, browser-fixture build scripts | — | 17a does not touch them. |
| **#239** FX-13 redirects | `package.json` only | other script lines | No admin file shared. |
| **#240** FX-11a AI staff guardrails | `admin.cms.tsx` | `:808-921`, `:1344`, `:1634-1715`, `:2552-2570` | 17a-1 touches `:520-545`, `:640-670`, `:1926-1935`, `:2040-2060`, `:2081`, `:2203-2212`, `:2273-2295`, `:2316`, `:2408-2417`, `:2453-2470`, `:2725-2765`, `:3149-3161`; 17a-2 `:2228-2238`, `:2433-2438`, `:2691-2711` (發佈). None overlap. |
| | `AdminOperationsOverview.tsx` | `:15-23` (`"ai.gateway"` label) | 17a-2 edits only `:28-40` (the duplicate status maps); never `:13-26`. |
| | `admin-data.server.ts`, `admin-data.types.ts` | `:66`, `:1927-1947`; types `:645` | Not shared with 17a hunks. |
| **#241** FX-14 security headers | `admin.leads.tsx` | `:27`, `:1649-1656`, `:1979-1986` | 17a-1's `errorText` hunk (`:2031`) is 45 lines below. |
| | `crm-presentation.ts` | end of file (`:65+`) | 17a-2 edits only `:8-45`. |
| | `admin-data.ts` | `:14`, `:747-968` | 17a-1 removes `:1888-1900` only. |
| **#242** FX-15 public speed | `package.json`, `chart.tsx`, `styles.css` | — | Not shared. |
| **#243** FX-16 public polish | `badge.tsx`, `styles.css` (`--destructive`), `AdminTeamStatusBadge.tsx`, `playwright.admin-owned.config.ts` end, `package.json` | — | 17a edits none of these. Destructive buttons and the 失敗 badge pick up #243's token when it merges; take "after" screenshots once #243 is on `main`, or say which token they show. |

## Global Constraints

- **Owner safety rules (binding).** No production, Neon, WozTell or live-admin write. Browser suites run on owned fixtures; DB suites on owned Postgres. Synthetic ids start `7917a000-0000-4000-8000-`.
- **Behaviour that must not change.**
  - `callStaffServerFn`, `unwrapServerFnResponse` and every server permission check stay as they are. Hiding is added on top; nothing server-side is loosened.
  - The CMS `cms_mutate` contract, version checks and SQL are untouched; 還原 still creates a new draft through the same call.
  - `sendAdminCampaignQueue`, the `/api/admin/campaigns/$id/queue` route and FX-10b's `expectedCount` check are untouched.
  - The jobs API keeps its response shape; `errorCode` stays (it is the mapping input and a fixed code, not free text). `last_error_summary` stays server-side, as today.
  - `replyErrorLabels`, `formatReplyError` and the composer block in `admin.whatsapp.tsx` are untouched (#238).
- **Migrations.** None. G-18 reads and writes the existing `audit_logs` table (fact 19). The DB enum value `scheduled` and the `scheduled_at` column stay.
- **Configuration.** No env var added or removed. One permission name is added in code: `system.diagnostics.read`, granted to admin only (admin holds every permission, `permissions.ts:32`).
- **Copy.** Admin zh-HK only, exactly as approved in "Copy for approval". The blasts "Campaign" body sweep and the 收件群組 / 客戶分群 name wait for 17b, which rebuilds those screens.
- **Design.** Reuse `AdminConfirmDialog` (its `children` slot carries the name/phone `<dl>`, as in `AdminTeamDialogs.tsx:125-136`), `Collapsible`, `Select`, `Badge`, `Table`. No new colour, token or primitive.
- **Keep hunks small in shared files** (fact 30 table). When a hunk would touch a #238 range, defer it and say so in the PR body.
- **Do not touch `bun.lockb`, `package-lock.json` or dependencies.** The worktree shows a stray local `bun.lockb` modification; leave it unstaged. `git add <paths>` only.
- **Committing.** Conventional commits with a scope, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its suites. **Each PR passes** `npm run build`, `test:control-plane` (`test-wiring`), every suite named in its tasks, and every `playwright.admin-owned.config.ts` suite. UI tasks attach before/after screenshots at 375 and 1440 px.

## Review Focus

1. **A destructive or sending action fires without asking, or the question names the wrong customer.** *Tests:* `e2e/admin-safer-actions.spec.ts` (Task 3): `the template confirmation names the open conversation's customer and masked phone, and changes when another conversation is opened`; `e2e/admin-link-bulk-owned.spec.ts`: `停用 asks first, names the placement, and cancelling sends no save`; `src/routes/admin-destructive-actions.contract.test.mjs`: `every action in the inventory goes through a confirmation`.
2. **Diagnostics still reach a non-admin from the server.** *Tests (Task 6):* `src/lib/whatsapp-enquiries/enquiry-access.owned.db.test.mjs`: `agent and manager assignment context carries no diagnostics; admin's does`; `src/lib/neon/staff-notification-view.test.mjs`: `a non-admin list carries no evidence kind, source or error code on any attempt`.
3. **The error map hides an actionable message, or still shows raw text.** *Test (Task 1, `admin-error-text.test.ts`):* `known codes and statuses map, zh-HK text passes, unknown English, SQL and stack text fall back`.
4. **Work is lost: restore overwrites unsaved edits without saying so, the diff misreports, or a leave guard blocks a clean save.** *Tests:* `src/lib/admin/cms-field-diff.test.ts` (Task 2): `reports every labelled field that differs, including arrays, numbers and blanks, and counts unlabelled ones`; `src/components/admin/CmsRestoreConfirm.test.tsx`: `lists the unsaved fields and the draft that will be replaced`; `src/routes/admin.leave-guards.contract.test.mjs` (Task 4): `each guarded form mounts useRouteLeaveGuard and marks itself saved before navigating`.
5. **Hiding by role hides something an agent can use, or a KPI tile opens a list with a different count.** *Tests:* `src/components/admin/admin-nav-roles.test.mjs` (Task 10): `an agent sees exactly the entries whose first read accepts agent, and none is locked`; `src/lib/admin/command-center-queues.test.mjs` (Task 11): `each KPI equals the number of rows its tile's queue shows`.

## Out of scope / follow-ups

| Follow-up | Owner | Note |
|---|---|---|
| 前往跟進工作台 button for agents; 未指定代理 / 未指派代理 labels; 標記為已結束 confirmation | 17b (or a one-line follow-up once #238 merges) | All sit inside #238's rewrite of `admin.leads.tsx:911-1216`. 17b replaces 跟進工作台 with a 「今日要跟」 view, which removes the button. |
| Conversation reassignment confirmation | 17b with G-06 | One owner for lead + conversation changes the whole flow; the select sits next to #238's `:1787` hunk. |
| AI-suggestion overwrite `window.confirm` → `AdminConfirmDialog` | 17c | Inside the composer block #238 re-indents (`:1853-1917`). |
| `replyErrorLabels` into the shared registry; 供應商 copy at `admin.whatsapp.tsx:2347`, `:2500` | 17a-2 if #238 has merged, else 17c | `:137-140` and `:2304-2359` are #238 hunks. |
| "Campaign" in ~52 blasts strings; 收件群組 / 客戶分群 / 客戶名單 | 17b | 17b rebuilds 推廣活動 with 客戶分群 as step 1. |
| Campaign save Zod validator; segment vs audience filter alignment (rest of D-13) | 17b | Same screens as above. |
| Property-sync 「支援診斷」 (25 rows) | 17b | 盤源同步 becomes a manager tab of 樓盤管理 in 17b; the disclosure moves to `AdminTechnicalDetails` there. |
| Make the server `queueAdminCampaign` module-private | FX-19a (H-16) | It stays exported because the owned campaign tests import it (fact 22). Task 5 already removes the browser-callable wrapper and the caller-less `queueCampaign`. |
| A "test" flag on staff/leads excluded from metrics (L-02 fix idea) | owner decision | Needs a migration; not proposed now (Open question 8). |
| Index on `audit_logs(actor_id, action)` | FX-18c if the checklist read is slow | Sizing query in the L-02 dry run. |

---

# PR 17a-1: Safer actions (Tasks 1 to 7)

### Task 1: One error map with a generic fallback (G-19)

**Files:**
- **Modify `src/components/admin/admin-error-text.ts`:**
  - Add `ADMIN_ERROR_CODES: Record<string, string>`: the union of `STAFF_ACTION_CODE_MESSAGES`, `CMS_ERROR_MESSAGES` (moved from `admin.cms.tsx:3155-3161`; delete the duplicate at `AdminEstateEditorForm.tsx:145`) and `campaignErrorLabels` (moved from `admin.blasts.tsx:143`). Text unchanged. `bulkErrorLabels` (`admin.leads.tsx:136-141`) and `replyErrorLabels` (`admin.whatsapp.tsx:126-140`) stay where they are, next to #238's hunks; their screens map through them first and then through `adminErrorMessage`. They move into the registry in Task 9 once #238 has merged.
  - Add `ADMIN_GENERIC_ERROR = "操作未完成，請重試。"` (existing string, `WhatsappLinksTable.tsx:79`).
  - Add `adminErrorMessage(error: unknown, fallback = ADMIN_GENERIC_ERROR): string`:
    1. a status-bearing error → `STAFF_ACTION_STATUS_MESSAGES[status]`, else the body code through `ADMIN_ERROR_CODES`, else `fallback`;
    2. a message string `m` (from `Error`, string, or `{ message }`) → `ADMIN_ERROR_CODES[m]`, else the existing `ADMIN_ERROR_MESSAGES` / duplicate-key rule, else `m` **when it contains CJK** (`/[㐀-鿿]/`, our own zh-HK), else `fallback`;
    3. anything else → `fallback`.
    It never returns English, SQL or a stack. It `console.warn`s the raw value in development only.
  - `staffActionErrorText(error, fallback)` becomes `adminErrorMessage(error, fallback)` (kept as an alias so FX-10a callers are unchanged).
- **Modify the seven local helpers** (fact 7) to `return adminErrorMessage(error, "<that screen's existing fallback, or the generic one>")`. One-hunk bodies only. In `admin.whatsapp.tsx:2411-2415` the body is `return adminErrorMessage(formatReplyError(rawMessage(error)))`, so the screen's own codes map first (fact 8). In `admin.leads.tsx:2031-2035` the body keeps returning the raw code when it is a key of `bulkErrorLabels` (caller `:609` maps it), else delegates.
- **Modify `AdminEstateEditorForm.tsx`:** its `toast.error(err instanceof Error ? err.message : …)` calls (`:354`, `:371`, `:408` and the others in that file) use `adminErrorMessage(err, "<existing fallback>")`.
- **Modify `src/components/admin/admin-error-text.test.ts`.**

**Interfaces:**
```ts
export const ADMIN_GENERIC_ERROR: string; // "操作未完成，請重試。"
export const ADMIN_ERROR_CODES: Readonly<Record<string, string>>;
export function adminErrorMessage(error: unknown, fallback?: string): string;
/** @deprecated alias kept for FX-10a callers */
export function staffActionErrorText(error: unknown, fallback: string): string;
```

**TDD steps:**
- [ ] **Step 1: failing tests** in `admin-error-text.test.ts`:
  - `known codes and statuses map, zh-HK text passes, unknown English, SQL and stack text fall back` (cases: `new Error("CMS_REVISION_CONFLICT")`, `{ status: 403 }`, `new Error("最多 1000 筆，請縮小篩選。")`, `new Error("relation \"x\" does not exist")`, `new Error("TypeError: Cannot read properties of undefined\n    at …")`, `"Forbidden"`, `null`);
  - `CMS codes have exactly one source` (source test: `admin.cms.tsx` and `AdminEstateEditorForm.tsx` no longer define `CMS_RESOURCE_NOT_FOUND`);
  - `no admin route keeps a raw errorText` (source test over the seven files: each `function errorText` body calls `adminErrorMessage`).
  - Keep the existing six tests passing.
- [ ] **Step 2: red.** `npm run test:staff-server-fn`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:staff-server-fn`, `npm run test:cms`, `npm run test:command-center`, `npm run test:admin-estates`.
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.**
  ```
  fix(admin): map every staff action error to zh-HK with one fallback

  G-19. Seven screens printed raw server text in toasts. One code map and one
  rule now decide: known codes and statuses map, our own zh-HK passes, anything
  else reads 「操作未完成，請重試。」.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 2: CMS 還原 asks first and says what it replaces; compare is a field table (G-08, G-10)

**Files:**
- **Create `src/lib/admin/cms-field-diff.ts`** (pure) and `cms-field-diff.test.ts` (into `test:cms`'s `bun test` list).
- **Create `src/components/admin/CmsRestoreConfirm.tsx`** and `CmsRestoreConfirm.test.tsx` (into `test:cms`). It wraps `AdminConfirmDialog` and renders: the target version line, the list of unsaved fields (from `cmsFieldDiff(savedPayload, form)`), and the saved draft that will be retired.
- **Modify `src/routes/admin.cms.tsx`:**
  - `CmsRevisionHistory` (`:2725-2765`): new props `canRestore: boolean` (admin or manager; from the staff session), `onRequestRestore(revision)`. 還原 renders only when `canRestore && revision.state !== "draft"`. One click opens `CmsRestoreConfirm`; confirming calls the existing `onRestoreRevision(revision.id)`.
  - Pass `savedPayload`, the current form and the actor's draft summary (the `draft` row in `revisions`) from `EstateDialog` (`:2203-2212`) and `ArticleDialog` (`:2408-2417`).
- **Modify `src/components/admin/estates/AdminEstateEditorForm.tsx:862-876`:** use `CmsRestoreConfirm` too (one restore confirmation).
- **Modify `src/components/admin/CmsPublicationCompare.tsx`:** replace the two JSON textareas with a `Table` from `cmsFieldDiff(published, localPayload)`; long values clamp to 3 lines with a 「顯示全部」 toggle; keep the recovery copy behind 「複製本機修改（備份）」 (clipboard; on failure show the existing read-only textarea 「本機修改備份（可複製）」).

**Interfaces:**
```ts
// src/lib/admin/cms-field-diff.ts
export type CmsDiffResource = "estate" | "article";
export const CMS_FIELD_LABELS: Record<CmsDiffResource, Record<string, string>>; // keys of AdminEstateInput / AdminArticleInput, labels as the form shows them (fact 2)
export type CmsFieldChange = { key: string; label: string; before: string; after: string };
/** Compares only labelled keys; id, created_at, updated_at, created_by, updated_by are ignored.
 *  Arrays join with "、"; null, undefined and "" read 「（空白）」; numbers compare by value. */
export function cmsFieldDiff(
  resource: CmsDiffResource,
  base: Record<string, unknown> | null,
  next: Record<string, unknown>,
): { changes: CmsFieldChange[]; otherChanged: number };
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `cms-field-diff.test.ts`: `reports every labelled field that differs, including arrays, numbers and blanks, and counts unlabelled ones`; `a null base (never published) lists every non-blank field`; `identical payloads give no changes` (e.g. `facilities: ["會所"]` vs `["會所"]`, `area_min: 500` vs `"500"` counts as equal).
  - `CmsRestoreConfirm.test.tsx` (static render): `lists the unsaved fields and the draft that will be replaced`; `says 目前沒有未儲存的修改 when the form is clean`.
  - `admin.cms.usability.test.mjs`: `restore asks first and is hidden on draft rows and for agents` (source: no `onClick={() => onRestoreRevision(` remains; the 還原 button is inside `canRestore && revision.state !== "draft"`); `compare no longer prints raw JSON` (`CmsPublicationCompare.tsx` has no `JSON.stringify(comparison.published`).
- [ ] **Step 2: red.** `npm run test:cms`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:cms`, `npm run test:admin-estates`.
- [ ] **Step 5: lint, typecheck.** No browser fixture renders `/admin/cms` (fact 24), so the 375 and 1440 screenshots of the history, the restore confirmation and the compare table are taken on the Vercel preview during the owner's preview check and attached to the PR.
- [ ] **Step 6: commit.** `fix(cms): confirm 還原 with what it replaces and compare field by field` + body naming G-08, G-10 + trailer.

### Task 3: Link 停用 confirms; sending confirmations name the customer; the inventory is pinned (G-26, G-24)

**Files:**
- **Modify `src/components/admin/whatsapp/WhatsappLinksTable.tsx:357-365`:** 停用 sets `pendingDisable` and opens `AdminConfirmDialog` (destructive). 重新啟用 stays one click (it restores routing). The dialog body is a `<dl>` with 樓盤, 投放位置, 連結, 指定同事.
- **Create `src/lib/admin/customer-label.ts`:** `customerConfirmLabel({ name, phone })` → `{ name: name?.trim() || "WhatsApp 客戶", phone: maskStaffDestination(phone) ?? "未有電話" }` (reuses `whatsapp-readiness-policy.ts:55`).
- **Modify `src/routes/admin.whatsapp.tsx`:**
  - `:1820-1828`: pass `customer={customerConfirmLabel({ name: detail.customer_display_name ?? detail.name, phone: detail.phone })}` to `TemplateSendPanel`.
  - `:1950-2058`: `TemplateSendPanel` takes `customer` and renders the `<dl>` (客戶 / 電話) in the dialog's `children`; the description names them.
  - `:1736-1741`: pass the same `customer` to `WhatsappConsentDialog`.
- **Modify `src/components/admin/WhatsappConsentDialog.tsx`** and **`src/components/admin/whatsapp/OptOutEvidenceNotice.tsx`:** accept `customer` (Notice reads it from its `detail` prop, no call-site change) and show the 客戶 line.
- **Create `src/routes/admin-destructive-actions.contract.test.mjs`** (into `test:command-center`'s `node --test` list): one row per inventory entry below, asserting the confirmation title string exists in the file and the one-click pattern is gone.
- **Create `e2e/admin-safer-actions.spec.ts`** on the no-link fixture (`build-whatsapp-no-link.mjs`); add it to `playwright.admin-owned.config.ts` after `"admin-attention.spec.ts",` and to the `test:admin-daily-work:ui` script line.
- **Extend `e2e/admin-link-bulk-owned.spec.ts`.**
- **Fixture:** `scripts/browser-fixtures/no-link/synthetic-api.ts` gives the two synthetic conversations distinct `customer_display_name` and `phone` values if they do not already.

**Destructive and sending action inventory (after 17a-1):**

| Action | Where | Confirmation | Names the record or customer |
|---|---|---|---|
| CMS 封存 屋苑／文章 | `admin.cms.tsx:1801` | yes (existing) | type only (unchanged) |
| CMS FAQ 刪除 | `admin.cms.tsx:1824` | yes | question text |
| CMS 發布 | `admin.cms.tsx:2228`, `:2433` | yes | — |
| **CMS 還原** | `admin.cms.tsx:2754` | **new (Task 2)** | version, date, fields replaced |
| Estate editor 封存／發布／還原／FAQ 刪除 | `AdminEstateEditorForm.tsx:836-890` | yes (還原 now shared) | as above |
| Listing 全部下架 / 下架所選, bulk edit | `AdminPropertyWorkspace.tsx:758`, `AdminPropertyBulkActions.tsx:263` | yes | listing |
| Lead bulk update | `admin.leads.tsx:1288` | yes | count |
| Lead 標記為已結束（未成交） | `admin.leads.tsx:1188` | only when dirty | **deferred (#238)** |
| **Template send** | `admin.whatsapp.tsx:2040` | yes | **customer + masked phone (new)** |
| **Consent change** | `WhatsappConsentDialog.tsx` | explicit save | **customer (new)** |
| **不是退訂** | `OptOutEvidenceNotice.tsx:195` | yes | **customer (new)** |
| Conversation reassignment | `admin.whatsapp.tsx:1764` | none | **deferred to 17b (G-06)** |
| Campaign send / cancel / retry / finish; audience delete | `admin.blasts.tsx:1654-1815` | yes | campaign / audience name |
| **Link 停用** | `WhatsappLinksTable.tsx:363` | **new** | **listing, placement, link, staff** |
| WhatsApp mapping retire | `StaffMappingWizard.tsx:306` | typed reason | staff |
| Team suspend / roles / reset / link | `AdminTeamDialogs.tsx` | yes | name + masked email |
| Jobs retry / cancel, receipts retry, migrations apply | operations components | yes | job (Task 7 adds the reason) |

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `admin-safer-actions.spec.ts` (desktop 1440): `the template confirmation names the open conversation's customer and masked phone, and changes when another conversation is opened`; `the consent dialog and 不是退訂 name the customer`; `cancelling the template confirmation sends nothing` (fixture call log).
  - `admin-link-bulk-owned.spec.ts`: `停用 asks first, names the placement, and cancelling sends no save`; `confirming 停用 saves once with the expected version`.
  - `admin-destructive-actions.contract.test.mjs`: `every action in the inventory goes through a confirmation`.
  - `src/lib/admin/customer-label.test.ts` (into `test:command-center`'s `bun test` list): `falls back to WhatsApp 客戶 and 未有電話, and masks to the last four digits`.
- [ ] **Step 2: red.** `npm run test:admin-link-bulk:ui`, `npm run test:admin-daily-work:ui`, `npm run test:command-center`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green**, plus `npm run test:whatsapp-safety:ui` (the 不是退訂 component test).
- [ ] **Step 5: lint, typecheck; screenshots** of the three dialogs at 375 and 1440.
- [ ] **Step 6: commit.** `fix(admin): confirm link 停用 and name the customer in sending confirmations` + G-26, G-24 + trailer.

### Task 4: Leave guards on the transaction form, CMS editors and campaign compose (G-20)

**Files:**
- **Modify `src/components/dashboard/TransactionForm.tsx`:** keep a `pristine` snapshot (as `PropertyForm`), `isDirty = !saved && !shallowEqualForm(form, pristine)`, `const { dialog } = useRouteLeaveGuard(isDirty)`, render `{dialog}`, and `setSaved(true)` **before** calling `onSaved` (`PropertyForm.tsx:296-300` pattern).
- **Modify `src/routes/admin.cms.tsx`:** in `CmsVideoDialog` (`:1926`), `EstateDialog` (`:2048`), `ArticleDialog` (`:2281`) and `FaqDialog` (`:2468`) add `const { dialog: leaveGuard } = useRouteLeaveGuard(<same isDirty as the close guard>)` and render it next to the existing `{dialog}`.
- **Modify `src/routes/admin.blasts.tsx:1170-1190`:** `useRouteLeaveGuard(hasUnsavedCampaignChanges || hasUnsavedAudienceChanges)`.
- **Create `src/routes/admin.leave-guards.contract.test.mjs`** (into `test:command-center`).
- Listing edit: **no change**; already guarded and browser-tested (fact 6).

**TDD steps:**
- [ ] **Step 1: failing tests.** `admin.leave-guards.contract.test.mjs`: `each guarded form mounts useRouteLeaveGuard and marks itself saved before navigating` (TransactionForm, the four CMS dialogs, the blasts workspace; `setSaved(true)` precedes `onSaved(` in TransactionForm). `src/components/dashboard/transaction-form-state.test.ts` (into `test:command-center`'s `bun test`): `a loaded transaction is clean; one edited field is dirty; saving makes it clean`. Extend `e2e/admin-campaign-review.spec.ts`: `typing in a new campaign then clicking a nav link asks 尚未儲存; cancelling keeps the draft`.
- [ ] **Step 2: red.** `npm run test:command-center`, `npm run test:admin-campaign-review:ui`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green**, plus `npm run test:cms`, `npm run test:property-maintenance:ui` (the existing listing guard still passes).
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.** `fix(admin): guard unsaved transaction, CMS and campaign work against leaving` + G-20 + trailer.

### Task 5: Remove the dead schedule field and the unsafe direct queue (D-13 / G-25)

**Files:**
- **Modify `src/routes/admin.blasts.tsx`:**
  - Delete the 「計劃發送時間（需人手確認）」 field, its hint and the comment (`:1950-1966`).
  - Delete the 「預定時間」 column (`:1349`, `:1425-1427`).
  - Status `Select` (`:1934-1949`): options 草稿（不可發送）, 待審核; add 已排期 **only** when `campaign.status === "scheduled"` (an existing row), so the select never shows blank (the G-17 bug).
  - The draft keeps `scheduled_at` exactly as loaded and the save sends it back unchanged (`:449`, `:514` become pass-through), so no stored value is overwritten.
- **Modify `src/lib/neon/admin-data.ts:1888-1900`:** delete the browser-callable `queueAdminCampaignServer` and `queueAdminCampaign`.
- **Modify `src/lib/neon/admin-data.server.ts:4622-4624`:** delete `queueCampaign` (no caller). The server `queueAdminCampaign` stays.
- **Modify `src/lib/neon/admin-data.contract.test.mjs:37`:** move `queueAdminCampaign` out of the "both export" list.
- **Modify `scripts/test-whatsapp-no-link-synthetic-browser.mjs:1445`:** expect the field to be absent.

**TDD steps:**
- [ ] **Step 1: failing tests.** `admin-data.contract.test.mjs`: `the only browser-callable campaign send path re-materialises recipients` (client has no `queueAdminCampaign` export; `api.admin.campaigns.$id.queue.ts` calls `sendAdminCampaignQueue`; `sendAdminCampaignQueue` calls `materializeCampaignRecipients` before `queueAdminCampaign`). `src/lib/admin/blast-review.test.mjs` (already in a script): `saving a campaign keeps an existing scheduled_at untouched`. `admin.routes.test.mjs`: `the campaign form has no schedule field and shows 已排期 only for a scheduled row`.
- [ ] **Step 2: red.** `npm run test:command-center`, `npm run test:admin-campaign:db`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green**, plus `npm run test:admin-campaign-review:ui`, `npm run test:admin-campaign:db` (the owned campaign recovery suite still passes unchanged).
- [ ] **Step 5: lint, typecheck, `rg "queueAdminCampaign" src/routes src/components src/lib/admin` is empty.**
- [ ] **Step 6: commit.** `fix(blasts): remove the schedule field and the queue path that skipped recipient checks` + D-13 + trailer.

### Task 6: Diagnostics are admin-only on the server, behind 「技術資料」 (G-11 server part)

**Files:**
- **Modify `src/lib/control-plane/permissions.ts`:** add `"system.diagnostics.read"` to `controlPlanePermissions` (admin gets it automatically). Add `export function canReadDiagnostics(roles: readonly string[]): boolean`.
- **Modify `src/lib/control-plane/capabilities.ts`:** add `diagnosticsRead`.
- **Create `src/lib/whatsapp-enquiries/assignment-view.js` + `.d.ts`** (pure): `toAssignmentContextView(raw, { diagnostics })`.
- **Modify `src/lib/whatsapp-enquiries/assignment.server.ts:132-138`:** return `toAssignmentContextView(row, { diagnostics: canReadDiagnostics(actor.roles) })`. Update `AssignmentContextDto` (`:431-457`) to the view type.
- **Create `src/lib/neon/staff-notification-view.js` + `.d.ts`** (pure): `toStaffNotificationView(item, { diagnostics })` strips `evidenceKind`, `error`, `acceptedSource`, `deliveredSource`, `readSource` from each attempt and moves them under `diagnostics` only for admins. Keeps `id`, `inquiryId`, `conversationId`, `assignmentVersion` (actions need them).
- **Modify `src/lib/neon/staff-notification-handlers.server.ts:24-27`:** map the `list` result through the view with `canReadDiagnostics(actor.roles)`.
- **Create `src/components/admin/AdminTechnicalDetails.tsx`:** a `Collapsible` with the trigger 「技術資料」; renders nothing when `data` is null or the session lacks `diagnosticsRead`.
- **Modify `src/components/admin/WhatsappEnquiryContext.tsx`:** main view uses the view's booleans (`confirmed`, `desired`) and names; 「支援診斷」 (`:221-232`) becomes `<AdminTechnicalDetails>` fed from `context.diagnostics`.
- **Modify `src/components/admin/StaffNotificationCard.tsx`:** the attempt line shows transport and state labels and HK-formatted times only; evidence kind, sources and error code move into `<AdminTechnicalDetails>` together with the existing ids (「接手支援診斷」 removed).
- **Fixtures and pinned tests:** `scripts/browser-fixtures/no-link/synthetic-api.ts` returns the view shape and honours the synthetic actor's role; `scripts/test-whatsapp-no-link-synthetic-browser.mjs:211`, `:1782` click 「技術資料」 as an admin and assert it is absent as an agent.

**Interfaces:**
```ts
// assignment-view.d.ts
export type AssignmentContextView = {
  proposedStaffName: string | null;
  confirmedStaffName: string | null; confirmed: boolean;
  desiredStaffName: string | null; desired: boolean;
  assignmentState: string | null;
  assignment_version: number;
  enquiries: { id: string; property: string | null; source: string | null; requestedStaffName: string | null;
               requested: boolean; dealType: string | null; firstResponseAt: string | null; dueAt: string | null; review: boolean }[];
  diagnostics: null | { proposalReason: string; proposedStaffId: string | null; confirmedStaffId: string | null;
    desiredStaffId: string | null; assignedAgentId: string | null; requestId: string | null; assignmentLock: boolean;
    evidence: Record<string, string | boolean> | null; enquiries: { id: string; requestedStaffId: string | null }[] };
};
export function toAssignmentContextView(raw: Record<string, unknown>, opts: { diagnostics: boolean }): AssignmentContextView;
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `enquiry-access.owned.db.test.mjs` (`test:whatsapp-access:db`, owned Postgres, real `readAssignmentContext`): `agent and manager assignment context carries no diagnostics; admin's does` (assert on `JSON.stringify(result)`: no seeded staff UUID other than in `enquiries[].id`, no `evidence`, no `proposalReason`, `diagnostics === null`; admin's `diagnostics.requestId` equals the seeded request).
  - `staff-notification-view.test.mjs` (new, into `test:staff-notifications`): `a non-admin list carries no evidence kind, source or error code on any attempt`; `the action ids survive for every role`. Plus a source test that the handler's `list` branch calls `toStaffNotificationView` with `canReadDiagnostics(actor.roles)`.
  - `permissions.test.mjs`: `only admin holds system.diagnostics.read`; keep `viewer holds exactly system.health.read and audit.read`.
  - `e2e/admin-safer-actions.spec.ts`: `an agent sees no 技術資料 in the inbox; an admin can open it`.
- [ ] **Step 2: red.** `npm run test:whatsapp-access:db`, `npm run test:staff-notifications`, `npm run test:control-plane`, `npm run test:admin-daily-work:ui`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green**, plus `npm run test:whatsapp-mobile:ui`, `npm run test:whatsapp-enquiries`.
- [ ] **Step 5: lint, typecheck; screenshots** of the inbox context and a notification card as agent and as admin, 375 and 1440.
- [ ] **Step 6: commit.** `fix(whatsapp): send assignment and notification diagnostics to admins only` + G-11 + trailer.

### Task 7: Failed jobs say why, open on 失敗 and filter by type (G-09)

**Files:**
- **Create `src/lib/admin/job-labels.ts`:** `JOB_TYPE_LABELS` (15 types, fact 10), `jobTypeLabel(type)` (unknown → 「其他工作」), `JOB_FAILURE_REASONS` (code → zh-HK, the table in "Copy for approval"), `jobFailureReason(code, status)` (null code on a failed job → 「失敗，未有記錄原因。」; unknown code → 「處理失敗（未分類原因）。」), `DELIVERY_JOB_TYPES` (`woztell.campaign.deliver`, `woztell.reply.deliver`, `lead.staff.alert`, `woztell.enquiry.staff.notify`).
- **Modify `src/components/admin/operations/AdminOperationsJobs.tsx`:**
  - `status` defaults to `"failed"`.
  - The free-text type input and 套用篩選 become a `Select` (所有類型 + the 15 labels) that applies on change.
  - The 工作 cell shows `jobTypeLabel`; a new 原因 column shows `jobFailureReason` for failed and retrying rows (`Badge variant="destructive"` stays on the status).
  - Each row gets `<AdminTechnicalDetails>` (admins only, `capabilities.diagnosticsRead`) with the raw type, job id and error code.
  - The retry/cancel confirmation (`:420-432`) describes 「{類型}：{原因}」 and, for `DELIVERY_JOB_TYPES`, adds the resend warning.
  - Empty state on 失敗: 「目前沒有失敗的背景工作。」.
- **Modify `src/components/admin/operations/operations-components.test.tsx`.**
- **Extend `e2e/admin-operations-recovery.spec.ts`** (property-maintenance fixture's `synthetic-operations.ts` gains one failed job with `errorCode: "WOZTELL_PROVIDER_TIMEOUT"` and one with `null`).

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `src/lib/admin/job-labels.test.ts` (into `test:operations`'s `bun test`): `every registered job type has a label` (reads the `jobType:` literals and the three loop arrays from `job-handlers.server.ts` and `lead-alert-enqueue.js`); `every code the job runner can store has a reason` (`JOB_HANDLER_FAILED`, `LEASE_EXPIRED`, `JOB_DEFERRED`, plus the retryable and terminal codes in fact 10); `unknown and null codes fall back`.
  - `operations-components.test.tsx`: `a failed job shows its zh-HK reason and type label, not the UUID`; `技術資料 renders only with diagnosticsRead`; `the status filter starts on 失敗`.
  - `admin-operations-recovery.spec.ts`: `the jobs tab opens on 失敗, shows 原因, and the type select narrows the list`; `a manager sees no 技術資料; an admin sees the job id inside it`; `retrying a delivery job warns that it may send again`.
- [ ] **Step 2: red.** `npm run test:operations`, `npm run test:operations:ui`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.**
- [ ] **Step 5: lint, typecheck, build; screenshots** of the jobs tab at 375 and 1440 as manager and admin.
- [ ] **Step 6: commit.** `fix(operations): show why a job failed, start on 失敗, filter by type` + G-09 + trailer.

**17a-1 PR checks:** lint, typecheck, build; `test:staff-server-fn`, `test:cms`, `test:admin-estates`, `test:command-center`, `test:operations`, `test:control-plane`, `test:staff-notifications`, `test:whatsapp-enquiries`, `test:whatsapp-safety:ui`, `test:whatsapp-access:db`, `test:admin-campaign:db`; every `playwright.admin-owned.config.ts` suite; `acceptance:whatsapp-no-link:synthetic` in the staging job.

---

# PR 17a-2: Clearer copy and small fixes (Tasks 8 to 14)

Cut from `main` after 17a-1 merges. Re-read fact 30: if #238 has merged by then, also do the deferred `admin.whatsapp.tsx:2347`, `:2500` copy and the `replyErrorLabels` move (Task 9), and the leads labels at `:963`, `:1017` (Task 8).

### Task 8: One glossary (G-12)

**Files:**
- **Create `src/lib/admin/glossary.ts`:** `ADMIN_TERMS` (the approved terms), and the status maps moved here unchanged except as approved: `LEAD_STAGE_LABELS`, `LEAD_SOURCE_LABELS`, `CONVERSATION_STATUS_LABELS`, `PROPERTY_STATUS_LABELS`, `CAMPAIGN_STATUS_LABELS`, `CMS_REVISION_STATE_LABELS`, `JOB_STATUS_LABELS`, `HEALTH_STATUS_LABELS`, `ASSIGNMENT_STATE_LABELS`, `PLACEMENT_SOURCE_LABELS`, `ROLE_LABELS`; re-exports `JOB_TYPE_LABELS` and `JOB_FAILURE_REASONS` from `job-labels.ts`.
- **Modify** each former owner to import from the glossary: `crm-presentation.ts:8-45` (keep its exports as re-exports; never touch `:65+`, #241), `property-management-ui.ts:6-13`, `admin.whatsapp.tsx:86-96` (**only if #238 merged**, else leave), `admin.blasts.tsx:130-139`, `admin.cms.tsx:2717-2722`, `AdminEstateEditorForm.tsx:177-182`, `AdminOperationsJobs.tsx:45-52`, `AdminOperationsOverview.tsx:28-40` (never `:13-26`, #240), `admin.operations.tsx:77-81`, `admin.index.tsx:353`, `WhatsappEnquiryContext.tsx:17-25`, `PropertyForm.tsx:347-351`.
- **Apply the approved term renames** (Copy table "Glossary") at the listed lines.
- **Create `src/lib/admin/glossary.test.ts`** (into `test:command-center`'s `bun test`).

**TDD steps:**
- [ ] **Step 1: failing tests** in `glossary.test.ts`: `each status map has one definition` (source scan: no other admin file defines a `Record` with the same keys and labels); `no admin page title, nav label or breadcrumb uses a rejected variant` (scan for 物業管理, 追蹤連結, WhatsApp 群發, 未分配, 未分派, 未指定代理 outside the deferred lines, 發佈, 線上客服, 降級, `live agent` in `src/routes/admin*.tsx`, `src/components/admin/**`, `PropertyForm.tsx`); `every approved term appears where the table says`.
- [ ] **Step 2: red.** `npm run test:command-center`.
- [ ] **Step 3: implement**; update pinned strings (`operations-components.test.tsx:268` 降級 → 需要留意).
- [ ] **Step 4: green**, plus `test:operations`, `test:cms`, `test:admin-properties`, `test:admin-daily-work:ui`, `test:property-maintenance:ui`.
- [ ] **Step 5: lint, typecheck.**
- [ ] **Step 6: commit.** `refactor(admin): one glossary for terms and status labels` + G-12 + trailer.

### Task 9: Plain zh-HK for the remaining jargon (G-11 copy part)

**Files and changes** (strings in "Copy for approval", group G-11):
- `WhatsappEnquiryContext.tsx`: source through `PLACEMENT_SOURCE_LABELS`; `firstResponseAt` / `dueAt` / queue `response_due_at` through `formatHkDateTime`; queue `assignment_state` through `ASSIGNMENT_STATE_LABELS`; 「未經供應商確認」 → approved text.
- `WhatsappLinksTable.tsx:316-340`: `unknown` → 「未有數據」 / 「未有紀錄」; placement through the glossary; `placementVerifiedAt` and `recentTest.createdAt` through `formatHkDateTime`; `recentTest.state` through a label map.
- `admin.operations.tsx:266`, `:322-323`: role wording instead of permission names.
- `StaffNotificationCard.tsx`: 供應商 wording; times through `formatHkDateTime`.
- If #238 merged: `admin.whatsapp.tsx:115`, `:2347`, `:2500` 供應商 wording; move `replyErrorLabels` and `bulkErrorLabels` into `ADMIN_ERROR_CODES`.

**TDD steps:**
- [ ] **Step 1: failing tests.** `src/components/admin/plain-copy.test.ts` (into `test:command-center`'s `bun test`): `no ISO timestamp or raw code renders in the enquiry context, link cards or notification card` (static render with fixture rows: assert no `/\d{4}-\d\d-\d\dT/`, no `unknown`, no `private_note_posted`, no `woztell_send_responses`, no `website`/`28hse` raw); `operations no-permission text names a role, not a permission`.
- [ ] **Step 2: red. Step 3: implement. Step 4: green** (`test:command-center`, `test:operations`, `test:admin-link-bulk:ui`, `test:whatsapp-mobile:ui`). **Step 5: lint, typecheck; screenshots.**
- [ ] **Step 6: commit.** `fix(admin): plain zh-HK for dates, sources and delivery states` + G-11 + trailer.

### Task 10: Hide what a role cannot use; say 沒有權限 instead of spinning (G-05)

**Files:**
- **Modify `src/components/admin/AdminShell.tsx:262-279`:** an entry whose `roles` exclude the signed-in roles is **not rendered** (roles `null` = lookup failed: still render all, as today). Delete `navDisabledClassName`, `requiredRoleLabel`, the `Lock` import and `ROLE_LABELS` if unused. Export `visibleNavItems(roles)` for the test.
- **Modify `src/routes/admin.index.tsx:118-200`:** skip the team and activity reads and their cards unless the session has admin or manager (team) and `audit.read` (activity); the agent overview shows 開放查詢, 系統健康, the two listing cards and 待處理對話.
- **Modify `src/routes/admin.whatsapp-links.tsx:21-28` and `src/routes/admin.whatsapp-settings.tsx`** (same pattern): while the session loads keep 「正在核實管理員權限…」; once the session is `ok` without admin/manager, render the 沒有權限 state.
- **Modify `src/routes/admin.listings.tsx:360-386`:** the two 「下一步：預覽 WhatsApp 連結」 buttons and the 連結建立範圍 row render only for admin/manager.
- **Create `src/components/admin/admin-nav-roles.test.mjs`** (into `test:command-center`'s `node --test`).

**TDD steps:**
- [ ] **Step 1: failing tests.** `admin-nav-roles.test.mjs`: `an agent sees exactly the entries whose first read accepts agent, and none is locked`; `every hidden entry's first server read rejects that role` (a table from fact 25, asserted against the server sources). `e2e/admin-daily-work.spec.ts` (fixture role switch): `an agent's overview makes no team or audit read and shows no 請稍後再試`. `e2e/admin-property-maintenance.spec.ts`: `an agent sees no WhatsApp link buttons on 樓盤管理`. `e2e/admin-staff-setup.spec.ts`: `an agent opening /admin/whatsapp-settings sees 沒有權限 within 2 s`.
- [ ] **Steps 2 to 5** as usual (`test:command-center`, `test:admin-daily-work:ui`, `test:property-maintenance:ui`, `test:staff-setup:ui`, `test:admin-link-bulk:ui`).
- [ ] **Step 6: commit.** `fix(admin): hide screens a role cannot open and say 沒有權限` + G-05 + trailer.

### Task 11: KPI tiles open the list they count (G-21)

**Files:**
- **Create `src/lib/admin/command-center-queues.js` + `.d.ts`** (pure, importable from the server and `node --test`): `COMMAND_CENTER_QUEUES` in button order (`today`, `high_score`, `overdue`, `unassigned`, `live_agent`, `whatsapp_blocked`, `whatsapp`, `all`), `matchesCommandCenterQueue(row, key)`, `commandCenterKpis(rows)`.
- **Modify `src/lib/neon/admin-data.server.ts:3108-3116`:** `const kpis = commandCenterKpis(mapped.map((m) => m.row))`. The KPI keys stay (`hot`, `overdue`, `unassigned`, `handoffs`, `whatsapp_blocked`) so the type is unchanged; `hot` now counts `high_score` and `handoffs` counts `live_agent` (Open question 5).
- **Modify `src/routes/admin.leads_.command-center.tsx`:** `FILTERS` and `matchesFilter` come from the module; `KpiStrip` renders each tile as a `Link` to `?queue=<key>` with `aria-current` when active and a visually hidden 「（按此查看名單）」.

**TDD steps:**
- [ ] **Step 1: failing tests.** `command-center-queues.test.mjs` (into `test:command-center`): `each KPI equals the number of rows its tile's queue shows` (20 synthetic rows covering every predicate); `admin-data.server.ts computes KPIs only through commandCenterKpis` (source test). `admin.routes.test.mjs`: `every KPI tile links to a queue the page accepts`.
- [ ] **Steps 2 to 5** (`test:command-center`, `test:admin-overview:db`).
- [ ] **Step 6: commit.** `fix(command-center): KPI tiles open the queue they count` + G-21 + trailer.

### Task 12: Open the new listing after save; unique keys; plain listing labels (G-07, G-22)

**Files:**
- `src/routes/admin.listings_.new.tsx:55-58`: `onSaved={(id) => { if (isWorkspaceCurrent()) void navigate({ to: "/admin/listings/$id", params: { id } }); }}`.
- `src/components/dashboard/PropertyForm.tsx:67`, `:400`, `:507`, `:516`: the approved labels and messages.
- `src/routes/admin.property-sync.tsx:36`, `:44`: `key={`sync:${user?.id}`}` and `key={`withdrawal:${user?.id}`}`.

**TDD steps:**
- [ ] **Step 1: failing tests.** `e2e/admin-property-maintenance.spec.ts`: `saving a new listing opens its management page with the draft visible, and no leave prompt appears`. `admin.routes.test.mjs`: `property-sync siblings have distinct keys`; `PropertyForm has no English field labels`.
- [ ] **Steps 2 to 5** (`test:property-maintenance:ui`, `test:command-center`, `test:property-sync:ui`).
- [ ] **Step 6: commit.** `fix(listings): open a new listing after save; distinct sync keys` + G-07, G-22 + trailer.

### Task 13: The first-login checklist is remembered per account (G-18)

**Storage decision.** No column exists (fact 19). The confirmation is written to the existing `audit_logs` (`actor_id = staffId`, `action = 'first_login_checklist.confirmed'`, `subject_type = 'staff_user'`, `subject_id = staffId`) through `writeAudit`. That makes it per account, on every device, with an audit trail, and needs **no migration**. Because `audit_logs` has no index on `actor_id`/`action`, the browser caches a positive answer in `localStorage` (`earnest:first-login-checklist:<staffId>`), so the read runs at most once per account per browser. `sessionStorage` is no longer used.

**Files:**
- **Create `src/lib/neon/staff-checklist.ts`** (server functions, Zod-validated, `requireStaffAccess(["admin","manager","agent","viewer"])`) and **`staff-checklist.server.ts`** (SQL): `fetchFirstLoginChecklistDone(): Promise<boolean>` (`SELECT EXISTS (SELECT 1 FROM audit_logs WHERE actor_id = $1 AND action = 'first_login_checklist.confirmed')`) and `confirmFirstLoginChecklist(): Promise<{ ok: true }>` (idempotent: insert only when absent, in one statement).
- **Modify `src/components/admin/AdminShell.tsx:441-451`, `:601-630`:** read the cache, else the server; 我已核對 calls the server, then caches; a failed save shows the approved error and keeps the panel.
- **Create `src/lib/neon/staff-checklist.owned.db.test.mjs`** and add it to `test:admin-overview:db`.

**TDD steps:**
- [ ] **Step 1: failing tests.** Owned DB: `confirming twice writes one row and only for the caller`; `another account still sees the checklist`; `a viewer can confirm`. `e2e/admin-daily-work.spec.ts`: `after 我已核對, a new tab and a reload show no checklist; another account sees it`.
- [ ] **Steps 2 to 5** (`test:admin-overview:db`, `test:admin-daily-work:ui`).
- [ ] **Step 6: commit.** `fix(admin): remember the first-login checklist per account` + G-18 + trailer.

### Task 14: L-02 dry run (no code change)

**File:** `docs/audits/fx-plans/FX-17a-l02-dry-run.sql` (documentation only, never run by CI or an agent against production).

```sql
-- FX-17a L-02 dry run. READ ONLY. Lists candidate test records; changes nothing.
-- The owner runs it on a Neon branch of production (or production with a read-only role),
-- names the records to act on, and takes a branch/snapshot BEFORE any change.
BEGIN TRANSACTION READ ONLY;

-- 1. Staff that look like test identities.
SELECT 'staff' AS kind, s.id, COALESCE(NULLIF(s.name_zh,''), s.name_en) AS name,
       s.email, s.active, s.created_at
FROM staff_users s
WHERE s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%'
   OR s.name_zh LIKE '%測試%'
ORDER BY s.created_at;

-- 2. Live WhatsApp routing that points at those staff.
SELECT 'wa_mapping' AS kind, c.id, c.staff_id, c.eligible, c.retired_at
FROM whatsapp_staff_channels c JOIN staff_users s ON s.id = c.staff_id
WHERE c.retired_at IS NULL
  AND (s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%' OR s.name_zh LIKE '%測試%');

-- 3. Enabled source links that route to them.
SELECT 'link' AS kind, l.id, l.code, v.public_listing_no, v.requested_staff_id
FROM whatsapp_tracking_links l
JOIN whatsapp_tracking_link_versions v ON v.link_id = l.id AND v.version = l.current_version
JOIN staff_users s ON s.id = v.requested_staff_id
WHERE v.enabled
  AND (s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%' OR s.name_zh LIKE '%測試%');

-- 4. Open conversations owned by them (no phone numbers printed).
SELECT 'conversation' AS kind, w.id, w.status, w.assigned_agent_id, w.confirmed_staff_id
FROM whatsapp_conversations w JOIN staff_users s ON s.id IN (w.assigned_agent_id, w.confirmed_staff_id)
WHERE w.status <> 'closed'
  AND (s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%' OR s.name_zh LIKE '%測試%');

-- 5. Test leads (only the last 4 phone digits).
SELECT 'lead' AS kind, l.id, l.stage, l.source, c.name, right(c.phone, 4) AS phone_tail, l.created_at
FROM crm_leads l LEFT JOIN crm_contacts c ON c.id = l.contact_id
WHERE l.source = 'manual_test' OR c.name LIKE '[內部測試]%' OR l.note LIKE '%內部測試%'
ORDER BY l.created_at;

-- 6. Sizing for Task 13's checklist read.
SELECT count(*) AS audit_log_rows FROM audit_logs;

ROLLBACK;
```

- [ ] **Step 1:** add the file; `docs` only. **Step 2: commit.** `docs(audit): add the L-02 read-only dry run` + trailer.

**17a-2 PR checks:** lint, typecheck, build; `test:command-center`, `test:operations`, `test:cms`, `test:admin-properties`, `test:control-plane`, `test:admin-overview:db`, `test:property-sync:ui`; every `playwright.admin-owned.config.ts` suite.

---

## Copy for approval (admin zh-HK, verbatim)

`{…}` is a value filled in at run time.

### 17a-1, Task 1: errors (G-19)
| Place | Current | Proposed |
|---|---|---|
| Any unmapped staff action failure (toasts on the seven screens) | the raw server text, e.g. `Not found`, `relation "x" does not exist`, `CMS_REVIEW_FORBIDDEN` | 操作未完成，請重試。 (existing string) or that screen's existing fallback |
| All other mapped codes | unchanged | unchanged (moved into one map) |

### 17a-1, Task 2: CMS 還原 and compare (G-08, G-10)
| Place | Current | Proposed |
|---|---|---|
| Restore confirm title | (none in 內容中心); estate editor: 還原此版本？ | 還原此版本？ |
| Restore confirm description | estate editor: 還原會以該版本內容建立新草稿，並覆蓋目前表單內未儲存的修改。 | 還原會以 v{版本}（{狀態}，{日期時間}）的內容建立新草稿。以下內容會被取代： |
| Restore list item, unsaved | — | 目前表單內未儲存的修改：{欄位一}、{欄位二}… |
| Restore list item, clean | — | 目前沒有未儲存的修改。 |
| Restore list item, saved draft | — | 你已儲存的草稿 v{版本}（{日期時間}） |
| Restore confirm button | (estate editor) 還原 | 還原 |
| Compare button | 比較目前發布版本（保留本機修改） | 與已發布版本比較 |
| Compare heading | 目前發布版本 {n} | 與已發布版本 v{n} 比較 |
| Compare, never published | 目前發布版本 無 | 此內容尚未發布，以下列出目前表單的所有欄位。 |
| Compare table headers | — | 欄位 ／ 已發布版本 ／ 目前表單 |
| Compare, no difference | — | 目前表單與已發布版本相同。 |
| Compare, blank value | — | （空白） |
| Compare, unlabelled fields | — | 另有 {n} 項系統欄位不同。 |
| Compare, long value toggle | — | 顯示全部 ／ 收起 |
| Compare, backup button | (textarea label) 本機修改備份（可複製） | 複製本機修改（備份） |
| Compare, copied toast | — | 已複製本機修改。 |
| Compare, copy failed | — | 未能自動複製，請在下方手動複製。 (then the existing textarea 本機修改備份（可複製）) |
| Compare, field labels | — | as the form labels today: 網址代稱（Slug）, 中文名, 英文名, 地區, 發展商, 落成年份, 期數, 伙數, 面積下限（平方呎）, 面積上限（平方呎）, 設施, 描述, 屋苑主圖, SEO 標題, SEO 描述; article: 網址代稱（Slug）, 標題, 分類, 閱讀分鐘, 摘要, 內容, 封面圖片, 公開狀態, 發布日期, SEO 標題, SEO 描述 |

### 17a-1, Task 3: confirmations naming the record or customer (G-26, G-24)
| Place | Current | Proposed |
|---|---|---|
| Link 停用 title | (no dialog) | 停用此來源連結？ |
| Link 停用 description | — | 停用後，客戶開啟此連結會改為聯絡公司總台，查詢不會再記錄為來自這個投放。之後可重新啟用。 |
| Link 停用 rows | — | 樓盤：{樓盤編號 或 一般查詢} · {售／租} ／ 投放位置：{投放位置} ／ 連結：/w/{code} ／ 指定同事：{姓名 或 總台} |
| Link 停用 button | 停用 (one click) | 停用 (confirm, destructive) |
| Template send description | 將向客戶傳送已審批範本「{範本}」。範本一經傳送即無法收回。 | 將向 {客戶名稱}（{電話}）傳送已審批範本「{範本}」。範本一經傳送即無法收回。 |
| Template send rows | — | 客戶：{客戶名稱} ／ 電話：{••••1234} |
| Customer name fallback | — | WhatsApp 客戶 (existing) |
| Phone fallback | — | 未有電話 (existing) |
| Consent dialog, new line under the description | — | 客戶：{客戶名稱}（{電話}） |
| 不是退訂 dialog, new line | — | 客戶：{客戶名稱}（{電話}） |

### 17a-1, Task 4: leave guards (G-20)
No new copy. Reused: 尚未儲存 ／ 你在此頁有未儲存的修改，離開後會遺失。確定要離開嗎？ ／ 離開並放棄修改.

### 17a-1, Task 5: removed copy (D-13)
| Place | Current | Proposed |
|---|---|---|
| Campaign form field | 計劃發送時間（需人手確認） | (removed) |
| Its hint | 系統不會自動發送。到時仍需人手按「發送…」。 | (removed) |
| Campaign table column | 預定時間 | (removed) |
| Status option | 已排期 (always) | 已排期 (only on a row that already has it) |

### 17a-1, Task 6: 技術資料 (G-11 server part)
| Place | Current | Proposed |
|---|---|---|
| Inbox disclosure | 支援診斷 (everyone) | 技術資料 (admins only) |
| Notification card disclosure | 接手支援診斷 (everyone) | 技術資料 (admins only) |
| Notification attempt, main line | {傳送方式}：{狀態} · {evidenceKind} · 接納 {ISO}（{來源}） · 送達 … · {error} | {傳送方式}：{狀態} · 接納 {日期時間} · 送達 {日期時間} · 已讀 {日期時間} |
| Inside 技術資料 (admins), new labels | — | 證據類型：{值} ／ 接納來源：{值} ／ 送達來源：{值} ／ 已讀來源：{值} ／ 錯誤代碼：{值} |
| Inbox main view, no confirmation | 已確認負責人：…（未經供應商確認） | 已確認負責人：尚未確認 |
| Inbox main view, name missing | 負責同事名稱待核實 / 指定同事名稱待核實 | unchanged |

### 17a-1, Task 7: failed jobs (G-09)
| Place | Current | Proposed |
|---|---|---|
| Status filter default | 所有狀態 | 失敗 |
| Type filter | free text 輸入工作類型篩選 + 套用篩選 | Select: 所有類型 + the type labels below |
| New column | — | 原因 |
| Empty on 失敗 | 沒有符合目前篩選的工作。 | 目前沒有失敗的背景工作。 |
| Retry confirm description | {jobType}（{UUID}） | {工作類型}：{原因} |
| Retry warning, delivery jobs | — | 重試可能會再次發送 WhatsApp 訊息。請先核對客戶或同事是否已收到，才重試。 |
| Admin 技術資料 rows | (UUID printed in the main cell) | 工作類型代碼：{值} ／ 工作編號：{值} ／ 錯誤代碼：{值} |

Job type labels: `ai.knowledge.rebuild` 重建 AI 知識庫 · `ai.knowledge.repair` 更新 AI 知識庫 · `woztell.campaign.deliver` 推廣活動發送 · `woztell.reply.deliver` WhatsApp 回覆發送 · `woztell.history.import` WhatsApp 對話紀錄匯入 · `woztell.enquiry.process` WhatsApp 查詢處理 · `woztell.enquiry.service` WhatsApp 查詢服務跟進 · `woztell.enquiry.assign` WhatsApp 查詢指派 · `woztell.enquiry.sla.check` 回覆期限檢查 · `woztell.enquiry.staff.notify` 同事接手通知 · `woztell.enquiry.staff.notify.reconcile` 同事通知結果核對 · `woztell.enquiry.staff.ack.check` 同事接手確認檢查 · `woztell.enquiry.staff.test` 同事通知測試 · `lead.staff.alert` 新客戶查詢通知 · `lead.staff.alert.reconcile` 新客戶查詢通知核對 · any other 其他工作.

Failure reasons (`errorCode` → text): `JOB_HANDLER_FAILED` 處理時出錯，原因未分類。 · `LEASE_EXPIRED` 處理時間過長，工作中斷。 · `JOB_DEFERRED` 等候另一項發送完成後再處理。 · `VALIDATION_ERROR` 工作資料不完整，無法處理。 · `WOZTELL_PROVIDER_TIMEOUT` WhatsApp 服務沒有及時回應。 · `WOZTELL_PROVIDER_UNAVAILABLE` WhatsApp 服務暫時無法使用。 · `WOZTELL_CONFIGURATION_UNAVAILABLE` WhatsApp 發送設定未完成。 · `WOZTELL_DELIVERY_INCOMPLETE` 部分訊息未完成發送。 · `WOZTELL_CAMPAIGN_PAUSED` 推廣活動已暫停，請到推廣活動恢復。 · `WOZTELL_PROVIDER_REJECTED` WhatsApp 服務拒絕了發送要求。 · `WOZTELL_DELIVERY_UNKNOWN` 發送結果不明，請先核對再重試。 · `INTEGRATION_TIMEOUT`, `OPENCODE_GO_TIMEOUT` 外部服務沒有及時回應。 · `JOB_OWNERSHIP_LOST`, `JOB_LEASE_REQUIRED` 工作已由另一個處理程序接手。 · `PERMISSION_DENIED` 執行此工作的帳戶沒有權限。 · `SCHEMA_RELATION_MISSING`, `SCHEMA_COLUMN_MISSING` 資料庫未更新到所需版本。 · failed with no code 失敗，未有記錄原因。 · any other code 處理失敗（未分類原因）。

### 17a-2, Task 8: glossary (G-12)

| Term | Current variants (where) | Proposed single term |
|---|---|---|
| Listings area | 樓盤管理 (nav `AdminShell.tsx:99`); 物業管理 (`admin.listings.tsx:57,67,221`, `admin.listings_.$id.tsx:91`, `AdminPropertyTable.tsx:146`, `WhatsappLinkWizard.tsx:537,672`) | 樓盤管理 (e.g. 已從樓盤管理帶入 {n} 筆租售 ／ 從樓盤管理可選更多) |
| Source links | WhatsApp 來源連結 (nav); WhatsApp 追蹤連結 (`admin.whatsapp-links.tsx:15,25,68`); 編輯追蹤連結 (`WhatsappLinksTable.tsx:402`) | WhatsApp 來源連結; 編輯來源連結 |
| Campaigns | 推廣活動 (nav); WhatsApp 群發 (`admin.blasts.tsx:199,208`; description `:1226`); Campaign (≈52 body strings) | 推廣活動 (title, head title, description 推廣活動：只用已審批範本、只發給已同意接收的客戶。); body sweep in 17b |
| A CRM lead vs an enquiry row | 客戶查詢 (nav, leads, 39); 銷售線索 (`admin.analytics.tsx:393-436`, where 客戶查詢 means an `inquiries` row) | 客戶查詢 = a CRM lead; 查詢紀錄 = one enquiry row. Analytics: 查詢紀錄 ／ 已連結客戶查詢的查詢紀錄 ／ 客戶查詢 ／ 未指派查詢紀錄 ／ 未指派客戶查詢 ／ 未指派對話 ／ 客戶查詢和對話是不同記錄，不能相加當作客戶人數。 ／ 客戶查詢及 WhatsApp 對話數量 |
| Unassigned | 未分配 (command center `:40`, analytics); 未分派 (inbox filter); 未指派 / 未指派代理 / 未指定代理 (leads) | 未指派 (select option: 未指派; leads `:963`, `:1017` after #238) |
| Lead / conversation owner | 負責代理 (22); 負責同事 (`admin.blasts.tsx:2167`, `admin.whatsapp.tsx:1157`) | 負責代理 (`admin.blasts.tsx:2167` 負責代理; `admin.whatsapp.tsx:1157` 查看客戶訊息、指派負責代理及回覆；對話列表每分鐘自動更新，亦可按「重新整理」即時讀取。). 本次查詢負責同事 stays (a different thing: one enquiry's owner) |
| Publish | 發布 (48); 發佈 (10: `admin.cms.tsx:2231,2233,2436,2438,2691,2695,2711`; `AdminContentCopilot.tsx:141,396,652`) | 發布: 確認發布內容 ／ 確認發布 ／ 圖片上載中，完成後才可儲存、發布或關閉 ／ 發布中… ／ 發布 ／ 只會處理可編輯的內容欄位，不會修改售價、狀態或已發布資料。 ／ 建議只會套用到目前表單，仍需由你儲存或發布。 ／ 。只修改目前草稿，仍需手動儲存；放棄不會發布或傳送。 |
| Website chat | 線上客服 (`crm-presentation.ts:40`, command center `:41`, `:69`, `:479`); 問樓助手 (public); live agent (CMS, fixed by #240) | 問樓助手: lead source 問樓助手 ／ queue 問樓助手轉介 ／ tile 新問樓助手轉介 ／ reason 問樓助手新轉介 (fixes 「新線上客服轉介 轉介」) |
| Inbox | WhatsApp 收件匣; Inbox (WozTell product, settings screens) | WhatsApp 收件匣 for the staff inbox; 「WozTell Inbox」 only when the settings screens mean the provider product (no change in 17a) |
| Audience | 收件群組 (37); 客戶分群 (nav); 客戶名單 (3) | decided in 17b with the merge (Open question 6) |
| Health status | 正常 / 降級 / 故障 | 正常 / 需要留意 / 故障 |
| Roles | admin / manager / agent / viewer (English, nav tooltips) | 管理員 / 經理 / 代理 / 只讀同事 (tooltips are removed by Task 10; the labels are for any remaining display) |
| Diagnostics | 支援診斷 / 接手支援診斷 | 技術資料 (17a-1) |
| Support reference | 支援參考編號 (`AdminOperationsJobs.tsx:56`) / 參考編號 | 參考編號 |
| Property status | 在售/在租, 已售出, 已租出, 下架 (`PropertyForm.tsx:348-351`) vs 公開, 已售, 已租, 已下架 | 公開 / 草稿 / 已售 / 已租 / 已下架 / 來源已下架 |
| Provider acceptance | 供應商已接納（未證實送達） (`StaffNotificationCard.tsx:60`); 供應商已接納（未確認送達） (`admin.whatsapp.tsx:115`, `:2347`); 供應商已接納，尚未核實送達 (`StaffTestNotificationDialog.tsx:210`); 供應商已接納傳送要求，尚未證實送達或已讀。 (`admin.whatsapp.tsx:2500`) | 已交 WhatsApp 發送（未確認送達） ／ 已交 WhatsApp 發送，尚未確認送達或已讀。 (`:2347`, `:2500` only after #238) |
| Placement source | website / 28hse / youtube / unknown / other (raw) | 網站 / 28Hse / YouTube / 來源未記錄 / 其他 |
| Duplicated maps, same text | CMS revision states ×2, job status ×2, health ×2, conversation status ×2 | one definition each, text unchanged |

### 17a-2, Task 9: plain copy (G-11)
| Place | Current | Proposed |
|---|---|---|
| Enquiry card source | · 來源 {website} | · 來源：{網站} |
| Enquiry card times | 首個人手回覆：{ISO} · 服務期限：{ISO} | 首個人手回覆：{日期時間} · 服務期限：{日期時間} |
| Enquiry queue row | … · {assignment_state 原文} · 期限 {ISO} | … · {分派狀態} · 期限 {日期時間} |
| Link card counts | 開啟 {n 或 unknown} · 歸因查詢 {n 或 unknown} | 開啟 {n 或 未有數據} · 帶來查詢 {n 或 未有數據} |
| Link card source | {website} | {網站} |
| Link details | 核實：{ISO} ／ 最近試送：{state} · {ISO} 或 unknown | 核實：{日期時間} ／ 最近試送：{狀態} · {日期時間} 或 未有紀錄 |
| Operations disabled tab tooltip | 需要 {system.jobs.read} 權限，請聯絡系統管理員 | 只供經理或管理員使用 (jobs, audit) ／ 只供管理員使用 (migrations) |
| Operations no-permission | 你未有存取「{分頁}」的權限（需要 {permission}） | 你未有存取「{分頁}」的權限。如需要，請聯絡管理員。 |

### 17a-2, Task 10: hide by role (G-05)
| Place | Current | Proposed |
|---|---|---|
| Nav for a role that cannot open an entry | locked row + 需要 {manager} 或以上權限，請聯絡系統管理員 | (entry not shown) |
| /admin/whatsapp-links, /admin/whatsapp-settings for an agent | 正在核實管理員權限… (forever) | title 沒有權限; text 此頁只供經理或管理員使用。如需要，請聯絡管理員。 |
| Dashboard team and activity cards for an agent | 暫時無法載入此營運資料，請稍後再試。 | (cards not shown) |

### 17a-2, Task 11: KPI tiles (G-21)
| Place | Current | Proposed |
|---|---|---|
| Tile screen-reader suffix | — | （按此查看名單） |
| New queue buttons | — | 逾期跟進 ／ WhatsApp 受阻 (same words as the tiles) |
| Queue 線上客服 / tile 新線上客服轉介 | as is | 問樓助手轉介 ／ 新問樓助手轉介 (glossary) |

### 17a-2, Task 12: listing form (G-07)
| Place | Current | Proposed |
|---|---|---|
| `PropertyForm.tsx:400` | 地區 slug * | 地區代碼 *（選擇屋苑後自動填寫） |
| `:67` messages | 請輸入地區 slug ／ 地區 slug 最多 60 個字 | 請輸入地區代碼 ／ 地區代碼最多 60 個字 |
| `:507` | English title | 英文標題 |
| `:516` | Features (one per line) | 特色（每行一項） |
| Status select `:348-351` | 在售/在租 ／ 已售出 ／ 已租出 ／ 下架 | 公開 ／ 已售 ／ 已租 ／ 已下架 |

### 17a-2, Task 13: checklist (G-18)
| Place | Current | Proposed |
|---|---|---|
| Save failure | — | 未能記錄核對，請重試。 |
| Checklist body | unchanged | unchanged |

## Owner actions before production

**Order (each PR):** owner approves this plan and its copy → CI green → Vercel preview on a Neon branch → preview check → merge → canary. No migration, so no readback is needed (`app_migrations` is unchanged).

1. **17a-1 preview check** (staff test login, Neon branch; no real customer):
   - 內容中心: edit an estate, then 還原 an older version: the dialog lists the edited fields and your draft; cancel keeps them; confirm restores. 還原 is not shown on your own 草稿 row, nor for an agent login.
   - 與已發布版本比較 shows a table; 複製本機修改（備份） copies.
   - WhatsApp 來源連結: 停用 asks first; cancel leaves it enabled.
   - WhatsApp 收件匣 on a synthetic conversation outside 24 h: the template confirmation names the customer and ••••tail. Do **not** confirm the send.
   - Leave a half-filled 新增成交 and a half-filled campaign by clicking the nav: 尚未儲存 appears.
   - 系統營運 › 背景工作 opens on 失敗 with a 原因 column; as admin, 技術資料 shows the code; as a manager it is absent.
   - As an agent, the inbox shows no 技術資料, and the browser network panel shows no `evidence`, `proposalReason` or `request_id` in the assignment response.
2. **17a-2 preview check:** an agent's sidebar has no locked rows; 跟進工作台 tiles open their queues with the same counts; a new listing opens after save; 我已核對 survives a new tab and another browser for the same account.
3. **L-02:** run the dry-run SQL on a Neon branch; name the records to act on. Then, in the app (no SQL): suspend the `test` staff in 團隊成員 (it asks for a handover target), retire its mapping in WhatsApp 映射設定, and move the `[內部測試]` lead to 已結束（未成交） with a note. If you ever want a SQL delete instead, take a Neon branch snapshot first and run it yourself; we never delete production data.
4. **Canary (48 h after each merge):** no new raw-English toast reports; `[admin]` errors in Vercel logs unchanged; the failed-job count on 系統營運 matches the 失敗 list. Then update the audit Status column and `CHANGELOG.md`.

**Rollback:** revert the PR. Nothing in data or configuration changes; the `first_login_checklist.confirmed` audit rows are harmless if 17a-2 is reverted.

## Open questions

Each has a recommended default; I will use it unless the owner says otherwise.

1. **發布 or 發佈?** **Default: 發布** (48 uses today; 10 strings change). 發佈 is the more usual HK form; choosing it renames the 48 instead.
2. **Who sees 技術資料?** **Default: admins only** (`system.diagnostics.read`). Managers would otherwise also get provider evidence and staff IDs.
3. **Jobs open on 失敗?** **Default: yes, every time the tab opens.** 所有狀態 is one click away.
4. **Hide locked nav entries, or keep them greyed?** **Default: hide.** Fewer rows; the server still refuses.
5. **KPI numbers change** for 「AI 高分查詢」 (now score ≥ 60, as its queue) and 「新問樓助手轉介」 (now every handoff, as its queue). **Default: accept;** a tile must count what it opens.
6. **Audience naming (收件群組 / 客戶分群 / 客戶名單).** **Default: decide in 17b**, when 客戶分群 becomes step 1 of 推廣活動.
7. **Checklist storage.** **Default: `audit_logs` + a per-browser cache, no migration.** The alternative is a `staff_users.first_login_checked_at` column (a migration with a readback).
8. **A "test" flag excluded from metrics (L-02).** **Default: not now.** Suspend, retire and close via the app; revisit only if test data keeps appearing.
9. **Re-enable without confirmation?** **Default: yes;** re-enabling restores routing and loses nothing.

## Findings that differ from the approved fix plan

1. **D-13 is a send-safety issue, not dead code.** The browser-callable `queueAdminCampaign` queues a campaign without re-materialising recipients (fact 22). It is removed in 17a-1, not left to FX-19a.
2. **G-11 needs a server change.** The assignment context and staff-notification list send IDs and provider evidence to every role today (facts 12, 13). Hiding them in the UI alone would break owner rule 3, so 17a adds an admin-only permission and strips them on the server.
3. **G-21 tiles do not count what their lists show** (fact 23). Making them clickable needs one shared predicate module; two tile numbers change (Open question 5).
4. **17a is split in two** (14 tasks): 17a-1 safety first, 17a-2 copy and small fixes cut after it merges.
5. **G-08 is wider:** 還原 also retires the staff member's own saved draft, is shown on draft rows where it always fails, and is shown to agents whom the server refuses (fact 1).
6. **G-20:** listing edit is already guarded and tested (fact 6). The real gaps are the transaction form, the CMS editors (Back and tab close) and campaign compose; all reuse the existing hook.
7. **G-18 needs no migration:** the existing `audit_logs` table holds it (fact 19).
8. **G-07:** the region already defaults from the estate; only the save target and the English labels remain (fact 16).
9. **G-16 is already fixed; G-22 also exists in the inbox and is fixed by #238** (facts 17, 26).
10. **Deferred because of #238:** the leads 前往跟進工作台 button, two leads labels, the 標記為已結束 confirmation, conversation reassignment confirmation, the composer `window.confirm`, and the inbox 供應商 strings (fact 30). The blasts "Campaign" sweep, the audience name and the rest of D-13 (Zod, filters) move to 17b, which rebuilds those screens.
11. **G-09:** the raw error text is already kept server-side; the browser gets only a fixed code. 技術資料 shows that code, the job id and the raw type to admins.

---

## Outline: 17b, fewer screens (S4, G-06, G-14)

**Goal.** 17 nav entries → about 10; agents see only what they can use; one owner per enquiry; start a WhatsApp from a lead safely.

**Merges and redirects** (each old route keeps working through a TanStack `beforeLoad` redirect that preserves its query string; no `vercel.ts` change):

| Old | New | Old route redirect |
|---|---|---|
| 跟進工作台 `/admin/leads/command-center` | 「今日要跟」 view in 客戶查詢 (`/admin/leads?view=today`, KPI tiles from 17a-2 move with it) | `/admin/leads/command-center?queue=x` → `/admin/leads?view=today&queue=x` |
| 客戶分群 `/admin/segments` | step 1 of 推廣活動 (`/admin/blasts?step=audience`) | `/admin/segments` → `/admin/blasts?step=audience` |
| WhatsApp 來源連結 + 映射設定 | 「WhatsApp 設定」 (admins and managers, tabs 來源連結 / 同事映射) | both old paths → `/admin/whatsapp-settings?tab=…` |
| 經紀檔案 `/admin/agents*` | a tab in 團隊成員 | `/admin/agents` → `/admin/team?tab=profiles`; `/admin/agents/$id` → `/admin/team?tab=profiles&profile=$id` |
| 盤源同步 `/admin/property-sync` | a manager tab in 樓盤管理 | → `/admin/listings?tab=sync` |
| two estate editors (CMS dialog and `/admin/estates/$id`) | one (`AdminEstateEditorForm`) | CMS estate rows link to `/admin/estates/$id` |
| 資料庫遷移 tab | removed from the UI (the CLI and API stay) | `?tab=migrations` → `?tab=overview` |

Also: the blasts "Campaign" copy sweep and the audience name (17a Open question 6); D-13's campaign Zod validator and segment/audience filter alignment; the property-sync 「支援診斷」 → `AdminTechnicalDetails`; the leads items deferred from 17a.

**G-06, one owner.** Assigning a lead also hands over its open conversation, through the existing assignment-request path (WozTell assignment, `admin-data.server.ts` lead update + `whatsapp-enquiries/assignment.server.ts`), with a confirmation that names the customer and both staff. A conflict (the chat is mid-handover or locked) leaves the lead change unsaved and says why. Tests: owned DB `assigning a lead moves its conversation once and audits both`; browser `the confirmation names customer, from and to`.

**G-14, consent-checked template start from a lead.** Replaces the identical plain links in `RelatedLeadConversations.tsx:36-42`. Server path: check opt-in and opt-out (FX-08 rules: STOP / 退訂 blocks templates), the 24-hour window, a verified phone (FX-12 single format), and that no conversation already exists (else link to it); then the existing template send. **Needs a WhatsApp safety review before build:** wrong-number risk on contacts whose phone came from a web form, consent evidence on old contacts, and duplicate conversations. Tests mock `provider-fetch.ts`; manual checks use the WozTell sandbox and the owner's test number only.

**Tests.** `e2e/admin-nav-merge.spec.ts` (new, owned config): every old route redirects with its query; an agent sees ≤ 8 entries, none locked. Before/after screenshots at 375 and 1440.

**Dependencies.** **#238 must merge first:** it rewrites `admin.leads.tsx:911-1216` and adds `ContactIdentityReviewList` to `/admin/leads` and `/admin/whatsapp`, and G-14 depends on its single phone format and identity review. 17a-1 and 17a-2 merged (KPI tiles, glossary, `AdminTechnicalDetails`). #240 merged (CMS copy) before the estate editor merge. No migration expected; G-06 may need a function change, which would follow the migration sequence and owner readback.

## Outline: 17c, mobile inbox (G-04, G-15, G-23)

**Goal.** On a 390 px phone the thread is the first thing staff see and is usable for typing a reply.

- **G-04:** thread first; the context panel (查詢跟進, 技術資料) collapsed behind one `Collapsible` header; the name/status shown once (`admin.whatsapp.tsx:1615`, `:1702`).
- **G-15:** one `ConversationWorkspace` mount (today mounted twice, `:1055-1072`, `:1213`, `:1275`); the 我的接手工作 panel folds into the conversation list as a filter/badge instead of pushing it down.
- **G-23:** debounce the per-keystroke `sessionStorage` draft write (`:229-231`, `:991-995`) to about 400 ms with a flush on blur, send and `pagehide`; memoise the list rows so typing does not re-render the whole inbox. The draft must survive a reload (FX-04 Review focus 5: polling never resets the draft).
- Also: the AI-suggestion overwrite `window.confirm` → `AdminConfirmDialog`; the 供應商 strings at `:2347`, `:2500` and the `replyErrorLabels` move if 17a-2 could not do them.

**Tests.** Extend `e2e/admin-whatsapp-mobile.spec.ts`: `thread visible ≥ 50 % of the viewport at 390 px`; `typing 200 characters writes sessionStorage at most a few times and the draft survives a reload`; `one workspace in the DOM`. Screenshots at 375, 390 and 1440.

**Dependencies.** **#238 must merge first** (it re-keys the workspace siblings and re-indents the composer, `admin.whatsapp.tsx:1787-1917`); 17c rebases onto that. 17a-1 (`AdminTechnicalDetails`, customer-named template confirmation) merged. FX-04's polling contract unchanged. No migration.
