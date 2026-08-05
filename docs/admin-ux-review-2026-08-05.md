# CMS & admin panel — UI/UX and code review, 5 Aug 2026

Follow-up review of `/admin` and all 15 subpages, plus the shared admin components and the
CMS content hub. This builds on `docs/admin-ux-audit-2026-08-03.md` (and its 4 Aug follow-up
pass) rather than repeating it: every item that audit listed as **Open** was re-checked against
current `main`, every item it claimed **Fixed** was re-checked for completeness, and the bulk of
the effort went into surfaces and failure paths the earlier pass did not reach.

**161 findings confirmed** — 1 critical, 34 high, 96 medium, 30 low. **126 are new**; 35 are
prior open items re-verified as still present. 11 candidate findings were refuted on inspection
and are listed at the end so they are not re-raised.

Method: eight parallel auditors read every admin route and component in full, then each
individual finding was handed to an independent adversarial verifier whose default was to
refute — it had to open the file, confirm the line, and rule out mitigation by a Radix
primitive, a shared wrapper, or a global CSS rule before the finding survived. Findings marked
🆕 are new in this pass; 📌 were already documented as open on 3 Aug and are confirmed still
present.

The admin area is auth-gated, so this is a source review, not a live click-through.

---

## The short version

**One thing is critical, and it is the same thing the last audit put at the top.**
`/admin/blasts` sends real WhatsApp messages to real customers on a single unconfirmed click.
That has not changed. What this pass adds is that the surrounding safety story is worse than
it looked: the `review` status is decorative (`draft` is queueable), the "Schedule" field is
wired to nothing at all, the count shown next to Queue can be arbitrarily stale, the dialog's
"Cancel" button kills the campaign rather than dismissing the dialog, and nobody in the UI can
see the message body before it goes out. Five independent gaps, all on the one screen with
irreversible customer-facing consequences.

**The two highest-risk screens are the two written in English.** Measured across the admin
surface, `admin.cms.tsx` carries 1,121 CJK characters and `AdminContentCopilot.tsx` 674 — they
are properly localised. `admin.blasts.tsx` has 76 across 1,038 lines, `admin.segments.tsx` 44,
`admin.operations.tsx` 8, and all four operations components have **zero**. So the screen that
messages customers and the screen that applies irreversible database migrations are the two
where a Cantonese-speaking staff member reads "Queue", "Materialize", "Apply", "Drift" and raw
request IDs. That is not a polish issue on those two screens; it compounds every safety gap
above it.

**A destructive operator flow is broken outright.** `AdminOperationsMigrations.runApply()` calls
`setPlan(null)` _before_ `await`, and the dialog's `open` prop requires `plan !== null` — so the
confirmation modal unmounts the instant Apply is clicked, and an irreversible schema change runs
with no spinner, no progress text, and every other control on the panel disabled. The dialog's
own `isPending` state is unreachable dead code. The operator's natural reading is "it didn't
register."

**Several fixes from the last pass are incomplete, and one is entirely dead.**
`useRouteLeaveGuard` — the page-leave/tab-close protection shipped on 4 Aug — has **zero call
sites**; only its dialog-scoped sibling is wired up. The claimed `datetime-local` fix on 發布時間
and the claimed article-body 預覽 toggle are both absent from the current source. The
`WOZTELL_ENABLED` copy fix covered the toolbar badge but the env-var name still reaches staff in
three other places. And `AgentProfileForm` — which the 3 Aug audit certifies as "the strong
reference implementation in this codebase" — has no unsaved-changes guard on a 17-field form and
renders raw English zod errors on 顯示排序.

**The dominant new theme is data honesty.** 37 of 161 findings are the same shape: a server
`LIMIT` presented to staff as the complete set. `/admin/cms` estates and articles cap at 40 and
FAQs at 120; listings at 80 of ~398; the WhatsApp inbox at 100 conversations and 100 messages;
campaigns at 100; Command Center at 200. Adding client-side search boxes on 4 Aug did not fix
this — it made it actively misleading, because an editor who searches for an estate outside the
40-row window now gets a confident 「找不到符合…」 and creates a duplicate. The worst instance:
the FAQ import's 新增/覆寫 preview diffs against the capped 120-row list, so on a site with more
than 120 FAQs the confirm dialog asserts 「全部為新增，不會覆寫現有 FAQ。」 while the server's
`ON CONFLICT DO UPDATE` overwrites live AI-agent answers in place.

---

## Fixed in this pass — the blast-safety slice

All of `/admin/blasts`'s critical + high findings, plus the page's localisation. Server, types,
UI and tests. Everything else in this document is still open.

- **Sending is now behind a confirmation.** Both Queue paths (row action and campaign dialog)
  route through `AdminConfirmDialog`, which names the campaign, the template and language, the
  audience, and the eligible count, states that the send cannot be recalled, and keeps a failure
  inside the dialog via the component's existing `error` slot rather than behind the overlay.
  The action is now labelled 「發送…」 — the ellipsis marks it as opening a confirmation.
- **The review gate is real.** `draft` was removed from `canPrepareAdminCampaignQueue`
  (`admin-workflow.ts`) and from the page's `queueableStatuses`. Because
  `validateAdminCampaignQueueability` is the single chokepoint for both
  `materializeCampaignRecipients` and `sendAdminCampaignQueue`, this closes every path, not just
  the button. The status dropdown now reads 「草稿（不可發送）」 and the disabled send button
  explains what to do. **Behaviour change:** campaigns sitting in `draft` must be moved to
  待審核 before they can be sent.
- **Stale recipient counts can no longer gate a send.** Row previews are stamped with their
  fetch time, expire after 60s, and a 15s ticker makes the expiry actually engage rather than
  waiting for an unrelated re-render. The toolbar 重新整理 now passes `clearRowPreviews: true`,
  so Preview → Refresh → Send can no longer fire against a different audience than the number on
  screen described.
- **Delivery outcome is visible per campaign.** `listAdminCampaigns` gained
  `count(*) FILTER (…)` over the recipient statuses, surfaced in a new 送達狀況 column with
  failures in destructive styling. A blast where 800 of 1000 sends failed no longer renders
  identically to a clean one.
- **Staff can see what the template will carry.** `fetchAdminBlastOptions` now selects
  `category`, `description` and `components`, rendered in the campaign dialog and inside the send
  confirmation. **Correction to the finding above:** `whatsapp_templates.components` holds
  WhatsApp _send-time parameter substitutions_, not the approved body text — the body lives with
  Woztell and is never mirrored into this database, so it cannot be rendered here. The panel
  therefore shows every value this system will substitute (via a new tested helper,
  `src/lib/woztell/template-preview.ts`) and says plainly that the full approved text must be
  checked in Woztell. Template approval status is shown in Chinese, since an unapproved template
  is the most common reason a send is refused.
- **The dialog's Cancel no longer looks like a dismiss.** It is now 「取消整個 Campaign」, styled
  `destructive`, pushed to the far left away from 關閉, and behind its own confirmation showing
  how many recipients are still pending and how many were already sent (and cannot be recalled).
- **Schedule is labelled honestly.** `scheduled_at` is written to the database but no delivery
  path reads it — `findEligibleCampaigns` in `api.admin.jobs.send-queue.ts` only picks up
  campaigns already in `queued`/`sending`. The field is now 「預定發送時間（僅作記錄）」 with
  helper text saying the system will not send by itself. **Real scheduling was deliberately not
  implemented:** it would mean enabling unattended sending of customer messages, which is the
  owner's decision, not a silent side effect of a UI fix.
- **The page is now in Traditional Chinese**, including all new confirmation copy. This was part
  of the safety fix, not polish — a confirmation nobody can read is not a confirmation.

Verification: `npm run build` succeeds; all six admin-relevant suites pass
(`test:command-center`, `test:operations`, `test:content-copilot`, `test:control-plane`,
`test:property-experience`, `test:woztell`); ESLint clean on the changed files; `tsc` unchanged
at its baseline apart from one added `bun:test` resolution error matching the repo's five
existing bun test files. `admin.routes.test.mjs` assertions were updated to lock in the new
behaviour (confirmation present, draft not queueable, preview freshness, delivery cell, the
「僅作記錄」 schedule label), and `admin-workflow.test.mjs` gained a draft-is-rejected case.

---

## Suggested order of work

1. ~~**Blast safety**~~ — **done, see above.**
2. **Migration apply** — move `setPlan(null)` after the await, keep the dialog open while
   applying, and show the plan's summary/checksum/dependencies in the confirm.
3. **Localise `/admin/segments` and `/admin/operations`** — the four operations components have
   no Chinese at all. (`/admin/blasts` is done.)
4. **Row caps** — one honest 「顯示 N 筆（上限 M）」 line plus a load-more, applied to the six capped
   lists. Fix the FAQ import diff server-side.
5. **Wire `useRouteLeaveGuard`** into `PropertyForm` and `AgentProfileForm`; it already exists.
6. **WhatsApp inbox refresh** — poll the open conversation, refetch on the failure path, and fix
   the reassignment flow that reports success as an error.

---

## Repository health (checked independently of the audit)

- All 14 admin-relevant test suites pass: `test:command-center` (29), `test:operations` (18 + 8
  bun), `test:woztell` (29), `test:content-copilot` (34 + 14 bun), `test:property-experience`
  (96 bun + 77), `test:control-plane` (30).
- `npx tsc --noEmit` reports 58 errors. 52 are the pre-existing TanStack Start server-fn typing
  baseline in `src/lib/neon/admin-data.ts`; 5 are `bun:test` types not resolving under `tsc`.
  **One is real:** `admin.segments.tsx:284` passes `refreshSegments` — declared
  `async (preferredSegmentId?: string)` — directly as `onClick`, so React hands it a
  `MouseEvent` as `preferredSegmentId`. The outcome is benign today (the event never matches a
  segment id, so `preferredSegment` lands `undefined`, which is the same branch as the no-arg
  call), but it is a latent trap for anyone who later adds an early-return on that parameter.
  Fix: `onClick={() => void refreshSegments()}`.
- `npm ci` **fails** — `package-lock.json` is out of sync with `package.json`
  (`Missing: @cloudflare/workerd-windows-64@1.20260730.1 from lock file`). `npm install` works.
  Worth regenerating the lockfile so CI and fresh clones are reproducible.
- ESLint is clean apart from 11 warnings, 10 of which are `react-refresh/only-export-components`
  noise. The eleventh is real: `AdminOperationsJobs.tsx:157` — `useEffect` missing dependency
  `capabilities.jobsRead`, a stale closure inside the 30s polling effect.

---

## Findings by surface

Ordered by the surface's worst finding. 🆕 = new in this pass · 📌 = confirmed still open from
3 Aug.

### WhatsApp blasts + segments

**📌 [CRITICAL] Queue sends real WhatsApp blasts on a single unconfirmed click**  
`src/routes/admin.blasts.tsx:513` · destructive-safety

- **What happens:** A manager scanning the campaign table mis-clicks Queue (it sits 8px from Preview at blasts.tsx:510) and thousands of template messages are irreversibly dispatched to customers' WhatsApp. There is no undo — Cancel only stops recipients still in 'queued'; anything already claimed by the delivery worker is sent.
- **Fix:** Route both Queue paths through `AdminConfirmDialog` showing campaign name, template element_name, the audience name, and the eligible count, and require the operator to confirm in Traditional Chinese (e.g. 「確認向 N 位收件人發送？此操作無法撤回」).

**📌 [HIGH] `queueableStatuses` includes "draft", so the review gate the page advertises does not exist**  
`src/routes/admin.blasts.tsx:72` · destructive-safety

- **What happens:** A half-written draft campaign — name typo'd, wrong template still selected — is one click from going out to customers. The Review status exists in the dropdown (blasts.tsx:700) and in the badge map, so staff reasonably believe a second pair of eyes is required before anything can be sent; it is not.
- **Fix:** Restrict `queueableStatuses` (and `canPrepareAdminCampaignQueue`) to `review`/`scheduled`, and on a draft show the Queue button disabled with 「請先送交審核」 rather than enabled.

**📌 [HIGH] Refresh updates the rows but not the per-row preview counts, so Queue can fire against a different audience than the one shown**  
`src/routes/admin.blasts.tsx:407` · data-integrity-ux

- **What happens:** Operator clicks Preview (shows 5 合資格), goes to lunch, comes back, clicks Refresh to be safe, then clicks Queue. The cell still says 5 while the real materialised audience has grown to 5,000 — the server materialises fresh rows at queue time (admin-data.server.ts:2056) so the actual send has no relation to the number the operator was looking at.
- **Fix:** Pass `{clearRowPreviews: true}` from the toolbar Refresh, stamp each row preview with a fetched-at time and grey it out after ~60s, and disable Queue until a preview newer than the last refresh exists.

**📌 [HIGH] A blast where most sends fail looks identical to a clean one — no delivery breakdown anywhere**  
`src/routes/admin.blasts.tsx:471` · data-integrity-ux

- **What happens:** 800 of 1000 messages fail on a token error. The row still says "1000 materialized" with a Completed badge and the operator's last feedback was a green 「已排隊 1000 位合資格收件人」. Nobody finds out until the campaign underperforms, and there is no retry surface.
- **Fix:** Extend listAdminCampaigns with `count(*) FILTER (WHERE status='sent'/'failed'/'blocked')`, render 已發送／失敗／封鎖 in the row with a destructive cue when failures > 0, and link the returned jobId to the operations job view.

**🆕 [HIGH] A campaign can never be edited after the dialog is closed**  
`src/routes/admin.blasts.tsx:499` · information-architecture

- **What happens:** An operator saves a campaign, closes the dialog, then notices the name is wrong / the wrong template is attached / the schedule needs moving. The only recourse is to cancel the campaign and create a new one, so the list fills with dead duplicates and the correct campaign loses its history. The 編輯 capability exists on the server and is simply unreachable.
- **Fix:** Add an 編輯 row action that maps the `AdminCampaignRow` into `AdminCampaignInput` (id, name, template_id, audience_id, status, scheduled_at) and opens the same dialog, setting `savedCampaignDraft` so the dirty check starts clean.

**📌 [HIGH] Staff queue a blast having never seen the message text — no dry-run, and the template body is deliberately not fetched**  
`src/routes/admin.blasts.tsx:660` · data-integrity-ux

- **What happens:** An operator picks `promo_autumn_v3` from a dropdown of near-identical element names and queues it to the whole opt-in list. Nobody in the admin UI can see what the customer will receive; a wrong-variant or wrong-language template is only discovered from customer replies.
- **Fix:** Add `components` to the fetchAdminBlastOptions SELECT and to AdminBlastOptions, then render the resolved body in the campaign dialog's Preview box (and inside the send confirmation) before Queue is enabled.

**🆕 [HIGH] The 排程 (Schedule) field and "Scheduled" status are decorative — nothing ever delivers on a schedule**  
`src/routes/admin.blasts.tsx:706` · data-integrity-ux

- **What happens:** Staff create a campaign, set Schedule = next Monday 09:00, set Status = Scheduled, and click Queue expecting it to go out Monday. It goes out within seconds. Conversely a campaign left in "Scheduled" status that nobody clicks Queue on never sends at all, and the Schedule column keeps showing a date that has already passed as if it were pending. Both directions send (or fail to send) real WhatsApp messages to real customers at the wrong time.
- **Fix:** Either implement scheduling (have the cron in api.admin.jobs.send-queue.ts pick up `status='scheduled' AND scheduled_at <= now()` after materialisation, and label the button 「排程發送」), or remove the field and the Scheduled status and label the action honestly as 「立即發送」. Do not ship a datetime input that nothing honours.

**🆕 [HIGH] The dialog's "Cancel" button cancels the whole campaign, and sits immediately beside "Close"**  
`src/routes/admin.blasts.tsx:736` · destructive-safety

- **What happens:** Every dialog convention in the product makes "Cancel" mean "dismiss without saving". Here clicking it kills a campaign that may be mid-send — remaining recipients are dropped — with no confirm and no undo, and it looks identical to the Close button next to it.
- **Fix:** Rename to 「取消整個 Campaign」 with `variant="destructive"`, separate it from Close (e.g. `sm:mr-auto`), and put it behind AdminConfirmDialog that names the campaign and warns that queued recipients will be dropped.

**🆕 [HIGH] The "AI Segments" prompt is parsed by silent regex, and the resulting filters are never shown — an unrecognised prompt selects the entire CRM**  
`src/routes/admin.segments.tsx:371` · data-integrity-ux

