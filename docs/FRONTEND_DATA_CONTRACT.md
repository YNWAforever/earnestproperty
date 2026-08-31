# Frontend Data Contract

P8 handoff doc. Real tables/columns the frontend actually reads and writes,
the master plan's §4 schema-gap table with each gap's **current** status
(not what the plan predicted in 2026-08-28), and the full migration log.
Written against `main` at the point all of P0–P7 had merged (2026-08-31),
grounded in `src/lib/neon/*.server.ts` and `neon/migrations/*.sql` directly,
not the plan's own predictions.

## Tables & columns

### `properties` (aka "listings")

- **Public read** (`listingColumns`): `id, listing_no, canonical_property_no,
  title_zh, title_en, deal_type, price, rent, saleable_area, gross_area,
  bedrooms, bathrooms, floor, orientation, management_fee, features,
  description, images, video_url, floorplan_url, estate_id, district_slug,
  address, status, featured, source_site, legacy_detail_id,
  legacy_property_no, legacy_url, source_url, source_updated_at,
  last_seen_at, last_scraped_at, created_at, updated_at`, plus joined
  agent/estate columns.
- **Admin write** (CMS form): only `listing_no, title_zh, deal_type,
  estate_id, district_slug, address, price, rent, saleable_area, bedrooms,
  bathrooms, floor, description, status, featured, images, seo_title,
  seo_description, video_url, agent_id, title_en, features` are editable by
  a human. `gross_area, orientation, management_fee, floorplan_url,
  canonical_property_no`, and every `source_*`/`legacy_*`/`last_*` field are
  populated only by the MLS sync pipeline.
- **No column exists for**: verification status, coordinates (`lat`/`lng`),
  `branch_id`, `published_at`, stored PSF. `floor` stays free-text, never a
  band.

### `estates`

- **Public read**: `SELECT *`, filtered `published = true`.
- **Admin write** (via `cms_content_revisions` draft/publish flow): the full
  P4 fact set — including `aliases, address, blocks, school_net_code,
  transport_note, verified_at, district_id, avg_saleable_psf, lat, lng` — is
  wired into a real write path.
