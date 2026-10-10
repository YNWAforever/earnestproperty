# Claude / AI Integration Notes

P8 handoff doc. Every place this codebase calls an external AI provider,
what it's used for, how it's configured, and what's genuinely built vs.
still a stub. Written against `main` at the point all of P0–P7 had merged
(2026-08-31).

## The two AI providers this app talks to

### 1. Vercel AI Gateway — `src/lib/ai/provider.server.ts`

> 2026-10-08 FX-11a: no embeddings any more, and `AI_GATEWAY_EMBEDDING_MODEL` is
> removed. The client has a 15 s total budget with 1 retry, and each failure
> logs `[ai] provider_failed` with its `reason` and `status`.

Hits `https://ai-gateway.vercel.sh/v1` directly via `fetch` (OpenAI-compatible
REST, not the Vercel AI SDK) for chat completions only.
Config: `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` (chat), both read in
`src/lib/ai/config.server.ts`. The model is a plain `"provider/model"` string
passed straight through with no hardcoded model name in code, matching AI
Gateway's own convention. Each call has a 15 s total budget, with at most 1
retry, and only when enough of the budget is left. A failure logs
`[ai] provider_failed` with `{ reason, status }`, and the caller gets its fallback.

**What it powers:**
- `src/lib/ai/knowledge.server.ts` — the staff knowledge base: content chunks
  (from `chunkKnowledgeText()`, `knowledge.ts`) are written to
  `ai_knowledge_chunks` for staff tools such as `admin.cms-copilot`. Since
  2026-10-08 (FX-11a) the rebuild generates no embeddings and makes no provider call. The public live-agent
  widget no longer uses it: since FX-11b its replies are deterministic
  (`src/lib/ai/live-agent-reply.server.ts`), built only from published FAQs,
  published estates and the public listing search, with no model call.
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
`OPENCODE_GO_BASE_URL`, `OPENCODE_GO_API_KEY`,
`OPENCODE_GO_MODEL`, or `TAVILY_API_KEY` — all 6 are real, live-checked
(`process.env.X` grep-confirmed) environment variables gating genuinely built
features. A developer following `.env.example` alone would never learn these
exist. **Recommended next step, not done as part of this handoff**: add an
"--- AI / Content Copilot ---" section to `.env.example` mirroring the
existing sections' style (what breaks when unset, where it's used, any
format constraints).

## What's real vs. what's a documented stub

| Feature | Status |
|---|---|
| Live agent (public widget) answers | **Real, deterministic** (FX-11b) — fixed copy plus cards from published FAQs, published estates and the public listing search (`live-agent-reply.server.ts`); no model call |
| Live agent → human handoff | **Real** — `replyOffersHandoff()` (`live-agent-reply.ts`), routes to a real staff inbox conversation |
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
