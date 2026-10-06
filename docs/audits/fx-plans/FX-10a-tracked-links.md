# FX-10a: Tracked links never 500; staff screens report denials honestly. Implementation plan

**Status:** draft for owner review. It is based on `main` (4965d48) and does not depend on any open PR. No owner decisions have been recorded yet; the Open questions below list the defaults I will use unless told otherwise.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- A customer who taps a tracked `/w/<code>` WhatsApp link always lands in a WhatsApp chat with **the company number**, or on `/contact` when no valid company number is configured. This holds even during a Neon outage or a missing company setting. They never see a 500 page, and the fallback can never open a chat with any other number.
- A production deploy whose WhatsApp intake or tracked-link settings are incomplete fails at build time, while the previous deploy keeps serving. A preview deploy only warns.
- The operations health page reports WozTell as failed when `WOZTELL_APP_ID` is missing. Without that variable, every webhook gets a 503.
- On every WhatsApp staff screen, a 401, 403 or 409 from the server is shown as a zh-HK error. It never appears as 「已儲存」. The screen also no longer crashes, and a link batch no longer advances.

Findings: C-08 (= B-06), C-07 (= D-05), B-03.

**Approach.**
- **Tracked redirect.**
  - The body of `trackedRedirect` moves unchanged into a private `trackedRedirectOrThrow`, which records the step it reached in a `progress.stage` field.
  - The exported `trackedRedirect` wraps it in `try/catch`. Any throw returns a 302 to the general company fallback with `X-WA-Tracking: untracked`, and logs one line: `WA_TRACKED_REDIRECT_FALLBACK {"reason","stage","errorName"}`. The line holds no link code, URL, phone number, error text or SQL.
  - The fallback location comes from one pure helper, `companyFallbackLocation(env)`. It returns `EP_WA_COMPANY_PHONE` if valid, else `VITE_CONTACT_WHATSAPP_PHONE` if valid, else `/contact`. "Valid" means it passes both `companyWhatsappHref`'s regex and `whatsappPhoneProblem`. The helper reads **environment variables only**, never the request, the link row or the database, and it never throws.
  - Today's `fallback()` closure uses the same helper, so a malformed company phone can no longer make the fallback itself throw (fact 2).
- **Build check.** `scripts/check-required-env.mjs` gets one more block. It applies when `WOZTELL_ENABLED=true` or `EP_WA_TRACKED_LINKS_ENABLED=true`. It **fails a production build and only warns on a preview build**, and prints variable names only, never values.
- **Health.** The control-plane `woztell` health row adds `appId` to its details, and requires it before it reports healthy.
- **Staff calls.** One new client module, `src/lib/neon/staff-server-fn.ts`, exports `callStaffServerFn(serverFn, options?, isWorkspaceCurrent?)`. It works in three steps:
  1. it adds the staff bearer header via `withStaffAuthHeaders` from `@/auth`;
  2. it keeps the existing `dispatchWorkspaceRequest` lifetime gate;
  3. it pipes the result through the existing `unwrapServerFnResponse`.

  Like FX-04's background variant, it **does not** reload the page, so it is safe for polls.
  - The 17 modules and 2 components that call `withStaffAuthHeaders` without unwrapping (fact 11) switch to it.
  - `admin-data.ts` and `content-copilot-admin.ts` keep their private copies in this PR, so this PR stays out of #223's hunk.
  - A node contract test pins the rule for every current and future file.
- **Error copy.** Five screens print `error.message` verbatim (fact 17). Once a denial throws, they would show `Forbidden` or a code such as `BATCH_PREVIEW_EXPIRED`. They switch to a new `staffActionErrorText(error, fallback)` next to the existing `adminErrorText`. It maps 401, 403 and 409 to **existing** zh-HK strings and adds **no new copy**. Screens that already show a generic zh-HK failure message stay as they are.
- **No migration. No new env var. No new `VITE_*` variable.** Public URLs stay as they are: `/w/$code` and the webhook URL are unchanged.

