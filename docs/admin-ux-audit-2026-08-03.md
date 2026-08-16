# Admin panel UI/UX audit — 3 Aug 2026

Audit of `/admin` and all 15 subpages against the `ui-ux-pro-max` priority rules
(P1 accessibility → P10 charts). Six parallel auditors read every admin route and
component in full; ~118 findings were verified against the source.

The admin area is auth-gated, so this was a source audit, not a live click-through.
Priorities below are the skill's: **P1/P2 are CRITICAL**, P3/P5/P9 HIGH, P6/P7/P8 MEDIUM.

---

## Fixed in this pass

Chosen for leverage — the shell items land on all 15 pages at once.

**`AdminShell.tsx` (shared by every admin page)**

- Nav links had no focus ring at all — keyboard users saw nothing across 11 items.
  Added `focus-visible:ring-2`.
- Active nav item was signalled by colour alone with no `aria-current`. Added
  `aria-current="page"`, `font-semibold`, and a left indicator bar so "you are here"
  survives greyscale and screen readers.
- `<nav>` was unlabelled while the public `SiteHeader` also renders on `/admin`, so a
  screen reader heard two indistinguishable navigation regions. Added `aria-label="後台選單"`.
- **No mobile nav at all below `lg`** — the 11-item sidebar stacked above every page,
  pushing actual content ~600px down on any phone or tablet visit. Now a `Sheet` drawer.
- Sticky sidebar used `lg:top-4` while `SiteHeader` is `sticky top-0 h-16`, so the
  identity block and first nav item slid under the header once scrolled; and
  `lg:h-[calc(100vh-2rem)]` with no `overflow-y-auto` made the last nav items and 登出
  unreachable on short laptop viewports. Now `lg:top-20` + `overflow-y-auto`.
- Two `<main>` landmarks (root layout + AdminShell) — invalid, breaks landmark nav.
  AdminShell's is now a `<div>`.
- Section highlighting broke on every detail page (`/admin/listings/123`,
  `/admin/agents/new`) because all entries used `exact: true`. Listings and agents now
  prefix-match via an `activeExact: false` flag; `/admin` and `/admin/leads` stay exact
  so they don't bleed into child routes or the Command Center entry.
- Every page rendered the same hard-coded 管理放盤 CTA, duplicating the sidebar's 放盤
  entry and irrelevant on CRM/WhatsApp/群發. Replaced with an optional `actions` prop.
- Added an optional `breadcrumb` prop so sub-pages can show 後台 › 放盤 › 編輯 context.
- `AdminError` — the error surface for **every** admin page — was a plain `<div>` with no
  `role="alert"`, so failed loads and saves were silent to screen readers. (Flagged
  independently by 4 of 6 auditors.)

**`AdminDetailPanel.tsx`** — `overflow-y-auto` sat on the whole flex column, so the
footer's 儲存 / 標記成交 buttons scrolled away with the content; on a lead with a long AI
section the save controls were unreachable. Scroll container moved to the children
wrapper; footer now pinned.

**`AdminConfirmDialog.tsx`** — async confirm showed only a text swap with no spinner, and
`onOpenChange` blocked dismissal whenever `disabled` was set (not just while pending), so
a hung or failed request could lock staff in a modal with no feedback and no escape. Added
a spinner + `aria-busy`, an in-dialog `error` slot with `role="alert"`, and narrowed the
dismissal block to `isPending` only.

**`PropertyForm.tsx` + `ImageUploader.tsx`** (the core daily listing form)

- **Not one input was associated with its label** — `Field` rendered `<Label>` with no
  `htmlFor` and no control had an `id`, so clicking a label didn't focus its field and a
  screen reader announced ~20 unlabelled controls. All 21 fields + 4 `SelectTrigger`s +
  the 精選 `Switch` now have matched ids (verified: 22 resolving `label[for]` in rendered
  markup).
- A failed submit showed one `toast.error` with no field name, no inline error, and no
  scroll/focus — on a 20-field form the error was off-screen and the form looked broken.
  Now builds a `fieldErrors` map, renders errors inline with `role="alert"` +
  `aria-invalid`/`aria-describedby`, and focuses the first invalid control.
