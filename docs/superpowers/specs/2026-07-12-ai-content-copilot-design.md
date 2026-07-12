# AI Content Copilot Design

## Goal

Add a structured, human-reviewed AI Content Copilot to the Earnest Property admin system. The Copilot helps staff create and improve CMS content and property listings, performs optional cited web research, and proposes field-level edits without saving or publishing content automatically.

The first milestone uses OpenCode Go through an OpenAI-compatible server adapter and Tavily for web research. Existing CMS revisions, listing mutations, staff permissions, and publication controls remain authoritative.

## Approved Decisions

- Support CMS records and property listings in the first milestone.
- Embed the Copilot inside each supported editor rather than create a separate AI workspace.
- Use structured actions and validated field patches rather than a chat-first interface.
- Generate proposals and previews only. Staff select fields to apply, then use the existing save or publish workflow.
- Allow internal knowledge plus optional cited web research.
- Use OpenCode Go through `OPENCODE_GO_BASE_URL`, `OPENCODE_GO_API_KEY`, and `OPENCODE_GO_MODEL`.
- Use Tavily through `TAVILY_API_KEY` for cited web research.
- Do not replace the existing AI Gateway paths for CRM enrichment, segmentation, embeddings, knowledge retrieval, or the public live agent in this milestone.

## Current Context

- `/admin/cms` manages estates, articles, FAQs, video metadata, media, SEO fields, publication state, revisions, and AI knowledge rebuilds.
- `/admin/listings`, `/admin/listings/new`, and `/admin/listings/:id` manage property inventory.
- Neon is the application source of truth and already stores staff access, CMS revisions, listings, AI knowledge, and audit data.
- Existing AI modules provide a server-only provider boundary, knowledge indexing, CRM enrichment, structured segments, and live-agent workflows.
- Existing publication and listing mutations already enforce staff permissions. The Copilot must compose with those paths rather than bypass them.

## Scope

### Supported Resources

- Estate pages.
- Articles.
- FAQs.
- Video titles and descriptions.
- Property listings.

Media files, CRM records, WhatsApp messages, campaigns, and analytics recommendations are outside this milestone.

### Supported Actions

- `generate`: create content for empty or selected fields.
- `improve`: improve clarity, structure, grammar, and usefulness while preserving facts.
- `shorten`: reduce length to a selected publishing context.
- `translate`: translate between Traditional Chinese/Cantonese-oriented property copy and English.
- `seo_optimize`: improve titles, descriptions, headings, keyword coverage, and search intent without keyword stuffing.
- `fact_check`: compare selected copy with internal records and cited research, returning warnings and corrections.

### Allowed Fields

The server owns an explicit allowlist per resource type. Unknown fields are rejected even if a model returns them.

- Estate: `name_zh`, `name_en`, `description`, `seo_title`, `seo_description`.
- Article: `title`, `excerpt`, `content`, `seo_title`, `seo_description`.
- FAQ: `question`, `answer`.
- Video: `title`, `description`.
- Listing: `title_zh`, `title_en`, `description`, `features`.

Structured facts such as price, rent, area, bedrooms, bathrooms, floor, orientation, address, estate, district, listing status, publication state, IDs, ownership, and timestamps are context-only. The Copilot cannot patch them.

## Architecture

### OpenCode Go Provider

Add a server-only OpenAI-compatible adapter with:

- Base URL normalization and `/chat/completions` requests.
- Bearer authentication.
- Model selection from environment configuration.
- A 20-second timeout.
- At most two retries for network failures, HTTP 429, and HTTP 5xx responses.
- Strict structured-response parsing and stable application error codes.
- No secrets, prompts, or raw provider responses in client bundles.

This adapter is specific to Content Copilot operations in the first milestone. It does not change the existing provider used by other AI modules.

### Content Copilot Domain

Create a focused domain module with three layers:

