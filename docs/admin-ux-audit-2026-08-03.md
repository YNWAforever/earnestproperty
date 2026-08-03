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

## Open — highest value first

### P8 · Unsaved work is destroyed silently (no guard anywhere in the repo)

`grep -rn "useBlocker\|beforeunload" src` returns **zero hits**. Three separate places lose
staff work with no warning:

- `admin.cms.tsx:1147` (and :941, :1017, :1263, :1336, :1386) — every editor dialog is
  `onOpenChange={(open) => (!open ? onClose() : undefined)}`, so one stray click on the dim
  overlay or an Esc wipes a long article body. No confirm, no autosave.
- `PropertyForm.tsx:169` — a half-filled 20-field listing dies on any sidebar click, the
  返回 button, or browser back.
- `admin.leads.tsx:297` — `handlePanelOpenChange(false)` unconditionally clears `draft`,
  `noteBody` and `detail`, discarding typed edits and an unwritten follow-up note.

Fix: TanStack Router `useBlocker` + `beforeunload` gated on a dirty flag, surfaced through
the existing `AdminConfirmDialog`; ideally a `localStorage` draft keyed by record id.

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
  to 編輯.
- `admin.leads.tsx:591` — 標記失敗/標記成交 also silently commit every unsaved panel edit,
  because they submit `{ ...draft, stage }` under a label that reads as a one-field action.
- `admin.cms.tsx:751` — **nothing on the CMS page can be deleted at all**, so a wrongly
  imported FAQ is stuck in the public AI agent's knowledge base forever. `deleteAdminFaq`
  exists and is tested but never imported.
- `admin.cms.tsx:316` — FAQ bulk import silently overwrites answers
  (`ON CONFLICT DO UPDATE`) with no preview, no confirm, no undo, and a mid-loop failure
  leaves a half-written database with no count of what landed.

### P8 · AI copilot defaults to accepting all rewrites

`AdminContentCopilot.tsx:174` pre-checks every patch on arrival, so the default gesture is
"replace all my copy". `:443` shows only the proposed text, never the current value, so
staff can't see what it overwrites; after 套用 the AI text is indistinguishable from
human-authored content with no revert. `:371` offers no way to dismiss or regenerate a
proposal without closing the dialog — which discards the draft.

### P3 · Silent row caps presented as complete data

- `admin.listings.tsx:94` shows at most 80 of ~398 listings with no pagination, no count,
  no notice. There is also **no keyword search box**, though the server already supports
  `q` end to end.
- `admin.cms.tsx:720` — no search/filter/sort/pagination on any tab; the FAQ table renders
  every row, and the bulk importer is what produces hundreds.
- `admin.segments.tsx:385` — `preview.contacts.slice(0, 20)` renders 20 rows under a header
  saying "Top 200" and a summary saying `eligible/total`: three different numbers, no
  indication rows were dropped.

### P3 · Operations polling fights the operator

- `admin.operations.tsx:92` — every 30s tick sets `jobsSummary`/`migrations` to `null`
  before refetching, so sections unmount and remount: guaranteed flash and layout shift
  mid-read.
- `AdminOperationsJobs.tsx:156` — the tick refetches page 1 only, so an operator who
  clicked "Load more" to 100 rows silently loses 75 of them every 30 seconds.
- `:211` — filter inputs are `disabled={loading}`, which includes background ticks, so
  typing is interrupted mid-word.

### P8 · Migration apply is under-specified and gives no in-flight feedback

- `AdminOperationsMigrations.tsx:132` — `runApply` calls `setPlan(null)` *before* awaiting,
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

`CardTitle` renders a plain `<div>` (`card.tsx:23`), so on the largest admin pages the only
headings are the shell `<h1>` and strays inside empty states — no navigable structure
across five CMS tabs (`admin.cms.tsx:466`, `admin.index.tsx:62`). `AdminOperationsJobs.tsx:206`
and `AdminOperationsAudit.tsx:217` have no heading at all while Migrations has an `<h2>`.

### P1 · Misc accessibility

- `admin.cms.tsx:689` — the 上載 FAQ 檔案 control is a `<Button asChild><label>`, so Tab
  lands on the clipped `sr-only` input and the focus ring never fires.
