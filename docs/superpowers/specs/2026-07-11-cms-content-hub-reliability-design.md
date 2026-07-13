# CMS Content Hub Reliability Design

## Goal

Replace the current monolithic `/admin/cms` page with a reliable content workspace for estates, articles, YouTube videos, FAQs, and media. Staff must be able to create and recover drafts without affecting public pages, preview changes safely, publish with server-side controls, and restore prior published versions.

This is phase one of the wider admin improvement programme. Listings, leads, WhatsApp, campaigns, segments, and the command centre remain separate follow-on phases.

## Confirmed Decisions

- `/admin/cms` is a Content Hub with searchable cross-content work queues.
- Reliability is the first release priority.
- Saving is explicit and keeps a browser-local recovery draft; it never publishes automatically.
- Every CMS content type follows Draft -> Preview -> Publish.
- The latest 20 versions of each item are available for comparison and restore.
- `admin` and `manager` can publish and restore. `agent` can create and edit drafts only.
- Existing public content remains available throughout migration. A draft never appears on public routes.

## Scope

### Included

- Content Hub overview, search, filters, saved views, and category shortcuts.
- Estates, articles, CMS videos, FAQs, and media content workflows.
- Draft save, local recovery, authenticated preview, publish, archive, version history, comparison, and restore.
- Server-side validation, role enforcement, audit entries, optimistic concurrency, and scoped error recovery.
- A migration-safe revision layer and backfill of existing content as published version 1.
- Focused automated tests and desktop/mobile browser verification.

### Excluded

- A visual page builder.
- Replacing Neon Auth, Neon, Vercel Blob, or the public-site data model.
- Editing listings, CRM records, WhatsApp conversations, campaign workflows, staff settings, or AI knowledge configuration as part of this phase.
- Hard deletion of published content or binary media.
- Public, shareable draft links. Preview is staff-authenticated in phase one.

## Current Problems

`src/routes/admin.cms.tsx` currently coordinates five content tabs, media, FAQ import, AI knowledge indexing, and all loading/saving state in a single route. Its single `refreshCmsData()` request refreshes unrelated datasets after every mutation. That shape makes failures difficult to localize and lets an unavailable dependency prevent otherwise healthy CMS work.

The existing implementation also lacks a common lifecycle for estates and FAQs, durable unsaved-edit recovery, a unified publication queue, and version restore. The revised design separates these responsibilities without changing the public routes' source-of-truth records.

## Information Architecture

### Content Hub

`/admin/cms` is an operations view, not another editor. It provides:

- Summary counts for My drafts, Ready to publish, Recently published, and Errors needing attention.
- A cross-content table with type, title, status, last editor, last saved time, current public version, and next action.
- Search across title, slug, district, and content type.
- Fixed saved views: My drafts, Ready to publish, Recently published.
- Category shortcuts for Estates, Articles, Videos, FAQs, and Media.
- A New content control that starts the appropriate type-specific draft.

The overview loads its summary independently from each category. It remains usable when one optional CMS feature is unavailable.

### Category Lists

Each category has a dedicated route or route module. It owns its list query, filters, loading state, empty state, error boundary, and retry action. A video-table rollout error, for example, is shown only in Videos with setup guidance and Retry; it never prevents access to Estates or FAQs.

Category lists show the current public item and its latest working draft together where relevant. Quick actions are Resume draft, Open editor, Preview, Publish, View history, and Archive. Archive replaces destructive deletion for content records.

### Editors

Each editor has a shared frame and type-specific fields:

- Main column: the existing domain fields for an estate, article, video, FAQ, or media record.
- Side panel: draft status, validation results, public-version comparison, activity, and the last 20 versions.
- Sticky action bar: Save draft, Preview, Publish, and More actions.

Drafts use explicit Save. Browser-local recovery stores unsaved fields per staff member, content type, and item for seven days. It is cleared after a successful save or explicit discard. Recovery is a convenience layer only; the database remains authoritative after Save.

Articles, videos, estates, and FAQs all use the same lifecycle. Media uploads create an unassigned media asset immediately, but metadata changes and usage links are represented through the associated content draft. An asset cannot be deleted while it is referenced. Binary deletion is out of scope.

## Publication Lifecycle

1. A staff member creates or resumes a draft.
2. Save validates client-side basics, preserves local recovery on failure, and sends the revision to a role-checked server function.
3. Preview renders the selected draft through an authenticated staff route. It never alters public data or exposes a shareable URL.
4. Publish validates the full content contract on the server and checks the user's role.
5. A transaction records the publish activity, marks the revision current, projects its payload to the existing canonical public table, and updates the audit log.
6. Public queries keep reading canonical published tables, so existing public routes do not need a draft-aware rendering path.

Restore never rewrites history. It creates a new draft copied from the selected version. Staff can inspect it, then publish it using the same validation and permission checks. The restored draft becomes the next version only after publishing.

## Data Model and Migration