- **What happens:** An agent types 「屯門上車客，30 歲以下」. Nothing in that prompt is recognised, so the query returns the newest 200 leads in the whole database. The panel reports something like "183/200 eligible", which looks like a great segment. They Save, click Materialize — which enrols the full matching set up to 50,000 contacts — attach it to a WhatsApp blast and message the entire customer base with a Tuen Mun offer.
- **Fix:** Render the parsed `preview.filters` as human-readable chips above the results (地區：深井 · 意向：買家 · 預算：800–1000萬), explicitly warn 「未能從描述辨識任何條件，將會包含所有客戶」 when the filter object is empty, and refuse to save/materialize an unfiltered segment without an explicit confirmation.

**🆕 [MEDIUM] Typing an audience Name or Description refires the server-side audience preview on every keystroke and blanks the panel**  
`src/routes/admin.blasts.tsx:148` · performance-ux

- **What happens:** While typing a 20-character audience name the operator watches the preview panel collapse into five skeleton blocks over and over and fires ~20 unthrottled audience queries against the CRM. The numbers they are trying to read are never on screen long enough to read.
- **Fix:** Memoise on the filter values only (e.g. `JSON.stringify(normalizeAudienceFilters(audienceDraft.filters))`), and keep the previous preview visible with an `aria-busy` dimmed state instead of nulling it on every re-request.

**🆕 [MEDIUM] Raw server error codes are shown to non-technical staff as toasts**  
`src/routes/admin.blasts.tsx:336` · copy-i18n

- **What happens:** An agent clicks Queue and gets a red toast reading `TEMPLATE_NOT_ACTIVE`. It says neither what is wrong (the WhatsApp template has not been approved by Meta) nor what to do, in a language they may not read. The prior audit fixed exactly this class for WOZTELL_ENABLED and the AI copilot; this page was missed.
- **Fix:** Map the three codes to Chinese cause+fix text (e.g. `TEMPLATE_NOT_ACTIVE` → 「範本未獲批准，請於 WhatsApp 範本頁確認狀態為 active 後再試」) in blasts.tsx, keeping the raw code in `title` for support, and stop defaulting the template picker to an inactive template.

**🆕 [MEDIUM] Audiences can be created but never edited, renamed or deleted**  
`src/routes/admin.blasts.tsx:420` · information-architecture

- **What happens:** An audience saved with a typo'd estate slug or the wrong assigned_agent_id is permanent. Staff work around it by creating another one, so the two dropdowns fill with near-duplicate names and someone eventually attaches the broken audience to a real blast — the filters are invisible in the dropdown, only the name shows.
- **Fix:** Add an audience list (or an 編輯 affordance on the toolbar Select) that loads the selected audience into AudienceDialog with its `id` and its stored filters, and add a delete/archive path.

**🆕 [MEDIUM] Mutating actions give no progress feedback and silently disable every other button on the page**  
`src/routes/admin.blasts.tsx:505` · feedback-state

- **What happens:** The operator clicks Queue on a 5,000-contact audience; for several seconds nothing on screen changes except that the whole table greys out. There is no signal that anything is happening, no announcement when it finishes for screen-reader users, and the greyed-out state gives no reason.
- **Fix:** Swap the icon for a spinner and set `aria-busy` on the in-flight button, scope the disabling to the affected row plus genuinely conflicting actions, and announce completion via an `aria-live` region rather than a toast alone.

**🆕 [MEDIUM] During the first load the page shows a "No campaigns" empty state and a Create CTA at the same time as the loading skeleton**  
`src/routes/admin.blasts.tsx:539` · feedback-state

- **What happens:** On every page open (and on a slow connection, for seconds) staff are told there are no campaigns and invited to create one, then the list of 40 existing campaigns replaces it. Someone acts on that and creates a duplicate campaign.
- **Fix:** Return early with the skeleton while `!rows`, and render the empty state only once `rows` is a loaded empty array. On error, either clear the rows or stamp them as stale.

**🆕 [MEDIUM] Both dialogs discard unsaved work silently, despite the dirty check already being computed**  
`src/routes/admin.blasts.tsx:633` · form-ux

- **What happens:** An operator fills in a campaign name, template, audience and schedule, clicks slightly outside the dialog, and everything is gone with no warning. Same for a half-built audience with four filter fields typed in.
- **Fix:** Wire both dialogs through `useDirtyCloseGuard`, reusing the existing `campaignDraftSignature` comparison for campaigns and a comparable snapshot for the audience draft.

**🆕 [MEDIUM] A loading or failed audience preview renders a confident "0 合資格" badge — the same number that gates a real send**  
`src/routes/admin.blasts.tsx:721` · feedback-state

- **What happens:** After a transient preview failure the operator sees 「0 合資格」 next to the note 「Queue unlocks only when 合資格 is greater than 0」 and concludes the audience is empty — abandoning a valid campaign, or worse, rebuilding the audience filters to "fix" a number that was never fetched.
- **Fix:** Render `—` with an aria-live 「載入中／無法取得」 state when `previewLoading || !preview`, matching PreviewSummary, and never coerce an absent preview to 0 next to a send control.

**🆕 [MEDIUM] Selecting another saved segment silently destroys the prompt currently being edited**  
`src/routes/admin.segments.tsx:152` · form-ux

- **What happens:** An operator spends several minutes composing a long targeting prompt, clicks a saved segment in the right-hand panel to check how a previous one was worded, and their draft is gone with no warning and no way back.
- **Fix:** Compare the current name/prompt/status against the loaded segment (or defaults for a new one) and route both selection paths through the existing dirty-close guard.

**🆕 [MEDIUM] "Materialized N contacts" counts contacts who cannot be messaged; the eligible figure is fetched and thrown away**  
`src/routes/admin.segments.tsx:253` · data-integrity-ux

- **What happens:** An operator sees 「Materialized 3,000 contacts」, hands the segment to the blast page and plans a 3,000-message campaign. Only a fraction have WhatsApp opt-in; the real reachable number might be 400. The discrepancy only surfaces later as a different number on a different page, in English, with no explanation of which is which.
- **Fix:** Report both: 「已建立 3,000 位成員，其中 400 位可接收 WhatsApp」, using the `eligible` value already in the response, and translate the toast.

**🆕 [MEDIUM] Materialize destroys and rewrites segment membership for up to 50,000 contacts with no confirmation**  
`src/routes/admin.segments.tsx:303` · destructive-safety

- **What happens:** An operator re-runs Materialize on an established segment to "refresh" it. Every existing membership row (including any that downstream campaigns were built against) is deleted and replaced by whatever the regex parse resolves to today. Judging by the preview they expect ~200 contacts; they may enrol 20,000. There is no confirmation step and no report of the delta.
- **Fix:** Put Materialize behind AdminConfirmDialog stating that existing membership will be replaced, show the previous member count vs the new one, and make clear in the UI that the preview is a capped sample, not the enrolment size.

**📌 [MEDIUM] Twenty rows are rendered under a "Top 200" header next to an eligible/total ratio that is itself capped at 200**  
`src/routes/admin.segments.tsx:385` · data-integrity-ux

- **What happens:** Three different numbers describe the same thing (20 rows, "Top 200", N/200) and none of them is the size of the audience the operator is about to build. Someone sizes a WhatsApp campaign at 200 recipients and sends 5,000.
- **Fix:** Return a real `COUNT(*)` alongside the capped sample, label the table 「示例 20 筆（共 N 筆符合）」, and show the true match count next to Materialize.

**🆕 [MEDIUM] The segment preview has no loading state — a slow preview shows the "no results" empty state instead**  
`src/routes/admin.segments.tsx:406` · feedback-state

- **What happens:** The operator clicks Preview and the panel immediately reads 「No segment preview — Enter an audience prompt and preview matched contacts」. That is the failure message, so they assume the prompt was rejected and start editing it — which calls `clearPreviewState()` (segments.tsx:359) and invalidates the in-flight request they were waiting for. There is also no aria-live announcement when results do land.
- **Fix:** Add a `previewLoading` branch rendering the existing Skeleton (and `aria-busy`) before the `preview ? …` check, and wrap the results region in `aria-live="polite"`.

**📌 [LOW] Card titles are not headings, so the only <h2> elements on either page are empty-state placeholders**  
`src/routes/admin.blasts.tsx:438` · a11y

- **What happens:** A screen-reader user navigating by heading on the WhatsApp blast page finds one h1 and, if there is no data, an h2 that says "No campaigns" — the two main regions of the page are unreachable by heading navigation and the outline is nonsensical.
- **Fix:** Pass `as="h2"` on the four CardTitles across the two pages and promote the dialog's Preview heading to h2 within the dialog's own heading scope.

**🆕 [LOW] The campaign list silently caps at 100 rows and has no search, filter, or count**  
`src/routes/admin.blasts.tsx:442` · data-integrity-ux

- **What happens:** Once the account passes 100 campaigns, older ones vanish from the page with no indication, and the segments card confidently reports "100 CRM segments" forever. Staff searching for last quarter's campaign conclude it was deleted.
- **Fix:** Return a total count with the rows, render 「顯示 100 筆（共 N 筆）」, and add pagination or a keyword filter — the same fix the audit prescribes for admin.listings.tsx.

**🆕 [LOW] The Audience preview metric labels mix English and Chinese inside a single five-item list**  
`src/routes/admin.blasts.tsx:912` · copy-i18n

- **What happens:** An agent reading the panel that decides whether to send a blast has to parse 「Missing phone」 and 「Not opted-in」 — compliance-relevant categories — in a second language, one label away from a Chinese one. The blocked-queue explanation at :366 is also English only, so the reason Queue is disabled is unreadable to some staff.
- **Fix:** Translate the metric labels (總數／合資格／已退出／缺電話／未同意) and the queue block reason (「請先儲存變更才可排入佇列」), and pick one language for the page chrome.

**🆕 [LOW] No form label in either dialog is associated with its control**  
`src/routes/admin.blasts.tsx:947` · a11y

- **What happens:** Clicking the word "Name" or "Estate slug" does not focus the field — on the tablets agents use this makes small controls needlessly hard to hit. Screen-reader users get an orphan text node before each control, and the `<Label>` text and `aria-label` can drift apart.
- **Fix:** Give `Field` an `id` prop that renders `<Label htmlFor={id}>` and pass it down to the Input/SelectTrigger, following the pattern already established in AgentProfileForm.tsx and PropertyForm.tsx.

**📌 [LOW] Both segment empty states are dead ends with no next action**  
`src/routes/admin.segments.tsx:406` · feedback-state

- **What happens:** A first-time user landing on an empty page is told 「Save a previewed segment before materializing an audience」 with no button to start from, in English, while the actual next step (Preview) lives in a toolbar at the top of the page.
- **Fix:** Pass `action` on both — a 「Preview segment」 button on the preview state, and a focus-the-prompt action on the saved-segments state.

**🆕 [LOW] The saved-segments list gives no indication of which segment is currently loaded in the editor**  
`src/routes/admin.segments.tsx:422` · visual-consistency

- **What happens:** With eight saved segments the operator cannot tell from the list which one the editor is showing, so it is easy to edit the prompt of segment A believing it is segment B — and then Save, overwriting the wrong record (segments.tsx:222 passes `id: selectedSegmentId`).
- **Fix:** Mark the active card with `aria-current="true"`, a border/background change and a visible label, mirroring the `aria-current` treatment already used for the selected conversation in admin.whatsapp.tsx.

### Operations control plane

**🆕 [HIGH] Audit metadata is silently filtered and capped — the 'N fields' count is the post-filter count, with no indication anything was withheld**  
`src/components/admin/operations/AdminOperationsAudit.tsx:108` · data-integrity-ux

- **What happens:** This is the compliance/incident-review surface. An event whose metadata has 30 keys, six of them matching a fragment such as 'phone' or 'sql', renders '20 fields' and shows 20 — the operator has no way to know that 4 keys were truncated away and 6 more were dropped. Investigating a denied action, they conclude the field they are looking for was never recorded. `isSensitiveMetadataKey` uses `includes`, so innocuous keys also disappear: `postgresqlVersion` matches 'sql', `promptedAt` matches 'prompt'.
- **Fix:** Keep every key and substitute `[已隱藏]` for sensitive values at the top level too (matching the nested behaviour at line 89), and append an explicit 「另有 N 個欄位未顯示」 line when the 20/40 caps bite.

**📌 [HIGH] The 30s tick refetches page 1 only, silently discarding every extra page the operator loaded**  
`src/components/admin/operations/AdminOperationsJobs.tsx:156` · data-integrity-ux

- **What happens:** An operator paging through failed jobs to find a pattern clicks Load more three times to 100 rows; 30 seconds later the list snaps back to 25 rows and their scroll position is meaningless. There is no way to hold a deep view open long enough to read it.
- **Fix:** On a background tick, refetch the pages already loaded (or merge by id into the existing rows) rather than replacing with page 1; or suppress the row refetch while `nextCursor` has been consumed and surface a 'new jobs available — refresh' affordance instead.

**📌 [HIGH] Migration apply dialog vanishes the instant Apply is clicked; irreversible schema change runs with zero feedback**  
`src/components/admin/operations/AdminOperationsMigrations.tsx:132` · destructive-safety

- **What happens:** The operator types the migration ID, clicks Apply, and the modal disappears immediately. During the apply the panel just freezes (Refresh and every Plan button are disabled by `planningId !== null || applying` at lines 182 and 249) with no spinner, no progress text and no explanation. With nothing on screen the operator's natural read is 'it didn't register' — and a second Plan/Apply attempt against a live production schema is exactly the wrong response. A non-409 failure sets `error` (line 149) but `plan` is already null so the dialog can never come back to explain it.
- **Fix:** Move `setPlan(null)`/`setTypedId("")` into the success and 409 branches after the await, keep the dialog open while `applying`, and pass the failure into `AdminConfirmDialog`'s existing `error` prop (AdminConfirmDialog.tsx:38) so the cause lands inside the modal.

**🆕 [HIGH] One failed background health poll unmounts the entire operations panel and destroys all operator state**  
`src/routes/admin.operations.tsx:187` · data-integrity-ux

- **What happens:** An operator filters Jobs to failed, clicks Load more four times to reach 100 rows, then a single transient 500/network blip on the 30s health tick replaces the whole page with an error line and a blank body. Every panel unmounts (Radix drops inactive content, and lines 213/220/222 additionally gate on `activeTab`): job filters and 100 loaded rows, audit filters and expanded metadata, and — worst — an in-flight migration plan with its approval token and a half-typed confirmation ID all vanish. When the next tick succeeds the operator is back on Overview with defaults. This is the highest-blast-radius surface in the app and a routine network hiccup resets it.
- **Fix:** Keep the previous `health` on refresh failure (`{ health: current.health, error }`), render the existing 'Summary may be stale' treatment plus the error, and only drop to null when there is no prior successful load. Update operations.test.mjs:232-239 to assert the stale-preserving transition.

**🆕 [MEDIUM] Jobs and Audit filters live in component state, not the URL, so every tab switch or reload resets the working view**  
`src/components/admin/operations/AdminOperationsJobs.tsx:101` · information-architecture

- **What happens:** Filter Jobs to failed + jobType `whatsapp.send`, page to 75 rows, hop to Audit to check the matching request ID, come back — everything is gone, defaults restored. The prior audit held this route up as the correct `validateSearch` reference (docs line 187), but only the tab is deep-linkable: an operator cannot paste 'the failed whatsapp jobs view' or 'this audit request-ID view' into an incident channel, and a browser reload during an incident throws the investigation away.
- **Fix:** Extend `parseOperationsSearch` to carry `status`, `jobType`, `outcome`, `action` and `requestId`, and drive both panels from `Route.useSearch()`/`useNavigate()` — the same pattern the follow-up pass applied to `/admin/leads`.

**🆕 [MEDIUM] Pressing Apply filters with an unchanged job type empties the table and shows a false 'No jobs found.'**  
`src/components/admin/operations/AdminOperationsJobs.tsx:170` · data-integrity-ux

- **What happens:** An operator clicks 'Apply filters' after only changing the Status dropdown (or just to force a refresh, or twice in a row) and the jobs table goes permanently empty and states, in the app's own words, that there are no jobs — on the panel used to see whether the queue is backed up. Only a manual Refresh click or the next 30s tick restores the rows.
- **Fix:** Have `applyJobType` call `loadJobs()` directly after setting the draft, or drive fetches off an explicit `filterRevision` counter as `AdminOperationsAudit.tsx:190` already does.

