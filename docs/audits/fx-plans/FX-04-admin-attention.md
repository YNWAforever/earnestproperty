# FX-04 Admin Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff see new work without refreshing.
- While an admin tab is visible, the WhatsApp inbox list, 跟進工作台 and the nav badges refresh every 60 s. While the tab is hidden, nothing is fetched.
- Nav badges and the browser tab title show what is waiting.
- The overview gets a 「今日待辦」 list.
- Three small fixes ride along:
  - the 開放查詢 tile opens a leads list whose 階段 select reads 「開放（未完成）」 (G-17);
  - only one nav item is highlighted (G-16);
  - the overview tiles have accessible names (L-06).

**Architecture:**
- **One polling hook.** `src/lib/admin/use-visible-interval.ts` is the only way an admin view polls. `useVisibleInterval(callback, ms)` is a thin React wrapper over a pure `startVisibleInterval(callback, ms, env)`, which:
  - clamps the period to at least 60 000 ms;
  - keeps one pending timeout while `document.visibilityState === "visible"`, and none while hidden;
  - on becoming visible, runs at once if a tick came due while hidden, and otherwise waits out the remainder;
  - skips a tick while the previous run's promise is still pending.
- **Two read-only staff server functions**, placed next to the overview ones:
  - `fetchAdminAttentionCounts()` returns `{ unansweredConversations, unassignedLeads, staleNewLeads }` from one SQL statement.
  - `fetchAdminTodayTasks()` returns up to 10 `{ kind, id, title, waitingSince }` from one SQL statement.

  Both use the caller's existing read scope, exactly as the inbox list does: `agentScope` for leads and conversations, plus `wa_can_read_conversation` for conversations.
- **A small shared store**, `src/components/admin/admin-attention.ts`, built on the same pattern as `staff-session.ts`. It is keyed by staff identity. It:
  - shares one in-flight read per identity;
  - keeps the last counts when a read fails;
  - never shows one identity's counts to another;
  - reuses counts younger than 60 s when the shell remounts on navigation.
- **`AdminShell` badges and title.** `AdminShell` polls the store every 60 s and renders badges on 客戶查詢 and WhatsApp 收件匣. Link names do not change: the number is `aria-hidden`, and the breakdown is the link's accessible description. The tab title is prefixed with the total.
- **A background refresh mode.** The inbox's `refreshConversations` and 跟進工作台's `refresh` each get a `background` option. In that mode there is no loading state and no error banner, and nothing else is touched. Each polls through `useVisibleInterval` and skips a tick while a user-started read is running.
- **The overview** shows 「今日待辦」 to all staff and the invite panel 「需要跟進」 to admins only. The tile links get `aria-label`s. A filter-only `stageFilterOptions` list adds `open`.

**Tech Stack:** React 19, TanStack Start (`createServerFn`) and Router (`Link` `activeOptions`), raw SQL via `queryRows`, `bun test` (+ `react-dom/server`), `node --test` with `--experimental-test-module-mocks`, `@electric-sql/pglite` 0.4.5 (already a dependency, with `contrib/pgcrypto`), Playwright 1.62 (`page.clock`, `toHaveAccessibleDescription`) on the owned synthetic admin fixtures.

**Spec:**
- `docs/audits/2026-10-final-audit.md` (FX-01 branch):
  - **G-01** (P1, :330): the inbox and 跟進工作台 never refresh; polling was removed in 39a5232.
  - **L-01** (P0, :147): this batch fixes only its G-01 root cause.
  - **L-06** (:152): tile links have no accessible name.
  - **G-16** (:346): double nav highlight.
  - **G-17** (:347): `stage=open` has no select option.
  - "Live admin walkthrough", steps 1–2 (:135-136).
- `docs/audits/2026-10-fix-plan.md`: batch **FX-04** (:276-302) and Review focus item 5 (:47).
- The owner-approved decisions are pinned below and override the fix plan where they differ:
  - the fix plan's `admin-attention.owned.db.test.mjs` becomes a PGlite file;
  - the browser spec runs through `test:admin-daily-work:ui`;
  - the leads page itself does not poll.

**Schema:** No migration. Read-only SQL over existing tables and the existing `wa_can_read_conversation` function.

**Open questions blocking implementation:** none. Two owner follow-ups are recorded under "Out of scope", each with the default this plan uses.

## Verified current behaviour (origin/main 4965d48)

| # | Finding | Where (verified) |
|---|---|---|
| 1 | The inbox refreshes only on demand. | `src/routes/admin.whatsapp.tsx`: the list loads once on mount (`:567-570`) and again on 重新整理 (`:1147-1164`), which also refreshes the open thread in the background (`:1159`). The copy 「…按「重新整理」讀取新訊息。」 is at `:1053`. Commit 39a5232 (2026-09-25) deleted the 30 s interval and changed this copy. |
| 2 | 跟進工作台 refreshes only on demand. | `src/routes/admin.leads_.command-center.tsx`: loads once (`:171-173`) and on 重新整理 (`:237-247`). Commit 39a5232 removed its 120 s interval and focus listener. |
| 3 | A test forbids polling. | `src/lib/admin/operations/operations.test.mjs:241-261` asserts there is no `setInterval(` and no focus listener in `admin.whatsapp.tsx`, the command center, `admin.operations.tsx` or `operations-polling.ts`. `operations-polling.ts:3` reads "Refreshes only when a staff member clicks refresh or completes a mutation". |
| 4 | The nav has no badges and the tab title has no count. | `src/components/admin/AdminShell.tsx:255-270` renders an icon and the label only. `AdminShell` never sets `document.title`. |
| 5 | The overview shows counts only, and 「需要跟進」 lists staff invite problems. | `src/routes/admin.index.tsx`: the tiles are at `:153-221`. The 「需要跟進」 panel (`:224-251`) lists `team.members.filter(needsAttention)`. |
| 6 | The overview tile links have no accessible name (L-06). | Each tile `<Link>` (`admin.index.tsx:326`) wraps a `Card` and has no `aria-label`. |
| 7 | `stage=open` shows a blank select (G-17). | The tile links to `/admin/leads?stage=open` (`admin.index.tsx:172-181`). The server understands `open` (`src/lib/neon/admin-pagination-query.ts:101-102`). The select renders only 全部階段 plus `stageOptions` (`src/routes/admin.leads.tsx:897-909`), and `stageOptions` has no `open` (`src/lib/admin/crm-presentation.ts:8-15`). `stageLabels.open = "開放查詢"` (`:19`) is used by no option. `stageOptions` also feeds the bulk stage control (`admin.leads.tsx:1051`) and the lead editor (`:1449`), so `open` must not be added to it. |
| 8 | 客戶查詢 and 跟進工作台 are both highlighted (G-16). | 客戶查詢 has `activeExact: false` (`AdminShell.tsx:59`), so it prefix-matches `/admin/leads/command-center`, which 跟進工作台 also matches (`:69-78`). `src/routes/admin.routes.test.mjs:999-1005` currently pins `activeExact: false`. The only route under `/admin/leads` is `admin.leads_.command-center.tsx`, which is non-nested. A TanStack exact match also deep-compares the search params unless `includeSearch: false` is set; the Team and 跟進工作台 entries already set it (`:152`, `:76`). The fix therefore needs both flags, or `/admin/leads?stage=open` loses its highlight. |
| 9 | The read scopes to reuse. | `agentScope` (`src/lib/neon/admin-data.server.ts:123-126`) returns null for admin and manager, and the staff id for agents. Inbox list scope (`admin-pagination-query.ts:25-27`, `:80`): agents need `w.assigned_agent_id = own` and `wa_can_read_conversation(own, w.id)`; admins and managers need only the function. Lead scope (`:41`): agents see `l.assigned_agent_id = own`. `wa_can_read_conversation` (`neon/migrations/20260929104000_whatsapp_enquiry_access.sql:60-74`): an admin reads every conversation; a manager reads only conversations whose assignee is in the manager's branch, so unassigned ones are hidden (B-01, FX-06); an agent reads their own. The overview counts already reuse these scopes through `readAdminPage` (`getAdminOverview`, `admin-data.server.ts:957-982`; wrapper `admin-data.ts:395-403`). |
| 10 | Every owned admin fixture renders `AdminShell`. | The synthetic admin-data modules for daily-work, campaign-review, link-bulk-owned and performance-readback re-export `scripts/browser-fixtures/no-link/synthetic-api.ts`. `property-maintenance/synthetic-api.ts` and `property-sync/synthetic-api.ts` do not. Each module therefore needs the new export, or its Vite build fails on a missing named export. |

## Test harness decision