- Only ~4 of ~20 zod rules had Traditional-Chinese messages, so typing `1200.5` into
  實用面積 surfaced the raw `"Expected integer, received float"`. All rules now have
  Chinese messages.
- Photo delete button was `opacity-0 group-hover:opacity-100` — invisible until mouse
  hover, no focus style, and **unusable on touch entirely**. Now visible at rest with a
  focus ring.
- Photo order (which decides the public cover image) was mouse-drag-only, with the grip a
  non-focusable `<span>`. Added labelled 上移/下移 buttons; drag kept as enhancement.

**Tap targets** — admin toolbars and row actions overrode the design system's deliberate
44px base (`button.tsx` sets even `size.sm` to `h-11`) down to 32–36px via `h-8`/`h-9`, a
mis-tap trap on the tablets agents actually use. 22 interactive controls across
`admin.leads`, `admin.listings`, `admin.whatsapp`, `admin.leads_.command-center` now use
`h-11 lg:h-9` — 44px through tablet widths, compacting only at ≥1024px. Badges left
non-interactive but height-matched for row alignment.

**Two honesty fixes**

- `admin.whatsapp.tsx` showed `WOZTELL_ENABLED: false` to non-technical staff — neither
  what was wrong nor what to do. Now 「WhatsApp 發送：暫停（請聯絡技術支援）」, with the
  variable name kept in `title` for support.
- `admin.leads.tsx` rendered `{filteredRows.length} Leads`, which read as a total but is a
  client-side filter over a silent server `LIMIT 100` — filtering by 成交 quietly hid every
  older lead and looked like data loss. Now 「顯示 N 筆（最近 100 筆內）」.

---

## Fixed in the follow-up pass (4 Aug 2026)

**Shared foundation:** `src/hooks/use-unsaved-changes-guard.tsx` (new) — `useRouteLeaveGuard`
wraps TanStack Router's `useBlocker` for full page/tab-close navigation, `useDirtyCloseGuard`
is the local-state equivalent for dialogs and sheets. Both render an `AdminConfirmDialog` and
return a `requestClose()` to swap in for a raw `onClose`.

- **P8 Unsaved work destroyed silently — fixed for the admin.cms.tsx and admin.leads.tsx
  surfaces.** All five CMS editor dialogs (estate/article/FAQ/video/media) and their Cancel
  buttons now route through `useDirtyCloseGuard`, comparing the editing object's shape at
  open time against its current value. The lead detail panel does the same, comparing
  `draft` against `leadToDraft(detail)` plus a non-empty `noteBody`. **Still open:**
  `PropertyForm.tsx` (the listing form) has no guard yet — not touched this pass.
- **P1/P2 Command Center keyboard-unreachable rows — fixed.** Row click moved into a real
  focusable `<button>` in the Lead cell (native `<tr>` restored); the active-queue segmented
  control now has `aria-pressed` plus a check-icon cue, not colour alone.
- **P9 Filter/search state lost on navigation — fixed for `/admin/leads` and Command
  Center.** Both now use `validateSearch` + `Route.useSearch()`/`useNavigate()`, mirroring
  the working pattern already in `admin.operations.tsx`/`admin.cms.tsx`. **Still open:**
  `admin.listings.tsx`, `admin.whatsapp.tsx`, and lead-detail/conversation deep-linking —
  none of those files were touched this pass.
- **P8 Destructive actions — FAQ delete, FAQ import confirm, and lead stage-change confirm
  all fixed.** `deleteAdminFaq` (already existed, was never imported) is now a per-row 刪除
  action behind `AdminConfirmDialog`. FAQ bulk import now requires an explicit confirm
  showing the overwrite count plus a new/overwrite preview table before writing, and reports
  `已匯入 X／N，第 N+1 條失敗：…` on a mid-loop failure instead of a bare error (this closes
  out a dead-code gap found during review: an earlier partial fix left
  `handleImportFaqsSubmit`/`faqImportConfirmOpen` defined but never wired to the dialog's
  `onSubmit`, so submitting still imported immediately with no confirm at all).
  標記失敗/標記成交 now confirm first when there are other unsaved field edits, since both
  submit the whole draft (server type `AdminLeadUpdateInput` has no partial-update path, so
  the fix is an honest confirmation rather than a `{id, stage}`-only payload). **Still open:**
  `admin.listings.tsx`'s 下架/已售/已租 buttons — not touched this pass.