**🆕 [MEDIUM] A rejected retry/cancel (409) closes the dialog with no toast and a bare status line, so the operator believes the command succeeded**  
`src/components/admin/operations/AdminOperationsJobs.tsx:192` · feedback-state

- **What happens:** The operator clicks 'Cancel job', confirms, the modal closes exactly as it does on success — but the command was rejected because the job changed state. The only signal is a small red line 「工作狀態已更新」 rendered at the top of the panel (line 261), often above the fold after a `loadJobs()` re-render, and the text says 'job status has been updated', not 'your cancel was rejected and did not run'. On a control plane, believing you cancelled a running job that is still running is a real incident.
- **Fix:** Keep the dialog open on failure and pass the reason via the `error` prop; make the 409 copy state the outcome explicitly (e.g. 「取消失敗：工作狀態已變更，請重新確認後再試」) and fire a matching toast.

**📌 [MEDIUM] Job filter controls are disabled by background polling, interrupting typing mid-word**  
`src/components/admin/operations/AdminOperationsJobs.tsx:211` · form-ux

- **What happens:** Every 30 seconds the status select, the job-type box and the Apply button all go disabled and greyed for the duration of the fetch. A disabled input drops focus, so an operator typing a job type mid-tick loses the caret and the rest of their keystrokes go nowhere.
- **Fix:** Track background refreshes in a separate `refreshing` flag and only disable the controls for user-initiated loads — or, better, never disable filter inputs; just ignore stale responses (the `requestSequence` guard at line 126 already does this).

**🆕 [MEDIUM] Tables cannot distinguish loading, genuinely empty, and filter-matched-nothing, and offer no way back**  
`src/components/admin/operations/AdminOperationsJobs.tsx:339` · feedback-state

- **What happens:** On first open of Jobs the operator sees bare column headers and blank space for the duration of the fetch, then either rows or a flat 'No jobs found.' Having clicked a request ID in Audit — which silently replaces the entire result set — an empty result reads as 'nothing was ever logged' rather than 'your filter excludes everything', and the only escape is to manually clear the box and resubmit. Neither result set is announced, so screen-reader users get no signal that the table changed at all.
- **Fix:** Render skeleton rows while loading; branch the empty copy on whether any filter is active and pair the filtered case with a 清除篩選 button; wrap the result region in `aria-live="polite"` announcing the loaded count.

**📌 [MEDIUM] Apply-migration confirm shows only the ID — the fetched summary, checksum, dependencies and schema fingerprint are never displayed**  
`src/components/admin/operations/AdminOperationsMigrations.tsx:284` · destructive-safety

- **What happens:** The type-to-confirm gate makes the operator retype an ID they can see, which proves nothing about what the migration does. The one piece of information that would let them catch 'wrong migration' or 'unmet dependency' before an irreversible DDL — the plan summary, its checksum and its dependency list — was fetched from the server and thrown away.
- **Fix:** Render summary, checksum, dependency list and schema fingerprint inside the dialog body above the type-to-confirm input; the data is already in `plan`.

**🆕 [MEDIUM] Type-to-confirm input has a mismatched accessible name, an unlabelled disabled Apply button, and no error text**  
`src/components/admin/operations/AdminOperationsMigrations.tsx:289` · a11y

- **What happens:** The operator pastes or retypes a long migration ID; a trailing space or a case difference leaves Apply greyed out with no stated reason and no message — the classic 'the button is broken' dead end, here in front of an irreversible schema change. A screen-reader user hears one label read aloud and a different one printed, with the invalid state announced but never explained.
- **Fix:** Give the input an `id` with `htmlFor` on the label, drop the conflicting `aria-label`, add an `aria-describedby` error such as 「輸入的 ID 與計劃不符」, and trim whitespace before comparing.

**🆕 [MEDIUM] The whole operations surface is English in a Traditional-Chinese staff UI, including error text with raw request IDs**  
`src/routes/admin.operations.tsx:49` · copy-i18n

- **What happens:** The prior pass established that this staff audience needs Chinese and that raw technical strings must not reach them (it rewrote `WOZTELL_ENABLED: false` for exactly this reason). Here the same non-technical staff get 'drift', 'Migration plan is stale. Please run Plan again.' and a bare UUID, on the one screen where misreading the state has production consequences. A half-translated screen also makes 「工作狀態已更新」 read as a success notice rather than a rejection.
- **Fix:** Translate labels, statuses, empty states, toasts and error copy to Traditional Chinese; keep request IDs in a `title`/copy-button with Chinese framing (「技術支援參考編號」), as the WhatsApp fix did.

**📌 [MEDIUM] Every 30s tick blanks the Overview job and migration sections before refetching, guaranteeing a flash and layout jump mid-read**  
`src/routes/admin.operations.tsx:92` · responsive

- **What happens:** Twice a minute the 'Job summary' (five count tiles) and 'Migration status' (three tiles) sections disappear and reappear. Anything below them jumps several hundred pixels, and an operator mid-sentence reading the failed-job count loses their place — or clicks where 'Open Jobs' used to be.
- **Fix:** Fetch into locals and swap state only on resolution; keep the previous values rendered (optionally dimmed with `aria-busy`) while the refresh is in flight.

**🆕 [MEDIUM] Tab strip bypasses the design system's own TabsTrigger: ~36px tap targets and no focus ring**  
`src/routes/admin.operations.tsx:194` · a11y

- **What happens:** text-sm + py-2 gives roughly a 36px target — under the 44px floor the prior pass deliberately restored across admin toolbars for the tablets agents use, and these four tabs are the only way to reach Jobs, Audit and Migrations. Keyboard operators get no design-system focus ring on the primary navigation of the control plane, and the active tab is distinguished only by a 2px coloured underline with no weight change.
- **Fix:** Use the shared `Tabs`/`TabsList`/`TabsTrigger` from `@/components/ui/tabs`, or add `min-h-11 focus-visible:ring-2 focus-visible:ring-ring` plus `data-[state=active]:font-semibold` to the local classes.

**🆕 [LOW] Background polling is only suppressed while a command is in flight, so an open confirm dialog can describe a job the table has already replaced**  
`src/components/admin/operations/AdminOperationsJobs.tsx:150` · data-integrity-ux

- **What happens:** The operator opens 'Cancel job?' on a running job, reads the ID, and pauses. A 30s tick refetches: that job may now be succeeded or gone from page 1 entirely. The dialog still shows the old job type and ID as if current, and confirming fires a cancel against a job whose state has moved — landing in the 409 path that (per the separate finding above) reports nothing useful.
- **Fix:** Include `command !== null` in the suppression condition, or re-read the job from `rows` when rendering the dialog and warn (in the dialog) if its status changed since it was opened.

**🆕 [LOW] Drift rows — the most urgent migration state — offer no action at all**  
`src/components/admin/operations/AdminOperationsMigrations.tsx:254` · information-architecture

- **What happens:** The panel shouts 'Drift detected' in red — schema on disk no longer matches the recorded checksum — and then offers the operator nothing: no re-plan, no re-check, no guidance, not even text saying who to contact. The alarm is undismissable and unactionable, which trains staff to ignore red on this page.
- **Fix:** Give drift rows an explicit next step: a re-check/re-plan action if the control plane supports one, otherwise inline Chinese copy explaining what drift means and the escalation path, and expose the checksum mismatch detail.

**🆕 [LOW] A failed post-migration refresh reports into the Overview tab, which the operator is not looking at**  
`src/routes/admin.operations.tsx:155` · feedback-state

- **What happens:** Immediately after an irreversible schema change, the verification refetch of job and migration state fails. The operator, still on Migrations, sees only `toast.success("Migration applied.")` from AdminOperationsMigrations.tsx:138. The failure is written into state that nothing on screen renders; when they later open Overview they find a stale 'Summary may be stale' badge with no link back to what failed.
- **Fix:** Surface post-apply refresh failures where the action was taken — return the failure to `AdminOperationsMigrations` (it already has a `role="alert"` slot at line 197) or raise a toast in addition to setting `overviewError`.

**🆕 [LOW] Header Refresh button gives no pending state and no confirmation that anything happened**  
`src/routes/admin.operations.tsx:177` · feedback-state

- **What happens:** The operator clicks Refresh to check whether a degraded check has recovered. The icon does not change, the badge does not change, and if the status is unchanged nothing on screen moves at all — so they cannot tell the click registered and click repeatedly, firing overlapping health + jobs + migrations fetches (there is no request-sequence guard in this file, unlike the child panels). Since the whole page is torn down on a failed poll (see the first finding), extra fetches also multiply the chance of a wipe.
- **Fix:** Track an in-flight flag in the effect, disable the button and swap in the spinner while it is set, and announce completion (e.g. 「已於 HH:MM 更新」) in the existing status region.

**📌 [LOW] Capability gaps hide tabs and row actions instead of explaining them; the explanatory fallback is unreachable dead code**  
`src/routes/admin.operations.tsx:231` · information-architecture

- **What happens:** A manager told 'go cancel that stuck job' opens Jobs and sees no Cancel control on any row — no reason, no permission name, nothing to escalate with. They will conclude the feature is broken and file a bug rather than request the grant. Worse, at AdminOperationsMigrations.tsx:272 an operator with plan-but-not-apply runs Plan, gets `toast.success('Migration plan ready.')` (line 117), and then nothing at all appears.
- **Fix:** Render the tabs and row actions in a disabled state with the required capability named in the tooltip/`title` (e.g. 「需要 jobs:cancel 權限」), and gate Plan itself on `migrationsApply` — or tell the operator at plan time that they cannot apply.

### WhatsApp inbox

**🆕 [HIGH] An open conversation is never refetched — new customer messages never appear while an agent is reading it**  
`src/routes/admin.whatsapp.tsx:223` · data-integrity-ux

- **What happens:** An agent opens a customer's chat and starts composing. The customer sends three more messages. The agent's timeline stays frozen forever: 重新整理 updates only the left list, and clicking the same row again is a no-op. The only way to see the new messages is to click a different conversation and click back. On a page whose entire premise is a 24-hour reply window, the agent answers a question the customer already withdrew, or misses the follow-up entirely.
- **Fix:** Poll the selected conversation (e.g. every 20–30s while the tab is visible) and make 重新整理 refetch both list and open detail: `await Promise.all([refreshConversations(), selectedId ? loadConversationDetail(selectedId) : null])`. Merge messages rather than replacing wholesale so scroll position and the draft survive. Also drop the identity guard at :223 or add an explicit per-conversation refresh button.

**🆕 [HIGH] An unsent draft reply is silently destroyed when the agent clicks another conversation or closes the mobile panel**  
`src/routes/admin.whatsapp.tsx:238` · form-ux

- **What happens:** An agent half-way through a 200-character reply clicks another conversation to check a flat number, or swipes the mobile sheet shut by accident. The draft is gone with no warning and no undo — and because the composer has no autosave, they retype from memory under the 24-hour clock.
- **Fix:** Keep drafts per conversation (`Record<conversationId, string>`) so switching away and back restores the text, or gate the switch/close behind `useDirtyCloseGuard` when `replyBody.trim()` is non-empty.

**🆕 [HIGH] Reassigning a conversation to another agent reports the successful save as an error and blanks the pane**  
`src/routes/admin.whatsapp.tsx:273` · data-integrity-ux

- **What happens:** An agent hands a conversation to a colleague via 負責代理, the save succeeds, and the UI answers with a red 「找不到 WhatsApp 對話」 toast and an error panel where the chat was. The agent reasonably concludes the handoff failed and reassigns again, or escalates to support over a non-problem.
- **Fix:** Treat a post-save 404 as expected when the assignment moved out of scope: after `refreshConversations()`, if `targetId` is no longer in `rows`, show `toast.success("對話已轉交，並已移出你的收件匣")` and call `clearSelectedConversation()` instead of running the detail reload through the error path.

**🆕 [HIGH] A failed reply leaves the timeline showing the pre-send state — the persisted failed message is invisible**  
`src/routes/admin.whatsapp.tsx:311` · feedback-state

- **What happens:** Agent sends a reply, Woztell rejects it, a toast flashes for ~4 seconds. The timeline still looks exactly as it did before the send — no failed bubble, no trace. If the agent looked away, they believe the reply is out, while the database holds a 送出失敗 row they will only discover if they happen to leave the conversation and come back. Under a 24-hour window that gap is the difference between a recovered and a lost lead.
- **Fix:** Refetch the conversation detail in the failure path too (move `refreshConversations()`/`loadConversationDetail()` into a `finally`, or call them explicitly in the `catch`), and surface a persistent inline error next to the composer with `role="alert"` instead of relying on a transient toast.

**📌 [MEDIUM] The selected conversation is not deep-linkable — filter/selection state lives only in useState**  
`src/routes/admin.whatsapp.tsx:83` · information-architecture

- **What happens:** An agent cannot paste a link to a specific customer thread into a colleague's chat; a page reload (or the browser Back button after any navigation) drops them back to an unselected inbox; and Command Center's 開啟 WhatsApp 對話 hand-off arrives with no conversation selected.
- **Fix:** Add `validateSearch: (s) => ({ id: typeof s.id === "string" ? s.id : undefined, status: ..., q: ... })`, drive `selectedId` from `Route.useSearch()`, and navigate with `replace: true` on selection.

**📌 [MEDIUM] The inbox never auto-refreshes and shows no last-updated time**  
`src/routes/admin.whatsapp.tsx:105` · feedback-state

- **What happens:** An agent leaves the inbox open on a second monitor. New customer conversations never appear and nothing on screen says how old the list is, so a message that arrived 20 hours ago looks like it just came in — or is not visible at all until someone thinks to click 重新整理.
- **Fix:** Poll every 30–60s while the document is visible, store `lastUpdatedAt` and render 「最後更新：HH:mm」 next to the button, spin the RefreshCw icon while loading, and announce the row count in a polite live region after each refresh.

**🆕 [MEDIUM] Three unrelated fetches share one error slot, and a later list refresh silently erases the earlier failure**  
`src/routes/admin.whatsapp.tsx:115` · feedback-state

- **What happens:** The agent list fails to load; a red banner appears saying something technical; the agent clicks 重新整理; the banner disappears and the page looks healthy — but the 負責代理 dropdown is still empty with no explanation, so assignment silently cannot be done. Conversely, an inbox load failure leaves the previous rows on screen under the banner, looking current.
- **Fix:** Keep separate error slots per resource (or a keyed map), never clear another resource's error, write staff-facing Chinese messages with a 重試 action, and mark the stale list visually (dimmed + 「資料可能已過時」) when its last fetch failed.

**🆕 [MEDIUM] The inbox has no status filter and no search — the toolbar's filters slot holds only two static badges**  
`src/routes/admin.whatsapp.tsx:335` · information-architecture

- **What happens:** With up to 100 conversations in one flat list an agent cannot narrow to 待跟進, cannot hide 已關閉, and cannot find a customer by name or phone — the only affordance is scrolling and reading. Every 'find the Chan family thread' task becomes a manual scan.
- **Fix:** Add a status Select (開啟/待跟進/已關閉/全部) and a keyword box matching name and phone, both driven by `validateSearch` + `Route.useSearch()` per the admin.operations.tsx pattern, and show a filtered-empty state with a 清除篩選 action.

**🆕 [MEDIUM] The inbox silently caps at 100 conversations and never shows a count**  
`src/routes/admin.whatsapp.tsx:491` · data-integrity-ux

- **What happens:** A manager (unscoped, so they see every conversation) scrolls to the bottom of the list and concludes they have handled everything. Conversation 101 and older — including any thread whose last message is older than the newest 100 — is simply not in the DOM, with nothing on screen admitting it exists.
- **Fix:** Render 「顯示 N 個對話（最近 100 個）」 above the list, and add paging or a 載入更多 once a keyword/status filter exists so older threads are reachable.

**🆕 [MEDIUM] The conversation pane's scroll container never engages, so the composer sits below the entire message history**  
`src/routes/admin.whatsapp.tsx:589` · responsive