**Hook and store: `bun test` with injected fakes.** The tests pass a fake clock and a stub document: an `EventTarget` with a mutable `visibilityState`.
- This repo has no jsdom or happy-dom (`src/lib/saved-listings.test.ts:18`).
- The hook is a thin wrapper over the pure `startVisibleInterval`, so the logic is tested without rendering.
- SSR safety is checked with `renderToStaticMarkup`.

**Counts SQL: a new PGlite suite.** `src/lib/neon/admin-attention.db.test.mjs` runs on PGlite under `node --experimental-test-module-mocks --test --test-concurrency=1`. It is appended to `test:command-center` (`package.json:39`), which runs in the CI main job (`.github/workflows/ci.yml:99`; Node 24 and Bun). `ci.yml` needs no change, and `src/test-wiring.test.mjs` stays satisfied.
- **Real migrations, in order:**
  1. `20260622060000_public_content.sql`
  2. `20260623090000_neon_admin_crm_whatsapp.sql` (staff, roles, contacts, leads, activities, conversations, messages)
  3. `20260830160000_branches_entity.sql` (`branches` and `staff_users.branch_id`; seeds `lido`, `rhine` and `hong-kong-garden`)
  4. a one-statement shim, `ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES whatsapp_conversations(id);`
  5. `20260929104000_whatsapp_enquiry_access.sql` (the real `wa_can_read_conversation`)
- **Why the shim exists.** The real column comes from `20260912130000_whatsapp_enquiry_episodes.sql:42-43`. Postgres validates the bodies of SQL-language functions at `CREATE` time, and `wa_can_read_enquiry` in migration 5 joins on `i.conversation_id`. Nothing in this batch reads `inquiries`.
- **Reused helpers.** The suite uses the `@/` resolver hook and `mockOwnedServerDb` from `scripts/acceptance/owned-postgres-test.mjs` (`:10-31`, `:144-164`), as FX-03 does. Importing `admin-data.server.ts` under node already works: `src/lib/neon/admin-overview-owned.db.test.mjs:13-14` does it.
- **Precedent.** `src/lib/whatsapp-enquiries/enquiry-access.db.test.mjs` already loads this same access migration on PGlite in CI (`test:no-link`).
- **Why not the owned Docker harness:** same as FX-03. On this machine owned suites hit `spawnSync docker ETIMEDOUT`.
- **Fallback.** Use it only if the Task 2 Step 2 smoke test cannot load the migrations:
  - rename the file to `src/lib/neon/admin-attention-owned.db.test.mjs`;
  - wrap the bodies in `withOwnedPostgres` (all 85 migrations, no shim);
  - append the file to the existing `test:admin-overview:db` (`package.json:126`), which CI runs in the Docker job (`ci.yml:153`), so `ci.yml` still needs no change;
  - say so in the task report.
- **Limitation:** PGlite has one connection. The counts are read-only single statements, so nothing here relies on concurrency.

**Browser: a new Playwright spec.** `e2e/admin-attention.spec.ts` runs on the existing no-link synthetic fixture.
- `scripts/browser-fixtures/build-whatsapp-no-link.mjs` builds it with no argument, into `.audit/no-link-browser`. It renders the real `admin.whatsapp`, `admin.leads` and `admin.index` routes inside the real `AdminShell`.
- `page.clock.install()` runs before navigation, and each poll is one `page.clock.runFor(60_000)`.
- Hidden and visible are emulated by redefining `document.visibilityState` and dispatching `visibilitychange`.
- **Wiring:**
  - append the spec to `test:admin-daily-work:ui` (`package.json:117`, which CI runs at `ci.yml:80`);
  - add it to `testMatch` in `playwright.admin-owned.config.ts`;
  - add it to `testIgnore` in `playwright.config.ts`. Otherwise `test:a11y` and the `browser-staging` job would try to run it against a dev server, and the spec refuses that.
- The overview, G-16, G-17 and L-06 browser checks extend `e2e/admin-daily-work.spec.ts`, whose fixture already renders `admin.index` and `admin.leads`.

## Global Constraints

- **Copy.** All new user-facing text is zh-HK and exactly as in the table below. Do not change any other copy. Strings that tests assert must stay:
  - the overview labels in `admin.routes.test.mjs:114-124`;
  - the link name `WhatsApp 收件匣`, matched exactly by `scripts/test-whatsapp-no-link-synthetic-browser.mjs:334,354` and `e2e/whatsapp-no-link.spec.ts:18`;
  - the 重新整理 handlers matched by `operations.test.mjs:259-260`: `onClick={() => { … refreshConversations() …` and `onClick={() => void refresh()}`.
- **No schema migration, no new env vars, no new dependencies.**
- **Polling.** Every automatic refresh goes through `useVisibleInterval` with at least 60 000 ms.
  - No raw `setInterval`, `setTimeout` or `focus` listener for refreshing in route files, `AdminShell` or `admin-attention.ts`.
  - The overview does not poll: `admin.routes.test.mjs:130` forbids `setInterval|setTimeout` in `admin.index.tsx`. Keep that.
- **A background refresh never:**
  - toggles a loading or skeleton state;
  - writes an error banner or a toast;
  - touches `selectedId`, `detail`, `replyDrafts`, `panelOpen`, `enquirySelections` or the URL;
  - changes the page or cursor the user is on.
- **Avoid merge conflicts with PR #222**, which appends at the end of `admin-data.ts`, `admin-data.server.ts` and `admin-data.types.ts`, and adds a line next to `fetchAdminLeadAiProfile` in the no-link `synthetic-api.ts`.
  - In those three files, insert at the anchors named in Task 2. Never append at the end of the file.
  - Do not edit the import blocks of `admin-data.ts` (`:1-42`) or `admin-data.server.ts` (`:1-100`). The new server functions' return types are inferred, as `getAdminOverview`'s is. They are checked structurally where the client store declares `() => Promise<AdminAttentionCounts>`.
  - Put the synthetic stubs next to `fetchAdminOverview` (no-link `:578-593`), never near `fetchAdminLeadAiProfile` (`:535`).
  - Put the new `admin-data.contract.test.mjs` test after the command-center test (`:62-73`), not at the end of the file.
- **Code style that node tests rely on.** `admin-data.server.ts` is loaded by `node --test` with type stripping. Use no enums, no namespaces and no constructor parameter properties, and import types with `import type`.
- **Do not modify `saveConversationUpdate`** (`admin.whatsapp.tsx:667-746`). `src/lib/admin/workspace-review.test.mjs:126-167` extracts it and runs it with an injected context.
- **Committing:**
  - Commit only the files you touched (`git add <paths>`). Never `git add -A`.
  - Never commit `bun.lockb` (it shows a spurious modification in this worktree) or `src/routeTree.gen.ts` build noise.
  - Commit messages are conventional with a scope and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Testing:** synthetic data only. No test talks to Neon, WozTell or a model. Names follow the `合成…` pattern; the phone is `61234567`.

**Copy (exact strings):**

| Key | Text |
|---|---|
| inbox description (`admin.whatsapp.tsx:1053`) | 查看客戶訊息、分配負責同事及回覆；對話列表每分鐘自動更新，亦可按「重新整理」即時讀取。 |
| WhatsApp 收件匣 badge description | {n} 個對話待回覆 |
| 客戶查詢 badge description | 未指派 {unassignedLeads} 宗；逾 2 小時未跟進的新查詢 {staleNewLeads} 宗 |
| badge text | the number; `99+` above 99 |
| tab title prefix | `({total}) ` before the route's title; `(99+) ` above 99; no prefix at 0 |
| overview card title | 今日待辦 |
| overview card description | 等候回覆的 WhatsApp 對話，以及逾 2 小時未有跟進的新查詢；最多顯示 10 項。 |
| task kind labels | `conversation` 待回覆 · `lead` 新查詢未跟進 |
| task time | 自 {formatHkDateTime(waitingSince)} |
| 今日待辦 empty state | 目前沒有待辦事項。 |
| fallback titles | `conversation` WhatsApp 客戶 · `lead` 未命名客戶 |
| stage filter option | 開放（未完成） |
| tile accessible name | {label}：{value} (e.g. 開放查詢：14); while loading with no value {label}：載入中; with no value {label}：— |

The loading and error states of 「今日待辦」 reuse `OperationalCard` and `useOverviewRead`: a skeleton, then 「暫時無法載入此營運資料，請稍後再試。」 with 最後成功讀取…, as at `admin.index.tsx:78`.

**Pinned definitions:**

- **Unanswered conversation:**
  - `w.status = 'open'`;
  - its latest `whatsapp_messages` row, ordered `created_at DESC, id DESC` as in `admin-pagination-query.ts:72-73`, has `direction = 'inbound'`;
  - it is visible to the caller: `($scope IS NULL OR w.assigned_agent_id = $scope) AND wa_can_read_conversation($staffId, w.id)`.
