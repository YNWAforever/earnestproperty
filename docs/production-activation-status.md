# Production Activation Status

Audited 2026-07-25 against Vercel project `ynwaforevers-projects/earnestproperty`
(`vercel env ls`) and the production Neon branch.

Every feature below is built, tested and deployed. What is missing is
configuration, so each one currently fails closed and silently — nothing errors
loudly, it just does nothing. Per-feature setup steps live in
`woztell-activation.md`, `ai-crm-live-agent-activation.md` and
`ai-content-copilot-activation.md`; this file records what is actually set.

## Environment variables

| Variable | Production | Blocks |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | ✅ | — |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `VITE_NEON_AUTH_URL`, `NEON_BRANCH` | ✅ | — |
| `ADMIN_BOOTSTRAP_EMAILS`, `CRON_SECRET` | ✅ | — |
| `AI_GATEWAY_API_KEY` | ❌ | AI FAQ answers, knowledge embeddings |
| `AI_GATEWAY_MODEL` | ❌ | AI FAQ answers |
| `AI_GATEWAY_EMBEDDING_MODEL` | ❌ | Knowledge embeddings |
| `WOZTELL_ENABLED` | ❌ | All WhatsApp send paths |
| `WOZTELL_BOT_ACCESS_TOKEN`, `WOZTELL_CHANNEL_ID` | ❌ | Outbound WhatsApp |
| `WOZTELL_CHANNEL_SECRET` | ❌ | Inbound webhook (401s every event) |
| `BLOB_READ_WRITE_TOKEN` | ❌ | Admin media upload |
| `CONTROL_PLANE_APPROVAL_SECRET` | ❌ | Migration approvals |
| `TAVILY_API_KEY`, `OPENCODE_GO_*` | ❌ | Content copilot research |

Five `*SUPABASE*` variables are still set in production and are unused since the
Neon migration. Safe to delete.

## Cron

`vercel.ts` declares one cron: `/api/mls-sync`.

`runClaimedJobs` — the only thing that drains the `ops_jobs` queue — is reachable
only from `/api/admin/control-plane/worker` and `/api/admin/jobs/send-queue`.
Neither is scheduled, so a queued WhatsApp campaign or AI knowledge rebuild
returns `202 Accepted` and then never runs. `ops_jobs` was empty at audit time,
so this is latent rather than currently broken, but it will bite the first time
someone queues a campaign.

Both routes authenticate with `Bearer ${CRON_SECRET}` and are safe to schedule:

```ts
crons: [
  { path: "/api/mls-sync", schedule: "0 20 * * *" },
  { path: "/api/admin/control-plane/worker", schedule: "*/5 * * * *" },
  { path: "/api/admin/jobs/send-queue", schedule: "*/10 * * * *" },
],
```

## Knowledge base content

Even with the AI gateway keys set, FAQ answer quality is limited by what is
indexed. At audit time `ai_knowledge_chunks` held 420 chunks with **0
embeddings**, last built 2026-07-13:

| Source type | Sources |
|---|---|
| listing | 412 |
| estate | 5 |
| faq | 3 |

With 98% of the corpus being property listings and no embeddings, retrieval
degrades to an ILIKE substring match over listing text — so a question like
"點樣聯絡代理" returns an unrelated flat for sale. Two things to fix alongside the
keys:

- Author more FAQs in `/admin/cms?tab=faqs`. Three is not enough to cover the
  questions the widget invites.
- Blog articles are file-based in `src/content/seo.ts`, so the `articles` table
  is empty and `fetchPublicKnowledgeSources` indexes no article content. Either
  move posts into the CMS or extend the indexer to read the content module.

After setting the keys, run a rebuild from `/admin/operations` (or POST
`/api/admin/ai/rebuild-knowledge`) — but only once the worker cron above exists,
or the job will sit in the queue.
