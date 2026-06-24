# AI CRM Segmentation and Live Agent Design

## Goal

Enhance the Earnest Property admin system with one unified AI layer for CRM enrichment, audience segmentation, and a public live-agent experience. Neon remains the source of truth for application data. Woztell remains the WhatsApp delivery, inbox, and handoff layer.

The first release is semi-automatic: AI can analyze, tag, score, summarize, recommend, draft, and record visitor-requested handoffs, but staff must approve campaign audiences, blast queueing, outbound WhatsApp sends, and sensitive tags.

## Current Context

- `/admin` already has CMS, listings, CRM leads, WhatsApp inbox, and WhatsApp blast workflows.
- Neon stores staff, media, contacts, leads, activities, WhatsApp conversations, WhatsApp messages, audiences, campaigns, recipients, and audit logs.
- FAQ content exists in Neon and is editable from `/admin/cms`.
- Public pages already read estate, district, article, FAQ, and active listing content from Neon and static registries.
- Woztell integration already guards one-to-one replies, campaign queueing, opt-out state, and template-only blasting.

## Scope

This design covers four connected features:

- AI CRM enrichment: contact and lead scoring, summaries, tags, next-best action, and matching listings.
- AI segmentation: natural-language audience builder backed by structured Neon filters and staff approval.
- FAQ and public-content knowledge base: indexed, searchable public-safe content for AI retrieval.
- Public live agent: front-end assistant that answers from approved public knowledge, qualifies visitors, creates CRM leads, and hands off to WhatsApp or staff.

The design intentionally excludes fully autonomous WhatsApp blasting, auto-publishing CMS content, private CRM history in public answers, and replacing Woztell.

## Architecture

The system has two cooperating halves.

### Neon Intelligence Core

Neon stores all AI-operational data:

- Knowledge sources and chunks.
- Contact and lead AI profiles.
- AI-suggested and staff-approved tags.
- Segment definitions and memberships.
- Live-agent sessions and messages.
- AI audit logs.

All AI reads and writes happen through server-only routes or server functions. Client bundles must not contain AI provider keys, Neon URLs, Woztell tokens, Blob tokens, or prompt internals that expose private data.

### Woztell Operations Layer

Woztell remains responsible for WhatsApp delivery and inbox events:

- Website handoff can create or link a CRM contact, lead, and WhatsApp conversation.
- Staff replies continue through existing safe Woztell send routes.
- Blasts continue through approved templates, opt-in checks, opt-out checks, throttled queueing, and audit logs.
- AI may draft replies and suggest audiences, but it does not send messages or queue campaigns directly.

## Data Model

### `ai_knowledge_sources`

Tracks where AI knowledge comes from.

Fields:

- `id`
- `source_type`: `faq`, `estate`, `district`, `article`, `listing`, `manual_public`
- `source_id`
- `title`
- `url_path`
- `locale`
- `public_visibility`
- `published`
- `last_indexed_at`
- `content_hash`
- `created_at`
- `updated_at`

### `ai_knowledge_chunks`

Stores searchable public-safe chunks.

Fields:

- `id`
- `source_id`
- `chunk_text`
- `summary`
- `metadata`
- `estate_slug`
- `district_slug`
- `listing_id`
- `visibility`: `public` or `staff`
- `freshness_score`
- `embedding`
- `content_hash`
- `stale`
- `created_at`
- `updated_at`

Phase 1 public live-agent retrieval uses only `visibility = 'public'`, published sources, and active listings.

### `crm_ai_profiles`

Stores AI-enriched contact or lead facts.

Fields:

- `id`
- `contact_id`
- `lead_id`
- `intent`
- `intent_confidence`
- `budget_band`
- `preferred_estates`
- `urgency`
- `timeline`
- `language`
- `lead_score`
- `next_best_action`
- `summary`
- `last_analyzed_at`
- `analysis_version`
- `created_at`
- `updated_at`

### `crm_ai_tags`

Stores normalized tags.

Fields:

- `id`
- `contact_id`
- `lead_id`
- `tag`
- `category`
- `safety_level`: `factual`, `sensitive`, `judgmental`
- `status`: `suggested`, `approved`, `rejected`, `auto_applied`
- `confidence`
- `reason`
- `created_by_ai`
- `approved_by`
- `approved_at`
- `created_at`

AI may auto-apply factual tags only: budget band, estate interest, stated intent, language, source, and public listing interest. Sensitive or judgmental tags require staff approval.

### `crm_segments`