- **Unassigned lead:** `l.stage NOT IN ('closed_won','closed_lost') AND l.assigned_agent_id IS NULL AND ($scope IS NULL OR l.assigned_agent_id = $scope)`. This is always 0 for an agent.
- **Stale new lead:** `l.stage = 'new'`, in scope, and `COALESCE((SELECT max(a.created_at) FROM crm_activities a WHERE a.lead_id = l.id), l.created_at) <= now() - interval '2 hours'`. Any activity counts, including system ones, as with 跟進工作台's `last_activity_at` (`admin-data.server.ts:2767-2771`).
- **Scope parameters:** `$1 = actor.staffId` and `$2 = agentScope(actor)`, which is a uuid or null.
- **今日待辦:**
  - Rows are the union of the unanswered conversations and the stale new leads.
  - `waitingSince` is the latest message's `created_at` for a conversation, and `COALESCE(last activity, created_at)` for a lead.
  - Ordered `waitingSince ASC, kind ASC, id ASC`, `LIMIT 10`: the longest wait comes first.
  - SQL returns the contact's `name` and `phone`. TS sets `title = name?.trim() || phone?.trim() || <fallback title>`.
  - Links: a conversation goes to `/admin/whatsapp?conversation=<id>`, a lead to `/admin/leads?lead=<id>`.
- **Badges:**
  - 客戶查詢 = `unassignedLeads + staleNewLeads`. This is the pinned sum; see Out of scope.
  - WhatsApp 收件匣 = `unansweredConversations`.
  - tab title total = all three counts.
  - A count of 0 shows no badge and no description.
  - Only staff with role admin, manager or agent fetch counts. A viewer makes no request.
- **Poll semantics.** This reconciles "fires once promptly when visible again" with "never faster than 60 s":
  - nothing runs on start;
  - while visible, the next run is due at `lastRunAt + period`;
  - becoming hidden clears the pending timeout;
  - becoming visible runs at once only if `now ≥ lastRunAt + period`, and otherwise schedules the remainder.

## Batch Verification (run after Task 5)

- `npm run lint`, `npm run typecheck`, `npm run build`
- Test suites:
  - `npm run test:command-center` (hook, store, `crm-presentation`, `admin-data.contract`, `admin.routes`, PGlite counts)
  - `npm run test:operations` (the retargeted polling guard)
  - `npm run test:woztell` and `npm run test:no-link` (both read `admin.routes.test.mjs` and `AdminShell` sources)
  - `npm run test:control-plane` (includes `src/test-wiring.test.mjs`)
  - `npm run test:content-copilot` (includes `admin-data.contract`)
- Browser:
  - every suite in `playwright.admin-owned.config.ts`: `npx playwright test --config playwright.admin-owned.config.ts`. Each fixture renders `AdminShell`, and this run proves all of their builds still compile.
  - `npm run acceptance:whatsapp-no-link:synthetic`
- Screenshots at 375 px and 1440 px, before and after:
  - the overview, including 今日待辦;
  - the inbox with badges;
  - the desktop nav on `/admin/leads?stage=open`, with one highlight and the select showing 開放（未完成）.
- Staging click-through with the owner's test phone through the WozTell sandbox only:
  1. An inbound message appears in the inbox list within 60 s, and the badge and tab title update, with no reload.
  2. A half-typed reply survives.
  3. With the tab in the background for 3 minutes, the network panel shows no admin requests. On return, there is exactly one refresh.

## Review Focus

1. **Polling never clobbers the draft, the selection, the open thread or its scroll position.** The poll refreshes only the list rows, the cursor, the total and 最後更新. *Test owners:*
   - Task 4 e2e `draft, selected conversation and thread scroll survive two poll cycles` (1440 and 390 px): the reply text, `aria-current`, `?conversation=`, the thread's `scrollTop`, and no new `detail` or `messages` reads.
   - Task 4 e2e `a new inbound appears in the list after one poll, without a reload or a thread re-read`.
2. **Polling pauses while hidden and never runs faster than 60 s.** *Test owners:*
   - Task 1: `does not run on start or while hidden`, `clamps periods below 60 s, NaN and 0 to 60 s`, `becoming visible before the next tick is due waits for the remainder`.
   - Task 3/4 e2e: `polling pauses while hidden and resumes once when visible`.
   - Task 4 static guard in `operations.test.mjs`: the three consumers use `useVisibleInterval` with the 60 s constant, and the routes and the shell use no raw timers.
3. **Counts respect agent scope.** An agent's badges and tasks never include another agent's leads or conversations, or unassigned items. A manager's conversations follow the branch rule of `wa_can_read_conversation`. *Test owners:* Task 2 DB tests `counts follow each role's read scope` and `today's tasks follow the same scope, oldest first, at most 10`.
4. **The badges and the title stay correct when a count read fails.** There is no crash, no alert and no toast; the last known value is kept for the same identity and never shown to another. *Test owners:*
   - Task 3 store tests `a failed refresh keeps the last counts for the same identity` and `counts never cross identities`.
   - Task 3 e2e `a failed count read keeps the last badges and title`.
5. **Overlapping polls never send duplicate requests.** A tick is skipped while one is in flight. *Test owners:*
   - Task 1: `skips ticks while the previous run is still pending`.
   - Task 3 store: `concurrent refreshes share one request`.
   - Task 3 e2e: `a slow count read is never doubled by the next tick`.
   - The inbox and 跟進工作台 skip while a user-started read is running (`loadingRowsRef` and `loadingRef`/`busyRef`); this is code-reviewed in Task 4.
6. **The link names and the highlight stay right.** Badges must not change the accessible names `客戶查詢` and `WhatsApp 收件匣`, which existing suites match exactly. A filtered leads URL must still highlight 客戶查詢 alone. *Test owners:*
   - Task 3 e2e `nav badges show waiting work and the link names stay exact`.
   - Task 3 static test in `admin.routes.test.mjs`.
   - Task 5 e2e in `keyboard card opens the same filtered list…`: exactly one `aria-current="page"` link, named 客戶查詢.

## Out of scope (owned elsewhere or owner follow-ups)

- **Owner follow-up 1, the leads badge can double-count.** The 客戶查詢 badge sums `unassignedLeads + staleNewLeads` as pinned, so a lead that is both unassigned and stale counts twice. The accessible description and the hover title show both parts. To show distinct leads instead, the fix is one SQL `count(*) FILTER (…)` with an OR; the counts shape stays as pinned.
- **Owner follow-up 2, the open thread does not auto-refresh.** The poll refreshes the inbox list only, as pinned. An open thread still updates through 重新整理, which keeps its background refresh at `:1159`. The new inbound shows at once in the list row's preview and 待回覆 badge. To also refresh the open thread, call the existing `loadConversationDetail(openId, { background: true })` from the poll; it already preserves the draft and the scroll position.
- Managers do not see unassigned WhatsApp conversations (B-01) → FX-06. Until then, a manager's 待回覆 badge counts only the conversations they can open.
- A staff alert for each new lead (C-02) → FX-05b. The leads page itself does not poll; the 客戶查詢 badge covers it.
- 今日待辦 refreshes on load and on 重新整理 only. The overview stays non-polling; the nav badges and the title carry the live counts.
- Agents still get the 403 error on the overview team tiles (啟用團隊 / 待處理邀請) → FX-17 admin simplification.

---

### Task 1: `useVisibleInterval`, a visibility-gated, single-flight, ≥ 60 s interval

**Files:**
- Create: `src/lib/admin/use-visible-interval.ts`
- Create: `src/lib/admin/use-visible-interval.test.ts`
- Modify: `package.json`: add `src/lib/admin/use-visible-interval.test.ts` to the `bun test` list of `test:command-center` (`:39`)

