# FX-11a: Staff AI tools fail visibly, stop paying for unused embeddings, and never invent numbers. Implementation plan

**Owner decisions (binding):**
1. **D1 = (a).** The public chatbot makes no model call ([FX-11b-chatbot-deterministic.md](FX-11b-chatbot-deterministic.md), PR 1). The FX-11a guardrails are therefore kept only where a **staff** tool still calls a model, or where the knowledge index still feeds the content copilot. The per-item decisions are in PR 1, "Scope decision", table 2.
2. **This is PR 2 of 2. Cut it from `main` only after PR 1 has merged.** Never stack it on `fix/fx-11-chatbot`: the repo does not auto-delete head branches, so a stacked base would not retarget to `main`. Suggested branch: `fix/fx-11a-ai-staff-guardrails`.
3. **No migration.** No new env var. **One env var is removed:** `AI_GATEWAY_EMBEDDING_MODEL`.
4. **Copy.** zh-HK. This PR changes admin copy only, listed in the Task 3 copy table for owner review. There is no brand or marketing copy.
5. **AI tests use a mocked provider.** Nothing calls a model, WozTell or production.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- The knowledge index, which the content copilot cites as evidence, holds only published FAQs and estates, and labels listing numbers with units.
- A failing AI Gateway call in CRM analysis gives up within 15 seconds, retries once, and logs a reason code that staff and the canary can see.
- Knowledge rebuilds make **no provider call**: the unused embeddings are dropped, together with their env var. The CMS 重建索引 button queues the existing background job instead of rebuilding inside the request. FAQ import stops rebuilding in-request, because the database triggers already queue a repair.
- The content copilot cannot slip a new number into a patch: any number that is not in the field's old value or in the cited evidence blocks that patch until staff edit it by hand.
- The CRM lead score no longer rewards a timeline the model guessed.

Findings: E-03 (index), E-05 (CRM part), E-10, E-13 (CRM part), E-16, E-17, E-22 (score part).

**Approach.**
- **Task 1 (index).** Add `published = true` to the FAQ and estate source queries and to `current_public_sources`. Format listing numbers with the site's own helpers. An unpublished row drops out of search at once, through the revision gate, even before the next rebuild.
- **Task 2 (provider client).** A `createAiGatewayClient({ fetchImpl, sleepImpl, budgetMs, maxRetries })` factory, the `createOpenCodeGoClient` pattern, with one `AbortSignal.timeout(budgetMs)` spanning every attempt. The existing exports delegate to a default client, so `crm-enrichment.server.ts` is untouched. A failure returns the same `error` code as today plus a `reason`, and logs `[ai] provider_failed` with the reason and HTTP status only.
- **Task 3 (embeddings and rebuild).** Delete `embedAiTexts`, the embedding config and the dimension checks. The `embedding` column stays and receives NULL. The rebuild server function enqueues the same `ai.knowledge.rebuild` job as `/api/admin/ai/rebuild-knowledge`, with the same idempotency window.
- **Task 4 (copilot numbers, lead score).** Reuse PR 1's `number-grounding.js` in `validateGeneratedProposal`. Remove the timeline term from `scoreLeadProfile`.

