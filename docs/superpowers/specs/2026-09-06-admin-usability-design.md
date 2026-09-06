# CMS and CRM daily admin usability

Status: approved by user on 2026-09-06. This document is an audit and design, not implementation evidence.

## Evidence and limits

Reviewed the current audit-20260905 checkout against main 144246ff: AdminShell, admin.cms, admin.leads, admin.leads_.command-center and admin.whatsapp. Current architecture is Neon staff authentication with server-enforced permissions. No permission or provider changes are needed.

A fresh browser visit to production admin routes shows the login gate. The shared-browser tool failed to start due to the Windows sandbox helper. Consequently these findings are source-verified; authenticated production usability has not been observed in this pass. No customer messages or data edits were made.

## Findings

1. CMS puts a large AI knowledge-index status card above the content tabs, search and editing work. It includes technical terms such as chunks and an English heading.
2. Estate editors expose district_slug as a text field and the hero image as a URL field. Slug, area units and list input conventions lack enough guidance for ordinary editors.
3. CMS editor actions sit at the end of long forms inside a scrolling dialog. AI and revision history share the main editing layout, making the main save/publish path harder to follow.
4. CMS search is sent to the paginated server query, yet NoSearchMatch says only the loaded page was searched. The row-cap notice says the opposite. This contradictory explanation can encourage duplicate content creation.
5. CRM, the workbench and navigation use inconsistent stage labels: contacted is 跟進 versus 已聯絡, negotiating is 商議中 versus 傾緊, and closed_lost is 失敗 versus 失單. Lead, Activity and Opt-in also appear in routine admin controls.
6. CRM shows all filters at once; intent/source controls expose raw stored values through datalists. Frequent tasks such as finding new or unassigned inquiries take unnecessary filter work.
7. WhatsApp places AI assistance and service-window explanations before the reply composer. Its workflow can emphasize the conversation and next allowed action more clearly.

Existing good behavior to preserve: unsaved-change guards, revision comparison, explicit publishing, per-customer reply drafts, server authorization, current-offering identities, accurate unknown/zero distinctions, and deep links between workbench, inquiry and conversation.

## Options

- Recommended: improve daily workflows within the existing application. Includes information hierarchy, forms, terminology, filters, feedback and responsive behavior. Existing business rules remain authoritative.
- Smaller: copy and labels only. Quick, but does not address long forms or excessive controls.
- Larger: rebuild CMS/CRM as a new unified console. Higher regression and migration cost; defer until the focused improvements have been used.

## Proposed first release

### Shared admin navigation

Use Chinese task-based section labels; rename Lead Command Center to 跟進工作台 and consistently call records 客戶查詢. Preserve route URLs and role access. Use one shared stage-label definition across inquiry lists, details and workbench, with new=新查詢, contacted=已聯絡, viewing=已約睇樓, negotiating=商議中, closed_won=已成交, closed_lost=已結束（未成交）. These are display labels only, not automatic state transitions.

### CMS

Put content tabs, search, current category count and create/edit actions first. Show a compact knowledge status summary; expand technical details on demand, keeping stale/failure alerts visible.

Group estate/article editing into basic information, page content, images and search appearance. Use an existing authoritative district choice list rather than requiring a district code. Add explicit area units, facility line guidance and URL-slug help. Reuse the current media upload capability with preview and retain URL entry as an alternative.

Keep a visible action area with unsaved/saving/saved feedback and distinct 儲存草稿 and 發佈 actions. Preserve revision comparisons, validation and unsaved-change protection. AI suggestions and version history are secondary expandable areas. AI failures retain the current form and offer retry; do not change providers or generation behavior in this release.

Make search scope, filtered totals, paging and no-results language agree with the server query. Empty results offer clear/reset actions; fetch errors offer retry without suggesting that content has disappeared.

### CRM and follow-up workbench

Keep search plus the most-used stage/agent controls visible. Provide new and unassigned quick filters using existing server filter semantics; move source, intent and WhatsApp marketing-consent filters into an expandable advanced section. Render Chinese labels while preserving raw enum values in requests and allowing existing unknown values to remain visible.

Use the shared stage terminology throughout. In inquiry details prioritize the customer, source, related property, assigned agent and internal follow-up note. Make internal notes visibly distinct from outbound WhatsApp replies. Preserve current save semantics and link to the already-related conversation where available.

Keep the workbench focused on why an inquiry needs attention and the available next action. Clearly identify AI scores and suggestions as AI output; missing analysis remains unknown. Do not infer appointments, consent, deal completion or confirmed customer intent.

### WhatsApp

Keep conversation, status and permitted reply action prominent. Collapse optional AI details and technical provider details while retaining necessary service-window and refusal explanations. Keep reply drafts, template confirmation and permission rules. No automatic sending; verification uses synthetic fixtures only.

## Verification and rollout

- Regression tests for shared label mapping, filter serialization and truthful search/error states.
- CMS synthetic-data browser checks: search, edit, field validation, draft save, explicit publish confirmation, unsaved close protection, upload error and AI failure without losing edits.
- CRM synthetic-data checks: quick/advanced filters, customer selection, internal-note/save feedback and correct conversation deep link.
- Desktop and 390px mobile: keyboard reachability, visible actions, no horizontal overflow in primary forms.
- Keep staff/role denial tests passing. TypeScript, lint, relevant CMS/CRM suites and independent review before release.
- Authenticated production acceptance requires an available admin browser session; do not claim a login screen verifies protected workflows. CI/deployment and read-only production checks follow the existing approved release workflow after implementation approval.

No database migration, new AI/provider integration, new customer records, automatic messages or changes to lead scoring are part of this proposal.