**Interfaces:**
```ts
export const MIN_VISIBLE_INTERVAL_MS = 60_000;
export type VisibilitySource = {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};
export type VisibleIntervalEnv = {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  document: VisibilitySource;
};
/** Returns stop(). The default env uses Date.now, window timers and globalThis.document. */
export function startVisibleInterval(
  callback: () => unknown,
  ms: number,
  env?: VisibleIntervalEnv,
): () => void;
export function useVisibleInterval(callback: () => void, ms: number): void;
```
- **`startVisibleInterval` behaviour** (see the pinned poll semantics):
  1. `period = Number.isFinite(ms) ? Math.max(ms, MIN_VISIBLE_INTERVAL_MS) : MIN_VISIBLE_INTERVAL_MS`. Set `lastRunAt = env.now()` and do not call the callback on start.
  2. While visible, keep exactly one pending timeout, due at `lastRunAt + period`.
  3. When the timeout fires: if the document is hidden, pause and do not reschedule. Otherwise tick.
  4. A tick sets `lastRunAt = now` and schedules the next timeout *before* invoking the callback, so a throwing callback cannot stop polling.
     - If the previous run's thenable is unsettled, skip the call.
     - Otherwise call the callback. If it returns a thenable, treat the run as in flight until it settles, observed with `.then(done, done)`, so a rejection never surfaces as an unhandled rejection.
     - Consumers own their error handling; all three already catch.
  5. On `visibilitychange`:
     - hidden: clear the pending timeout;
     - visible: tick at once if `now ≥ lastRunAt + period`, otherwise schedule the remainder.
  6. `stop()` clears the timeout, removes the listener and sets a `stopped` flag. A late timer or listener callback then does nothing.
- **`useVisibleInterval`:**
  - keeps the latest callback in a ref updated every render;
  - calls `useEffect(() => typeof document === "undefined" ? undefined : startVisibleInterval(() => latest.current(), ms), [ms])`;
  - so a new callback identity never resets the schedule, and on the server it does nothing.

- [ ] **Step 1: Write the failing tests** in `use-visible-interval.test.ts`. Use a local `fakeEnv()`:
  - `time` starts at 0.
  - `timers` is a `Map<id, { at, run }>`.
  - `document = Object.assign(new EventTarget(), { visibilityState: "visible" })`.
  - `advance(ms)` fires due timers in `at` order, setting `time` to each timer's `at`.
  - `setVisibility(state)` assigns `visibilityState` and dispatches `new Event("visibilitychange")`.
  - `pendingTimers()` returns the number of pending timers.

  After resolving a promise, flush microtasks with `await Promise.resolve()` before advancing time. Tests:
  - `does not run on start or while hidden`: hidden from 0; `advance(300_000)` gives 0 calls.
  - `runs every 60 s while visible`: calls at 60 000, 120 000 and 180 000.
  - `clamps periods below 60 s, NaN and 0 to 60 s`: for `ms` of 1 000, 0 and `NaN`, 0 calls at 59 999 and 1 call at 60 000.
  - `pauses while hidden and runs once promptly when visible after a missed tick`:
    - hide at 10 000;
    - `advance(190_000)` gives 0 calls and `pendingTimers() === 0`;
    - make it visible at 200 000, giving exactly 1 call;
    - the next call is at 260 000.
  - `becoming visible before the next tick is due waits for the remainder`: hide at 10 000, show at 30 000. There are 0 calls at 30 000 and 1 at 60 000.
  - `skips ticks while the previous run is still pending`:
    - the callback returns a deferred promise;
    - 60 000 gives 1 call, and 120 000 still 1;
    - resolve it and flush;
    - 180 000 gives 2.
  - `a rejected run does not stop polling or raise an unhandled rejection`:
    - register `process.on("unhandledRejection")` and fail if it fires;
    - the callback returns `Promise.reject(Error("合成失敗"))`;
    - there are calls at 60 000 and 120 000.
  - `a throwing callback keeps the schedule`: wrap `advance` in `expect(...).toThrow()` at 60 000; there is still a call at 120 000.
  - `stop removes the listener and the timer, and late callbacks do nothing`: after `stop()`, `pendingTimers() === 0`; `setVisibility` and `advance(600_000)` give 0 calls.
  - `useVisibleInterval renders on the server without touching document`: `renderToStaticMarkup(createElement(Probe))`, where `Probe` calls `useVisibleInterval(() => {}, 1)`, returns markup and does not throw. Effects do not run in SSR.
- [ ] **Step 2: Run to verify they fail.** Run `bun test src/lib/admin/use-visible-interval.test.ts`. Expected: FAIL (cannot resolve `./use-visible-interval`).
- [ ] **Step 3: Implement** `use-visible-interval.ts` as specified. The file must contain no `setInterval`.
- [ ] **Step 4: Run to verify they pass.** Run `npm run test:command-center`, `node --test src/test-wiring.test.mjs`, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `src/lib/admin/use-visible-interval.ts`, `src/lib/admin/use-visible-interval.test.ts` and `package.json` with the message `feat(admin): add a visibility-gated 60-second polling hook`.

