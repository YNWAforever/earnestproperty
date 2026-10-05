# FX-03 Live-Agent Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A website visitor can only hand off to an agent with a valid, reachable phone. A typo can never attach them to another customer's WhatsApp thread. They can still correct the number until staff have acted. Messages they type after the handoff are kept, not lost. The lead starts at 新查詢 (`new`). Staff see the website chat on the lead.

**Architecture:**
- One small, pure phone validator in `src/lib/ai/live-agent.ts`, `validateHandoffPhone`. It is shared by the widget (client), the handoff route (HTTP 400 before rate limiting) and the handoff service (defence in depth before any SQL). Errors carry the codes `LIVE_AGENT_PHONE_REQUIRED` / `LIVE_AGENT_PHONE_INVALID` and fixed zh-HK copy.
- The handoff stays one atomic CTE in `live-agent.server.ts`, with these changes:
  - It stops updating `whatsapp_conversations`. A possible match becomes a read-only lookup, recorded as a lead note for staff.
  - It stops filling in fields on a matched pre-existing contact.
  - New leads are inserted as `new`.
  - The handoff audit records whether this handoff created the contact (`contactCreated`).
- A second atomic CTE, the correction, runs when an owned session is already `handoff_requested` and the visitor submits a different valid phone. It runs only while the lead is untouched by staff:
  - If this handoff created the contact and nothing else uses it, the CTE updates that contact's phone.
  - Otherwise it creates or matches a contact for the new number and relinks the lead and session.
  - Either way it writes an audit row.
- A message sent after the handoff is stored in `live_agent_messages` and answered with fixed copy. No model call is made.
- Staff read `live_agent_messages` through a new scoped server function, `fetchLeadLiveAgentTranscript`. It is rendered read-only by `LeadChatTranscript` in the lead panel of `admin.leads.tsx`.

**Tech Stack:** React 19, TanStack Start (`createServerFn`, file routes), raw SQL via `queryRows`, zod 3, `bun test` (+ cheerio + `react-dom/server`), `node --test` with `--experimental-test-module-mocks`, `@electric-sql/pglite` 0.4.5 (already a dependency, with its `vector` and `contrib/pgcrypto` extensions).

**Spec:**
- `docs/audits/2026-10-final-audit.md` (FX-01 branch):
  - **C-06** (P0; equals **E-01** and **E-18**): no phone required, corrections ignored, a typo can attach the lead to another customer's thread.
  - **C-11**: handoff leads are created as `contacted`.
  - **E-06**: staff get no context or transcript.
  - **E-07**: messages after a handoff are rejected and lost.
- `docs/audits/2026-10-fix-plan.md`, batch **FX-03**. The owner-approved decisions are pinned below and override the fix plan where they differ. Example: the fix plan's owned-Postgres test file becomes a PGlite file, per the harness decision.

**Schema:** No migration. Everything below uses existing tables and columns:
- "Contact created by this handoff" is a new key inside the existing `ai_audit_logs.metadata` jsonb.
- The no-link rule only removes writes.
- Sessions handed off before this ships have no `contactCreated` key, so their corrections take the safe relink path.

**Open questions blocking implementation:** none.

## Verified current behaviour (origin/main 4965d48)

| # | Bug | Where (verified) |
|---|---|---|
| 1 | A blank or invalid phone is accepted and the visitor sees 「已記錄跟進要求。請確認 WhatsApp 電話正確，代理會跟進。」 | Widget sends the raw `handoffPhone` with no check: `src/components/live-agent/LiveAgentWidget.tsx:118`. The button is disabled only while loading (`:238`). Success copy is at `:125-131`. The route passes `phone` through unchecked (`src/routes/api.live-agent.handoff.ts:63`). The service treats the phone as optional (`src/lib/ai/live-agent.server.ts:190`) and audits `hasPhone` (`:349`). Normalisation uses `normalizeAdminPhone` (`src/lib/ai/live-agent.ts:36`), so `0085291234567` stays `0085291234567`. |
| 2 | A corrected phone is silently ignored | `live-agent.server.ts:182-184` returns `{ ok: true }` for any `handoff_requested` session |
| 3 | A typed phone that matches an existing contact links that contact's latest WozTell conversation and sets it `pending` | Steps in `live-agent.server.ts`:<br>1. `candidate_contact` (`:208-217`) matches by typed phone, including the legacy 8-digit form.<br>2. `updated_contact` (`:218-227`) fills the matched contact's null name, phone and email.<br>3. `candidate_conversation` (`:272-281`) picks that contact's newest conversation.<br>4. `updated_conversation` (`:282-291`) sets `status='pending'`.<br>5. The session stores the conversation (`:296`) and the audit records it (`:327`). |
| 4 | Messages after the handoff are rejected; the widget shows 「暫時未能連線，請稍後再試。」 | The service calls `getLiveAgentSessionForMessage` at `live-agent.server.ts:105`. That function (`:367-395`) only accepts `open`/`qualified` (`:373`) and returns 400 at `:386`. The widget throws on non-2xx (`LiveAgentWidget.tsx:88`) and shows the copy at `:96-99`. |
| 5 | Handoff leads start at `contacted` | `live-agent.server.ts:247` (`updated_lead`) and `:263` (`inserted_lead`) |
| 6 | Staff get no context | The note is only `Live agent handoff from <path>` (`live-agent.server.ts:194`). `live_agent_messages` is written at `:107-111`, `:126-133` and `:315-320` and read nowhere else in `src/`. The only admin use of live-agent data is the session status in the command center (`src/lib/neon/admin-data.server.ts:2772-2778`). |

Concurrency today: the handoff CTE claims the session `FOR UPDATE` with `status IN ('open','qualified')` (`:200-207`). A losing request falls back to an idempotent OK (`:354-362`). This must keep producing exactly one lead.

## Test harness decision

**Decision:** the new DB suite `src/lib/ai/live-agent.handoff.db.test.mjs` runs on **PGlite under `node --experimental-test-module-mocks --test`**.
- It loads the four real migrations that define every table the handoff, correction and transcript SQL touch:
  - `20260622060000_public_content.sql`
  - `20260623090000_neon_admin_crm_whatsapp.sql`
  - `20260624110000_ai_crm_live_agent.sql`
  - `20260626120000_live_agent_security.sql`
- It reuses the `@/` resolver hook and `mockOwnedServerDb` from `scripts/acceptance/owned-postgres-test.mjs` (`:10-31`, `:144-164`). Importing that module does not start Docker.
- It is appended to the existing `test:live-agent` script. That script already runs in the CI main job (`.github/workflows/ci.yml:113`, which has Node 24 and Bun 1.3.12), so `ci.yml` needs no change and `src/test-wiring.test.mjs:86-123` stays satisfied.

**Why:**
- **The existing suites cover none of this.** `test:live-agent` (`package.json:52`) uses a throwing DB mock (bun) and transpiled route contracts (node), with no database. The only handoff DB test is `src/lib/ai/live-agent.handoff.local-db.test.mjs`:
  - it uses a hand-built schema against a fixed `127.0.0.1:55432` Postgres;
  - it is skipped unless `LOCAL_POSTGRES_URL` is set;
  - it runs only from `test:live-agent:local-db` (`package.json:53`), which is listed as environment-dependent (`test-wiring.test.mjs:105`) and runs in no CI job.
