# AI CRM Lead Command Center Design

## Goal

Build the next phase of Earnest Property AI CRM around a daily lead conversion workspace. The command center helps staff see which leads need attention, why they matter, what the next action should be, and whether each lead is connected to a Woztell WhatsApp conversation.

This phase is intentionally manual-first. AI recommends scores, summaries, tags, and next-best actions, but staff remain responsible for assignment, stage changes, notes, follow-up creation, WhatsApp replies, and campaign decisions.

> **Annotated 2026-06-26 — verified against the `admin-cms-crm-whatsapp-mvp` worktree.** Every correction in this document was confirmed against the actual Neon migrations and `src/` code (adversarial verification pass). Inline `> Correction` / `> Note` callouts carry the same grounding. **Resolve the three Open Decisions below before implementation** — rollout step 1 ("pure priority tests") cannot be written until Decision 2 is settled.

## Codebase Reality Check (Verified)

### Open Decisions (resolve before build)

1. **Audience & role scoping.** Server queries enforce row-level scoping for the plain `agent` role via `agentScope(actor)` (`src/lib/neon/admin-data.server.ts:57`): `admin`/`manager` see everything; a plain `agent` is restricted to rows where `assigned_agent_id = self` (leads/conversations) or `agent_id = self` (listings). Consequence: the **Unassigned leads** queue/KPI and the **Assign agent** action are inherently manager/admin operations and are empty/meaningless for a plain agent. **Decide:** is the command center admin/manager-only, or role-adaptive (agent → "my queue"; manager/admin → "team queue")? This choice drives the KPIs, the default filter, and the sort.
2. **Priority formula.** The sort list below is only a bucket order — it has no weights, tie-breakers, or rule for **unanalyzed leads**. `lead_score` lives on `crm_ai_profiles` and only exists after a manual analysis; many leads have no profile (`未分析`). If unscored leads sort last, a hot-but-unanalyzed new lead sinks out of view — the opposite of the goal. **Decide & specify** the exact scoring function (a pure function over a row DTO) including how `未分析` leads rank. A starting proposal is under *AI Prioritization*.
3. **Pagination + single aggregate query.** Runtime is Vercel Functions on the Neon serverless **HTTP driver** (`@neondatabase/serverless`, one-shot queries, no pooled connection — `src/lib/neon/db.server.ts:3`). Resolving activity/profile/tag/live-agent/WhatsApp context **per row** would be an N+1 round-trip storm. The read model must be **one set-based query** (reuse the `LEFT JOIN LATERAL` shape already used by `listAdminConversations`) or a small fixed number of joined queries, **with a row cap / pagination**. KPI counts and filter rows must be computed from the *same scoped dataset* (the spec's own "KPIs match visible filtered rows" test depends on this). The spec currently specifies no caps.

### Data-model corrections (where fields actually live)

| The spec implies… | Verified reality | Source |
| --- | --- | --- |
| a lead `score` | `crm_ai_profiles.lead_score` (INT, default 0); **not** on `crm_leads`; only present after manual analysis | `neon/migrations/20260624110000_ai_crm_live_agent.sql:106` |
| follow-up fields on the lead | `crm_activities` rows with `due_at` + `completed_at`; `crm_leads` has no follow-up column. "Overdue follow-up" = `due_at < now() AND completed_at IS NULL` | `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:127` |
| `opt_out` on the conversation | `crm_contacts.opted_out_whatsapp` (opt-in: `opt_in_whatsapp`); `whatsapp_conversations` has no opt-out column | `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:96-97` |
| conversation "last message direction" | derived from `whatsapp_messages.direction` (enum `inbound`/`outbound`) via `LEFT JOIN LATERAL`; not stored on the conversation | `src/lib/neon/admin-data.server.ts:1010-1020` |
| `staff_users.role` | roles are in the `staff_roles` join table (enum `admin`/`manager`/`agent`); `staff_users` has no role column — queries must JOIN | `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:48` |

### Reusable primitives (already implemented — do not rebuild)

- **Staff guard:** `requireStaffAccess(request, allowed = ["admin"])` (`src/lib/neon/auth.server.ts:321`) — verifies the Neon Auth session + role, throws 401/403. This *is* the "staff-guarded server function" model the spec asks for; server functions are TanStack Start `createServerFn(...)` handlers (the "browser-safe admin data wrapper").
- **Row scoping:** `agentScope(actor)` — see Open Decision 1.
- **Audit:** `writeAudit(actorId, action, subjectType?, subjectId?, metadata = {})` (`src/lib/neon/admin-data.server.ts:1611`) → `audit_logs`. The write-flow audit step is a one-liner.
- **WhatsApp gating:** `canReplyToConversation({ woztellEnabled, optedOut, lastInboundAt })` and `normalizeAdminPhone(value)` (`src/lib/neon/admin-workflow.ts:1`) already encode the blocked reasons `WOZTELL_DISABLED`, `CONTACT_OPTED_OUT`, `OUTSIDE_24_HOUR_WINDOW`. Reuse for the blocked-state column instead of reimplementing.
- **Existing lead actions:** assign agent, update stage, add note, create activity, approve/reject AI tags, and manual AI analysis are already wired on `/admin/leads` via guarded server functions — reuse them.

## Current Context

- `/admin` already includes CMS, listings, CRM, Segments, WhatsApp Inbox, Blasts, and AI Agent knowledge controls.
- Neon is the source of truth for staff auth, CRM, leads, contacts, AI profiles, activities, live-agent handoffs, WhatsApp conversation metadata, and audit logs.
- The public live-agent can now answer from public FAQ, estate, listing, and article knowledge, and can create CRM handoff records.
- `/admin/leads` already exposes lead list/detail workflows and manual AI analysis for a selected lead.
- `/admin/whatsapp` already shows Woztell conversation context and guarded reply controls.
- This phase should not replace either screen. It adds a focused command center that links the two workflows.

## Product Scope

The first conversion workspace is a Lead Command Center.

It should show prioritized lead queues:

- Hot leads by AI score and explicit buyer, tenant, seller, or landlord signals.
- Overdue follow-ups.
- Unassigned leads.
- Recent live-agent handoffs.
- Leads with active or recent Woztell WhatsApp conversations.
- Leads blocked for WhatsApp contact because of missing phone, missing opt-in, opt-out, stale service window, or missing Woztell configuration.

The command center should answer four staff questions quickly:

- Who should I follow up with now?
- Why is this lead high priority?
- What should I do next?
- Can I continue through WhatsApp, and where is the conversation?

## Out Of Scope

This phase does not include:

- Automatic WhatsApp sending.
- Automatic lead stage changes.
- Automatic blast queueing.
- Pushing AI score, tags, or stage back into Woztell custom fields.
- Replacing `/admin/leads` or `/admin/whatsapp`.
- Building a full task/calendar system.
- Letting AI publish CMS content or modify listings.

> **Correction (verified 2026-06-26):** "Automatic WhatsApp sending" must exclude **both** delivery paths, since both funnel through `sendWoztellResponse` (`src/lib/neon/woztell.server.ts:142`): the interactive reply route `/api/admin/woztell/send` (staff-guarded) **and** the campaign delivery route `/api/admin/jobs/send-queue` (CRON_SECRET-guarded). The command center must trigger neither.

## Source Of Truth

Neon remains the CRM source of truth.

The command center reads from:

- `crm_leads`
- `crm_contacts`
- `crm_activities`
- `crm_ai_profiles`
- `crm_ai_tags`
- `live_agent_sessions`
- `whatsapp_conversations`
- `whatsapp_messages`
- `staff_users`
- `staff_roles` — roles are here, not on `staff_users` (see Data-model corrections); JOIN to resolve actor role.
- `audit_logs` — written on every meaningful mutation via `writeAudit(...)`.

> **Note (verified 2026-06-26):** several fields the queue depends on do not live where the section names suggest — `lead_score` is on `crm_ai_profiles`, follow-ups are `crm_activities` rows, opt-out is `crm_contacts.opted_out_whatsapp`, and message direction is per-message on `whatsapp_messages`. See the Data-model corrections table under *Codebase Reality Check*.

Woztell is displayed as linked operational context through the local Neon records already synced or created by the app. This phase does not require direct Woztell API reads for the command center.

## Woztell Linkage

Each command center row should attempt to resolve a WhatsApp context in this order:

1. Existing `whatsapp_conversations.contact_id = crm_contacts.id`.
2. Matching normalized phone between the CRM contact and the conversation contact data.
3. Live-agent session already linked to a `conversation_id`.

> **Correction (verified 2026-06-26):** fallback 2 is likely **dead logic**. The Woztell webhook always resolves/creates a `crm_contacts` row first and inserts the conversation with that `contact_id` (`src/routes/api.woztell.webhook.ts:108-147`); there is no webhook path that creates a conversation with `contact_id IS NULL`, and the column can't be nulled later (`ON DELETE CASCADE` deletes the row instead). So resolution 1 covers all webhook-created conversations. Keep the resolver as 1 + 3 unless a non-webhook source of conversations is introduced; if fallback 2 is retained, note that conversations store no separate phone — the match would be `crm_contacts.normalized_phone` against another contact's, which is what link 1 already encodes.

The row should show:

- Whether a Woztell conversation is linked.
- Conversation status.
- Last inbound time.
- Last message direction. <!-- verified: derive from whatsapp_messages.direction via LEFT JOIN LATERAL (last message); not stored on the conversation -->
- Opt-out state. <!-- verified: read crm_contacts.opted_out_whatsapp; the conversation has no opt-out column -->
- Stored `channel_id` and `woztell_member_id` availability as a yes/no operational status, not raw credentials.
- A link or action to open the existing `/admin/whatsapp` conversation detail.

If no conversation is linked, the UI should show a clear state:

- `未連接 WhatsApp`
- `缺少電話`
- `未有 WhatsApp opt-in`
- `客戶已 opt-out`

> **Note (verified 2026-06-26):** the blocked states map to existing data + helpers — `缺少電話` = `crm_contacts.normalized_phone IS NULL`; `未有 WhatsApp opt-in` = `opt_in_whatsapp = false`; `客戶已 opt-out` = `opted_out_whatsapp = true`; "stale service window" + "missing Woztell config" are already computed by `canReplyToConversation(...)` / the `woztell_member_id`/`channel_id` null checks (`src/lib/neon/admin-workflow.ts:1`). Reuse them; do not reimplement the reason logic.

## AI Prioritization

The command center uses `crm_ai_profiles` where available.

Displayed AI fields:

- `lead_score`
- `urgency`
- `timeline`
- `budget_band`
- `preferred_estates`
- `summary`
- `next_best_action`
- `last_analyzed_at`
- approved and suggested tags

> **Verified 2026-06-26:** all eight fields exist on `crm_ai_profiles` (plus `intent`, `intent_confidence`, `language`, `generated_by`). Tags are on `crm_ai_tags` with a `status` enum (`suggested` / `approved` / `rejected` / `auto_applied`). **Caveat:** an `crm_ai_profiles` row only exists after a manual analysis — for `未分析` leads every field above is absent and `lead_score` is undefined, which the sort must handle explicitly (see below).

Priority must be explainable. The UI should show the reason beside the score, not just a number.

Sort order:

1. Overdue follow-up with high score.
2. Recent live-agent handoff with high score.
3. High score unassigned lead.
4. High score lead with active or recent WhatsApp conversation.
5. Other leads by score and recent activity.

> **Open Decision 2 — make this a concrete, testable function.** The list above is a bucket order, not a formula. Rollout step 1 requires a *pure, deterministic* priority. Specify it as a function over a row DTO. Definitions the formula needs:
> - **Overdue follow-up** = exists a `crm_activities` row for the lead with `due_at < now() AND completed_at IS NULL` (most-overdue wins ties).
> - **High score** = `crm_ai_profiles.lead_score` above an agreed threshold; **unanalyzed (`未分析`) leads have no score** — decide their rank. Recommended: do **not** sink them; give a recency-based provisional priority (e.g. new + unassigned + recent inbound floats up) and surface a `需 AI 分析` reason so they get attention rather than disappearing.
> - **Recent handoff** = `live_agent_sessions.status IN ('handoff_requested','handoff_completed')` within an agreed window.
> - **Active/recent WhatsApp** = linked conversation with `last_inbound_at` within an agreed window.
> Proposed deterministic shape: `priority = bucketWeight (1–5 above) DESC, then overdueMinutes DESC, then lead_score DESC, then last_activity_at DESC, then lead_id ASC` (final key guarantees a stable, testable total order). Pin the thresholds/windows as named constants so the pure test is exact.

Blocked WhatsApp leads are still visible. They should not disappear from the command center because staff may need to call, update consent, or correct missing contact data.

## Manual Staff Actions

Rows and the detail drawer should support:

- Assign agent.
- Update lead stage.
- Add note.
- Create follow-up activity.
- Mark follow-up complete.
- Run AI analysis for a stale or missing profile.
- Approve or reject suggested AI tags.
- Open full lead detail.
- Open linked WhatsApp conversation when available.

> **Verified 2026-06-26 — most of these already exist on `/admin/leads`** via guarded server functions and can be reused as-is: assign agent, update stage, add note, create activity, approve/reject AI tags, and run AI analysis. **Likely net-new** for the command center: *mark follow-up complete* (setting `crm_activities.completed_at`) and the queue's bulk/inline action surfacing. Reuse the existing functions; only add what's missing.

All mutations must use existing staff-guarded server functions or new staff-guarded server functions. Client-only hiding is not security.

> **Verified 2026-06-26:** the guard is `requireStaffAccess(request, allowed)` (`src/lib/neon/auth.server.ts:321`), wrapped by TanStack Start `createServerFn(...)` handlers; every meaningful mutation also calls `writeAudit(...)` → `audit_logs`. New server functions must follow the same two steps. Remember `agentScope(actor)` (Open Decision 1) silently scopes plain-agent reads/writes — a command-center "Assign agent" or cross-agent action will 403/return-empty for a plain agent.

## Route And Navigation

Add the first version as a new route:

- `/admin/leads/command-center`

> **Verified 2026-06-26:** with TanStack Router file routing, create `src/routes/admin.leads_.command-center.tsx` with `createFileRoute('/admin/leads_/command-center')`. The trailing underscore on `leads_` is **required** — `admin.leads.tsx` is a flat route with no `<Outlet/>`, so a bare `admin.leads.command-center.tsx` would try to nest under a non-existent leads layout. This mirrors the existing `admin.listings_.$id.tsx` / `admin.listings_.new.tsx` convention.

Keep existing `/admin/leads` intact.

Add entry points:

- Admin sidebar or CRM nav label for `Command Center`.
- A prominent link from `/admin/leads`.

After staff use it, the team can decide whether `/admin/leads` should default to the command center.

## UI Design

The command center should feel like an operational dashboard.

Top KPI strip:

- Hot leads.
- Overdue follow-ups.
- Unassigned leads.
- New live-agent handoffs.
- WhatsApp blocked.

Main segmented filters:

- `今日要跟`
- `高分 Leads`
- `未分配`
- `Live Agent`
- `WhatsApp`
- `全部`

Table columns:

- Lead/contact.
- Intent.
- Budget.
- Preferred estates.
- Stage.
- Assigned agent.
- AI score and reason.
- Next-best action.
- Latest activity.
- Woztell/WhatsApp status.
- Quick actions.

Detail drawer:

- Contact card.
- AI profile summary.
- Follow-up timeline.
- Woztell conversation context.
- Suggested tags.
- Action buttons.

The UI should remain dense and scannable. No marketing hero, no decorative cards nested inside cards, and no feature explanation copy beyond concise operational labels.

## Data Flow

Read flow:

1. Staff opens `/admin/leads/command-center`.
2. Client calls a browser-safe admin data wrapper. <!-- verified: a TanStack Start createServerFn(...) handler, e.g. fetchCommandCenterServer -->
3. Server verifies staff access with the Neon session. <!-- verified: requireStaffAccess(request, [...]) then derive agentScope(actor) -->
4. Server queries Neon for leads, contacts, latest activities, AI profiles, tags, live-agent sessions, and WhatsApp context.
5. Server computes command-center row fields and priority metadata.
6. Client renders KPIs, filters, table, and detail drawer.

> **Verified 2026-06-26 — performance + consistency constraints on steps 4–6:**
> - Step 4 must be **one set-based query** (or a small fixed number), not per-row lookups — the Neon HTTP driver makes N+1 a real latency problem (Open Decision 3). Reuse the `LEFT JOIN LATERAL` last-message pattern from `listAdminConversations`.
> - Apply `agentScope` inside that query (append `assigned_agent_id = $N` when the actor is a plain agent), and **paginate / cap** the result.
> - Step 5's priority must be the **pure function** from Open Decision 2 so it is unit-testable off a DTO.
> - Compute KPI counts and the visible rows from the **same scoped dataset** so "KPIs match visible filtered rows" holds.

Write flow:

1. Staff performs a manual action.
2. Client calls the relevant staff-guarded server function.
3. Server validates role and input. <!-- verified: requireStaffAccess + agentScope; reject if the scoped row is not matched (403) -->
4. Server updates Neon.
5. Server writes an audit entry for meaningful changes. <!-- verified: writeAudit(actorId, action, subjectType, subjectId, metadata) -> audit_logs -->
6. Client refreshes the command center data.

> **Verified 2026-06-26:** this app does **not** use TanStack Query — admin pages refetch manually after a mutation (a `refresh*()` callback with request-id de-duplication, as in `admin.listings.tsx`). Step 6 should re-call the read wrapper and re-render; there is no query cache to invalidate.

## Error Handling

The command center should distinguish:

- Not signed in: show staff login prompt.
- Unauthorized role: show access message.
- Missing AI profile: show `未分析` and offer manual AI analysis.
- Stale AI profile: show last analyzed time and offer re-analysis.
- Missing Woztell configuration: mark WhatsApp actions unavailable.
- Missing phone or opt-in: show blocked reason.
- Server failure: show retryable admin error.

No queue should silently appear empty when auth, data loading, or configuration failed.

## Testing

Automated coverage should include:

- Command center data query returns required fields without secrets.
- Priority sort is deterministic and explainable.
- Woztell linkage works by `contact_id`.
- Woztell linkage falls back to normalized phone. <!-- only if fallback 2 is retained — see Woztell Linkage correction; otherwise drop this test -->
- Live-agent handoff leads appear in the correct queue.
- WhatsApp blocked reasons are correct.
- Staff role guards protect all mutations.
- AI analysis remains manual.
- Existing `/admin/leads`, `/admin/whatsapp`, and public live-agent routes still work.
- **Role-scoped visibility (added 2026-06-26):** a plain `agent` sees only their own leads; `admin`/`manager` see all and the Unassigned queue is non-empty (locks in Open Decision 1).
- **Unanalyzed-lead ranking (added 2026-06-26):** `未分析` leads are placed per the agreed rule (not silently sunk) — the pure priority test covers a no-`crm_ai_profiles` row.
- **Pagination + KPI/row consistency (added 2026-06-26):** results are capped/paginated and KPI counts equal the counts derivable from the same scoped dataset.

Manual verification should include:

- `/admin/leads/command-center` loads for staff.
- KPIs match visible filtered rows.
- A linked Woztell conversation can be opened.
- A missing-phone or opt-out lead shows the correct blocked state.
- A staff user can create a follow-up from next-best action.
- No Woztell send route is called from the command center — neither `/api/admin/woztell/send` nor `/api/admin/jobs/send-queue` (both reach `sendWoztellResponse`).

## Rollout

Ship as a separate command center route first.

Recommended rollout order:

1. Data contract and pure priority tests.
2. Staff-guarded server read model.
3. Command center route with KPI strip and segmented filters.
4. Detail drawer and row actions.
5. Woztell link/open actions.
6. Manual AI analysis and tag review shortcuts.
7. Production deploy and staff smoke test.

This keeps the blast radius small while giving staff a real daily conversion workflow.
