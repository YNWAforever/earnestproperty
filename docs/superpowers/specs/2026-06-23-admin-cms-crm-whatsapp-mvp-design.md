# Admin CMS, CRM, and WhatsApp MVP Design

## Goal

Turn `/admin` from a mostly read-only staff dashboard into a functional Earnest Property operations workspace. The MVP covers core public SEO CMS, listing management, lead CRM, WhatsApp inbox, and compliant WhatsApp campaign blasting.

This round stays Neon-only for application data and auth. Vercel Blob remains the binary media store, with Neon storing media metadata and relations. Woztell integration is live-ready but safe: real send and queue paths exist, while missing or disabled Woztell configuration produces clear admin states instead of broken pages or accidental sends.

## Current Evidence

- The app is a TanStack Start project deployed on Vercel.
- Neon Auth is already wired for staff login and server-function bearer auth.
- The Neon admin migration already defines staff, media, CRM, WhatsApp, campaign, recipient, and audit tables.
- `/admin`, `/admin/cms`, `/admin/listings`, `/admin/leads`, `/admin/whatsapp`, and `/admin/blasts` exist.
- `/admin/cms`, `/admin/leads`, `/admin/whatsapp`, and `/admin/blasts` are currently list-only screens.
- `/admin/listings` has a list and links to create/edit listing forms, but status workflows, filters, inline actions, preview links, and agent assignment are incomplete.
- Current write paths exist for property save/delete, inquiry status, Woztell one-to-one send, campaign queueing, and the send-queue job, but the admin UI does not expose a complete workflow around them.

## Product Scope

The MVP includes five staff modules:

- CMS for core public SEO content.
- Listings for sale/rent inventory management.
- Leads CRM for contact, inquiry, assignment, and follow-up work.
- WhatsApp Inbox for conversation review and live-ready replies.
- Blasts for template-only, opt-in-only WhatsApp campaign management.

The admin should feel like an internal tool, not a marketing site. Screens should prioritize dense, scannable tables, predictable detail panes, guarded actions, and clear save states.

## Architecture

Use the existing code boundaries:

- Client route screens: `src/routes/admin.*.tsx`.
- Shared admin UI: `src/components/admin/*`.
- Browser-safe server-function wrappers: `src/lib/neon/admin-data.ts`.
- Server-only database work: `src/lib/neon/admin-data.server.ts`.
- Auth and role verification: `src/lib/neon/auth.server.ts`.
- Woztell sending and validation: `src/lib/woztell/woztell.server.ts`.
- Admin API routes for Woztell sends and campaign queue jobs.
- Vercel Blob upload route for binary media.

All admin mutations must call server functions or admin API routes that verify `requireStaffAccess` before writing to Neon. Client bundles must not contain database URLs, Woztell tokens, Blob tokens, or server-only secrets.

## Roles

Existing roles remain:

- `admin`: full CMS, listings, CRM, WhatsApp, blasts, agents, and settings access.
- `manager`: CMS, listings, CRM, WhatsApp, and campaign management, excluding destructive staff/security settings.
- `agent`: assigned listings, assigned leads, assigned conversations, notes, and allowed one-to-one WhatsApp replies.

Role enforcement must happen server-side. Client UI can hide unavailable actions, but hidden UI is not treated as security.

## CMS Module

CMS focuses on core public SEO content only.

Estate editor:

- Edit slug-safe metadata, Chinese and English names, district, units, years, developer, intro copy, highlights, buyer fit, transport notes, school notes, SEO title, and SEO description.
- Show public preview link for `/estate/$slug`.
- Keep destructive estate deletion out of scope.

Article editor:

- Create and edit title, slug, category, excerpt, body, publish toggle, published date, SEO title, and SEO description.
- Support draft and published states.
- Show public preview link for published articles.

FAQ editor:

- Group FAQs by `scope`.
- Add, edit, delete, and reorder FAQ rows.
- Validate that question and answer are present before save.

Media manager:

- List uploaded media assets.
- Edit alt text, owner type, and owner relation when safe.
- Copy public URL.
- Deleting binary blobs is out of scope unless an existing media asset is unowned and unused.

## Listings Module

The listings module becomes the day-to-day inventory control surface.

Table features:

- Filters for status, sale/rent, estate, featured, and assigned agent.
- Search by listing number, title, estate, and address.
- Columns for listing, deal type, estate, price/rent, area, status, featured, agent, and updated date.
- Row actions for edit, public preview, duplicate draft, mark offline, mark sold/rented, and delete where permitted.

Editor features:

- Move create/edit flows under admin-facing navigation while preserving existing property form behavior.
- Support listing number, title, deal type, status, estate, district, address, price, rent, saleable area, bedrooms, bathrooms, floor, description, images, featured, agent, SEO title, and SEO description.
- Save through existing property mutation paths extended for new fields.
- Prefer status transitions over hard delete. Hard delete remains admin-only and confirmation-gated.

## Leads CRM Module

Leads become actionable records instead of static rows.

List features:

- Filters for stage, intent, source, assigned agent, opt-in, and created date.
- Search by name, phone, email, listing number, and note.
- Quick stage badge updates for common transitions.

Detail features:

- Contact card with name, phone, email, WhatsApp opt-in and opt-out state.
- Lead data with intent, budget range, preferred estates, source, related property, assigned agent, and stage.
- Activity timeline from `crm_activities`.
- Actions to assign agent, update stage, add note, schedule follow-up, complete activity, and mark won/lost.