### Task 2: Scoped attention counts and today's tasks (`getAdminAttentionCounts`, `getAdminTodayTasks`)

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts`: insert the two types after `CommandCenterData` (`:587-592`) and before `StaffAccessRole` (`:594`).
- Modify: `src/lib/neon/admin-data.server.ts`: insert both functions directly after `getAdminOverview` (`:957-982`) and before `listAdminListings` (`:984`). Do not edit the import block. `agentScope`, `queryRows`, `numberOrNull`, `dateOrNull` and `stringOrNull` are already in scope.
- Modify: `src/lib/neon/admin-data.ts`: insert both wrappers directly after `fetchAdminOverview` (`:395-403`) and before `fetchAdminListingsServer` (`:405`). Do not edit the import block.
- Modify: `src/lib/neon/admin-data.contract.test.mjs`: add a test directly after `command center read model is guarded and set-based` (`:62-73`).
- Create: `src/lib/neon/admin-attention.db.test.mjs`
- Modify: `scripts/browser-fixtures/no-link/synthetic-api.ts`:
  - state fields in `state` (`:65-98`);
  - stubs directly after `fetchAdminOverview` (`:578-593`).

  The daily-work, campaign-review, link-bulk-owned and performance-readback fixtures inherit the stubs through `export *`.
- Modify: `scripts/browser-fixtures/property-maintenance/synthetic-api.ts`: a zero stub directly after `fetchStaffSession` (`:146-153`).
- Modify: `scripts/browser-fixtures/property-sync/synthetic-api.ts`: a zero stub directly after `fetchStaffSession` (`:48-52`).
- Modify: `package.json`: append ` && node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/neon/admin-attention.db.test.mjs` to `test:command-center` (`:39`).

**Interfaces:**
```ts
// admin-data.types.ts
export type AdminAttentionCounts = {
  unansweredConversations: number;
  unassignedLeads: number;
  staleNewLeads: number;
};
export type AdminTodayTask = {
  kind: "conversation" | "lead";
  id: string;
  title: string;
  waitingSince: string; // ISO timestamp
};
```
- **Server** (`admin-data.server.ts`). Each function throws `new Response("Forbidden", { status: 403 })` when `!actor`, as `getAdminOverview` does, and each runs exactly one `queryRows` call with params `[actor.staffId, agentScope(actor)]`.
  - `export async function getAdminAttentionCounts(actor: StaffAccess)` is one `SELECT` with three scalar subqueries, per the pinned definitions:
    - `unanswered_conversations` joins `whatsapp_conversations w` with `JOIN LATERAL (SELECT m.direction FROM whatsapp_messages m WHERE m.conversation_id = w.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) latest ON latest.direction = 'inbound'`;
    - `unassigned_leads`;
    - `stale_new_leads`.

    It returns `{ unansweredConversations, unassignedLeads, staleNewLeads }`, each `numberOrNull(…) ?? 0`.
  - `export async function getAdminTodayTasks(actor: StaffAccess)` is one statement: `SELECT kind, id, name, phone, waiting_since FROM (<conversations> UNION ALL <leads>) t ORDER BY waiting_since ASC, kind ASC, id ASC LIMIT 10`.
    - Conversations: `'conversation'`, `w.id`, `c.name`, `c.phone`, `latest.created_at`, using the same lateral join and filters as the unanswered count, plus `LEFT JOIN crm_contacts c ON c.id = w.contact_id`.
    - Leads: `'lead'`, `l.id`, `c.name`, `c.phone`, `COALESCE(la.last_activity_at, l.created_at)`, with `LEFT JOIN LATERAL (SELECT max(a.created_at) AS last_activity_at FROM crm_activities a WHERE a.lead_id = l.id) la ON true` and the stale filter.
    - It maps each row to `AdminTodayTask`: `kind` is `row.kind === "lead" ? ("lead" as const) : ("conversation" as const)`; `title` uses the pinned fallback; `waitingSince` is `dateOrNull(row.waiting_since) ?? ""`.

    It writes nothing.
- **Wrappers** (`admin-data.ts`), each with the same shape as `fetchAdminOverviewServer`:
  - `fetchAdminAttentionCountsServer = createServerFn({ method: "GET" }).handler(…)`, which calls `requireStaff(["admin", "manager", "agent"])`, then lazily imports `./admin-data.server`;
  - `export async function fetchAdminAttentionCounts()`, which returns `callStaffServerFn(async () => fetchAdminAttentionCountsServer(await withStaffAuthHeaders()))`;
  - the same pair for `fetchAdminTodayTasksServer` / `fetchAdminTodayTasks()`.
- **Synthetic stubs:**
  - In the no-link module:
    - state fields: `attentionMode: "ok"` (`"ok" | "failure" | "pending"`), `attentionCounts: { unansweredConversations: 2, unassignedLeads: 0, staleNewLeads: 0 }`, `pendingAttention: [] as (() => void)[]`, and `todayTasks` with two items:
      - `{ kind: "conversation", id: ids.a, title: "合成客戶甲", waitingSince: <now − 3 h ISO> }`
      - `{ kind: "lead", id: "40000000-0000-4000-8000-000000000002", title: "每日工作合成查詢1", waitingSince: <now − 150 min ISO> }`

      That lead id resolves in the daily-work fixture's `fetchAdminLead`.
    - `fetchAdminAttentionCounts` reads `fixture()`, not `state`, because `window.noLinkFixture` is a copy. It calls `call("attention")`; in `pending` mode it awaits a promise pushed to `fixture().pendingAttention`; in `failure` mode it throws `Error("Synthetic attention read failure")`. It returns `{ ...fixture().attentionCounts }`.
    - `fetchAdminTodayTasks` calls `call("todayTasks")` and returns `fixture().todayTasks`.
  - In property-maintenance and property-sync: `export const fetchAdminAttentionCounts = async () => ({ unansweredConversations: 0, unassignedLeads: 0, staleNewLeads: 0 });`. It records no call.

- [ ] **Step 1: Write the harness and a smoke test.** Shape of `admin-attention.db.test.mjs`:
  ```js
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import test, { mock } from "node:test";
  import { PGlite } from "@electric-sql/pglite";
  import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
  import { mockOwnedServerDb, repoRoot } from "../../../scripts/acceptance/owned-postgres-test.mjs";
  const sql = (file) => readFileSync(new URL("neon/migrations/" + file, repoRoot), "utf8");
  const BASE = ["20260622060000_public_content.sql", "20260623090000_neon_admin_crm_whatsapp.sql", "20260830160000_branches_entity.sql"].map(sql);
  // Real column: 20260912130000_whatsapp_enquiry_episodes.sql:42-43. Needed only because the access
  // migration's SQL functions are validated at CREATE time; nothing here reads inquiries.
  const SHIM = "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES whatsapp_conversations(id);";
  const ACCESS = sql("20260929104000_whatsapp_enquiry_access.sql");
  let db; let queryCount = 0;
  const query = async (statement, params = []) => { queryCount += 1; return (await db.query(statement, params)).rows; };
  const transaction = async (statements) => db.transaction(async (tx) => { const out = []; for (const { statement, params = [] } of statements) out.push((await tx.query(statement, params)).rows); return out; });
  await mockOwnedServerDb(mock, query, transaction);
  const adminData = await import("./admin-data.server.ts");
  async function freshDb() { db = new PGlite({ extensions: { pgcrypto } }); for (const s of [...BASE, SHIM, ACCESS]) await db.exec(s); queryCount = 0; }
  ```
  Each test calls `await freshDb()` and closes `db` in `finally`. Add a `seed()` helper that builds the fixture below and returns the ids and actors.
  - **Staff.** Insert `staff_users (auth_user_id, email, branch_id)` and `staff_roles (staff_user_id, role)`:
    - `admin`, with no branch;
    - `managerLido` (branch `lido`);
    - `agentA` (`lido`);
    - `agentB` (`rhine`).

    Look up branch ids with `SELECT id FROM branches WHERE slug = $1`. Each actor is `{ staffId, authUserId, email: null, name: null, roles: [role], bootstrap: false }`.
  - **Leads.** Columns are stage, assignee and `created_at = now() - interval`. Contacts are inserted only where named.

    | Lead | Stage | Assignee | Created | Activity |
    |---|---|---|---|---|
    | L1 | new | none | 300 min ago | none; no contact |
    | L2 | new | agentA | 240 min ago | none |
    | L3 | new | agentA | 240 min ago | a staff `note` by agentA, 30 min ago |
    | L4 | new | agentB | 60 min ago | none |
    | L5 | contacted | none | 600 min ago | none |
    | L6 | closed_lost | none | 600 min ago | none |
    | L7 | new | agentB | 180 min ago | a system `follow_up` (`staff_user_id NULL`) 180 min ago |
  - **Conversations.** `message_type 'text'`; each message has `created_at = now() - interval`.

    | Conversation | Status | Assignee | Messages | Contact |
    |---|---|---|---|---|
    | C1 | open | agentA | inbound 360 min ago | name 合成客戶甲 |
    | C2 | open | agentA | inbound 300 min ago, then outbound 290 min ago | none |
    | C3 | open | agentB | inbound 30 min ago | none |
    | C4 | closed | agentA | inbound 20 min ago | none |
    | C5 | open | unassigned | inbound 120 min ago | name `''`, phone `61234567` |
    | C6 | open | agentA | no messages | none |

  - Smoke test, `migrations and the real wa_can_read_conversation load on PGlite`: after `freshDb()` and `seed()`:
    - `SELECT wa_can_read_conversation($1,$2)` is true for (admin, C5) and false for (managerLido, C5);
    - it is true for (managerLido, C1) and false for (managerLido, C3).

    This pins the branch rule that the counts inherit.
- [ ] **Step 2: Prove the harness.** Run `node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/neon/admin-attention.db.test.mjs`. Expected: the smoke test PASSES before any production change. If a migration fails to exec on PGlite, or `admin-data.server.ts` fails to import, STOP. Apply the fallback in "Test harness decision" and report it.
- [ ] **Step 3: Write the failing tests** (append to the DB file):
  - `counts follow each role's read scope`. Expected `{ unansweredConversations, unassignedLeads, staleNewLeads }`:

    | Actor | Expected | Contributing rows |
    |---|---|---|
    | admin | `{ 3, 2, 3 }` | C1, C3, C5 · L1, L5 · L1, L2, L7 |
    | managerLido | `{ 1, 2, 3 }` | C1 only; C3 is another branch and C5 is unassigned |
    | agentA | `{ 1, 0, 1 }` | C1 · L2; never C3, C5, L1 or L7 |
    | agentB | `{ 1, 0, 1 }` | C3 · L7 |

  - `a conversation counts as unanswered only while its latest message is inbound`:
    - insert an outbound message on C1 now;
    - admin is `unansweredConversations === 2` and agentA is `0`;
    - then insert an inbound on C2 now: admin is `3` again.
  - `any activity in the last 2 hours keeps a new lead off the stale count`: insert a staff note on L2 now; agentA's `staleNewLeads === 0`, and admin's is `2`.
  - `each read is a single statement`: reset `queryCount`, then call each function once; each call adds exactly 1.
  - `today's tasks follow the same scope, oldest first, at most 10`. Check `kind:id` sequences:

    | Actor | Expected sequence |
    |---|---|
    | admin | C1, L1, L2, L7, C5, C3 |
    | managerLido | C1, L1, L2, L7 |
    | agentA | C1, L2 |
    | agentB | L7, C3 |

    - Titles: C1 `合成客戶甲`, C5 `61234567`, C3 `WhatsApp 客戶`, L1 `未命名客戶`.
    - Every `waitingSince` parses with `Date.parse`.
    - Then insert 12 more new unassigned leads created 210 min ago. Admin's list has length 10 and starts with C1, L1, L2, and every other item is a lead.
  - In `admin-data.contract.test.mjs`, the new test `attention reads are staff-scoped server functions next to the overview` asserts:
    - `admin-data.ts` exports `fetchAdminAttentionCounts` and `fetchAdminTodayTasks`;
    - `admin-data.server.ts` exports `getAdminAttentionCounts` and `getAdminTodayTasks`;
    - `client` matches `/fetchAdminAttentionCountsServer[\s\S]*?requireStaff\(\["admin", "manager", "agent"\]\)/`, and the same for `fetchAdminTodayTasksServer`;
    - `server.indexOf("export async function getAdminAttentionCounts")` lies between `getAdminOverview` and `listAdminListings`, which proves the PR #222-safe placement;
    - `server` matches `/wa_can_read_conversation\(\$1::uuid,\s*w\.id\)/`;
    - `types` exports `AdminAttentionCounts` and `AdminTodayTask`.