- **`verified_at` is null for every estate row today**, including all 5 with
  a real detail page (`estate.$slug.tsx:297-302`'s own comment). The 17
  P4-added estates ship every fact column NULL and `published=false` by
  design.

### `districts`

Added in P4 (4 rows: sham-tseng, castle-peak-road, ting-kau,
tsing-lung-tau). **Queried in exactly one place** — an admin dropdown
(`admin-data.server.ts`). No public-facing query joins it; the public side
still resolves districts through the plain-text `estates.district_slug` /
`properties.district_slug` columns and static content in
`src/content/castle-peak-road.ts`.

### `transactions`

- **Public read**: `id, deal_date, deal_type, price, saleable_area,
  saleable_psf, unit, block, floor_band, source, source_url, verified_at`,
  joined to estate name/slug/district. Every public query hard-filters
  `published = true AND verification_state = 'verified'` (P5's
  `transaction_provenance` migration).
- **No admin write path exists for this table at all** — no
  INSERT/UPDATE anywhere in `admin-data.server.ts`/`admin-cms.server.ts`, no
  `admin.*transaction*` route. Every existing row therefore still defaults
  to `verification_state='unverified'`/`published=false`, so **`/transactions`,
  the district transaction chart, and the estate transaction table currently
  render zero rows in production** — the publish/verify gate works exactly
  as designed, nothing has ever been pushed through it. `transactions.agent_id`
  (added by the same migration) is likewise never selected anywhere — an
  unused column today.

### `staff_users` (agents)

- **Public read**: `id, public_slug, name_zh, name_en, job_title, phone,
  whatsapp, licence_no, avatar_url, branch, branch_id, bio, specialties,
  served_estate_slugs, languages`, filtered `active = true AND
  show_on_website = true`. `branch_id` is read defensively via
  `to_jsonb(s)->>'branch_id'` rather than a bare column reference so a
  not-yet-migrated DB degrades gracefully.
- **`branch_id` starts NULL for every agent** — deliberately: "no
  backfill/guess of which real branch an agent belongs to... a human links
  this going forward via the admin CMS" (migration comment). **`languages`
  is likewise NULL for every existing row** — absence renders as "no
  languages recorded," never a guess.
- The free-text `branch` column is what's actually populated
  (`resolveBranchContact()` in `site-branches.js`). A real production bug
  (documented in `CHANGELOG.md`) previously let a `branch ?? DEFAULT_AGENT_BRANCH.name`
  fallback silently claim 15 of 23 agents worked at 麗都分行 — that fallback
  has since been removed; a missing branch now renders nothing.

### `branches`

3 seeded rows (lido, rhine, hong-kong-garden). **`whatsapp` is `NULL` on all
three** (matches the master plan's open input #9). `hours` and a map URL
were never even given columns.

### `articles`

Public list reads `slug, title, excerpt, cover_image, category,
reading_minutes, published_at`; single-article read adds `content`. Both
filter `published = true`. `author_id` exists since the first admin
migration but no current query selects it — effectively unused in reads.

### `faqs`

Public read: `question, answer` only, filtered `scope = $1 AND published`.

### `cms_videos`

Public read: `id, title, video_url, description, sort_order, created_at,
youtube_published_at, category`, filtered `published = true AND
(youtube_managed = false OR youtube_available = true)`. `category`
(P5e2/P7) is genuinely optional — "an uncategorised video simply doesn't
count toward any chip — never guessed" (`videos.tsx`'s own comment).

### Write-mostly / lead-capture tables (real, but not part of the "main
public-facing" read set)

`inquiries`, `crm_contacts`, `crm_leads` (public contact form — a documented
gap: `crm_contacts.opt_in_whatsapp` can only ever be *raised* by an inbound
WhatsApp message; a form resubmission never raises consent for an existing
contact, by design), `listing_alerts` (P3 zero-results notify-me),
`valuation_leads` (P5 owner-valuation form).

### Internal-only (admin/CRM/WhatsApp/AI backend — not consumer-facing)

`staff_roles`, `media_assets`, `crm_activities`,
`whatsapp_conversations/messages/templates/audiences/campaigns/campaign_recipients`,
`audit_logs`, `ai_knowledge_sources/chunks`, `crm_ai_profiles/tags`,
`crm_segments/segment_memberships`, `live_agent_sessions/messages`,
`ai_audit_logs`, `ai_content_proposals`, `ops_audit_logs/jobs/job_attempts/migration_runs`,
`staff_identity_actions`, `cms_content_revisions`, `rate_limits`,
`youtube_sync_state`, `listing_sync_runs`, `listing_source_observations`,
`property_source_links`, `property_sync_fields`, `property_sync_state`,
`listing_change_events`, `listing_media_records`.

## Schema gap table — master plan §4, current status

The master plan's own verbatim gap paragraph (2026-08-28):

> **Known contract gaps to document, not necessarily to fill** (from the
> data audit): `properties` has no verification status, no coordinates, no
> `branch_id`, no `published_at`, no stored PSF, and `floor` is free text
> not a band; `estates` had no aliases/address/blocks before P4;
> `transactions` had no provenance before P5. Where a spec field has no
> column and no verified source, the UI **hides** it — it does not display
> an empty label.

Status of each gap **today**, checked against the actual schema and code:

| Gap | Status |
|---|---|
| `properties` has no verification status | **Still open.** No migration since the plan touched `properties` for this. |
| No coordinates | **Still open on `properties`, worked around.** `property.$listingNo.tsx` falls back to `estate.lat`/`estate.lng`, then to a Google Maps query built from the free-text address. A real substitute, not a fill. |
| No `branch_id` on `properties` | **Still open on `properties` itself, compensated elsewhere.** P5 added `branch_id` to `staff_users` instead; a property's branch is resolved through its assigned agent, or through `resolveBranchContact()`'s estate/district matching. |
| No `published_at` | **Still open.** Only `articles.published_at` and `cms_videos.youtube_published_at` exist; `properties` still relies solely on its `status` enum. |
| No stored PSF | **Still open on `properties`.** `transactions.saleable_psf` existed from the original schema; `properties` never got an equivalent — `formatPsf()` computes `price / area` on every render instead. |
| `floor` is free text | **Still open.** Never converted to a band/enum. |
| `estates` had no aliases/address/blocks before P4 | **Schema gap closed** by `20260830130000_estate_expansion.sql` (P4) — `aliases, address, blocks, school_net_code, verified_at, transport_note, district_id` all added, with a real CMS write path. **Data gap still open**: every one of these columns is NULL for all 22 estates. The UI correctly renders a caveat instead of a fabricated date rather than pretending the schema fill means the facts exist. |
| `transactions` had no provenance before P5 | **Schema gap closed** by `20260830140000_transaction_provenance.sql` (P5) — `source, source_url, verification_state, verified_at, agent_id, published, block, floor_band, social_state` added, and every public query gates on `published=true AND verification_state='verified'`. **Practical consequence**: since nothing anywhere writes to this table, every row still defaults to `unverified`/unpublished — the gate is real and working, it just has zero rows passing through it yet. |

**One planned item that was never built**: the master plan's own P6 migration
table lists a `cms_authorship` migration (`created_by`/`updated_by` on CMS
rows, plus a `listing_media` join table for media-usage tracking). **No such
migration exists** in `neon/migrations/` — no `created_by`/`updated_by`
columns were ever added to `estates`, `articles`, `properties`, or `faqs`.
(A `listing_media_records` table does exist, but it's part of P5's
dual-source MLS sync pipeline — dedup/hash tracking, not CMS authorship —
and predates, doesn't fulfill, this planned item.)

## Migration log (`neon/migrations/`, chronological)

| # | File | Adds |
|---|---|---|
| 1 | `20260622060000_public_content.sql` | Base schema: `estates`, `properties`, `faqs`, `articles`, `transactions`, `inquiries` + enums. Seeds original 5 estates + 3 FAQs. |
| 2 | `20260623090000_neon_admin_crm_whatsapp.sql` | Admin/CRM/WhatsApp foundation tables; SEO columns on `properties`/`articles`/`estates`. |
| 3 | `20260624110000_ai_crm_live_agent.sql` | AI/live-chat: `ai_knowledge_sources/chunks` (pgvector), `crm_ai_profiles/tags`, `crm_segments`, `live_agent_sessions/messages`, `ai_audit_logs`. |
| 4 | `20260626120000_live_agent_security.sql` | `live_agent_sessions.access_token` (session-hijack fix); `rate_limits` table. |
| 5 | `20260626120100_crm_ai_profile_status.sql` | `crm_ai_profiles.generated_by` — distinguishes real AI output from the deterministic fallback. |
| 6 | `20260626120200_woztell_member_identity.sql` | Partial unique index on `crm_contacts.whatsapp_member_id`. |
| 7 | `20260709090000_cms_videos.sql` | Creates `cms_videos`. |
| 8 | `20260710090000_agent_profiles.sql` | `public_slug/job_title/show_on_website/display_order` on `staff_users`. |
| 9 | `20260711090000_cms_content_revisions.sql` | `published` on `estates`/`faqs`; `archived_at` on `media_assets`; creates `cms_content_revisions` (draft/publish versioning), backfills v1 rows. |
| 10 | `20260712120000_ai_content_proposals.sql` | Creates `ai_content_proposals` (content-copilot generate/improve/fact-check). |
| 11 | `20260714180000_backend_control_plane.sql` | Creates `ops_audit_logs/jobs/job_attempts/migration_runs`. |
| 12 | `20260801090000_staff_public_slug_unique.sql` | Production constraint repairs (`staff_users.public_slug` unique, `faqs (scope, question)` unique). |
| 13 | `20260802090000_listing_search_indexes.sql` | `idx_properties_active_sort` matching `/listings`' exact query shape. |
| 14 | `20260802100000_agent_specialties.sql` | `specialties`/`served_estate_slugs` on `staff_users`. |
| 15 | `20260816120000_staff_identity_actions.sql` | Creates `staff_identity_actions` (idempotent, auditable staff invite/reset/revoke). |
| 16 | `20260817120000_dual_source_listing_sync.sql` | `canonical_property_no` on `properties`; creates the dual-source MLS sync pipeline tables. |
| 17 | `20260817130000_youtube_channel_sync.sql` | YouTube fields on `cms_videos`; creates `youtube_sync_state`. |
| 18 | `20260822120000_whatsapp_audience_segment_link.sql` | `source_segment_id` on `whatsapp_audiences`. |
| 19 | `20260830120000_listing_alerts.sql` | (P3) Creates `listing_alerts`. |
| 20 | `20260830130000_estate_expansion.sql` | (P4) Creates `districts`; adds `district_id`/aliases/address/blocks/school_net_code/verified_at/transport_note to `estates`; inserts 17 new estate rows, all unpublished. |
| 21 | `20260830140000_transaction_provenance.sql` | (P5) Provenance columns + verification-state gate on `transactions`. |
| 22 | `20260830150000_agent_languages.sql` | (P5) `languages` on `staff_users`. |
| 23 | `20260830160000_branches_entity.sql` | (P5) Creates `branches` (3 rows); `branch_id` on `staff_users`. |
| 24 | `20260830170000_valuation_leads.sql` | (P5) Creates `valuation_leads`. |
| 25 | `20260831090000_staff_viewer_role.sql` | (P6a) Adds `'viewer'` to the `staff_role` enum. |
| 26 | `20260831180000_video_category.sql` | (P5e2) `category` on `cms_videos`. |