Stores reusable audiences.

Fields:

- `id`
- `name`
- `description`
- `natural_language_prompt`
- `structured_filters`
- `created_by`
- `status`: `draft`, `active`, `archived`
- `created_at`
- `updated_at`

### `crm_segment_memberships`

Stores materialized segment membership.

Fields:

- `id`
- `segment_id`
- `contact_id`
- `lead_id`
- `confidence`
- `reason`
- `eligibility_status`: `eligible`, `missing_phone`, `not_opted_in`, `opted_out`, `blocked`
- `staff_approved`
- `created_at`
- `updated_at`

Segment membership does not equal campaign eligibility. Campaign queueing still re-checks the existing WhatsApp safety gates.

### `live_agent_sessions`

Stores public site assistant sessions.

Fields:

- `id`
- `anonymous_id`
- `contact_id`
- `lead_id`
- `conversation_id`
- `source_path`
- `status`: `open`, `qualified`, `handoff_requested`, `handoff_completed`, `closed`
- `intent`
- `budget_min`
- `budget_max`
- `preferred_estates`
- `timeline`
- `opt_in_whatsapp`
- `assigned_agent_id`
- `created_at`
- `updated_at`

### `live_agent_messages`

Stores public chat and handoff messages.

Fields:

- `id`
- `session_id`
- `direction`: `visitor`, `assistant`, `staff`, `system`
- `message_text`
- `citations`
- `safety_flags`
- `shown_publicly`
- `created_at`

### `ai_audit_logs`

Records AI and staff decisions.

Fields:

- `id`
- `actor_type`: `ai`, `staff`, `system`
- `actor_id`
- `action`
- `subject_type`
- `subject_id`
- `metadata`
- `created_at`

Audited actions include indexing, profile scoring, tag suggestion, tag approval, segment filter generation, segment materialization, answer generation, lead creation, handoff, and rejected suggestions.

## AI Workflows

### Knowledge Indexing

Admin can trigger "Rebuild AI knowledge" from `/admin/cms`. The indexing job reads:

- FAQs from Neon.
- Published estate pages.
- Published district pages.
- Published articles.
- Active public listings.
- Manual public knowledge entries if added later.

The job chunks content, stores source citations, computes content hashes, marks old chunks stale, and stores embeddings when a provider is configured. If embeddings are not configured, retrieval falls back to keyword search against source title, chunk text, estate, district, and listing metadata.

### CRM Enrichment

When a lead or contact is created or meaningfully updated, AI analyzes CRM-safe signals:

- Intent and source.
- Budget range.
- Preferred estates.
- Related listing.
- Chat qualification answers.
- WhatsApp opt-in or opt-out state.
- Lead stage and last activity.
- Staff notes and conversation summaries for internal use only.

AI writes `crm_ai_profiles` and `crm_ai_tags`. It may auto-apply low-risk factual tags and suggest higher-impact tags for staff approval. Staff can refresh analysis manually from lead detail.

### Audience Builder

Staff can create segments from natural language in `/admin/segments` or an expanded `/admin/blasts` audience tab.

Example prompt:

> 深井買家，預算 800-1000 萬，對碧堤半島或浪翠園有興趣，最近 90 日查詢，有 WhatsApp opt-in

AI converts the prompt into structured filters, previews matched contacts, explains inclusion reasons, and materializes segment memberships only after staff confirms. Approved segments can be reused in WhatsApp campaigns, but campaign queueing still uses the existing opt-in, opt-out, template, review, and throttling gates.

### Public Live Agent

The public site gets a compact assistant that can:

- Answer questions from public-safe FAQ, estate, district, article, and active listing knowledge.
- Ask qualification questions for buy, rent, sell, valuation, budget, estate interest, and timeline.
- Create or update CRM contact and lead records.
- Record a visitor-requested WhatsApp handoff through Woztell-safe server paths.
- Summarize the visitor context for staff before handoff.

The assistant identifies itself as Earnest Property's assistant, not a human agent. It does not provide private CRM information, unverified listing availability, legal advice, mortgage approval promises, or valuation guarantees.

### Staff Assist

Admin CRM and WhatsApp screens show:

- AI contact or lead summary.
- Lead score and confidence.
- Approved and suggested tags.
- Next-best action.
- Matching listings.
- Suggested WhatsApp reply draft.
- Handoff summary from public chat.

Staff can approve, reject, or edit suggestions. Outbound messages remain staff-triggered.

## Admin UX