- [ ] **Step 4: Run to verify they fail.** Run the DB file (as in Step 2) and `node --test src/lib/neon/admin-data.contract.test.mjs`. Expected: FAIL (`getAdminAttentionCounts is not a function`; the contract exports are missing). The smoke test still PASSES.
- [ ] **Step 5: Implement** the types, the two server functions, the two wrappers and the synthetic stubs.
- [ ] **Step 6: Run to verify they pass.** Expected: PASS for all of:
  - `npm run test:command-center`
  - `npm run test:content-copilot`
  - `npm run typecheck`, `npm run lint`
  - `node scripts/browser-fixtures/build-whatsapp-no-link.mjs`, `node scripts/browser-fixtures/build-property-maintenance.mjs`, `node scripts/browser-fixtures/build-property-sync.mjs` (the fixtures still build)
- [ ] **Step 7: Commit** the touched files with the message `feat(admin): add scoped attention counts and today's task reads`.

### Task 3: Nav badges, tab title and a single highlight (G-16)

**Files:**
- Create: `src/components/admin/admin-attention.ts`
- Create: `src/components/admin/admin-attention.test.ts`
- Modify: `src/components/admin/AdminShell.tsx`:
  - the nav entries `/admin/leads` (`:55-61`) and `/admin/whatsapp` (`:62-68`);
  - `AdminNav` (`:221-277`);
  - `AdminShell` hook calls, placed before the first early return (`:422`);
  - pass the counts to both `AdminNav`s (`:467`, `:506`).
- Modify: `src/routes/admin.routes.test.mjs`:
  - flip `:999-1005`;
  - add one test after `sidebar has no duplicate destinations and is fully grouped` (`:954-…`).
- Create: `e2e/admin-attention.spec.ts`
- Modify: `playwright.admin-owned.config.ts`: add `"admin-attention.spec.ts"` to `testMatch`.
- Modify: `playwright.config.ts`: add `"**/admin-attention.spec.ts"` to `testIgnore`.
- Modify: `package.json`:
  - add `src/components/admin/admin-attention.test.ts` to the `test:command-center` bun list;
  - append `e2e/admin-attention.spec.ts` to `test:admin-daily-work:ui` (`:117`).

**Interfaces:**
```ts
// src/components/admin/admin-attention.ts
export const ATTENTION_POLL_MS = MIN_VISIBLE_INTERVAL_MS; // 60_000
export type AdminAttentionSnapshot = {
  identity: string | null;
  counts: AdminAttentionCounts | null;
  checkedAt: number | null;
};
export function attentionBadges(counts: AdminAttentionCounts | null): {
  leads: number; // unassignedLeads + staleNewLeads
  inbox: number; // unansweredConversations
  total: number; // all three
};
export function inboxBadgeDescription(counts: AdminAttentionCounts): string; // "{n} 個對話待回覆"
export function leadsBadgeDescription(counts: AdminAttentionCounts): string; // "未指派 {u} 宗；逾 2 小時未跟進的新查詢 {s} 宗"
export function badgeText(count: number): string; // "99+" above 99
/** Strips any leading /^\(\d+\+?\) / and adds `(${badgeText(total)}) ` when total > 0. */
export function withAttentionTitle(title: string, total: number): string;
export function createAdminAttentionStore(
  fetcher: () => Promise<AdminAttentionCounts>,
  now?: () => number,
): {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AdminAttentionSnapshot;
  refresh(identity: string): Promise<void>; // one in-flight read per identity; failure keeps counts
  refreshIfStale(identity: string, maxAgeMs?: number): Promise<void>; // default ATTENTION_POLL_MS
  reset(): void;
};
export const adminAttentionStore = createAdminAttentionStore(fetchAdminAttentionCounts);
export function useAdminAttention(identity: string | null): AdminAttentionCounts | null;
```
- **Store rules:**
  - `refresh(id)` returns the existing promise while a read for `id` is in flight.
  - On success it publishes `{ identity: id, counts, checkedAt: now() }`, but only if the snapshot identity is still `id` or null. Otherwise the result is discarded.
  - On failure it keeps `counts` and `checkedAt` when the snapshot identity is `id`. It never throws to the caller and never logs customer data.
  - A refresh for a new identity first publishes `{ identity: id, counts: null, checkedAt: null }`, so the old counts disappear at once.
  - `refreshIfStale` refreshes when the identity differs, when `checkedAt` is null, or when `now() − checkedAt ≥ maxAgeMs`.
- **`useAdminAttention(identity)`:**
  - reads the store with `useSyncExternalStore`;
  - runs an effect on `[identity]`: if `identity` is null it calls `reset()`, otherwise `void refreshIfStale(identity)`;
  - calls `useVisibleInterval(() => (identity ? adminAttentionStore.refresh(identity) : undefined), ATTENTION_POLL_MS)`;
  - returns `snapshot.identity === identity ? snapshot.counts : null`.
- **`AdminShell`:**
  - The 客戶查詢 entry becomes `activeExact: true, includeSearch: false, attention: "leads"`. WhatsApp 收件匣 gets `attention: "inbox"`.
  - `const identity = staffReady && staffRoles.some((role) => STAFF.includes(role)) ? JSON.stringify([user?.id, staffSession.staffId, [...staffRoles].sort()]) : null;`
  - `const attention = useAdminAttention(identity);`
  - The title effect is `useEffect(() => { document.title = withAttentionTitle(document.title, attentionBadges(attention).total); }, [attention, requestedPath]);`. A separate unmount effect resets the title to `withAttentionTitle(document.title, 0)`.

  All hook calls go above `if (loading)` (`:422`).
- **`AdminNav`** takes `attention: AdminAttentionCounts | null`. It does `const navId = useId()`. For an item with `"attention" in item` and a count above 0, the `<Link>` keeps `key={`${item.to}-${item.label}`}` as its first attribute, which the regex at `admin.routes.test.mjs:1011-1013` requires, and adds `aria-describedby={`${navId}-${item.attention}`}`. After `{item.label}`, the link contains:
  ```tsx
  <span aria-hidden="true" data-attention-badge={item.attention} title={description}
    className="ml-auto min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-xs font-semibold leading-5 text-amber-950">
    {badgeText(count)}
  </span>
  <span id={`${navId}-${item.attention}`} hidden>{description}</span>
  ```
  - The link's accessible name stays exactly the label: the badge is `aria-hidden`, and hidden content is excluded from the name.
  - The description is still exposed, because nodes referenced by `aria-describedby` are read even when hidden.
  - A disabled entry (`roleCanOpen` false) never shows a badge.