**Tech stack.**
- `node --test` for `.mjs` files: the redirect tests, the env-script tests run through `spawnSync`, the health test and the contract test.
- `bun test --no-env-file` for `.ts` files: the wrapper, the module table and the error text. These use `mock.module`, which `src/auth.test.ts:7-20` already uses.
- Playwright with `playwright.admin-owned.config.ts` and the `link-bulk-owned` fixture.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md` (on branch `fix/fx-01-public-form-feedback`): B-03 (:166), C-07 (:192), C-08 (:193).
- Fix plan `docs/audits/2026-10-fix-plan.md` (same branch): FX-10a (:472-489), Global constraints (:17-40), Review focus 1 (:43, `/api/*` and `/w/*` are never host-redirected; owned by FX-13).

## Verified current behaviour (main 4965d48)

| # | Fact | Where |
|---|---|---|
| 1 | **`/w/$code` has no error boundary.** The route's `GET` and `HEAD` handlers return `trackedRedirect(request, params.code)` directly. Any throw becomes the framework's 500. | `src/routes/w.$code.ts:4-11` |
| 2 | **What `fallback()` produces today.** It returns a 302 with no-store headers to `companyWhatsappHref(EP_WA_COMPANY_PHONE, "您好，我想向晉誠地產查詢。樓盤供應請向職員確認。")` when `EP_WA_COMPANY_PHONE` is set. When the variable is unset, it goes to `/contact`. **When it is set but malformed** (for example `+852…` or spaces), `companyWhatsappHref` throws `WA_COMPANY_PHONE_REQUIRED`, so the fallback *itself* throws, which means a 500. It never reads `VITE_CONTACT_WHATSAPP_PHONE`, although the fix plan says it does. Only `resolveTrackingLinks` uses `EP_WA_COMPANY_PHONE ?? VITE_CONTACT_WHATSAPP_PHONE`. | `src/lib/neon/whatsapp-enquiries.server.ts:339-350`, `:240`; `src/lib/whatsapp-enquiries/links.ts:26-29` |
| 3 | **Every throw path in `trackedRedirect` (`:332-447`):** (a) `companyChannel()` at `:353`, which throws `WA_COMPANY_CHANNEL_REQUIRED` when `EP_WA_COMPANY_CHANNEL_ID` is missing or longer than 160 characters (`:34-37`); (b) the global rate-bucket upsert at `:360`; (c) `maybePruneRedirectBuckets` at `:361` (DB); (d) the link lookup at `:369`; (e) the offer lookup at `:377`; (f) the per-link rate upsert at `:386`; (g) `companyWhatsappHref(phone,"")` at `:413-414`, which throws when `EP_WA_COMPANY_PHONE` is missing or malformed, **even for a valid registered link**; (h) the staff-alias lookup at `:419`; (i) the `whatsapp_link_opens` insert at `:431`; (j) `companyWhatsappHref(phone,text)` at `:446`, which cannot throw after (g). The prefetch path (`:351`, 204) and the disabled-tracking path (`:352`) run no query. The 429 response at `:365-368` is deliberate throttling, not an error. | as listed |
| 4 | **Wrong-number analysis.** Every `wa.me` target is built from `process.env.EP_WA_COMPANY_PHONE`, at `:340`, `:402` (through `resolvePublicWaAction` → `toWhatsAppHref`) and `:413`. The link row has no phone column; it holds staff and property **ids** (`linkDto` `:46-67`). Request query parameters are never read. `redirect.test.mjs:30-43` already asserts that `?phone=999` never reaches a query. So today no number can come from the link or the request. The fix must keep that true for the fallback. | `whatsapp-enquiries.server.ts:46-67,332-447`; `src/lib/contact-links.ts:52-59` |
| 5 | **Logging today.** The only app log is `console.warn("WA_REDIRECT_LINK_LIMITED", JSON.stringify({ linkId }))`. A thrown error is not logged by the app at all; only the platform's 500 is recorded. | `whatsapp-enquiries.server.ts:407` |
| 6 | **The redirect test file already exists.** `src/lib/whatsapp-enquiries/redirect.test.mjs` has 97 lines and 3 tests: AT-15/19, AT-26 and AT-37. It is wired into `test:whatsapp-enquiries` (`package.json:91`, CI `ci.yml:101`), with `redirect-capacity.test.mjs` (`:73-140`). The tests inject `query` and set and restore `process.env`. | as listed |
| 7 | **`scripts/check-required-env.mjs`** runs as `prebuild` (`package.json:8`) and acts only when `VERCEL_ENV` is `production` or `preview` (`:32-33`). Its rules: an https origin is required in **production only**, with an explicit comment that previews run on generated hosts (`:41-63`). The three `VITE_CONTACT_*` variables plus `whatsappPhoneProblem` **fail both production and preview** (`:65-102`). The checks run at top level and call `process.exit(1)`. **There is no test file**; `legacy-detail.contract.test.mjs:44` only greps for `resolveSiteOrigin()`. Its messages print the origin and phone values. | `scripts/check-required-env.mjs:1-102` |
| 8 | **Flag names.** The tracked-link flag is `EP_WA_TRACKED_LINKS_ENABLED` (`whatsapp-enquiries.server.ts:39-41`). `WOZTELL_ENABLED` is the real name (`src/lib/woztell/woztell.server.ts:357-367`). **The webhook ignores `WOZTELL_ENABLED`:** it needs `WOZTELL_CHANNEL_SECRET` for the signature (`:82-91`), and both `WOZTELL_CHANNEL_ID` and `WOZTELL_APP_ID` before it stores a receipt, otherwise it returns 503 `WA_RECEIPT_SCOPE_CONFIGURATION_REQUIRED` (`:110-115`). `WOZTELL_APP_ID` is read in exactly one place (`:80`). | `src/lib/whatsapp-enquiries/webhook.server.ts:68-115` |
| 9 | **Health.** The control-plane `woztell` row checks `enabled`, `accessToken`, `channelId` and `channelSecret`, **but not `appId`**. It is `failed` when enabled and incomplete, and `degraded` when disabled. `environmentChecks` is not exported. The only test touching this row is `control-plane.test.mjs:175`, which uses a literal object with `aggregateHealth`. #227 edits `health.server.ts` at `:1-14` and `:126+` only. | `src/lib/control-plane/health.server.ts:66-128` (woztell `:82-91`, row `:108-112`) |
| 10 | **Activation doc.** It lists `WOZTELL_ENABLED`, `_BOT_ACCESS_TOKEN`, `_CHANNEL_ID` and `_CHANNEL_SECRET`, with **no `WOZTELL_APP_ID`** (`:7-12`). The webhook is registered at `https://earnestproperty.vercel.app/api/woztell/webhook` (`:22`). `.env.example:194` does list `WOZTELL_APP_ID`. | `docs/woztell-activation.md` |
| 11 | **B-03 inventory: 19 files, 51 call sites, none unwrapped.** The audit's list names "whatsapp-enquiries", but `src/lib/neon/whatsapp-enquiries.ts` never calls `withStaffAuthHeaders`. Its staff server functions are called bare by two **components**. The real list follows. **Link area (Task 2):** `whatsapp-link-management.ts:3,15-16`; `whatsapp-link-selection.ts:3,14-15`; `whatsapp-link-import.ts:3,39-40`; `whatsapp-link-batches.ts:4,48-82` (3, via `dispatchWorkspaceRequest`); `whatsapp-coverage.ts:3,31-34` (2); `src/lib/admin/whatsapp-link-export-api.ts:3,27-30` (2); `src/components/admin/whatsapp/WhatsappLinksTable.tsx:5-6,120-129` (`saveWhatsappTrackingLink`); `src/components/admin/whatsapp/WhatsappLinkWizard.tsx:5-6,646-650` (`searchWhatsappLinkOffers`). **Staff and enquiry area (Task 3):** `staff-endpoints.ts:4,45-112` (6, workspace); `staff-notifications.ts:4,48-53` (3); `staff-reference-admin.ts:5,39-62` (3, workspace); `whatsapp-assignment.ts:5,50-142` (6, two via workspace); `whatsapp-readiness.ts:4,20-25` (2); `whatsapp-service-health.ts:3,9-11` (1); `whatsapp-service-policy.ts:4,37-63` (3, workspace); `whatsapp-test-notification.ts:4,43-114` (5, workspace); `inbox-directory.ts:4,21-69` (4); `forwarded-enquiries.ts:4,33-78` (4); `enquiry-resolution.ts:4,24-42` (2). All of them are under `src/lib/neon/` unless another path is given. | `grep -rn withStaffAuthHeaders src` |
| 12 | **Files that already unwrap every call** (B-03: "as admin-data, admin-cms and admin-team already do"): `admin-data.ts` (81 calls), `admin-cms.ts`, `admin-team.ts` (through its local `withStaffHeaders` `:224-248`), `admin-properties.ts`, `admin-property-bulk.ts`, `admin-property-sync.ts`, `src/lib/ai/content-copilot-admin.ts`, `src/lib/analytics/reporting-client.ts` and `sales-performance-client.ts`. In each, every `withStaff(Auth)?Headers(` call sits in a statement that contains `unwrapServerFnResponse(`, `callStaffServerFn(` or `callStaffServerFnInBackground(`, or it feeds a `fetch("/api/…")` within the next 400 characters (six raw `/api/admin/woztell/*` calls in `admin-data.ts:1466-1750`). I checked this rule with a script against main and against #222, #223, #228 and #229: 0 violations. `src/lib/admin/operations/operations-client.ts:16-20` uses the header only for a raw `fetch` to `/api/admin/control-plane` and maps the status itself. `src/lib/neon/auth.server.ts:99` mentions the name only in a JSDoc comment. | as listed |
| 13 | **The unwrap primitive.** `unwrapServerFnResponse(promise)` awaits the promise. If the result is a `Response`, it throws `ServerFnResponseError(bodyText \|\| "HTTP <status>", status)`. Anything else passes through. | `src/lib/neon/server-fn-response.ts:31-58` |
| 14 | **The existing local helpers.** `admin-data.ts:377-393` `callStaffServerFn` = unwrap, then clear the reload flag. On error it calls `reloadOnStaleServerFunction`, which reloads once on 404/410 or `HTTPError` with a 5xx/null status, never for a `ServerFnResponseError` (`:331-375`). **That reload logic is already on main.** #223 (`fix/fx-04-admin-attention`) does **not** change it. It only adds `callStaffServerFnInBackground` (unwrap, no reload) at `:395-398`, plus `fetchAdminAttentionCounts`, `fetchAdminTodayTasks`, `fetchAdminPageInBackground` and `fetchCommandCenterInBackground`. `content-copilot-admin.ts:44-65` has its own private `callStaffServerFn`, which maps 401/403 to `{ ok:false, error:"COPILOT_UNAUTHORIZED"\|"COPILOT_FORBIDDEN" }`. | as listed; `git diff origin/main...origin/fix/fx-04-admin-attention -- src/lib/neon/admin-data.ts` |
| 15 | **Unwrapping cannot misread a real result.** I followed every server import behind the 19 files. No handler *returns* a `Response`; the only server code that does is `trackedRedirect`, which is a route handler, not a server function. `getWhatsappAssignment`'s handler catches its own errors and returns `{ kind:"error", code, statusCode, requestId }` (`whatsapp-assignment.ts:6-48`), so unwrapping leaves it unchanged. | script over `import("…server")` targets |
| 16 | **What staff see today on a denial.** (a) **Links table:** a 401 or 403 from `saveWhatsappTrackingLink` resolves, so the table shows 「已儲存新版本；短連結不變。」 (`WhatsappLinksTable.tsx:120-131`). A link **version conflict** is a plain `throw new Error("WA_LINK_VERSION_CONFLICT")` (`whatsapp-enquiries.server.ts:168,206`), which already rejects; the audit's "409" example for this screen is really a 401/403. (b) **Staff endpoint:** a 409 `ENDPOINT_PERMISSION_OR_VERSION_CONFLICT` (`staff-endpoints.server.ts:125,165`) resolves, so the editor clears the form as if saved (`StaffEndpointEditor.tsx:150-157`). (c) **Offer search, worse:** `setFound(<Response>)` makes `found.map` throw during render, and the wizard crashes (`WhatsappLinkWizard.tsx:646-650,663`). (d) **Batch commit, worse:** a resolved 403 or 409 is pushed into `completed` as a chunk with no `state`. `nextChunk` advances and the journal is marked certain (`src/lib/admin/whatsapp-link-batch-client.ts:136-152`). A thrown error instead takes the read-back path (`:153-168`), and the chunk ids are reused, so nothing is created twice. | as listed |
| 17 | **How each screen shows errors.** **A generic zh-HK message in `catch`, already honest once the call throws:** `StaffEndpointEditor.tsx:68-69,158-160,294-296`; `StaffReferenceEditor.tsx:44-45,71-73,167-169`; `StaffNotificationPanel.tsx:54-55,73-74`; `StaffTestNotificationDialog.tsx:58-59,76-78,101-103,141-143,260-262`; `operations/WhatsappServiceHealth.tsx:36-38,49-50`; `WhatsappBatchImport.tsx:100-101`; `ForwardedEnquiryForm.tsx:171-172`; `LeadContactEditor.tsx:102-106`; `EnquiryOnlyPanel.tsx`; `ForwardedEnquiryEvidence.tsx`; `RelatedLeadConversations.tsx`. **Status-aware already:** `EnquiryResolutionPanel.tsx:184-197` (403/409), `StaffMappingWizard.tsx:164-197` (409), `FolderLoadNotice.tsx:10-16` (403). These read `.status`, which `ServerFnResponseError` carries. **Verbatim `error.message`, which would show `Forbidden` or a code:** `WhatsappLinksTable.tsx:63,80`; `WhatsappLinkWizard.tsx:274`; `WhatsappCoveragePanel.tsx:43,74`; `WhatsappServicePolicyEditor.tsx:99`; `src/routes/admin.listings.tsx:378`. **Existing zh-HK strings to reuse:** 「登入已失效，請重新登入後再試。」 and 「你沒有權限進行此操作。」 (`admin-data.ts:178-179`); 「資料版本已變更，請重新載入並核對後再儲存。」 (`TransactionAttributionEditor.tsx:124`); `adminErrorText` (`src/components/admin/admin-error-text.ts:13-29`). | as listed |
| 18 | **Browser fixtures.** Every admin fixture aliases `@/auth` to a stub, `withStaffAuthHeaders = async (value) => value`. The `link-bulk-owned` fixture also aliases the lib modules in fact 11 to `synthetic-api.ts`, but **not** components and not new modules (`scripts/browser-fixtures/build-admin-link-bulk-owned.mjs:18-36`). A real `src/lib/neon/staff-server-fn.ts` imported as `@/auth` therefore resolves to the stub, and the two components exercise the real wrapper. The fixture state is `window.ownedLinkBulk` (`link-bulk-owned/synthetic-batches.ts:17-41`). `searchWhatsappLinkOffers` returns 60 synthetic offers (`synthetic-api.ts:40-42`). The Bun handoff fixture (`build-whatsapp-link-handoff.ts:11-21`, used by `acceptance:whatsapp-link-handoff`, not in CI) also intercepts `@/auth`. | as listed |
| 19 | **Wiring.** `src/test-wiring.test.mjs:38-52` requires every `src/**/*.test.*` file to be named in a `test:*` script. `:86-123` requires every non-environment `test:*` script to appear as `- run: npm run <name>` in `ci.yml`. The relevant scripts are `test:control-plane` (`package.json:42`, CI `:106`), `test:whatsapp-enquiries` (`:91`, CI `:101`), `test:staff-notifications` (`:94`, CI `:100`, **rewritten by #225**), `test:contact` (`:35`) and `test:admin-link-bulk:ui` (`:121`, CI `:83`). | as listed |

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real number.
  - The fallback may open only the configured **company** number. No number may come from the request, the link, the offer, the staff alias or the database (fact 4).
  - Tests use `85212345678` (the existing fixture) and `85291234567` as company numbers, and `85299999999` as a hostile number.
  - Nothing talks to WozTell, Neon or Vercel. Redirect tests inject `query`. Env-script tests spawn the script with a **minimal** env (`PATH`, `SystemRoot`, plus fixture values) and never spread `process.env`.
  - Production is read-only for me.
- **Logs.** `WA_TRACKED_REDIRECT_FALLBACK` carries exactly three keys:
  - `reason`, one of `company_channel_missing`, `company_phone_invalid` or `unexpected`;
  - `stage`, one of `config`, `rate`, `link`, `offer`, `phone`, `alias` or `open`;
  - `errorName`, which matches `/^[A-Za-z]{1,40}$/`, else `"Error"`.

  No link code, URL, query string, phone, error message, stack or SQL may appear. The env script prints **names** only. The new block never echoes a value; existing messages are unchanged.
- **Redirect semantics.**
  - The happy path, the prefetch 204, the disabled-tracking fallback, the 429 throttle and the link-limited 302 are byte-for-byte unchanged. The existing tests in `redirect.test.mjs` and `redirect-capacity.test.mjs` stay as they are.
  - An error after the open insert cannot happen (fact 3j). If it ever did, the fallback has no `EPWA:` reference.
- **Wrapper.**
  - `staff-server-fn.ts` imports `withStaffAuthHeaders` from exactly `"@/auth"` (fixture alias, fact 18).
  - It imports `unwrapServerFnResponse` from `./server-fn-response` and `dispatchWorkspaceRequest` from `../admin/workspace-request`.
  - It must not import any `.server` or `server-only` module (the fixtures' `forbid-server-imports` plugin).
  - It must not call `window.location.reload`.
- **Do not touch** `src/lib/neon/admin-data.ts`, `src/lib/ai/content-copilot-admin.ts`, `src/components/admin/StaffEndpointEditor.tsx`, `StaffMappingWizard.tsx`, `operations/WhatsappServiceHealth.tsx`, `control-plane.test.mjs`, `package.json:94` (`test:staff-notifications`), any `scripts/browser-fixtures/build-*.mjs`, or `link-bulk-owned/synthetic-flags.ts`.
- **Copy.**
  - No new user-facing strings. 401, 403 and 409 reuse the three strings in fact 17.
  - Every unrecognised status error falls back to the screen's existing generic message.
  - No brand or marketing copy changes.
- **Configuration.** No new env var and no `VITE_*` var. `VITE_CONTACT_WHATSAPP_PHONE` is only **read** server-side, as `resolveTrackingLinks:240` already does.
- **Avoid conflicts with open PRs.** Diffs were taken with `git diff --stat origin/main...origin/fix/<branch>`:

  | PR | Branch | Overlap with FX-10a | Rule |
  |---|---|---|---|
  | #221 | `fix/fx-01-public-form-feedback` | `package.json:35,121-122`; `ci.yml:83-84` | None. The new script goes after `package.json:91`, the CI line after `ci.yml:101`. |
  | #222 | `fix/fx-03-live-agent-handoff` | `admin-data.ts` (end), `package.json:52` | Do not edit `admin-data.ts`. The contract rule accepts #222's additions (checked). |
  | #223 | `fix/fx-04-admin-attention` | `admin-data.ts:395-450,653-700` (`callStaffServerFnInBackground` and callers); `package.json:39,117` | Do not edit `admin-data.ts`. The contract's legacy rule accepts `callStaffServerFnInBackground(` (checked: 84 calls, 0 violations). Consolidation is a follow-up. |
  | #224 | `fix/fx-05a-ui-flags` | `WhatsappLinkWizard.tsx:43-55,619-637`; `StaffMappingWizard.tsx`; `e2e/admin-link-bulk-owned.spec.ts:749-759` (deleted); `link-bulk-owned/synthetic-flags.ts` (deleted); `build-admin-link-bulk-owned.mjs` | In the wizard, edit only `:5-6`, `:274` and `:646-650`. Insert the new e2e test **after `:701`**, not at the end. Do not touch the build script or the flags file. |
  | #225 | `fix/fx-05b-lead-alert` | As #224, plus `StaffEndpointEditor.tsx:86`, `package.json:15,94,124`, `ci.yml:157`, `whatsapp-test-notification.server.ts` and `staff-notifications.server.ts` | Do not edit `StaffEndpointEditor.tsx` or `package.json:94`. Edit only the **client** wrappers `whatsapp-test-notification.ts` and `staff-notifications.ts`, which #225 does not touch. |
  | #226 | `fix/fx-06-manager-wa-access` | `package.json:124`; `ci.yml:157` | None. |
  | #227 | `fix/fx-07-jobs-drain` | `health.server.ts:1-14,126+`; `control-plane.test.mjs:8,182+`; `WhatsappServiceHealth.tsx` | Edit `health.server.ts` only at `:66` (`export`) and `:82-91`. Put the health test in a **new** file. Do not edit `WhatsappServiceHealth.tsx`. |
  | #228 | `fix/fx-08-optout-unknown` | `package.json:80`; `ci.yml:103,149` | None; the CI line after `:101` is two lines away. |
  | #229 | `fix/fx-09-lead-integrity` | `package.json:113`; `ci.yml:80,99,145` | None; insert after `ci.yml:101`, not `:99`. |
- **Committing.**
  - Stage paths with `git add <paths>` only. Never add `bun.lockb`, which is already dirty in this worktree.
  - Use conventional commits with a scope, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes:**
  - `npm run lint`;
  - `npm run typecheck`;
  - its listed suites.
- **The PR as a whole also passes:**
  - `npm run build`;
  - every `playwright.admin-owned.config.ts` suite: `test:admin-daily-work:ui`, `test:admin-campaign-review:ui`, `test:admin-performance:ui`, `test:admin-link-bulk:ui` and `test:property-maintenance:ui` (the latter aliases `@/auth` and several fact-11 modules);
  - `test:whatsapp-mobile:ui` and `test:staff-setup:ui`;
  - before/after screenshots at 375 px and 1440 px of the link wizard's denied search (Task 4).

## Review Focus

These are the six likeliest failure modes that no fix-plan test covers. Each has a named test in its owning task.

1. **The fallback itself throws, or opens a number other than the company's.** A malformed `EP_WA_COMPANY_PHONE` makes today's `fallback()` throw (fact 2). A careless catch could build the target from the link, the offer agent or `?phone=`. *Tests (Task 1):* `a failure at every stage falls back to the company number only` and `a malformed or missing company phone falls back without throwing`.
2. **The fallback log leaks personal data or secrets.** DB driver errors can include connection strings, and request URLs can include phone numbers. *Test (Task 1):* `the fallback log never contains the link code, request URL, phone numbers or error text`.
3. **The build check blocks a healthy production deploy, or blocks previews.** *Tests (Task 1):* `preview builds only warn`, `flags off requires nothing new`, and `complete production configuration passes and never prints values`. Owner action 1 confirms the production variable **names** before merge.
4. **Unwrapping turns a real result into an error.** Possible culprits: a handler returning `{ ok:false }`, `null` or `[]`; a fixture stub returning plain data; a handler that deliberately returns a `Response` (none today, fact 15). *Tests (Task 2):* `genuine results pass through unchanged, including { ok: false }, null and []`, plus the module table.
5. **A migrated module, or a future one, skips the wrapper.** *Test (Task 2/3):* the contract test `no staff module calls withStaffAuthHeaders outside the wrapper`, with an exact exemption list.
6. **A browser fixture stops resolving `@/auth`.** This happens if the wrapper imports auth relatively; the components would then run the real Neon auth in fixtures. *Test (Task 2):* the contract asserts the import specifier is exactly `"@/auth"`. *E2E (Task 4):* `denied offer search shows the zh-HK permission message and no false results`.

## Out of scope / follow-ups

| Follow-up | Owner | What it must do |
|---|---|---|
| Consolidate `admin-data.ts`'s private `callStaffServerFn`/`callStaffServerFnInBackground` (#223) and `content-copilot-admin.ts`'s onto `staff-server-fn.ts` | Cleanup after #223 merges (FX-17a or its own PR) | Add an opt-in `{ reloadOnStale: true }` to the shared helper. Move admin-data's reload heuristic into it. Shrink the contract's legacy list. |
| Map 401 to 「登入已失效…」 on the generic-copy screens (fact 17) | FX-17a (clearer copy) | Copy-only. The failure is already honest after this PR. |
| `/w/` global 429 sends the customer to an untracked company chat instead of a text page | FX-13 or FX-19c | This is a throttling policy decision, not an error path. |
| The webhook URL moves to the www host | FX-13 | Only after FX-13's `/api/*` exclusion ships (fix-plan Review focus 1). The doc keeps `vercel.app`. |
| `EP_WA_COMPANY_CHANNEL_ID` must equal `WOZTELL_CHANNEL_ID`; add `WOZTELL_APP_ID` to `release-readiness.mjs` `woztell.bot` | FX-19c (WhatsApp variable consolidation) | FX-10a checks presence only. |

---

### Task 1: Tracked links fall back to the company WhatsApp; builds and health check the intake configuration (C-08, C-07)

**Files:**
- **Modify `src/lib/neon/whatsapp-enquiries.server.ts`:**
  - Imports (`:1-32`): add `import { whatsappPhoneProblem } from "../../config/whatsapp-phone.js";`.
  - After `trackingEnabled()` (`:39-41`), add `GENERAL_ENQUIRY_TEXT` (the existing literal from `:346`) and `companyFallbackLocation` (interface below).
  - `:332-447`:
    1. Rename the existing function to the **non-exported** `trackedRedirectOrThrow(request, code, query, progress)`.
    2. Set `progress.stage` immediately before `:353` (`config`), `:357` (`rate`), `:369` (`link`), `:377` (`offer`), `:413` (`phone`), `:418` (`alias`) and `:431` (`open`).
    3. Inside it, `fallback()` (`:339-350`) now uses `companyFallbackLocation()` and never throws.
    4. Add the exported wrapper `trackedRedirect` (interface below) directly above it.
  - Leave every other line unchanged. `src/routes/w.$code.ts` is unchanged.
- **Modify `src/lib/whatsapp-enquiries/redirect.test.mjs`:** append after `:97`.
- **Modify `scripts/check-required-env.mjs`:**
  - Add `const WHATSAPP_INTEGRATION = …` after `:30`.
  - Append the new block after `:102`. It runs only when `isVercelDeploy`. It collects `problems` (strings that name variables, never values):
    - When `WOZTELL_ENABLED === "true"`, each missing `WOZTELL_APP_ID`, `WOZTELL_CHANNEL_ID` or `WOZTELL_CHANNEL_SECRET` is reported as `<NAME> is not set (WOZTELL_ENABLED=true)`.
    - When `EP_WA_TRACKED_LINKS_ENABLED === "true"`: `EP_WA_COMPANY_CHANNEL_ID is not set or is longer than 160 characters`, and `EP_WA_COMPANY_PHONE is not a usable company WhatsApp number`. The phone fails `/^[1-9]\d{7,14}$/` or `whatsappPhoneProblem` returns non-null. **The value is not printed.**
  - In production, problems mean `console.error` of a "Build blocked (production): …" block, then `process.exit(1)`. In preview, they mean `console.warn("[check-required-env] warning (preview): …")` and the script continues.
  - Update the header comment (`:1-21`) with one paragraph on the new rule and why previews only warn.
- **Create `scripts/check-required-env.test.mjs`** (node; uses `spawnSync`).
- **Modify `src/lib/control-plane/health.server.ts`:**
  - `:66`: `function environmentChecks()` becomes `export function environmentChecks()`.
  - `:82-87`: add `appId: present(process.env.WOZTELL_APP_ID),` after `channelId`.
  - `:91`: `woztellComplete` also requires `woztell.appId`.
- **Create `src/lib/control-plane/environment-health.test.mjs`** (node).
- **Modify `package.json:42`** (`test:control-plane`): append `src/lib/control-plane/environment-health.test.mjs scripts/check-required-env.test.mjs` to its `node --test` list. CI already runs it (`ci.yml:106`).
- **Modify `docs/woztell-activation.md`:**
  - Add `WOZTELL_APP_ID=<WozTell app id>` after `:10`.
  - Add a "Tracked `/w/` links" section listing `EP_WA_TRACKED_LINKS_ENABLED`, `EP_WA_COMPANY_PHONE` (digits only, the company WhatsApp, never a staff phone) and `EP_WA_COMPANY_CHANNEL_ID`.
  - Add one sentence: "A production build fails when `WOZTELL_ENABLED=true` or `EP_WA_TRACKED_LINKS_ENABLED=true` and these are missing; preview builds only warn."
  - Add a note under `:22`: "Keep this URL on `earnestproperty.vercel.app` until FX-13 ships the `/api/*` host-redirect exclusion."

**Interfaces:**
```ts
// whatsapp-enquiries.server.ts
const GENERAL_ENQUIRY_TEXT = "您好，我想向晉誠地產查詢。樓盤供應請向職員確認。"; // existing :346 literal, moved
/**
 * The only place a fallback WhatsApp target is chosen. Reads env only:
 * EP_WA_COMPANY_PHONE if valid, else VITE_CONTACT_WHATSAPP_PHONE if valid, else "/contact".
 * Valid = /^[1-9]\d{7,14}$/ AND whatsappPhoneProblem(value) === null. Never throws.
 */
export function companyFallbackLocation(
  env?: Record<string, string | undefined>, // default process.env
): string;
type TrackedRedirectStage = "config" | "rate" | "link" | "offer" | "phone" | "alias" | "open";
/** Never throws. Any error → 302 companyFallbackLocation() + X-WA-Tracking: untracked + one log line. */
export async function trackedRedirect(
  request: Request,
  code: string,
  query = queryRows,
): Promise<Response>;
// catch body:
//   const reason = error instanceof Error && error.message === "WA_COMPANY_CHANNEL_REQUIRED" ? "company_channel_missing"
//                : error instanceof Error && error.message === "WA_COMPANY_PHONE_REQUIRED"   ? "company_phone_invalid"
//                : "unexpected";
//   const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "Error";
//   console.error("WA_TRACKED_REDIRECT_FALLBACK", JSON.stringify({ reason, stage: progress.stage, errorName: name }));
//   return new Response(null, { status: 302, headers: { ...noStoreHeaders, Location: companyFallbackLocation(), "X-WA-Tracking": "untracked" } });

// health.server.ts
export function environmentChecks(): HealthCheck[]; // woztell.details gains appId: boolean
```

- [ ] **Step 1: write the failing tests.**
  - `redirect.test.mjs` (append). Each test saves and restores `process.env`, sets `EP_WA_TRACKED_LINKS_ENABLED=true`, `EP_WA_COMPANY_CHANNEL_ID=fixture` and `EP_WA_COMPANY_PHONE=85212345678`, deletes `VITE_CONTACT_WHATSAPP_PHONE` unless stated, and captures `console.error` with `t.mock.method(console, "error")`.
    - `DB error → 302 to wa.me fallback` (fix-plan name):
      - `query` throws `new Error("connect ECONNREFUSED postgres://owner:s3cret@db.internal/neondb")` on its first call.
      - Status 302. `Location` starts with `https://wa.me/85212345678?text=` and decodes to 「您好，我想向晉誠地產查詢。樓盤供應請向職員確認。」 with no `EPWA`.
      - `X-WA-Tracking` is `untracked` and `Cache-Control` matches `/no-store/`.
      - `console.error` was called once, with `["WA_TRACKED_REDIRECT_FALLBACK", '{"reason":"unexpected","stage":"rate","errorName":"Error"}']`.
    - `missing company channel → fallback` (fix-plan name): delete `EP_WA_COMPANY_CHANNEL_ID`. 0 queries, a 302 to the company `wa.me`, and the log is `{"reason":"company_channel_missing","stage":"config","errorName":"Error"}`. Repeat with a 161-character channel: same result.
    - `a failure at every stage falls back to the company number only` (Review Focus 1):
      - The request is `https://fixture/w/abcdefghijklmnop?phone=85299999999&to=85299999999`.
      - The link row has `property_id`, `public_listing_no:"A074714"`, `deal_type:"sale"`, `requested_staff_id`, `reference_mapping_id` and an extra field `phone:"85299999999"`. The offer row has `agent_id`. The alias row has `staff_id` equal to `requested_staff_id`.
      - For each marker, make **only** that query throw: `"request_count"` on its 1st call (`rate`); `"JOIN whatsapp_tracking_link_versions"` (`link`); `"FROM properties"` (`offer`); `"request_count"` on its 2nd call (`rate`, per-link); `"staff_external_references"` (`alias`); `"INSERT INTO whatsapp_link_opens"` (`open`).
      - Every response is 302, with `Location` starting `https://wa.me/85212345678?`. No `Location` and no log line contains `99999999`.
      - The logged `stage` equals the expected stage, and no response status is ≥ 500.
    - `a malformed or missing company phone falls back without throwing` (Review Focus 1). For a registered link whose queries all succeed:
      - `EP_WA_COMPANY_PHONE="+852 1234 5678"` with `VITE_CONTACT_WHATSAPP_PHONE="85291234567"` → 302 `https://wa.me/85291234567?…`, log `company_phone_invalid` at stage `phone`, and no `INSERT INTO whatsapp_link_opens` call.
      - The same with `VITE_CONTACT_WHATSAPP_PHONE` unset → `Location: /contact`.
      - The same with `VITE_CONTACT_WHATSAPP_PHONE="85200000000"` (placeholder) → `/contact`.
      - The unregistered-link path (`link` query returns `[]`) with a malformed company phone → 302 to the VITE number. **No throw** (today it throws, fact 2).
    - `the fallback log never contains the link code, request URL, phone numbers or error text` (Review Focus 2). Collect every `WA_TRACKED_REDIRECT_FALLBACK` payload from the tests above. Each payload:
      - matches `/^\{"reason":"(company_channel_missing|company_phone_invalid|unexpected)","stage":"(config|rate|link|offer|phone|alias|open)","errorName":"[A-Za-z]{1,40}"\}$/`;
      - contains none of `abcdefghijklmnop`, `s3cret`, `postgres`, `85299999999`, `85212345678` or `fixture/w`.
    - `companyFallbackLocation prefers EP_WA_COMPANY_PHONE, then VITE_CONTACT_WHATSAPP_PHONE, and reads nothing else` (pure):
      - `{EP:"85212345678", VITE:"85291234567"}` → EP `wa.me`.
      - `{EP:"", VITE:"85291234567"}` → VITE.
      - `{EP:"85226882988"}` (landline), no VITE → `/contact`.
      - `{}` → `/contact`.
      - `{ phone:"85299999999", EP_WA_PHONE:"85299999999" }` → `/contact`.
      - It never throws for `undefined`, `"abc"` or `"+85212345678"`.
    - `prefetch, disabled tracking and the happy path are unchanged`:
      - HEAD → 204 with 0 queries.
      - `EP_WA_TRACKED_LINKS_ENABLED=false` → 302 to the EP `wa.me`, 0 queries, 0 log lines.
      - The AT-15/19 happy path still has 1 `whatsapp_link_opens` insert and an `EPWA:` reference, and logs nothing.
  - `scripts/check-required-env.test.mjs`. The helper is `run(extra)`: `spawnSync(process.execPath, ["scripts/check-required-env.mjs"], { cwd: repoRoot, encoding:"utf8", env: { PATH, SystemRoot, VERCEL_ENV:"production", VITE_SITE_URL:"https://www.example.test", VITE_CONTACT_WHATSAPP_PHONE:"85291234567", VITE_CONTACT_PHONE_DISPLAY:"9123 4567", VITE_CONTACT_PHONE_TEL:"+85291234567", ...extra } })`. The complete WhatsApp set is `{ WOZTELL_ENABLED:"true", WOZTELL_APP_ID:"fx10a-app-id-value", WOZTELL_CHANNEL_ID:"fx10a-channel-value", WOZTELL_CHANNEL_SECRET:"fx10a-secret-value", EP_WA_TRACKED_LINKS_ENABLED:"true", EP_WA_COMPANY_CHANNEL_ID:"fx10a-company-channel", EP_WA_COMPANY_PHONE:"85291234567" }`.
    - `production: WOZTELL_ENABLED=true without an intake variable blocks the build`. For each of `WOZTELL_APP_ID`, `WOZTELL_CHANNEL_ID` and `WOZTELL_CHANNEL_SECRET` removed from the complete set: `status === 1`, `stderr` contains that name, and `stdout+stderr` contains none of the other values.
    - `production: tracked links on without a usable company phone or channel blocks the build`. Removing `EP_WA_COMPANY_CHANNEL_ID` → 1. A 161-character channel → 1. Phone `85200000000` → 1. Phone `+85291234567` → 1. Phone removed → 1. Each `stderr` names the variable and does **not** contain the phone value.
    - `preview builds only warn` (Review Focus 3). With `VERCEL_ENV:"preview"` and the same gaps: `status === 0`, and the output contains `[check-required-env] warning (preview)` and the variable name.
    - `flags off requires nothing new`. `WOZTELL_ENABLED` and `EP_WA_TRACKED_LINKS_ENABLED` are absent (or `"false"`) and no WhatsApp vars are set: `status === 0`.
    - `complete production configuration passes and never prints values`. With the complete set: `status === 0`, and the output contains none of the seven values.
    - `local builds are unaffected`. With no `VERCEL_ENV` and nothing else set: `status === 0`.
  - `environment-health.test.mjs` (node; save and restore `process.env`):
    - `woztell health fails when enabled without WOZTELL_APP_ID`. The row with `key==="woztell"` has `status "failed"` and `details.appId === false`.
    - `woztell health is healthy only with app id, channel id, secret and token`.
    - `disabled woztell stays degraded`.
  - Run `npm run test:whatsapp-enquiries` and `npm run test:control-plane`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:whatsapp-enquiries`
  - `npm run test:control-plane` (includes `test-wiring`)
  - `npm run test:contact` (`whatsapp-phone`)
  - `npm run lint`
  - `npm run typecheck`
  - `VERCEL_ENV= npm run build`, as a local sanity check that prebuild is a no-op.
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): tracked links fall back to the company WhatsApp instead of a 500, and builds check intake config

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: Shared staff server-function wrapper, honest error text, contract test, and the WhatsApp-link screens

**Files:**
- **Create `src/lib/neon/staff-server-fn.ts`** (interface below). Its imports are `withStaffAuthHeaders` from `"@/auth"`, `unwrapServerFnResponse` from `"./server-fn-response"` and `dispatchWorkspaceRequest` from `"../admin/workspace-request"`. Nothing else.
- **Create `src/lib/neon/staff-server-fn.test.ts`** (bun, unit).
- **Create `src/lib/neon/staff-server-fn.modules.test.ts`** (bun, module table; Task 3 extends it).
- **Create `src/lib/neon/staff-server-fn.contract.test.mjs`** (node).
- **Modify `src/components/admin/admin-error-text.ts`:** after `adminErrorText` (`:22-29`), add `staffActionErrorText` (interface below). `ADMIN_ERROR_MESSAGES` is unchanged.
- **Create `src/components/admin/admin-error-text.test.ts`** (bun).
- **Migrate the link-area modules.** In each, replace `import { withStaffAuthHeaders } from "@/auth";` with `import { callStaffServerFn } from "./staff-server-fn";`, or `"../neon/staff-server-fn"` for the export API. Exported names and signatures stay the same.
  - `whatsapp-link-management.ts:3,15-16` → `callStaffServerFn(page, { data })`.
  - `whatsapp-link-selection.ts:3,14-15` → `callStaffServerFn(snapshot, { data: filters })`.
  - `whatsapp-link-import.ts:3,39-40` → `callStaffServerFn(lookup, { data })`.
  - `whatsapp-coverage.ts:3,31-34` → `callStaffServerFn(coverage, { data: filters })` and `callStaffServerFn(preview, { data: { propertyIds } })`.
  - `whatsapp-link-batches.ts:1,4,48-82` → `callStaffServerFn(<fn>, { data }, isWorkspaceCurrent)` for preview, commit and result. Drop the now-unused `dispatchWorkspaceRequest` import.
  - `src/lib/admin/whatsapp-link-export-api.ts:3,27-30` → `callStaffServerFn(prepare, { data })` and `callStaffServerFn(page, { data })`.
- **Migrate the two components:**
  - `WhatsappLinksTable.tsx`:
    - `:5` → `import { callStaffServerFn } from "@/lib/neon/staff-server-fn";`.
    - `:120-129` → `await callStaffServerFn(saveWhatsappTrackingLink, { data: { ...fields, id, expectedVersion: version } });`.
    - `:63` → `setError(staffActionErrorText(cause, "連結未能載入"))`.
    - `:80` → `setError(staffActionErrorText(cause, "操作未完成，請重試。"))`.
    - Add the `staffActionErrorText` import after `:13`.
  - `WhatsappLinkWizard.tsx`:
    - `:5` → the `callStaffServerFn` import.
    - `:646-650` → `setFound(await callStaffServerFn(searchWhatsappLinkOffers, { data: { q: query } }))`.
    - `:274` → `setError(staffActionErrorText(cause, "操作未完成，請重試。"))`.
    - Add the error-text import directly after `:6`. Do not touch `:40-60` or `:600-645` (#224/#225).
- **Modify the verbatim-message screens in this area:**
  - `WhatsappCoveragePanel.tsx:43` → `staffActionErrorText(cause, "覆蓋資料未能載入")`.
  - `WhatsappCoveragePanel.tsx:74` → `staffActionErrorText(cause, "補建預覽未完成")`.
  - `src/routes/admin.listings.tsx:378` → `staffActionErrorText(cause, "未能擷取符合篩選的樓盤")`.
  - Add the imports after the last existing import line of each file.
- **Modify `package.json`:** after `:91` (`test:whatsapp-enquiries`), insert:
  ```
  "test:staff-server-fn": "node --test src/lib/neon/staff-server-fn.contract.test.mjs && bun test --no-env-file src/lib/neon/staff-server-fn.test.ts src/lib/neon/staff-server-fn.modules.test.ts src/components/admin/admin-error-text.test.ts",
  ```
- **Modify `.github/workflows/ci.yml`:** insert `      - run: npm run test:staff-server-fn` after `:101`.

**Interfaces:**
```ts
// src/lib/neon/staff-server-fn.ts
type StaffCallOptions = { data?: unknown; headers?: HeadersInit };
/**
 * Every staff server-function call from the browser goes through here:
 *   withStaffAuthHeaders(options ?? {}) → dispatchWorkspaceRequest gate → serverFn(prepared)
 *   → unwrapServerFnResponse. A resolved Response (401/403/404/409/…) THROWS
 *   ServerFnResponseError(body, status). Never reloads the page (poll-safe).
 */
export async function callStaffServerFn<TResult, TOptions extends StaffCallOptions = StaffCallOptions>(
  serverFn: (options: TOptions & { headers: Headers }) => Promise<TResult> | TResult,
  options?: TOptions,
  isWorkspaceCurrent?: () => boolean,
): Promise<Exclude<Awaited<TResult>, Response>>;
// If TanStack's createServerFn client type defeats inference, type the parameter as
// `(options: never) => Promise<TResult>` and cast at the single call site inside the helper.
// Never cast at call sites in the 19 files.

// src/components/admin/admin-error-text.ts
/**
 * For a failed staff ACTION or load. Existing strings only:
 *   status 401 → "登入已失效，請重新登入後再試。"        (admin-data.ts:178)
 *   status 403 → "你沒有權限進行此操作。"                (admin-data.ts:179)
 *   status 409 → "資料版本已變更，請重新載入並核對後再儲存。" (TransactionAttributionEditor.tsx:124)
 *   any other numeric status (ServerFnResponseError, a thrown Response, or { status }) → fallback
 *   Error without status → adminErrorText(error.message) || fallback   (local validation text unchanged)
 *   anything else → fallback
 */
export function staffActionErrorText(error: unknown, fallback: string): string;
```

**Copy:** no new strings. The three mapped strings above are reused verbatim.

- [ ] **Step 1: write the failing tests.**
  - `staff-server-fn.test.ts`. Before a dynamic `import("./staff-server-fn")`, run `mock.module("@/auth", () => ({ withStaffAuthHeaders: async (o = {}) => ({ ...o, headers: new Headers({ authorization: "Bearer fx10a" }) }) }))`. If bun does not resolve the alias, mock the absolute path of `src/auth.ts`.
    - `409 Response → throws with message` (fix-plan name). `callStaffServerFn(async () => new Response("ENDPOINT_PERMISSION_OR_VERSION_CONFLICT", { status: 409 }), { data: {} })` rejects with an error that is an `instanceof ServerFnResponseError`, has `status === 409` and has `message === "ENDPOINT_PERMISSION_OR_VERSION_CONFLICT"`.
    - `401 and 403 Responses throw with their status`. An empty body becomes the message `HTTP 401`.
    - `genuine results pass through unchanged, including { ok: false }, null and []` (Review Focus 4).
    - `the server function receives the caller's data plus the staff bearer header`. The stub records `options.data` deep-equal to the input, and `options.headers.get("authorization") === "Bearer fx10a"`.
    - `a stale workspace aborts before the server function runs`. With `isWorkspaceCurrent = () => false`, it rejects with `WORKSPACE_REQUEST_CANCELLED`, and the stub is called 0 times.
    - `never reloads the page`. With `globalThis.window = { location: { reload: () => { reloads++ } } }`, a 404 and a `TypeError("HTTPError")` both reject, and `reloads === 0`.
  - `staff-server-fn.modules.test.ts`. Mock `@tanstack/react-start` so that `createServerFn()` returns a builder whose `inputValidator()` returns itself and whose `handler()` returns `(opts) => globalThis.__fx10aStub(opts)`. Mock `@tanstack/react-start/server` (`getRequest: () => new Request("https://fixture")`) and `@/auth` as above, then import the modules dynamically.
    - `every link-area staff wrapper rejects a resolved 401, 403 and 409 Response`. The table, as `[module, export, args]`:
      - `whatsapp-link-management` `getWhatsappTrackingLinksPage` `[{}]`
      - `whatsapp-link-selection` `snapshotWhatsappLinkOffers` `[{}]`
      - `whatsapp-link-import` `resolveWhatsappLinkImport` `[{ offers: [], references: [] }]`
      - `whatsapp-coverage` `getWebsiteTrackingCoverage` `[{}]` and `previewCoverageBackfill` `[[uuid]]`
      - `whatsapp-link-batches` `previewWhatsappLinkBatch`, `commitWhatsappLinkChunk` and `getWhatsappLinkBatchResult`, with minimal inputs
      - `../admin/whatsapp-link-export-api` `prepareWhatsappLinkExport` `[{ scope: "all", filter: {} }]` and `getWhatsappLinkExportPage` `[{ snapshotId: uuid, offset: 0 }]`

      For each row and each status, the stub resolves `new Response("X", { status })`. The call rejects with that `status`, and the stub saw an `authorization` header.
    - `every link-area staff wrapper passes a genuine result through`. The stub resolves `{ ok: true }`, and each call resolves deep-equal to it.
  - `staff-server-fn.contract.test.mjs` (node; reads sources; strips `//` and `/* */` comments before matching). This is the exact exemption contract:
    ```js
    const WRAPPER = "src/lib/neon/staff-server-fn.ts";
    const DEFINITION = "src/auth.ts";
    // Already unwrap every call (fact 12). Each withStaff(Auth)?Headers( call must sit in a statement
    // (text since the previous ";" within 400 chars) containing unwrapServerFnResponse( |
    // callStaffServerFn( | callStaffServerFnInBackground(, OR be followed within 400 chars by
    // fetch("/api/ or fetch(`/api/ (raw API route), OR be the body of admin-team's local withStaffHeaders.
    const LEGACY_UNWRAPPED = [
      "src/lib/neon/admin-data.ts", "src/lib/neon/admin-cms.ts", "src/lib/neon/admin-team.ts",
      "src/lib/neon/admin-properties.ts", "src/lib/neon/admin-property-bulk.ts",
      "src/lib/neon/admin-property-sync.ts", "src/lib/ai/content-copilot-admin.ts",
      "src/lib/analytics/reporting-client.ts", "src/lib/analytics/sales-performance-client.ts",
    ];
    // Raw fetch to /api/admin/control-plane with its own status mapping.
    const FETCH_CLIENTS = ["src/lib/admin/operations/operations-client.ts"];
    // Task 3 empties this list; the contract then asserts it is empty.
    const PENDING_TASK_3 = [ /* the 11 staff/enquiry modules of fact 11 */ ];
    const MIGRATED = [ /* the 6 link-area modules + WhatsappLinksTable.tsx + WhatsappLinkWizard.tsx */ ];
    ```
    - `no staff module calls withStaffAuthHeaders outside the wrapper` (fix-plan name; Review Focus 5). Walk every non-test `src/**/*.{ts,tsx,js,mjs}`, excluding `*.test.*` and `*.d.ts`. The files that still mention `withStaffAuthHeaders` must be a subset of `{DEFINITION, WRAPPER, …LEGACY_UNWRAPPED, …FETCH_CLIENTS, …PENDING_TASK_3}`. The failure message names each offending file and says "use callStaffServerFn from src/lib/neon/staff-server-fn.ts".
    - `legacy modules unwrap every call`: the statement rule above, applied per file.
    - `migrated files import callStaffServerFn and never @/auth`: every `MIGRATED` file imports `callStaffServerFn` from `./staff-server-fn`, `../neon/staff-server-fn` or `@/lib/neon/staff-server-fn`, and has no `from "@/auth"`.
    - `staff server functions from whatsapp-enquiries are only called through the wrapper`. Every non-test file importing any of `getWhatsappTrackingLinks`, `saveWhatsappTrackingLink`, `provisionWhatsappLinks`, `getWhatsappEnquiries` or `searchWhatsappLinkOffers` from `@/lib/neon/whatsapp-enquiries` also imports `callStaffServerFn`. The public `resolveWhatsappLinks` is exempt.
    - `the wrapper imports auth through the fixture alias and never reloads` (Review Focus 6). `WRAPPER` contains `from "@/auth"` exactly once. It contains no `.server` import, no `server-only` and no `location.reload`.
    - `the pending list only names files that still need migrating`: every `PENDING_TASK_3` file still mentions `withStaffAuthHeaders`, so the list can only shrink.
  - `admin-error-text.test.ts`:
    - `staffActionErrorText maps 401, 403 and 409 to the existing zh-HK strings`. Use `new ServerFnResponseError("Unauthorized", 401)`, `new Response("Forbidden", { status: 403 })` and `{ status: 409 }`.
    - `other statuses fall back to the screen's own message`. `new ServerFnResponseError("BATCH_ROWS_INVALID", 400)` → the fallback.
    - `local validation errors keep their text`. `new Error("最多 1000 筆，請縮小篩選。")` → the same text, and `new Error("Failed to fetch")` → 「無法連線到伺服器，請檢查網絡後重試。」.
  - Run `npm run test:staff-server-fn`. It must fail (no module and no helper).
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:staff-server-fn`
  - `npm run test:whatsapp-enquiries` (link batches and export)
  - `npm run test:no-link` (`WhatsappBatchImport.test.tsx` renders the wizard)
  - `npm run test:control-plane` (`test-wiring`)
  - `npm run test:admin-link-bulk:ui`
  - `npm run test:property-maintenance:ui` (`admin.listings`)
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(admin): WhatsApp link screens report 401/403/409 as errors instead of success

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: Staff, notification and enquiry modules use the wrapper

**Files.** In each module, replace the `@/auth` import with `import { callStaffServerFn } from "./staff-server-fn";`. Keep every exported name, signature and `isWorkspaceCurrent` parameter. For `dispatchWorkspaceRequest(() => withStaffAuthHeaders({ data }), (p) => fn(p), isWorkspaceCurrent)`, use `callStaffServerFn(fn, { data }, isWorkspaceCurrent)` and drop the unused `dispatchWorkspaceRequest` import.
- `src/lib/neon/staff-endpoints.ts:4,45-112` (6 calls)
- `src/lib/neon/staff-notifications.ts:4,48-53` (3)
- `src/lib/neon/staff-reference-admin.ts:5,39-62` (3)
- `src/lib/neon/whatsapp-assignment.ts:1,5,50-142` (6; `getWhatsappAssignment` keeps its `{kind}` result, fact 15)
- `src/lib/neon/whatsapp-readiness.ts:4,20-25` (2)
- `src/lib/neon/whatsapp-service-health.ts:3,9-11` (1)
- `src/lib/neon/whatsapp-service-policy.ts:1,4,37-63` (3)
- `src/lib/neon/whatsapp-test-notification.ts:1,4,43-114` (5; the client file only, #225 edits the `.server.ts`)
- `src/lib/neon/inbox-directory.ts:4,21-69` (4)
- `src/lib/neon/forwarded-enquiries.ts:4,33-78` (4)
- `src/lib/neon/enquiry-resolution.ts:4,24-42` (2)
- **`src/components/admin/WhatsappServicePolicyEditor.tsx:99`** → `setError(staffActionErrorText(e, "操作未完成；請核對政策資料。"))`. Add the import after `:18`.
- **`staff-server-fn.contract.test.mjs`:** move the 11 files from `PENDING_TASK_3` to `MIGRATED`, and add `test("no module is still pending migration", () => assert.deepEqual(PENDING_TASK_3, []))`.
- **`staff-server-fn.modules.test.ts`:** add the 11 modules' 39 exports to the table, with minimal valid arguments taken from each module's zod schema.
- **No change** to any component other than the policy editor. Every caller already has a zh-HK `catch` (fact 17), and the status-aware ones read `.status`, which `ServerFnResponseError` carries.

- [ ] **Step 1: write the failing tests.**
  - Extend `staff-server-fn.modules.test.ts`:
    - `every staff, notification and enquiry wrapper rejects a resolved 401, 403 and 409 Response`, using the 11-module table.
    - `every staff, notification and enquiry wrapper passes a genuine result through`.
    - `getWhatsappAssignment still returns the handler's own { kind: "error" } result`. The stub resolves `{ kind: "error", code: "forbidden", statusCode: 403, requestId: "r" }`, and the call resolves to it unchanged.
  - Contract: `no module is still pending migration`.
  - Run `npm run test:staff-server-fn`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:staff-server-fn`
  - `npm run test:staff-notifications` (includes `StaffMappingWizard.test.tsx`, `StaffNotificationSetup.test.tsx`, `StaffNotificationCard.test.tsx`)
  - `npm run test:no-link` (`EnquiryResolutionPanel`, `ForwardedEnquiryForm`, `FolderLoadNotice`, `NoLinkInbox`)
  - `npm run test:woztell` (`inbox-directory`)
  - `npm run test:whatsapp-enquiries`
  - `npm run test:staff-setup:ui`
  - `npm run test:whatsapp-mobile:ui`
  - `npm run test:property-maintenance:ui`
  - `npm run test:admin-daily-work:ui`
  - `npm run test:admin-campaign-review:ui`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  fix(admin): staff, notification and enquiry screens surface denied and conflicting saves

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: Browser proof: a denied offer search shows the zh-HK error and no false results

**Files:**
- **Modify `scripts/browser-fixtures/link-bulk-owned/synthetic-batches.ts:18-30`:** add `searchDenied: false,` to `state`, after `deniedReference: false,`.
- **Modify `scripts/browser-fixtures/link-bulk-owned/synthetic-api.ts:40-42`:**
  ```ts
  export async function searchWhatsappLinkOffers() {
    // TanStack Start RESOLVES a thrown Response (server-fn-response.ts); mimic that exactly.
    return state.searchDenied ? new Response("Forbidden", { status: 403 }) : offers;
  }
  ```
  `state` is already imported (`:3`).
- **Modify `e2e/admin-link-bulk-owned.spec.ts`:** insert the new test **after `:701`**, inside the `for (const width …)` loop, before `atomic rejected fifty-row chunk…`. #224/#225 delete `:749-759`, so do not append at the end.

- [ ] **Step 1: write the failing test.**
  - `denied offer search shows the zh-HK permission message and no false results ${width}` (Review Focus 6):
    1. `setup(page, width)`.
    2. `page.evaluate(() => { window.ownedLinkBulk.searchDenied = true; })`.
    3. Fill 搜尋公開樓編或物業 with `A0000`, then click the 搜尋 button.
    4. `expect(page.getByRole("alert")).toContainText("你沒有權限進行此操作。")`.
    5. `expect(page.getByText("合成中文樓盤 1", { exact: false })).toHaveCount(0)`.
    6. The heading 「建立 WhatsApp 連結」 is still visible, so there was no crash.
    7. Then `searchDenied = false`, click 搜尋 again: the alert disappears and 「合成中文樓盤 1」 is visible.
    8. At widths 1440 and 390, capture the denied state to `.audit/remediation-20261003/fx10a-denied-search-<width>.png`. The global constraint asks for 375 px, but the suite's narrowest width is 390, so also capture one run with `page.setViewportSize({ width: 375, height: 900 })` inside the 390 iteration.
  - Run `npm run test:admin-link-bulk:ui` **on a checkout without Tasks 2-3**: it must fail. Today the page crashes on `found.map` and shows no alert.
- [ ] **Step 2:** with Tasks 2-3 in place, it passes.
- [ ] **Step 3:** run:
  - `npm run test:admin-link-bulk:ui`
  - every `playwright.admin-owned.config.ts` suite (Global Constraints)
  - `npm run build`
  - `npm run lint`
  - `npm run typecheck`
- [ ] **Step 4: commit.**
  ```
  test(admin): browser proof that a denied WhatsApp offer search reports the error

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Owner actions before production

**Order:** the owner approves this plan → Owner action 1 (names check) → merge to a preview → preview checks → production deploy → canary. There is no migration, so there is no FX-00 ordering constraint.

1. **Confirm the production variable names before merging (owner's step, names only).** Run `vercel env ls production`, or check the Vercel project settings, and confirm that these are **set** in Production:
   - `WOZTELL_ENABLED`, `WOZTELL_APP_ID`, `WOZTELL_CHANNEL_ID` and `WOZTELL_CHANNEL_SECRET`;
   - `EP_WA_TRACKED_LINKS_ENABLED`, `EP_WA_COMPANY_PHONE` and `EP_WA_COMPANY_CHANNEL_ID`.

   Production intake and tracked links both work today, so they should all be present (facts 8 and 10, and the 2026-09-12 settings repair). If any is missing, the first production build after merge fails. The previous deploy keeps serving, but it is better to fix the variable first. Do not paste any value into chat.
2. **Preview check: tracked link fallback.** This uses a Vercel preview with `EP_WA_TRACKED_LINKS_ENABLED=true` and **no** `EP_WA_COMPANY_CHANNEL_ID` set for the Preview environment.
   1. Open an existing `/w/<code>` link on the preview host. It must 302 to `https://wa.me/<company number>?text=…` (or `/contact` if no company number is set for Preview). **Do not send the message.**
   2. The preview build log shows `[check-required-env] warning (preview)` naming `EP_WA_COMPANY_CHANNEL_ID`.
   3. Vercel runtime logs show one `WA_TRACKED_REDIRECT_FALLBACK {"reason":"company_channel_missing","stage":"config","errorName":"Error"}`, with no code and no phone.
3. **Preview check: honest staff errors** (staff test login, synthetic data only):
   1. Open 同事通知目的地 in two tabs and save the same endpoint in both. The second tab shows 「未能儲存：請核對同事映射、目的地及版本，重新整理後再試。」 and keeps the form. This is the audit's B-03 reproduction.
   2. As a non-admin test account, open `/admin/whatsapp-links` and search offers. It shows 「你沒有權限進行此操作。」 and does not crash.
   3. Let the session expire, or sign out in another tab, then save a link edit. It shows 「登入已失效，請重新登入後再試。」, not 「已儲存新版本」.
4. **Production:** merge, then deploy.
5. **Canary (read-only, first 48 h):**
   - `/w/*` in Vercel logs has **0** responses ≥ 500.
   - `WA_TRACKED_REDIRECT_FALLBACK` lines are rare. A steady stream means a config or DB problem: check `reason` and `stage`.
   - Operations health shows the WozTell row healthy.
   - The admin WhatsApp screens load for an admin and a manager.
   - Then update the Status column for C-08, C-07 and B-03 in the audit doc, and `CHANGELOG.md`.

**Rollback:** revert the PR. There are no migrations and no data changes.

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **Fallback number when `EP_WA_COMPANY_PHONE` is missing or invalid.** **Default: use `VITE_CONTACT_WHATSAPP_PHONE` (the site-wide public WhatsApp CTA), else `/contact`.** Both are company numbers taken from env, and the fix plan named the VITE one. No number ever comes from the link, request or database. The stricter alternative is `/contact` whenever `EP_WA_COMPANY_PHONE` is unusable.
2. **Should the new build check fail previews too?** **Default: fail production and only warn on preview**, the same split as the origin check (fact 7). Previews often lack WozTell and company settings, and nothing customer-facing points at a preview.
3. **Should `WOZTELL_BOT_ACCESS_TOKEN` also be required at build time when `WOZTELL_ENABLED=true`?** **Default: no.** The fix plan names the three intake variables. Sending already fails visibly, and the health row already requires the token.
4. **The webhook ignores `WOZTELL_ENABLED` (fact 8). Should the intake variables be required even when the flag is off?** **Default: no.** Gate on `WOZTELL_ENABLED=true` as the fix plan says. Owner action 1 confirms that production has the flag on.
5. **Should staff error messages show the server's code** (for example `BATCH_PREVIEW_EXPIRED`) for support? **Default: no.** Use the three existing strings and each screen's own generic message, with no new copy. FX-17a can add codes if staff ask.

## Findings that differ from the approved fix plan

1. **The fallback does not use `VITE_CONTACT_WHATSAPP_PHONE` today.** It uses `EP_WA_COMPANY_PHONE` only. When that is unset, the fallback goes to `/contact`, not `wa.me`. When it is malformed, `fallback()` itself throws, which is another 500 (fact 2). The plan keeps `EP_WA_COMPANY_PHONE` first and adds the VITE number as the second choice (Open question 1).
2. **`src/lib/whatsapp-enquiries/redirect.test.mjs` already exists** and runs in `test:whatsapp-enquiries` (fact 6). Task 1 appends to it rather than creating it.
3. **The flag names.** The tracked-link flag is `EP_WA_TRACKED_LINKS_ENABLED`; `WOZTELL_ENABLED` is correct. The webhook that C-07 protects **does not read `WOZTELL_ENABLED`** (fact 8).
4. **There is no existing test for `check-required-env.mjs`.** The script runs at top level with `process.exit`, so the new test spawns it with a minimal env. The new rule fails production and only warns on preview, matching the origin check's precedent, where the existing CTA check fails both (fact 7).
5. **C-07 also needs the health row:** the control-plane WozTell check ignores `WOZTELL_APP_ID` (fact 9). The fix plan only listed the build check.
6. **B-03 is 19 files and 51 call sites, not "18 modules".** "whatsapp-enquiries" has no `withStaffAuthHeaders` call. The unwrapped calls to its staff server functions are in two **components**, `WhatsappLinksTable.tsx:120-129` and `WhatsappLinkWizard.tsx:646-650` (fact 11).
7. **#223 does not change `callStaffServerFn`'s reload behaviour.** The 404/410/5xx reload is already on main (`admin-data.ts:331-393`). #223 only adds `callStaffServerFnInBackground` and its callers (fact 14). The new shared module mirrors that background semantics: unwrap and never reload.
8. **The audit's 409 example for the links table is really a 401/403.** A tracking-link version conflict is a plain `Error`, which already rejects. The real false-success 409 is the staff endpoint's `ENDPOINT_PERMISSION_OR_VERSION_CONFLICT` (fact 16b).
9. **Two failures are worse than a false 「已儲存」:** the offer search crashes the wizard on `found.map`, and a batch commit records a resolved 403/409 as a completed chunk and moves on (fact 16c-d). Both are fixed by the same unwrap. Task 4 proves the first in a browser.
10. **Five screens print the raw server body.** Unwrapping alone would show `Forbidden` or an English code. The plan maps 401/403/409 to three **existing** zh-HK strings through `staffActionErrorText`, with no new copy (fact 17).
11. **The webhook URL in the activation doc stays on `earnestproperty.vercel.app`.** Moving it to www belongs to FX-13, after the `/api/*` exclusion ships (fix-plan Review focus 1). The doc gains `WOZTELL_APP_ID` and the tracked-link variables now.
