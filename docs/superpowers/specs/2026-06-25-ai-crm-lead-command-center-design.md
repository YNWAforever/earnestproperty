# AI CRM Lead Command Center Design

## Goal

Build the next phase of Earnest Property AI CRM around a daily lead conversion workspace. The command center helps staff see which leads need attention, why they matter, what the next action should be, and whether each lead is connected to a Woztell WhatsApp conversation.

This phase is intentionally manual-first. AI recommends scores, summaries, tags, and next-best actions, but staff remain responsible for assignment, stage changes, notes, follow-up creation, WhatsApp replies, and campaign decisions.

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

Woztell is displayed as linked operational context through the local Neon records already synced or created by the app. This phase does not require direct Woztell API reads for the command center.

## Woztell Linkage

Each command center row should attempt to resolve a WhatsApp context in this order:

1. Existing `whatsapp_conversations.contact_id = crm_contacts.id`.
2. Matching normalized phone between the CRM contact and the conversation contact data.
3. Live-agent session already linked to a `conversation_id`.

The row should show:

- Whether a Woztell conversation is linked.
- Conversation status.
- Last inbound time.
- Last message direction.
- Opt-out state.
- Stored `channel_id` and `woztell_member_id` availability as a yes/no operational status, not raw credentials.
- A link or action to open the existing `/admin/whatsapp` conversation detail.

If no conversation is linked, the UI should show a clear state:

- `未連接 WhatsApp`
- `缺少電話`
- `未有 WhatsApp opt-in`
- `客戶已 opt-out`

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

Priority must be explainable. The UI should show the reason beside the score, not just a number.

Sort order:

1. Overdue follow-up with high score.
2. Recent live-agent handoff with high score.
3. High score unassigned lead.
4. High score lead with active or recent WhatsApp conversation.
5. Other leads by score and recent activity.

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

All mutations must use existing staff-guarded server functions or new staff-guarded server functions. Client-only hiding is not security.

## Route And Navigation

Add the first version as a new route:

- `/admin/leads/command-center`

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
2. Client calls a browser-safe admin data wrapper.
3. Server verifies staff access with the Neon session.
4. Server queries Neon for leads, contacts, latest activities, AI profiles, tags, live-agent sessions, and WhatsApp context.
5. Server computes command-center row fields and priority metadata.
6. Client renders KPIs, filters, table, and detail drawer.

Write flow:

1. Staff performs a manual action.
2. Client calls the relevant staff-guarded server function.
3. Server validates role and input.
4. Server updates Neon.
5. Server writes an audit entry for meaningful changes.
6. Client refreshes the command center data.

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
- Woztell linkage falls back to normalized phone.
- Live-agent handoff leads appear in the correct queue.
- WhatsApp blocked reasons are correct.
- Staff role guards protect all mutations.
- AI analysis remains manual.
- Existing `/admin/leads`, `/admin/whatsapp`, and public live-agent routes still work.

Manual verification should include:

- `/admin/leads/command-center` loads for staff.
- KPIs match visible filtered rows.
- A linked Woztell conversation can be opened.
- A missing-phone or opt-out lead shows the correct blocked state.
- A staff user can create a follow-up from next-best action.
- No Woztell send route is called from the command center.

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