- **P8 AI copilot accept-all-by-default — fixed.** `acceptedFields` now starts empty
  (opt-in); patch cards show current vs proposed side by side; a 捨棄建議/重新產生 action
  exists so a disliked proposal no longer forces closing (and losing) the draft; error codes
  map to Chinese cause+fix text.
- **P3 admin.cms.tsx row cap — fixed.** Search/filter added to all five tabs (was
  estates-only), plus a scope filter on FAQs. **Still open:** `admin.listings.tsx` (80 of
  ~398 listings, no keyword box) and `admin.segments.tsx` — not touched this pass.
- **P1 Headings — fixed.** `CardTitle` accepts an `as` prop; every CMS tab panel now renders
  as `<h2>` (existing call sites are unaffected, `as` defaults to `div`).
- **P1 `admin.leads.tsx:644` role="button" on `<tr>` — fixed**, same pattern as Command
  Center above.
- **P6 Numeric/truncated cells in admin.leads.tsx and command-center.tsx — fixed**
  (`tabular-nums` on budget/score cells, `title` on truncated property/reason text, 下一步
  and WhatsApp status columns promoted off `text-xs`). **Still open:** `admin.listings.tsx`,
  `AdminOperationsJobs.tsx`.
- **P8/P10 smaller items — fixed:** `admin.cms.tsx` article body now has a 預覽 toggle and
  helper text about the blank-line-separator format; 發布時間 is `type="datetime-local"`;
  a failed knowledge-status fetch now renders a distinct 「狀態未知」 state instead of
  collapsing into 「AI 未啟用」; jargon metrics renamed to Chinese; 意圖 is now a select over
  the same label set the filter dropdown uses, instead of free text that could drift from
  it; Command Center's AI panel now derives from live data (`useMemo` over `data.rows`), so
  重新 AI 分析 actually updates what's on screen; the filtered-empty state has a 清除篩選
  action. **Still open:** KPI strip polish (Command Center), bulk workflow (`admin.leads.tsx`).
- A `prefers-reduced-motion` block was added to `src/styles.css` (there was none anywhere in
  the repo) — global, so it also covers the `animate-spin` polling churn noted below.

Also fixed in passing: a null-deref (`rows.length` where `rows: AdminLeadRow[] | null`)
introduced by the previous pass's own leads-badge fix.

---

## Open — highest value first

### P8 · Blast sending is one unconfirmed click