- **What happens:** On a busy thread the whole admin page becomes metres tall: the customer header and 對話狀態/負責代理 selects scroll off the top, and the reply box is only reachable by scrolling past every message. The 'chat pane with a pinned composer' layout the code is clearly aiming for never materialises at any viewport.
- **Fix:** Bound the column: give the desktop Card `lg:h-[calc(100vh-12rem)]` (or `max-h-[40rem]`) and `overflow-hidden`, so `flex-1` + `overflow-y-auto` on the timeline actually scroll and the header/footer stay pinned. Apply the same cap inside the mobile AdminDetailPanel wrapper.

**🆕 [MEDIUM] The claimed WOZTELL_ENABLED copy fix covered only the toolbar badge — the env var is still shown to staff in three other places**  
`src/routes/admin.whatsapp.tsx:646` · copy-i18n

- **What happens:** Whenever sending is paused the agent's composer is disabled and the explanation is an environment-variable name — the exact failure the audit says was fixed, one component lower on the same page. A non-technical agent still cannot tell whether the customer opted out, the window closed, or the integration is down, and support gets a ticket saying "WOZTELL_ENABLED 未啟用".
- **Fix:** Reuse the badge's wording: :646 → 「回覆只可在客戶最後回覆後 24 小時內發送，且 WhatsApp 發送功能須為可用狀態。」; :780 → 「正在確認 WhatsApp 發送狀態」; :781 and the WOZTELL_DISABLED label → 「WhatsApp 發送暫停（請聯絡技術支援）」, keeping `WOZTELL_ENABLED` in a `title` as the badge does.

**🆕 [MEDIUM] Any in-flight mutation disables the whole workspace, including the textarea the agent is typing in**  
`src/routes/admin.whatsapp.tsx:656` · form-ux

- **What happens:** The agent sets 對話狀態 to 待跟進 and immediately continues typing their reply. The textarea goes disabled mid-word and drops focus for a second or more; the keystrokes in between are lost and the caret position is gone when it re-enables.
- **Fix:** Scope the disabling: disable only the control being mutated (`savingConversation` for the two selects, `sendingReply` for the composer and send button) and leave the textarea editable throughout.

**🆕 [MEDIUM] English strings and raw enum values throughout a Traditional Chinese staff UI**  
`src/routes/admin.whatsapp.tsx:685` · copy-i18n

- **What happens:** A Cantonese-speaking agent reading the AI summary sees 「Intent: unknown · Urgency: normal」 — three English tokens carrying the panel's entire meaning. 「最後 inbound」 is the timestamp that decides whether the 24-hour window is still open, and it is labelled in English.
- **Fix:** Translate the labels (意圖／緊急程度／AI 建議／採用建議回覆／最後客戶訊息／已退訂) and map the intent and urgency enum values through a Chinese label record the way `statusLabels` (:47) and `messageStatusLabels` (:53) already do.

**🆕 [MEDIUM] 「Use suggested reply」 silently overwrites whatever the agent has already typed**  
`src/routes/admin.whatsapp.tsx:693` · destructive-safety

- **What happens:** An agent types three sentences, then clicks the AI button out of curiosity to see the suggestion. Their draft is replaced outright and cannot be recovered.
- **Fix:** When `replyBody.trim()` is non-empty, either confirm before replacing (AdminConfirmDialog) or offer 插入到游標位置 / 取代 as two actions; and label the button in Chinese (see the copy finding).

**🆕 [MEDIUM] AI Assist collapses loading and fetch failure into the same 「未有 AI assist。」 message**  
`src/routes/admin.whatsapp.tsx:702` · feedback-state

- **What happens:** The agent opens a conversation, sees 「未有 AI assist。」, and moves on — when in fact the summary was still loading, or the AI call errored and a retry would have worked. There is no retry control either, so a transient failure permanently looks like 'this conversation has no suggestion'.
- **Fix:** Track `aiAssistState: 'loading' | 'ready' | 'error' | 'empty'`; show a skeleton while loading and an error line with a 重試 button on failure. Also give the panel a real heading (:680 is a `<p className="font-medium">`, not an `h3`).

**📌 [MEDIUM] The message timeline never scrolls to the newest message**  
`src/routes/admin.whatsapp.tsx:711` · feedback-state

- **What happens:** Every time an agent opens a conversation they land on the oldest message and must scroll down through the whole history to find what the customer just asked. After sending a reply the view does not follow either, so the agent cannot see their own message land.
- **Fix:** Add a bottom sentinel ref and `useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }) }, [messages.length, conversationId])` once the container is actually scrollable (see the finding at :589); anchor to bottom on open and on new messages, but suppress the jump if the agent has scrolled up.

**🆕 [MEDIUM] The message history is capped at 100 with the oldest silently dropped and no way to load more**  
`src/routes/admin.whatsapp.tsx:717` · data-integrity-ux

- **What happens:** On a long-running customer relationship the thread appears to begin abruptly mid-conversation, with the top message reading as the start of the relationship. An agent looking for what was promised three months ago will conclude it was never discussed.
- **Fix:** Show 「只顯示最近 100 則訊息」 at the top of the timeline when `messages.length === 100`, and add a 載入更早訊息 control backed by an offset/before-cursor parameter on fetchAdminConversation.

**📌 [MEDIUM] A failed message is styled identically to a delivered one and has no retry control**  
`src/routes/admin.whatsapp.tsx:730` · feedback-state

- **What happens:** Scanning a 40-message thread, an agent cannot spot the one outbound message that never reached the customer — 「送出失敗」 renders as faint semibold 12px text among identical-looking 「已送出」 labels. Even once spotted, there is no way to resend: the agent must retype the whole message into the composer.
- **Fix:** Give failed bubbles a destructive border/background plus an AlertTriangle icon (not weight alone), promote the status label out of `opacity-80`, and add a 重新發送 button on the bubble that calls sendAdminConversationReply with the original text.

**📌 [MEDIUM] Metadata row on outbound bubbles fails contrast — and that is where send status lives**  
`src/routes/admin.whatsapp.tsx:739` · a11y

- **What happens:** On a bright tablet screen in an office, an agent scanning for 送出失敗 among outbound bubbles is reading 12px text below the contrast floor — the failure signal is the least legible text on the page.
- **Fix:** Drop `opacity-80` and use a solid token that passes on primary (e.g. `text-primary-foreground/90` verified ≥4.5:1), or move status out of the tinted metadata row into its own full-contrast line.

**🆕 [MEDIUM] Raw provider error text is rendered inside the message bubble at low-contrast 12px**  
`src/routes/admin.whatsapp.tsx:746` · copy-i18n

- **What happens:** A failed message shows the agent something like `fetch failed: 502 Bad Gateway` in faint 12px white-on-primary text. They cannot tell whether to retry, whether the customer opted out, or whether to call support, and the string is in English on a Chinese-language console.
- **Fix:** Render `formatReplyError(message.error)` and extend `replyErrorLabels` with a default 「發送失敗（技術問題，請聯絡支援）」 fallback that keeps the raw string in a `title`; raise it out of `text-xs opacity-90` onto a destructive-tinted line.

**🆕 [MEDIUM] The 24-hour window is computed once at render and its remaining time is never shown**  
`src/routes/admin.whatsapp.tsx:784` · data-integrity-ux

- **What happens:** Two failures from one gap. An agent who has had a conversation open since 23h50 still sees an enabled composer indefinitely; the send is rejected server-side with 「超過 24 小時回覆窗口」 after they have typed the whole reply. And an agent triaging the queue has no way to see that this customer has 40 minutes left and that one has 9 hours — the single most decision-relevant number in a WhatsApp inbox is never displayed.
- **Fix:** Derive a `remainingMs` on a 60s ticking clock and render 「回覆窗口剩餘 3 小時 12 分」 in the header (destructive styling under 1 hour), disabling the composer the moment it hits zero. Surface the same remaining time per row in the inbox list.

**📌 [LOW] The reply composer has no maxLength and no character counter**  
`src/routes/admin.whatsapp.tsx:652` · form-ux

- **What happens:** An agent pastes a long property description, the provider rejects it for exceeding the WhatsApp 4096-character body limit, and the only feedback is a raw provider error after the fact — with a failed row already written to the thread (see the :311 finding). Nothing warns them while typing.
- **Fix:** Add `maxLength={4096}` plus a live 「{replyBody.length}/4096」 counter below the textarea (colour-shifted plus text, not colour alone, past ~90%), and mirror the limit server-side.

**🆕 [LOW] Timestamps omit the year and carry no full-date tooltip**  
`src/routes/admin.whatsapp.tsx:827` · data-integrity-ux

- **What happens:** A conversation last touched in December 2025 displays as 「12-31 09:15」, indistinguishable at a glance from this year's — on a page where the age of the last inbound message decides whether the agent may reply at all.
- **Fix:** Include the year when the date is not in the current year, and wrap the output in `<time dateTime={value} title={fullLocalString}>` so the exact timestamp is available on hover and to assistive tech.

### CMS content hub

**🆕 [HIGH] Every list is a silent server-side row cap presented as the complete set, and the new search boxes only filter the capped page**  
`src/routes/admin.cms.tsx:247` · data-integrity-ux

- **What happens:** Adding client-side search did not fix the cap — it made it actively misleading. An editor searching for an estate that was last updated 41 edits ago gets 「找不到符合「…」的屋苑」 (L1953) and concludes the estate does not exist, so they create a duplicate rather than editing it. The 40th-oldest article is simply unreachable through this UI.
- **Fix:** Either push `q` to the server (the FAQ/estate queries can take a filter) or render an explicit 「顯示最近 40 個屋苑（共 N 個）」 line above each table with a load-more control, mirroring the honesty fix already applied to admin.leads.tsx.

**🆕 [HIGH] FAQ import's 新增/覆寫 preview is diffed against a server-capped 120-row FAQ list, so overwrites are silently under-reported**  
`src/routes/admin.cms.tsx:319` · data-integrity-ux

- **What happens:** A site with more than 120 FAQs (exactly the situation bulk import exists for) has FAQs the client never loaded. Importing a file containing those questions makes every one of them show as 新增 in the confirm table (L1311-1315), and the confirm copy at L1287 reads 「全部為新增，不會覆寫現有 FAQ。」 while the server overwrites their answers in place. Staff explicitly approve a no-overwrite operation and destroy live AI-agent answers with no record of the old text.
- **Fix:** Do the new-vs-overwrite diff on the server inside the import call (a single `SELECT scope, question FROM faqs WHERE (scope,question) IN (...)` over the parsed keys), or at minimum detect `data.faqs.length >= 120` and replace the confirm copy with an honest 「無法確認是否會覆寫（只載入了最近 120 條 FAQ）」 warning.

**🆕 [HIGH] A save that succeeded but whose refetch failed is reported to staff as a failed save, and the table keeps showing pre-save data**  
`src/routes/admin.cms.tsx:352` · data-integrity-ux

- **What happens:** If the write commits but `refreshCmsData()` then fails (network blip, one of the three parallel fetches erroring), staff see a red error toast, the dialog stays open with their text intact, and the table behind still shows the old row — every signal says 'it did not save'. They press 儲存 again; for a new estate/article/video that has no `id` this creates a second row (or hits a raw Postgres unique-violation on slug), for an edit it re-writes and doubles the audit trail.
- **Fix:** Await the write, then `toast.success` + close, then refresh in a separate `try` that reports 「已儲存，但列表未能更新，請重新載入」 on failure.

**🆕 [HIGH] A partial FAQ import leaves the live AI knowledge base un-rebuilt while the FAQ table shows the imported rows**  
`src/routes/admin.cms.tsx:503` · data-integrity-ux

- **What happens:** Row 57 of 200 fails. The table (refreshed at L502) now shows 56 new/updated FAQs and looks done, but the public live agent is still answering from the pre-import index, and the 待重建段數 metric was not refreshed either so the AI card gives no warning. Staff fix row 57 and re-import, never realising the first 56 answers were never served.
- **Fix:** Run the rebuild on the failure path too (or at minimum call `refreshKnowledgeStatus()` and append 「AI 知識庫尚未重建，請按『重建索引』」 to the error toast).

**🆕 [HIGH] 發布時間 is still a free-text input holding a raw ISO timestamp — the audit's claimed `type="datetime-local"` fix is absent**  
`src/routes/admin.cms.tsx:1619` · form-ux

- **What happens:** The field shows `2026-08-05T09:12:33.000Z` and staff must hand-edit that string with no picker, no format hint and no validation. `saveAdminArticle` passes the value straight into a timestamp bind (admin-data.server.ts:1124-1134), so 「2026年8月5日」 comes back as a raw Postgres `invalid input syntax for type timestamp` in a toast. Worse, clearing the box sends `null`, and the server silently substitutes `new Date().toISOString()` (admin-data.server.ts:1124) — clearing the publish date resets a two-year-old article's publish date to today.
- **Fix:** Give `TextField` a `type` prop and pass `type="datetime-local"` here (converting to/from the ISO value), and stop the server's silent now() substitution on edit.

**🆕 [MEDIUM] The per-tab search boxes and FAQ scope filter are not in the URL, so the working view is lost on every reload and back-navigation**  
`src/routes/admin.cms.tsx:203` · information-architecture

- **What happens:** The search/filter controls were added by the follow-up pass but were never wired into the search params the tab already uses. An editor filters FAQs to 分組=買樓 + 「按揭」, opens an FAQ, hits browser Back, and lands on an unfiltered list at the top — the exact failure the audit fixed for /admin/leads. No filtered CMS view can be shared with a colleague.
- **Fix:** Extend `parseAdminCmsSearch` with `q` and `scope` and drive `searchByTab[activeTab]` / `faqScopeFilter` from `Route.useSearch()` + `navigate({ replace: true })`, as admin.operations.tsx does.

**🆕 [MEDIUM] Required-field validation reports a combined message in a toast with no inline error and no focus on the offending field**  
`src/routes/admin.cms.tsx:340` · form-ux

- **What happens:** The native `required` attribute only catches an empty box — a value of a single space passes it and reaches this check. The staff member then gets one toast naming three fields, in a dialog that scrolls (`max-h-[85vh] overflow-y-auto`, L1444) and can be 14 fields long, with nothing highlighted and focus left wherever it was. On a 375px screen the offending field is usually off-screen.
- **Fix:** Port the `fieldErrors` + `role="alert"` + `aria-invalid`/`aria-describedby` + focus-first-invalid pattern from `AgentProfileForm.tsx`, and mark required fields visually in `Field`.

**🆕 [MEDIUM] Bulk import fires N serial round-trips with no progress indication**  
`src/routes/admin.cms.tsx:477` · feedback-state

- **What happens:** A 200-row import is 200 sequential HTTP round-trips — minutes of a modal that says 「處理中…」 with no counter, no progress bar and no cancel. Staff cannot distinguish 'working' from 'hung', reload the page mid-loop, and end up with a partially-written knowledge base and no idea where it stopped.
- **Fix:** Render the already-tracked progress (`已匯入 {imported}／{total}`) live in the dialog via a state counter, and/or add a bulk server function that writes the rows in one call.

**📌 [MEDIUM] 上載 FAQ 檔案 is a `<Button asChild><label>` wrapping an `sr-only` file input, so it is keyboard-invisible**  
`src/routes/admin.cms.tsx:999` · a11y

- **What happens:** A keyboard user tabbing the FAQ toolbar sees the focus ring vanish for one stop (focus is on a 1px-clipped input) and cannot tell what is focused; pressing Enter/Space does nothing, since only a click on the label opens the picker. Screen-reader users hear an unlabelled file input.
- **Fix:** Make it a real `<Button type="button" onClick={() => faqFileInputRef.current?.click()}>` with the file input rendered `hidden` outside it — `faqFileInputRef` (L211) is already declared for this and is currently unused.

**🆕 [MEDIUM] Scope group header badge reads as the group's FAQ count but is the post-filter, post-cap count**  
`src/routes/admin.cms.tsx:1046` · data-integrity-ux

- **What happens:** A scope with 60 FAQs shows 「買樓流程 3」 after a keyword search — the badge sits in a group-header row with no filter context, so it reads as the size of the group and staff use it to decide whether content is missing. `data.faqGroups[].total` holds the true number and is never displayed.
- **Fix:** Render `{rows.length} / {faqGroups.find(g => g.scope === scope)?.total}` or label it 「顯示 N 條」 whenever a filter/search is active.

**🆕 [MEDIUM] An all-new FAQ import shows no preview of what will be created — only a count**  
`src/routes/admin.cms.tsx:1295` · feedback-state