- `admin.leads.tsx:644` — `role="button"` + `aria-label` on the `<tr>` replaces row/cell
  semantics, so a screen reader hears only "開啟 陳大文 詳情, button" and never the
  意圖/來源/預算/階段 cells.
- `admin.whatsapp.tsx:731` — `text-xs opacity-80` white-on-primary composites to ~4.05:1,
  under the 4.5:1 floor, and this is exactly where send status lives.
- `admin.operations.tsx:166` — a `failed` control plane renders neutral grey in the header
  badge while the Overview renders the same status `destructive`.
- `admin.operations.tsx:165` — `aria-live="polite"` wraps a timestamp, so screen readers
  re-announce the region every 30s even when nothing changed.
- No `prefers-reduced-motion` guard anywhere in the repo (`grep` → no matches), while
  `animate-spin` runs on every 30s poll tick.

### P8 · Failed WhatsApp sends are near-invisible and can't be retried

`admin.whatsapp.tsx:722` — `statusClass` for a failed message is `font-semibold` and
nothing else: same size, opacity and bubble colour as a success, no icon, no retry
control. Also `:703` the conversation pane never scrolls to the newest message, `:105`
the inbox never auto-refreshes and shows no "last updated" (so agents silently burn the
24-hour reply window), and `:644` the reply box has no `maxLength` or counter.

### P6 · Numeric columns and truncation

No `tabular-nums` anywhere in the codebase, so money/date/score columns jitter and
misalign across `admin.leads.tsx:669`, `admin.listings.tsx:334`,
`AdminOperationsJobs.tsx:295`. Truncated cells lack `title`, so long HK estate names, SEO
titles, alt text and AI justifications are permanently unreadable
(`admin.cms.tsx:497`, `admin.leads.tsx:664`).

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

- `admin.cms.tsx:1208` — article body is an 8-row raw textarea with no preview; the public
  renderer only splits on blank lines, so typed markdown publishes literal `##` and `**`.
- `admin.cms.tsx:1184` — 發布時間 is free text feeding `datePublished` JSON-LD; "3/8/2026"
  silently ships broken structured data.
- `admin.cms.tsx:183` — a failed knowledge-status fetch is swallowed and renders as
  「AI 未啟用」, telling staff the AI is off when the status call merely failed.
- `admin.cms.tsx:425` — metrics labelled "Chunks/Public/Stale/Last indexed": untranslated
  jargon, and a non-zero Stale count implies nothing actionable.
- `admin.leads.tsx:777` — 意圖 is a free-text input bound to the raw enum, so agents see
  English "buyer" and can type anything, breaking the 意圖 filter.
- `admin.leads.tsx:573` — no bulk workflow: reassigning 30 leads is 30 open→save cycles,
  each serially refetching the whole list.
- `admin.leads_.command-center.tsx:115` — `setSelected(row)` snapshots, and
  「重新 AI 分析」 never reconciles it, so the panel still shows 未分析 after a successful
  refresh.
- `admin.leads_.command-center.tsx:289` — KPI tiles are undefined bare numbers
  ("Hot leads" never says what qualifies) that aren't clickable to their matching queue,
  and they pop in after load, shifting the table.
- `admin.index.tsx:36` — a single `h-64` skeleton stands in for a ~90px metric row, so the
  page jumps ~170px when data arrives.
- `AdminEmptyState` accepts an `action` prop that most callers omit, leaving dead-end
  「沒有資料」 panels with no next step.

---

## Verified as already correct

Worth not re-flagging: the listings table already scrolls in its own container
(`overflow-x-auto` + `min-w-[920px]`) with no page overflow; listing status/type badges
already pair colour with a text label; `--muted-foreground` passes 4.5:1 in both themes
(5.12:1 light, 6.64:1 dark); `admin.whatsapp.tsx` already sets `aria-current` on the
selected conversation. `AgentProfileForm.tsx` is the strong reference implementation in
this codebase — inline field errors, `role="alert"`, `htmlFor`, focus-to-first-invalid —
and most form fixes above are a port of it.