- Pure policy and schema layer: supported resources, actions, fields, patch schemas, evidence rules, fingerprints, and claim validation.
- Server orchestration layer: permission checks, record loading, knowledge retrieval, Tavily research, prompt construction, OpenCode execution, validation, and proposal persistence.
- Shared admin UI: action controls, field selection, proposal review, citations, warnings, and field-level application.

TanStack server functions expose generation and proposal-decision operations to the admin UI. The server independently reloads the resource and never trusts record context supplied by the browser.

### Internal Context

The orchestrator loads only context relevant to the current record:

- Current persisted resource fields.
- Linked estate and district data.
- Listing facts and public agent information when relevant.
- Recent transaction summaries when relevant and available.
- Published FAQ, estate, district, article, and listing knowledge chunks.
- Approved brand guidance stored as staff-visible AI knowledge if configured.

CRM contacts, leads, WhatsApp conversations, staff notes, and other personal data are excluded.

## Web Research

Web research is optional for every generation request and off by default. When enabled:

1. The server derives a narrow query from the estate, district, address, developer, or selected topic.
2. Tavily returns a bounded set of results with title, URL, and excerpt.
3. URLs are normalized and restricted to `https`.
4. Page text and search excerpts are treated as untrusted reference material, never as instructions.
5. Only short excerpts needed for review are retained; complete third-party pages are not stored.
6. Every web-supported claim must reference at least one returned citation.

Missing citations do not prevent generation of clearly subjective marketing copy, but factual claims without internal evidence or citations are marked unsupported and cannot be selected for application until removed or regenerated.

## Structured Proposal Contract

OpenCode Go returns strict JSON containing:

- Resource type and source fingerprint.
- Proposed patches keyed by allowed field name.
- Existing and proposed values.
- Reason for each change.
- Claim-level evidence references.
- Confidence: `high`, `medium`, or `low`.
- Warnings and unsupported claims.
- Language and tone metadata.

The application validates this response before persistence. It rejects malformed JSON, unknown fields, invalid value types, oversized output, unsafe URLs, missing evidence references, and resource/fingerprint mismatches.

## Data Model

Add `ai_content_proposals`:

- `id uuid primary key`.
- `resource_type text` with an allowlist check.
- `resource_id uuid`.
- `action text` with an allowlist check.
- `selected_fields text[]`.
- `source_fingerprint text`.
- `request_context jsonb` containing bounded, non-secret metadata.
- `patches jsonb`.
- `evidence jsonb`.
- `warnings jsonb`.
- `provider text` set to `opencode_go`.
- `model text`.
- `prompt_version text`.
- `status text`: `generating`, `generated`, `partially_applied`, `applied`, `rejected`, `expired`, or `failed`.
- `accepted_fields text[]`.
- `requested_by uuid references staff_users(id)`.
- `decided_by uuid references staff_users(id)`.
- `latency_ms integer`.
- `usage_metadata jsonb`.
- `error_code text`.
- `created_at`, `decided_at`, and `expires_at`.

Indexes support resource history, staff usage, status, and expiration queries. A partial unique index allows at most one `generating` proposal per staff account. Proposals expire after 24 hours and are also invalidated whenever the current resource fingerprint differs.

Existing `ai_audit_logs` records high-level events: proposal generated, generation failed, fields applied, proposal rejected, and stale proposal blocked.

## Editor Workflow

Each supported editor gets a fixed-width side panel that does not resize the form when loading or displaying results.

### Request Controls

- Action segmented control.
- Valid field checkboxes for the current resource.
- Tone menu: professional property, concise portal, Cantonese conversational, or neutral informational.
- Language target where applicable.
- Internal-only or cited-web-research mode.
- Context summary showing which internal sources will be used.

### Review State

The panel shows one stable review row per proposed field:

- Existing and proposed value.
- Character or word-count difference.
- Change reason.
- Internal evidence and Tavily citations.
- Confidence badge.
- Unsupported-claim and safety warnings.
- Selection checkbox.

