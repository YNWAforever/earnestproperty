# Claude / AI Integration Notes

P8 handoff doc. Every place this codebase calls an external AI provider,
what it's used for, how it's configured, and what's genuinely built vs.
still a stub. Written against `main` at the point all of P0–P7 had merged
(2026-08-31).

## The two AI providers this app talks to

### 1. Vercel AI Gateway — `src/lib/ai/provider.server.ts`

Hits `https://ai-gateway.vercel.sh/v1` directly via `fetch` (OpenAI-compatible
REST, not the Vercel AI SDK) for both chat completions and embeddings.
Config: `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL` (chat), and
`AI_GATEWAY_EMBEDDING_MODEL` (embeddings) — all read in
`src/lib/ai/config.server.ts`. The model is a plain `"provider/model"` string
passed straight through with no hardcoded model name in code, matching AI
Gateway's own convention. `fetchWithRetry` adds a 20s hard timeout and up to
2 retries with backoff on 429/5xx.

**What it powers:**
- `src/lib/ai/knowledge.server.ts` — the live agent's knowledge base:
  `embedAiTexts()` embeds content chunks (from `chunkKnowledgeText()`,
  `knowledge.ts`) into `ai_knowledge_chunks`, `answerFromPublicKnowledge()`
  does the retrieval + `generateAiText()` completion at query time. This is
  the RAG layer behind `src/lib/ai/live-agent.server.ts` (the public
  live-agent widget's actual answers) and `admin.cms-copilot` — not a stub;
  real embeddings, real completions, gated only by whether the env vars are
  set (`enabled: Boolean(apiKey && textModel)`).
- `src/lib/ai/crm-enrichment.server.ts` — AI tagging/classification of CRM
  leads (`CrmAiProfile`/`CrmAiTag`), with a safety gate
  (`classifyAiTagSafety`/`canAutoApplyAiTag`) before anything auto-applies.
- `src/lib/ai/segments.server.ts` — AI-assisted lead segmentation.

### 2. "opencode-go" — `src/lib/ai/content-copilot-config.server.ts`

A **separately configured** provider, not the AI Gateway — `OPENCODE_GO_BASE_URL`
(caller-supplied endpoint, not a fixed URL), `OPENCODE_GO_API_KEY`,
`OPENCODE_GO_MODEL`. Powers `src/lib/ai/content-copilot.server.ts` — the
admin CMS's AI writing assistant for estate/article copy. `enabled` requires
all three vars set. Distinctly-scoped from the AI Gateway provider above by
design (the content-copilot plan predates or was scoped independently of the
knowledge-base work) — do not assume they share credentials or can be
collapsed into one provider without checking with whoever owns the
`opencode-go` endpoint.

### Tavily — `src/lib/ai/tavily-research.server.ts`

`TAVILY_API_KEY` gates a real web-search call, used by the content copilot to
ground generated copy in current search results rather than the model's own
(possibly stale) knowledge. Optional — content copilot degrades to
model-only generation without it.

## Real gap: none of the 4 vars above are in `.env.example`

`.env.example` (98 lines) documents Neon Auth, WhatsApp/phone CTAs, Woztell,
admin bootstrap, the Cloudflare Container MLS pipeline, and YouTube sync —
thoroughly, each with a comment explaining what breaks if it's unset. It has
**no entry at all** for `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`,
`AI_GATEWAY_EMBEDDING_MODEL`, `OPENCODE_GO_BASE_URL`, `OPENCODE_GO_API_KEY`,
`OPENCODE_GO_MODEL`, or `TAVILY_API_KEY` — all 7 are real, live-checked
(`process.env.X` grep-confirmed) environment variables gating genuinely built
features. A developer following `.env.example` alone would never learn these
exist. **Recommended next step, not done as part of this handoff**: add an
"--- AI / Content Copilot ---" section to `.env.example` mirroring the
existing sections' style (what breaks when unset, where it's used, any
format constraints).

## What's real vs. what's a documented stub

| Feature | Status |
|---|---|
| Live agent (public widget) knowledge answers | **Real** — AI Gateway chat completion over embedded knowledge chunks |
| Live agent → human handoff | **Real** — `shouldOfferHumanHandoff()` (`live-agent.ts`), routes to a real staff inbox conversation |
| Admin CMS content copilot (estate/article copy drafting) | **Real** — opencode-go provider, optional Tavily grounding |
| CRM AI lead tagging/scoring | **Real**, with an explicit auto-apply safety gate — not everything the model suggests gets applied automatically |
| Analytics event `track()` (`src/lib/analytics/events.ts`, P7d) | **Deliberately a stub** — real taxonomy, real wiring at 18 call sites, but `track()` itself is a DEV-only `console.debug`, a true no-op in production. No analytics provider has been chosen yet (master plan open input #11); this is not an oversight, it's the documented scope of P7d. |

## Control plane

`CONTROL_PLANE_APPROVAL_SECRET` (grep-confirmed, also undocumented in
`.env.example`) gates a two-person-rule approval step somewhere in
`src/lib/control-plane/` (jobs/migrations/audit) — not investigated further
for this doc; flagging its existence and the same `.env.example` gap noted
above.

## Woztell (WhatsApp) — for context, not new to this handoff

Already well-documented in `.env.example` itself (channel id/secret/two
separately-scoped tokens, master `WOZTELL_ENABLED` switch) — included here
only to note it is **not** part of the AI-provider surface above; it's a
messaging-platform integration (`src/lib/woztell/`), unrelated to the LLM
calls this doc otherwise covers.