- **What happens:** `parseAdminFaqImport` (src/lib/admin/faq-import.ts:7-18) silently picks one of three parsers by trial; a CSV whose lines contain commas inside answers, or a Markdown file with stray `#` lines, parses into plausible-looking-but-wrong rows. Staff see 「已解析 137 條」, confirm, and write 137 malformed Q&A pairs straight into the live agent's knowledge base with no chance to look at a single one first.
- **Fix:** Always render the preview table (question + answer excerpt + scope + 新增/覆寫), not only in the overwrite case.

**🆕 [MEDIUM] Article 內容 editor has no preview and no format helper text — the audit's claimed 預覽 toggle does not exist**  
`src/routes/admin.cms.tsx:1642` · form-ux

- **What happens:** Editors write public article bodies in an 8-row plain textarea with no indication that blank lines are the paragraph separator and no way to see the rendered result before publishing. The only way to check formatting is to save, publish, and open the public page.
- **Fix:** Add the claimed 預覽 toggle (render the same blank-line paragraph split the public article page uses) plus a one-line 「以空行分段」 hint under the textarea.

**🆕 [LOW] FAQ scope filter is built from the 120-row FAQ page, so whole scopes are missing from the dropdown**  
`src/routes/admin.cms.tsx:290` · data-integrity-ux

- **What happens:** Any scope whose FAQs all sort past the 120-row page has no entry in 依分組篩選, so staff cannot filter to it and, combined with the same cap on the table, have no route to those FAQs from this screen at all.
- **Fix:** Build the dropdown from `data.faqGroups` (which is complete and already fetched) and show its `total` next to each scope name.

**🆕 [LOW] Raw English server errors ("Not found") are toasted verbatim to Traditional-Chinese staff on every save path except FAQ delete**  
`src/routes/admin.cms.tsx:544` · copy-i18n

- **What happens:** A staff member editing a media asset or article that a colleague deleted seconds earlier gets an English toast reading 「Not found」 with no explanation and no instruction, on a screen that is otherwise entirely Traditional Chinese. They have no way to know the record is gone rather than the app being broken.
- **Fix:** Move the `"Not found"` → Chinese mapping out of `handleDeleteFaq` into `errorText()` so all five handlers get it, and cover the other bare English server strings the same way.

**📌 [LOW] Truncated SEO-title and alt-text cells still have no title attribute**  
`src/routes/admin.cms.tsx:828` · visual-consistency

- **What happens:** SEO titles and image alt text are routinely longer than `max-w-xs`; an editor scanning the articles or media table sees 「香港置業指南：2026 年…」 and cannot read or compare the rest without opening each row's dialog one at a time.
- **Fix:** Add `title={article.seo_title ?? ""}` at L828 and `title={asset.alt_text ?? ""}` at L1167, matching L737.

**🆕 [LOW] 媒體庫 empty state is a dead end and there is no upload control anywhere in the CMS**  
`src/routes/admin.cms.tsx:1194` · information-architecture

