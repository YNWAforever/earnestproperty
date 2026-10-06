# FX-01 Public Form Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor who submits any public enquiry form (contact, property enquiry, valuation 放盤估價, listing alert 新盤通知) always sees a visible zh-HK result. A submission that did not save is never shown as success.

**Architecture:**
- One pure helper, `submitPublicForm`, turns whatever a public server function returns or throws into a success-or-error outcome. It covers the TanStack "resolved `Response`" case: a rate-limited call *resolves* with a `Response` object instead of rejecting.
- One presentational component, `FormStatus`, renders that outcome inline (`role="alert"` / `role="status"`) under each submit button.
- The four forms are moved out of their route files into components so they can be exercised in a real browser against synthetic server functions (the repo's existing "owned browser fixture" pattern). They are rewired to the helper.
- The sonner `<Toaster/>` is mounted on public pages so the remaining toast (share → 「已複製連結」) is visible.

**Tech Stack:** React 19, TanStack Start (`createServerFn`), sonner, zod 3, `bun test` (+ cheerio + `react-dom/server`), Playwright via `playwright.admin-owned.config.ts`, Vite fixture builds under `scripts/browser-fixtures/`.

**Spec:**
- `docs/audits/2026-10-final-audit.md`, findings **H-02** (public pages have no toast container), **C-18** (raw server error text) and **C-19** (rate-limited submit reported as success; found in Phase 3).
- `docs/audits/2026-10-fix-plan.md`, batch **FX-01**.

## Global Constraints

- All new user-facing text is zh-HK (Traditional Chinese, Hong Kong usage). Do not change existing marketing or brand copy, labels or placeholders. Only the outcome messages below are new.
- Raw server or exception text must never reach the visitor's screen.
- Public URLs, element ids and form field names must stay the same. `property.$listingNo.tsx`'s `focusInquiry()` depends on the input with `id="name"`.
- The consent checkboxes keep starting unchecked (`useState(false)`) and are never preselected (an existing invariant).
- Existing analytics `track(...)` calls fire exactly when they fire today (on success only), with the same names and payloads.
- Existing double-submit protection stays: `createSubmitGuard` on the contact form, and `submitWithInquiryIdentity` inside `createWebsiteInquiry`.
- Do not modify `src/lib/neon/admin-data.ts` or any `*.server.ts`. FX-02 owns those files next.
- No new env vars, no new dependencies. `sonner`, `cheerio` and `@playwright/test` are already installed.
- Prettier: 100 cols, double quotes, semicolons, trailing commas. Components PascalCase, helper modules kebab-case.
- Commit only the files you touched (`git add <paths>`). Never `git add -A`: `bun.lockb` shows a spurious modification in this worktree and must not be committed.
- Commit messages: conventional with scope, e.g. `fix(public): …`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Outcome copy (exact strings):**

| Key | Text |
|---|---|
| `RATE_LIMITED` | 提交次數太多，請一分鐘後再試，或直接 WhatsApp 我們。 |
| `VALIDATION` | 資料格式有誤，請檢查你填寫的資料後再試。 |
| `NETWORK` | 網絡連線出現問題，請檢查網絡後再試，或直接 WhatsApp 我們。 |
| `SERVER` | 未能提交，請再試一次，或直接 WhatsApp 我們。 |
| contact success | 已收到查詢，我們會盡快聯絡你。 |
| property success | 已收到查詢，經紀會盡快與你聯絡。 |

Valuation and listing-alert success keep their existing inline 「已收到查詢」 and 「已設定通知」 panels.

## Review Focus

1. **A rate-limited call reports success.** `createWebsiteInquiry` / `createValuationLead` / `createListingAlert` resolving to a `Response` with status 429 must show `RATE_LIMITED` and keep every typed value. *Test: Task 1 (unit) and Task 4 (browser).*
2. **A resolved value without an id.** For example `{}`, or a `Response` with status 200. These are not a confirmed save and must be an error, not success. *Test: Task 1.*
3. **Double click during a slow submit.** The contact form must still send exactly one request. *Test: Task 4 (fixture holds the first call pending; second click; assert one recorded call).*
4. **Consent unticked.** The valuation and alert forms show the consent message inline and make no server call. *Test: Task 4.*
5. **Error, then a successful retry.** A visitor who corrects input after an error and resubmits must see the error replaced by the success message, not both. *Test: Task 4.*

---

### Task 1: `submitPublicForm` outcome helper + contact orchestration fix

**Files:**
- Create: `src/lib/public-form-submit.ts`
- Create: `src/lib/public-form-submit.test.ts`
- Modify: `src/lib/contact-inquiry-form.ts` (`ContactSubmitOutcome`, `ContactSubmitFn`, `submitContactInquiry`)
- Modify: `src/lib/contact-inquiry-form.test.ts`
- Modify: `package.json` (add `src/lib/public-form-submit.test.ts` to the `bun test` list inside script `test:contact`)

**Interfaces:**
- Produces:
  - `export type PublicFormErrorCode = "RATE_LIMITED" | "VALIDATION" | "NETWORK" | "SERVER";`
  - `export type PublicSubmitOutcome = { status: "success"; id: string } | { status: "error"; code: PublicFormErrorCode; message: string };`
  - `export async function submitPublicForm(call: () => Promise<unknown>): Promise<PublicSubmitOutcome>`
  - `export function publicFormErrorMessage(code: PublicFormErrorCode): string` (returns the exact Global Constraints copy)
  - In `contact-inquiry-form.ts`:
    - `ContactSubmitOutcome = { status: "validation-error"; message: string } | { status: "server-error"; code: PublicFormErrorCode; message: string } | { status: "success"; id: string }`
    - `ContactSubmitFn = (payload: WebsiteInquiryInput) => Promise<unknown>`

**Classification rules for `submitPublicForm`, in order:**
1. `call()` resolves to an object that is `instanceof Response`:
   - status 429 → `RATE_LIMITED`
   - status 400 or 422 → `VALIDATION`
   - any other status, including 2xx → `SERVER`
2. It resolves to an object whose `id` is a non-empty string → `{ status: "success", id }`.
3. It resolves to anything else (including `{ error: "..." }`, `{}`, `null`) → `SERVER`.
4. `call()` throws:
   - an error with a numeric `status` property (e.g. `ServerFnResponseError` from `src/lib/neon/server-fn-response.ts`) → classify by status as in rule 1
   - a `TypeError` (fetch/network failure) → `NETWORK`
   - an error whose `name === "ZodError"`, or whose `message` parses as a JSON array whose first element has a `"code"` and a `"path"` property (a serialized zod issue list) → `VALIDATION`
   - anything else → `SERVER`
5. The error `message` is always `publicFormErrorMessage(code)`. Never the thrown or returned text.

- [ ] **Step 1: Write the failing tests** in `src/lib/public-form-submit.test.ts` (bun):
  - `resolved 429 Response → RATE_LIMITED with exact copy`: `submitPublicForm(async () => new Response("Too Many Requests", { status: 429 }))` deep-equals `{ status: "error", code: "RATE_LIMITED", message: "提交次數太多，請一分鐘後再試，或直接 WhatsApp 我們。" }`.
  - `resolved 400 Response → VALIDATION`.
  - `resolved 200 Response → SERVER (not success)`.
  - `resolved { id: "abc" } → success with id "abc"`.
  - `resolved {} → SERVER`; `resolved { id: "" } → SERVER`; `resolved { error: "boom" } → SERVER and message does not contain "boom"`.
  - `thrown TypeError("Failed to fetch") → NETWORK`.
  - `thrown error with status 429 → RATE_LIMITED`: use `new ServerFnResponseError("Too Many Requests", 429)` imported from `@/lib/neon/server-fn-response`.
  - `thrown Error whose message is JSON.stringify([{ code: "too_small", path: ["phone"], message: "x" }]) → VALIDATION`.
  - `thrown Error("relation does not exist") → SERVER and message excludes "relation"`.
  - `publicFormErrorMessage` returns the exact strings for all four codes.

  In `src/lib/contact-inquiry-form.test.ts`, add:
  - `submitFn resolving a 429 Response → server-error RATE_LIMITED, never success`
  - `submitFn resolving {} → server-error SERVER`
  - `submitFn resolving { id: "x" } → { status: "success", id: "x" }`

  Update any existing assertions that expect the old `server-error` shape.
- [ ] **Step 2: Run them to verify they fail.** Run: `bun test src/lib/public-form-submit.test.ts src/lib/contact-inquiry-form.test.ts`. Expected: FAIL (module missing; the 429 case currently returns `success`).
- [ ] **Step 3: Implement** `src/lib/public-form-submit.ts` per the rules. Change `submitContactInquiry` to call `submitPublicForm(() => submitFn(payload))` after the existing zod validation, mapping error to `{ status: "server-error", code, message }` and success to `{ status: "success", id }`. Keep `createSubmitGuard` and `composeInquiryMessage` unchanged.
- [ ] **Step 4: Run to verify they pass.** Run: `bun test src/lib/public-form-submit.test.ts src/lib/contact-inquiry-form.test.ts` and then `npm run test:contact`. Expected: PASS.
- [ ] **Step 5: Commit** `src/lib/public-form-submit.ts`, `src/lib/public-form-submit.test.ts`, `src/lib/contact-inquiry-form.ts`, `src/lib/contact-inquiry-form.test.ts`, `package.json` with message `fix(public): treat rate-limited or id-less enquiry results as failures`.

### Task 2: `FormStatus` component + public `<Toaster/>`

**Files:**
- Create: `src/components/site/FormStatus.tsx`
- Create: `src/components/site/FormStatus.test.tsx`
- Modify: `src/routes/__root.tsx` (`RootComponent`, the public branch only)
- Modify: `package.json` (add `src/components/site/FormStatus.test.tsx` to the `bun test` list in `test:contact`)

**Interfaces:**
- Produces:
  - `export type FormStatusState = { kind: "idle" } | { kind: "success"; message: string } | { kind: "error"; message: string };`
  - `export function FormStatus({ state, id }: { state: FormStatusState; id?: string }): JSX.Element | null`
- Rendering:
  - `idle` → `null`
  - `error` → `<p id={id} role="alert" className="...">{message}</p>`, styled with the existing destructive tokens (`text-destructive`, `bg-destructive/10`, rounded, small padding, `text-sm`)
  - `success` → `<p id={id} role="status" className="...">{message}</p>`, styled with the existing primary tokens (`text-primary`, `bg-primary/10`)

  Both use `text-sm leading-relaxed` and full width. No icons are required.
- `__root.tsx`: import `{ Toaster }` from `@/components/ui/sonner` and render `<Toaster position="top-center" richColors />` inside `content` **only when** `!isAnalyticsPrivatePath(location.pathname)`. The private (admin/auth/account) branch already gets a toaster from `NeonAuthUIProvider`; it must not get a second one.

- [ ] **Step 1: Write the failing test** `src/components/site/FormStatus.test.tsx` (bun; `renderToStaticMarkup` + cheerio, as in `src/components/site/EstateGroupGrid.test.tsx`):
  - `idle renders nothing` (markup `""`)
  - `error renders role=alert with the message text`
  - `success renders role=status with the message text`
  - `passes id through`
- [ ] **Step 2: Run to verify it fails.** Run: `bun test src/components/site/FormStatus.test.tsx`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `FormStatus.tsx` and the `__root.tsx` mount.
- [ ] **Step 4: Run to verify it passes.** Run: `bun test src/components/site/FormStatus.test.tsx`, `npm run test:layout`, `npm run test:contact`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the touched files with message `fix(public): add inline form status and mount toaster on public pages`.

### Task 3: Move the four public forms into components and wire them to `submitPublicForm` + `FormStatus`

**Files:**
- Create: `src/components/site/ContactInquiryForm.tsx`, moved from `src/routes/contact.tsx`: the `ContactPage` state and handler at lines ~75-143 and the `<form>` at ~279-378.
- Modify: `src/routes/contact.tsx` (render `<ContactInquiryForm />` where the form was; remove the moved code and any now-unused imports)
- Create: `src/components/site/ListingAlertForm.tsx`, moved from `src/routes/listings.tsx:1000-1128` (the doc comment, `ListingAlertForm` and its form JSX)
- Modify: `src/routes/listings.tsx` (import and render `<ListingAlertForm search={search} />` at the existing call site ~1308)
- Create: `src/components/property/PropertyInquiryForm.tsx`, moved from `src/routes/property.$listingNo.tsx`: `inquirySchema` (~283), the `submitting`/`consentWhatsapp` state (~344-345), `handleSubmit` (~425-460) and the `<form>` (~1066-1118)
- Modify: `src/routes/property.$listingNo.tsx` (render `<PropertyInquiryForm propertyId={property.id} />` in place of the form; keep `focusInquiry` working via the unchanged `id="name"` input)
- Modify: `src/components/site/OwnerValuationPanel.tsx` (export `ValuationLeadForm`; rewire its submit)

**Interfaces:**
- Consumes `submitPublicForm`, `publicFormErrorMessage`, `PublicSubmitOutcome` (Task 1), `FormStatus`, `FormStatusState` (Task 2). `submitContactInquiry`'s new outcome is from Task 1.
- Produces (props are exactly these; the server functions are imported inside each component from `@/lib/neon/admin-data`, which lets Task 4's fixture alias swap them):
  - `export function ContactInquiryForm(): JSX.Element`
  - `export function ListingAlertForm({ search }: { search: Record<string, unknown> & { deal?: string; district?: string } }): JSX.Element`
  - `export function PropertyInquiryForm({ propertyId }: { propertyId: string }): JSX.Element`
  - `export function ValuationLeadForm({ estateId }: { estateId?: string }): JSX.Element`
- `collectUtmParams`: if a component would otherwise import it from a route file, move it to `src/lib/utm.ts` (same body) and import it from there everywhere it is used. Components must never import from `src/routes/*`.

**Behaviour in all four forms:**
- One `FormStatusState` per form, starting `{ kind: "idle" }`, rendered with `<FormStatus>` directly below the submit button. The submit button gets `aria-describedby` pointing at the status id when it is not idle.
- On submit, set the status to idle first, so an old error disappears.
- Client-side check failures show inline errors and make no server call:
  - contact: the `validation-error` message
  - property: the first zod issue message
  - valuation and alert: the existing consent messages 「請先剔選同意先可以提交」 / 「請先剔選同意通知先可以提交」
- Server outcome:
  - error → `{ kind: "error", message }` from `submitPublicForm` (contact via `submitContactInquiry`). Keep every typed value (no reset).
  - success →
    - contact: `{ kind: "success", message: "已收到查詢，我們會盡快聯絡你。" }`, plus the existing reset and analytics
    - property: `{ kind: "success", message: "已收到查詢，經紀會盡快與你聯絡。" }`, plus the existing reset
    - valuation and alert: the existing `submitted` inline panel and existing analytics
- Remove every `toast.*` call from these four forms (`share.ts` keeps its toast).
- `submitting` disables the button exactly as today. The contact form keeps `createSubmitGuard`.

- [ ] **Step 1: Write the failing test** `src/components/site/public-forms.test.tsx` (bun; `renderToStaticMarkup` + cheerio; `mock.module("@/lib/neon/admin-data", ...)` and the analytics modules as needed):
  - `each of the four forms renders without a role=alert or role=status element initially`
  - `PropertyInquiryForm keeps an input with id="name" and name="name"`
  - `ContactInquiryForm keeps field names name, phone, email, message`
  - `consent checkboxes render unchecked`

  Interaction behaviour is covered in Task 4.
- [ ] **Step 2: Run to verify it fails.** Run: `bun test src/components/site/public-forms.test.tsx`. Expected: FAIL (components not exported yet).
- [ ] **Step 3: Implement** the moves and the wiring.
- [ ] **Step 4: Run to verify it passes.** Run:
  - `bun test src/components/site/public-forms.test.tsx`
  - `npm run test:contact`, `npm run test:property-experience`, `npm run test:listing-search`, `npm run test:homepage`, `npm run test:estate-conversion`
  - `npm run typecheck`, `npm run lint`

  Expected: PASS. Add the new test file to the `bun test` list in `test:contact`.
- [ ] **Step 5: Commit** the touched files with message `fix(public): show inline zh-HK results on enquiry, valuation and alert forms`.

### Task 4: Real-browser regression suite on a synthetic fixture, wired into CI

**Files:**
- Create: `scripts/browser-fixtures/build-public-forms.mjs`. Same shape as `scripts/browser-fixtures/build-admin-daily-work.mjs`:
  - Vite `build` with `configFile: false`, `root` = `scripts/browser-fixtures/public-forms`, output `.audit/public-forms-browser`
  - aliases:
    - `^@/lib/neon/admin-data$` → `scripts/browser-fixtures/public-forms/synthetic-api.ts`
    - analytics modules the forms import → `scripts/browser-fixtures/public-forms/synthetic-analytics.ts`
    - `@` → `src`
  - the same `forbid-server-imports` plugin
- Create: `scripts/browser-fixtures/public-forms/index.html`, `main.tsx` (renders `ContactInquiryForm`, `PropertyInquiryForm propertyId="00000000-0000-4000-8000-000000000001"`, `ValuationLeadForm`, `ListingAlertForm search={{ deal: "sale" }}`, each in a `<section data-form="contact|property|valuation|alert">`), `synthetic-api.ts`, `synthetic-analytics.ts` (no-op versions of every analytics export the forms import).
- `synthetic-api.ts` exports `createWebsiteInquiry`, `createValuationLead`, `createListingAlert`, plus any other named export the four forms import from `@/lib/neon/admin-data`. Each:
  - records `{ name, input }` into `window.publicFormsFixture.calls`
  - behaves per `window.publicFormsFixture.mode`:
    - `"success"` → resolve `{ id: "fixture-id" }`
    - `"rate-limited-response"` → resolve `new Response("Too Many Requests", { status: 429 })`
    - `"no-id"` → resolve `{}`
    - `"network"` → reject `new TypeError("Failed to fetch")`
    - `"hold"` → return a promise released by `window.publicFormsFixture.release()`
- Create: `e2e/public-form-feedback.spec.ts`. Same server pattern as `e2e/admin-daily-work.spec.ts`:
  - `beforeAll` runs the build script and serves `.audit/public-forms-browser` on a loopback `http.createServer`
  - asserts `!process.env.PLAYWRIGHT_BASE_URL`
- Modify: `playwright.admin-owned.config.ts` (add `"public-form-feedback.spec.ts"` to `testMatch`), `playwright.config.ts` (add `"**/public-form-feedback.spec.ts"` to `testIgnore`).
- Modify: `package.json`: add script `"test:public-forms:ui": "playwright test --config playwright.admin-owned.config.ts e2e/public-form-feedback.spec.ts"`.
- Modify: `.github/workflows/ci.yml`: add `- run: npm run test:public-forms:ui` directly after `- run: npm run test:admin-link-bulk:ui`. `src/test-wiring.test.mjs` requires every deterministic `test:*` script to appear in CI.

**Interfaces:** consumes the four components from Task 3 exactly as exported.

- [ ] **Step 1: Write the spec** `e2e/public-form-feedback.spec.ts`, at viewport 390×844 and again at 1440×900. Each form is filled with name 陳大文, phone 91234567 and address/consent where required.
  - `rate-limited response shows RATE_LIMITED copy in role=alert and keeps typed values` (all four forms)
  - `no-id result shows SERVER copy and no success status` (contact, valuation)
  - `network failure shows NETWORK copy` (property)
  - `success shows contact success copy in role=status and clears the form` (contact)
  - `success shows 已收到查詢 panel` (valuation)
  - `consent unticked shows consent message and records no call` (valuation, alert)
  - `double click while held records exactly one contact call` (mode `hold`)
  - `error then corrected retry shows only the success status` (contact: mode `network`, then switch mode to `success` and resubmit; assert one `role=status` and zero `role=alert`)
  - `no raw server text visible`: page text never contains `Too Many Requests` or `Failed to fetch`
- [ ] **Step 2: Prove the spec bites.** Temporarily change one assertion to expect the old behaviour (e.g. success shown on `rate-limited-response`), run it, and confirm it fails. Restore the assertion. Record both runs in the report. Run: `npm run test:public-forms:ui`.
- [ ] **Step 3: Implement** the fixture and wiring until the spec passes.
- [ ] **Step 4: Run to verify.** Run: `npm run test:public-forms:ui`, `node --test src/test-wiring.test.mjs`, `npm run lint`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the touched files with message `test(public): browser regression for enquiry form outcomes`.