### CRM Lead Detail

Add an "AI Profile" panel with:

- Lead score.
- Intent confidence.
- Budget band.
- Preferred estates.
- Urgency and timeline.
- Language.
- Tags grouped by approved, suggested, and rejected.
- Recommended next action.
- Refresh analysis action.

Activity timeline records AI analysis summaries, staff approvals, rejected tags, and handoff summaries.

### Segments and Audiences

Add `/admin/segments` or extend `/admin/blasts` with an AI audience builder:

- Natural-language segment prompt.
- Generated structured filters.
- Eligibility breakdown.
- Example matched contacts.
- AI inclusion reasons.
- Staff approve and materialize action.
- Reusable segment list for campaigns.

### WhatsApp Inbox

Conversation detail gains an AI assist panel:

- Conversation summary.
- Detected intent and urgency.
- Suggested next reply draft.
- Suggested matching listings.
- Handoff note from public chat.
- Template suggestion when the 24-hour window is closed.

### CMS

FAQ and content screens gain AI knowledge status:

- Indexed or not indexed.
- Last indexed time.
- Public-agent eligible flag.
- Indexing errors.
- Rebuild knowledge action.

### Public Site

Add a floating chat entry point. First prompts:

- 買樓
- 租樓
- 放盤估價
- 問屋苑

The assistant answers short, useful questions, asks qualification questions naturally, and records a handoff request when a human agent should continue. Staff still controls outbound WhatsApp replies.

## Safety and Compliance

AI cannot:

- Send WhatsApp messages.
- Queue or launch blasts.
- Publish CMS content.
- Change lead stage.
- Override opt-out state.
- Use private CRM or WhatsApp history for public answers.
- Invent active listing availability or exact prices when Neon data is missing.

AI can:

- Suggest CRM tags.
- Auto-apply factual tags.
- Draft staff replies.
- Generate segment filters.
- Summarize lead and handoff context.
- Retrieve public-safe answers.

Public live-agent retrieval is limited to public-safe chunks. Internal CRM AI can use CRM notes and WhatsApp summaries for staff-facing analysis only.

## Error Handling

Admin screens should distinguish:

- AI provider not configured.
- Knowledge index is stale.
- Retrieval found no confident source.
- CRM analysis failed.
- Segment prompt could not be converted safely.
- Woztell disabled or outside service window.
- User not signed in or lacks staff role.

When AI is disabled, the existing CRM, WhatsApp, CMS, listings, and blast workflows continue working.

## Testing

Automated coverage should include:

- Knowledge indexing from FAQ, estate, district, article, and active listing sources.
- Public/private retrieval filtering.
- Embedding-disabled keyword fallback.
- CRM factual tag auto-apply rules.
- Sensitive and judgmental tag approval rules.
- Lead score and next-best-action persistence.
- Natural-language segment parsing to structured filters.
- Segment membership eligibility and reason generation.
- Blast queueing still enforcing opt-in, opt-out, approved template, review, and throttling.
- Public live-agent answer refusal when no source is found.
- Prompt injection resistance in FAQ and page content.
- Handoff creates or updates contact, lead, session, and audit records.
- Admin route smoke tests for CRM AI panel, segment builder, FAQ indexing status, WhatsApp AI assist, and public live agent.
- Secret-safety tests for AI provider keys, Neon URLs, Woztell tokens, and Blob tokens.

Manual verification should include:

- Rebuilding AI knowledge from CMS.
- Viewing FAQ indexing status.
- Creating a natural-language segment.
- Approving segment membership.
- Opening a lead and refreshing AI profile.
- Using public live-agent chat to create a lead.
- Handing off a live-agent session to WhatsApp.
- Confirming an opted-out contact cannot receive campaign messages.

## Delivery Plan Shape

Implementation should be planned in slices:

1. Neon migrations and AI data contracts.
2. Knowledge indexing and retrieval fallback.
3. CRM enrichment helpers and admin AI profile panel.
4. Segment builder and materialized memberships.
5. Public live-agent session API and UI.
6. Woztell handoff integration and WhatsApp AI assist.
7. Safety, audit, and secret-safety tests.
8. Production verification and deployment.

## Out of Scope

This design does not include:

- Autonomous WhatsApp sending.
- Autonomous campaign launching.
- Fine-tuning a model on private CRM data.
- Using private CRM or WhatsApp history for public answers.
- Voice calls.
- Payment or commission automation.
- Replacing Neon Auth.
- Replacing Woztell.