Staff can apply selected fields, reject the proposal, or regenerate it. Applying fields updates only the local unsaved form state. Staff then use the existing Save Draft, Save, or Publish controls.

### Concurrency

The proposal includes a fingerprint of the persisted source fields. Before field application, the server confirms the resource still has that fingerprint. If it changed, the proposal becomes expired and the UI requires regeneration against the latest record.

## Permissions and Rate Limits

- Admins, managers, and agents who can access the underlying editor may request proposals.
- The Copilot does not grant publication or listing mutation permissions.
- Existing publish and save functions remain the only database mutation path for content.
- Default rate limit: 20 generation requests per staff account per rolling hour and one active generation per staff account.
- Fact-check and regenerate operations count as generation requests.
- Rate-limit failures do not block ordinary editing or saving.

## Error Handling

Stable errors are returned for:

- OpenCode Go not configured.
- Tavily not configured when web research is selected.
- Provider timeout or transient failure.
- Rate limit exceeded.
- Malformed or invalid structured output.
- Unsupported fields or claims.
- Missing resource or insufficient permission.
- Stale resource fingerprint.

The side panel preserves the staff member's form state and offers retry or internal-only generation where appropriate. Provider failures never disable the editor, overwrite fields, or publish content.

## Security and Privacy

- Provider and Tavily keys remain server-only.
- The browser sends resource identity, action, selected fields, tone, language, and research mode; it does not send authoritative record facts.
- Server prompts exclude CRM and WhatsApp personal data.
- Retrieved web content is delimited as untrusted evidence and cannot modify system instructions.
- Citation URLs accept only `https` and are escaped before rendering.
- Logs store error codes and bounded metadata, not secrets or complete prompts.
- Proposal history is visible only to authenticated admin staff.

## Testing

### Pure Unit Tests

- Resource and field allowlists.
- Structured proposal validation.
- Fingerprint stability and stale detection.
- Evidence-reference and unsupported-claim rules.
- URL normalization and unsafe-scheme rejection.
- Patch application helpers.

### Server Tests

- Role checks and server-side resource reloading.
- OpenCode configuration, timeout, retry, malformed JSON, and provider errors.
- Tavily disabled, successful research, timeout, and unsafe result handling.
- Proposal persistence, audit logging, expiration, rejection, partial application, and rate limits.
- No CRM or personal fields enter provider context.

### UI Tests

- Valid actions and fields change by resource type.
- Loading, empty, failed, stale, and review states.
- Field-level selection and application.
- Unsupported claims cannot be selected.
- Citations are accessible and open safely.
- Existing form values survive provider errors.

### End-to-End Verification

- Generate and partially apply an estate SEO proposal.
- Translate and apply selected listing fields without changing structured facts.
- Fact-check an article using internal and Tavily evidence.
- Block a stale proposal after a concurrent resource update.
- Confirm no AI operation saves or publishes until staff invokes the existing mutation.

## Rollout

1. Add the proposal migration and server-only provider/research configuration.
2. Implement pure schemas, policies, and test fixtures.
3. Implement generation, proposal persistence, audit, rate limiting, and decision functions.
4. Add the shared editor panel and integrate CMS resource editors.
5. Integrate listing create/edit forms.
6. Add production environment variables only after code and preview verification.
7. Run a staff-only pilot with internal research first, then enable Tavily research after citation review.

The feature remains hidden or disabled when OpenCode Go is not configured. Existing editors continue to work without AI configuration.

## Deferred Phases

- Conversational instructions and chat-style editing.
- Bulk generation and approval queues.
- Campaign objective, audience, copy, schedule, and compliance Copilot.
- Website, content, lead, and campaign performance analytics.
- AI performance recommendations and controlled experiments.
- Autonomous low-risk changes or publishing.

These phases should reuse the provider, proposal, evidence, audit, and human-approval boundaries established here rather than expanding this first milestone.