- **The owned-Docker harness is unreliable here.** `withOwnedPostgres` applies all 85 migrations in a pinned pgvector container and passes in CI. On this Windows machine, owned suites hit `spawnSync docker ETIMEDOUT` earlier today. `docker info` now answers (Docker Desktop 29.8.1, 269 containers), but that is not proven reliable, and `--pull never` needs the pinned image locally. Its CI job `no-link-local-postgres` (`ci.yml:129-157`) also has no Bun.
- **The four base migrations are enough.** The handoff, correction and transcript SQL touch only tables and columns from those migrations. Later migrations add things that never fire on these paths:
  - the `performance_completed_viewing` trigger on `crm_activities` (fires only for completed `viewing` rows);
  - triggers on `whatsapp_conversations` assignment columns, which nothing here updates after this batch;
  - the `crm_contacts.whatsapp_member_id` unique index (never set here).
- **PGlite runs everything this suite needs.** The CTE features (data-modifying CTEs, `FOR UPDATE`, `ON CONFLICT`, `xmax`, jsonb) are real Postgres 17. `vector` and `pgcrypto` ship in `node_modules/@electric-sql/pglite` (exports `./vector` and `./contrib/*`).
- **PGlite has precedent in CI.** PGlite suites already run there, for example `src/lib/whatsapp-enquiries/contact-update.db.test.mjs`, which loads a real migration file and runs inside `test:no-link` (`ci.yml:102`).
- **Limitation:** PGlite is one connection. The double-submit test proves the claim predicate: both requests pass the pre-read and only one CTE claims. It does not prove real row-lock contention. That remains covered by the opt-in `test:live-agent:local-db`, which this batch leaves unchanged.
- **Fallback (only if Task 2 Step 2's smoke test cannot load the four migrations on PGlite):**
  - Keep the test bodies. Replace the fixture with `withOwnedPostgres(async ({ query, transaction }) => …)`.
  - Rename the file to `src/lib/ai/live-agent.handoff-owned.db.test.mjs`.
  - Add the script `"test:live-agent:owned:db": "node --experimental-test-module-mocks --test src/lib/ai/live-agent.handoff-owned.db.test.mjs"` and the line `- run: npm run test:live-agent:owned:db` after `test:operations:owned:db` (`ci.yml:157`).
  - Local RED/GREEN for that file then relies on a healthy Docker or on CI. Say so in the task report.

**UI tests:** bun static tests (`renderToStaticMarkup` + cheerio, as in `src/components/site/EstateGroupGrid.test.tsx`) on two presentational pieces, `LiveAgentHandoffPanel` and `LeadChatTranscriptView`, plus the pure helpers.
- The full widget cannot be statically rendered: its Radix `Dialog.Portal` renders nothing on the server.
- **No browser fixture in this batch.** All interaction logic is either a pure helper (validator, error-body mapper, display formatter) or a pure function of panel props (disabled, error and preview states), and both are unit-tested. The remaining wiring is about 10 lines in `requestHandoff` and is checked in the manual 375/1440 px pass.
- A fixture would mean a new Vite build, spec, Playwright config and CI wiring for one button.

## Global Constraints

- All new user-facing text is zh-HK and exactly as listed below. Do not change any other existing copy.
  - Keep: the success copy (`LiveAgentWidget.tsx:129`); the failure copy 「暫時未能記錄轉介要求，請稍後再試。」 (`:135`); the lead note `Live agent handoff from …` (`:194`); the system message (`:348`).
  - Keep these aria-labels, which `src/lib/ai/ai-contract.test.mjs:282-296` asserts in `LiveAgentWidget.tsx`: 「轉接 WhatsApp 電話」, 「同意 WhatsApp 跟進聯絡」, 「即時客服訊息」, 「傳送」, 「關閉即時客服」.
- Raw server or exception text never reaches the visitor. The widget maps only the two phone codes to client-side copy; everything else keeps the existing generic copy.
- **No schema migration, no new env vars, no new dependencies.**
- **Keep the phone validator small and local to live-agent.** FX-12 will unify phone normalisation repo-wide. Do not touch `normalizeAdminPhone` or any other normaliser. Leave `buildLiveAgentLeadInput` (`live-agent.ts:22-46`) unchanged.
- **Unverified web input never writes `whatsapp_conversations`:** no `UPDATE`, no `INSERT`, and no `live_agent_sessions.conversation_id` taken from a phone match.
- **A matched pre-existing contact is linked read-only.** No field is filled in, and its phone is never changed.
- **Existing invariants stay true:**
  - the handoff and the correction are each one atomic SQL statement;
  - a losing concurrent request gets an idempotent OK;
  - a contact's `opt_in_whatsapp` is never escalated, and `ai-contract.test.mjs:269-270` must keep matching `opt_in_whatsapp=crm_contacts.opt_in_whatsapp`;
  - `ai-contract.test.mjs:263-265` must keep matching `channel_id IS NOT NULL` and `woztell_member_id IS NOT NULL`, and `:271` must keep matching `session.status === "handoff_requested"`.
- **Code style that the node tests rely on:**
  - `src/lib/ai/live-agent.ts`, `live-agent.server.ts` and `admin-data.server.ts` are loaded by `node --test` with type stripping. Use no enums, no namespaces and no constructor parameter properties.
  - Import types with `import type` or inline `type` specifiers.
  - Do not add new imports from `@/lib/neon/db.server` to `live-agent.server.ts`; the bun mock in `live-agent.handoff-validation.test.mjs:5-16` provides only the four it uses today.
- **`admin-data.ts`, `admin-data.server.ts` and `admin-data.types.ts`:** append only, and keep the diff minimal. Another batch edits these files next.
- Prettier: 100 cols, double quotes, semicolons, trailing commas. Components are PascalCase; helper modules are kebab-case.
- **Committing:**
  - Commit only the files you touched (`git add <paths>`). Never `git add -A`. `bun.lockb` shows a spurious modification in this worktree and must never be committed.
  - Commit messages are conventional with a scope (`fix(live-agent): …`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Testing:** never message or store a real customer number. Use synthetic numbers only, such as `9123 4567`, `6123 4567` and `+44 7700 900123`. No test calls a model or WozTell: the knowledge module is mocked in the DB suite and throws in the bun suite.

**Copy (exact strings):**

| Key | Text |
|---|---|
| `LIVE_AGENT_PHONE_REQUIRED` | 請輸入電話號碼，方便代理聯絡你。 |
| `LIVE_AGENT_PHONE_INVALID` | 電話號碼格式不正確，請輸入 8 位香港手機號碼，或連國家碼的號碼。 |
| reply to a message after handoff | 已轉交代理，我哋會盡快聯絡你。 |
| widget preview of the normalised number | 代理會用 {display} 聯絡你 (e.g. 代理會用 +852 9123 4567 聯絡你) |
| lead note for a possible match | 可能與現有 WhatsApp 對話相關（對話編號 {conversationId}） (full-width parentheses, no trailing full stop) |
| transcript heading | 網站問樓助手對話 |
| transcript empty state | 沒有網站對話紀錄 |
| transcript load error / retry | 未能載入網站對話紀錄。 / 重新載入 |
| transcript loading | 載入中… |
| transcript role labels | visitor 訪客 · assistant 問樓助手 · system 系統 · staff 同事 |

**Pinned definitions:**

- **Phone rules** for `validateHandoffPhone`, applied in order:
  1. `text = (raw ?? "").trim()`. If it is empty, the result is `LIVE_AGENT_PHONE_REQUIRED`.
  2. Remove spaces and dashes only: `compact = text.replace(/[\s-]/g, "")`.
  3. `/^[4-9]\d{7}$/` → `852` + compact.
  4. `/^(?:\+852|00852|852)([4-9]\d{7})$/` → `852` + the 8 digits.
  5. Anything else that starts with `+852` or `00852` → `LIVE_AGENT_PHONE_INVALID`. This covers HK landlines and wrong lengths.
  6. `/^\+([1-9]\d{7,14})$/` → the digits without `+`. That is 8–15 digits; E.164 country codes never start with 0.
  7. Otherwise `LIVE_AGENT_PHONE_INVALID`. This includes parentheses, letters, `00` plus other countries, and bare 9–15 digit strings.
- **"Staff have acted" on a lead `l`:** any one of the following.
  - `l.stage <> 'new'`
  - `l.assigned_agent_id IS NOT NULL`
  - `EXISTS (crm_activities a WHERE a.lead_id = l.id AND a.staff_user_id IS NOT NULL)`
  - `EXISTS (audit_logs g WHERE g.subject_id = l.id AND g.actor_id IS NOT NULL)`, covering `lead.update`, `lead.activity`, `lead.contact.update` and so on.
  
  The handoff's own `follow_up` row and the possible-match note both have `staff_user_id IS NULL`, so they do not count.
- **"Contact created by this handoff":** all of the following hold.
  - The newest `ai_audit_logs` row with `action='live_agent.handoff'` and `subject_id=<session>` has `metadata->>'contactCreated' = 'true'`.
  - That contact has `whatsapp_member_id IS NULL`.
  - No `whatsapp_conversations` row, no other `crm_leads` row and no other `live_agent_sessions` row references it.

  Otherwise the contact is treated as pre-existing and is never modified.
- **Same phone** means the new normalised value equals the current contact's `normalized_phone`. With an `852`-prefixed 11-digit value, the legacy 8-digit form also counts: `c.normalized_phone = right($n, 8)`. Resubmitting the same phone is a no-op, with no audit row.
- **Possible-match lookup** (read-only): the newest `whatsapp_conversations` row with `contact_id = <resolved contact>`, `channel_id IS NOT NULL` and `woztell_member_id IS NOT NULL`, ordered by `updated_at DESC`, `LIMIT 1`.

## Batch Verification (run after Task 5)

- `npm run lint`, `npm run typecheck`, `npm run build`
- Test suites:
  - `npm run test:live-agent`
  - `npm run test:content-copilot` (`ai-contract` and `ai-workflow`)
  - `npm run test:command-center` (`admin-data.contract`)
  - `npm run test:property-experience` (`property-decision.test.mjs` asserts the widget trigger classes)
  - `node --test src/test-wiring.test.mjs`
- Admin browser suites that render `admin.leads.tsx` against synthetic APIs: `npm run test:admin-daily-work:ui` and `npm run acceptance:whatsapp-no-link:synthetic`. Also run the other suites in `playwright.admin-owned.config.ts` per the fix plan's global constraints.
- Before/after screenshots at 375 px and 1440 px:
  - the widget handoff panel: blank, invalid, valid with preview, and server error;
  - a `live_agent` lead's panel with the transcript.
- Staging click-through with the owner's test phone only. Check:
  - a blank phone is blocked;
  - `9123456` is blocked;
  - a valid number shows the preview;
  - a correction is accepted;
  - a message after the handoff gets the fixed reply;
  - the lead shows 新查詢 and the transcript.

## Review Focus

1. **A typo phone that matches another customer must never touch that customer.** No column of their `crm_contacts` row changes, including null fields and `updated_at`. Their `whatsapp_conversations` row is unchanged (status, contact, `updated_at`). The session's `conversation_id` stays null, and staff get only the possible-match note. *Test owners:*
   - Task 2: `a phone matching an existing customer never changes that customer's contact or WhatsApp conversation`
   - Task 3: `corrected number that belongs to another customer links read-only and notes the conversation`
   - Task 2 static guard in `ai-contract.test.mjs`: no `UPDATE whatsapp_conversations` in `live-agent.server.ts`
2. **A correction after staff have acted is refused without changing data.** The response is `{ ok: true, status: "handoff_requested" }` and a full before/after snapshot of contacts, leads, sessions, activities, AI audits and conversations is identical. It is covered for each "staff have acted" signal: stage, assignment, staff note and staff audit. *Test owner:* Task 3, `correction is refused without any write once staff have acted`.
3. **A message after the handoff is stored and never calls the model.** The visitor row and the fixed reply are stored in `live_agent_messages`, and the mocked `answerFromPublicKnowledge` call count stays 0. A positive control before the handoff gives a count of 1, which proves the mock is wired. Nothing is written to `crm_activities` or `crm_leads`. *Test owner:* Task 3, `message after handoff is stored, answered with fixed copy and never calls the model`.
4. **The transcript is readable only by staff who can see the lead.** The assigned agent and a manager get the messages in order. Another agent, or any agent on an unassigned lead, gets `Response` 403. *Test owner:* Task 4, `transcript is readable by the assigned agent and managers, in order, and refused to other agents`.
5. **A concurrent double-submit still creates exactly one lead, one `follow_up`, one handoff audit and one system message.** Both promises resolve `{ ok: true, status: "handoff_requested" }`, and no correction audit is written. *Test owner:* Task 2, `concurrent double-submit still creates exactly one lead, follow-up and audit`. This is a regression guard that passes before and after.
6. **The client and the server agree on what is valid.** There is one validator; the widget and the route both import it. *Test owners:* Task 1 (table tests) and Task 5 (button disabled or enabled for the same inputs).

## Out of scope (owned elsewhere)

- Staff alert or notification for a handoff (E-06 with C-02) → FX-05b. Command-center discovery (E-06's pull filter) → FX-04.
- The fix plan's "Eval cases 13–15" → FX-11b, which builds the eval set. There is no eval harness on this branch.
- Repo-wide phone normalisation, split customers and legacy 8-digit contacts → FX-12. This batch only matches the legacy form; it never rewrites it.
- **Per the decisions, two behaviours stay as they are:**
  - Matching a contact by typed phone still links the lead to that contact, read-only.
  - A correction refused because staff acted still shows the existing success copy.

  Raise either with the owner later if needed; neither is reopened here.
- Summarising the question into the lead note (an E-06 suggestion). The transcript provides that context.

---

### Task 1: Shared phone validator; the route and service reject a missing or invalid phone (400, zh-HK)

**Files:**
- Modify: `src/lib/ai/live-agent.ts` (append exports; the existing three functions stay unchanged)
- Modify: `src/lib/ai/live-agent.server.ts`:
  - `LiveAgentPublicError` (`:40-48`): add an optional `code`
  - `requestLiveAgentHandoff`: validate the phone after the budget check (`:172-180`) and before `getLiveAgentSessionForHandoff` (`:181`)
- Modify: `src/routes/api.live-agent.handoff.ts`:
  - validate the phone after the budget block (`:39-51`) and before `enforceRateLimit` (`:53`)
  - include `code` in the `LiveAgentPublicError` mapping (`:77-80`)
- Modify: `src/lib/ai/live-agent.handoff-validation.test.mjs` (bun)
- Modify: `src/routes/api.live-agent.handoff.contract.test.mjs` (node)
- Modify: `src/lib/ai/ai-contract.test.mjs` (`:86-88`: add `"validateHandoffPhone"` to the expected `live-agent.ts` exports)

**Interfaces:**
- Produces in `src/lib/ai/live-agent.ts` (pure; no new imports):
  - `export type LiveAgentPhoneErrorCode = "LIVE_AGENT_PHONE_REQUIRED" | "LIVE_AGENT_PHONE_INVALID";`
  - `export type HandoffPhoneCheck = { ok: true; normalized: string } | { ok: false; code: LiveAgentPhoneErrorCode };`
  - `export function validateHandoffPhone(raw: string | null | undefined): HandoffPhoneCheck` (rules in Global Constraints)
  - `export function liveAgentPhoneErrorMessage(code: LiveAgentPhoneErrorCode): string` (exact copy)
  - `export function formatHandoffPhoneForDisplay(normalized: string): string`:
    - `"85291234567"` → `"+852 9123 4567"` (HK: 11 digits starting `852`)
    - anything else → `"+" + digits`, e.g. `"447700900123"` → `"+447700900123"`
  - `export function liveAgentPhoneErrorFromBody(body: unknown): string | null`: returns `liveAgentPhoneErrorMessage(body.code)` only when `body` is an object whose `code` is one of the two codes. It never returns `body.error`. Otherwise it returns `null`.
- Produces in `live-agent.server.ts`:
  - `class LiveAgentPublicError { status: number; code?: LiveAgentPhoneErrorCode; constructor(message: string, status: number, code?: LiveAgentPhoneErrorCode) }`. Assign the fields in the body; do not use parameter properties.
  - `requestLiveAgentHandoff` throws `new LiveAgentPublicError(liveAgentPhoneErrorMessage(code), 400, code)` before any SQL. The signature and return type are unchanged.
- Route response for both route-level and service-level phone errors: `Response.json({ error: <exact copy>, code }, { status: 400 })`. Other `LiveAgentPublicError`s keep `{ error: err.message }`.

- [ ] **Step 1: Write the failing tests.**

  In `live-agent.handoff-validation.test.mjs`, add `import { … } from "./live-agent.ts"` and these tests:
  - `validateHandoffPhone normalises HK mobiles and international numbers`. Each input must give `{ ok: true, normalized }`:

    | Input | Normalised |
    |---|---|
    | `"91234567"`, `"9123 4567"`, `"9123-4567"`, `"+852 9123 4567"`, `"0085291234567"`, `"85291234567"` | `"85291234567"` |
    | `"+852-6123-4567"` | `"85261234567"` |
    | `"+447700900123"`, `"+44 7700 900123"` | `"447700900123"` |
    | `"+8613800138000"` | `"8613800138000"` |

  - `validateHandoffPhone rejects blank as REQUIRED and malformed numbers as INVALID`:
    - `REQUIRED`: `undefined`, `null`, `""`, `"   "`
    - `INVALID`: `"9123456"`, `"31234567"`, `"2123 4567"`, `"123456789"`, `"+852 2345 6789"`, `"00852 2345 6789"`, `"+1234567"`, `"+1234567890123456"`, `"+0123456789"`, `"(852) 9123 4567"`, `"9123abcd"`, `"00447700900123"`
  - `phone error copy is the exact zh-HK text` (both codes)
  - `formatHandoffPhoneForDisplay formats HK and international numbers`
  - `liveAgentPhoneErrorFromBody maps only phone codes and never echoes server text`:
    - `{ code: "LIVE_AGENT_PHONE_INVALID", error: "raw" }` → the INVALID copy
    - `{ error: "Live-agent session is not open." }` → `null`
    - `null` → `null`
    - `{ code: "OTHER" }` → `null`
  - `handoff service rejects a missing or invalid phone before any SQL`: for `phone` in `[undefined, "", "  ", "9123456", "+852 2345 6789"]`, `requestLiveAgentHandoff({ ...ownedSession, phone })` rejects with an `instanceof LiveAgentPublicError` that has `status === 400`, the expected `code` and `message` equal to the exact copy. `queryCount` stays 0.
  - Update `valid handoff budget proceeds to session lookup` (`:40-47`) to pass `phone: "9123 4567"`. It must still reach exactly one query.

  In `api.live-agent.handoff.contract.test.mjs`:
  - In `handoffHandler` (`:25-53`):
    - Add the mock `"@/lib/ai/live-agent": loadTypeScript("src/lib/ai/live-agent.ts", { "../neon/admin-workflow.ts": loadTypeScript("src/lib/neon/admin-workflow.ts") })`.
    - Give the local `LiveAgentPublicError` an optional `code`.
    - Accept an optional service override.
  - Add `missing or invalid handoff phone returns 400 zh-HK copy and never rate-limits or reaches the CRM`. Bodies: phone absent, `""`, `"9123456"`, the number `91234567`, `"+852 2345 6789"`. Expect status 400; a JSON body deep-equal to `{ error: <exact copy>, code: <code> }`; `calls.rateLimit === 0`; `calls.service.length === 0`.
  - Add `service phone error keeps its code in the 400 body`. The service throws `new LiveAgentPublicError(<INVALID copy>, 400, "LIVE_AGENT_PHONE_INVALID")`, and the body includes that `code`.
  - Update `valid handoff budgets still use rate limiting and reach the service` (`:76-89`) to send `phone: "91234567"` and assert `calls.service[0].phone === "91234567"`.

  In `ai-contract.test.mjs:86-88`, add `"validateHandoffPhone"`.
- [ ] **Step 2: Run to verify they fail.** Run `bun test --no-env-file src/lib/ai/live-agent.handoff-validation.test.mjs`, `node --test src/routes/api.live-agent.handoff.contract.test.mjs` and `node --test src/lib/ai/ai-contract.test.mjs`. Expected: FAIL. The exports are missing, and the route returns 200 for a missing phone.
- [ ] **Step 3: Implement** the helpers, the error `code`, the service guard and the route check. The route passes the raw `body.phone` string to the service; the service re-validates and normalises.
- [ ] **Step 4: Run to verify they pass.** Run `npm run test:live-agent`, `npm run test:content-copilot` (`ai-workflow.test.mjs` imports `live-agent.ts` under plain `node --test`, which proves it strips cleanly), `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** the touched files with the message `fix(live-agent): require a valid phone for agent handoff`.

### Task 2: PGlite DB suite; the handoff starts leads at `new`, never links an existing WhatsApp thread, and records `contactCreated`

**Files:**
- Create: `src/lib/ai/live-agent.handoff.db.test.mjs`
- Modify: `src/lib/ai/live-agent.server.ts` (`requestLiveAgentHandoff`, CTE `:199-352` and params `:335-351`)
- Modify: `src/lib/ai/ai-contract.test.mjs` (in the test at `:259-277`)
- Modify: `package.json`: append ` && node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/ai/live-agent.handoff.db.test.mjs` to `test:live-agent` (`:52`)

**Interfaces:**
- Consumes `validateHandoffPhone` (Task 1). `$5` (`:340`) becomes the validator's `normalized` value instead of `leadInput.normalized_phone`. `$4` stays the trimmed raw input, used as the display phone.
- Fixture shape (keep it this small; test bodies use only `query()` and the service functions, so the fallback harness can reuse them):
  ```js
  import test, { mock } from "node:test";
  import { PGlite } from "@electric-sql/pglite";
  import { vector } from "@electric-sql/pglite/vector";
  import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
  import { mockOwnedServerDb, repoRoot } from "../../../scripts/acceptance/owned-postgres-test.mjs";
  const BASE_MIGRATIONS = [/* the four files named in the harness decision, in order */];
  let db, afterQuery = null, modelCalls = 0;
  const query = async (statement, params = []) => { /* db.query → rows; then await afterQuery?.(statement) */ };
  const transaction = async (statements) => { /* db.transaction, collect rows per statement */ };
  await mockOwnedServerDb(mock, query, transaction);
  const knowledgeUrl = new URL("src/lib/ai/knowledge.server.ts", repoRoot).href;
  const actualKnowledge = await import(knowledgeUrl); // spread it: admin-data.server.ts:65 imports rebuildAiKnowledgeIndex
  mock.module(knowledgeUrl, { exports: { ...actualKnowledge,
    answerFromPublicKnowledge: async () => { modelCalls += 1; return { answer: "合成答案", confidence: 0.9,
      citations: [{ title: "合成來源", url_path: "/faq", source_type: "faq" }] }; } } });
  const live = await import("./live-agent.server.ts");
  async function freshDb() { /* new PGlite({ extensions: { vector, pgcrypto } }); exec each migration; reset counters */ }
  ```
  Each test calls `await freshDb()` and closes `db` in `finally`. Sessions are opened with `live.createLiveAgentSession({ sourcePath: "/listings" })`.
- **CTE changes** (the statement stays single and atomic):
  - **Matched contact is read-only.** Replace `updated_contact` (`:218-227`) with `matched_contact AS (SELECT id FROM candidate_contact)`; the fill-in `UPDATE` is gone. `inserted_contact` becomes `WHERE NOT EXISTS (SELECT 1 FROM matched_contact)`, with:
    - `ON CONFLICT (normalized_phone) DO UPDATE SET opt_in_whatsapp=crm_contacts.opt_in_whatsapp` (a self-assignment, used only so `RETURNING` yields the row; it also keeps `ai-contract.test.mjs:270` green)
    - `RETURNING id, (xmax = 0) AS created`
  - `resolved_contact` unions `matched_contact` and `inserted_contact` ids.
  - **Stage.** `updated_lead` (`:244-258`) no longer sets `stage`; a pre-existing lead keeps its stage. `inserted_lead` inserts `'new'` (`:263`).
  - **No conversation link.** Delete `candidate_conversation` and `updated_conversation` (`:272-291`). Add `possible_conversation`, a read-only `SELECT w.id` per the pinned possible-match lookup; it keeps the `channel_id IS NOT NULL` and `woztell_member_id IS NOT NULL` predicates. In `transitioned`, drop the `conversation_id=…` assignment (`:296`).
  - **Possible-match note.** Add `possible_match_note`: `INSERT INTO crm_activities (lead_id, contact_id, activity_type, body)`, selecting `l.id, c.id, 'note', '可能與現有 WhatsApp 對話相關（對話編號 ' || w.id::text || '）'` from `transitioned` × `resolved_contact` × `resolved_lead` × `possible_conversation`. It has no `staff_user_id`.
  - **Audit metadata** (`:324-330`): remove `conversationId`. Add `'contactCreated', COALESCE((SELECT created FROM inserted_contact), false)` and `'possibleConversationId', (SELECT id FROM possible_conversation)`. Keep `contactId`, `leadId`, `hasPhone` and `sourcePath`.

- [ ] **Step 1: Write the harness, a smoke test and the double-submit regression guard.**
  - Smoke test, `base migrations load on PGlite and a session can be opened`: `createLiveAgentSession` returns a uuid id and a non-empty token.
  - `concurrent double-submit still creates exactly one lead, follow-up and audit`:
    - Set `afterQuery` so the first two `SELECT *` reads `FROM live_agent_sessions` wait for each other, as `live-agent.handoff.local-db.test.mjs:56-91` does.
    - Run `Promise.all` over two identical handoffs with phone `"9123 4567"`. Both resolve `{ ok: true, status: "handoff_requested" }`.
    - Counts: `crm_leads` 1, `crm_activities` (`activity_type='follow_up'`) 1, `ai_audit_logs` (`action='live_agent.handoff'`) 1, `live_agent_messages` (`direction='system'`) 1, `ai_audit_logs` (`action='live_agent.handoff.phone_corrected'`) 0. The last count stays 0 after Task 3 too.

  The second test runs today's whole CTE on PGlite (array params, `FOR UPDATE`, `ON CONFLICT`), so it doubles as the harness proof.
- [ ] **Step 2: Prove the harness.** Run `node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/ai/live-agent.handoff.db.test.mjs`. Expected: both PASS before any production change. If a migration fails to exec on PGlite, the modules fail to import, or today's CTE errors on PGlite, STOP and apply the fallback in "Test harness decision", then report it.
- [ ] **Step 3: Write the failing tests** (all synthetic data):
  - `a new handoff lead starts at stage new`: handoff with `"9123 4567"`. The lead has `stage === "new"` and `source === "live_agent"`. The contact has `normalized_phone === "85291234567"` and `source === "live_agent"`.
  - `00852 and +852 inputs store the same normalized phone`: `"0085261234567"` → the contact's `normalized_phone === "85261234567"`.
  - `a phone matching an existing customer never changes that customer's contact or WhatsApp conversation`:
    - Seed contact X with `normalized_phone '85291234567'`, `phone '9123 4567'`, `name 'Existing customer'`, `email NULL`.
    - Seed conversation W for X: `channel_id 'synthetic-channel'`, `woztell_member_id 'synthetic-member'`, `status 'open'`, a fixed `updated_at`.
    - Snapshot `SELECT * FROM crm_contacts WHERE id=X` and `SELECT * FROM whatsapp_conversations WHERE id=W`.
    - Hand off with phone `"9123 4567"`, `name: "Typo visitor"`, `email: "typo@example.invalid"`.
    - Assert:
      - both snapshots are deep-equal after the handoff (email still `NULL`; `updated_at` unchanged);
      - the session has `conversation_id IS NULL` and `contact_id = X`;
      - exactly one `crm_activities` row for the lead has `activity_type='note'` and body `可能與現有 WhatsApp 對話相關（對話編號 ${W}）`;
      - the handoff audit has `metadata.possibleConversationId === W`, `metadata.contactCreated === false` and `metadata.conversationId === undefined`.
    - Repeat the whole test with X stored in the legacy form `normalized_phone '91234567'`.
  - `a new number creates a contact and records contactCreated in the handoff audit`: `metadata.contactCreated === true`, no possible-match note, `possibleConversationId === null`.

  In `ai-contract.test.mjs`, inside `live-agent handoff avoids fake Woztell conversations and implicit opt-in`, add:
  - `assert.doesNotMatch(server, /UPDATE\s+whatsapp_conversations/i)`
  - `assert.doesNotMatch(server, /'contacted'/)`
  - `assert.match(server, /可能與現有 WhatsApp 對話相關/)`
- [ ] **Step 4: Run to verify they fail.** Run the DB file (as in Step 2) and `node --test src/lib/ai/ai-contract.test.mjs`. Expected:
  - FAIL: `stage new` (gets `contacted`), `00852` (gets `0085261234567`), `existing customer` (W is `pending`, the session has a `conversation_id`, X's `updated_at` changed, no note), `contactCreated` (undefined), and the three static guards.
  - PASS: the Step 1 tests (regression guards).
- [ ] **Step 5: Implement** the CTE changes above.
- [ ] **Step 6: Run to verify they pass.** Run `npm run test:live-agent`, `npm run test:content-copilot`, `npm run typecheck` and `npm run lint`. Expected: PASS. Optionally, only if a local Postgres is listening on `127.0.0.1:55432`, also run `LOCAL_POSTGRES_URL=postgresql://postgres:local-audit-only@127.0.0.1:55432/postgres npm run test:live-agent:local-db`. Its assertions should still hold. It is not required, and the file is not modified.
- [ ] **Step 7: Commit** `src/lib/ai/live-agent.server.ts`, `src/lib/ai/live-agent.handoff.db.test.mjs`, `src/lib/ai/ai-contract.test.mjs` and `package.json` with the message `fix(live-agent): start handoff leads as new and never link existing WhatsApp threads`.

### Task 3: Phone correction while the lead is untouched; messages after handoff are kept

**Files:**
- Modify: `src/lib/ai/live-agent.server.ts`:
  - the branch at `:182-184`
  - the fallback at `:354-362`
  - `answerLiveAgentMessage` (`:92-141`)
  - `getLiveAgentSessionForMessage` (`:367-395`)
- Modify: `src/lib/ai/live-agent.handoff.db.test.mjs` (append tests)

**Interfaces:**
- `requestLiveAgentHandoff` (signature and return unchanged): when `session.status === "handoff_requested"`, call `await correctHandoffPhone(…)` and return `{ ok: true, status: "handoff_requested" as const }`. In the fallback (`:354-362`), when the re-read session is `handoff_requested`, also call `correctHandoffPhone` before returning. A racing second request with a different phone is then treated as a correction, and a request with the same phone is a no-op.
- Internal: `async function correctHandoffPhone(input: { sessionId: string; accessToken: string; name: string | null; phone: string; normalizedPhone: string; email: string | null; optInWhatsapp: boolean }): Promise<void>`. It is one statement. The CTE outline, as clauses (names are suggestions):
  1. `target AS MATERIALIZED`: session `s` JOIN `crm_leads l` ON `l.id = s.lead_id`, LEFT JOIN `crm_contacts c` ON `c.id = s.contact_id`. Conditions:
     - the session is owned (`id` and `access_token`) and `status='handoff_requested'`;
     - none of the pinned "staff have acted" signals;
     - the phone is NOT the same, per the pinned "same phone" rule.

     Lock with `FOR UPDATE OF s, l`. If `target` is empty, nothing below writes.
  2. `owned`: the current contact when it meets every pinned "created by this handoff" condition.
  3. `existing_for_new`: a contact other than the current one whose `normalized_phone` equals the new value, or its legacy 8-digit form. `ORDER BY` exact match first, `LIMIT 1`, `FOR UPDATE OF c` (as `candidate_contact` does). It is used read-only.
  4. `updated_owned`: `UPDATE crm_contacts SET phone=$phone, normalized_phone=$normalized, updated_at=now()`, only for `owned`, and only when `existing_for_new` is empty (this avoids the unique-key clash). It changes nothing else.
  5. `inserted_contact`: the same insert as the handoff (`source 'live_agent'`, `opt_in` from this request, the self-assignment `ON CONFLICT`). It runs only when neither `updated_owned` nor `existing_for_new` produced a row.
  6. `resolved`: one id from 4, 3 or 5.
  7. `relinked_lead` and `relinked_session`: set `crm_leads.contact_id` / `live_agent_sessions.contact_id` to `resolved`, with `updated_at=now()`, only where the value changes.
  8. `moved_activities`: this lead's `crm_activities` with `staff_user_id IS NULL` move to the `resolved` contact. This only happens on relink.
  9. `possible_conversation` and `possible_note`: the pinned read-only lookup for `resolved`, and the same note text as Task 2.
  10. `correction_audit`: `INSERT INTO ai_audit_logs` with `actor_type 'visitor'`, `action 'live_agent.handoff.phone_corrected'`, `subject_type 'live_agent_session'`, and metadata `{ leadId, fromContactId, toContactId, mode: 'updated_contact' | 'relinked', possibleConversationId }`. Never store a raw phone.
- Message path:
  - `getLiveAgentSessionForMessage` (`:373`) accepts `status IN ('open', 'qualified', 'handoff_requested')`.
  - In `answerLiveAgentMessage`, after the visitor insert (`:107-111`): if `session.status === "handoff_requested"`, do not call `answerFromPublicKnowledge` (`:113`). Instead:
    - insert an assistant row with `message_text = "已轉交代理，我哋會盡快聯絡你。"` (module constant `LIVE_AGENT_HANDED_OFF_REPLY`), `citations '[]'`, `safety_flags ARRAY['handoff_requested']` and `shown_publicly true`, as a separate `queryRows` call (distinct `created_at`);
    - bump the session's `updated_at`;
    - return `{ message: mapMessage(row), handoffSuggested: false }`.
  - Nothing is written to `crm_activities` or `crm_leads`. Closed sessions still get 400 (`:386`).

- [ ] **Step 1: Write the failing tests** (append to the DB file). Use a `snapshot()` helper that returns the ordered rows of `crm_contacts`, `crm_leads`, `live_agent_sessions` (id, status, contact_id, lead_id, conversation_id), `crm_activities`, `ai_audit_logs` and `whatsapp_conversations`.
  - `correction while uncontacted updates the contact this handoff created`:
    - Hand off with `"9123 4567"`, then hand off again with `"6123 4567"`.
    - The same contact id now has `normalized_phone '85261234567'` and `phone '6123 4567'`.
    - The lead's and session's `contact_id` are unchanged, and `crm_leads` still has 1 row.
    - There is one `live_agent.handoff.phone_corrected` audit with `mode 'updated_contact'`.
  - `same phone resubmitted is a no-op`: resubmit `"+852 9123 4567"` after `"91234567"`. `snapshot()` is unchanged and there is no correction audit.
  - `correction when the handoff matched an existing customer relinks to a new contact and leaves that customer unchanged`:
    - X is pre-existing (`85291234567`). Hand off with `9123 4567`, which links to X; snapshot X.
    - Correct to `6123 4567`. A new contact is created with `85261234567` and `source 'live_agent'`.
    - The lead and session now point to it.
    - X deep-equals its snapshot.
    - The lead's `follow_up` row now has the new `contact_id`.
    - The audit has `mode 'relinked'`.
  - `corrected number that belongs to another customer links read-only and notes the conversation`:
    - Seed Y (`85261234567`) with WozTell conversation V.
    - Hand off with a new number `9876 5432`, then correct to `6123 4567`.
    - The lead and session point to Y.
    - Y and V deep-equal their snapshots, and the session's `conversation_id` is null.
    - A note with V's id exists.
    - The contact created by the first handoff (`85298765432`) is not deleted: it was relinked away from, not updated, because `existing_for_new` won.
  - `correction is refused without any write once staff have acted`. Run once for each of the following, each on a fresh DB after a handoff with `9123 4567`, setting the signal directly in SQL:
    - `UPDATE crm_leads SET stage='contacted'`
    - `UPDATE crm_leads SET assigned_agent_id=<staff>`
    - `INSERT crm_activities(lead_id, staff_user_id, activity_type, body)` with `'note'`
    - `INSERT audit_logs(actor_id, action, subject_type, subject_id)` as `('lead.update', 'lead', <lead>)`

    Insert the staff via `staff_users` and `staff_roles`. Take a snapshot, resubmit `6123 4567`, and assert the result is `{ ok: true, status: "handoff_requested" }` and `snapshot()` deep-equals the one taken before.
  - `message after handoff is stored, answered with fixed copy and never calls the model`:
    1. Open a session and send `"想問屋苑"`. Expect `modelCalls === 1` (positive control).
    2. Hand off.
    3. Send `"仲有我想要高層"`.
    4. Expect `modelCalls` still 1, `result.message.message_text === "已轉交代理，我哋會盡快聯絡你。"`, `result.message.direction === "assistant"` and `handoffSuggested === false`.
    5. `live_agent_messages` for the session ends with a visitor row (`"仲有我想要高層"`) followed by the assistant reply.
    6. `crm_activities` and `crm_leads` counts are unchanged by the message.
  - `message to a closed session is still rejected`: `UPDATE live_agent_sessions SET status='closed'`; `answerLiveAgentMessage` rejects with `status === 400`.
- [ ] **Step 2: Run to verify they fail.** Run `node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/ai/live-agent.handoff.db.test.mjs`. Expected:
  - FAIL: the correction tests (phone unchanged; no audit), the existing-customer relink tests, and the after-handoff message test (400 "Live-agent session is not open.").
  - PASS: `refused once staff acted` (today nothing is ever written; it becomes a real guard once the correction exists), `same phone no-op`, and `closed session`.
- [ ] **Step 3: Implement** `correctHandoffPhone`, the branch, the fallback call and the message path.
- [ ] **Step 4: Run to verify they pass.** Run `npm run test:live-agent`, `npm run test:content-copilot`, `npm run typecheck` and `npm run lint`. Expected: PASS. Task 2's double-submit test must still show 0 correction audits.
- [ ] **Step 5: Commit** `src/lib/ai/live-agent.server.ts` and `src/lib/ai/live-agent.handoff.db.test.mjs` with the message `fix(live-agent): accept phone corrections and messages after handoff`.

### Task 4: Staff transcript on the lead panel (`fetchLeadLiveAgentTranscript` + `LeadChatTranscript`)

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts` (append after `:639`)
- Modify: `src/lib/neon/admin-data.server.ts`: append at the end of the file, after `writeAudit` (`:3792-3813`). Reuse `assertLeadInScope` (`:2476-2484`), which builds on `agentScope` (`:123-126`).
- Modify: `src/lib/neon/admin-data.ts`: append at the end of the file (`:1820`), following `fetchAdminLeadAiProfile` (`:1260-1274`) and `callStaffServerFn` (`:377`).
- Create: `src/components/admin/LeadChatTranscript.tsx` (load pattern of `src/components/admin/whatsapp/RelatedLeadConversations.tsx:1-46`)
- Create: `src/components/admin/LeadChatTranscript.test.tsx`
- Modify: `src/routes/admin.leads.tsx`:
  - import the component near `:28`;
  - render `{lead.source === "live_agent" ? <LeadChatTranscript key={lead.id} leadId={lead.id} /> : null}` between the 內部跟進紀錄 section (closes at `:1621`) and the AI 分析 section (opens at `:1623`).
- Modify: `scripts/browser-fixtures/no-link/synthetic-api.ts`: add `export const fetchLeadLiveAgentTranscript = async () => [];` next to `fetchAdminLeadAiProfile` (`:535`).
  - Every admin fixture aliases `@/lib/neon/admin-data` to a synthetic API that re-exports this file.
  - Without the stub, the `admin-daily-work` and `whatsapp-no-link` fixture builds, which render `admin.leads.tsx`, fail on a missing export.
- Modify: `src/lib/neon/admin-data.contract.test.mjs`:
  - add `"fetchLeadLiveAgentTranscript"` to the exports list (`:15-38`);
  - add `assert.match(client, /fetchLeadLiveAgentTranscriptServer[\s\S]*?requireStaff\(\["admin", "manager", "agent"\]\)/)`.
- Modify: `src/lib/ai/live-agent.handoff.db.test.mjs` (append scope tests; import `../neon/admin-data.server.ts` after the mocks)
- Modify: `package.json`: add `src/components/admin/LeadChatTranscript.test.tsx` to the bun list in `test:live-agent`

**Interfaces:**
- `export type AdminLeadTranscriptMessage = { role: "visitor" | "assistant" | "staff" | "system"; text: string; created_at: string };`
- Server: `export async function fetchLeadLiveAgentTranscript(input: { leadId: string }, actor: StaffAccess): Promise<AdminLeadTranscriptMessage[]>`.
  - Call `await assertLeadInScope(input.leadId, actor)` first.
  - Then select `m.direction, m.message_text, m.created_at` from `live_agent_messages m JOIN live_agent_sessions s ON s.id = m.session_id` WHERE `s.lead_id = $1::uuid`.
  - Take the newest `LEAD_TRANSCRIPT_LIMIT = 100` (`ORDER BY m.created_at DESC, m.id DESC LIMIT 100` in a subquery) and return them oldest first.
  - Map `created_at` with the file's `rowDate` and `direction` to `role`; unknown values become `"system"`.
  - It writes nothing.
- Wrapper: `export async function fetchLeadLiveAgentTranscript(options: { data: { leadId: string } }): Promise<AdminLeadTranscriptMessage[]>`. Called as `fetchLeadLiveAgentTranscript({ data: { leadId } })`, per the file's convention.
  - It wraps `fetchLeadLiveAgentTranscriptServer = createServerFn({ method: "GET" })`.
  - `.inputValidator((data: unknown) => z.object({ leadId: z.string().uuid() }).strict().parse(data))`.
  - `requireStaff(["admin", "manager", "agent"])`, the same roles as `fetchAdminLead`.
  - It goes through `callStaffServerFn` + `withStaffAuthHeaders`.
- Component:
  - `export type LeadChatTranscriptState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; messages: AdminLeadTranscriptMessage[] };`
  - `export function LeadChatTranscriptView({ state, onRetry }: { state: LeadChatTranscriptState; onRetry: () => void }): JSX.Element`. It renders:
    - `<section className="rounded-lg border p-4" aria-label="網站問樓助手對話">` with an `h3` 網站問樓助手對話;
    - loading → 載入中…;
    - error → `<p role="alert">未能載入網站對話紀錄。<button type="button">重新載入</button></p>`;
    - an empty ready state → 沒有網站對話紀錄;
    - otherwise an `<ol>` of `<li>` items, each with the role label, `formatHkDateTime(created_at)` from `@/lib/format`, and the text as plain React text with `whitespace-pre-wrap`. Never use `dangerouslySetInnerHTML`.
  - `export function LeadChatTranscript({ leadId }: { leadId: string }): JSX.Element`. It loads on mount and on retry, with a `live` flag, as in `RelatedLeadConversations`.

- [ ] **Step 1: Write the failing tests.**
  - DB file: `transcript is readable by the assigned agent and managers, in order, and refused to other agents`:
    - Use the Task 3 flow: message, handoff, then a message after the handoff.
    - Insert agent A, agent B and manager M into `staff_users` and `staff_roles`. Actors are `{ staffId, authUserId, email: null, name: null, roles: [role], bootstrap: false }`.
    - `UPDATE crm_leads SET assigned_agent_id=A`.
    - A and M get messages whose `role` and `text` sequence equals `visitor 想問屋苑 → assistant 合成答案 → system … → visitor 仲有我想要高層 → assistant 已轉交代理，我哋會盡快聯絡你。`.
    - B rejects with `(e) => e instanceof Response && e.status === 403`.
    - After `UPDATE crm_leads SET assigned_agent_id=NULL`, A also gets 403 and M still reads.
  - DB file: `transcript returns at most the latest 100 messages, oldest first`. Insert 120 visitor rows with increasing `created_at` and texts `m001`…`m120`. Expect length 100, first `m021`, last `m120`.
  - `LeadChatTranscript.test.tsx`, rendering `LeadChatTranscriptView`:
    - `loading state shows 載入中…`
    - `error state shows role=alert copy and a 重新載入 button`
    - `empty ready state shows 沒有網站對話紀錄`
    - `messages render in given order with role labels 訪客 / 問樓助手 / 系統 and the heading`
    - `message text is escaped, not HTML`: the text `<b>x</b>` appears as `&lt;b&gt;x&lt;/b&gt;` and no `<b>` element is present
  - `admin-data.contract.test.mjs`: the export and role assertions.
- [ ] **Step 2: Run to verify they fail.** Run `node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/ai/live-agent.handoff.db.test.mjs`, `bun test --no-env-file src/components/admin/LeadChatTranscript.test.tsx` and `node --test src/lib/neon/admin-data.contract.test.mjs`. Expected: FAIL (the functions and component are missing). If the bun import of `@/lib/neon/admin-data` fails to load in the component test, add `mock.module("@/lib/neon/admin-data", () => ({ fetchLeadLiveAgentTranscript: async () => [] }))` before a dynamic import, as `EstateGroupGrid.test.tsx` does.
- [ ] **Step 3: Implement** the type, the server function, the wrapper, the component, the route render and the fixture stub.
- [ ] **Step 4: Run to verify they pass.** Run:
  - `npm run test:live-agent`, `npm run test:command-center`
  - `npm run test:admin-daily-work:ui` and `npm run acceptance:whatsapp-no-link:synthetic` (both fixture builds must still compile)
  - `npm run typecheck`, `npm run lint`

  Expected: PASS.
- [ ] **Step 5: Commit** the touched files with the message `feat(admin): show the website chat transcript on live-agent leads`.

### Task 5: Widget: 轉介代理 disabled until the phone is valid, inline zh-HK error, normalised-number preview

**Files:**
- Modify: `src/components/live-agent/LiveAgentWidget.tsx`:
  - state at `:33-35`
  - `requestHandoff` at `:106-140`
  - the panel at `:217-248`, which moves into an exported `LiveAgentHandoffPanel` in the same file. It must stay in this file because `ai-contract.test.mjs:273-276` and `:282-296` read `<Checkbox`, `handoffConsent`, `opt_in_whatsapp: handoffConsent` and the aria-labels from `LiveAgentWidget.tsx`.
- Create: `src/components/live-agent/LiveAgentWidget.test.tsx`
- Modify: `package.json` (add `src/components/live-agent/LiveAgentWidget.test.tsx` to the bun list in `test:live-agent`)

**Interfaces:**
- Consumes `validateHandoffPhone`, `liveAgentPhoneErrorMessage`, `formatHandoffPhoneForDisplay` and `liveAgentPhoneErrorFromBody` from `@/lib/ai/live-agent` (Task 1).
- Produces `export function LiveAgentHandoffPanel(props: { phone: string; phoneTouched: boolean; consent: boolean; loading: boolean; serverError: string | null; onPhoneChange: (value: string) => void; onPhoneBlur: () => void; onConsentChange: (value: boolean) => void; onSubmit: () => void }): JSX.Element`. It derives `check = validateHandoffPhone(phone)`.
  - Input: keeps `placeholder="WhatsApp 電話"`, `aria-label="轉接 WhatsApp 電話"` and `autoComplete="tel"`. Add `inputMode="tel"`, `aria-invalid` (true while an error shows) and `aria-describedby` (the error id or preview id).
  - Error: `serverError ?? (phoneTouched && phone.trim() && !check.ok ? <INVALID copy> : null)`, rendered as `<p id="live-agent-handoff-phone-error" role="alert" className="text-xs text-destructive">`.
  - Preview, when `check.ok` and there is no error: `<p id="live-agent-handoff-phone-preview" className="text-xs text-muted-foreground">代理會用 {formatHandoffPhoneForDisplay(check.normalized)} 聯絡你</p>`.
  - Consent checkbox and label: unchanged.
  - Button: `disabled={loading || !check.ok}`, with the same icon and label 轉介代理.
- `LiveAgentWidget` changes:
  - New state `handoffPhoneTouched` and `handoffError: string | null`. `onPhoneChange` sets the phone and clears `handoffError`.
  - `requestHandoff` returns early unless `validateHandoffPhone(handoffPhone).ok`. The request body is unchanged: raw `phone`, `intent`, `opt_in_whatsapp: handoffConsent`.
  - On a non-OK response, read `await response.json().catch(() => null)`. If `liveAgentPhoneErrorFromBody(body)` returns a message, call `setHandoffError(message)` and add no chat message. Otherwise keep the existing failure copy (`:135`).
  - On success, keep the existing copy (`:129`) and clear `handoffError`.
  - Keep the trigger button classes `fixed bottom-4 right-4…` (`:146`), which `property-decision.test.mjs:170` asserts.
- The `sendMessage` path needs no client change. After Task 3 the server returns 200 with the fixed reply.

- [ ] **Step 1: Write the failing test** `src/components/live-agent/LiveAgentWidget.test.tsx` (bun; `renderToStaticMarkup` + cheerio on `LiveAgentHandoffPanel`, with no-op handlers):
  - `button disabled for a 7-digit number and no preview` (`"9123456"`)
  - `blank phone keeps the button disabled without an alert`
  - `valid HK number enables the button and previews +852 9123 4567` (`"9123 4567"` → the text `代理會用 +852 9123 4567 聯絡你`)
  - `international number previews +447700900123`
  - `touched invalid number shows the INVALID copy in role=alert and aria-invalid=true`
  - `server 400 phone error is shown in role=alert`: `serverError` is `liveAgentPhoneErrorFromBody({ code: "LIVE_AGENT_PHONE_REQUIRED", error: "raw" })`. The alert text equals 請輸入電話號碼，方便代理聯絡你。 and the markup does not contain `raw`.
  - `loading disables the button even with a valid number`
  - `keeps the zh-HK aria-labels for phone and consent` (`轉接 WhatsApp 電話`, `同意 WhatsApp 跟進聯絡`)
- [ ] **Step 2: Run to verify it fails.** Run `bun test --no-env-file src/components/live-agent/LiveAgentWidget.test.tsx`. Expected: FAIL (`LiveAgentHandoffPanel` is not exported).
- [ ] **Step 3: Implement** the panel extraction and the widget wiring.
- [ ] **Step 4: Run to verify it passes.** Run `npm run test:live-agent`, `npm run test:content-copilot` (widget source contracts), `npm run test:property-experience`, `npm run typecheck` and `npm run lint`. Expected: PASS. Then run the Batch Verification list, including the 375/1440 px screenshots of the panel states.
- [ ] **Step 5: Commit** `src/components/live-agent/LiveAgentWidget.tsx`, `src/components/live-agent/LiveAgentWidget.test.tsx` and `package.json` with the message `fix(live-agent): validate the handoff phone in the widget before submit`.