Writes:

- Lead updates write to `crm_leads`.
- Notes and follow-ups write to `crm_activities`.
- Material changes write `audit_logs`.

## WhatsApp Inbox Module

The inbox gives staff a real conversation workspace.

Layout:

- Left conversation list with contact, phone, status, assigned agent, last message, last direction, opt-out state, and last inbound time.
- Right conversation detail with message history and contact/lead context.

Actions:

- Assign conversation.
- Open or close conversation.
- Add internal note linked to the contact or lead.
- Reply through Woztell when enabled and allowed.

Safety:

- If Woztell is disabled or missing configuration, reply controls are disabled with a clear message.
- Freeform replies are allowed only inside the 24-hour inbound window.
- Outside the 24-hour window, freeform send remains blocked; staff must use a template-based flow when available.
- Opted-out contacts cannot receive outbound replies or blasts until a renewed opt-in is explicitly recorded.

## Blasts Module

Blasts are compliant campaign operations, not freeform bulk messaging.

Campaign builder:

- Create campaign name.
- Select active approved template.
- Select or create audience.
- Optional schedule date.
- Save as draft or submit for review.

Audience preview:

- Show total contacts, eligible contacts, opted-out contacts, missing phone contacts, and blocked contacts.
- Recipients must be materialized in `whatsapp_campaign_recipients` before queueing.

Queue workflow:

- Managers and admins can review and queue.
- Queueing requires an active template, opt-in contact, not opted out, normalized phone, and non-cancelled campaign state.
- The send queue job sends at a controlled batch size and records sent, failed, or blocked recipient state.

Campaign list:

- Show status, template, audience, recipient counts, sent, failed, blocked, scheduled date, and reviewed by.
- Allow cancel before sending completes.

## Data Flow

Read flow:

1. Staff signs in with Neon Auth.
2. Admin route loads and calls the relevant server function.
3. Server verifies staff access.
4. Server queries Neon and returns only admin-safe fields.

Write flow:

1. Staff submits a form or action.
2. Client calls a server function or admin API route with bearer session auth.
3. Server verifies role with `requireStaffAccess`.
4. Server validates input.
5. Server writes Neon.
6. Server writes `audit_logs` for meaningful changes.
7. Client refreshes the module query and shows success or error state.

Public site flow:

- Public routes continue reading only published, active, or public-safe data from Neon.
- Admin draft and operational fields do not appear on public pages unless explicitly published.

## Error Handling

Admin screens should distinguish:

- Not signed in: show staff login prompt.
- Signed in but unauthorized: show role/access message.
- Woztell disabled: show configuration warning and disable outbound controls.
- Validation error: show field-level or action-level message.
- Server failure: show retryable admin error.
- Stale server function: keep existing reload recovery behavior.

No admin module should silently render an empty table when the real problem is auth, configuration, or server failure.

## Testing

Automated coverage should include:

- Admin auth guard and role checks for all new mutations.
- CMS estate/article/FAQ create, update, publish, delete/reorder behavior.
- Listing filters, save, status transitions, media metadata, preview links, and protected delete.
- Lead assignment, stage updates, note creation, follow-up completion, and audit logs.
- WhatsApp conversation listing, detail loading, disabled configuration state, 24-hour freeform guard, opt-out guard, and outbound message persistence.
- Campaign create, audience preview, recipient materialization, review/queue gating, opt-in-only behavior, blocked recipients, and send-queue status updates.
- Route smoke tests for `/admin/cms`, `/admin/listings`, `/admin/leads`, `/admin/whatsapp`, and `/admin/blasts`.
- Secret-safety checks that Neon database URLs, Woztell tokens, and Blob tokens are absent from client bundles.

Manual verification should include:

- Desktop and mobile admin navigation.
- A listing create/edit/publish flow.
- An estate or article CMS edit and public preview.
- A lead stage/note/assignment flow.
- WhatsApp inbox disabled-state view when Woztell is off.
- A blast draft that cannot queue until template, audience, and opt-in requirements pass.

## Delivery Plan Shape

Implementation should be planned in slices:

1. Shared admin data contracts and test fixtures.
2. Server mutations and validation helpers.
3. Shared admin UI components for filters, detail panels, save states, and confirmation dialogs.
4. CMS editors.
5. Listings workflow completion.
6. Leads CRM workflow.
7. WhatsApp inbox workflow.
8. Blast builder and queue workflow.
9. Verification, production deploy, and post-deploy route checks.

## Out of Scope

This MVP does not include:

- A visual page builder.
- Automated WhatsApp nurture sequences.
- Payment, billing, or commission tracking.
- Complex team hierarchies beyond existing roles.
- Direct MLS provider integration changes.
- Private Vercel Blob media workflows beyond current upload needs.
- Replacing Neon Auth.
- Supabase usage or fallbacks.

## Acceptance Criteria

- Every admin nav item leads to a useful workflow, not only a read-only table.
- CMS can update the approved core SEO content types.
- Listings can be filtered, edited, status-managed, previewed, and assigned.
- Leads can be assigned, progressed, and annotated.
- WhatsApp inbox can view conversations and safely expose live-ready replies.
- Blasts can be drafted, previewed, reviewed, queued, and tracked with opt-in-only safeguards.
- All writes are Neon-only, role-checked, audited, and covered by focused tests.