Add a Neon migration for a generic revision store. The canonical estate, article, CMS video, FAQ, and media tables remain the public source of truth.

`cms_content_revisions` contains:

- `id`, `resource_type`, and stable `resource_id`.
- Monotonic `version_number` per resource.
- `state`: `draft`, `published`, `superseded`, or `archived`.
- `payload` JSON for the type-specific CMS fields.
- `validation_summary`, `base_published_version`, `created_by`, `created_at`, and `published_at`.
- An optimistic-concurrency token based on the draft's source revision and the current published version.

The migration backfills every existing CMS resource as published version 1. New resources receive a stable UUID before publication; their canonical record is created in the publish transaction. The latest 20 full revision snapshots are retained for each resource. Audit-log entries remain the durable record of earlier activity.

Server publication functions use a whitelist of resource types and type-specific Zod validation. They never trust client-supplied role, version, or publication state. A stale draft produces a conflict response containing the current version metadata and a comparison target; it does not silently overwrite a newer publish.

## Code Boundaries

Split the current CMS route by responsibility while retaining the existing TanStack Start and Neon patterns:

- `src/routes/admin.cms.tsx`: Content Hub route shell and overview.
- CMS category and editor route modules: list and edit one resource type at a time.
- `src/components/admin/cms/*`: reusable hub table, status badge, editor shell, revision timeline, comparison panel, recovery prompt, and scoped error state.
- `src/lib/neon/admin-cms.types.ts`: public admin CMS row, editor, revision, preview, and conflict contracts.
- `src/lib/neon/admin-cms.ts`: browser-safe server-function wrappers only.
- `src/lib/neon/admin-cms.server.ts`: Neon reads, revision mutations, publication transactions, and audit writes.
- `src/lib/neon/cms-revisions.ts`: pure lifecycle, permission, version, and conflict helpers shared by server functions and tests.
- A focused migration under `supabase` or the repository's established Neon migration location, following the existing migration runner.

The legacy `admin-data` layer may delegate to these modules while callers are migrated. This keeps unrelated CRM, WhatsApp, and campaign contracts stable.

## Reliability and Error Handling

- Every category and editor owns a local loading/error/retry state.
- A server-function exception appears as an actionable admin error, not an empty table.
- Save failures preserve form state and local recovery data.
- Optional or newly deployed tables return a typed unavailable/setup state where possible.
- Publish failures do not change canonical public records and leave the draft intact.
- Archive is confirmation-gated and reversible by restoring the latest published version.
- The UI shows a clear saved state, last successful save timestamp, and conflict state.

## Security and Roles

All reads and mutations use the existing Neon Auth bearer-session flow. Server functions call `requireStaffAccess` or its role-aware equivalent before returning privileged drafts, previews, revisions, publish operations, or restore operations.

- `admin`: draft, publish, restore, archive, and media-management access.
- `manager`: draft, publish, restore, archive, and media-management access.
- `agent`: draft creation and editing only. Publish, restore, archive, and media deletion remain unavailable and are rejected server-side.

Client-side visibility is an ergonomic hint, never an authorization boundary. Preview routes require staff authentication and do not become public URLs.

## Testing Strategy

Add focused coverage before and alongside implementation:

- Pure lifecycle tests for revision numbering, restore-as-new-draft, transition validation, role rules, and stale-version conflicts.
- Server contract tests for type-specific validation, publish transactions, backfill, archive, audit writes, and optional-table failure states.
- Route and component tests for independent category loading, draft recovery, unsaved navigation warnings, visible save errors, preview isolation, and mobile editor action access.
- Public-query tests proving drafts never alter estate, article, FAQ, video, or media public output.
- Browser verification for desktop and mobile: create draft, recover after reload, preview, publish, compare versions, restore, and handle an unavailable category without losing access to the others.

Run the existing focused admin and content suites, then extend them with the CMS revision suite. Run lint and production build after the feature slices are complete.

## Delivery Slices

1. Establish revision contracts, migration, version backfill, pure lifecycle helpers, and tests.
2. Add server-safe revision reads, saves, previews, publishes, restore, archive, and conflict handling.
3. Build the Content Hub overview and independent category list states.
4. Move estate, article, video, FAQ, and media editors onto the shared draft editor shell.
5. Add local recovery, version comparison, publish/restore controls, and audit presentation.
6. Verify public-content isolation, role boundaries, missing-table states, desktop/mobile workflows, lint, and build.

## Acceptance Criteria

- A failure in one CMS category never blocks another category or the Content Hub.
- Staff can recover unsaved work after a reload without accidentally publishing it.
- No draft is visible on a public route.
- `admin` and `manager` can publish and restore; `agent` cannot bypass those controls.
- Every publish is validated, audited, versioned, and protected from stale overwrites.
- Staff can compare and restore any of the latest 20 versions by creating a new publishable draft.
- Existing CMS records are available immediately after migration as published version 1.
- All five content types use the same reliability guarantees while preserving their existing domain fields.