**Tech stack.** As PR 1: `node --test`, `bun test`, owned Postgres with `mockOwnedServerDb` and a mocked `provider.server.ts`. No browser suite is new; `test:cms` and `test:operations` cover the admin copy.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: E-03, E-05, E-10, E-13, E-16, E-17, E-22 (`:250-267`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-11a (`:508-542`), Global constraints (`:17-39`).
- PR 1 plan: "Scope decision" (the model-call map and the per-item table).

## Verified current behaviour (main `99f1ce87`; re-check after PR 1 merges)

| # | Fact | Where |
|---|---|---|
| 1 | **The index ignores publication.** The FAQ query (`:292-294`) and the estate query (`:295-301`) have no `published` filter, and both sources hard-code `published: true` (`:322`, `:339`). `current_public_sources` repeats this (`knowledge-freshness.server.ts:31-32`). The columns exist, `NOT NULL DEFAULT true` (`20260711090000_cms_content_revisions.sql:1-24`). | `src/lib/ai/knowledge.server.ts:290-394` |
| 2 | **The copilot cites the index.** `searchPublicKnowledge({ query, limit: 6 })` feeds `internalEvidence` (`content-copilot-context.server.ts:65-69`). After PR 1 the copilot is the index's only reader. | as listed |
| 3 | **Listing numbers have no units.** `listingFacts` writes `出售：6800000`, `出租：38000`, `實用面積：512` (`:518-534`). | `knowledge.server.ts` |
| 4 | **Provider client.** 20 s per attempt, up to 3 attempts, 300 ms × 2ⁿ backoff (`:5-8`, `:23-47`). Errors are swallowed into `AI_GENERATION_FAILED` / `AI_EMBEDDINGS_FAILED` with no log (`:117-119`, `:194-196`). CRM logs only that code (`crm-enrichment.server.ts:139-142`) and stores `result_kind='fallback'` (`20261003030000_crm_analysis_runs.sql:9`). Callers: CRM `generateAiJson` (`crm-enrichment.server.ts:114`) and embeddings (`knowledge.server.ts:123`). After PR 1, `generateAiText` has no caller except `generateAiJson`. | `src/lib/ai/provider.server.ts` |
| 5 | **Embeddings are paid for and never read.** Generated in `rebuildAiKnowledgeIndex` (`knowledge.server.ts:119-123`), checked against 1536 dimensions (`:20-23`, `:139-145`, `:165-169`, `:576-593`), and stored in `ai_knowledge_chunks.embedding`. There is no `<=>` or `<->` in `src`. The repair job already skips them (`:548-552`). | as listed |
| 6 | **The embedding env var is wired into five places.** `config.server.ts:5,11,17`; health `ai.gateway` is healthy only with it (`health.server.ts:75`, `:96-101`); `release-readiness.mjs:47`; `.env.example:147`; the admin label 「AI Gateway（生成／向量）」 (`AdminOperationsOverview.tsx:18-20`). Tests: `ai-contract.test.mjs:63` (exports), `:125` (rebuild regex `await embedAiTexts`), `:156` and `:191` (secret-name scanner list). Test mocks provide `embedAiTexts`: `knowledge-freshness.db.test.mjs:19`, `knowledge-invalidation.db.test.mjs:18`, `scripts/no-link-local-postgres.test.mjs:193`. | as listed |
| 7 | **Source changes already queue a repair.** Triggers on `faqs`, `estates`, `articles`, `properties`, `property_public_members`, `property_public_groups`, `property_sync_fields` and `mls_source_state` call `ep_queue_knowledge_repair`, which marks the chunks stale and inserts an `ai.knowledge.repair` job (`20261003010000_ai_knowledge_durable_repair.sql:14-28`, `:67-81`). | as listed |
| 8 | **The CMS rebuilds in-request twice.** After a FAQ import (`admin.cms.tsx:831-833`) and on the 重建索引 button (`:908-921`, buttons `:1641-1648`, `:1718-1726`). The server function `rebuildAdminAiKnowledgeServer` (`admin-data.ts:575-583`, pinned by `admin-data-permissions.test.mjs:33-38`) calls `rebuildAdminAiKnowledge` (`admin-data.server.ts:1908-1914`), which runs `rebuildAiKnowledgeIndex()` (imported at `:65`). The unused route `api.admin.ai.rebuild-knowledge.ts:8-25` already enqueues `ai.knowledge.rebuild` with key `ai.knowledge.rebuild:<5-minute window>`, pinned by `control-plane.routes.test.mjs:113-122`. The result type is `AdminAiKnowledgeRebuildResult` `{ indexedSources, indexedChunks }` (`admin-data.types.ts:540-543`). | as listed |
| 9 | **CMS copy that is wrong after PR 1** (the public bot no longer reads the index): 「上載或貼上 FAQ 檔案，儲存後會自動重建 AI live agent 知識庫。」 (`admin.cms.tsx:1347`), 「有 N 段內容已過時，前台 AI 仍會引用舊資料，請重建索引。」 (`:1714-1715`), 「…匯入後會自動重建 AI 知識庫。」 (`:2555`), 「每條會儲存到 Neon，然後即時重建 live agent 知識庫。」 (`:2569`). | `src/routes/admin.cms.tsx` |
| 10 | **Copilot validation.** `validateContentCopilotProposal` checks fields and evidence ids only (`content-copilot.ts:203-229`). `validateGeneratedProposal` adds the selected-field, trusted-evidence and `before` checks (`content-copilot.server.ts:323-352`). A patch with `unsupportedClaims.length > 0` cannot be applied, and the UI shows 「未支援聲稱：…」 (`AdminContentCopilot.tsx:231`, `:243`, `:616`, `:731-733`; `content-copilot.ts:269`). | as listed |
| 11 | **Lead score.** `if (input.timeline === "30_days") score += 20;` (`crm-rules.ts:72`). The timeline comes from the model (`crm-enrichment.server.ts:152-160`, `value.timeline`). `ai-workflow.test.mjs:159-182` passes with or without it (warm > cold on the other terms). | as listed |
| 12 | **Wiring.** `test:crm-analysis` (`package.json:49`, CI `ci.yml:122`), `test:content-copilot` (`:47`, `ci.yml:121`), `test:ai-knowledge:db` (`:48`, `ci.yml:157`), `test:cms` (`:54`, `ci.yml:125`), `test:operations` (`:41`, `ci.yml:114`), `test:control-plane` (`:42`, `ci.yml:116`). | `package.json` |

## Global Constraints

- **Owner safety rules (binding).** No model, WozTell or production call. Provider tests use an injected `fetchImpl` and a dummy key read from a test-only `process.env` override that is restored key by key. Owned tests mock `provider.server.ts` to throw and count. Synthetic ids start `79120000-0000-4000-8000-`.
- **Behaviour that must not change.**
  - CRM analysis still persists the fallback profile when the model fails, with `generated_by='fallback'` (`crm-enrichment.server.ts:130-145`).
  - The `ai.knowledge.rebuild` and `ai.knowledge.repair` job contracts keep their payloads and the result keys `indexedSources`, `indexedChunks` and `embeddingDimensionFailures` (always 0 now). This keeps `job-handlers.server.ts`, which FX-10b edits, untouched.
  - The route `api.admin.ai.rebuild-knowledge.ts` stays byte-for-byte (`control-plane.routes.test.mjs:113-122`).
- **Migrations.** None. The `ai_knowledge_chunks.embedding vector(1536)` column stays and receives NULL. Dropping it is not worth a migration.
- **Configuration.** Remove `AI_GATEWAY_EMBEDDING_MODEL` from code, health, release readiness and `.env.example`. **Keep its name in the secret scanner lists** (`ai-contract.test.mjs:156`, `:191`), so a stray client reference is still caught. No new env var.
- **Copy.** Admin zh-HK only, in the Task 3 table.
- **Avoid conflicts with open work.** Diffs taken against `99f1ce87`. Re-check the hunks after PR 1 merges.

  | Work | Overlap | Rule |
  |---|---|---|
  | #227 FX-07 (`origin/fix/fx-07-jobs-drain`) | `health.server.ts`: FX-07 edits `:1-16`, `:128-136`, `:203-256`; this PR edits `:67-101`. `AdminOperationsOverview.tsx`: FX-07 inserts `"jobs.queue"` after `:22` and edits `:59-86`; this PR edits `:18-20`. `.env.example`: FX-07 edits `:217-224`; this PR edits `:134-147`. | Touch only those line ranges. If FX-07 merges first, the Overview hunks are adjacent: keep FX-07's `"jobs.queue"` line and change only the `"ai.gateway"` label and the comment above it. |
  | FX-10b (local `fix/fx-10b-campaign-retry`) | `admin-data.server.ts`: FX-10b edits the import block `:34-105` and `:3462+`; this PR edits `:65` (remove one import) and `:1908-1914`. `admin-data.types.ts`: FX-10b `:209+`; this PR `:540-543`. `admin-data.ts`: FX-10b `:1852+`; this PR none. `job-handlers.server.ts`: FX-10b `:210`; this PR none. Migrations and pinned counts: FX-10b only. | Remove only line `:65`. Load `enqueueJob` with `await import("../control-plane/jobs.server")` inside the function, so the import block is not touched again. Do not touch `job-handlers.server.ts`, `migration-versions.js` or the pinned counts. |
  | PR 1 (FX-11b) | Merged before this starts. | Re-read `knowledge.server.ts` and the two `knowledge-*.db.test.mjs` files on `main` first. PR 1 deleted `:245-288`, `:679-693` and `:738-745`, so every anchor below `:245` moves up by about 60 lines. Find the code by function name. |
- **Committing.** `git add <paths>` only; never `bun.lockb`. Conventional commits with a scope, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its suites. The PR also passes `npm run build`, every `playwright.admin-owned.config.ts` suite, and `npm run test:live-agent:eval:db` (PR 1's eval must stay 20/20).

## Review Focus

1. **The index keeps serving an FAQ or estate after staff unpublish it.** *Test (Task 1):* `unpublishing an indexed estate removes it from search before any rebuild`.
2. **The new time budget turns a slow but successful CRM analysis into a fallback,** or a retry fires after the budget has run out. *Test (Task 2):* `a response within the budget is returned, and no retry starts after the budget is spent`.
3. **The failure log leaks the prompt, the key or lead data.** *Test (Task 2):* `the failure log carries only the reason and status`.
4. **Staff think the rebuild finished when it was only queued,** or the button now does nothing. *Tests (Task 3):* `the rebuild server function enqueues the job and never rebuilds in-request`, plus the toast copy assertion in `admin.cms.usability.test.mjs`.
5. **The number check blocks good copilot patches,** such as a rewrite that keeps the same numbers in a new format, or a factual patch citing evidence. *Tests (Task 4):* `a patch that keeps the same numbers in another format is not flagged`; `a factual patch whose number is in its cited evidence is not flagged`.

## Out of scope / follow-ups

| Follow-up | Owner | Why |
|---|---|---|
| E-11: rank per source type in SQL instead of the newest 800 chunks | Dropped; reopen only with D1 (c) | After PR 1 the index's only reader is the copilot, which always also cites the saved record itself (`content-copilot-context.server.ts:56-64`). The audit marks E-11 as a GUESS. |
| E-14 retention job | FX-18 | Needs the owner's retention period (PR 1, Open question 8). |
| E-20 rendered citations | Done in PR 1 (cards). | — |
| E-22 consent for existing contacts on handoff | Dropped | It conflicts with FX-03's rule that unverified web input never modifies an existing contact (`live-agent.server.ts:253-256`, `ai-contract.test.mjs:270-274`). Consent stays on the session (`live_agent_sessions.opt_in_whatsapp`). |
| Copilot client budget (OpenCode Go, 30 s × 3) | FX-17 (admin UX) if staff report waits | It is a separate client (`opencode-go.server.ts:6-8`), not `provider.server.ts`. |
| Drop `ai_knowledge_chunks.embedding` and `embeddingDimensionFailures` | FX-19a cleanup | Avoids a migration here and keeps FX-10b's `job-handlers.server.ts` hunk conflict-free. |
| Delete `generateAiText` as a public export | FX-19a | After PR 1 only `generateAiJson` calls it; kept to avoid churn in mocks. |

---

### Task 1: The knowledge index honours publication and labels units (E-03 index, E-16)

**Files:**
- **Modify `src/lib/ai/knowledge.server.ts`** (`fetchPublicKnowledgeSources`, `listingFacts`):
  - FAQ query: `… FROM faqs f WHERE f.published = true ORDER BY scope, sort_order, created_at`.
  - Estate query: `… FROM estates e WHERE e.published = true ORDER BY name_zh`.
  - `listingFacts`:
    - sale → `出售：${formatHkd(price)}（${formatManDisplay(price)}）`, giving `出售：$6,800,000（680萬）`;
    - rent → `出租：${formatHkd(rent)}／月`;
    - area → `實用面積：${formatArea(area)}` (`512 呎`);
    - a missing value stays `待核實`.
    - Import `formatArea`, `formatHkd` and `formatManDisplay` from `@/lib/format`.
- **Modify `src/lib/ai/knowledge-freshness.server.ts:31-32`:** `… FROM faqs f WHERE f.published = true` and `… FROM estates e WHERE e.published = true`.
- **Modify `src/lib/ai/knowledge-freshness.db.test.mjs`:** add the subtests below to the existing container.

- [ ] **Step 1: write the failing tests** (`knowledge-freshness.db.test.mjs`, existing `withOwnedPostgres` block, provider mocked):
  - `unpublished FAQ never in context` (fix-plan name). Insert FAQ 「FX11A 隱藏問題」 with `published=false` and answer `FX11A_TOKEN`. Run `rebuildAiKnowledgeIndex({ allowEmbeddings: false })` (Task 3 removes the option; until then pass it). `searchPublicKnowledge({ query: "FX11A" })` → 0 rows. The `ai_knowledge_sources` row for that FAQ is absent, or `published=false` with `public_visibility='staff'`.
  - `unpublishing an indexed estate removes it from search before any rebuild`. Index the published estate `bellagio` and search 「碧堤半島」 → at least 1 estate row. `UPDATE estates SET published=false WHERE slug='bellagio'` → the same search returns 0 estate-type rows **without** a rebuild. Restore in `finally`.
  - `listing chunk text carries HK$ and 呎 units`. Index a synthetic active sale listing at 6,800,000 with area 512 → its chunk text contains `出售：$6,800,000（680萬）` and `實用面積：512 呎`, and does not contain `出售：6800000`.
  - Run `npm run test:ai-knowledge:db`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:ai-knowledge:db`, `npm run test:content-copilot`, `npm run test:live-agent:eval:db`, `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(ai): keep unpublished FAQs and estates out of the knowledge index and label listing prices and areas

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: The gateway client gives up within 15 s, retries once, and logs why (E-05, E-13 for CRM)

**Files:**
- **Modify `src/lib/ai/provider.server.ts`:**
  - `:5-8`: `AI_TOTAL_BUDGET_MS = 15000`, `AI_MAX_RETRIES = 1`, `AI_RETRY_DELAY_MS = 300`.
  - Replace `fetchWithRetry` (`:23-47`) and the bodies of `generateAiText`/`generateAiJson` with a `createAiGatewayClient` factory. The exported functions delegate to a module-level default client.
  - `:117-119` (and the embeddings catch until Task 3 deletes it): log and return `reason`.
- **Create `src/lib/ai/provider.test.mjs`** (node).
- **Modify `package.json:49` (`test:crm-analysis`):** append `src/lib/ai/provider.test.mjs`.

**Interfaces:**
```ts
export type AiFailureReason = "AI_TIMEOUT" | "AI_NETWORK" | `AI_HTTP_${number}` | "AI_RESPONSE_INVALID" | "AI_DISABLED";
export function createAiGatewayClient(deps?: {
  fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void>;
  budgetMs?: number; maxRetries?: number; config?: AiServerConfig;
}): {
  generateText(input: { system: string; prompt: string; temperature?: number; maxOutputTokens?: number }):
    Promise<{ ok: true; text: string; error: null; metadata: AiProviderMetadata }
          | { ok: false; text: ""; error: "AI_DISABLED" | "AI_GENERATION_FAILED"; reason: AiFailureReason }>;
  generateJson<T>(input: { system: string; prompt: string; fallback: T }): Promise<AiJsonResult<T> & { reason?: AiFailureReason }>;
};
// One AbortSignal.timeout(budgetMs) covers all attempts. Retry only on network error, 429 or 5xx,
// only if at least AI_RETRY_DELAY_MS + 1000 ms of budget remain. 4xx other than 429 is never retried.
// On failure: console.error("[ai] provider_failed", { reason, status }) — status is the HTTP status or null.
// No prompt, system text, key, model output or URL is logged.
export const generateAiText: ReturnType<typeof createAiGatewayClient>["generateText"];   // same signature as today
export async function generateAiJson<T>(...): Promise<AiJsonResult<T>>;                   // same signature as today
```

- [ ] **Step 1: write the failing tests** (`provider.test.mjs`; `config` injected as `{ apiKey: "test-key-not-real", textModel: "test/model", enabled: true, embeddingModel: null }`):
  - `a hung provider gives up within the budget with at most one retry`. `fetchImpl` never resolves until its `signal` aborts. With `budgetMs: 60`: the result is `{ ok:false, error:"AI_GENERATION_FAILED", reason:"AI_TIMEOUT" }`, `fetchImpl` was called at most twice, and the elapsed time is under 600 ms.
  - `a response within the budget is returned, and no retry starts after the budget is spent`. The first call answers 503 after 50 ms with `budgetMs: 1000`: there is one retry, and the second answer (200) is returned. With `budgetMs: 60`, after the 503 no second call is made.
  - `401 is not retried and logs AI_HTTP_401`. One call; `reason` is `"AI_HTTP_401"`.
  - `the failure log carries only the reason and status`. `console.error` is mocked and the prompt is `"PROMPT_SECRET_合成"`. There is exactly one call, with args deep-equal `["[ai] provider_failed", { reason: "AI_HTTP_500", status: 500 }]`. No logged string contains `PROMPT_SECRET`, `test-key-not-real` or `ai-gateway`.
  - `a missing content field is AI_RESPONSE_INVALID`.
  - `the CRM fallback still persists when the provider fails` is already covered by `crm-analysis-persistence.db.test.mjs`. Re-run it; do not duplicate it.
  - Run `npm run test:crm-analysis`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:crm-analysis`, `npm run test:crm-analysis:db`, `npm run test:ai-knowledge:db`, `npm run lint` and `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(ai): give AI Gateway calls a 15-second budget with one retry and log the failure reason

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: No embeddings, one fewer env var, and the rebuild runs as the background job (E-10)

**Files:**
- **Modify `src/lib/ai/provider.server.ts`:** delete `embedAiTexts` (`:156-197`).
- **Modify `src/lib/ai/config.server.ts`:** remove `embeddingModel` (`:5`, `:11`, `:17`).
- **Modify `src/lib/ai/knowledge.server.ts`:**
  - delete the `embedAiTexts` import, `EMBEDDING_DIMENSIONS` (`:20-23`), the `allowEmbeddings` option and the embedding call (`:90`, `:96`, `:119-123`), the dimension accounting (`:99`, `:140-145`, `:165-169`) and `embeddingVectorString` (`:576-593`);
  - `preparedChunks[].embedding` is `null`;
  - `repairPublicKnowledgeIndex` no longer passes `allowEmbeddings`;
  - the return value stays `{ indexedSources, indexedChunks, embeddingDimensionFailures: 0 }`.
- **Modify `src/lib/control-plane/health.server.ts:67-101` only:** drop `embeddingModel` from `aiGateway`. Status `healthy` when `apiKey && model`. Comment: "Backs CRM analysis only."
- **Modify `scripts/operations/release-readiness.mjs:47`:** `[["AI_GATEWAY_API_KEY"], ["AI_GATEWAY_MODEL"]]`.
- **Modify `.env.example:134-147`:** delete `AI_GATEWAY_EMBEDDING_MODEL=""`. Reword the comment: "AI Gateway: admin CRM lead analysis only. Unset = CRM analysis stores the rule-based fallback."
- **Modify `src/components/admin/operations/AdminOperationsOverview.tsx:18-20`:** label `"ai.gateway": "AI Gateway（CRM 分析）"`, with the comment updated.
- **Modify `src/lib/neon/admin-data.server.ts`:**
  - remove the import at `:65`;
  - `rebuildAdminAiKnowledge` (`:1908-1914`) becomes:
    ```ts
    const { enqueueJob } = await import("../control-plane/jobs.server");
    const activeWindow = Math.floor(Date.now() / (5 * 60 * 1_000));
    const job = await enqueueJob({ jobType: "ai.knowledge.rebuild", payloadVersion: 1,
      payload: { requestedByStaffId: actor.staffId },
      idempotencyKey: `ai.knowledge.rebuild:${activeWindow}`, actorStaffId: actor.staffId });
    await writeAudit(actor.staffId, "ai.knowledge.rebuild.queued", "ai_knowledge", undefined, { jobId: job.id });
    return { jobId: job.id, status: job.status };
    ```
- **Modify `src/lib/neon/admin-data.types.ts:540-543`:** `export type AdminAiKnowledgeRebuildResult = { jobId: string; status: string };`. The name is kept, so `admin-data.server.ts:51` is unchanged.
- **Modify `src/routes/admin.cms.tsx`:**
  - FAQ import (`:816-834`): drop the `rebuildAdminAiKnowledge()` call and the rebuild wording.
  - `handleRebuildKnowledge` (`:908-921`): toast the queued copy.
  - The copy at `:826`, `:833`, `:841`, `:912`, `:1347`, `:1647`, `:1714-1715`, `:2555` and `:2569` per the table below.
- **Modify tests:**
  - `ai-contract.test.mjs:63`: provider exports become `["generateAiText", "generateAiJson"]`.
  - `ai-contract.test.mjs:125`: replace with `assert.doesNotMatch(rebuild, /embedAiTexts|embedding model/i)`.
  - Leave `:156` and `:191` (the scanner list) unchanged.
  - `knowledge-freshness.db.test.mjs:19` and `knowledge-invalidation.db.test.mjs:18`: drop the `embedAiTexts` mock key. `scripts/no-link-local-postgres.test.mjs:193` (FX-07 also edits that file) is left alone: an extra mock key is harmless.

**Copy table (admin zh-HK, for owner review; not brand copy):**

| Place | Old | New |
|---|---|---|
| `admin.cms.tsx:1347` | 上載或貼上 FAQ 檔案，儲存後會自動重建 AI live agent 知識庫。 | 上載或貼上 FAQ 檔案。已發佈的 FAQ 會即時用於網站問樓助手。 |
| `:826` (partial import) | …AI 知識庫尚未重建，請修正後重新匯入，或按「重建索引」。 | …請修正後重新匯入。 |
| `:833` (success) | 已匯入 N 條 FAQ，AI 知識庫已重建 M 段內容 | 已匯入 N 條 FAQ。 |
| `:841` | …AI 知識庫可能尚未重建。 | (sentence removed) |
| `:912` (button toast) | AI 知識庫已重建：X 個來源，Y 段內容 | 已排程重建 AI 知識庫，完成後「待重建段數」會歸零。 |
| `:1647` (loading label) | 重建中… | 排程中… |
| `:1714-1715` | 有 N 段內容已過時，前台 AI 仍會引用舊資料，請重建索引。 | 有 N 段內容已過時，內容副駕暫時會參考舊資料。系統會自動更新，亦可按「重建索引」。 |
| `:2555` | …匯入後會自動重建 AI 知識庫。 | …匯入後，已發佈的 FAQ 會即時用於網站問樓助手。 |
| `:2569` | 每條會儲存到 Neon，然後即時重建 live agent 知識庫。 | 每條會儲存到 Neon，已發佈的會即時用於網站問樓助手。 |
| `AdminOperationsOverview.tsx:20` | AI Gateway（生成／向量） | AI Gateway（CRM 分析） |

- [ ] **Step 1: write the failing tests.**
  - `ai-contract.test.mjs`:
    - `knowledge rebuild never calls an embedding provider`. `provider.server.ts` has no `embedAiTexts` export. `knowledge.server.ts` contains neither `embedAiTexts` nor `EMBEDDING_DIMENSIONS`. `config.server.ts` does not read `AI_GATEWAY_EMBEDDING_MODEL`.
    - `the rebuild server function enqueues the job and never rebuilds in-request`. `functionSource(adminDataServer, "rebuildAdminAiKnowledge")` matches `jobType: "ai.knowledge.rebuild"` and `ai.knowledge.rebuild:${activeWindow}`, and does not match `rebuildAiKnowledgeIndex`.
  - `knowledge-invalidation.db.test.mjs`: `rebuild stores chunks with NULL embedding and makes no provider call`. The provider mock throws and counts. After `rebuildAiKnowledgeIndex()`: `SELECT count(*) FROM ai_knowledge_chunks WHERE embedding IS NOT NULL` = 0, chunks exist, and calls = 0.
  - `src/lib/control-plane/environment-health.test.mjs`: `ai.gateway is healthy with only the key and model`.
  - `scripts/operations/release-readiness.test.mjs`: `ai.gateway readiness no longer lists the embedding model`.
  - `src/routes/admin.cms.usability.test.mjs`: `FAQ import no longer rebuilds in-request and the rebuild button reports a queued job`. The `handleFaqImport` source does not call `rebuildAdminAiKnowledge`. `handleRebuildKnowledge` contains 已排程重建 AI 知識庫. The file no longer contains 前台 AI 仍會引用舊資料 or 重建 live agent 知識庫.
  - Run `npm run test:content-copilot`, `npm run test:ai-knowledge:db`, `npm run test:control-plane` and `npm run test:cms`. They must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:content-copilot`
  - `npm run test:ai-knowledge:db`
  - `npm run test:control-plane`
  - `npm run test:cms`
  - `npm run test:operations`
  - `npm run test:crm-analysis`
  - `npm run test:live-agent:eval:db`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build` (the prebuild `check-required-env.mjs` must not require the removed var: `grep EMBEDDING scripts/check-required-env.mjs` is empty today; keep it so)

  Then `grep -rn "AI_GATEWAY_EMBEDDING_MODEL" src scripts .env.example` shows only the two scanner lists in `ai-contract.test.mjs`.
- [ ] **Step 4: commit.**
  ```
  refactor(ai): stop generating unused embeddings, drop AI_GATEWAY_EMBEDDING_MODEL, and queue CMS knowledge rebuilds as a job

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: Copilot patches cannot add unsourced numbers, and the lead score ignores the model's timeline (E-17, E-22)

**Files:**
- **Modify `src/lib/ai/content-copilot.server.ts:323-352`** (`validateGeneratedProposal`). After the existing checks, map each patch:
  - text `after` = `patch.after` as text (arrays joined with `、`; numbers stringified);
  - facts = `[stringify(patch.before), ...cited evidence excerpts and titles for patch.evidenceIds]`;
  - `ungrounded = ungroundedNumbers(after, facts)` from `./number-grounding.js` (PR 1);
  - if any, return the patch with `unsupportedClaims: [...patch.unsupportedClaims, ...ungrounded.map((raw) => \`數字未有來源：${raw}\`)]` (deduplicated).
  - This applies to every claim type. A `factual_*` patch whose number is in its cited evidence passes.
- **Modify `src/lib/ai/crm-rules.ts:58-76`:** delete the `timeline` input and line `:72`.
- **Modify `src/lib/ai/crm-enrichment.server.ts:157`:** drop `timeline: value.timeline` from the `scoreLeadProfile` call. The stored `timeline` field itself stays: it is shown to staff as the model's summary, not used in scoring.
- **Modify `src/lib/ai/ai-workflow.test.mjs:159-182`:** drop the `timeline` keys from both calls (the test still passes on the other terms).
- **Modify `src/lib/ai/content-copilot-service.test.mjs`** and **`ai-workflow.test.mjs`:** add the tests below.

**Copy (admin, for owner review):** the flag text 「數字未有來源：<number>」, shown inside the existing 「未支援聲稱：…」 line.

- [ ] **Step 1: write the failing tests.**
  - `content-copilot-service.test.mjs`, with `createContentCopilotService` and the injected `generate` stub from `:165-210`:
    - `a subjective patch that adds a price not in before or evidence is flagged and cannot be applied`. `before` is 「海景兩房單位」, `after` is 「海景兩房單位，售價 $7.2M」, claim `subjective`. Then `proposal.patches[0].unsupportedClaims` contains `數字未有來源：$7.2M`, and `applySelectedContentPatches(…, ["description"], …)` leaves `description` unchanged.
    - `a patch that keeps the same numbers in another format is not flagged`. `before` 「售價 6,800,000」 → `after` 「售價 680萬」 → `unsupportedClaims` = `[]`.
    - `a factual patch whose number is in its cited evidence is not flagged`. A `factual_internal` patch citing evidence whose excerpt contains `512 呎`, and whose `after` says 「實用 512 呎」 → not flagged.
  - `ai-workflow.test.mjs`:
    - `lead score ignores the model-guessed timeline`. `scoreLeadProfile({ … })` returns the same number whether or not `timeline: "30_days"` is passed (the extra key is ignored at runtime), and `crm-rules.ts` source does not contain `timeline`.
  - Run `npm run test:content-copilot`. It must fail.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run:
  - `npm run test:content-copilot`
  - `npm run test:crm-analysis`
  - `npm run test:crm-analysis:db`
  - `npm run test:live-agent` (shared `number-grounding.js`)
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - every `playwright.admin-owned.config.ts` suite
- [ ] **Step 4: commit.**
  ```
  fix(ai): block copilot patches that add unsourced numbers and stop scoring leads on a model-guessed timeline

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## Owner actions before production

**Order:** PR 1 merged → the owner approves this plan and the admin copy → CI green → preview check → merge → two owner steps → canary. There is no migration.

1. **Preview check** (Vercel preview on a Neon branch):
   - In 內容中心, press 重建索引. The toast says it is queued. Within one drain cycle (FX-07 cadence), 待重建段數 drops to 0.
   - Run 「AI 分析」 on a synthetic lead. A profile appears; with a deliberately wrong preview `AI_GATEWAY_MODEL`, it shows the fallback, and the preview logs show `[ai] provider_failed` with a reason.
   - Generate one copilot proposal on a test estate. A patch that adds a price shows 「未支援聲稱：數字未有來源：…」 and cannot be applied.
2. **Merge.**
3. **Owner steps right after deploy:**
   - Remove `AI_GATEWAY_EMBEDDING_MODEL` from the Vercel project's environment variables (all environments). Nothing reads it any more.
   - Press 重建索引 once on production. This marks any unpublished FAQ or estate as staff-only in the index, and rewrites listing chunks with units. It makes no provider call.
4. **Canary (48 h):**
   - 系統健康: AI Gateway（CRM 分析） is healthy.
   - The Gateway dashboard shows no embedding requests.
   - Vercel logs: `[ai] provider_failed` is rare.
   - `SELECT count(*) FROM ai_knowledge_chunks WHERE embedding IS NOT NULL AND updated_at > '<deploy>'` = 0.
   - Then update the audit Status column and `CHANGELOG.md`.

**Rollback:** revert the PR, and restore `AI_GATEWAY_EMBEDDING_MODEL` in Vercel only if embeddings are wanted again (nothing reads them).

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **Remove `AI_GATEWAY_EMBEDDING_MODEL` entirely, or keep it unused?** **Default: remove.** Nothing searches vectors, and every rebuild currently pays for them. Option (c) can bring vector search back with a plan of its own.
2. **Copilot number check: block the patch, or only warn?** **Default: block** (through `unsupportedClaims`, which the UI already shows and refuses to apply). Staff can still type the number by hand after checking it.
3. **Recompute stored lead scores** that included the timeline bonus? **Default: no backfill.** Each lead's score is recomputed on its next analysis.
4. **CRM time budget.** **Default: 15 s total with one retry.** The alternative is 25 s, if staff report fallbacks on slow models.
5. **Approve the admin copy** in the Task 3 table. **Default: as drafted.**

## Findings that differ from the approved fix plan

1. **This PR comes second,** and is cut from `main` after FX-11b merges, rather than first as the batch names suggest. FX-11b deletes the function that most FX-11a edits targeted.
2. **No migration and no call log** (see PR 1, finding 1). `live-agent.server.ts` is not touched in this PR at all.
3. **The prompt, redaction, daily-cap and Simplified-detector items** (E-08, E-12, E-14 redaction, E-15, E-21) are dropped as moot under D1 = (a). The detector exists only as PR 1's eval grader.
4. **The copilot was never behind `provider.server.ts`.** The 15 s budget therefore protects CRM analysis only. The copilot's own 30 s × 3 client is a separate follow-up.
5. **E-10 goes further than "stop generating embeddings":** the env var goes too (one fewer setting), and FAQ import stops rebuilding in-request, because the DB triggers from `20261003010000` already queue a repair for every source change.
6. **The CMS button keeps its server function** and enqueues the same job as the unused `/api/admin/ai/rebuild-knowledge` route, rather than being re-pointed at that route. This keeps the staff-auth and permission path (`admin-data-permissions.test.mjs:33-38`) and the route's pinned source (`control-plane.routes.test.mjs:113-122`) unchanged.
7. **E-11 is dropped** (the audit marks it a GUESS, and the copilot is now the index's only reader). The E-22 consent half is dropped because it contradicts FX-03's unverified-input rule.
8. **Several CMS strings are wrong after FX-11b** (fact 9). They say the public bot reads the index, and they are corrected here.