- **What happens:** A new deployment lands on 媒體庫 and is told 「上載相片後…」 with no upload button and no statement of where uploads actually happen (the listing form's ImageUploader). The other four tabs all offer a 新增 action from the same state, so the omission reads as a broken button rather than a deliberate boundary.
- **Fix:** Either add the `action` (a link to wherever uploads occur) or change the description to name that route explicitly: 「相片在放盤編輯頁上載後，會自動出現在此。」

**🆕 [LOW] Search clear button is a 32px tap target inside toolbars the tap-target pass never reached**  
`src/routes/admin.cms.tsx:1933` · responsive

- **What happens:** On the tablets agents use, the clear-X sits 6px from the input's right edge at 32×32px; mis-taps land in the text field instead, and on touch there is no hover cue that it is a control. Keyboard users get no visible focus ring on it.
- **Fix:** `h-11 w-11 lg:h-8 lg:w-8` (the pattern used elsewhere) plus `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`, and widen the input's `pr-8` to match.

### Listings + property form

**🆕 [HIGH] Photo upload reports partial failure as success, and most failure toasts are never seen**  
`src/components/dashboard/ImageUploader.tsx:66` · data-integrity-ux

- **What happens:** An agent selects 12 photos from a shoot; 7 fail (large files, flaky mobile connection). They get 12 stacked toasts of which at most 3 are visible, the last one green and reading 「已上載 5 張相片」. They assume the whole batch landed, save the listing, and the property goes public with 5 of 12 photos and no record of which 7 are missing.
- **Fix:** Collect failures into an array; when non-empty, replace the success toast with a single persistent `toast.error` listing the failed filenames and a 重試 action, e.g. 「已上載 5／12，7 張失敗：a.jpg…」. Render the same summary inline under the uploader so it survives toast dismissal.

**🆕 [HIGH] Raw Postgres / English server errors are shown to staff when a save fails — including the most common failure, a duplicate 放盤編號**  
`src/components/dashboard/PropertyForm.tsx:230` · copy-i18n

- **What happens:** An agent re-types an existing listing number and sees a toast reading 'duplicate key value violates unique constraint "properties_listing_no_key"'. They have no idea which field is wrong, the 放盤編號 input carries no inline error and no focus, and the toast auto-dismisses. On an edit of a row they can't scope to, they see the English 'Not found' on a listing that is visibly on screen.
- **Fix:** Map known server errors to Chinese in `handleSubmit` — unique-violation → set `fieldErrors.listing_no = "此放盤編號已被使用，請改用其他編號"` and focus the field; `"Not found"` → 「找不到此放盤，可能已被刪除或你沒有權限」. Fall back to 「儲存失敗，請稍後再試」 with the raw text in `title` for support.

**📌 [HIGH] PropertyForm still has no unsaved-changes guard — the 20+ field listing form loses everything on any navigation**  
`src/components/dashboard/PropertyForm.tsx:238` · form-ux

- **What happens:** An agent fills 20 fields and uploads 8 photos for a new listing, then clicks 放盤 in the sidebar or the browser Back button (or the 返回 link that sits directly above the form at admin.listings\_.$id.tsx:69). Everything is destroyed with no prompt. Uniquely bad here versus the CMS dialogs: the uploaded photos were already written to Vercel Blob and media_assets, so the blobs are orphaned and the URLs are gone from the UI, unrecoverable.
- **Fix:** Compute `isDirty` by comparing `form` against `createInitialForm(property)` plus `images` against `property?.images ?? []`, pass it to `useRouteLeaveGuard`, and render the returned `dialog`. Also add an explicit 取消 button next to 建立放盤 that routes through the same guard.

**📌 [HIGH] Listings page shows at most 80 of ~398 rows and has no keyword search, though the server supports both**  
`src/routes/admin.listings.tsx:94` · data-integrity-ux

- **What happens:** An agent looking for listing #EP2041 filters to 公開 + 售盤, sees 80 rows sorted by updated_at, doesn't find it, and concludes the listing was deleted — when it is simply row 112. There is no search box and no way to page past 80, so any listing that hasn't been touched recently is unreachable from this screen.
- **Fix:** Add a debounced 搜尋編號／標題／屋苑 input bound to `filters.q` (server already handles it), add `limit` to `AdminListingFiltersInput`, and render 「顯示 N 筆（上限 80 筆）」 with a 載入更多 when `rows.length === limit`.

**📌 [HIGH] 下架 and 已售/已租 mutate published listing status on a single unconfirmed click**  
`src/routes/admin.listings.tsx:360` · destructive-safety

- **What happens:** On a tablet, an agent aiming for 編輯 on row 14 hits 下架 one button over. The listing is instantly pulled from the public site; the only feedback is a green toast reading '#EP2041 已下架'. There is no undo control — recovery means opening the edit form and changing 狀態 back, and the agent may not even notice.
- **Fix:** Route both through `AdminConfirmDialog` (already used for FAQ delete and lead stage change) showing the listing_no and the target status; 已售/已租 should state that it removes the listing from public search.

**🆕 [MEDIUM] Thumbnail remove / reorder controls are ~22px tap targets — the prior audit's photo-delete fix addressed visibility but not hit area**  
`src/components/dashboard/ImageUploader.tsx:21` · responsive

- **What happens:** On the tablet an agent uses on a viewing, tapping 下移 on photo 3 lands on 上移 or on the adjacent remove X instead — a 22px target with 4px separation is under every touch guideline. The mis-tap on X silently deletes the photo (see the separate no-confirm finding).
- **Fix:** Give the thumbnail buttons `h-11 w-11 lg:h-8 lg:w-8` (matching the `h-11 lg:h-9` convention the audit applied elsewhere) and increase the gaps to `gap-2`; keep the icon size and let padding grow.

**🆕 [MEDIUM] Upload failures show English HTTP status text — or nothing at all when the blob store is misconfigured**  
`src/components/dashboard/ImageUploader.tsx:56` · copy-i18n

- **What happens:** When the blob token is missing or expired, every photo fails and the agent sees 「上載失敗：DSC_0142.jpg — 」 with nothing after the dash. They retry repeatedly, blame their own file, and have no indication this is a server configuration problem to report. This is the same class of leak the prior audit fixed on admin.whatsapp.tsx by replacing `WOZTELL_ENABLED: false` with Chinese copy.
- **Fix:** Fall back to a Chinese message keyed on `res.status` — 「上載失敗：{name}（伺服器問題，請聯絡技術支援）」 for 5xx, 「檔案過大或格式不支援」 for 4xx — and keep `res.status` in the toast's `title` for support. Have the endpoint return JSON `{ok:false, error}` for its throw paths.

**🆕 [MEDIUM] Uploads keep running after the form unmounts, and the resulting photos are dropped on the floor**  
`src/components/dashboard/ImageUploader.tsx:62` · code-quality

- **What happens:** An agent selects 15 photos, realises they picked the wrong folder, and clicks 返回 or a sidebar link (nothing blocks them — see the unsaved-guard finding). The uploads continue to completion against a torn-down component: every file is written to Vercel Blob and inserted into `media_assets` (api.admin.media.upload.ts:26-32), then `onChange` fires into a dead parent, so all 15 URLs are lost. Storage fills with orphaned blobs no screen can reach.
- **Fix:** Hold an `AbortController` in a ref, abort it in a `useEffect` cleanup, check the signal before each `setState`/`onChange`, and add a 取消上載 button while `uploading`.

**🆕 [MEDIUM] Upload progress is announced to nobody — the only indicator is the label of a disabled button**  
`src/components/dashboard/ImageUploader.tsx:98` · a11y

- **What happens:** A screen-reader user selects 12 photos and gets silence. They don't know the upload started, don't know it's at 7/12, and only learn the outcome if sonner's toast happens to be announced — by which time the per-file failure toasts have already been evicted (see the partial-failure finding).
- **Fix:** Add a visually-hidden `role="status" aria-live="polite"` element carrying 「上載中 7／12」 and the final 「已上載 5 張，7 張失敗」, and set `aria-busy={uploading}` on the uploader container.

**🆕 [MEDIUM] Removing a photo is instant and unconfirmed, and silently reassigns the public cover image**  
`src/components/dashboard/ImageUploader.tsx:144` · destructive-safety

- **What happens:** A mis-tap on the 22px X (or a deliberate click on the wrong thumbnail) removes a photo from the listing with zero feedback. The blob still exists in storage but its URL is gone from the UI, so the only recovery is finding and re-uploading the original file. Removing the first photo changes what appears on the public property card and search results without any indication that happened.
- **Fix:** Confirm before removal when the listing already has images (or at minimum for `i === 0`), and offer an 復原 action on a toast. Surface a note when the cover changes: 「封面已改為相片 2」.

**🆕 [MEDIUM] Native HTML5 constraint validation preempts the entire Traditional-Chinese inline error system**  
`src/components/dashboard/PropertyForm.tsx:238` · copy-i18n

- **What happens:** A staff member leaves 放盤編號 blank and clicks 建立放盤. They get the browser's own bubble in the _browser's_ UI language — 'Please fill out this field.' on the English-locale Chrome that HK office machines typically ship with — not 「請輸入編號」. Same for a malformed 影片連結 ('Please enter a URL.') and for 房 = 25 ('Value must be less than or equal to 20.'). The audit's fix for Chinese validation messages is therefore unreachable for exactly the fields most likely to fail.
- **Fix:** Add `noValidate` to the `<form>` at :238 (keeping `required` for `aria-required` semantics), so zod is the single source of validation and every message is the Chinese one already defined at :60-87.

**🆕 [MEDIUM] 地區 slug is a required free-text technical identifier with a hard-coded English default**  
`src/components/dashboard/PropertyForm.tsx:333` · copy-i18n

- **What happens:** A non-technical staff member creating a listing with no matching 屋苑 must type a URL slug in English. 'slug' is untranslated jargon; typing 屯門 or 'Tuen Mun' or 'tuen-mun ' passes validation and produces a listing filed under a district that doesn't exist, invisible on district pages. Conversely, someone who carefully typed a slug then picks an estate and watches it silently change under them.
- **Fix:** Replace the free-text input with a Select over the known district slugs, labelled 地區 with the slug shown as secondary text; if free text must stay, validate against the district list and warn (not silently overwrite) when an estate selection would change a non-default value.

**🆕 [MEDIUM] English field labels in a Traditional-Chinese staff form**  
`src/components/dashboard/PropertyForm.tsx:440` · copy-i18n

- **What happens:** A staff member who doesn't read English can't tell that 'English title' is the optional English-language title (versus the required 標題 above) and, more consequentially, can't read 'one per line' — the format instruction for 設施. They type comma-separated features, `normalizePropertyFeatures` (property-form-content.ts:33-38) splits on newlines only, and the entire list is stored and published as one run-on feature bullet.
- **Fix:** Relabel to 「英文標題（選填）」 and 「設施（每行一項）」, matching the Chinese error messages already defined for both fields.

**📌 [MEDIUM] Listing filters live in useState with no validateSearch, so the working view is not shareable and is lost on every back-navigation**  
`src/routes/admin.listings.tsx:81` · information-architecture

- **What happens:** An agent filters to 我的放盤 + 租盤 + 草稿, opens a listing to edit, saves, and is navigated back to /admin/listings (admin.listings\_.$id.tsx:85) — landing on the unfiltered top-of-list every single time. Editing 12 draft rentals means re-selecting three dropdowns 12 times. The filtered view also can't be sent to a colleague.
- **Fix:** Add `validateSearch` for status/deal_type/estate_id/featured/agent_id (plus the missing `q`), drive the Selects from `Route.useSearch()`, and write via `useNavigate({ search })` — the exact pattern already in admin.operations.tsx:57.

**🆕 [MEDIUM] A failed estate/agent options fetch is silently erased by the concurrent listings fetch, leaving two filters permanently empty**  
`src/routes/admin.listings.tsx:113` · feedback-state

- **What happens:** When the estates or agents endpoint fails, the agent sees a fully populated listings table and two filter dropdowns that contain nothing but 全部屋苑 / 全部代理. They conclude the agency has no estates and no agents configured, or that filtering by agent isn't supported — there is no error message anywhere on screen.
- **Fix:** Keep a separate `optionsError` state and render it as a non-blocking notice near the filter row (「屋苑／代理選項載入失敗，請重新整理」), with a retry; never share one `error` slot between two independent requests.

**🆕 [MEDIUM] Changing a filter gives no loading feedback and leaves the previous result set on screen; a failed refetch shows an error banner above rows that still look current**  
`src/routes/admin.listings.tsx:246` · feedback-state

- **What happens:** An agent switches 狀態 from 全部 to 已售 on a slow office connection. For a second or more the table shows the unfiltered rows, unchanged — they read it as the filter having no effect and click again. Worse: if that request fails, they see an error banner sitting above a full table of listings that no longer matches the dropdowns, and nothing marks those rows as stale.
- **Fix:** Show the skeleton (or an overlay + `aria-busy`) whenever `loadingRows`, wrap the result count in an `aria-live="polite"` region, and on error either clear `rows` or visibly mark the table stale with a 重試 action.

**🆕 [MEDIUM] Status mutations give no in-flight progress while the whole listings table silently refetches**  
`src/routes/admin.listings.tsx:354` · feedback-state

- **What happens:** An agent clicks 下架 on a slow connection. The button greys out but the row still shows 公開 and the rest of the table looks normal for the whole round trip plus a full 80-row refetch. With no progress cue they click 已售 on the same row, or navigate away mid-request and never learn whether the change landed.
- **Fix:** Render a `Loader2` spinner inside the pressed button while its `mutatingId` matches, set `aria-busy`, and announce the result in a polite live region rather than relying on the toast alone.

**🆕 [MEDIUM] A failed listing fetch is presented as 「找不到放盤或無權限編輯」 with no retry**  
`src/routes/admin.listings_.$id.tsx:76` · feedback-state

- **What happens:** An agent clicks 編輯 on a listing they can plainly see in the table; a transient network blip means they're told the listing doesn't exist or that they lack permission. Both readings are wrong, both are alarming, and the only offered action sends them back to the list — they have no way to retry short of a full page reload.
- **Fix:** Track the failure separately (`const [loadError, setLoadError] = useState<string|null>(null)`), render `<AdminError>` with a 重試 button on failure, and reserve the 找不到放盤 copy for a genuine `null` response.

**🆕 [LOW] The 相片 label points at a display:none input, so the association doesn't resolve for assistive tech and the field can never show an error**  
`src/components/dashboard/PropertyForm.tsx:480` · a11y

- **What happens:** A screen-reader user tabbing the form hears the 上載相片 button with no indication it belongs to a 相片 field, and the 相片 label is announced against nothing. Every image problem — unsupported type, over 5MB, upload failure — exists only as a transient toast; nothing is ever rendered inline under 相片, unlike every other field on the form.
- **Fix:** Point the label at the visible trigger instead: give the 上載相片 button the id and use `aria-describedby` for the JPG/PNG helper text (ImageUploader.tsx:109-111), or replace `className="hidden"` with `sr-only`-style clipping so the input stays in the a11y tree. Pass an `error` through `Field` and render image errors inline.

**📌 [LOW] Truncated and line-clamped listing cells carry no title attribute**  
`src/routes/admin.listings.tsx:332` · visual-consistency

- **What happens:** Two estates named 麗城花園第一期 and 麗城花園第三期 both render as 麗城花園第… at 176px, and there is no hover or focus affordance to disambiguate. An agent scanning for a listing in a specific phase has to open each row to tell them apart.
- **Fix:** Add `title={listing.estate_name_zh ?? undefined}`, `title={listing.agent_name ?? undefined}` and `title={listing.title_zh}` to :332, :333 and :318.

**📌 [LOW] Price column has no tabular-nums**  
`src/routes/admin.listings.tsx:334` · visual-consistency

- **What happens:** An agent scanning the 價格 column for outliers can't compare figures at a glance — digits don't line up vertically, and `$12.50M` sitting directly above `$28,000` reads as though the rental costs more until you notice the M.
- **Fix:** Add `tabular-nums` to the cell, and append a unit suffix to the rent format (`$28,000/月`) so the two row types are distinguishable in the same column.

**🆕 [LOW] Neither listing child route uses the breadcrumb the shell gained for exactly this case**  
`src/routes/admin.listings_.$id.tsx:67` · information-architecture

- **What happens:** On /admin/listings/9f3a…, the page reads 編輯放盤 with no indication of _which_ listing until the agent scrolls the form. With several tabs open on different listings there is nothing in the header — or the document title, which is the constant 「編輯放盤｜Earnest Admin」 (:18) — to tell them apart, and it is easy to edit the wrong one.
- **Fix:** Pass `breadcrumb={<>後台 › <Link to="/admin/listings">放盤</Link> › 編輯 #{property.listing_no}</>}` on both routes, and include the listing_no in the `head` title for /$id.

### AI content copilot

**🆕 [HIGH] Editing any form field after generating silently voids the proposal, and it is only discovered at apply time**  
`src/components/admin/AdminContentCopilot.tsx:256` · data-integrity-ux

- **What happens:** The natural thing to do during the advertised 「通常需要十多秒」 wait — or while reading the suggestions — is to keep editing the listing. Correcting the price, or even re-typing the same 描述 character-for-character with a stray space, silently invalidates the proposal. The panel gives no hint: the diff cards and 套用 button still look live. The staff member only learns at the moment of clicking 套用, and (per the finding above) loses the review at the same instant.
- **Fix:** Recompute the current fingerprint as `fingerprintValues` changes (debounced) and, on mismatch, show a persistent 「表單已改動，此建議已過時」 banner in the review panel with 重新產生 promoted, instead of letting the user commit review effort to a proposal that is already void.

**🆕 [HIGH] 復原為套用前內容 restores a snapshot of every content field, silently reverting edits made after the apply**  
`src/components/admin/AdminContentCopilot.tsx:273` · data-integrity-ux

- **What happens:** Apply an AI 描述, then hand-fix a typo in 標題 and rewrite 特色, then decide you preferred the old 描述 and press 復原為套用前內容. The 標題 fix and the 特色 rewrite are reverted too, with no warning and no second undo. The button's label promises it undoes the apply; it actually rewinds every content field to the moment of the apply.
- **Fix:** Snapshot only the fields that actually changed (`acceptedFields`), and clear `undoValues` (hiding the button) as soon as `values` diverges from the post-apply state.

**🆕 [HIGH] A failed 套用 throws away the entire reviewed proposal — no way back to the review list**  
`src/components/admin/AdminContentCopilot.tsx:476` · data-integrity-ux

- **What happens:** Staff spend minutes reading a 5-patch proposal, tick 3 of them, click 套用已選建議, and the server/patch check returns STALE or PATCH*CONFLICT. The whole review panel — every diff card and every checkbox they ticked — vanishes, replaced by a red box telling them to regenerate. The 捨棄建議/重新產生 escape hatches the 4-Aug pass added live \_inside* Review, so they disappear too. Regenerating costs another 10+ seconds and one of only 20 generations per staff per hour (content-copilot-repository.server.ts:88,131). This is a re-check failure of the audit's claimed fix «a 捨棄建議/重新產生 action exists so a disliked proposal no longer forces closing (and losing) the draft» — it holds only on the happy path.
- **Fix:** Keep rendering `Review` whenever `proposal` is non-null and surface the error as a banner above it (disabling only the 套用 button), so the selection survives a recoverable failure. Add a 返回覆核 action to the failed/stale block at minimum.

**🆕 [HIGH] Review list is capped at 288px by `max-h` on a ScrollArea, which clips rather than scrolls**  
`src/components/admin/AdminContentCopilot.tsx:544` · responsive

- **What happens:** A proposal can carry up to 12 patches (content-copilot.ts:132), each an ~120px card with two text panes. Everything past the first roughly two cards is cut off and unreachable, so staff review and apply a subset of a proposal while believing they have seen all of it. Even in the best case the 288px window has no visible affordance that more exists, and the 套用已選建議 button sits below it implying the list is complete.
- **Fix:** Give the ScrollArea a definite height (`h-72`) rather than `max-h-72`, or drop the ScrollArea and let the aside scroll; and show 「共 N 項建議」 next to the 建議內容 heading.

**🆕 [HIGH] proposal.warnings are never displayed — a failed web-research run is reported as a normal proposal**  
`src/components/admin/AdminContentCopilot.tsx:596` · data-integrity-ux

- **What happens:** A staff member picks 內部資料及網頁研究 specifically because they need externally-sourced facts. Tavily is down; the server proceeds with internal evidence only and records a warning. The panel shows a normal proposal with a normal 資料來源 list, so the copy is accepted and published as web-researched when it never was. Any other model-emitted warning is dropped the same way. (The server string is also English, so it needs translating before it is shown.)
- **Fix:** Render `proposal.warnings` above the patch list in a `role="status"` amber block, and map the known server warnings to Traditional Chinese.

**🆕 [MEDIUM] Rate-limit message tells staff to wait 「一兩分鐘」 when the real window is one hour**  
`src/components/admin/AdminContentCopilot.tsx:98` · copy-i18n

- **What happens:** A staff member doing a bulk CMS cleanup hits the cap, waits two minutes as instructed, retries, fails, retries, fails — each retry consuming nothing but their time, with the same message repeating. The actual wait is up to 60 minutes from their oldest request, and nothing in the UI shows the quota or when it resets. Note that the stale-proposal loop above makes hitting 20/hour realistic in an afternoon.
- **Fix:** Say 「每小時最多 20 次 AI 建議，已用完；約 X 分鐘後可再試」 and, ideally, return the reset time from the server so the message can be exact.

**🆕 [MEDIUM] Several server error codes have no Chinese mapping and fall back to a 「請稍後再試」 that is wrong for them**  
`src/components/admin/AdminContentCopilot.tsx:105` · copy-i18n

- **What happens:** These are permanent conditions — the proposal record is gone, or the record being edited no longer exists, or the request was rejected outright. Staff are told to wait and retry, which can never succeed, so they retry repeatedly and eat the hourly quota before contacting support. Only the raw code under 技術詳情 (line 356) reveals which it was.
- **Fix:** Map each of these four codes with its real cause and next step (e.g. 「建議紀錄已不存在，請重新產生」, 「找不到這筆資料，請重新開啟後再試」).

**🆕 [MEDIUM] A 10-second-plus generation cannot be cancelled, has no timeout, and is abandoned silently when the dialog closes**  
`src/components/admin/AdminContentCopilot.tsx:212` · feedback-state

- **What happens:** If the provider hangs, the panel is frozen in 「AI 正在產生建議，通常需要十多秒…」 indefinitely: the user cannot change the action, cannot cancel, and cannot re-trigger — the only escape is closing the CMS dialog, which unmounts the panel mid-flight. On reopening, the panel is back at "ready" with no trace, while the server has still spent the request against the 20/hour quota and left a proposal row behind. The user has no idea the generation was consumed.
- **Fix:** Add a 取消 button that aborts the request (AbortController) and returns to "ready", guard the post-await `setState`s with a request token, and apply a client-side timeout that surfaces the existing COPILOT_GENERATION_FAILED copy.

**🆕 [MEDIUM] onApply writes back a full normalised snapshot, overwriting concurrent edits and reformatting fields nobody accepted**  
`src/components/admin/AdminContentCopilot.tsx:278` · data-integrity-ux

- **What happens:** Two concrete losses. (1) Keystrokes typed into any content field while the decide call is in flight are overwritten by the stale pre-click snapshot when it resolves — the field visibly reverts. (2) Accepting a 描述 patch also rewrites 特色: deliberate blank lines and trailing spacing in a field the user never selected disappear, which reads as the AI having edited something it promised at line 108 it would not touch.
- **Fix:** Pass only the accepted patches to `onApply` (this is exactly what the unused `buildContentCopilotPartialUpdate` helper produces) and let each caller merge them into its own current state.

**🆕 [MEDIUM] Applying the accepted patches destroys every suggestion the user did not accept**  
`src/components/admin/AdminContentCopilot.tsx:279` · data-integrity-ux

- **What happens:** Per-field opt-in is the whole point of the 4-Aug fix, but the flow only supports one round: accept the 標題 patch now, and the 描述/SEO 描述 suggestions you wanted to read once more are gone permanently. Getting them back means another full generation against the 20-per-hour cap, which will then almost certainly fail as stale because the first apply just changed the form. The panel never says this is one-shot.
- **Fix:** After a successful apply, keep the proposal mounted with the applied rows marked 已套用 and the rest still acceptable, or warn in the review footer that unaccepted suggestions are discarded on apply.

**🆕 [MEDIUM] Focus is dropped on the floor after 套用/捨棄/復原, and success is never announced**  
`src/components/admin/AdminContentCopilot.tsx:360` · a11y

- **What happens:** A keyboard user presses Enter on 套用已選建議; the button disappears and focus resets to `<body>`, so the next Tab starts from the top of the page — inside a CMS dialog that is several dozen tab stops long. A screen-reader user gets no announcement at all that the patch landed, because the confirmation banner is a plain div and the live region it might have been in has just been unmounted.
- **Fix:** Move focus to the applied banner (`tabIndex={-1}` + `.focus()`), give it `role="status"`, and focus the 產生建議 button after 捨棄建議.

**🆕 [MEDIUM] The entire proposal diff sits inside an aria-live region that is mounted together with its content**  
`src/components/admin/AdminContentCopilot.tsx:528` · a11y

- **What happens:** Either the screen reader ignores the update (a live region inserted with its content is unreliably monitored), leaving a blind user with no signal that a 10-second wait ended, or it reads the whole proposal — potentially thousands of characters of before/after text — as one uninterruptible announcement. Subsequent in-region changes (the 套用中… label swap, 全選 becoming disabled) re-trigger it.
- **Fix:** Keep a permanently-mounted, visually-hidden `role="status"` line in the aside that announces short summaries (「已產生 3 項建議」/「正在產生建議」/「已套用 2 項」) and remove `aria-live` from the proposal container.

**🆕 [MEDIUM] A proposal with zero patches renders an empty review box with no explanation**  
`src/components/admin/AdminContentCopilot.tsx:546` · feedback-state

- **What happens:** When the model decides nothing needs changing (a normal outcome for 改善文案 or 核對事實 on already-good copy), the user waits 10+ seconds and gets: the heading 建議內容, an enabled-looking 全選 button, a 請先覆核 badge, an empty box, and a permanently greyed-out 套用已選建議. It is indistinguishable from a rendering bug, so staff burn another generation retrying. The panel also never states that the model returned patches for fewer fields than were selected — `proposal.selectedFields` is carried in state and never shown.
- **Fix:** Add an explicit empty state (「AI 認為所選欄位不需修改」) with 重新產生/捨棄, and list any selected fields that received no patch.

**🆕 [MEDIUM] Side-by-side diff collapses to ~170px columns of unhighlighted, untruncated text**  
`src/components/admin/AdminContentCopilot.tsx:569` · responsive

- **What happens:** For an article `content` patch this renders the entire old article and the entire new article as two narrow ribbons inside a 288px box, with no word-level highlighting of what actually changed. Reviewing 「請先覆核」 becomes eyeballing two walls of text through a letterbox, so staff realistically stop reviewing and just tick 全選 — defeating the opt-in design the 4-Aug pass introduced.
- **Fix:** Stack the panes (`grid-cols-1`) inside the narrow panel or use a container query; clamp long values with a 展開全文 toggle; and highlight the changed span rather than reprinting both versions whole.

**🆕 [MEDIUM] 套用已選建議 is disabled by default with no count and no reason**  
`src/components/admin/AdminContentCopilot.tsx:623` · form-ux

- **What happens:** After a 10-second wait the one obvious button is dead, with no helper text saying 「請先勾選要套用的建議」. On a long proposal (clipped at 288px per the ScrollArea finding) the user cannot even see whether anything is ticked. This is the cost side of the audit's accept-all-by-default fix, and it was shipped without the affordance that makes opt-in legible.
- **Fix:** Show 「已選 N／M 項」 next to 建議內容, label the button 套用已選建議（N）, and add helper text under it while `acceptedFields` is empty instead of leaving a silent disabled control.

**🆕 [LOW] Patches blocked by unsupported claims are unreachable by keyboard and the reason is not associated with the control**  
`src/components/admin/AdminContentCopilot.tsx:556` · a11y

- **What happens:** A disabled Radix checkbox is removed from the tab order, so a keyboard or screen-reader user tabbing the review list never lands on the blocked patch and is never told why it cannot be accepted — they simply find one fewer control than there are cards. Sighted users get the reason only in `text-destructive` at `text-xs`, i.e. by colour and size.
- **Fix:** Use `aria-disabled` + a no-op handler instead of `disabled` so it stays focusable, give the 未支援聲稱 paragraph an id and reference it from `aria-describedby`, and prefix the reason with an icon or the word 「無法套用」.

**🆕 [LOW] Confidence badge prints the raw English enum in a Chinese-only staff UI**  
`src/components/admin/AdminContentCopilot.tsx:564` · copy-i18n

- **What happens:** The single most decision-relevant signal on each patch card — how much the model trusts this suggestion — is untranslated next to fully Chinese field names, on a panel whose own comment (line 78-82) says staff here read Chinese only. A 醫 staff member cannot tell medium from low at a glance because both render as the same secondary badge.
- **Fix:** Add a `confidenceLabels` map (高／中／低 信心) alongside `fieldLabels`, and give low a visually distinct variant.

**🆕 [LOW] buildContentCopilotPartialUpdate is dead code, and it is the only patch-application logic the test suite covers**  
`src/components/admin/content-copilot-ui.ts:16` · code-quality

- **What happens:** AdminContentCopilot.test.tsx:58 («selected supported patches become a partial local update») asserts behaviour no user ever executes, giving false confidence that partial application is covered. The real review flow — generate → tick → apply → fail/undo — has zero test coverage; the only component test (:13) renders the unsaved state, and its `/<button[^>]*disabled[^>]*>[\s\S]*產生建議/` assertion is greedy enough to pass on any disabled button anywhere in the markup.
- **Fix:** Either wire `buildContentCopilotPartialUpdate` into `apply()` (which also fixes the full-snapshot overwrite finding) or delete it, and add tests for the review→apply→failure and review→apply→undo paths.

### CRM leads + Command Center

**🆕 [HIGH] Search box pushes a router navigation on every keystroke, so Back becomes unusable and Chinese IME input is dropped**  
`src/routes/admin.leads.tsx:527` · form-ux

- **What happens:** An agent typing 「陳大文」 into 搜尋客戶、電話、放盤 creates one history entry per keystroke, so browser Back no longer leaves the page — it walks backwards through the half-typed query one character at a time. Worse, the input is controlled by `filters.query` which now round-trips through an async router navigation: characters typed faster than the router commits are computed against a stale `filters` and lost, and an IME composition for Traditional Chinese (the primary input mode for this staff) is interrupted mid-word. The prior audit's P9 fix moved filters into the URL but did not distinguish a text field from a tab control.
- **Fix:** Keep `query` in local `useState` for typing and push it to the URL debounced (~300ms) with `replace: true`; keep the immediate-navigate behaviour only for the Select filters, and have `setFilters` read from the router's current search rather than the render-closure `filters`.

**🆕 [HIGH] Command Center fetches once on mount, never refreshes, and shows no data timestamp or row cap — while the server supplies both**  
`src/routes/admin.leads_.command-center.tsx:137` · data-integrity-ux

- **What happens:** This is the daily triage board: 今日要跟 and 逾期跟進 are time-derived (`now` on the server, admin-data.server.ts:1581). An agent who opens it at 09:00 and works from it all morning sees 09:00 data at 15:00 — leads that became overdue, new Live Agent handoffs and new WhatsApp replies never appear, and nothing on screen says how old the view is or offers a reload short of F5. Separately, on a book of more than 200 recently-updated leads the 未分配 tile reads e.g. 「12」 when the true figure is higher, with no cap notice anywhere (the CRM list page at least labels its cap).
- **Fix:** Render `generated_at` as 「最後更新 HH:mm」 next to a 重新整理 button in the toolbar, poll or refetch on window focus, and label the cap (「最近更新的 200 筆 Lead」) next to the KPI strip so the counts are read as a window, not a total.

**🆕 [MEDIUM] Unsaved lead edits are guarded against closing the sheet but not against leaving the page**  
`src/routes/admin.leads.tsx:368` · form-ux

- **What happens:** An agent edits 預算 / 負責代理 / 備註 in the lead sheet, then clicks a sidebar item (放盤, WhatsApp) or hits browser Back to a previous route, or reloads the tab. The route unmounts, the draft and any typed follow-up note are destroyed with no prompt — the exact failure the hook was written to prevent. Only Esc and the overlay are protected.
- **Fix:** Add `const { dialog: leaveDialog } = useRouteLeaveGuard(isLeadDetailDirty);` alongside the existing close guard and render `leaveDialog`, matching how the hook is documented to be used.

**🆕 [MEDIUM] 前往 Command Center is shown to agent-role staff who cannot load the page**  
`src/routes/admin.leads.tsx:622` · information-architecture

- **What happens:** An agent clicks the most prominent button on the CRM page and lands on a Command Center that renders only an error banner with a technical English message and no explanation that the board is manager-only — reading as a broken product rather than a permission boundary.
- **Fix:** Render the CTA disabled with a title naming the requirement (「需要經理權限」) for agent-role users, and give the Command Center route a role-aware empty state instead of a raw error banner.

**🆕 [MEDIUM] Filtered-empty state asserts no matching leads exist, when it only means 'none in the most-recently-updated 100'**  
`src/routes/admin.leads.tsx:642` · data-integrity-ux

- **What happens:** A manager filters 負責代理 = 陳先生 (or 階段 = 成交) and sees 「沒有符合條件的 Leads · 調整篩選條件再查看」. That agent may have 40 leads — they are simply outside the 100 most recently _updated_ rows. Staff reasonably conclude the leads were deleted or the assignment never saved, and there is no pagination, no 載入更多, and no server-side search to prove otherwise.
- **Fix:** When `rows.length >= LEAD_ROW_LIMIT`, append to the empty-state description 「目前只載入最近更新的 100 筆 Lead，較舊的 Lead 未包括在內」, and add server-side filtering (or a 載入更多) so the filters query the whole table rather than a client slice.

**🆕 [MEDIUM] 負責代理 filter exists but the table has no 負責代理 column, so assignment can be neither seen nor verified**  
`src/routes/admin.leads.tsx:661` · information-architecture

- **What happens:** A manager reassigning leads has to open each row's sheet to see who owns it; after saving a new 負責代理 the list refetches and looks identical, giving no confirmation the change landed. Filtering to 未指定代理 and assigning one lead makes it vanish from the filtered view with no other feedback — indistinguishable from an error.
- **Fix:** Add a 負責代理 column (and a 更新時間 column, since that is the sort key) to the table; both values are already present on `AdminLeadRow`.

**📌 [MEDIUM] No bulk workflow: reassigning or re-staging leads is one open→save→refetch cycle per lead**  
`src/routes/admin.leads.tsx:671` · information-architecture

- **What happens:** Reassigning a departing agent's 30 leads means 30 open→edit→save→close cycles, each blocking on a full list refetch and each re-sorting the list by `updated_at` so the operator's position is lost between rows.
- **Fix:** Still blocked on a real bulk server function, as the prior audit noted. The cheap interim win is to stop refetching the whole list on every single-lead save — patch the edited row in `rows` locally instead of `await refreshLeads()`.

**🆕 [MEDIUM] 標記成交 / 標記失敗 disable themselves based on the unsaved draft, so the lead looks already closed when it is not**  
`src/routes/admin.leads.tsx:701` · feedback-state

- **What happens:** An agent picks 成交 in the 階段 dropdown, then reaches for 標記成交 to commit it — the button is already greyed out, which reads as 'this lead is already 成交'. They close the panel; because the stage change was never saved the lead is still 商議中 on the server, and the pipeline/Command Center counts stay wrong.
- **Fix:** Gate on the persisted value (`detail.stage === "closed_won"`), not the draft, so the button stays actionable until the change is committed.

**🆕 [MEDIUM] 儲存 does not submit the typed follow-up note, but reports 「Lead 已更新」 as if everything was saved**  
`src/routes/admin.leads.tsx:707` · feedback-state

- **What happens:** An agent types a call summary into 新增內部跟進 note, clicks the primary 儲存 in the pinned footer, sees a success toast, and closes the panel — the follow-up is never written to the activity log and the call has no record. The two similarly-named fields (備註 vs 跟進 note) with two different save buttons make the mistake easy to repeat.
- **Fix:** Either have 儲存 also post a non-empty `noteBody` (reporting both results), or block the save with an inline warning 「跟進備註尚未新增，請先按『新增跟進』」 when `noteBody.trim()` is non-empty.

**🆕 [MEDIUM] 標記成交 / 標記失敗 show their progress on the 儲存 button instead of the button that was clicked**  
`src/routes/admin.leads.tsx:709` · feedback-state

- **What happens:** Staff click 標記成交 on a closing deal; that button greys out silently while a _different_ button two positions away changes to 儲存中…. On a slow connection this reads as 'my click did nothing but the save button is doing something', prompting a second click or a panel close mid-request. A screen-reader user gets no announcement that anything is in flight.
- **Fix:** Track the acting button (e.g. `mutatingAction` = `"stage:closed_won"`) and render the pending label + a spinner on the clicked control, with `aria-busy` on it.

**🆕 [MEDIUM] Only the lead's name text opens the row, while the whole row still styles itself as clickable**  
`src/routes/admin.leads.tsx:767` · a11y

- **What happens:** The row lights up on hover across its full width, so staff click the 意圖, 預算 or 階段 cell and nothing happens. On the tablets agents use, the only way in is a ~20px-tall line of text — well under the 44px target this codebase deliberately enforces elsewhere (`h-11 lg:h-9` on every toolbar control). For screen-reader users, a list where several contacts have no name produces a run of identical 「未命名, button」 controls with nothing to distinguish them and no hint that activating one opens a detail panel.
- **Fix:** Give the button `aria-label={`開啟 ${lead.name ?? lead.phone ?? "未命名 Lead"} 詳情`}` and block-level padding (`block w-full py-2` / `min-h-11`), or make the whole first cell the button's hit area and drop the row-wide hover highlight so the affordance matches what is actually clickable.

**🆕 [MEDIUM] Budget range accepts min > max and negative values with no validation**  
`src/routes/admin.leads.tsx:926` · form-ux

- **What happens:** An agent transposes the fields — 最低預算 8,000,000 / 最高預算 800,000 — and the save succeeds with a 「Lead 已更新」 toast. The row then renders 「$8,000,000 - $800,000」 (formatBudget, line 1290) and any downstream matching or 預算 segmentation silently returns nothing for that lead. A negative or 0 budget is equally accepted (0 is additionally swallowed by `formatBudget`'s truthiness checks and displays as 「—」).
- **Fix:** Validate `budget_min <= budget_max` and `>= 0` before submitting, render the message inline with `role="alert"` + `aria-invalid`/`aria-describedby` and focus the first invalid field — the pattern already used for the note field at lines 1098-1110.

**🆕 [MEDIUM] Raw English server error strings surface as toasts to Chinese-language staff**  
`src/routes/admin.leads.tsx:1366` · copy-i18n

- **What happens:** A lead reassigned or removed by a colleague while the panel is open makes 儲存 fail with a toast reading 「Not found」 — no Chinese, no cause, no next step for a non-technical CRM user. Same path renders in the page-level `AdminError` banner for list failures (line 638).
- **Fix:** Map known server codes to Chinese cause+fix text in `assertNoMutationError`/`errorText` (e.g. `Not found` → 「找不到此 Lead，可能已被其他同事修改，請重新整理」), keeping the raw string only in a `title` for support, as `admin.whatsapp.tsx`'s WOZTELL fix already does.

**🆕 [MEDIUM] Command Center prints raw database enum values (buyer / urgent / 30_days) in a Traditional-Chinese UI**  
`src/routes/admin.leads_.command-center.tsx:245` · copy-i18n

- **What happens:** The same lead reads 「買樓」 on /admin/leads and 「buyer」 on the Command Center; the detail panel shows 緊急度: urgent and 時間線: 30_days. Staff triaging in Chinese must translate schema identifiers, and the two screens look like they are describing different records.
- **Fix:** Export the existing label maps (`intentLabels`, `formatAiUrgency`, `formatAiTimeline`) to a shared module and apply them at lines 245, 328 and 329.

**📌 [MEDIUM] 開啟完整 Lead and 開啟 WhatsApp 對話 drop the lead id and dump the user on an unfiltered list**  
`src/routes/admin.leads_.command-center.tsx:291` · information-architecture

- **What happens:** An agent triaging a hot lead clicks 開啟完整 Lead and lands on the unfiltered 100-row CRM list with the panel closed — they must now find the lead by eye and, if it is outside the 100-row window, cannot. The WhatsApp link has the same problem against the conversation inbox.
- **Fix:** Pass `search={{ query: selected.phone ?? selected.name ?? "" }}` (and ideally a `lead` param that auto-opens the detail panel) to /admin/leads, and the conversation/contact id to /admin/whatsapp.

**🆕 [MEDIUM] 重新 AI 分析 gives no in-flight feedback beyond greying itself out, for a multi-second LLM call**  
`src/routes/admin.leads_.command-center.tsx:302` · feedback-state

- **What happens:** Staff click 重新 AI 分析, the button goes grey, and for several seconds the panel keeps showing 「未分析」 and the old score. With no progress cue they click elsewhere or close the panel; the toast 「已重新分析」 then fires against a panel they have already dismissed. Screen-reader users get no announcement between click and toast.
- **Fix:** Swap the label to 分析中… with a spinner and `aria-busy={busy}` while pending, and mark the AI 摘要 / AI 分數 region `aria-live="polite"` so the refreshed values are announced.

**📌 [MEDIUM] KPI tiles are undefined bare numbers, are not clickable to their queue, and shift the table when they pop in**  
`src/routes/admin.leads_.command-center.tsx:343` · information-architecture

- **What happens:** 「Hot leads 7」 tells an agent nothing they can act on — no definition, and clicking it does nothing, so they must guess which of the six queues contains those 7 leads (none of them does: 今日要跟 is a strict superset, 高分 uses a different rule). The strip mounting after load pushes the toolbar and table down ~90px, so a click aimed at a queue button lands on whatever moved into its place.
- **Fix:** Make each tile a button that sets the matching queue, name the rule in the tile ('AI 分數 ≥ 60' / '逾期未完成跟進'), align `kpis.hot` with the 今日要跟 predicate or rename it, put counts on the queue buttons, and reserve the strip's height with a skeleton while loading.

### Shell, dashboard, agents, and shared admin primitives

**🆕 [HIGH] AgentProfileForm — the audit's 'strong reference implementation' — has no unsaved-changes guard on a 17-field form**  
`src/components/admin/AgentProfileForm.tsx:169` · form-ux

- **What happens:** A manager writing a 2000-character agent bio clicks '經紀管理' in the always-visible sidebar, or the '返回' button at admin.agents\_.$id.tsx:59, or 登出 — the form unmounts instantly with no prompt and all typing is gone. Because the audit certifies this file, the gap is unlikely to be found by the next reader.
- **Fix:** Compute `isDirty` by comparing `form` against `createInitialForm(profile)` and call `useRouteLeaveGuard(isDirty)`, rendering its `dialog`. Suppress the guard on the success path (the `onSaved(result.id)` navigate at line 160) so a clean save does not trigger a false 'unsaved changes' prompt.

**📌 [MEDIUM] Two sidebar entries point at /admin/cms and neither label describes where it lands**  
`src/components/admin/AdminShell.tsx:34` · information-architecture

- **What happens:** 「CMS / FAQ」 opens the 屋苑 SEO tab, not FAQ; 「AI Agent」 opens the FAQ tab, not an agent tool — and it sits two rows above 經紀管理 (the real agent page), so staff looking for agent management click it first. On ?tab=articles|videos|media neither entry highlights, so the sidebar shows no active section at all.
- **Fix:** Owner decision, as the audit notes: admin.routes.test.mjs:66 asserts the two-entry shape. Relabel to 「內容管理」 / 「AI 知識庫（FAQ）」 and give the first `search: { tab: "estates" }` so both labels match their destination and articles/videos/media highlight the content entry.

**🆕 [MEDIUM] 登出 fires immediately with no confirmation, no pending state and no failure surface — on every one of the 15 admin pages**  
`src/components/admin/AdminShell.tsx:121` · destructive-safety

- **What happens:** A mis-click on a control adjacent to the nav ends the session with no 'are you sure', and because there is no dirty guard on any form (see the two findings above) any in-progress agent or listing edit dies with it. During the await the button stays fully enabled and looks unpressed, so staff click it again; if `signOut()` rejects or the network is down, nothing at all appears on screen and the user believes they are signed out when they are not.
- **Fix:** Wrap in `AdminConfirmDialog` (title 「確定登出？」), hold a `signingOut` state to disable the button and show `處理中…`, and `catch` into the dialog's `error` slot rather than swallowing.

**📌 [MEDIUM] Sign-in gate drops the requested admin path**  
`src/components/admin/AdminShell.tsx:150` · information-architecture

- **What happens:** A staff member opening a colleague's deep link to /admin/whatsapp or /admin/agents/:id while logged out signs in and is dropped on the public site, then has to re-navigate the admin sidebar by hand to find the record they were sent. Every shared admin link costs a manual re-navigation.
- **Fix:** As the audit states: add a `redirect` search param on /auth/$pathname plus the matching post-auth callback on AuthView (@neondatabase/auth-ui), then pass `search={{ redirect: router.state.location.href }}` here.

**🆕 [MEDIUM] AdminError renders raw exception text — the error surface for all 15 admin pages**  
`src/components/admin/AdminShell.tsx:243` · copy-i18n

- **What happens:** Whatever the server function throws — a Postgres error string, a `fetch failed`, an HTTP status, a stack-adjacent message — is printed in Chinese-language chrome to non-technical estate agents. They cannot tell a transient network blip from a permissions problem from a real outage, and there is no retry affordance and no support instruction attached.
- **Fix:** Give `AdminError` an optional `detail`/`onRetry`: show a Chinese cause+action line 「載入失敗，請重試或聯絡技術支援」 as the body, put the raw text in a `title` or a collapsed 技術資料 block, and render a 重試 button.

**🆕 [MEDIUM] 顯示排序 renders raw English zod errors inline in the Chinese staff form**  
`src/components/admin/AgentProfileForm.tsx:56` · copy-i18n

- **What happens:** This is verbatim the defect the audit fixed in PropertyForm ('typing 1200.5 into 實用面積 surfaced the raw "Expected integer, received float"') still present in the file the audit calls the reference implementation those fixes were ported from. A Chinese-speaking agent typing `1.5` or a negative sort order sees an untranslated English type error next to a Chinese label and cannot tell what to change.
- **Fix:** `z.union([z.literal(""), z.coerce.number({ invalid_type_error: "請輸入數字" }).int("請輸入整數").min(0, "請輸入 0 或以上").max(9999, "請輸入 9999 或以下")])`.

**🆕 [MEDIUM] 帳戶及存取 section is hidden entirely when the user lacks canManageIdentity, with no explanation**  
`src/components/admin/AgentProfileForm.tsx:313` · form-ux

- **What happens:** A branch manager opening an agent record simply does not see the account fields. There is no way to tell whether the agent has no linked account, whether the feature exists, or that a permission is missing — so they raise a ticket saying 'the account email field is broken/gone' instead of 'please grant me identity management'. This is the same P2 pattern the audit flags for admin.operations.tsx:231 ('Capability gaps hide features instead of explaining them'), unreported here.
- **Fix:** Render the section disabled with the reason named — 「需要「帳戶管理」權限才可編輯」 — and keep `buildAgentProfilePayload`'s existing omission of those keys as the actual enforcement.

**🆕 [MEDIUM] useRouteLeaveGuard has zero call sites — the page-leave/tab-close protection the audit shipped does nothing**  
`src/hooks/use-unsaved-changes-guard.tsx:31` · code-quality

- **What happens:** No admin page is protected against route navigation or tab close. A staff member half-way through the listing form or the agent form who clicks a sidebar item, presses browser Back, or closes the tab loses everything with no prompt — the exact scenario the hook's own doc comment (lines 10-13) says it was written to stop. The audit reads as though this is fixed for page-level navigation; it is not fixed anywhere.
- **Fix:** Either wire it into the forms that need it (`AgentProfileForm`, `PropertyForm`) — `const { dialog } = useRouteLeaveGuard(isDirty); ... {dialog}` — or delete it and correct the audit doc so the gap is not recorded as closed.

**🆕 [MEDIUM] 帳戶連結 column shows the profile email, not the actual Neon Auth link, so unlinked agents read as linked**  
`src/routes/admin.agents.tsx:104` · data-integrity-ux

- **What happens:** An agent row with `email = 'chan@earnest.hk'` but `auth_user_id = null` displays the email under 帳戶連結, so a manager auditing which agents can actually sign in concludes the account is connected when no Neon Auth user is attached. The only way to discover the truth is to open each of the ~23 rows individually. The fallback copy 「未連結電郵」 reinforces the wrong mental model — it describes a missing email, not a missing account link.
- **Fix:** Render link state from `auth_user_id`: show the email plus a 「已連結」/「未連結帳戶」 badge derived from `profile.auth_user_id`, or split into two columns (電郵 / 帳戶連結).

**🆕 [MEDIUM] A failed agent fetch is presented as '找不到代理資料或無權限編輯', with only a transient toast and no retry**  
`src/routes/admin.agents_.$id.tsx:46` · feedback-state

- **What happens:** A dropped connection or a 500 from `fetchAdminAgentProfile` puts an agent who exists behind a permanent 'record not found or you lack permission' panel. The toast that carried the real cause auto-dismisses in seconds, so anyone arriving from a bookmark or a slow tab sees only the wrong explanation, has no retry button, and reasonably reports that the agent record was deleted or that their permissions were revoked.
- **Fix:** Add `const [loadError, setLoadError] = useState<string|null>(null)`, set it in the catch, and render `<AdminError>` with a 重試 button for that case — reserving the 'not found / no permission' copy for a genuine `null` result.

**🆕 [MEDIUM] 總覽 has two metric tiles pointing at /admin/leads, one of which counts something that page does not show**  
`src/routes/admin.index.tsx:46` · information-architecture

- **What happens:** Staff click 聯絡人 showing e.g. 4,812 and land on a lead table showing 「顯示 87 筆（最近 100 筆內）」 — three unrelated numbers with no path from the tile to the thing it counted. There is no contacts view to reach, so the tile is a dead end that reads like a broken filter, and the duplicate destination makes the 5-tile row look like it has a copy-paste bug.
- **Fix:** Point 聯絡人 at a contacts view (or /admin/segments) if one exists; otherwise make it a non-link stat and add a tooltip stating what 聯絡人 counts versus 跟進中 leads.

**📌 [MEDIUM] 總覽's lower card section has no heading**  
`src/routes/admin.index.tsx:62` · a11y

- **What happens:** A screen-reader user navigating the landing page by heading (H key) or via the rotor finds one entry and cannot jump to 今日優先 or Woztell 狀態; the unlabelled `<section>` also appears as an anonymous region in landmark navigation. The `as` prop that fixes this already exists and is used by admin.cms.tsx's five tab panels.
- **Fix:** `<CardTitle as="h2" className="text-base">` on lines 65 and 75, and give the `<section>` an `aria-labelledby` or convert it to a plain `<div>`.

**🆕 [MEDIUM] 總覽 'Woztell 狀態' card is static prose that reads as live status and exposes a raw env-var name to non-technical staff**  
`src/routes/admin.index.tsx:75` · data-integrity-ux

- **What happens:** A card headed 狀態 tells staff nothing about the actual state — WhatsApp sending can be fully live or fully down and this card is byte-identical. Someone checking 'is sending on?' before a blast gets a false answer. The body also shows `WOZTELL_ENABLED`, `token`, `channel secret` and `campaign draft` — English identifiers and jargon in a Traditional-Chinese staff UI, unactionable for the audience.
- **Fix:** Read the same status the whatsapp page now reads and render 「WhatsApp 發送：正常／暫停（請聯絡技術支援）」, keeping `WOZTELL_ENABLED` in a `title` attribute for support only. If no status source is available here, retitle the card 「WhatsApp 設定說明」 so it stops claiming to be a status.

**🆕 [LOW] AdminShell's auth-loading state replaces the entire shell, causing a full-page reflow on every admin page load and announcing nothing**  
`src/components/admin/AdminShell.tsx:126` · performance-ux

- **What happens:** On every hard load or refresh of any of the 15 admin pages, staff see two grey bars in a full-width single column, which then snap into a two-column 240px-sidebar layout — every element on the page moves horizontally and vertically. The skeleton also has no `role="status"`/`aria-busy`/`aria-live`, so a screen-reader user hears silence between navigation and content and has no way to know the page is still loading.
- **Fix:** Render the real shell chrome (sidebar column, header) during `loading` with skeletons only inside the content column, and put `role="status" aria-live="polite"` with an sr-only 「載入中」 on the placeholder.

**🆕 [LOW] AgentProfileForm marks no field as required; the name rule is undiscoverable until submit**  
`src/components/admin/AgentProfileForm.tsx:171` · form-ux

- **What happens:** A user filling only 職銜, 電話 and 個人簡介 gets no signal that anything is missing until they press 建立代理, at which point a Chinese error lands specifically on 中文名稱 even though filling 英文名稱 alone would also have been accepted — the message 「請輸入中文或英文名稱」 appears under one field while describing a choice between two, so users retype the same field and resubmit.
- **Fix:** Mark 中文名稱 and 英文名稱 as a required pair (「中文名稱／英文名稱（必填其一）」 with `aria-required`), and attach the superRefine issue to a group description rendered between the two fields rather than to `name_zh` alone.

**🆕 [LOW] 新增代理 is pinned to 36px at all widths — the only admin control left out of the tap-target fix**  
`src/routes/admin.agents.tsx:49` · responsive

- **What happens:** On the tablets agents actually use (the audit's stated reason for the 44px base), the primary 新增代理 action is a 36px target, below the WCAG 2.5.8 / platform minimum, sitting in a toolbar next to nothing else — a mis-tap trap on the one action the page exists for.
- **Fix:** Change to `className="h-11 lg:h-9"` to match admin.leads.tsx:622.

**🆕 [LOW] 總覽 metric fetch has no cancellation guard and no retry path once it fails**  
`src/routes/admin.index.tsx:25` · feedback-state

- **What happens:** Navigating away before the overview resolves calls `setData` on an unmounted component; if the `user` object identity changes mid-flight, a slow earlier response can overwrite a newer one, showing stale counts as fresh. More visibly: once `error` is set it is never cleared and `data` stays `null`, so the metric row is permanently blank and the only recovery from a transient blip is a manual browser reload — no 重試 control exists anywhere on the page.
- **Fix:** Copy the `cancelled` pattern from admin.agents.tsx:36-40, and give the error branch a 重試 button that clears `error` and re-invokes `fetchAdminOverview()`.

**📌 [LOW] 總覽 metric-row skeleton is h-64 for a ~90px row, jumping the page ~170px when data lands**  
`src/routes/admin.index.tsx:36` · performance-ux

- **What happens:** On the first page every admin sees after signing in, the 今日優先 and Woztell cards below (line 62) sit ~170px too low, then snap upward the instant the overview resolves — mis-clicks on anything below the fold, and at sm/xl breakpoints the mismatch differs again because the row is 2-up vs 5-up.
- **Fix:** Replace with five card-shaped skeletons in the same grid: `<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-[88px] w-full" />)}</div>`.

---

## Refuted on inspection — do not re-raise

These were raised by an auditor and then knocked down by an independent verifier that opened
the file. Recorded so the next reader does not spend time on them.

- **`src/routes/admin.cms.tsx:593`** — 重建索引 button falsely reads 重建中… whenever the status is merely being re-read  
  _Refuted by the source. L593 is `{knowledgeLoading ? (knowledgeStatus ? "重建中…" : "載入中…") : "重建索引"}` — the nested `knowledgeStatus` check is exactly the guard the finding claims is absent. knowledgeStatus/knowledgeError are written only in refreshKnowledgeStatus (L225-239): success sets status=value + error=null; failure sets status=null + error=msg. Therefore knowledgeError !== null implies knowled…_
- **`src/routes/admin.cms.tsx:1624`** — 發布 Switch is wrapped in a `<label>` that can never associate with it  
  _REFUTED — the code matches the description but the defect does not exist. The claim's load-bearing premise, "Radix Switch renders a `<button role=\"switch\">`, which is not a labelable element", is false: per the HTML Living Standard the labelable elements are button, input (type != hidden), meter, output, progress, select, textarea — `button` IS labelable. I confirmed from the installed @radix-ui…_
- **`src/routes/admin.blasts.tsx:519`** — The irreversible send action is labelled "Queue" in English on a Traditional-Chinese staff page  
  _The line number is right and `<Send />Queue` does render at admin.blasts.tsx:518-519 (dialog copy at :752, `<Eye />Preview` at :507-508). But the defect as described is refuted by the file. The claim rests on "Everything around them is Chinese" and "The one English word on the row is the one with irreversible consequences" — both false. The controls immediately beside Queue are also English: `Prev…_
- **`src/routes/admin.whatsapp.tsx:754`** — The local Field component wraps a Radix trigger in a bare <label> with no htmlFor — the same defect the audit fixed in PropertyForm  
  _The code at src/routes/admin.whatsapp.tsx:752-759 matches the quote, but the defect's stated mechanism is false. The claim asserts "a <button> is not a labelable element, so implicit association does not apply" — per the HTML Living Standard, `button` IS a labelable element (button, input, meter, output, progress, select, textarea), and node_modules/@radix-ui/react-select/dist/index.mjs:170-172 co…_
- **`src/routes/admin.whatsapp.tsx:481`** — Both empty states are dead ends with no next action  
  _The literal code observation is accurate — AdminEmptyState.tsx:6,10 declares `action?: ReactNode` as optional, and both admin.whatsapp.tsx call sites (:481-484 and :577-580) omit it, exactly as quoted. But the defect as characterized is refuted by the surrounding code. (1) "the page offers nothing to do — not even 重新整理" is false: a persistent 重新整理 refresh button is rendered unconditionally in the …_
- **`src/routes/admin.listings.tsx:77`** — Listings page renders a completely blank body while the session is pending or when the user is signed out  
  \_REFUTED — the code at line 77 is quoted accurately (`const { user } = useNeonAuth();` discards `loading`, and `refreshListings` early-returns `if (!user)` at :88 without touching `loadingRows`), but the claimed user impact cannot occur because the parent wrapper already handles both states.

`AdminListings` returns `<AdminShell …>` (src/routes/admin.listings.tsx:143) wrapping ALL of its content — …\_

- **`src/components/dashboard/PropertyForm.tsx:355`** — 售價 and 月租 are both always editable with no cross-field rule, breaking the invariant the public property page depends on  
  _The mechanical code claims are accurate but the defect they are said to cause does not exist. Confirmed true: 售價 (PropertyForm.tsx:355-364) and 月租 (:365-374) render unconditionally, the schema makes both plain optionalNumber (:67-68) with no deal_type refinement, the payload sends both raw (:205-206), and admin-data.server.ts:450-527 persists both into SQL with no normalization. REFUTED: the claim…_
- **`src/components/admin/operations/AdminOperationsJobs.tsx:206`** — Jobs and Audit panels have no heading, so the tab content has no accessible name in the document outline  
  _Line 206 is accurately quoted — AdminOperationsJobs.tsx roots at a bare `<div className="space-y-4">` with no `<h2>` in the file, and AdminOperationsAudit.tsx:217 matches, while Migrations (line 171) and Overview (82/84, 118/119, 160/166, 203/204) do render headings. But the defect AS DESCRIBED is refuted by the Radix primitive. Both panels are rendered inside `<Tabs.Content>` from @radix-ui/react…_
- **`src/components/admin/AdminShell.tsx:111`** — AdminShell's breadcrumb prop has no callers — including the two agent sub-pages it was added for  
  _The code facts check out but the defect framing does not survive contact with the rest of the file. Confirmed at /home/user/earnestproperty/src/components/admin/AdminShell.tsx:111: `breadcrumb?: React.ReactNode;` with the exact quoted comment on :110, destructured at :104, and rendered at :221-223. `grep -rn "breadcrumb" src/` returns hits only inside AdminShell.tsx itself and unrelated public-rou…_
- **`src/components/admin/AgentProfileForm.tsx:433`** — ToggleField derives its DOM id by string-matching the visible label  
  _The code is exactly as quoted — /home/user/earnestproperty/src/components/admin/AgentProfileForm.tsx:433 reads `const id = label === "顯示於網站" ? "show_on_website" : "active";`, and that `id` feeds both `<Label htmlFor={id}>` (:437) and `<Switch id={id} ...>` (:440); the two call sites are at :339-345 (帳戶啟用) and :361-367 (顯示於網站). Nothing mitigates it: ui/switch.tsx is a thin Radix Root wrapper that f…_
- **`src/components/admin/AdminShell.tsx:39`** — Five of eleven sidebar entries are English-only labels in a Traditional-Chinese staff UI  
  _Line 39 is verbatim correct — `{ to: "/admin/leads/command-center", label: "Command Center", icon: Gauge }` — as are the other cited labels (34 "CMS / FAQ", 35 "AI Agent", 41 "Segments", 42 "WhatsApp") in an 11-entry navItems array, and \_\_root.tsx:81 does set lang="zh-HK". But this is a copy/consistency preference, not a defect. (1) No i18n layer exists anywhere in src/ — there is no translation s…_

Also re-confirmed as already correct (from the 3 Aug list, spot-checked this pass): the
listings table's own `overflow-x-auto` scroll container, listing status/type badges pairing
colour with text, `--muted-foreground` clearing 4.5:1 in both themes, `aria-current` on the
selected WhatsApp conversation, and the global `prefers-reduced-motion` block in `src/styles.css`.