- [ ] **Step 1: Write the failing tests.**

  In `admin-attention.test.ts` (bun):
  - `badges: leads is unassigned plus stale new, inbox is unanswered, total sums all three; null is zero`
  - `title prefix is added, replaced and removed without stacking; above 99 shows 99+`:
    - `("WhatsApp Inbox｜Earnest Admin", 3)` gives `(3) WhatsApp Inbox｜Earnest Admin`;
    - `("(3) X", 5)` gives `(5) X`;
    - `("(5) X", 0)` gives `X`;
    - `("X", 120)` gives `(99+) X`.
  - `badge descriptions are the exact zh-HK copy`
  - `concurrent refreshes share one request`: two `refresh("id-1")` calls give 1 fetcher call, and both resolve.
  - `a failed refresh keeps the last counts for the same identity`: success with `{1, 2, 3}`, then a rejecting fetcher; the snapshot counts are still `{1, 2, 3}`, and `refresh` resolves.
  - `counts never cross identities`:
    - `refresh("A")` is pending; `refresh("B")` succeeds;
    - resolve A late; the snapshot is identity B with B's counts.
    - Also, after a failed first read for a new identity, the counts are null.
  - `refreshIfStale reuses counts younger than 60 s`, with an injected `now`: 1 call at t = 0 and none at t = 59 999; a call at t = 60 000; a call immediately for a different identity.

  In `admin.routes.test.mjs`:
  - Replace `:999-1005` with assertions that `adminLeadsEntry` matches `/activeExact:\s*true/` and `/includeSearch:\s*false/`. The message reads: "/admin/leads has no child routes; prefix matching lit 客戶查詢 on /admin/leads/command-center too (G-16), and exact matching without includeSearch:false unlights /admin/leads?stage=open".
  - New test `nav badges keep link names and come from the shared attention store`. `AdminShell` matches:
    - `/useAdminAttention\(identity\)/`
    - `/aria-describedby=/`
    - `/aria-hidden="true"[\s\S]{0,80}data-attention-badge/`
    - `/withAttentionTitle\(/`
    - `/attention: "leads"/`
    - `/attention: "inbox"/`

    It must not match `/setInterval|setTimeout/`.

  Create `e2e/admin-attention.spec.ts`:
  - **Setup.** Copy the loopback server, `beforeAll`, `afterAll` and route guard from `e2e/admin-whatsapp-mobile.spec.ts:31-69` and `:126-138`. Build with `["scripts/browser-fixtures/build-whatsapp-no-link.mjs"]` (no `mobile-ai`) and serve `.audit/no-link-browser`. Write no evidence files.
  - **`afterEach`:** no `pageerror`; `window.noLinkOutboundFixture.calls` is empty; there are no mutation calls (the same list as `admin-whatsapp-mobile.spec.ts:96-113`).
  - **Helpers:**
    - `open(page)`: sets the session actor `agent-a`, then `await page.clock.install({ time: new Date("2026-10-05T02:00:00Z") })` BEFORE `page.goto(origin + "/admin/whatsapp?conversation=" + ids.a)`, then waits for `page.getByLabel("WhatsApp 回覆").filter({ visible: true })`.
    - `callCount(page, name, resource?)` counts `window.noLinkFixture.calls` by name and, optionally, by `input.resource`.
    - `setVisibility(page, state)` uses `Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })` and the same for `hidden`, then dispatches `visibilitychange`.
    - `nav = page.getByRole("navigation", { name: "後台選單" }).filter({ visible: true })`
    - `POLL = 60_000`
  - **Tests** (viewport 1440 × 900):
    - `nav badges show waiting work and the link names stay exact`:
      - `nav.getByRole("link", { name: "WhatsApp 收件匣", exact: true })` has the accessible description `2 個對話待回覆`;
      - `[data-attention-badge="inbox"]` has the text `2`;
      - `nav.getByRole("link", { name: "客戶查詢", exact: true })` has no `[data-attention-badge]`;
      - `toHaveTitle("(2) Isolated synthetic inbox")`.
    - `a poll updates the badges and the tab title`:
      - set `window.noLinkFixture.attentionCounts = { unansweredConversations: 5, unassignedLeads: 1, staleNewLeads: 2 }`;
      - `runFor(POLL)`;
      - the inbox badge reads `5`, the leads badge `3`, and the 客戶查詢 description is `未指派 1 宗；逾 2 小時未跟進的新查詢 2 宗`;
      - the title is `(8) Isolated synthetic inbox`;
      - `callCount("attention")` increased by exactly 1.
    - `a failed count read keeps the last badges and title`: `attentionMode = "failure"`; `runFor(POLL)` adds 1 call; the badge is still `2`, the title still `(2) …`, and the nav has no `role="alert"`.
    - `a slow count read is never doubled by the next tick`:
      - `attentionMode = "pending"`;
      - `runFor(POLL)` makes it +1, and `runFor(POLL)` again keeps it at +1;
      - then `attentionMode = "ok"`, call `window.noLinkFixture.pendingAttention.forEach((r) => r())`, and `runFor(POLL)`: +2.
    - `polling pauses while hidden and resumes once when visible`:
      - `setVisibility("hidden")`; `runFor(3 * POLL)` gives no new attention call;
      - `setVisibility("visible")`: `expect.poll` shows exactly +1 without advancing time;
      - `runFor(POLL - 1_000)`: still +1; `runFor(1_000)`: +2.

    Task 4 extends this test with list reads.
- [ ] **Step 2: Run to verify they fail.** Expected: FAIL on missing module, `activeExact: false`, and no badge, description or title.
  - `bun test src/components/admin/admin-attention.test.ts`
  - `node --test src/routes/admin.routes.test.mjs`
  - `npx playwright test --config playwright.admin-owned.config.ts e2e/admin-attention.spec.ts`
- [ ] **Step 3: Implement** the store, the hook, the `AdminShell` changes and the wiring.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS. Every owned fixture builds, because they all render `AdminShell`.
  - `npm run test:command-center`, `npm run test:woztell`, `npm run test:no-link`
  - `npm run test:admin-daily-work:ui`
  - `npx playwright test --config playwright.admin-owned.config.ts`
  - `npm run typecheck`, `npm run lint`
- [ ] **Step 5: Commit** the touched files with the message `feat(admin): show waiting-work badges and tab title in the admin nav`.

### Task 4: The inbox list and 跟進工作台 refresh every 60 s while visible

**Files:**
- Modify: `src/routes/admin.whatsapp.tsx`:
  - `refreshConversations` (`:369-401`);
  - a new poll directly after the mount-load effect (`:567-570`);
  - the description (`:1053`).

  Do not touch `saveConversationUpdate` (`:667-746`).
- Modify: `src/routes/admin.leads_.command-center.tsx`: `refresh` (`:153-169`), and a new poll directly after `:171-173`.
- Modify: `src/lib/admin/operations/operations.test.mjs`: replace the test at `:241-261`.
- Modify: `scripts/browser-fixtures/no-link/synthetic-api.ts`: a `pushInbound` helper directly after the `refreshMembership` assignment (`:103-119`), plus its state placeholder in `state` (`:65-98`).
- Modify: `e2e/admin-attention.spec.ts` (append and extend)

**Interfaces:**
- **Inbox:**
  - `refreshConversations(cursor: string | null = listCursorRef.current, options: { background?: boolean } = {})`.
    - With `background: true` it does not call `setLoadingRows` (neither true nor false). On failure it returns `false` without calling `setError`.
    - The success path is unchanged: rows, cursor, next cursor, total, `setListUpdatedAt(Date.now())`, `setError(null)`.
    - Every existing call site keeps its current arguments, including `refreshConversations()` in the 重新整理 handler.
  - The poll:
    ```ts
    const loadingRowsRef = useRef(loadingRows);
    loadingRowsRef.current = loadingRows;
    // A user-started list read (重新整理, paging, a save's readback) owns the slot; skip this tick.
    useVisibleInterval(
      () => (loadingRowsRef.current ? undefined : refreshConversations(undefined, { background: true })),
      MIN_VISIBLE_INTERVAL_MS,
    );
    ```
    It refreshes the page the user is on (`listCursorRef.current`). It does not call `loadConversationDetail`, `loadConversationAiAssist` or `checkOutboundReservation`, and does not touch `setWhatsappSearch`.
  - Updating `listUpdatedAt` also re-reads 我的接手工作 through `StaffNotificationPanel`'s `refreshKey` (`:1058`), exactly as 重新整理 does today. That is intended.
  - Description: the exact copy in the table.
- **跟進工作台:**
  - `refresh = useCallback(async (options: { background?: boolean } = {}) => …)`. With `background: true` it skips `setLoading` and, on failure, `setError`. Success is unchanged.
  - `onClick={() => void refresh()}` and the mount effect stay byte-for-byte the same.
  - The poll: `useVisibleInterval(() => (loadingRef.current || busyRef.current ? undefined : refresh({ background: true })), MIN_VISIBLE_INTERVAL_MS)`, where the refs mirror `loading` and `busy`. `selectedId`, `filter` and the URL are untouched.
- **New guard** in `operations.test.mjs`, `admin views poll only through the visible 60-second interval` (replacing `idle admin views do not repeatedly query Neon`):
  - For `operations-polling.ts`, `admin.operations.tsx`, `admin.whatsapp.tsx`, `admin.leads_.command-center.tsx`, `AdminShell.tsx` and `admin-attention.ts`: `doesNotMatch(/setInterval\s*\(/)` and `doesNotMatch(/addEventListener\(["']focus/)`.
  - `operations-polling.ts` and `admin.operations.tsx` do not match `/useVisibleInterval/` (they stay manual).
  - `admin.whatsapp.tsx` and the command center match `/useVisibleInterval\([\s\S]*?background: true[\s\S]*?MIN_VISIBLE_INTERVAL_MS\)/`.
  - `admin-attention.ts` matches `/useVisibleInterval\([\s\S]*?ATTENTION_POLL_MS\)/` and `/ATTENTION_POLL_MS = MIN_VISIBLE_INTERVAL_MS/`.
  - `use-visible-interval.ts` matches `/MIN_VISIBLE_INTERVAL_MS = 60_000/` and `/visibilityState/`.
  - Keep both manual-refresh asserts from `:259-260`.
- **Fixture:** `fixture().pushInbound = (id: string, text: string) => {…}` finds the row in `rows` and sets `last_text = text`, `last_message_at = last_inbound_at = new Date().toISOString()` and `last_direction = "inbound"`. It pushes `{ ...message(row.messages.length + 1, id), text, created_at }`.