`admin.blasts.tsx:513` (and the dialog's Queue at :750) calls `sendAdminCampaignQueue`
immediately — no confirmation, on a page that sends real WhatsApp messages to real
customers. Compounding:

- No dry-run of the rendered message; `AdminBlastOptions.templates` carries no body field,
  so staff queue thousands of messages having never seen the text (:660).
- The recipient count next to Queue can be arbitrarily stale — the toolbar Refresh
  (:407) updates rows but not `rowPreviews`, so Preview (5 eligible) → Refresh → Queue can
  fire against a different audience (:458).
- `queueableStatuses` includes `"draft"` (:72), contradicting the page's own
  「審核後排程發送」 promise — the `review` state is decorative.
- No partial-failure reporting: 800 of 1000 messages failing looks identical to a clean
  send (:471).
- The irreversible action is labelled "Queue" in English next to "Preview" (:519).

### P1/P2 · Command Center triage queue is keyboard-unreachable

`admin.leads_.command-center.tsx:190` — rows are `<tr onClick={...}>` with no role,
tabIndex, key handler or focus style. `admin.leads.tsx:644` already has the correct
pattern to copy. Also `:144` signals the active queue by colour alone with no
`aria-pressed`.

### P9 · Filter/search state is lost on every navigation

`admin.leads.tsx:130`, `admin.listings.tsx:81`, `admin.whatsapp.tsx:83` keep filters in
`useState` with no `validateSearch`, so reload or back-from-a-record resets the working
view and scroll position, and no filtered view is shareable. `admin.operations.tsx:57` and
`admin.cms.tsx:138` already do this correctly with `validateSearch`. Lead detail and
conversations are likewise not deep-linkable, which is why Command Center's
「開啟完整 Lead」 and 「開啟 WhatsApp 對話」 drop the id and dump the user on an unfiltered list.

### P8 · Destructive actions with no confirm and no undo

- `admin.listings.tsx:360` — 下架 and 已售/已租 fire on one click on 32px buttons adjacent
  to 編輯. (`admin.leads.tsx`'s 標記失敗/標記成交 and `admin.cms.tsx`'s FAQ delete/import are
  now fixed — see the follow-up pass above.)

### P3 · Silent row caps presented as complete data

- `admin.listings.tsx:94` shows at most 80 of ~398 listings with no pagination, no count,
  no notice. There is also **no keyword search box**, though the server already supports
  `q` end to end.
- `admin.segments.tsx:385` — `preview.contacts.slice(0, 20)` renders 20 rows under a header
  saying "Top 200" and a summary saying `eligible/total`: three different numbers, no
  indication rows were dropped. (`admin.cms.tsx` is now search/filterable on all five tabs —
  see the follow-up pass above.)

### P3 · Operations polling fights the operator

- `admin.operations.tsx:92` — every 30s tick sets `jobsSummary`/`migrations` to `null`
  before refetching, so sections unmount and remount: guaranteed flash and layout shift
  mid-read.
- `AdminOperationsJobs.tsx:156` — the tick refetches page 1 only, so an operator who
  clicked "Load more" to 100 rows silently loses 75 of them every 30 seconds.
- `:211` — filter inputs are `disabled={loading}`, which includes background ticks, so
  typing is interrupted mid-word.

### P8 · Migration apply is under-specified and gives no in-flight feedback

- `AdminOperationsMigrations.tsx:132` — `runApply` calls `setPlan(null)` _before_ awaiting,
  and the dialog requires `plan !== null`, so the dialog vanishes the instant Apply is
  clicked and an irreversible schema change runs with zero feedback. The dialog's own
  `isPending` state is dead code.
- `:282` — the confirm shows only `migrationId`; the fetched `summary`, `checksum`,
  `dependencies` and `schemaFingerprint` are never displayed.
- `:272` — an operator with plan-but-not-apply permission hits a silent dead end: Plan
  succeeds, then nothing appears and no reason is given.
- `:138` — after an irreversible change the only report is a generic
  `toast.success("Migration applied.")`, with no postcondition verification.

### P2 · Capability gaps hide features instead of explaining them

`admin.operations.tsx:231` omits tabs the user lacks (making the "becomes available when
its capability is granted" fallback unreachable dead code); Retry/Cancel buttons vanish
entirely without permission. Render them disabled with the required permission named.

### P1 · Headings and landmarks

`CardTitle` renders a plain `<div>` (`card.tsx:23`) — now takes an optional `as` prop and
`admin.cms.tsx`'s five tab panels use it (see follow-up pass above). **Still open:**
`admin.index.tsx:62`, `AdminOperationsJobs.tsx:206`, `AdminOperationsAudit.tsx:217` have no
heading at all while Migrations has an `<h2>` — none of the operations files were touched.

### P1 · Misc accessibility

- `admin.cms.tsx:689` — the 上載 FAQ 檔案 control is a `<Button asChild><label>`, so Tab
  lands on the clipped `sr-only` input and the focus ring never fires.
- `admin.whatsapp.tsx:731` — `text-xs opacity-80` white-on-primary composites to ~4.05:1,
  under the 4.5:1 floor, and this is exactly where send status lives.
- `admin.operations.tsx:166` — a `failed` control plane renders neutral grey in the header
  badge while the Overview renders the same status `destructive`.
- `admin.operations.tsx:165` — `aria-live="polite"` wraps a timestamp, so screen readers
  re-announce the region every 30s even when nothing changed.

(`admin.leads.tsx:644`'s `role="button"` on `<tr>` is fixed, and a `prefers-reduced-motion`
block now exists globally in `src/styles.css` — both covered in the follow-up pass above.)

### P8 · Failed WhatsApp sends are near-invisible and can't be retried

`admin.whatsapp.tsx:722` — `statusClass` for a failed message is `font-semibold` and
nothing else: same size, opacity and bubble colour as a success, no icon, no retry
control. Also `:703` the conversation pane never scrolls to the newest message, `:105`
the inbox never auto-refreshes and shows no "last updated" (so agents silently burn the
24-hour reply window), and `:644` the reply box has no `maxLength` or counter.

### P6 · Numeric columns and truncation

No `tabular-nums` on `admin.listings.tsx:334` or `AdminOperationsJobs.tsx:295`; truncated
cells lack `title` on `admin.cms.tsx:497`. (`admin.leads.tsx` and `admin.leads_.command-
center.tsx` are fixed — see the follow-up pass above.)

### P9 · Two nav entries, one route

`AdminShell.tsx:25-26` points both 「CMS / FAQ」 (`tab: undefined`) and 「AI Agent」
(`tab: "faqs"`) at `/admin/cms`. 「CMS / FAQ」 actually lands on the 屋苑 SEO tab and
「AI Agent」 lands on the FAQ tab, so neither label describes what it opens; on
`?tab=articles|videos|media` **neither** entry highlights. Left as-is because
`admin.routes.test.mjs:66` ("CMS and AI Agent sidebar entries keep independent active
states") asserts this exact two-entry shape — it encodes a deliberate decision, so
changing the labels or merging the entries is the owner's call, not a silent fix.

### P9 · Sign-in loses the requested page

`AdminShell.tsx` links to `/auth/$pathname` with no return destination, so a deep link to
`/admin/whatsapp` sends staff to sign-in and then to the public site. Needs a `redirect`
search param on the auth route plus the matching post-auth callback on `AuthView`
(`@neondatabase/auth-ui`) — not attempted here rather than ship a param nothing honours.

### P8/P10 · Smaller items

- `admin.leads_.command-center.tsx:289` — KPI tiles are undefined bare numbers
  ("Hot leads" never says what qualifies) that aren't clickable to their matching queue,
  and they pop in after load, shifting the table.
- `admin.leads.tsx:573` — no bulk workflow: reassigning 30 leads is 30 open→save cycles,
  each serially refetching the whole list. Deliberately not attempted without a real bulk
  server function — a client-side loop calling the single-lead update N times would just
  move the serial-refetch problem around, not fix it.
- `admin.index.tsx:36` — a single `h-64` skeleton stands in for a ~90px metric row, so the
  page jumps ~170px when data arrives.
- `AdminEmptyState` accepts an `action` prop that some callers still omit (e.g.
  `admin.whatsapp.tsx`, `admin.segments.tsx` — not touched this pass), leaving dead-end
  「沒有資料」 panels with no next step. `admin.leads.tsx`'s is now fixed.

(Article preview toggle, `datetime-local` 發布時間, the swallowed knowledge-status fetch,
jargon metrics, 意圖 free-text, and Command Center's stale-snapshot panel are all fixed —
see the follow-up pass above.)

---

## Verified as already correct

Worth not re-flagging: the listings table already scrolls in its own container
(`overflow-x-auto` + `min-w-[920px]`) with no page overflow; listing status/type badges
already pair colour with a text label; `--muted-foreground` passes 4.5:1 in both themes
(5.12:1 light, 6.64:1 dark); `admin.whatsapp.tsx` already sets `aria-current` on the
selected conversation. `AgentProfileForm.tsx` is the strong reference implementation in
this codebase — inline field errors, `role="alert"`, `htmlFor`, focus-to-first-invalid —
and most form fixes above are a port of it.