- [ ] **Step 1: Write the failing tests.**

  Update `operations.test.mjs` as above.

  In `e2e/admin-attention.spec.ts`, add:
  - `a new inbound appears in the list after one poll, without a reload or a thread re-read`:
    - mark the document with `window.__sameDocument = true`;
    - record the counts of `page`/`conversations`, `detail`, `messages` (`page` with resource `messages`) and `ai-read`;
    - `pushInbound(ids.b, "合成新訊息：想約睇樓")`, then `runFor(POLL)`;
    - the conversations count is exactly +1, and `page.getByRole("button").filter({ hasText: "合成新訊息：想約睇樓" })` is visible;
    - `__sameDocument` is still true;
    - the `detail`, `messages` and `ai-read` counts are unchanged.
  - `draft, selected conversation and thread scroll survive two poll cycles`, at both 1440 × 900 and 390 × 844:
    - fill the reply with `合成草稿：請稍等，我查一查`;
    - locate the thread scroller as in `admin-whatsapp-mobile.spec.ts:501-507`;
    - set `scrollTop = 120` and dispatch `scroll`;
    - record `scrollTop`, then `runFor(POLL)` twice: the conversations count is +2;
    - the reply still has the value; `?conversation=` still equals `ids.a`; the thread `scrollTop` is unchanged; the `detail` and `messages` counts are unchanged;
    - at 1440 only, the 合成客戶甲 row still has `aria-current="true"`.
  - Extend `polling pauses while hidden and resumes once when visible` so the conversations count behaves like the attention count: +0 while hidden, +1 on visible, and +1 more one full period later.
- [ ] **Step 2: Run to verify they fail.** Run `node --test src/lib/admin/operations/operations.test.mjs` and `npx playwright test --config playwright.admin-owned.config.ts e2e/admin-attention.spec.ts`. Expected:
  - FAIL: the new guard (no `useVisibleInterval` in the routes), `new inbound…` (no list read after 60 s), `draft…` (+0 instead of +2), and the list half of `polling pauses…`.
  - PASS: the Task 3 badge tests (regression guards).
- [ ] **Step 3: Implement** the background modes, both polls, the copy change and `pushInbound`.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
  - `npm run test:operations`, `npm run test:command-center`, `npm run test:woztell`
  - `node --test src/lib/admin/workspace-review.test.mjs`
  - `npm run test:admin-daily-work:ui`, `npm run test:whatsapp-mobile:ui`
  - `npm run typecheck`, `npm run lint`
- [ ] **Step 5: Commit** the touched files with the message `fix(admin): auto-refresh the inbox list and command center while the tab is visible`.

### Task 5: Overview 今日待辦, tile names (L-06) and the 開放（未完成） filter (G-17)

**Files:**
- Modify: `src/routes/admin.index.tsx`:
  - imports (`:3-27`);
  - reads (`:104-125`);
  - the card section (`:224-282`);
  - `OverviewMetricCard` (`:306-350`).
- Modify: `src/lib/admin/crm-presentation.ts` (`:8-19`)
- Modify: `src/lib/admin/crm-presentation.test.ts`
- Modify: `src/routes/admin.leads.tsx`: the stage filter select only (`:897-909`). The bulk control (`:1051`) and the editor (`:1449`) keep `stageOptions`.
- Modify: `src/routes/admin.routes.test.mjs`: the overview test (`:105-133`).
- Modify: `e2e/admin-daily-work.spec.ts`:
  - `open()` (`:115`);
  - the tests at `:533-544`, `:581-606` and `:634-648`;
  - new tests inside the width loop.

**Interfaces:**
- **`crm-presentation.ts`:**
  - `export const stageFilterOptions: { value: LeadStage | "open"; label: string }[] = [{ value: "open", label: "開放（未完成）" }, ...stageOptions];`
  - Replace `stageLabels.open = "開放查詢"` with `stageLabels.open = stageFilterOptions[0].label;`.
  - `stageOptions` is unchanged: it has no `open`, so neither bulk edit nor lead edit can set it.
- **`admin.leads.tsx:903`:** map `stageFilterOptions` instead of `stageOptions`.
- **`admin.index.tsx`:**
  - Add `fetchAdminTodayTasks` to the `@/lib/neon/admin-data` import.
  - `const readToday = useCallback(() => fetchAdminTodayTasks(), []);`
  - `const [today, refreshToday] = useOverviewRead<AdminTodayTask[]>(identity, readToday);`, and add `refreshToday()` to `refreshAll`.
  - `const isAdmin = session?.status === "ok" && session.roles.includes("admin");`
  - The section renders, in this order:
    1. `<OperationalCard id="overview-today" title="今日待辦" description=… icon={ClipboardList} …>`, a `<ul>` of up to 10 `<li>`. Each holds one `<Link>`:
       - `to="/admin/whatsapp" search={{ conversation: task.id }}` or `to="/admin/leads" search={{ lead: task.id }}`;
       - it contains the kind label (a `Badge`), `task.title` (`min-w-0 break-words`) and `自 {formatHkDateTime(task.waitingSince)}`;
       - the empty state is 「目前沒有待辦事項。」.
    2. `{isAdmin ? <OperationalCard id="overview-attention" …需要跟進…> : null}`. The body is unchanged.
    3. The 最近職員活動 card, unchanged.

    No polling is added.
  - `OverviewMetricCard`: `<Link to={to} search={search} aria-label={tileName}>`, where `tileName` follows the copy table. It uses the same `value.toLocaleString()` formatting as the visible number.

- [ ] **Step 1: Write the failing tests.**

  In `crm-presentation.test.ts`, add `the stage filter offers 開放（未完成） for stage=open, but stage edits never can`:
  - `stageFilterOptions[0]` equals `{ value: "open", label: "開放（未完成）" }`;
  - `stageFilterOptions.slice(1)` equals `stageOptions`;
  - `stageOptions` has no `open`;
  - `stageLabels.open === "開放（未完成）"`.

  The existing test at `:9-18` must still pass unchanged.

  In `admin.routes.test.mjs:105-133`:
  - add `fetchAdminTodayTasks` to the sources and `今日待辦` to the labels;
  - assert `/aria-label=\{tileName\}/`;
  - assert `/isAdmin \?[\s\S]{0,40}<OperationalCard[\s\S]{0,40}id="overview-attention"/`;
  - keep `doesNotMatch(overview, /setInterval|setTimeout/)`.

  In `e2e/admin-daily-work.spec.ts`:
  - `open()` asserts `["admin", "manager"].includes(role) ? "7" : "2"`.
  - `same-user role downgrade clears whole-company values and restricted team history` (`:533`) uses `open(page, "admin")` and expects the overview call roles `["admin", "agent"]`.
  - `partial directory failure preserves other success and current count` (`:581`) uses `open(page, "admin")`.
  - New `overview tiles have accessible names`: as a manager, `page.getByRole("link", { name: "開放查詢：7", exact: true })` and `page.getByRole("link", { name: "待處理對話：7", exact: true })` are visible.
  - New `今日待辦 is shown to every staff role and the invite panel only to admins`:
    - for `admin`, `manager` and `agent` in turn, `[aria-labelledby="overview-today"]` is visible;
    - `[aria-labelledby="overview-attention"]` has count 1 for admin and 0 for the others.
  - New `今日待辦 links open the WhatsApp conversation and the lead`:
    - the conversation link's `href` ends with `/admin/whatsapp?conversation=10000000-0000-4000-8000-000000000001`;
    - clicking the 每日工作合成查詢1 link gives the URL `/\/admin\/leads\?lead=40000000-0000-4000-8000-000000000002$/`;
    - `calls(page, "lead-detail")` reaches length 1.
  - Extend `keyboard card opens the same filtered list and reload retains filter` (`:634`):
    - after the URL assertion, `page.getByRole("combobox", { name: "階段", exact: true })` has the text `開放（未完成）`;
    - when `width >= 1024`, the visible `後台選單` nav has exactly one `[aria-current="page"]`, with the accessible name `客戶查詢`.

    This guards the G-16 `includeSearch` pitfall on a filtered URL.
- [ ] **Step 2: Run to verify they fail.** Run `npm run test:command-center` and `npm run test:admin-daily-work:ui`. Expected:
  - FAIL: the presentation and route assertions; tile names; 今日待辦; the manager still sees `overview-attention`; the select text is blank.
  - PASS: the single-highlight check (Task 3 already fixed it).
- [ ] **Step 3: Implement** the filter options, the overview card, the admin-only panel and the tile names.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS. Then run the Batch Verification list, including the 375/1440 px screenshots.
  - `npm run test:command-center`, `npm run test:woztell`
  - `npm run test:admin-daily-work:ui`. Its `afterEach` asserts no horizontal overflow at 390 px.
  - `npm run acceptance:whatsapp-no-link:synthetic`
  - `npm run typecheck`, `npm run lint`
- [ ] **Step 5: Commit** the touched files with the message `fix(admin): add today's tasks to the overview, name its tiles and label the open stage filter`.
